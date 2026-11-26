/**
 * RuleBox 主界面逻辑（popup 与 side panel 共用）
 * 设计原则：
 * - 数据全部来自 JSON，界面不硬编码条目；
 * - 所有外部文本用 textContent 渲染；
 * - 复制走统一流程（变量填充 → 格式化 → 剪贴板）。
 */

import { $, $$, el, debounce, copyText, downloadText, isMacPlatform } from '../core/utils.js';
import { loadAll } from '../core/data.js';
import { searchItems, filterByCategory, countCategories } from '../core/search.js';
import { STORAGE_KEYS } from '../core/defaults.js';
import {
  getSettings,
  patchSettings,
  getFavorites,
  setFavorites,
  getRecents,
  setRecents,
  normalizeRecents,
  compareRecents,
  getVariables,
  setVariables,
  getAiHistory,
  setAiHistory,
  onStorageChanged,
  getItems,
  removeItems,
  getCyberSession,
  setCyberSession,
  getCustom,
  setCustom,
  getHidden,
  setHidden
} from '../core/storage.js';
import { requestAI, AIError, getActiveProfile } from '../core/ai-client.js';
import { retrieveExamples } from '../core/retrieve.js';
import { getProvider } from '../core/providers.js';
import { applyVars } from '../core/template.js';
import {
  SEARCH_PROVIDERS,
  SEARCH_PAGE_SIZES,
  getSearchProvider
} from '../core/search-providers.js';
import { icon } from './icons.js';
import { openItemDialog } from './item-dialog.js';
import { applyTheme, nextTheme, themeMeta } from './theme.js';
import {
  itemCard,
  itemKey,
  syncFilterSelect,
  emptyState,
  badge,
  toast,
  confirmDialog,
  copyWithVariables,
  downloadWithVariables
} from './components.js';

const hasChrome = typeof chrome !== 'undefined';

/**
 * 快捷键文案随平台变化：macOS 用 ⌘，Windows / Linux 用 Ctrl。
 * 按键逻辑本身同时接受 ctrlKey / metaKey，这里只影响界面提示文字，
 * 避免 Mac 用户看到“Ctrl+K”这种自己键盘上找不到的组合。
 * 平台判定统一走 core/utils.js 的 isMacPlatform，设置页的快捷键弹窗复用同一实现。
 */
const IS_MAC = isMacPlatform();
const SHORTCUT = {
  search: IS_MAC ? '⌘K' : 'Ctrl+K',
  searchKbd: IS_MAC ? '⌘ K' : 'Ctrl K',
  send: IS_MAC ? '⌘Enter' : 'Ctrl+Enter'
};

const state = {
  settings: null,
  data: null,
  // 当前隐藏名单，仅用于页脚提示数量，不参与过滤逻辑
  hidden: [],
  favorites: new Set(),
  variables: {},
  recents: [],
  tab: 'snippets',
  platform: 'all',
  snippetCategory: 'all',
  payloadGroup: 'all',
  payloadCategory: 'all',
  query: '',
  favoritesOnly: false,
  limit: 60,
  // 当前页面所处的扩展上下文：'' | 'POPUP' | 'SIDE_PANEL' | 'TAB'
  contextType: '',
  isPopup: false,
  ai: {
    messages: [],
    busy: false,
    controller: null,
    platform: 'all',
    promptGroup: ''
  },
  cyber: {
    providers: [],
    // false = 单选下拉；true = 多选复选框面板
    multi: false,
    query: '',
    page: 1,
    pageSize: 20,
    loading: false,
    results: null,
    pickerOpen: false,
    guideTimer: null,
    // 结果来自上次会话快照时为 true，状态栏会标注“上次查询”，避免误以为是刚查的
    restored: false,
    savedAt: 0
  }
};

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

/**
 * 套用“隐藏名单”。
 * 隐藏只影响面板展示：内置 JSON、自定义数据、收藏记录都不改动，
 * 因此过滤必须集中在数据入口处做一次，搜索 / 分类计数 / 最近常用
 * 都从同一份过滤后的数据推导，避免出现“搜得到但列表里看不到”的错位。
 */
function applyHidden(data, hidden) {
  if (!data || !hidden?.length) return data;
  const hiddenSet = new Set(hidden);
  const snippets = data.snippets.filter((item) => !hiddenSet.has(itemKey(item)));
  const payloads = data.payloads.filter((item) => !hiddenSet.has(itemKey(item)));
  if (snippets.length === data.snippets.length && payloads.length === data.payloads.length) return data;

  return {
    ...data,
    snippets,
    payloads,
    snippetGroups: data.snippetGroups.map((group) => ({
      ...group,
      count: snippets.filter((item) => item.platform === group.platformId).length
    })),
    payloadGroups: data.payloadGroups.map((group) => ({
      ...group,
      count: payloads.filter((item) => item.group === group.group).length
    }))
  };
}

async function loadPanelData(force = false) {
  const [data, hidden] = await Promise.all([loadAll(force), getHidden()]);
  state.hidden = hidden;
  return applyHidden(data, hidden);
}

async function init() {
  // 先判定扩展上下文：popup 需要保持固定尺寸，侧边栏/标签页需要铺满
  state.contextType = await detectContextType();
  state.isPopup = state.contextType === 'POPUP';
  applyContextLayout();

  state.settings = await getSettings();
  applyTheme(state.settings.theme);
  updateThemeButton();

  const [data, favorites, variables, recents, history] = await Promise.all([
    loadPanelData(),
    getFavorites(),
    getVariables(),
    getRecents(),
    getAiHistory()
  ]);

  state.data = data;
  state.favorites = new Set(favorites.map((entry) => (typeof entry === 'string' ? entry : entry.key)).filter(Boolean));
  state.variables = variables;
  state.recents = normalizeRecents(recents);
  state.ai.messages = Array.isArray(history) ? history.slice(-40) : [];
  state.tab = ['snippets', 'payloads', 'cyber', 'ai'].includes(state.settings.ui.defaultTab)
    ? state.settings.ui.defaultTab
    : 'snippets';

  // 平台默认值优先级：上次使用的平台 → 已配置 Key 的平台 → 第一个平台（FOFA）
  const savedCyberProviders = (state.settings.search.lastProviders || [])
    .filter((id) => SEARCH_PROVIDERS.some((provider) => provider.id === id));
  const firstConfigured = SEARCH_PROVIDERS.find((provider) => cyberProviderConfigured(provider.id));
  state.cyber.providers = savedCyberProviders.length
    ? savedCyberProviders
    : [firstConfigured?.id || SEARCH_PROVIDERS[0].id];
  state.cyber.multi = state.cyber.providers.length > 1;
  state.cyber.pageSize = state.settings.search.pageSize;

  // 恢复上次查询会话：语法、平台、页码与结果一并回来，
  // 免得用户点击结果跳转后重开面板还要再查一遍、白耗额度
  const cyberSession = await getCyberSession();
  if (cyberSession) applyCyberSession(cyberSession);

  bindHeader();
  bindSearch();
  bindSnippetFilters();
  bindTabs();
  bindPayloads();
  bindCyber();
  bindAi();
  renderPromptLibrary();
  renderAiProfileSelect();
  updateAiStatus();
  renderAiMessages();

  renderAll();
  switchTab(state.tab, { silent: true });
  await consumePendingSearch();

  // 设置页修改后同步到当前界面
  onStorageChanged((changes) => {
    if (changes[STORAGE_KEYS.settings]) {
      getSettings().then((settings) => {
        const themeChanged = settings.theme !== state.settings.theme;
        state.settings = settings;
        state.cyber.pageSize = settings.search.pageSize;
        if (themeChanged) {
          applyTheme(settings.theme);
          updateThemeButton();
        }
        updateSidePanelButton();
        renderAiProfileSelect();
        updateAiStatus();
        renderAll();
      });
    }
    if (changes[STORAGE_KEYS.custom]) {
      loadPanelData(true).then((data) => {
        state.data = data;
        renderAll();
      });
    }
    // 设置页恢复 / 隐藏条目后，面板同步刷新
    if (changes[STORAGE_KEYS.hidden]) {
      loadPanelData().then((data) => {
        state.data = data;
        renderAll();
      });
    }
    if (changes[STORAGE_KEYS.favorites]) {
      getFavorites().then((list) => {
        state.favorites = new Set(list.map((entry) => (typeof entry === 'string' ? entry : entry.key)));
        renderAll();
      });
    }
    if (changes[STORAGE_KEYS.pendingSearch]) {
      void consumePendingSearch();
    }
  });
}

/**
 * 消费右键菜单传入的待搜索关键词（rb.pendingSearch）：
 * - 面板刚打开时在 init 中读取；
 * - 侧边栏已打开时由 storage 监听触发。
 * 读取后立即删除该键，保证一次性语义。
 */
async function consumePendingSearch() {
  let value = '';
  try {
    const data = await getItems(STORAGE_KEYS.pendingSearch);
    value = data[STORAGE_KEYS.pendingSearch];
  } catch {
    return;
  }
  if (typeof value !== 'string' || !value.trim()) return;
  await removeItems(STORAGE_KEYS.pendingSearch);

  switchTab('snippets', { silent: true });
  const input = $('#search-input');
  input.value = value;
  state.query = value;
  state.limit = 60;
  // 外部（右键菜单）发起的搜索是全新意图：必须清掉旧的平台/类型/收藏筛选，
  // 否则关键词会被上一轮残留的窄范围静默过滤成 0 条，用户以为是没数据
  state.platform = 'all';
  state.payloadGroup = 'all';
  state.snippetCategory = 'all';
  state.payloadCategory = 'all';
  setFavoritesOnly(false, { render: false });
  $('#search-clear').hidden = false;
  resetContentScroll();
  renderAll();
  input.focus();
  input.select();
}

/**
 * 检测当前页面所处的扩展上下文（POPUP / SIDE_PANEL / TAB）。
 * 用 documentUrl 与自身地址（去掉 query）比对，避免多个上下文互相误判。
 * 降级：getContexts 不可用时返回 ''。
 */
async function detectContextType() {
  if (!hasChrome || !chrome.runtime?.getContexts) return '';
  try {
    const base = window.location.href.split('?')[0];
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['TAB', 'POPUP', 'SIDE_PANEL']
    });
    const hit = contexts.find(
      (context) => String(context.documentUrl || '').split('?')[0] === base
    );
    return hit ? hit.contextType : '';
  } catch {
    return '';
  }
}

/**
 * 按上下文切换页面尺寸策略：
 * - POPUP：使用 CSS 默认固定尺寸（420×580）
 * - SIDE_PANEL / TAB：添加 .is-fluid 让 body 铺满可视区域
 * 不能用纯 CSS 媒体查询判断，否则会干扰 Chrome 对 popup 的初始内容测量。
 */
function applyContextLayout() {
  const fluid = state.contextType === 'SIDE_PANEL' || state.contextType === 'TAB';
  document.body.classList.toggle('is-fluid', fluid);
}

/* ------------------------------------------------------------------ */
/* 头部操作                                                            */
/* ------------------------------------------------------------------ */

function bindHeader() {
  $('#btn-options').addEventListener('click', openOptions);

  $('#btn-theme').addEventListener('click', async () => {
    const next = nextTheme(state.settings.theme);
    state.settings = await patchSettings((settings) => ({ ...settings, theme: next }));
    applyTheme(next);
    updateThemeButton();
    toast(`主题：${themeMeta(next).label}`, 'info', 1200);
  });

  const sideButton = $('#btn-sidepanel');
  updateSidePanelButton();
  // 监听器必须无条件绑定：hidden 只控制可见性。
  // 若把绑定放进 if (!hidden) 里，用户在设置页重新开启“侧边栏”开关后，
  // 按钮虽然重新显示了却点不动（初始化时恰好关闭过就会踩中）
  sideButton.addEventListener('click', async () => {
    try {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
      window.close();
    } catch {
      toast('侧边栏打开失败，请确认 Chrome 版本 ≥ 116', 'warn');
    }
  });

  const favButton = $('#btn-favorites');
  favButton.addEventListener('click', () => setFavoritesOnly(!state.favoritesOnly));
  // HTML 中该按钮是空节点，图标与文案必须由这里注入，
  // 否则头部会出现一个看不见却可点击的空白按钮（历史遗漏）
  setFavoritesOnly(state.favoritesOnly, { render: false });

  // 页脚“已隐藏 N 条 · 恢复”直达设置页的内置条目显示分区
  const hiddenLink = $('#footer-hidden');
  if (hiddenLink) hiddenLink.addEventListener('click', () => openOptions('builtin', { onlyHidden: true }));
}

