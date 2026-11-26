/**
 * RuleBox 后台 Service Worker（MV3, type: module）
 * 职责：
 * 1. 安装 / 唤醒时把深合并后的设置落盘，保证存储字段完整；
 * 2. 维护右键菜单：选中网页文本 → 写入 rb.pendingSearch 并打开面板搜索；
 * 3. 维护侧边栏可用性（跟随设置里的 features.sidePanel 开关）；
 * 4. 响应设置页的 rb:sync 消息，保持菜单 / 侧边栏与设置一致。
 *
 * 约束：本文件不得引入任何依赖 document / window 的模块，
 * 避免 Service Worker 环境下报错；只允许 chrome.* API 与纯逻辑模块。
 */

import { STORAGE_KEYS } from '../core/defaults.js';
import { getSettings, saveSettings, setItems } from '../core/storage.js';
import {
  isSearchProviderId,
  getSearchProvider,
  buildProviderRequest,
  parseProviderResponse,
  readProviderError,
  describeHttpStatus,
  sanitizeSearchError,
  normalizeQuery,
  clampPage,
  normalizePageSize
} from '../core/search-providers.js';

const MENU_ID = 'rb:search-selection';
const PENDING_SEARCH_MAX = 500; // 待搜索文本长度上限，防止超长内容撑坏界面
let syncing = false;
let syncPending = false;

/**
 * 同步右键菜单与侧边栏配置（带并发保护，防止重复 removeAll/create 打架）
 * 并发期间收到的新请求不丢弃，只置脏标记，等本轮结束后补跑一次，
 * 否则用户连续切换两个开关时，最后一次状态可能落不进菜单 / 侧边栏
 */
async function syncFeatures() {
  if (syncing) {
    syncPending = true;
    return;
  }
  syncing = true;
  try {
    do {
      syncPending = false;
      const settings = await getSettings();

      // 右键菜单：先清空再按设置重建
      await new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
      if (settings.features.contextMenu) {
        chrome.contextMenus.create({
          id: MENU_ID,
          title: '在 RuleBox 中搜索“%s”',
          contexts: ['selection']
        });
      }

      // 侧边栏开关：关闭后浏览器工具栏不再显示“打开侧边栏”入口
      if (chrome.sidePanel?.setOptions) {
        try {
          await chrome.sidePanel.setOptions({ enabled: Boolean(settings.features.sidePanel) });
        } catch {
          /* 个别环境不支持动态设置，忽略 */
        }
      }
    } while (syncPending);
  } catch (error) {
    console.error('[RuleBox] 同步功能开关失败', error);
  } finally {
    syncing = false;
  }
}

/**
 * 打开面板：优先侧边栏（Chrome 116+），失败时尝试弹窗，最后新标签页兜底。
 * 注意：sidePanel.open 必须在用户手势（右键菜单点击）内调用。
 */
async function openPanel(tabId) {
  const settings = await getSettings();
  if (settings.features.sidePanel && chrome.sidePanel?.open) {
    try {
      await chrome.sidePanel.open({ tabId });
      return;
    } catch {
      /* 打开失败继续走兜底 */
    }
  }
  if (chrome.action?.openPopup) {
    try {
      await chrome.action.openPopup();
      return;
    } catch {
      /* 继续走兜底 */
    }
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/popup.html') });
}

// 安装 / 更新：把深合并后的设置落盘，保证旧版本配置补全新字段
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await saveSettings(await getSettings());
  } catch (error) {
    console.error('[RuleBox] 初始化设置失败', error);
  }
  await syncFeatures();
});

// Service Worker 每次被唤醒都同步一次，保证菜单 / 侧边栏与存储设置一致
void syncFeatures();

const SEARCH_TIMEOUT_MS = 20000;
const SEARCH_MAX_PROVIDERS = 7;

/**
 * 单个平台的检索请求。
 * 统一在 Service Worker 内发起：扩展已在 manifest 里声明对应 host 权限，
 * 不受页面 CORS 限制，也避免把 API Key 暴露给页面侧脚本。
 */
async function searchOneProvider(providerId, { query, page, size }, apiKey) {
  const provider = getSearchProvider(providerId);
  if (!provider) throw new Error('不支持的查询平台');
  if (!apiKey) throw new Error(`${provider.name} 未配置 API Key`);

  const request = buildProviderRequest(providerId, { query, page, size, apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store'
    });

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`返回内容不是 JSON（HTTP ${response.status}）`);
    }

    if (!response.ok) {
      throw new Error(readProviderError(data) || describeHttpStatus(response.status));
    }
    return parseProviderResponse(providerId, data);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('请求超时，请稍后重试或减少每页数量');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 聚合查询：同一语法并行请求用户勾选的多个平台。
 * 任何单个平台失败都不影响其他平台，结果里逐平台返回 ok / error。
 */
async function handleCyberSearch(message, sender) {
  if (!sender || sender.id !== chrome.runtime.id) {
    return { ok: false, error: '请求来源校验失败' };
  }

  const query = normalizeQuery(message?.query);
  if (!query) return { ok: false, error: '请输入查询语法' };

  const requested = Array.isArray(message?.providers) ? message.providers : [];
  const providers = Array.from(new Set(requested.filter(isSearchProviderId))).slice(0, SEARCH_MAX_PROVIDERS);
  if (!providers.length) return { ok: false, error: '请至少选择一个查询平台' };

  const page = clampPage(message?.page);
  const size = normalizePageSize(message?.size);

  try {
    const settings = await getSettings();
    if (settings.search?.enabled === false) {
      return { ok: false, error: '聚合查询已在设置中关闭' };
    }

    const results = await Promise.all(providers.map(async (providerId) => {
      const apiKey = String(settings.search?.providers?.[providerId]?.apiKey || '').trim();
      try {
        const data = await searchOneProvider(providerId, { query, page, size }, apiKey);
        return {
          provider: providerId,
          ok: true,
          total: data.total,
          items: data.items,
          quota: data.quota || '',
          page,
          size
        };
      } catch (error) {
        return {
          provider: providerId,
          ok: false,
          error: sanitizeSearchError(error?.message, apiKey),
          page,
          size
        };
      }
    }));

    return { ok: true, query, page, size, results, at: Date.now() };
  } catch (error) {
    return { ok: false, error: sanitizeSearchError(error?.message) };
  }
}

// 设置页修改开关后发来 rb:sync，同步菜单与侧边栏；面板发起测绘查询时走 rb:cyber-search
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'rb:sync') {
    void syncFeatures();
    return;
  }
  if (message?.type === 'rb:cyber-search') {
    // 返回 true 保持消息通道，等待异步结果
    void handleCyberSearch(message, sender).then(sendResponse);
    return true;
  }
});

// 右键菜单：写入待搜索关键词，再打开面板（popup 初始化时读取，侧边栏已打开时由 storage 监听消费）
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  const text = String(info.selectionText || '').trim().slice(0, PENDING_SEARCH_MAX);
  if (!text) return;
  try {
    await setItems({ [STORAGE_KEYS.pendingSearch]: text });
  } catch (error) {
    console.error('[RuleBox] 写入待搜索关键词失败', error);
  }
  await openPanel(tab.id);
});
