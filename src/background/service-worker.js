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

// 设置页修改开关后发来 rb:sync，同步菜单与侧边栏
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'rb:sync') {
    void syncFeatures();
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