/**
 * 统一设置“只看收藏”状态。
 * 图标的空心/实心星、aria-pressed、title 必须一起变，
 * 任何入口（头部按钮、空状态里的“在全部条目中搜索”）都走这里，
 * 避免出现“状态已关闭但按钮还是高亮”的两套实现。
 */
function setFavoritesOnly(value, { render = true } = {}) {
  state.favoritesOnly = Boolean(value);
  state.limit = 60;

  const button = $('#btn-favorites');
  if (button) {
    button.classList.toggle('is-active', state.favoritesOnly);
    button.setAttribute('aria-pressed', String(state.favoritesOnly));
    button.replaceChildren(icon(state.favoritesOnly ? 'starFilled' : 'star'));
    button.title = state.favoritesOnly ? '取消只看收藏' : '只看收藏';
    button.setAttribute('aria-label', button.title);
  }

  if (render) {
    resetContentScroll();
    renderAll();
  }
}

function updateThemeButton() {
  const button = $('#btn-theme');
  const meta = themeMeta(state.settings.theme);
  button.replaceChildren(icon(meta.icon));
  button.title = `主题：${meta.label}（点击切换）`;
  button.setAttribute('aria-label', button.title);
}

/** 设置页切换“侧边栏”开关后同步按钮可见性 */
function updateSidePanelButton() {
  const button = $('#btn-sidepanel');
  if (!button) return;
  const sidePanelAvailable = hasChrome && Boolean(chrome.sidePanel?.open);
  // 已经在侧边栏内时不再显示“打开侧边栏”按钮
  const inSidePanel = state.contextType === 'SIDE_PANEL';
  button.hidden = !sidePanelAvailable || inSidePanel || state.settings.features.sidePanel === false;
}

/**
 * 打开设置页。
 * @param {string} section 可选分区（general / cyber / ai / data / builtin / import / about）。
 *   openOptionsPage 不支持锚点，需要定位到具体分区时必须直接打开带 hash 的地址，
 *   否则用户会被丢到设置首页，还要自己再找一遍。
 */
/**
 * 打开设置页
 * @param {string} section 可选分区（general / ai / data / builtin / import / about）。
 * @param {object} [options]
 * @param {boolean} [options.onlyHidden] 进入「内置条目显示」时默认勾选“只看已隐藏”，
 *   这样从面板“已隐藏 N 条 · 恢复”跳过来就能直接看到可恢复的条目，而不是全量列表。
 */
function openOptions(section = '', { onlyHidden = false } = {}) {
  const query = onlyHidden ? '?onlyHidden=1' : '';
  if (hasChrome && chrome.runtime?.getURL) {
    const url = `${chrome.runtime.getURL('src/options/options.html')}${query}${section ? `#${section}` : ''}`;
    if (section && chrome.tabs?.create) {
      chrome.tabs.create({ url })
        .catch(() => window.open(url, '_blank', 'noopener'));
      return;
    }
    if (chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }
    window.open(url, '_blank', 'noopener');
    return;
  }
  window.open(`../options/options.html${query}${section ? `#${section}` : ''}`, '_blank', 'noopener');
}

/* ------------------------------------------------------------------ */
/* 搜索                                                                */
/* ------------------------------------------------------------------ */

function bindSearch() {
  const input = $('#search-input');
  const clear = $('#search-clear');

  // 快捷键徽标随平台显示（macOS 为 ⌘ K）
  const kbd = $('.rb-search .rb-kbd');
  if (kbd) kbd.textContent = SHORTCUT.searchKbd;

  const run = debounce((value) => {
    // 只在“从无搜索词变为有搜索词”时重置分类：
    // 用户已经选好平台/类型后再继续输入，不应被逐字清空
    const enteringSearch = !state.query.trim() && Boolean(value.trim());
    state.query = value;
    state.limit = 60;
    if (enteringSearch) {
      // 进入全局搜索时重置分类，避免“搜索无结果”的误解
      state.snippetCategory = 'all';
      state.payloadCategory = 'all';
    }
    resetContentScroll();
    renderAll();
  }, 160);

  input.addEventListener('input', (event) => {
    // 清空按钮即时显隐：等 160ms 防抖再显示的话，
    // 输入完立刻想点清空会点到尚未出现的按钮，反馈明显滞后
    clear.hidden = !event.target.value;
    run(event.target.value);
  });
  input.addEventListener('keydown', (event) => {
    // 中文输入法组词时按 Esc 是“取消这次输入”，此时不应把整个搜索框清空
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      input.value = '';
      clear.hidden = true;
      run('');
      input.blur();
    }
  });

  clear.hidden = true;
  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    run('');
    input.focus();
  });
}

/* ------------------------------------------------------------------ */
/* 标签切换                                                            */
/* ------------------------------------------------------------------ */

function bindTabs() {
  for (const button of $$('.rb-tab')) {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  }

  // ARIA 标签页约定：焦点在标签条内时，左右方向键直接切换标签，
  // 不必先用 Tab 走出内容区再点回来。
  const tablist = $('.rb-tabs');
  tablist.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = $$('.rb-tab');
    const index = tabs.indexOf(document.activeElement);
    if (index === -1 || tabs.length < 2) return;
    event.preventDefault();

    let next = index;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else next = tabs.length - 1;

    switchTab(tabs[next].dataset.tab);
    tabs[next].focus();
  });

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      // AI / 聚合查询标签下搜索栏是隐藏的，直接 focus 会静默失败；先切回语法库
      if (state.tab === 'ai' || state.tab === 'cyber') switchTab('snippets');
      $('#search-input').focus();
      $('#search-input').select();
    }
    if (mod && ['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      switchTab(['snippets', 'payloads', 'cyber', 'ai'][Number(event.key) - 1]);
    }
  });
}

/**
 * 每个标签各自的内容区滚动位置。
 * 三个标签共用同一个 `.rb-content` 滚动容器，切换标签时若不记录，
 * 用户从“语法库”滚动到中段、去 Payload 看一眼再回来，位置就丢了，
 * 需要重新滚动查找——与筛选导航条丢失滚动位置是同一类“操作不连续”问题。
 */
const tabScroll = { snippets: 0, payloads: 0, cyber: 0, ai: 0 };

/**
 * AI 会话区的内部滚动位置。
 * 该面板切走后会变成 display:none，浏览器会把内部容器的滚动位置归零；
 * null 表示还没测量过，首次进入时直接贴底展示最新消息。
 */
let aiScroll = null;

function switchTab(tab, { silent = false } = {}) {
  if (!['snippets', 'payloads', 'cyber', 'ai'].includes(tab)) return;
  const content = $('.rb-content');
  const aiMessages = $('#ai-messages');

  // 用户主动切换标签时收起“复制后去查询”的提示，避免它跨页面停留
  if (state.tab !== tab && !silent) dismissCopyGuide();

  // 先记录离开标签时的纵向位置（隐藏面板后容器内容会变短，位置会被浏览器收敛）
  // 初始渲染时 state.tab 与目标一致，不属于“离开”，记录会把首次贴底覆盖成 0
  if (state.tab !== tab) {
    if (content) tabScroll[state.tab] = content.scrollTop;
    if (state.tab === 'ai' && aiMessages) aiScroll = aiMessages.scrollTop;
  }

  state.tab = tab;

  for (const button of $$('.rb-tab')) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }
  for (const panel of $$('.rb-panel')) {
    panel.hidden = panel.dataset.panel !== tab;
  }

  $('#searchbar').hidden = tab === 'ai' || tab === 'cyber';

  // 切回标签时恢复该标签上次的阅读位置（首次进入为 0）
  if (content) content.scrollTop = tabScroll[tab] || 0;
  // AI 会话区是独立滚动容器，同样需要恢复；首次进入贴底看最新回复
  if (tab === 'ai' && aiMessages) {
    aiMessages.scrollTop = aiScroll ?? aiMessages.scrollHeight;
  }
  if (tab === 'cyber') renderCyber();
  if (!silent && tab === 'ai') $('#ai-input').focus();
  if (!silent && tab === 'cyber') $('#cyber-query').focus();
  renderFooter();
}

/**
 * 把内容区（列表）滚回顶部。
 * 用于筛选条件变化、搜索、切换收藏过滤等“换了一批结果”的场景；
 * 翻页加载更多、切换标签时不要调用，否则会打断阅读位置。
 */
function resetContentScroll() {
  const content = $('.rb-content');
  if (content) content.scrollTop = 0;
  if (tabScroll[state.tab] !== undefined) tabScroll[state.tab] = 0;
}

/* ------------------------------------------------------------------ */
/* 语法库                                                              */
/* ------------------------------------------------------------------ */

/**
 * 平台下拉选项数据。
 * @param {Array|null} hits 有搜索词时传入“命中项”，此时括号内改为各平台的命中数，
 *   避免“搜索有 3 条结果、下拉里仍显示 128”的错位。
 * @param {Array} pool 当前检索池（已叠加“只看收藏”），无搜索词时各平台计数从
 *   这里统计，保证下拉数字与列表条数、页脚条数三个口径完全一致。
 */
function platformOptions(hits, pool) {
  const poolKeys = state.favoritesOnly ? new Set(pool.map(itemKey)) : null;
  const recents = recentItems('snippet')
    .filter((item) => !poolKeys || poolKeys.has(itemKey(item)));
  const recentKeys = new Set(recents.map(itemKey));
  const groups = state.data.snippetGroups.map((group) => ({
    id: group.platformId,
    name: group.name,
    count: (hits || pool).filter((item) => item.platform === group.platformId).length
  }));
  // “全部平台”由 syncFilterSelect 按 allLabel 内置生成，这里只返回其后的条目
  return [
    {
      id: '__recent',
      name: '最近常用',
      count: hits ? hits.filter((item) => recentKeys.has(itemKey(item))).length : recents.length
    },
    ...groups
  ];
}

function renderSnippetFilters() {
  const select = $('#platform-select');
  const query = state.query.trim();
  // 检索池先叠加“只看收藏”，搜索命中与各平台计数都从这里统计；
  // 否则开启收藏过滤后下拉数字仍是全库数量，与列表条数对不上
  const pool = applyFavorites(state.data.snippets);
  const hits = query
    ? searchItems(pool, query, { platformMap: state.data.platformMap })
    : null;
  // 自定义数据重载后，原先选中的平台可能已不存在；syncFilterSelect 会回落到
  // “全部平台”，这里必须把返回值写回 state，否则“下拉显示全部、筛选仍是失效值”
  state.platform = syncFilterSelect(select, platformOptions(hits, pool), {
    allLabel: '全部平台',
    allCount: hits ? hits.length : pool.length,
    value: state.platform
  });

  // 分类选项必须与“搜索 + 平台 + 收藏”后的结果同源，否则数字和列表条数对不上
  const base = applyFavorites(snippetScope());
  const counts = countCategories(base);
  const categories = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ id: name, name, count }));
  const categorySelect = $('#snippet-category-select');
  // 分类同样可能因数据重载而消失，落在不存在的分类上会得到空列表
  state.snippetCategory = syncFilterSelect(categorySelect, categories, {
    allLabel: '全部分类',
    value: state.snippetCategory
  });
  // 只有一个分类时二级筛选没有意义，隐藏整个下拉（连同“分类”标签）
  categorySelect.closest('.rb-select-wrap').hidden = categories.length < 2;
}

function renderSnippets() {
  renderSnippetFilters();
  renderSnippetList();
  renderFooter();
}

function snippetBase() {
  if (state.platform === '__recent') return recentItems('snippet');
  if (state.platform === 'all') return state.data.snippets;
  return state.data.snippets.filter((item) => item.platform === state.platform);
}

/**
 * 语法库检索池：搜索词与平台筛选叠加（平台 → 搜索，而不是二选一）。
 * 搜索时如果丢掉平台筛选去搜全库，切换平台会“毫无反应”，
 * 明明选了平台却冒出其他平台的结果，属于明显的行为不一致。
 */
function snippetScope() {
  const base = snippetBase();
  if (!state.query.trim()) return base;
  return searchItems(base, state.query, { platformMap: state.data.platformMap });
}

/**
 * “只看收藏”过滤，语法库与 Payload 共用。
 * 所有计数（平台下拉、类型下拉、分类下拉、最近）都必须先过这一层，
 * 否则收藏过滤开启时数字仍是全库口径，与列表条数、页脚条数三处打架。
 */
function applyFavorites(list) {
  if (!state.favoritesOnly) return list;
  return list.filter((item) => state.favorites.has(itemKey(item)));
}

function visibleSnippets() {
  return applyFavorites(filterByCategory(snippetScope(), state.snippetCategory));
}

function renderSnippetList() {
  const list = visibleSnippets();
  const holder = $('#snippet-list');
  holder.replaceChildren();

  if (!list.length) {
    holder.appendChild(emptyResult('snippet'));
    return;
  }

  const shown = list.slice(0, state.limit);
  const fragment = document.createDocumentFragment();
  for (const item of shown) fragment.appendChild(buildCard(item));
  holder.appendChild(fragment);

  if (list.length > shown.length) {
    appendLoadMore(holder, list.length - shown.length, () => {
      state.limit += 60;
      renderSnippetList();
    });
  }
}

/** 语法库两个筛选下拉：换平台时清空分类，避免“平台 A 的分类套在平台 B 上” */
function bindSnippetFilters() {
  $('#platform-select').addEventListener('change', (event) => {
    state.platform = event.target.value;
    state.snippetCategory = 'all';
    state.limit = 60;
    resetContentScroll();
    renderSnippets();
  });
  $('#snippet-category-select').addEventListener('change', (event) => {
    state.snippetCategory = event.target.value;
    state.limit = 60;
    resetContentScroll();
    renderSnippets();
  });
  $('#btn-add-snippet')?.addEventListener('click', () => quickAddItem('snippet'));
}

/**
 * 面板内就地新增条目。
 * 直接复用设置页的条目表单；提交成功后主动重载数据并重渲染，
 * 不依赖 storage 变更事件（普通网页预览没有 chrome.storage.onChanged）。
 */
async function quickAddItem(defaultKind) {
  if (!state.data) {
    toast('内置数据尚未加载完成，请稍后再试', 'warn');
    return;
  }
  const custom = await getCustom();
  openItemDialog({
    data: state.data,
    custom: custom.items || [],
    customPlatforms: custom.platforms || [],
    settings: state.settings,
    commit: async (next) => {
      const ok = Boolean(await setCustom(next));
      if (!ok) return false;
      state.data = await loadPanelData(true);
      renderAll();
      return true;
    },
    compact: true,
    defaultKind
  });
}

/** 面板内编辑自定义条目：与新增共用表单，提交后重载数据 */
async function handleEditItem(item) {
  const custom = await getCustom();
  openItemDialog({
    item,
    data: state.data,
    custom: custom.items || [],
    customPlatforms: custom.platforms || [],
    settings: state.settings,
    commit: async (next) => {
      const ok = Boolean(await setCustom(next));
      if (!ok) return false;
      state.data = await loadPanelData(true);
      renderAll();
      return true;
    },
    compact: true
  });
}

/** 面板内删除自定义条目：确认后写回 rb.custom，并移除对应收藏 */
async function handleDeleteItem(item) {
  const ok = await confirmDialog({
    title: '删除自定义条目',
    message: `确定删除「${item.title || '未命名条目'}」吗？删除后不可恢复。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  const custom = await getCustom();
  const items = (custom.items || []).filter((entry) => !(entry.id === item.id && entry.kind === item.kind));
  if (!(await setCustom({ platforms: custom.platforms || [], items }))) {
    toast('删除失败，请重试', 'error');
    return;
  }

  // 收藏按 kind:id 记录，条目删除后同步清掉，避免收藏计数虚高
  const key = itemKey(item);
  if (state.favorites.has(key)) {
    state.favorites.delete(key);
    await setFavorites([...state.favorites]);
  }

  state.data = await loadPanelData(true);
  renderAll();
  toast('条目已删除', 'success');
}

/**
 * 面板内隐藏内置条目。
 * 只写入 rb.hidden，内置 JSON 与自定义数据都不动，设置页可随时恢复。
 * 写入串行执行：连续快速点多个眼睛图标时，后一次必须基于前一次写入后的名单，
 * 否则两次“读-改-写”并发会互相覆盖，导致只生效一条。
 */
let hiddenWriteQueue = Promise.resolve();

function handleHideItem(item) {
  const key = itemKey(item);
  const run = async () => {
    let hidden;
    try {
      hidden = await getHidden();
      if (hidden.includes(key)) return;
      await setHidden([...hidden, key]);
    } catch {
      toast('隐藏失败，请重试', 'error');
      return;
    }

    state.data = applyHidden(state.data, [...hidden, key]);
    state.hidden = [...hidden, key];
    renderAll();
    toast(`已隐藏 ${state.hidden.length} 条，点底部「已隐藏」可恢复`, 'success');
  };
  hiddenWriteQueue = hiddenWriteQueue.then(run, run);
  return hiddenWriteQueue;
}

/* ------------------------------------------------------------------ */
/* Payload                                                             */
/* ------------------------------------------------------------------ */

function bindPayloads() {
  $('#payload-group').addEventListener('change', (event) => {
    state.payloadGroup = event.target.value;
    state.payloadCategory = 'all';
    state.limit = 60;
    resetContentScroll();
    renderPayloads();
  });
  $('#payload-category-select').addEventListener('change', (event) => {
    state.payloadCategory = event.target.value;
    state.limit = 60;
    resetContentScroll();
    renderPayloads();
  });
  $('#btn-add-payload')?.addEventListener('click', () => quickAddItem('payload'));
}

/**
 * 类型下拉。
 * @param {Array|null} hits 有搜索词时的命中项，用于把括号内的数字换成命中数，
 *   与下方分类下拉、列表条数保持同一口径。
 * @param {Array} pool 当前检索池（已叠加“只看收藏”），无搜索词时从这里统计。
 */
function renderPayloadGroupSelect(hits, pool) {
  const recentPool = applyFavorites(recentItems('payload'));
  const recentKeys = new Set(recentPool.map(itemKey));
  const recentHits = hits
    ? hits.filter((item) => recentKeys.has(itemKey(item))).length
    : recentPool.length;
  const options = [
    { id: '__recent', name: '最近常用', count: recentHits },
    ...state.data.payloadGroups.map((group) => ({
      id: group.group,
      name: group.group,
      count: (hits || pool).filter((item) => item.group === group.group).length
    }))
  ];
  // 自定义数据重载后，原先选中的类型可能已不存在，syncFilterSelect 会回落到
  // “全部类型”，返回值必须写回 state，否则下拉显示全部但筛选仍是失效值
  state.payloadGroup = syncFilterSelect($('#payload-group'), options, {
    allLabel: '全部类型',
    allCount: hits ? hits.length : pool.length,
    value: state.payloadGroup
  });
}

function payloadBase() {
  if (state.payloadGroup === '__recent') return recentItems('payload');
  if (state.payloadGroup === 'all') return state.data.payloads;
  return state.data.payloads.filter((item) => item.group === state.payloadGroup);
}

/** Payload 检索池：搜索词与类型筛选叠加，规则同 snippetScope() */
function payloadScope() {
  const base = payloadBase();
  if (!state.query.trim()) return base;
  return searchItems(base, state.query, { platformMap: state.data.platformMap });
}

function visiblePayloads() {
  return applyFavorites(filterByCategory(payloadScope(), state.payloadCategory));
}

function renderPayloads() {
  const query = state.query.trim();
  // 与语法库同规则：检索池先叠加“只看收藏”，命中数与计数都同源
  const pool = applyFavorites(state.data.payloads);
  const hits = query
    ? searchItems(pool, query, { platformMap: state.data.platformMap })
    : null;
  renderPayloadGroupSelect(hits, pool);

  // 分类选项与“搜索 + 类型 + 收藏”后的结果同源
  const counts = countCategories(applyFavorites(payloadScope()));
  const categories = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ id: name, name, count }));
  const categorySelect = $('#payload-category-select');
  // 与语法分类同规则：分类下拉失效时回落“全部分类”，返回值写回 state
  state.payloadCategory = syncFilterSelect(categorySelect, categories, {
    allLabel: '全部分类',
    value: state.payloadCategory
  });
  categorySelect.closest('.rb-select-wrap').hidden = categories.length < 2;

  const list = visiblePayloads();
  const holder = $('#payload-list');
  holder.replaceChildren();

  if (!list.length) {
    holder.appendChild(emptyResult('payload'));
    renderFooter();
    return;
  }

  const shown = list.slice(0, state.limit);
  const fragment = document.createDocumentFragment();
  for (const item of shown) fragment.appendChild(buildCard(item));
  holder.appendChild(fragment);

  if (list.length > shown.length) {
    appendLoadMore(holder, list.length - shown.length, () => {
      state.limit += 60;
      renderPayloads();
    });
  }

  renderFooter();
}

/* ------------------------------------------------------------------ */
/* 列表共用                                                            */
/* ------------------------------------------------------------------ */

function buildCard(item) {
  return itemCard(item, {
    platformMap: state.data.platformMap,
    favorite: state.favorites.has(itemKey(item)),
    showDesc: state.settings.ui.showDesc,
    showRisk: state.settings.ui.showRiskBadges,
    onCopy: handleCopy,
    // 只有条目标注了建议文件名（item.file）才出现「存为文件」，避免每张卡片都挤图标
    onDownload: item.file ? handleDownload : null,
    onToggleFavorite: handleToggleFavorite,
    // 自定义条目支持在面板内直接编辑 / 删除；内置条目只提供“隐藏”，不改数据
    onEdit: item.custom ? handleEditItem : null,
    onDelete: item.custom ? handleDeleteItem : null,
    onHide: item.custom ? null : handleHideItem
  });
}

/**
 * 追加“加载更多”按钮（语法库与 Payload 列表共用）。
 * 点击后列表会整体重建，原按钮被替换，焦点会掉到 body；
 * 这里在重建后把焦点交还给新的“加载更多”（已加载完则交给最后一张卡片的复制按钮），
 * 键盘用户可以连续按 Enter 继续翻页，不必从头 Tab 一遍。
 */
function appendLoadMore(holder, remaining, onMore) {
  const more = el('button', {
    className: 'rb-btn rb-btn--ghost rb-load-more',
    text: `加载更多（剩余 ${remaining} 条）`,
    attrs: { type: 'button' }
  });
  more.addEventListener('click', () => {
    onMore();
    const target = holder.querySelector('.rb-load-more')
      || holder.querySelector('.rb-card:last-child .rb-btn--primary');
    target?.focus({ preventScroll: true });
  });
  holder.appendChild(more);
}

function emptyResult(kind) {
  const query = state.query.trim();

  if (state.favoritesOnly) {
    if (!state.favorites.size) {
      return emptyState({
        iconName: 'star',
        title: '还没有收藏',
        desc: '点击条目右上角的星标即可收藏，常用语法会在所有设备本地保留。'
      });
    }

    // 收藏 + 搜索叠加时，列表为空说明“收藏里没有关键词”，
    // 只提示切换筛选等于让用户逐个平台猜，必须给一个明确的放宽动作
    if (query) {
      const widen = el('button', {
        className: 'rb-btn rb-btn--primary rb-btn--sm',
        text: '在全部条目中搜索',
        attrs: { type: 'button' }
      });
      widen.addEventListener('click', () => setFavoritesOnly(false));
      return emptyState({
        iconName: 'star',
        title: '收藏中没有匹配',
        desc: `“${query}”在收藏范围内没有命中，可放开到全部条目再试。`,
        action: widen
      });
    }

    return emptyState({
      iconName: 'star',
      title: '当前筛选下没有收藏',
      desc: '收藏的条目可能在其他平台或分类，试试切换筛选条件，或关闭“只看收藏”。'
    });
  }

  if (query) {
    const narrowed = kind === 'payload'
      ? state.payloadGroup !== 'all'
      : state.platform !== 'all';

    // 搜索是在已选平台/类型内执行的，没有命中时最该给的是“放宽范围”，
    // 而不是让用户自己意识到要先去点“全部平台”。
    if (narrowed) {
      const scopeName = kind === 'payload'
        ? (state.payloadGroup === '__recent' ? '最近常用' : state.payloadGroup)
        : (state.platform === '__recent'
          ? '最近常用'
          : state.data.platformMap.get(state.platform)?.name || '当前平台');
      const widen = el('button', {
        className: 'rb-btn rb-btn--primary rb-btn--sm',
        text: '在全库中搜索',
        attrs: { type: 'button' }
      });
      widen.addEventListener('click', () => {
        state.limit = 60;
        if (kind === 'payload') {
          state.payloadGroup = 'all';
          state.payloadCategory = 'all';
          renderPayloads();
        } else {
          state.platform = 'all';
          state.snippetCategory = 'all';
          renderSnippets();
        }
        resetContentScroll();
      });
      return emptyState({
        iconName: 'search',
        title: `「${scopeName}」中没有匹配`,
        desc: `“${query}”在${scopeName}范围内没有命中，可放宽到全库再试，或换个关键词。`,
        action: widen
      });
    }

    const action = el('button', {
      className: 'rb-btn rb-btn--primary rb-btn--sm',
      text: '用 AI 生成',
      attrs: { type: 'button' }
    });
    action.addEventListener('click', () => {
      switchTab('ai');
      const input = $('#ai-input');
      input.value = `帮我生成与“${query}”相关的语法或 Payload`;
      input.focus();
      input.dispatchEvent(new Event('input'));
    });
    return emptyState({
      iconName: 'search',
      title: '没有匹配的条目',
      desc: `换个关键词试试，或使用 AI 助手生成“${query}”对应的语法。`,
      action
    });
  }

  // “最近”为空与平台/分类为空是两种场景，文案要分开，避免误导
  const recentEmpty = kind === 'payload'
    ? state.payloadGroup === '__recent'
    : state.platform === '__recent';
  if (recentEmpty) {
    return emptyState({
      iconName: kind === 'payload' ? 'shield' : 'book',
      title: '还没有最近使用',
      desc: '复制任意条目后会自动出现在这里，复制次数越多排名越靠前。'
    });
  }

  if (kind === 'payload') {
    return emptyState({
      iconName: 'shield',
      title: state.payloadCategory === 'all' ? '该类型暂无 Payload' : '该分类暂无 Payload',
      desc: '可以在设置页添加自定义条目，或导入配置文件。'
    });
  }
  return emptyState({
    iconName: 'book',
    title: state.snippetCategory === 'all' ? '该平台暂无语法' : '该分类暂无语法',
    desc: '可以在设置页添加自定义条目，或导入配置文件。'
  });
}

async function handleCopy(item) {
  const ok = await copyWithVariables(item, {
    settings: state.settings,
    variables: state.variables,
    onRemember: async (filled) => {
      state.variables = { ...state.variables, ...filled };
      await setVariables(state.variables);
    }
  });
  if (!ok) return;

  await rememberRecent(item);

  // 复制语法后提供“一站式查询”入口；提示出现时暂不自动关闭弹窗，
  // 否则用户还没来得及点击就被关掉了
  const showGuide = maybeShowCopyGuide(item);
  if (state.isPopup && state.settings.ui.closeAfterCopy && !showGuide) {
    setTimeout(() => window.close(), 520);
  }
}

/**
 * 「存为文件」：与复制共用同一套变量填写流程，填完直接下载成可上传的成品文件。
 * 不触发 closeAfterCopy —— 用户通常要连续取多个样本，留在面板里更方便；
 * 变量同样会记忆，避免同一个域名反复输入。
 */
async function handleDownload(item) {
  const ok = await downloadWithVariables(item, {
    variables: state.variables,
    onRemember: async (filled) => {
      state.variables = { ...state.variables, ...filled };
      await setVariables(state.variables);
    }
  });
  if (!ok) return;
  await rememberRecent(item);
}

async function handleToggleFavorite(item) {
  const key = itemKey(item);
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.add(key);
  await setFavorites(Array.from(state.favorites));

  if (state.favoritesOnly) {
    renderAll();
    // 取消收藏后卡片会被整张移除，焦点若还留在已删除的节点上就会掉到 body，
    // 键盘用户得重新 Tab 很多次才能回到列表。这里主动把焦点交给
    // 重新渲染后的第一个星标按钮；列表空了则回到头部“只看收藏”按钮
    // 用 data-action 精确定位星标：操作区里还有「存为文件」按钮，不能靠「第一个 ghost」猜
    const target = document.querySelector('.rb-panel:not([hidden]) .rb-card-actions [data-action="favorite"]')
      || $('#btn-favorites');
    target?.focus({ preventScroll: true });
    return;
  }

  updateFavoriteButton(key);
}

function updateFavoriteButton(key) {
  const card = document.querySelector(`.rb-card[data-key="${cssEscape(key)}"]`);
  if (!card) return;
  // 只取卡片操作区的星标，避免命中卡片内其他 ghost 按钮（如「存为文件」）
  const button = card.querySelector('.rb-card-actions [data-action="favorite"]');
  if (!button) return;
  const favorite = state.favorites.has(key);
  button.classList.toggle('is-favorite', favorite);
  button.replaceChildren(icon(favorite ? 'starFilled' : 'star'));
  button.title = favorite ? '取消收藏' : '收藏';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(favorite));
}

/** CSS 属性选择器转义，避免条目 ID 中的特殊字符破坏选择器 */
function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

async function rememberRecent(item) {
  const key = itemKey(item);
  const now = Date.now();
  const entry = state.recents.find((record) => record.key === key);
  if (entry) {
    // 命中已有记录：次数累加，刷新最近使用时间，复制越多的条目排名越靠前
    entry.count += 1;
    entry.lastUsed = now;
  } else {
    state.recents.push({ key, count: 1, lastUsed: now });
  }
  state.recents.sort(compareRecents);
  state.recents = state.recents.slice(0, Math.max(5, Number(state.settings.ui.recentsLimit) || 20));
  await setRecents(state.recents);
  syncRecentOption(item.kind);
}

/**
 * 复制后只更新“最近”选项的条数。
 * 不重跑 renderSnippetFilters：整块重建会打断正在进行的操作，
 * 也会让列表滚动位置变化。Payload 的“最近使用”由列表渲染自然收敛。
 */
function syncRecentOption(kind) {
  if (kind !== 'snippet') return;
  // 搜索中下拉里显示的是“命中数”而非全库数量，这里直接跳过，
  // 下一次渲染会按新的最近列表重新计算，避免把命中数覆盖成总数。
  if (state.query.trim()) return;
  const select = $('#platform-select');
  const option = select.querySelector('option[value="__recent"]');
  if (!option) return;
  option.textContent = `最近常用（${recentCount('snippet')}）`;
  // 选项文本已手动更新，清掉签名让下一次渲染重建一次，
  // 避免签名与实际选项内容不同步（否则会被误判为“无需更新”）
  delete select.dataset.optionSignature;
}

function recentCount(kind) {
  // 开启“只看收藏”时，最近入口的计数同样只统计收藏项
  return applyFavorites(recentItems(kind)).length;
}

function recentItems(kind) {
  const map = new Map();
  for (const item of [...state.data.snippets, ...state.data.payloads]) {
    map.set(itemKey(item), item);
  }
  const list = state.recents
    .map((entry) => map.get(entry.key))
    .filter((item) => item && item.kind === kind);
  return Array.from(new Map(list.map((item) => [itemKey(item), item])).values());
}

/* ------------------------------------------------------------------ */
/* 聚合查询                                                            */
/* ------------------------------------------------------------------ */

function cyberProviderConfigured(providerId) {
  return Boolean(String(state.settings?.search?.providers?.[providerId]?.apiKey || '').trim());
}

function cyberSelectedProviders() {
  return SEARCH_PROVIDERS.filter((provider) => state.cyber.providers.includes(provider.id));
}

function formatCyberCount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString('zh-CN') : '0';
}

/** 与后台通信：后台统一读取密钥并发起请求，面板不接触 Key 值 */
function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    if (!hasChrome || !chrome.runtime?.sendMessage) {
      reject(new Error('聚合查询需要在扩展环境中运行'));
      return;
    }
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || '后台通信失败'));
        return;
      }
      resolve(response);
    });
  });
}

function bindCyber() {
  const form = $('#cyber-form');
  const input = $('#cyber-query');
  const pickerButton = $('#cyber-providers-btn');
  if (!form || !input || !pickerButton) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void runCyberSearch({ page: 1 });
  });

  input.addEventListener('input', () => {
    state.cyber.query = input.value;
    updateCyberControls();
  });

  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void runCyberSearch({ page: 1 });
    }
  });

  $('#cyber-page-size').addEventListener('change', (event) => {
    const size = SEARCH_PAGE_SIZES.includes(Number(event.target.value))
      ? Number(event.target.value)
      : 20;
    state.cyber.pageSize = size;
    patchSettings((draft) => {
      draft.search.pageSize = size;
    }).then((settings) => {
      state.settings = settings;
    }).catch(() => {});
  });

  pickerButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleCyberPicker();
  });

  const providerSelect = $('#cyber-provider-select');
  if (providerSelect) {
    providerSelect.addEventListener('change', (event) => {
      const id = String(event.target.value || '');
      if (!SEARCH_PROVIDERS.some((provider) => provider.id === id)) return;
      state.cyber.providers = [id];
      persistCyberProviders();
      updateCyberControls();
    });
  }

  const modeButton = $('#cyber-mode-btn');
  if (modeButton) {
    modeButton.addEventListener('click', () => setCyberMode(!state.cyber.multi));
  }

  const copyAllButton = $('#cyber-copy-all');
  if (copyAllButton) copyAllButton.addEventListener('click', () => { void copyAllCyberItems(); });

  const exportButton = $('#cyber-export');
  if (exportButton) exportButton.addEventListener('click', () => exportCyberResults());

  // 点击选择面板外部时收起；选择面板本身不关闭，方便连续勾选多个平台
  document.addEventListener('click', (event) => {
    if (!state.cyber.pickerOpen) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('.rb-cyber-picker')) return;
    toggleCyberPicker(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.cyber.pickerOpen) return;
    toggleCyberPicker(false);
    pickerButton.focus();
  });

  updateCyberControls();
}

function toggleCyberPicker(force) {
  // 单选模式没有复选框面板，避免按钮误开空浮层
  if (!state.cyber.multi) return;
  const open = typeof force === 'boolean' ? force : !state.cyber.pickerOpen;
  state.cyber.pickerOpen = open;
  const pop = $('#cyber-providers-pop');
  const button = $('#cyber-providers-btn');
  if (!pop || !button) return;
  if (open) renderCyberPicker();
  pop.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

/**
 * 切换单选 / 多选模式。
 * 单选是常用场景（大多数人只配了一两个平台），多选才展开复选框面板；
 * 切回单选时保留排序后的第一个平台，保证状态始终有效。
 */
function setCyberMode(multi) {
  state.cyber.multi = Boolean(multi);
  if (!state.cyber.multi) {
    const first = cyberSelectedProviders()[0] || SEARCH_PROVIDERS[0];
    state.cyber.providers = [first.id];
    persistCyberProviders();

    // 单选模式下复选框浮层必须收起
    state.cyber.pickerOpen = false;
    const pop = $('#cyber-providers-pop');
    const button = $('#cyber-providers-btn');
    if (pop) pop.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }
  updateCyberControls();
}

/** 单选下拉：选项标注是否已配置 Key，配置状态变化时才重建 */
function syncCyberProviderSelect(selected) {
  const select = $('#cyber-provider-select');
  if (!select) return;

  const signature = SEARCH_PROVIDERS
    .map((provider) => `${provider.id}:${cyberProviderConfigured(provider.id) ? 1 : 0}`)
    .join(',');
  if (select.dataset.signature !== signature) {
    select.replaceChildren(...SEARCH_PROVIDERS.map((provider) => el('option', {
      attrs: { value: provider.id },
      text: cyberProviderConfigured(provider.id)
        ? provider.name
        : `${provider.name} · 未配置`
    })));
    select.dataset.signature = signature;
  }

  const current = selected[0]?.id || SEARCH_PROVIDERS[0].id;
  if (select.value !== current) select.value = current;
  select.disabled = state.cyber.loading;
  select.hidden = state.cyber.multi;
}

function renderCyberPicker() {
  const pop = $('#cyber-providers-pop');
  if (!pop) return;

  const rows = SEARCH_PROVIDERS.map((provider) => {
    const checkbox = el('input', {
      attrs: { type: 'checkbox', value: provider.id, 'aria-label': provider.name }
    });
    checkbox.checked = state.cyber.providers.includes(provider.id);
    checkbox.addEventListener('change', () => {
      updateCyberProviderSelection(provider.id, checkbox.checked);
      checkbox.checked = state.cyber.providers.includes(provider.id);
    });

    const stateNode = el('span', {
      className: `rb-cyber-option-state${cyberProviderConfigured(provider.id) ? '' : ' is-missing'}`,
      text: cyberProviderConfigured(provider.id) ? '已配置' : '未配置',
      dataset: { provider: provider.id }
    });

    const row = el('label', { className: 'rb-cyber-option' }, [
      checkbox,
      el('span', {
        className: 'rb-cyber-dot',
        style: { '--rb-dot-color': provider.color }
      }),
      el('span', { className: 'rb-cyber-option-main' }, [
        el('span', { className: 'rb-cyber-option-name', text: provider.name }),
        el('span', { className: 'rb-cyber-option-sub', text: provider.vendor })
      ]),
      stateNode
    ]);
    return row;
  });

  pop.replaceChildren(...rows);
}

function updateCyberProviderSelection(providerId, checked) {
  if (checked) {
    if (!state.cyber.providers.includes(providerId)) state.cyber.providers.push(providerId);
  } else {
    state.cyber.providers = state.cyber.providers.filter((id) => id !== providerId);
    if (!state.cyber.providers.length) {
      // 至少保留一个平台，否则查询按钮会变成永远无效的空操作
      state.cyber.providers = [providerId];
      toast('至少保留一个查询平台', 'warn');
    }
  }
  state.cyber.providers = SEARCH_PROVIDERS
    .map((provider) => provider.id)
    .filter((id) => state.cyber.providers.includes(id));
  persistCyberProviders();
  updateCyberControls();
}

function persistCyberProviders() {
  const list = [...state.cyber.providers];
  patchSettings((draft) => {
    draft.search.lastProviders = list;
  }).then((settings) => {
    state.settings = settings;
  }).catch(() => {});
}

function updateCyberControls() {
  const selected = cyberSelectedProviders();
  const text = $('#cyber-providers-text');
  if (text) {
    text.textContent = selected.length > 2
      ? `${selected.slice(0, 2).map((provider) => provider.name).join('、')} 等 ${selected.length} 个`
      : selected.map((provider) => provider.name).join('、') || '选择平台';
  }

  const input = $('#cyber-query');
  if (input) input.placeholder = selected[0]?.placeholder || 'domain="example.com"';

  const size = $('#cyber-page-size');
  if (size) {
    size.value = String(state.cyber.pageSize);
    size.disabled = state.cyber.loading;
  }

  const picker = $('#cyber-providers-btn');
  if (picker) {
    picker.disabled = state.cyber.loading;
    picker.hidden = !state.cyber.multi;
  }

  const modeButton = $('#cyber-mode-btn');
  if (modeButton) {
    modeButton.textContent = state.cyber.multi ? '单选' : '多选';
    modeButton.setAttribute('aria-pressed', String(state.cyber.multi));
    modeButton.disabled = state.cyber.loading;
  }

  syncCyberProviderSelect(selected);

  const submit = $('#cyber-submit');
  if (submit) {
    submit.disabled = state.cyber.loading
      || !selected.length
      || !String(input?.value || '').trim()
      || state.settings?.search?.enabled === false;
  }

  // 配置状态徽标随设置页保存的 Key 实时更新，不必等到下次打开下拉
  for (const node of $$('#cyber-providers-pop [data-provider]')) {
    const configured = cyberProviderConfigured(node.dataset.provider);
    node.textContent = configured ? '已配置' : '未配置';
    node.classList.toggle('is-missing', !configured);
  }
}

function renderCyberNotice() {
  const holder = $('#cyber-notice');
  if (!holder) return;

  const disabled = state.settings?.search?.enabled === false;
  const configured = SEARCH_PROVIDERS.filter((provider) => cyberProviderConfigured(provider.id)).length;
  let text = '';
  if (disabled) {
    text = '聚合查询已在设置中关闭，当前不会向任何平台发起请求。';
  } else if (!configured) {
    text = '尚未配置测绘平台 API Key。前往设置填入密钥后，即可在这里直接搜索资产。';
  }

  holder.hidden = !text;
  if (!text) {
    holder.replaceChildren();
    return;
  }

  const action = el('button', {
    className: 'rb-btn rb-btn--primary rb-btn--sm',
    text: disabled ? '去开启' : '去配置',
    attrs: { type: 'button' }
  });
  action.addEventListener('click', () => openOptions('cyber'));

  holder.replaceChildren(
    el('span', { className: 'rb-cyber-notice-text', text }),
    action
  );
}

function renderCyberStatus() {
  const node = $('#cyber-status');
  if (!node) return;

  const count = cyberSelectedProviders().length;
  if (state.cyber.loading) {
    node.dataset.state = 'loading';
    node.textContent = `正在查询 ${count} 个平台，请稍候…`;
    return;
  }

  const data = state.cyber.results;
  if (!data) {
    node.dataset.state = '';
    node.textContent = state.cyber.providers.some((id) => cyberProviderConfigured(id))
      ? '输入语法后开始查询，可同时检索多个平台。'
      : '';
    return;
  }

  if (data.error) {
    node.dataset.state = 'error';
    node.textContent = data.error;
    return;
  }

  node.dataset.state = '';
  const groups = Array.isArray(data.results) ? data.results : [];
  const success = groups.filter((group) => group.ok);
  const failed = groups.length - success.length;
  const summary = success.map((group) => {
    const provider = getSearchProvider(group.provider);
    return `${provider?.name || group.provider} ${formatCyberCount(group.total)} 条`;
  });
  const prefix = state.cyber.restored ? `上次查询（${formatSessionStamp(state.cyber.savedAt)}）：` : '查询完成：';
  node.textContent = `${summary.length ? `${prefix}${summary.join(' · ')}` : `${prefix}没有平台返回结果`}${
    failed ? ` · ${failed} 个平台失败` : ''
  }`;
}

async function runCyberSearch({ page = 1 } = {}) {
  if (state.cyber.loading) return;

  const input = $('#cyber-query');
  const query = String(input?.value || '').trim();
  if (!query) {
    toast('请输入查询语法', 'warn');
    input?.focus();
    return;
  }
  if (state.settings?.search?.enabled === false) {
    toast('聚合查询已在设置中关闭', 'warn');
    return;
  }

  const providers = state.cyber.providers.filter((id) => SEARCH_PROVIDERS.some((provider) => provider.id === id));
  if (!providers.length) {
    toast('请至少选择一个查询平台', 'warn');
    return;
  }

  state.cyber.query = query;
  state.cyber.page = Math.max(1, Number(page) || 1);
  state.cyber.loading = true;
  state.cyber.results = null;
  renderCyber();

  try {
    const response = await sendRuntimeMessage({
      type: 'rb:cyber-search',
      query,
      providers,
      page: state.cyber.page,
      size: state.cyber.pageSize
    });
    if (!response || response.ok === false) {
      throw new Error(response?.error || '查询失败');
    }
    state.cyber.results = response;
    state.cyber.page = response.page || state.cyber.page;
    if (response.size) state.cyber.pageSize = response.size;
    state.cyber.restored = false;
    // 落一份快照：popup 关闭后重新打开仍能看到这批结果，不必重复查询
    void saveCyberSession();
  } catch (error) {
    state.cyber.results = {
      error: error?.message || '查询失败，请稍后重试',
      results: []
    };
  } finally {
    state.cyber.loading = false;
    renderCyber();
    const holder = $('#cyber-results');
    if (holder) holder.scrollTop = 0;
  }
}

/** 把会话快照套用到当前状态（语法、平台、页码、结果） */
function applyCyberSession(session) {
  if (!session) return;
  const providers = session.providers.filter((id) => SEARCH_PROVIDERS.some((provider) => provider.id === id));
  if (!providers.length) return;
  state.cyber.query = session.query;
  state.cyber.providers = providers;
  state.cyber.multi = providers.length > 1;
  state.cyber.page = session.page || 1;
  if (SEARCH_PAGE_SIZES.includes(session.pageSize)) state.cyber.pageSize = session.pageSize;
  state.cyber.savedAt = session.savedAt || 0;

  const input = $('#cyber-query');
  if (input) input.value = session.query;

  if (session.results?.length) {
    state.cyber.results = {
      ok: true,
      page: state.cyber.page,
      size: state.cyber.pageSize,
      results: session.results
    };
    state.cyber.restored = true;
  }
}

/** 保存当前查询快照；失败时静默（不影响查询结果展示） */
async function saveCyberSession() {
  const data = state.cyber.results;
  if (!data || data.error) return;
  try {
    const saved = await setCyberSession({
      query: state.cyber.query,
      providers: state.cyber.providers,
      page: state.cyber.page,
      pageSize: state.cyber.pageSize,
      results: Array.isArray(data.results) ? data.results : [],
      savedAt: Date.now()
    });
    if (saved) state.cyber.savedAt = saved.savedAt;
  } catch {
    /* 存储失败不影响本次查询 */
  }
}

/** 两位补零，时间标注与导出文件名共用 */
const pad2 = (value) => String(value).padStart(2, '0');

/** “MM-DD HH:mm”时间戳，用于标注恢复的结果来自上次查询 */
function formatSessionStamp(time) {
  const date = new Date(Number(time) || Date.now());
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function renderCyber() {
  updateCyberControls();
  updateCyberActions();
  renderCyberNotice();
  // 面板隐藏时不必重建结果 DOM：语法库每次输入都会触发 renderAll，
  // 无谓地重建几十条结果会让输入变卡
  if (state.tab !== 'cyber') return;
  renderCyberStatus();
  renderCyberResults();
  renderCyberPager();
}

/** 结果批量操作（复制全部 / 导出）只在有成功条目时出现 */
function updateCyberActions() {
  const holder = $('#cyber-actions');
  if (!holder) return;
  holder.hidden = !cyberHasItems();
}

/** 当前结果里成功平台的全部条目（未去重） */
function collectCyberItems() {
  const groups = state.cyber.results?.results;
  if (!Array.isArray(groups)) return [];
  const items = [];
  for (const group of groups) {
    if (!group?.ok || !Array.isArray(group.items)) continue;
    for (const item of group.items) {
      if (item) items.push(item);
    }
  }
  return items;
}

function cyberHasItems() {
  if (state.cyber.loading) return false;
  const data = state.cyber.results;
  if (!data || data.error) return false;
  return collectCyberItems().length > 0;
}

/** 资产地址：优先页面地址，其次 IP:端口 */
function cyberItemAddress(item) {
  return item?.url || (item?.ip ? `${item.ip}${item.port ? `:${item.port}` : ''}` : '');
}

/** 复制当前结果的全部资产地址：每行一条并去重，方便直接喂给扫描器或脚本 */
async function copyAllCyberItems() {
  const addresses = [...new Set(collectCyberItems().map(cyberItemAddress).filter(Boolean))];
  if (!addresses.length) {
    toast('当前结果没有可复制的资产地址', 'warn');
    return;
  }
  const ok = await copyText(addresses.join('\n'));
  toast(
    ok ? `已复制 ${addresses.length} 条资产地址` : '复制失败，请检查剪贴板权限',
    ok ? 'success' : 'danger'
  );
}

/**
 * 导出当前结果为 JSON 文件。
 * 保留平台、语法、页码与全部字段，便于交给 AI 或自动化脚本继续处理。
 */
function exportCyberResults() {
  const data = state.cyber.results;
  if (!data || data.error) {
    toast('当前没有可导出的结果', 'warn');
    return;
  }
  const groups = Array.isArray(data.results) ? data.results : [];
  const items = collectCyberItems();
  const payload = {
    generator: 'RuleBox',
    exportedAt: new Date().toISOString(),
    query: state.cyber.query,
    page: state.cyber.page,
    pageSize: state.cyber.pageSize,
    providers: state.cyber.providers,
    results: groups.map((group) => ({
      provider: group.provider,
      providerName: getSearchProvider(group.provider)?.name || group.provider,
      ok: group.ok === true,
      total: Number(group.total) || 0,
      error: group.error || '',
      items: Array.isArray(group.items) ? group.items : []
    }))
  };

  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  const bytes = downloadText(
    `rulebox-cyber-${stamp}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );
  toast(
    bytes ? `已导出 ${items.length} 条结果` : '没有可导出的内容',
    bytes ? 'success' : 'warn'
  );
}

function cyberEmptyState() {
  const configured = SEARCH_PROVIDERS.filter((provider) => cyberProviderConfigured(provider.id)).length;
  if (!configured) {
    return emptyState({
      iconName: 'shield',
      title: '先配置平台密钥',
      desc: '支持 FOFA、Hunter 鹰图、Quake、ZoomEye、Shodan、0.zone 与 DayDayMap。密钥只保存在本机，导出配置时自动剔除。'
    });
  }
  return emptyState({
    iconName: 'search',
    title: '一站式资产检索',
    desc: '选择平台（可切换多选），输入平台原生语法后查询；结果支持点击跳转与一键复制。'
  });
}

function renderCyberResults() {
  const holder = $('#cyber-results');
  if (!holder) return;

  if (state.cyber.loading) {
    holder.replaceChildren(emptyState({
      iconName: 'search',
      title: '正在查询',
      desc: '已向所选平台发起请求，返回后会按平台分组展示。'
    }));
    return;
  }

  const data = state.cyber.results;
  if (!data) {
    holder.replaceChildren(cyberEmptyState());
    return;
  }

  if (data.error) {
    holder.replaceChildren(emptyState({
      iconName: 'warning',
      title: '查询未完成',
      desc: data.error
    }));
    return;
  }

  const groups = Array.isArray(data.results) ? data.results : [];
  holder.replaceChildren(...groups.map((group) => cyberGroupNode(group)));
}

function cyberGroupNode(group) {
  const provider = getSearchProvider(group.provider);
  const head = el('header', { className: 'rb-cyber-group-head' }, [
    el('span', {
      className: 'rb-cyber-dot',
      style: { '--rb-dot-color': provider?.color || 'var(--rb-fg-subtle)' }
    }),
    el('h3', { className: 'rb-cyber-group-title', text: provider?.name || group.provider }),
    group.ok
      ? el('span', { className: 'rb-cyber-group-total', text: `共 ${formatCyberCount(group.total)} 条` })
      : el('span', { className: 'rb-cyber-group-total', text: '(失败)' }),
    group.ok ? null : badge('失败', 'danger')
  ]);

  let body;
  if (!group.ok) {
    const actions = el('div', { className: 'rb-cyber-group-error-actions' });
    if (!/未配置/.test(group.error || '')) {
      const retry = el('button', {
        className: 'rb-btn rb-btn--ghost rb-btn--sm',
        text: '重试',
        attrs: { type: 'button' }
      });
      retry.addEventListener('click', () => { void runCyberSearch({ page: state.cyber.page || 1 }); });
      actions.appendChild(retry);
    }
    const configure = el('button', {
      className: 'rb-btn rb-btn--ghost rb-btn--sm',
      text: '去配置',
      attrs: { type: 'button' }
    });
    configure.addEventListener('click', () => openOptions('cyber'));
    actions.appendChild(configure);

    body = el('div', { className: 'rb-cyber-group-error' }, [
      el('span', { text: group.error || '查询失败' }),
      actions
    ]);
  } else if (!group.items?.length) {
    body = el('div', { className: 'rb-cyber-group-empty', text: '没有匹配结果，可调整语法或换一页。' });
  } else {
    body = el('div', { className: 'rb-cyber-items' }, group.items.map((item) => cyberItemNode(item)));
  }

  return el('section', { className: 'rb-cyber-group' }, [head, body]);
}

function cyberItemNode(item) {
  const titleText = item.title || item.domain || item.ip || '未命名资产';
  const title = item.url
    ? el('a', {
      className: 'rb-cyber-item-title',
      text: titleText,
      attrs: {
        href: item.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: item.url
      }
    })
    : el('span', { className: 'rb-cyber-item-title', text: titleText });

  const metaParts = [
    item.ip ? `${item.ip}${item.port ? `:${item.port}` : ''}` : '',
    item.protocol,
    item.status ? `HTTP ${item.status}` : '',
    item.domain && item.domain !== item.ip ? item.domain : '',
    item.server
  ].filter(Boolean);

  const subParts = [
    item.location,
    item.updatedAt ? `更新 ${item.updatedAt}` : ''
  ].filter(Boolean);

  const copy = el('button', {
    className: 'rb-btn rb-btn--ghost rb-btn--icon',
    attrs: { type: 'button', title: '复制资产地址', 'aria-label': '复制资产地址' }
  }, [icon('copy')]);
  copy.addEventListener('click', () => { void copyCyberItem(item); });

  const open = item.url
    ? el('a', {
      className: 'rb-btn rb-btn--ghost rb-btn--icon',
      attrs: {
        href: item.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: '在新标签页打开',
        'aria-label': '在新标签页打开'
      }
    }, [icon('external')])
    : null;

  return el('article', { className: 'rb-cyber-item' }, [
    el('div', { className: 'rb-cyber-item-main' }, [
      title,
      metaParts.length ? el('p', { className: 'rb-cyber-item-meta', text: metaParts.join(' · ') }) : null,
      subParts.length ? el('p', { className: 'rb-cyber-item-sub', text: subParts.join(' · ') }) : null
    ]),
    el('div', { className: 'rb-cyber-item-actions' }, [copy, open])
  ]);
}

async function copyCyberItem(item) {
  const value = item.url || (item.ip ? `${item.ip}${item.port ? `:${item.port}` : ''}` : '');
  if (!value) {
    toast('该条目没有可复制的地址', 'warn');
    return;
  }
  const ok = await copyText(value);
  toast(ok ? '已复制资产地址' : '复制失败，请检查剪贴板权限', ok ? 'success' : 'danger');
}

function renderCyberPager() {
  const holder = $('#cyber-pager');
  if (!holder) return;

  const data = state.cyber.results;
  if (!data || data.error || state.cyber.loading) {
    holder.hidden = true;
    return;
  }

  const groups = (data.results || []).filter((group) => group.ok);
  const page = Number(data.page) || 1;
  const size = Number(data.size) || state.cyber.pageSize;
  const hasMore = groups.some((group) => group.items.length >= size || group.total > page * size);
  const show = page > 1 || hasMore;
  holder.hidden = !show;
  if (!show) {
    holder.replaceChildren();
    return;
  }

  const prev = el('button', {
    className: 'rb-btn rb-btn--ghost rb-btn--sm',
    text: '上一页',
    attrs: { type: 'button' }
  });
  prev.disabled = page <= 1;
  prev.addEventListener('click', () => { void runCyberSearch({ page: page - 1 }); });

  const next = el('button', {
    className: 'rb-btn rb-btn--ghost rb-btn--sm',
    text: '下一页',
    attrs: { type: 'button' }
  });
  next.disabled = !hasMore;
  next.addEventListener('click', () => { void runCyberSearch({ page: page + 1 }); });

  holder.replaceChildren(
    prev,
    el('span', { className: 'rb-cyber-page-label', text: `第 ${page} 页` }),
    next
  );
}

/**
 * 复制语法后的一站式查询提示。
 * 只在语法库复制、对应平台支持 API 查询、且设置里未关闭时出现；
 * 出现期间不自动关闭弹窗（否则用户来不及点击）。
 */
function maybeShowCopyGuide(item) {
  if (item.kind !== 'snippet') return false;
  if (state.settings?.search?.enabled === false) return false;
  if (state.settings?.search?.promptAfterCopy === false) return false;
  const provider = getSearchProvider(item.platform);
  if (!provider) return false;

  const code = applyVars(item.code, state.variables).trim();
  if (!code) return false;
  showCopyGuide(provider, code);
  return true;
}

function dismissCopyGuide() {
  if (state.cyber.guideTimer) {
    clearTimeout(state.cyber.guideTimer);
    state.cyber.guideTimer = null;
  }
  document.querySelector('.rb-copy-guide')?.remove();
}

function showCopyGuide(provider, code) {
  dismissCopyGuide();

  const ask = el('button', {
    className: 'rb-btn rb-btn--primary rb-btn--sm',
    text: '去查询',
    attrs: { type: 'button' }
  });
  ask.addEventListener('click', () => {
    dismissCopyGuide();
    openCyberWithQuery(provider.id, code);
  });

  const mute = el('button', {
    className: 'rb-btn rb-btn--ghost rb-btn--sm',
    text: '不再提示',
    attrs: { type: 'button' }
  });
  mute.addEventListener('click', async () => {
    dismissCopyGuide();
    const settings = await patchSettings((draft) => {
      draft.search.promptAfterCopy = false;
    }).catch(() => null);
    if (settings) {
      state.settings = settings;
      toast('已关闭复制后的查询提示，可在设置中重新开启', 'info', 2600);
    }
  });

  const close = el('button', {
    className: 'rb-btn rb-btn--ghost rb-btn--icon',
    attrs: { type: 'button', title: '关闭提示', 'aria-label': '关闭提示' }
  }, [icon('close')]);
  close.addEventListener('click', dismissCopyGuide);

  const guide = el('div', {
    className: 'rb-copy-guide',
    attrs: { role: 'region', 'aria-label': '一站式查询提示' }
  }, [
    el('span', {
      className: 'rb-copy-guide-text',
      text: `已复制语法。要在 ${provider.name} 直接检索这类资产吗？`
    }),
    el('div', { className: 'rb-copy-guide-actions' }, [ask, mute, close])
  ]);
  document.body.appendChild(guide);

  // 不自动关闭弹窗，但提示本身超时收起，避免长时间遮挡内容
  state.cyber.guideTimer = setTimeout(dismissCopyGuide, 15000);
}

function openCyberWithQuery(providerId, code) {
  state.cyber.providers = [providerId];
  state.cyber.multi = false;
  state.cyber.query = code;
  state.cyber.page = 1;
  state.cyber.results = null;

  const input = $('#cyber-query');
  if (input) input.value = code;
  persistCyberProviders();
  switchTab('cyber');
  renderCyber();

  if (cyberProviderConfigured(providerId) && !/\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/.test(code)) {
    void runCyberSearch({ page: 1 });
    return;
  }

  input?.focus();
  input?.select();
  if (!cyberProviderConfigured(providerId)) {
    toast(`${getSearchProvider(providerId)?.name || providerId} 尚未配置 API Key`, 'warn', 2600);
  } else {
    toast('语法中还包含未填写的变量，请补全后再查询', 'info', 2600);
  }
}

/* ------------------------------------------------------------------ */
/* AI 助手                                                             */
/* ------------------------------------------------------------------ */

function bindAi() {
  const select = $('#ai-platform');
  const options = [
    el('option', { text: '通用（不限定平台）', attrs: { value: 'all' } }),
    ...state.data.platforms.map((platform) =>
      el('option', { text: `${platform.name} 语法`, attrs: { value: platform.id } })
    )
  ];
  select.replaceChildren(...options);
  select.value = state.ai.platform;
  select.addEventListener('change', () => {
    state.ai.platform = select.value;
    updateAiStatus();
    // 欢迎页的示例是按平台给的，切换平台后同步刷新
    if (!state.ai.messages.length) renderAiMessages();
  });

  // 模型档案快速切换：只写 ai.activeProfileId，请求时由 ai-client 读取，
  // 不需要改动对话内容，换模型后可以继续当前会话
  const profileSelect = $('#ai-profile');
  if (profileSelect) {
    profileSelect.addEventListener('change', async () => {
      const id = profileSelect.value;
      if (!id) return;
      try {
        state.settings = await patchSettings((draft) => {
          draft.ai.activeProfileId = id;
          return draft;
        });
        updateAiStatus();
        const profile = getActiveProfile(state.settings);
        if (profile) toast(`已切换到 ${profile.name} · ${profile.model || '未选择模型'}`, 'success', 1600);
      } catch {
        toast('切换模型失败，请重试', 'danger', 2000);
        renderAiProfileSelect();
      }
    });
  }

  // 提示词场景切换只重绘提示词列表，不动对话内容
  $('#ai-prompt-group-select').addEventListener('change', (event) => {
    state.ai.promptGroup = event.target.value;
    renderPromptLibrary();
  });

  $('#ai-clear').addEventListener('click', async () => {
    // 生成过程中清空会把正在流式写入的消息节点一起移除，必须先停
    if (state.ai.busy) {
      toast('正在生成回答，请先停止', 'warn', 1600);
      return;
    }
    state.ai.messages = [];
    await setAiHistory([]);
    renderAiMessages();
    toast('对话已清空', 'info', 1200);
  });

  const form = $('#ai-form');
  const input = $('#ai-input');

  const resize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(140, input.scrollHeight)}px`;
  };
  input.addEventListener('input', resize);
  input.addEventListener('keydown', (event) => {
    // 输入法组词过程中的按键一律放行：此时 Enter 是在选词，不是提交
    if (event.isComposing) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // 生成中再次提交（Ctrl+Enter）不能清空输入框，否则草稿会凭空丢失
    if (state.ai.busy) return;
    const question = input.value.trim();
    if (!question) return;
    // 未配置时保留输入内容，避免用户辛苦写好的问题被清空
    const readiness = aiReadiness();
    if (!readiness.ready) {
      renderAiConfigNotice(readiness);
      toast(readiness.notice || 'AI 尚未配置', 'warn', 3200);
      $('#ai-config-action')?.focus({ preventScroll: true });
      return;
    }
    input.value = '';
    resize();
    sendAi(question);
  });

  // 按钮 title 中承诺了 Esc 可停止生成，这里补上对应快捷键；
  // 仅在 AI 标签可见时生效，避免在其它标签误触中断
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // 组词时按 Esc 只是取消输入，不能顺手把正在生成的回答停掉
    if (event.isComposing) return;
    if (state.tab !== 'ai' || !state.ai.busy) return;
    state.ai.controller?.abort();
  });

  $('#ai-messages').addEventListener('click', onAiMessageClick);

  // 未配置引导里的按钮直达设置页 AI 分区（openOptionsPage 不支持锚点，见 openOptions）
  const configAction = $('#ai-config-action');
  if (configAction) configAction.addEventListener('click', () => openOptions('ai'));

  // HTML 里只有占位文案，这里统一成“图标 + 发送”，避免首次生成后按钮样式突变
  setAiBusy(false);
}

/**
 * 汇总 AI 可用状态。
 * 工具栏徽标、面板内的配置引导、发送前校验三处共用同一份判断，
 * 避免出现“徽标显示未启用、发送却报别的错”的口径不一致。
 */
function aiReadiness() {
  const settings = state.settings;
  if (!settings) return { ready: false, status: '', state: 'off', notice: '' };
  if (!settings.features.ai) {
    return {
      ready: false,
      status: 'AI 功能已关闭',
      state: 'off',
      notice: 'AI 功能已在设置中关闭，开启后即可使用对话生成。'
    };
  }
  if (!settings.ai.enabled) {
    return {
      ready: false,
      status: '未启用',
      state: 'off',
      notice: 'AI 助手尚未启用，需要先在设置中打开开关并填写接口信息。'
    };
  }
  const profile = getActiveProfile(settings);
  if (!profile) {
    return {
      ready: false,
      status: '缺少档案',
      state: 'warn',
      notice: '没有可用的 AI 档案，请先在设置中添加一个。'
    };
  }
  if (!profile.apiKey && profile.providerId !== 'ollama') {
    return {
      ready: false,
      status: `${profile.name} · 未填 Key`,
      state: 'warn',
      notice: `AI 档案「${profile.name}」还没有填写 API Key。`
    };
  }
  return { ready: true, status: `${profile.name} · ${profile.model}`, state: 'ok', notice: '' };
}

function updateAiStatus() {
  const node = $('#ai-status');
  if (!node) return;
  const readiness = aiReadiness();
  node.textContent = readiness.status;
  node.dataset.state = readiness.state;
  renderAiConfigNotice(readiness);
}

/**
 * 模型下拉：展示「档案名 · 模型」，未填 Key 的档案追加提示。
 * 选项只在设置变化时重建，避免切换后焦点与展开状态被重置。
 */
function renderAiProfileSelect() {
  const select = $('#ai-profile');
  if (!select) return;
  const ai = state.settings?.ai || {};
  const profiles = Array.isArray(ai.profiles) ? ai.profiles : [];

  if (!profiles.length) {
    select.replaceChildren(el('option', { text: '未配置模型', attrs: { value: '' } }));
    select.value = '';
    select.disabled = true;
    select.title = '还没有模型档案，请到设置 → AI 中添加';
    return;
  }

  select.disabled = false;
  select.title = '切换模型档案，管理请到设置 → AI';
  select.replaceChildren(...profiles.map((profile) => {
    const model = profile.model || '未选择模型';
    // Ollama 本地模型不需要 Key，只有云端供应商才提示未填
    const needKey = !profile.apiKey && profile.providerId !== 'ollama';
    return el('option', {
      text: `${profile.name} · ${model}${needKey ? '（未填 Key）' : ''}`,
      attrs: { value: profile.id }
    });
  }));
  select.value = ai.activeProfileId || profiles[0].id;
}

/**
 * 面板内的 AI 配置引导。
 * 未配置 / 未启用时不自动跳转设置页，而是就地说明原因并给出直达 AI 分区的入口，
 * 让用户明确知道缺什么、点了会去哪儿。
 */
function renderAiConfigNotice(readiness = aiReadiness()) {
  const notice = $('#ai-config-notice');
  if (!notice) return;
  notice.hidden = readiness.ready;
  if (readiness.ready) return;
  const text = $('#ai-config-notice-text');
  if (text) text.textContent = readiness.notice;
}

function renderPromptLibrary() {
  const groups = state.data.prompts || [];
  const select = $('#ai-prompt-group-select');
  const wrap = select?.closest('.rb-select-wrap');

  if (!groups.length) {
    // 自定义数据把提示词全部删掉时，空下拉没有意义，整块隐藏
    select.replaceChildren();
    delete select.dataset.optionSignature;
    if (wrap) wrap.hidden = true;
    $('#ai-prompts').replaceChildren();
    return;
  }

  if (wrap) wrap.hidden = false;

  // 提示词场景必须始终选中某一组，不存在“全部”这个概念（allLabel: null）
  state.ai.promptGroup = syncFilterSelect(
    select,
    groups.map((group) => ({ id: group.id, name: group.name })),
    { allLabel: null, value: state.ai.promptGroup }
  );

  const group = groups.find((entry) => entry.id === state.ai.promptGroup) || groups[0];
  const holder = $('#ai-prompts');
  const input = $('#ai-input');

  // 直接在创建时闭包绑定 prompt，避免用 title 文本反查（标题重复时会取错条目）
  holder.replaceChildren(
    ...(group.prompts || []).map((prompt) => {
      const button = el('button', {
        className: 'rb-prompt',
        text: prompt.title,
        attrs: { type: 'button', title: prompt.text }
      });
      button.addEventListener('click', () => {
        input.value = prompt.text;
        input.focus();
        input.dispatchEvent(new Event('input'));
      });
      return button;
    })
  );
}

function renderAiMessages() {
  const holder = $('#ai-messages');
  holder.replaceChildren();

  if (!state.ai.messages.length) {
    holder.appendChild(aiWelcome());
    return;
  }

  for (const message of state.ai.messages) {
    holder.appendChild(aiMessageNode(message));
  }
  scrollAiBottom();
}

/** 各平台的示例问题：带具体值，点击即可直接发送，降低上手成本 */
const AI_EXAMPLES = {
  all: [
    '用 FOFA 语法查找标题包含“管理后台”且位于中国的资产',
    '用 Quake 语法查 example.com 下开放 8080 端口的资产',
    '生成一条绕过空格过滤的 SQL 时间盲注测试 payload',
    'Google 语法：在 example.com 中查找包含“登录”的页面'
  ],
  fofa: [
    '查找标题包含“管理后台”且位于中国的资产',
    '查 example.com 的全部子域资产，并按域名去重',
    '排除登录页和错误页，只要标题非空的资产',
    '查 192.0.2.0/24 网段中开放 8080 端口的资产'
  ],
  hunter: [
    '按企业名称“示例科技”查找备案资产',
    '查找证书中包含 example.com 的资产',
    '查某域名下的 Web 资产，只保留标题包含“管理”的',
    '查找开放 3389 端口且位于中国的 Windows 主机'
  ],
  quake: [
    '查 example.com 下开放 8080 端口的资产',
    '按组件和版本查找 Apache Shiro 资产',
    '查找响应头里包含 nginx 且使用 HTTPS 的资产',
    '查 192.0.2.0/24 网段中的数据库服务'
  ],
  zoomeye: [
    '按应用名查找 Apache Tomcat 资产',
    '查 example.com 的子域名与对应 IP',
    '查找开放 22 端口的 Linux 主机',
    '按组件版本筛选存在已知漏洞风险的资产'
  ],
  shodan: [
    '查找 product 为 nginx 且位于中国的资产',
    '查 192.0.2.0/24 网段开放 3306 端口的主机',
    '按 HTTP 标题关键词筛选管理后台',
    '查找带有 SSL 证书且证书包含 example.com 的资产'
  ],
  ailpha: [
    '查高危且未处置的告警，按目的 IP 汇总',
    '查 alarmName 包含 WebShell 的告警',
    '查目的端口 8000-9000 的高危告警',
    '排除两个已知扫描源后查看中高危告警'
  ],
  tianyan: [
    '查源 IP 198.51.100.20 访问 192.0.2.10 的 80 端口流量',
    '查 uri 包含 /api/login 的 POST 请求',
    '查状态码 500 的 Web 访问',
    '查目的端口 3389 的访问来源'
  ],
  secmaster: [
    '查 GET 请求且状态码 200-299 的日志',
    '查 ipList 为 192.0.2.10 的访问日志',
    '查 url 包含 /admin 的请求',
    '查状态码 404 的 POST 请求'
  ],
  sangfor: [
    '查源 IP 192.0.2.10 访问 443 端口的日志',
    '查 dev_id 为 192.0.2.5_1518 且包含“加密操作”的日志',
    '全文模糊检索包含“密操作”的日志',
    '查两个来源地址访问 22 端口的日志'
  ],
  changting: [
    '查高危与超危且攻击成功的告警',
    '查攻击 IP 为 198.51.100.20 的全部告警',
    '查受害 IP 192.0.2.10 的高危告警',
    '查 URL 路径为 /admin 的高危告警'
  ],
  h3c: [
    '全文检索包含 192.0.2.10 的日志',
    '用通配符查 192.0.2.0/24 网段的日志',
    '全文检索包含“暴力破解”的日志',
    '用变量替换待查 IP 做全文检索'
  ],
  daydaymap: [
    '查 example.com 的子域与开放端口',
    '按标题关键词查找管理后台',
    '筛选 192.0.2.0/24 网段中的 Web 服务',
    '按组件名称查找资产'
  ],
  zerozone: [
    '查 example.com 的关联资产与子域',
    '按标题包含“管理后台”筛选资产',
    '查找开放 22 端口的主机',
    '按组件与版本筛选资产'
  ],
  google: [
    '在 example.com 中查找包含“登录”的页面',
    '查找 example.com 下暴露的 PDF 文档',
    '查找标题包含“后台管理”的站点',
    '排除 www 子域，只看 example.com 的其他子域'
  ],
  baidu: [
    '在 example.com 中查找包含“帮助中心”的页面',
    '查找标题包含“产品手册”的页面',
    '限定 site:example.com 并排除新闻栏目',
    '查找 example.com 下可下载的 PDF 文件'
  ],
  tools: [
    '生成一条 SQL 时间盲注的测试 payload',
    '生成一个检测命令注入的 curl 请求',
    '给出 SSRF 测试用的本地回环地址变体',
    '生成 XSS 测试用的无害弹窗 payload'
  ]
};

function aiWelcome() {
  const platformId = state.ai.platform || 'all';
  const platform = platformId === 'all' ? null : state.data.platformMap.get(platformId);
  const examples = AI_EXAMPLES[platformId] || AI_EXAMPLES.all;
  const steps = [
    '在上方选择目标平台，AI 会按该平台的字段与运算符生成语句。',
    '用一句话描述需求；已知的域名、IP、端口、关键词请直接写出来，生成结果会直接使用这些值。',
    '复制代码块到平台验证；字段无法确认时 AI 会标注“需在平台确认”，不要直接当成有效语法。'
  ];

  const box = el('div', { className: 'rb-ai-welcome' }, [
    el('div', { className: 'rb-ai-welcome-icon' }, [icon('ai')]),
    el('h2', { text: platform ? `用自然语言生成 ${platform.name} 语法` : '用自然语言生成语法与 Payload' }),
    el('ol', { className: 'rb-ai-steps' }, steps.map((text) =>
      el('li', { text })
    )),
    el('div', { className: 'rb-ai-examples' }, examples.map((text) =>
      el('button', { className: 'rb-ai-example', text, attrs: { type: 'button' } })
    ))
  ]);

  for (const button of $$('.rb-ai-example', box)) {
    button.addEventListener('click', () => {
      const input = $('#ai-input');
      input.value = button.textContent;
      input.focus();
      input.dispatchEvent(new Event('input'));
    });
  }

  return box;
}

/** 当前档案对应供应商的控制台地址（用于充值 / 换 Key） */
function consoleUrl() {
  const profile = getActiveProfile(state.settings);
  const url = getProvider(profile?.providerId)?.keyUrl || '';
  if (!url) return null;
  return el('a', {
    className: 'rb-btn rb-btn--ghost rb-btn--sm',
    text: '打开供应商控制台',
    attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' }
  });
}

function aiMessageNode(message) {
  const isUser = message.role === 'user';
  const body = el('div', { className: 'rb-ai-body' });

  if (isUser) {
    body.appendChild(el('div', { className: 'rb-ai-text', text: message.content }));
  } else {
    renderRichText(body, message.content || (message.pending ? '正在生成…' : ''));
  }

  // 额度耗尽 / 鉴权失败时给出供应商控制台入口，方便直接充值或换 Key
  const consoleLink = message.error && ['quota', 'auth', 'permission', 'config'].includes(message.errorCode)
    ? consoleUrl()
    : null;

  // 错误样式（左侧红色竖线 + 红色正文）由 .rb-ai-msg.is-assistant.is-error 决定，
  // 类名必须加在消息节点上；加到 .rb-ai-body 上不会命中任何规则（历史遗漏）
  const node = el('div', {
    className: `rb-ai-msg ${isUser ? 'is-user' : 'is-assistant'}`
      + `${message.pending ? ' is-pending' : ''}`
      + `${!isUser && message.error ? ' is-error' : ''}`
  }, [
    el('div', { className: 'rb-ai-role', text: isUser ? '你' : 'AI' }),
    body,
    !isUser && !message.pending && (message.content || message.error)
      ? el('div', { className: 'rb-ai-actions' }, [
        message.content
          ? el('button', {
            className: 'rb-btn rb-btn--ghost rb-btn--sm',
            text: '复制全文',
            attrs: { type: 'button', 'data-action': 'copy-message' }
          })
          : null,
        consoleLink
      ])
      : null
  ]);

  node.dataset.content = message.content || '';
  return node;
}

/** 渲染 AI 回复：拆出代码块并附带复制按钮，其余文本按纯文本展示 */
function renderRichText(container, text) {
  // 与 ai-client.js 的代码块提取保持一致：接口返回可能是 CRLF，
  // 只写 \n 会导致 ```lang\r\n... 整段无法识别为代码块
  const pattern = /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g;
  const source = String(text || '');
  let last = 0;
  let match;

  const addText = (segment) => {
    if (!segment.trim()) return;
    container.appendChild(el('div', { className: 'rb-ai-text', text: segment.trim() }));
  };

  while ((match = pattern.exec(source)) !== null) {
    addText(source.slice(last, match.index));
    container.appendChild(aiCodeBlock(match[1], match[2].replace(/\s+$/, '')));
    last = match.index + match[0].length;
  }
  addText(source.slice(last));

  if (!container.childNodes.length) {
    container.appendChild(el('div', { className: 'rb-ai-text', text: source }));
  }
}

function aiCodeBlock(lang, code) {
  const copy = el('button', {
    className: 'rb-btn rb-btn--ghost rb-btn--sm',
    attrs: { type: 'button', 'data-action': 'copy-code' }
  }, [icon('copy'), el('span', { text: '复制' })]);
  copy.dataset.code = code;

  return el('div', { className: 'rb-ai-code' }, [
    el('div', { className: 'rb-ai-code-head' }, [
      el('span', { className: 'rb-ai-code-lang', text: lang || 'text' }),
      copy
    ]),
    el('pre', {}, [el('code', { text: code })])
  ]);
}

async function onAiMessageClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  if (button.dataset.action === 'copy-code') {
    const ok = await copyText(button.dataset.code || '');
    toast(ok ? '代码已复制' : '复制失败', ok ? 'success' : 'danger', 1400);
    return;
  }

  if (button.dataset.action === 'copy-message') {
    const message = button.closest('.rb-ai-msg');
    const ok = await copyText(message?.dataset.content || '');
    toast(ok ? '完整回复已复制' : '复制失败', ok ? 'success' : 'danger', 1400);
  }
}

async function sendAi(question) {
  if (state.ai.busy) return;

  // 未配置 / 未启用时就地提示，不把用户直接丢到设置首页：
  // 面板内已有引导卡片说明缺什么，失败时把焦点交给“去配置 AI”按钮
  const readiness = aiReadiness();
  if (!readiness.ready) {
    renderAiConfigNotice(readiness);
    toast(readiness.notice || 'AI 尚未配置', 'warn', 3200);
    $('#ai-config-action')?.focus({ preventScroll: true });
    return;
  }

  const history = state.ai.messages
    // 失败 / 已停止的回复会被存成普通 assistant 消息，若带进上下文，
    // 模型会把“请求失败：…”当成自己说过的话，污染后续回答
    .filter((message) => !message.pending && !message.error)
    .slice(-Math.max(0, Number(state.settings.ai.historyLimit) || 6))
    .map((message) => ({ role: message.role, content: message.content }));

  state.ai.messages.push({ role: 'user', content: question, ts: Date.now() });
  const assistant = { role: 'assistant', content: '', ts: Date.now(), pending: true };
  state.ai.messages.push(assistant);
  // 只保留最近 40 条，避免存储无限增长
  if (state.ai.messages.length > 40) state.ai.messages = state.ai.messages.slice(-40);

  state.ai.busy = true;
  setAiBusy(true);
  renderAiMessages();

  const controller = new AbortController();
  state.ai.controller = controller;
  const platform = state.ai.platform === 'all' ? null : state.data.platformMap.get(state.ai.platform) || null;

  // 只在本地检索少量最相关条目作为示例，不发送全库；检索失败不影响请求本身
  let examples = [];
  if (state.settings.ai.includeLibraryExamples) {
    try {
      examples = retrieveExamples({
        question,
        snippets: state.data.snippets,
        payloads: state.data.payloads,
        platformId: state.ai.platform
      });
    } catch {
      examples = [];
    }
  }

  try {
    const answer = await requestAI({
      settings: state.settings,
      platform,
      examples,
      question,
      history,
      signal: controller.signal,
      onDelta: (delta) => {
        assistant.content += delta;
        updateStreamingText(assistant.content);
      }
    });
    assistant.content = answer;
    assistant.pending = false;
  } catch (error) {
    assistant.pending = false;
    if (controller.signal.aborted) {
      // 用户主动点击“停止”或按 Esc，不当作错误提示，消息也不走红色错误样式
      assistant.content = assistant.content || '已停止生成。';
      toast('已停止生成', 'info', 1400);
    } else {
      assistant.error = true;
      if (error instanceof AIError) {
        assistant.errorCode = error.code;
        assistant.content = assistant.content || `请求失败：${error.message}`;
        if (['disabled', 'config', 'permission', 'auth', 'quota'].includes(error.code)) {
          toast(error.message, 'danger', 3600);
        }
      } else {
        assistant.content = assistant.content || '请求失败，请稍后重试。';
        toast('请求失败，请检查网络或接口配置', 'danger');
      }
    }
  } finally {
    state.ai.busy = false;
    state.ai.controller = null;
    setAiBusy(false);
    // 收尾会把消息整体重渲染：用户若正在上翻历史（未贴底），保持其阅读位置，
    // 否则刚改好的“流式输出不抢滚动”会在最后一帧被推翻。
    const holder = $('#ai-messages');
    const pinned = !holder.scrollHeight
      || holder.scrollHeight - holder.scrollTop - holder.clientHeight < 48;
    const previousTop = holder.scrollTop;
    renderAiMessages();
    if (!pinned && holder.scrollHeight) {
      holder.scrollTop = previousTop;
      aiScroll = holder.scrollTop;
    }
    await setAiHistory(
      state.ai.messages
        .filter((message) => !message.pending)
        .slice(-40)
        .map((message) => ({ role: message.role, content: message.content, ts: message.ts }))
    );
    updateAiStatus();
  }
}

function updateStreamingText(content) {
  const holder = $('#ai-messages');
  const last = holder.querySelector('.rb-ai-msg:last-child .rb-ai-text');
  if (!last) return;

  // 更新前先判断用户是否停留在底部：正在往上翻历史时不要强行拽回底部，
  // 否则长回答流式输出期间根本没法回看前面的内容。
  const pinned = holder.scrollHeight - holder.scrollTop - holder.clientHeight < 48;
  last.textContent = content;
  if (pinned) scrollAiBottom();
}

function setAiBusy(busy) {
  const button = $('#ai-send');
  button.replaceChildren(icon(busy ? 'stop' : 'send'), el('span', { text: busy ? '停止' : '发送' }));
  button.classList.toggle('is-stop', busy);
  button.title = busy ? '停止生成（Esc）' : `发送（${SHORTCUT.send}）`;

  // 生成期间标记消息区为 busy：aria-live 会推迟到结束再播报，
  // 避免流式输出逐字触发读屏软件反复朗读
  $('#ai-messages').setAttribute('aria-busy', String(busy));

  if (busy) {
    button.onclick = (event) => {
      event.preventDefault();
      state.ai.controller?.abort();
    };
  } else {
    button.onclick = null;
  }
  // 页脚提示随生成状态切换（Esc 停止 / Ctrl+Enter 发送）
  renderFooter();
}

function scrollAiBottom() {
  const holder = $('#ai-messages');
  // 面板隐藏时 scrollHeight 为 0，此时不要写入，否则会把记忆位置清零
  if (!holder || !holder.scrollHeight) return;
  holder.scrollTop = holder.scrollHeight;
  aiScroll = holder.scrollTop;
}

/* ------------------------------------------------------------------ */
/* 页脚与整体渲染                                                      */
/* ------------------------------------------------------------------ */

function renderAll() {
  renderSnippets();
  renderPayloads();
  renderCyber();
  renderPromptLibrary();
  updateAiStatus();
  renderFooter();
}

function renderFooter() {
  const count = $('#footer-count');
  const hint = $('#footer-hint');
  if (!count || !hint) return;

  renderHiddenFooter();

  if (state.tab === 'ai') {
    count.textContent = 'AI 输出仅供辅助，请核对字段后使用';
    // 生成中把快捷键提示换成“停止”，让用户知道此刻能做什么
    hint.textContent = state.ai.busy ? 'Esc 停止生成' : `${SHORTCUT.send} 发送`;
    return;
  }

  if (state.tab === 'cyber') {
    const configured = SEARCH_PROVIDERS.filter((provider) => cyberProviderConfigured(provider.id)).length;
    count.textContent = state.cyber.loading
      ? '正在向所选平台发起查询…'
      : `聚合查询：已配置 ${configured} / ${SEARCH_PROVIDERS.length} 个平台`;
    hint.textContent = 'Ctrl+Enter 查询 · 可多选平台';
    return;
  }

  const all = state.tab === 'snippets' ? state.data.snippets : state.data.payloads;
  const visible = state.tab === 'snippets' ? visibleSnippets().length : visiblePayloads().length;
  // 分母随“只看收藏”一起收敛，否则会出现“2 / 652 条”这种对不上的读数
  const total = applyFavorites(all).length;
  count.textContent = `${searchScopeLabel()}：${visible} / ${total} 条`;
  hint.textContent = `${SHORTCUT.search} 搜索 · 点条目右侧“复制”`;
}

/**
 * 有隐藏条目时，把页脚的快捷键提示换成“已隐藏 N 条 · 恢复”。
 * 隐藏入口在卡片上，恢复入口若只藏在设置页里，用户很容易找不到，
 * 所以列表页始终给一个一眼能看见的直达链接。
 */
function renderHiddenFooter() {
  const link = $('#footer-hidden');
  const hint = $('#footer-hint');
  if (!link || !hint) return;

  const total = state.hidden.length;
  // 隐藏条目只与语法库 / Payload 列表相关，AI 与聚合查询页脚不展示该入口
  const show = total > 0 && (state.tab === 'snippets' || state.tab === 'payloads');
  link.hidden = !show;
  hint.hidden = show;
  if (!show) return;

  link.textContent = `已隐藏 ${total} 条 · 恢复`;
  link.title = '打开设置页「内置条目显示」恢复';
}

/**
 * 页脚的结果范围文案。
 * 搜索与平台/类型筛选是叠加关系，所以搜索时要说清“在哪个范围内搜”，
 * 否则用户会以为搜索忽略了已选平台。
 */
function searchScopeLabel() {
  if (!state.query.trim()) return state.favoritesOnly ? '只看收藏' : '当前筛选';

  const scope = state.tab === 'snippets' ? state.platform : state.payloadGroup;
  if (state.favoritesOnly) {
    if (scope === '__recent') return '最近收藏内搜索';
    if (scope !== 'all') return state.tab === 'snippets' ? '收藏内平台搜索' : '收藏内类型搜索';
    return '收藏内搜索';
  }
  if (scope === '__recent') return '最近内搜索';
  if (scope !== 'all') return state.tab === 'snippets' ? '平台内搜索' : '类型内搜索';
  return '全库搜索';
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

init().catch((error) => {
  console.error('[RuleBox] 初始化失败', error);
  const holder = $('#snippet-list');
  if (holder) {
    holder.replaceChildren(
      emptyState({
        iconName: 'warning',
        title: '加载失败',
        desc: '数据文件读取失败，请重新加载扩展。若从本地预览，请通过静态服务器访问项目根目录。'
      })
    );
  }
});
