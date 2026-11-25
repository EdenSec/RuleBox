/**
 * RuleBox 设置页逻辑
 * 设计原则：
 * - 所有控件“变更即自动保存”，通过 patchSettings 局部更新；
 * - 任何用户输入都通过 el()/textContent 渲染，不使用 innerHTML 写入动态内容；
 * - API Key 只读写 #opt-ai-key，不打印到控制台、不写入导出文件；
 * - 自定义平台 / 条目统一走 storage.setCustom + data.invalidateCache，避免重复造轮子。
 */

import { $, $$, el, uid, clamp, safeParse, debounce, formatBytes, trimTrailingSlash, isAllowedEndpoint, isMacPlatform, downloadText } from '../core/utils.js';
import { STORAGE_KEYS } from '../core/defaults.js';
import {
  getSettings,
  patchSettings,
  getCustom,
  setCustom,
  getHidden,
  setHidden,
  getUsage,
  setAiHistory,
  setRecents,
  setVariables,
  setFavorites,
  exportConfig,
  validateConfig,
  applyConfig,
  resetAll,
  onStorageChanged
} from '../core/storage.js';
import { PROVIDERS, getProvider, getProviderModels } from '../core/providers.js';
import { testConnection, hasEndpointPermission, DEFAULT_SYSTEM_PROMPT } from '../core/ai-client.js';
import { loadAll, invalidateCache } from '../core/data.js';
import { applyTheme, nextTheme, themeMeta } from './theme.js';
import { toast, confirmDialog, badge, itemKey } from './components.js';
import { icon } from './icons.js';
import { openFormDialog, openInfoDialog } from './form-dialog.js';
import { openItemDialog } from './item-dialog.js';

const hasChrome = typeof chrome !== 'undefined';
const SECTIONS = ['general', 'ai', 'data', 'builtin', 'import', 'about'];

const PLATFORM_ID_PATTERN = /^[a-zA-Z0-9_-]{2,32}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;

const state = {
  settings: null,
  data: null,
  custom: { platforms: [], items: [] },
  // 内置条目隐藏名单（kind:id），只是不在面板展示
  hidden: []
};

let statusTimer = null;
let profileTimer = null;
let ignoreCustomUntil = 0;
let initialized = false;
let currentSection = 'general';

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

/** 数字输入空值保护：'' / 非法值都返回 fallback，避免 Number('') === 0 的坑 */
function numberOr(raw, fallback) {
  const str = String(raw ?? '').trim();
  if (!str) return fallback;
  const num = Number(str);
  return Number.isFinite(num) ? num : fallback;
}

/** 顶部保存状态提示 */
function setStatus(text, type = '') {
  const node = $('#save-status');
  if (!node) return;
  if (statusTimer) clearTimeout(statusTimer);
  node.textContent = text;
  node.classList.toggle('is-saved', type === 'saved');
  node.classList.toggle('is-error', type === 'error');
  if (type) {
    statusTimer = setTimeout(() => {
      statusTimer = null;
      node.textContent = '修改会自动保存';
      node.classList.remove('is-saved', 'is-error');
    }, 1800);
  }
}

/** 局部更新设置并同步到 state（updater 修改的是克隆对象，不会污染 state） */
async function updateSettings(mutator, { silent = false } = {}) {
  try {
    const saved = await patchSettings((draft) => {
      mutator(draft);
      return draft;
    });
    state.settings = saved;
    if (!silent) setStatus('已保存', 'saved');
    return saved;
  } catch (err) {
    console.error('[RuleBox] 保存设置失败', err);
    if (!silent) setStatus('保存失败，请重试', 'error');
    return null;
  }
}

/** 通知后台 Service Worker 重新同步右键菜单 / 侧边栏 */
function notifyBackground() {
  if (!hasChrome || !chrome.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage({ type: 'rb:sync' }, () => { void chrome.runtime.lastError; });
  } catch {
    /* 扩展环境外忽略 */
  }
}

/* 弹窗与表单统一由 ./form-dialog.js 提供，设置页只负责业务字段与提交逻辑 */

/* ------------------------------------------------------------------ */
/* 文本解析辅助（自定义平台表单专用）                                    */
/* ------------------------------------------------------------------ */

function splitLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 40);
}

/** 每行“key | 说明”解析为对象数组（说明可空，上限 60 条） */
function parsePairs(text, keyField = 'key') {
  const result = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (result.length >= 60) break;
    const pos = trimmed.indexOf('|');
    if (pos === -1) {
      result.push({ [keyField]: trimmed, desc: '' });
    } else {
      const key = trimmed.slice(0, pos).trim();
      const desc = trimmed.slice(pos + 1).trim();
      if (key) result.push({ [keyField]: key, desc });
    }
  }
  return result;
}

/** 对象数组还原为“key | 说明”文本 */
function formatPairs(list, keyField = 'key') {
  return (list || [])
    .filter((item) => item && item[keyField])
    .map((item) => (item.desc ? `${item[keyField]} | ${item.desc}` : String(item[keyField])))
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* AI 测试结果                                                          */
/* ------------------------------------------------------------------ */

function showTestResult(type, message) {
  const node = $('#ai-test-result');
  if (!node) return;
  node.classList.remove('is-ok', 'is-error');
  if (type === 'ok') node.classList.add('is-ok');
  if (type === 'error') node.classList.add('is-error');
  node.textContent = message || '';
}

/* ------------------------------------------------------------------ */
/* AI 档案管理                                                          */
/* ------------------------------------------------------------------ */

function currentProfile() {
  const ai = state.settings?.ai;
  if (!ai?.profiles?.length) return null;
  return ai.profiles.find((profile) => profile.id === ai.activeProfileId) || ai.profiles[0];
}

function renderProviderOptions() {
  const select = $('#opt-ai-provider');
  select.replaceChildren();
  for (const provider of PROVIDERS) {
    select.append(el('option', { attrs: { value: provider.id }, text: provider.name }));
  }
}

function renderProfileOptions() {
  const select = $('#opt-ai-profile');
  const profiles = state.settings?.ai?.profiles || [];
  select.replaceChildren();
  for (const profile of profiles) {
    select.append(el('option', { attrs: { value: profile.id }, text: profile.name || '未命名档案' }));
  }
  select.value = state.settings?.ai?.activeProfileId || profiles[0]?.id || '';
  $('#btn-ai-profile-del').disabled = profiles.length <= 1;
}

function renderModels(providerId) {
  const datalist = $('#opt-ai-models');
  datalist.replaceChildren();
  for (const model of getProviderModels(providerId)) {
    datalist.append(el('option', { attrs: { value: model } }));
  }
}

/** 展示供应商的 API Key 获取入口；自定义端点与 Ollama 无需跳转 */
function renderProviderLinks(providerId) {
  const link = $('#opt-ai-key-link');
  if (!link) return;
  const provider = getProvider(providerId);
  if (provider.keyUrl) {
    link.href = provider.keyUrl;
    link.hidden = false;
  } else {
    link.removeAttribute('href');
    link.hidden = true;
  }
}

/**
 * 渲染供应商专有的思考模式选项
 * - 有 options 的供应商（通义 / 智谱 / OpenAI）显示下拉；
 * - 只有 hint 的供应商（DeepSeek / Kimi）只显示说明，提示改用对应模型；
 * - 无该能力的供应商（Ollama / 自定义）整块隐藏。
 */
function renderThinking(providerId, value = '') {
  const field = $('#opt-ai-thinking-field');
  const select = $('#opt-ai-thinking');
  const note = $('#opt-ai-thinking-note');
  if (!field || !select) return;

  const descriptor = getProvider(providerId)?.thinking || null;
  const options = Array.isArray(descriptor?.options) ? descriptor.options : [];

  if (note) {
    const hint = String(descriptor?.hint || '').trim();
    note.hidden = !hint;
    note.textContent = hint;
  }

  if (!options.length) {
    field.hidden = true;
    select.replaceChildren();
    return;
  }

  select.replaceChildren();
  select.append(el('option', { attrs: { value: '' }, text: '不设置（默认）' }));
  for (const option of options) {
    select.append(el('option', { attrs: { value: option.value }, text: option.label }));
  }
  const matched = options.some((option) => option.value === value);
  select.value = matched ? value : '';
  field.hidden = false;
}

function changeKeyVisibility(show) {
  const input = $('#opt-ai-key');
  const button = $('#btn-ai-key-toggle');
  input.type = show ? 'text' : 'password';
  button.textContent = show ? '隐藏' : '显示';
}

/** 把表单当前值收集为档案对象 */
function collectProfileForm(current) {
  return {
    id: current?.id || uid('profile'),
    name: String($('#opt-ai-name').value || '').trim() || '未命名档案',
    providerId: $('#opt-ai-provider').value || 'custom',
    baseUrl: trimTrailingSlash(String($('#opt-ai-baseurl').value || '').trim()),
    model: String($('#opt-ai-model').value || '').trim(),
    apiKey: String($('#opt-ai-key').value || ''),
    temperature: Math.round(clamp(numberOr($('#opt-ai-temperature').value, 0.2), 0, 2) * 10) / 10,
    maxTokens: Math.round(clamp(numberOr($('#opt-ai-max-tokens').value, 2048), 128, 8192)),
    timeoutMs: Math.round(clamp(numberOr($('#opt-ai-timeout').value, 60000), 5000, 180000)),
    thinking: String($('#opt-ai-thinking')?.value || ''),
    extraBody: String($('#opt-ai-extra-body').value || '').trim()
  };
}

/** 额外请求参数必须是 JSON 对象，避免把数组或裸值并入请求体 */
function parseExtraBody(text) {
  if (!text) return { ok: true, value: null };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, value: null };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, value: null };
  }
}

/** 校验档案，返回中文错误串；通过返回 '' */
function validateProfile(profile, { requireKey = true } = {}) {
  if (!String(profile.name || '').trim()) return '请填写档案名称';
  if (!String(profile.baseUrl || '').trim()) return '请填写 Base URL';
  if (!isAllowedEndpoint(profile.baseUrl)) return 'Base URL 必须是 https 地址，或本机 http://localhost / 127.0.0.1';
  if (!String(profile.model || '').trim()) return '请填写模型名称';
  if (requireKey && profile.providerId !== 'ollama' && !String(profile.apiKey || '').trim()) {
    return '请填写 API Key（使用 Ollama 可留空）';
  }
  if (!parseExtraBody(profile.extraBody).ok) {
    return '额外请求参数必须是合法的 JSON 对象，例如 {"top_p": 0.9}';
  }
  return '';
}

/** 按档案 ID 写回设置，并将其设为当前档案 */
async function persistProfile(profile) {
  const saved = await updateSettings((draft) => {
    const index = draft.ai.profiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) draft.ai.profiles[index] = profile;
    else draft.ai.profiles.push(profile);
    draft.ai.activeProfileId = profile.id;
  }, { silent: true });
  return Boolean(saved);
}

function scheduleProfileSave() {
  if (profileTimer) clearTimeout(profileTimer);
  profileTimer = setTimeout(() => {
    profileTimer = null;
    void saveProfileNow();
  }, 700);
}

async function saveProfileNow() {
  const profile = collectProfileForm(currentProfile());
  const error = validateProfile(profile, { requireKey: false });
  if (error) {
    // 其他字段允许边输边改，JSON 格式错误会阻止保存，必须明确提示
    if (error.includes('额外请求参数')) setStatus(error, 'error');
    return false;
  }
  const ok = await persistProfile(profile);
  if (ok) setStatus('已保存', 'saved');
  return ok;
}

/** 立即落盘表单中未保存的档案值（切分区 / 切档案 / 导出前调用） */
async function flushProfileForm() {
  if (profileTimer) {
    clearTimeout(profileTimer);
    profileTimer = null;
  }
  const current = currentProfile();
  if (!current) return;
  const profile = collectProfileForm(current);
  const error = validateProfile(profile, { requireKey: false });
  if (!error) await persistProfile(profile);
}

function fillProfileForm() {
  const profile = currentProfile();
  if (!profile) return;
  $('#opt-ai-name').value = profile.name || '';
  const providerId = PROVIDERS.some((item) => item.id === profile.providerId) ? profile.providerId : 'custom';
  const providerSelect = $('#opt-ai-provider');
  providerSelect.value = providerId;
  providerSelect.dataset.previous = providerId;
  $('#opt-ai-baseurl').value = profile.baseUrl || '';
  $('#opt-ai-model').value = profile.model || '';
  $('#opt-ai-key').value = profile.apiKey || '';
  $('#opt-ai-temperature').value = String(profile.temperature ?? 0.2);
  $('#opt-ai-max-tokens').value = String(profile.maxTokens ?? 2048);
  $('#opt-ai-timeout').value = String(profile.timeoutMs ?? 60000);
  $('#opt-ai-extra-body').value = profile.extraBody || '';
  renderModels(providerId);
  renderProviderLinks(providerId);
  renderThinking(providerId, profile.thinking || '');
  changeKeyVisibility(false);
  showTestResult('', '');
}

/** 双开关同步：features.ai 控制界面，ai.enabled 控制请求 */
function syncAiSwitches() {
  $('#opt-ai-feature').checked = Boolean(state.settings?.features?.ai);
  $('#opt-ai-enabled').checked = Boolean(state.settings?.ai?.enabled);
}

async function switchProfile(profileId) {
  const current = currentProfile();
  if (!current || current.id === profileId) return;
  if (profileTimer) {
    clearTimeout(profileTimer);
    profileTimer = null;
  }
  // 先把旧档案的表单值写回，再切换激活档案（同一次写入，避免竞态）
  const captured = collectProfileForm(current);
  await updateSettings((draft) => {
    const index = draft.ai.profiles.findIndex((item) => item.id === captured.id);
    if (index >= 0) draft.ai.profiles[index] = captured;
    draft.ai.activeProfileId = profileId;
  });
  renderProfileOptions();
  fillProfileForm();
}

async function addProfile() {
  if (profileTimer) {
    clearTimeout(profileTimer);
    profileTimer = null;
  }
  const captured = collectProfileForm(currentProfile());
  const id = uid('profile');
  const names = new Set(state.settings.ai.profiles.map((profile) => profile.name));
  let index = state.settings.ai.profiles.length + 1;
  let name = `档案 ${index}`;
  while (names.has(name)) {
    index += 1;
    name = `档案 ${index}`;
  }
  await updateSettings((draft) => {
    const pos = draft.ai.profiles.findIndex((item) => item.id === captured.id);
    if (pos >= 0) draft.ai.profiles[pos] = captured;
    draft.ai.profiles.push({
      id,
      name,
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: '',
      temperature: 0.2,
      maxTokens: 2048,
      timeoutMs: 60000,
      thinking: '',
      extraBody: ''
    });
    draft.ai.activeProfileId = id;
  });
  renderProfileOptions();
  fillProfileForm();
  setStatus('已新增档案', 'saved');
  const nameInput = $('#opt-ai-name');
  nameInput.focus();
  nameInput.select();
}

async function deleteProfile() {
  const profiles = state.settings.ai.profiles;
  if (profiles.length <= 1) {
    toast('至少保留一个档案', 'warn');
    return;
  }
  if (profileTimer) {
    clearTimeout(profileTimer);
    profileTimer = null;
  }
  const current = currentProfile();
  const ok = await confirmDialog({
    title: '删除档案',
    message: `确定删除档案「${current?.name || ''}」吗？该档案的 API Key 会一并删除，操作不可撤销。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;
  await updateSettings((draft) => {
    const rest = draft.ai.profiles.filter((item) => item.id !== draft.ai.activeProfileId);
    draft.ai.profiles = rest;
    if (!rest.some((item) => item.id === draft.ai.activeProfileId)) {
      draft.ai.activeProfileId = rest[0]?.id || 'default';
    }
  });
  renderProfileOptions();
  fillProfileForm();
  toast('档案已删除', 'success');
}

/** 切换供应商预设：只在用户未自定义时替换 Base URL / 模型 */
function applyProviderPreset(providerId) {
  const select = $('#opt-ai-provider');
  const previousId = select.dataset.previous || '';
  const prevProvider = getProvider(previousId);
  const nextProvider = getProvider(providerId);

  const baseUrlInput = $('#opt-ai-baseurl');
  const currentBaseUrl = trimTrailingSlash(String(baseUrlInput.value || '').trim());
  if (!currentBaseUrl || currentBaseUrl === trimTrailingSlash(prevProvider.baseUrl)) {
    baseUrlInput.value = nextProvider.baseUrl || '';
  }

  const modelInput = $('#opt-ai-model');
  const currentModel = String(modelInput.value || '').trim();
  if (!currentModel || getProviderModels(previousId).includes(currentModel)) {
    modelInput.value = (nextProvider.models || [])[0] || '';
  }

  select.dataset.previous = providerId;
  renderModels(providerId);
  renderProviderLinks(providerId);
  renderThinking(providerId, '');
  scheduleProfileSave();
}

/** 保存档案并授权其 Base URL 域名（权限请求必须在 await 之前同步发起） */
async function handleAuthorize() {
  const profile = collectProfileForm(currentProfile());
  const error = validateProfile(profile, { requireKey: true });
  if (error) {
    showTestResult('error', error);
    return;
  }

  let origin = '';
  try {
    origin = new URL(profile.baseUrl).origin;
  } catch {
    showTestResult('error', 'Base URL 无效');
    return;
  }

  // 注意：chrome.permissions.request 必须在用户手势内同步调用，
  // 任何前置 await 都可能使其失效，所以先把 Promise 拿在手里。
  let grantedPromise = Promise.resolve(true);
  if (hasChrome && chrome.permissions?.request) {
    try {
      grantedPromise = Promise.resolve(
        chrome.permissions.request({ origins: [`${origin}/*`] })
      ).catch(() => false);
    } catch {
      grantedPromise = Promise.resolve(false);
    }
  }

  const saved = await persistProfile(profile);
  if (!saved) {
    showTestResult('error', '保存失败，请重试');
    return;
  }

  const granted = await grantedPromise;
  if (granted) {
    showTestResult('ok', `档案已保存，并授权访问 ${origin}`);
  } else {
    showTestResult('error', `档案已保存，但域名授权未完成（${origin}）。请检查地址后重新点击本按钮。`);
  }
}

async function handleTest() {
  const profile = collectProfileForm(currentProfile());
  const error = validateProfile(profile, { requireKey: true });
  if (error) {
    showTestResult('error', error);
    return;
  }
  if (!state.settings.ai.enabled) {
    showTestResult('error', '请先打开上方的「启用 AI 助手」开关');
    return;
  }

  const saved = await persistProfile(profile);
  if (!saved) {
    showTestResult('error', '保存失败，请重试');
    return;
  }

  // 扩展环境里必须先完成域名授权，否则请求会被 CORS 拦截
  if (hasChrome && chrome.permissions && !(await hasEndpointPermission(profile.baseUrl))) {
    showTestResult('error', '尚未授权该域名，请先点击「保存并授权域名」');
    return;
  }

  const button = $('#btn-ai-test');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '测试中…';
  try {
    // testConnection 内部 preflight 校验失败会直接抛 AIError，需要 catch
    const result = await testConnection(state.settings);
    showTestResult(result.ok ? 'ok' : 'error', result.message);
  } catch (err) {
    showTestResult('error', err?.message || '测试失败：未知错误');
  } finally {
    button.disabled = false;
    button.textContent = original;
    await renderUsage();
  }
}

/* ------------------------------------------------------------------ */
/* 用量                                                                 */
/* ------------------------------------------------------------------ */

async function renderUsage() {
  const node = $('#ai-usage');
  if (!node) return;
  const usage = await getUsage();
  const limit = Number(state.settings?.ai?.dailyRequestLimit) || 0;
  const today = new Date().toISOString().slice(0, 10);
  const count = usage.date === today ? usage.count : 0;
  node.textContent = limit > 0 ? `今日 ${count} / ${limit} 次` : `今日 ${count} 次（不限）`;
  node.classList.toggle('rb-badge--danger', limit > 0 && count >= limit);
}

/* ------------------------------------------------------------------ */
/* 导入导出与重置                                                       */
/* ------------------------------------------------------------------ */

async function handleExport() {
  try {
    // 导出前先把表单里未落盘的档案值保存，避免导出旧内容
    if (profileTimer) {
      clearTimeout(profileTimer);
      profileTimer = null;
    }
    const captured = collectProfileForm(currentProfile());
    const err = validateProfile(captured, { requireKey: false });
    if (!err) await persistProfile(captured);

    const config = await exportConfig();
    const json = JSON.stringify(config, null, 2);
    const date = new Date().toISOString().slice(0, 10);
    // 与卡片「存为文件」共用同一套 Blob + 锚点下载，避免各写一份
    const size = downloadText(`rulebox-config-${date}.json`, json, 'application/json;charset=utf-8');
    if (!size) {
      toast('配置内容为空，未生成文件', 'warn');
      return;
    }
    toast(`配置已导出（${formatBytes(size)}），文件不含 API Key`, 'success', 3200);
  } catch (err) {
    console.error('[RuleBox] 导出失败', err);
    toast(`导出失败：${err?.message || '未知错误'}`, 'danger');
  }
}

async function handleImport(file) {
  const maxBytes = Number(state.settings?.limits?.maxImportBytes) || 512000;
  if (file.size > maxBytes) {
    toast(`文件过大（上限 ${formatBytes(maxBytes)}）`, 'danger');
    return;
  }

  let payload = null;
  try {
    payload = safeParse(await file.text());
  } catch {
    payload = null;
  }
  const check = validateConfig(payload);
  if (!check.ok) {
    toast(check.message, 'danger');
    return;
  }

  const maxItems = Number(state.settings?.limits?.maxCustomItems) || 500;
  if ((payload.custom?.items?.length || 0) > maxItems) {
    toast(`自定义条目超出上限（${maxItems} 条）`, 'danger');
    return;
  }

  const ok = await confirmDialog({
    title: '导入配置',
    message: '导入会覆盖当前设置、自定义平台与条目、收藏与变量记忆；API Key 需要重新填写。确定继续吗？',
    confirmText: '导入',
    danger: true
  });
  if (!ok) return;

  try {
    await applyConfig(payload);
    state.settings = await getSettings();
    state.custom = await getCustom();
    applyTheme(state.settings.theme);
    fillAll();
    invalidateCache();
    await refreshData();
    renderPlatformList();
    renderItemList();
    renderSources();
    await renderUsage();
    notifyBackground();
    toast('配置已导入', 'success');
  } catch (err) {
    console.error('[RuleBox] 导入失败', err);
    toast(`导入失败：${err?.message || '未知错误'}`, 'danger');
  }
}

async function handleReset() {
  const ok = await confirmDialog({
    title: '重置全部本地数据',
    message: '将删除设置、API Key、收藏、最近使用、变量记忆、自定义平台与条目。操作不可撤销，确定继续吗？',
    confirmText: '重置',
    danger: true
  });
  if (!ok) return;
  try {
    await resetAll();
    toast('已重置，即将刷新页面…', 'success');
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    console.error('[RuleBox] 重置失败', err);
    toast(`重置失败：${err?.message || '未知错误'}`, 'danger');
  }
}

/* ------------------------------------------------------------------ */
/* 自定义数据（平台 / 条目）                                             */
/* ------------------------------------------------------------------ */

async function refreshData() {
  try {
    const [data, hidden] = await Promise.all([loadAll(true), getHidden()]);
    state.data = data;
    state.hidden = hidden;
    renderBuiltinList();
  } catch (err) {
    console.error('[RuleBox] 加载内置数据失败', err);
    toast('加载内置数据失败，请刷新页面重试', 'danger');
  }
}

/** 统一提交自定义数据：写存储 → 刷缓存 → 重渲染 → 通知后台 */
async function commitCustom(next) {
  try {
    ignoreCustomUntil = Date.now() + 800;
    const saved = await setCustom(next);
    state.custom = saved;
    invalidateCache();
    await refreshData();
    renderPlatformList();
    renderItemList();
    renderSources();
    setStatus('已保存', 'saved');
    notifyBackground();
    return true;
  } catch (err) {
    console.error('[RuleBox] 保存自定义数据失败', err);
    setStatus('保存失败，请重试', 'error');
    toast('保存自定义数据失败', 'danger');
    return false;
  }
}

/** 新增平台时由名称生成候选 ID；中文等非 ASCII 名称回落到时间戳 ID */
function autoPlatformId(name, fallback) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug.length >= 2 ? slug : fallback;
}

function openPlatformDialog(platform) {
  if (!state.data) {
    toast('内置数据尚未加载完成，请稍后再试', 'warn');
    return;
  }
  const builtinIds = new Set((state.data.platforms || []).filter((item) => !item.custom).map((item) => item.id));
  const customIds = new Set(state.custom.platforms.map((item) => item.id));
  // 新增时名称一变就同步生成 ID；用户手动改过 ID 后不再覆盖
  let idTouched = Boolean(platform);
  const idFallback = `custom-${Date.now().toString(36)}`;

  openFormDialog({
    title: platform ? '编辑自定义平台' : '新增自定义平台',
    description: '平台会出现在语法库的平台筛选中，其字段与运算符也会提供给 AI 作为上下文。',
    submitText: platform ? '保存修改' : '新增',
    values: {
      id: platform?.id || '',
      name: platform?.name || '',
      vendor: platform?.vendor || '',
      color: platform?.color || '#3fb950',
      docUrl: platform?.docUrl || '',
      syntax: platform?.syntax || '',
      summary: platform?.summary || '',
      operators: formatPairs(platform?.operators || [], 'op'),
      fields: formatPairs(platform?.fields || [], 'key'),
      tips: (platform?.tips || []).join('\n')
    },
    fields: [
      {
        name: 'name', label: '平台名称', type: 'text', required: true, maxlength: 40,
        placeholder: '例如：内部态势感知',
        onValueChange: (value) => (idTouched ? null : { id: autoPlatformId(value, idFallback) })
      },
      {
        name: 'id', label: '平台 ID', type: 'text', mono: true, required: true, maxlength: 32,
        placeholder: '例如 internal-soc', disabled: Boolean(platform),
        hint: '唯一标识，保存后不可修改',
        onValueChange: () => {
          idTouched = true;
          return null;
        }
      },
      { name: 'vendor', label: '厂商 / 来源', type: 'text', maxlength: 40, placeholder: '可留空' },
      {
        name: 'syntax', label: '语法风格', type: 'text', mono: true, wide: true,
        placeholder: '例如：key=="value" AND key2 in ["a","b"]', hint: '会提供给 AI 作为上下文'
      },
      { name: 'summary', label: '平台简介', type: 'textarea', rows: 3, wide: true, placeholder: '这个平台是做什么用的' },
      {
        name: 'color', label: '标识色', type: 'text', mono: true, advanced: true, maxlength: 9,
        placeholder: '#3fb950', hint: '仅作界面标识，留空用默认色'
      },
      {
        name: 'docUrl', label: '官方文档地址', type: 'text', mono: true, advanced: true,
        placeholder: 'https://…（可留空）'
      },
      {
        name: 'operators', label: '运算符列表', type: 'textarea', rows: 4, advanced: true, mono: true,
        placeholder: '== | 精确匹配\n!= | 排除\nin | 集合匹配', hint: '每行一条：运算符 | 说明'
      },
      {
        name: 'fields', label: '字段列表', type: 'textarea', rows: 4, advanced: true, mono: true,
        placeholder: 'srcIP | 源 IP\ndestAddress | 目的地址', hint: '每行一条：字段 | 说明'
      },
      {
        name: 'tips', label: '使用提示', type: 'textarea', rows: 3, advanced: true,
        placeholder: '每行一条，显示在平台详情中'
      }
    ],
    onSubmit: async (form) => {
      const id = String(form.id || '').trim();
      const color = String(form.color || '').trim();
      const docUrl = String(form.docUrl || '').trim();
      if (!PLATFORM_ID_PATTERN.test(id)) return 'ID 只能包含字母、数字、下划线与短横线，长度 2 - 32';
      if (color && !COLOR_PATTERN.test(color)) return '请填写形如 #3fb950 的颜色值';
      if (docUrl && !URL_PATTERN.test(docUrl)) return '请填写 http(s) 开头的文档地址';
      if (builtinIds.has(id)) return '该 ID 与内置平台冲突，请换一个';
      if (customIds.has(id) && (!platform || platform.id !== id)) return '已存在相同 ID 的自定义平台';

      const next = {
        id,
        name: form.name.trim(),
        vendor: form.vendor.trim() || '自定义',
        kind: 'custom',
        color: form.color.trim() || '#3fb950',
        docUrl: form.docUrl.trim(),
        syntax: form.syntax.trim(),
        summary: form.summary.trim() || '用户自定义平台',
        operators: parsePairs(form.operators, 'op'),
        fields: parsePairs(form.fields, 'key'),
        tips: splitLines(form.tips)
      };

      const platforms = platform
        ? state.custom.platforms.map((item) => (item.id === platform.id ? next : item))
        : [...state.custom.platforms, next];
      // 编辑时改了 ID 的情况不会发生（ID 输入框被禁用），此处保持防御
      const items = state.custom.items;

      const ok = await commitCustom({ platforms, items });
      if (!ok) return '保存失败，请重试';
      toast(platform ? '平台已更新' : '平台已新增', 'success');
      return '';
    }
  });
}

/** 设置页打开条目表单：内置数据、自定义列表、设置与提交函数都由这里注入 */
function editItem(item = null, defaultKind = 'snippet') {
  openItemDialog({
    item,
    data: state.data,
    custom: state.custom.items,
    customPlatforms: state.custom.platforms,
    settings: state.settings,
    commit: commitCustom,
    defaultKind
  });
}

function renderPlatformList() {
  const list = $('#custom-platform-list');
  if (!list) return;
  list.replaceChildren();

  const platforms = state.custom.platforms || [];
  if (!platforms.length) {
    list.append(el('p', { className: 'rb-data-empty', text: '还没有自定义平台。点击右上角「新增平台」创建一个。' }));
    return;
  }

  for (const platform of platforms) {
    const count = state.data?.snippetGroups?.find((group) => group.platformId === platform.id)?.count || 0;
    const main = el('div', { className: 'rb-data-item-main' }, [
      el('span', { className: 'rb-data-item-title', text: platform.name }),
      el('code', { className: 'rb-data-item-code', text: platform.syntax || platform.summary || '' }),
      el('div', { className: 'rb-data-item-meta' }, [
        badge(platform.id, 'accent'),
        badge(`${count} 条语法`, 'info')
      ])
    ]);
    const editBtn = el('button', { className: 'rb-btn rb-btn--ghost rb-btn--sm', text: '编辑', attrs: { type: 'button' } });
    const delBtn = el('button', { className: 'rb-btn rb-btn--danger rb-btn--sm', text: '删除', attrs: { type: 'button' } });
    editBtn.addEventListener('click', () => openPlatformDialog(platform));
    delBtn.addEventListener('click', () => { void deletePlatform(platform); });
    list.append(el('div', { className: 'rb-data-item' }, [
      main,
      el('div', { className: 'rb-data-item-actions' }, [editBtn, delBtn])
    ]));
  }
}

function renderItemList() {
  const list = $('#custom-item-list');
  if (!list) return;
  list.replaceChildren();

  const items = state.custom.items || [];
  if (!items.length) {
    list.append(el('p', { className: 'rb-data-empty', text: '还没有自定义条目。点击右上角「新增条目」添加。' }));
    return;
  }

  for (const item of items) {
    const platformName = state.data?.platformMap?.get(item.platform)?.name || item.platform;
    const meta = el('div', { className: 'rb-data-item-meta' });
    if (item.kind === 'payload') {
      meta.append(badge('Payload', 'danger'));
      if (item.group) meta.append(badge(item.group, 'accent'));
      meta.append(riskBadge(item.risk));
    } else {
      meta.append(badge('语法', 'info'));
      if (platformName) meta.append(badge(platformName, 'accent'));
    }
    for (const tag of (item.tags || []).slice(0, 3)) meta.append(badge(`#${tag}`));

    const main = el('div', { className: 'rb-data-item-main' }, [
      el('span', { className: 'rb-data-item-title', text: item.title }),
      el('code', { className: 'rb-data-item-code', text: item.code }),
      meta
    ]);
    const editBtn = el('button', { className: 'rb-btn rb-btn--ghost rb-btn--sm', text: '编辑', attrs: { type: 'button' } });
    const delBtn = el('button', { className: 'rb-btn rb-btn--danger rb-btn--sm', text: '删除', attrs: { type: 'button' } });
    editBtn.addEventListener('click', () => editItem(item));
    delBtn.addEventListener('click', () => { void deleteItem(item); });
    list.append(el('div', { className: 'rb-data-item' }, [
      main,
      el('div', { className: 'rb-data-item-actions' }, [editBtn, delBtn])
    ]));
  }
}

async function deletePlatform(platform) {
  const related = state.custom.items
    .filter((item) => item.kind === 'snippet' && item.platform === platform.id).length;
  const ok = await confirmDialog({
    title: '删除平台',
    message: `确定删除自定义平台「${platform.name}」吗？${related ? `其下 ${related} 条自定义语法也会一并删除。` : ''}操作不可撤销。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;
  const platforms = state.custom.platforms.filter((item) => item.id !== platform.id);
  const items = state.custom.items.filter((item) => !(item.kind === 'snippet' && item.platform === platform.id));
  if (await commitCustom({ platforms, items })) toast('平台已删除', 'success');
}

async function deleteItem(item) {
  const ok = await confirmDialog({
    title: '删除条目',
    message: `确定删除「${item.title}」吗？操作不可撤销。`,
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;
  const items = state.custom.items.filter((entry) => !(entry.id === item.id && entry.kind === item.kind));
  if (await commitCustom({ platforms: state.custom.platforms, items })) toast('条目已删除', 'success');
}

/* ------------------------------------------------------------------ */
/* 内置条目显示（隐藏 / 恢复）                                          */
/* 只维护 rb.hidden 名单，内置 JSON 与自定义数据都不会被改动。            */
/* ------------------------------------------------------------------ */

const BUILTIN_PAGE = 40;
let builtinQuery = '';
let builtinOnlyHidden = false;
let builtinLimit = BUILTIN_PAGE;

/**
 * 把内置语法与 Payload 合成一份可搜索的列表。
 * 自定义条目归「自定义条目」卡片管理（编辑 / 删除），不进入这里，
 * 避免同一份数据出现两套操作入口。
 */
function builtinEntries() {
  if (!state.data) return [];
  return [
    ...(state.data.snippets || []).filter((item) => !item.custom).map((item) => ({ item, kindLabel: '语法', tone: 'info' })),
    ...(state.data.payloads || []).filter((item) => !item.custom).map((item) => ({ item, kindLabel: 'Payload', tone: 'danger' }))
  ];
}

function matchBuiltinEntry(item, query) {
  if (!query) return true;
  const platformName = state.data?.platformMap?.get(item.platform)?.name || item.platform || '';
  return [item.title, item.code, item.desc, platformName, item.group, ...(item.tags || [])]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
    .includes(query);
}

function renderBuiltinList() {
  const list = $('#builtin-item-list');
  if (!list) return;
  list.replaceChildren();

  const hiddenSet = new Set(state.hidden);
  const countNode = $('#builtin-hidden-count');
  if (countNode) countNode.textContent = `已隐藏 ${hiddenSet.size} 条`;

  const query = builtinQuery.trim().toLowerCase();
  let entries = builtinEntries();
  if (builtinOnlyHidden) entries = entries.filter((entry) => hiddenSet.has(itemKey(entry.item)));
  if (query) entries = entries.filter((entry) => matchBuiltinEntry(entry.item, query));
  entries.sort((a, b) => String(a.item.title).localeCompare(String(b.item.title), 'zh-Hans-CN'));

  const moreBtn = $('#btn-builtin-more');
  if (!entries.length) {
    const text = builtinOnlyHidden
      ? '还没有隐藏任何条目。'
      : (query ? '没有匹配的条目，换个关键词试试。' : '内置数据尚未加载完成。');
    list.append(el('p', { className: 'rb-data-empty', text }));
    if (moreBtn) moreBtn.hidden = true;
    return;
  }

  const shown = entries.slice(0, builtinLimit);
  for (const entry of shown) {
    const item = entry.item;
    const key = itemKey(item);
    const isHidden = hiddenSet.has(key);
    const meta = el('div', { className: 'rb-data-item-meta' }, [badge(entry.kindLabel, entry.tone)]);
    if (item.kind === 'snippet') {
      const platformName = state.data?.platformMap?.get(item.platform)?.name || item.platform;
      if (platformName) meta.append(badge(platformName, 'accent'));
    } else if (item.group) {
      meta.append(badge(item.group, 'accent'));
    }
    if (isHidden) meta.append(badge('已隐藏', 'warn'));

    const main = el('div', { className: 'rb-data-item-main' }, [
      el('span', { className: 'rb-data-item-title', text: item.title }),
      el('code', { className: 'rb-data-item-code', text: item.code || item.desc || '' }),
      meta
    ]);
    const action = el('button', {
      className: 'rb-btn rb-btn--ghost rb-btn--sm',
      text: isHidden ? '恢复显示' : '隐藏',
      attrs: { type: 'button' }
    });
    action.addEventListener('click', () => { void toggleHiddenItem(item); });

    list.append(el('div', {
      className: isHidden ? 'rb-data-item is-hidden' : 'rb-data-item'
    }, [main, el('div', { className: 'rb-data-item-actions' }, [action])]));
  }

  if (moreBtn) {
    const rest = entries.length - shown.length;
    moreBtn.hidden = rest <= 0;
    moreBtn.textContent = `显示更多（剩余 ${rest} 条）`;
  }
}

async function toggleHiddenItem(item) {
  const key = itemKey(item);
  const next = new Set(state.hidden);
  const willHide = !next.has(key);
  if (willHide) next.add(key);
  else next.delete(key);
  try {
    state.hidden = await setHidden([...next]);
  } catch (err) {
    console.error('[RuleBox] 保存隐藏状态失败', err);
    toast('保存隐藏状态失败，请重试', 'danger');
    return;
  }
  renderBuiltinList();
  toast(willHide ? '已隐藏，面板中不再显示' : '已恢复显示', 'success');
}

async function restoreAllHidden() {
  if (!state.hidden.length) {
    toast('当前没有隐藏的条目', 'warn');
    return;
  }
  const ok = await confirmDialog({
    title: '恢复全部显示',
    message: `确定恢复全部 ${state.hidden.length} 条被隐藏的内置条目吗？`,
    confirmText: '全部恢复'
  });
  if (!ok) return;
  try {
    state.hidden = await setHidden([]);
  } catch (err) {
    console.error('[RuleBox] 恢复内置条目失败', err);
    toast('恢复失败，请重试', 'danger');
    return;
  }
  renderBuiltinList();
  toast('已恢复全部内置条目', 'success');
}

/* ------------------------------------------------------------------ */
/* 关于页                                                               */
/* ------------------------------------------------------------------ */

function renderAboutVersion() {
  const node = $('#about-version');
  if (!node) return;
  let version = '1.0.0';
  if (hasChrome && chrome.runtime?.getManifest) {
    try {
      version = chrome.runtime.getManifest().version || version;
    } catch {
      /* 忽略 */
    }
  }
  node.textContent = `v${version}`;
}

function renderSources() {
  const list = $('#about-sources');
  if (!list) return;
  list.replaceChildren();

  const platforms = state.data?.platforms || [];
  const seen = new Set();
  const sources = [];
  for (const platform of platforms) {
    const url = String(platform.docUrl || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    sources.push({ url, vendor: platform.vendor || platform.name });
  }

  if (!sources.length) {
    list.append(el('p', { className: 'rb-data-empty', text: '暂无数据来源。' }));
    return;
  }
  for (const source of sources) {
    list.append(el('div', { className: 'rb-source-item' }, [
      el('a', {
        className: 'rb-source-name',
        text: source.url,
        attrs: { href: source.url, target: '_blank', rel: 'noopener noreferrer' }
      }),
      el('span', { text: source.vendor })
    ]));
  }
}

/* ------------------------------------------------------------------ */
/* 分区导航                                                            */
/* ------------------------------------------------------------------ */

function showSection(section) {
  if (!SECTIONS.includes(section)) section = 'general';
  const previous = currentSection;
  currentSection = section;

  if (previous === 'ai' && section !== 'ai') {
    void flushProfileForm();
  }

  for (const nav of $$('#opt-nav .rb-opt-nav-item')) {
    const active = nav.dataset.section === section;
    nav.classList.toggle('is-active', active);
    if (active) nav.setAttribute('aria-current', 'true');
    else nav.removeAttribute('aria-current');
  }
  for (const node of $$('.rb-opt-section')) {
    node.hidden = node.dataset.section !== section;
  }
  try {
    history.replaceState(null, '', `#${section}`);
  } catch {
    /* 忽略 */
  }
}

function bindNav() {
  $('#opt-nav').addEventListener('click', (event) => {
    const nav = event.target.closest('.rb-opt-nav-item');
    if (!nav) return;
    showSection(nav.dataset.section);
  });
  window.addEventListener('hashchange', () => {
    showSection((location.hash || '').replace(/^#/, '') || 'general');
  });
}

/* ------------------------------------------------------------------ */
/* 快捷键说明弹窗                                                      */
/* ------------------------------------------------------------------ */

function openShortcutsDialog() {
  // 与 popup 共用 isMacPlatform，避免两处平台判断正则不一致
  const modKey = isMacPlatform() ? '⌘' : 'Ctrl';
  const list = el('div', { className: 'rb-shortcut-list' });
  const rows = [
    [`${modKey} + Shift + Y`, '打开 / 收起 RuleBox 面板'],
    [`${modKey} + K`, '聚焦搜索框'],
    [`${modKey} + 1`, '切换到语法库'],
    [`${modKey} + 2`, '切换到 Payload'],
    [`${modKey} + 3`, '切换到 AI 助手'],
    [`${modKey} + Enter`, '在 AI 输入框中发送消息'],
    ['Esc', '关闭弹窗 / 清空搜索框']
  ];
  for (const [keys, label] of rows) {
    const keyNodes = keys.split(' + ').map((key) => el('kbd', { className: 'rb-kbd', text: key }));
    list.append(el('div', { className: 'rb-shortcut-row' }, [
      el('span', { className: 'rb-shortcut-label', text: label }),
      el('span', { className: 'rb-shortcut-keys' }, keyNodes)
    ]));
  }
  openInfoDialog('快捷键', list);
}

/* ------------------------------------------------------------------ */
/* 表单填充与绑定                                                      */
/* ------------------------------------------------------------------ */

function updateThemeButton() {
  const button = $('#btn-theme');
  if (!button) return;
  const meta = themeMeta(state.settings?.theme || 'auto');
  button.replaceChildren(icon(meta.icon));
  const label = `切换主题（当前：${meta.label}）`;
  button.setAttribute('aria-label', label);
  button.title = label;
}

/** 系统提示词状态徽标：空字符串即使用内置默认 */
function updateSystemPromptState() {
  const node = $('#ai-system-prompt-state');
  if (!node) return;
  const custom = String(state.settings?.ai?.systemPrompt || '').trim();
  node.textContent = custom ? '自定义' : '内置默认';
  node.title = custom
    ? '当前使用你编辑的提示词；点击“恢复默认”可回到内置版本'
    : '当前使用内置提示词';
}

function fillAll() {
  const settings = state.settings;
  $('#opt-theme').value = settings.theme;
  $('#opt-default-tab').value = settings.ui.defaultTab;
  $('#opt-copy-format').value = settings.ui.copyFormat;
  $('#opt-recents-limit').value = String(settings.ui.recentsLimit);
  $('#opt-close-after-copy').checked = Boolean(settings.ui.closeAfterCopy);
  $('#opt-show-desc').checked = Boolean(settings.ui.showDesc);
  $('#opt-show-risk').checked = Boolean(settings.ui.showRiskBadges);
  $('#opt-side-panel').checked = Boolean(settings.features.sidePanel);
  $('#opt-context-menu').checked = Boolean(settings.features.contextMenu);
  $('#opt-ai-feature').checked = Boolean(settings.features.ai);

  syncAiSwitches();
  renderProviderOptions();
  renderProfileOptions();
  fillProfileForm();
  $('#opt-ai-history-limit').value = String(settings.ai.historyLimit);
  $('#opt-ai-min-interval').value = String(settings.ai.minIntervalMs);
  $('#opt-ai-daily-limit').value = String(settings.ai.dailyRequestLimit);
  $('#opt-ai-stream').checked = Boolean(settings.ai.stream);
  $('#opt-ai-context').checked = Boolean(settings.ai.includePlatformContext);
  $('#opt-ai-library').checked = Boolean(settings.ai.includeLibraryExamples);
  // 空字符串代表使用内置默认，设置页直接展示生效内容，避免用户只看到空白
  $('#opt-ai-system-prompt').value = settings.ai.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  $('#opt-ai-system-append').value = settings.ai.systemPromptAppend || '';
  updateSystemPromptState();

  updateThemeButton();
}

function bindCheckbox(selector, mutator, after) {
  const node = $(selector);
  node.addEventListener('change', async () => {
    const checked = node.checked;
    const saved = await updateSettings((draft) => { mutator(draft, checked); });
    if (saved && after) after(saved);
  });
}

function bindHeader() {
  $('#btn-shortcuts').addEventListener('click', openShortcutsDialog);
  $('#btn-theme').addEventListener('click', async () => {
    const saved = await updateSettings((draft) => { draft.theme = nextTheme(draft.theme); });
    if (saved) {
      applyTheme(saved.theme);
      updateThemeButton();
    }
  });
}

function bindGeneral() {
  $('#opt-theme').addEventListener('change', async () => {
    const saved = await updateSettings((draft) => { draft.theme = $('#opt-theme').value; });
    if (saved) {
      applyTheme(saved.theme);
      updateThemeButton();
    }
  });

  $('#opt-default-tab').addEventListener('change', () => {
    void updateSettings((draft) => { draft.ui.defaultTab = $('#opt-default-tab').value; });
  });

  $('#opt-copy-format').addEventListener('change', () => {
    void updateSettings((draft) => { draft.ui.copyFormat = $('#opt-copy-format').value; });
  });

  $('#opt-recents-limit').addEventListener('change', async () => {
    const saved = await updateSettings((draft) => {
      draft.ui.recentsLimit = Math.round(clamp(numberOr($('#opt-recents-limit').value, 20), 5, 100));
    });
    if (saved) $('#opt-recents-limit').value = String(saved.ui.recentsLimit);
  });

  bindCheckbox('#opt-close-after-copy', (draft, checked) => { draft.ui.closeAfterCopy = checked; });
  bindCheckbox('#opt-show-desc', (draft, checked) => { draft.ui.showDesc = checked; });
  bindCheckbox('#opt-show-risk', (draft, checked) => { draft.ui.showRiskBadges = checked; });
  bindCheckbox('#opt-side-panel', (draft, checked) => { draft.features.sidePanel = checked; }, () => notifyBackground());
  bindCheckbox('#opt-context-menu', (draft, checked) => { draft.features.contextMenu = checked; }, () => notifyBackground());
  // 双开关：features.ai 控制界面展示，ai.enabled 控制是否发起请求，两者保持同步
  bindCheckbox('#opt-ai-feature', (draft, checked) => {
    draft.features.ai = checked;
    draft.ai.enabled = checked;
  }, () => syncAiSwitches());
}

function bindAi() {
  $('#opt-ai-enabled').addEventListener('change', async () => {
    const checked = $('#opt-ai-enabled').checked;
    const saved = await updateSettings((draft) => {
      draft.features.ai = checked;
      draft.ai.enabled = checked;
    });
    if (saved) syncAiSwitches();
  });

  $('#opt-ai-profile').addEventListener('change', () => { void switchProfile($('#opt-ai-profile').value); });
  $('#btn-ai-profile-add').addEventListener('click', () => { void addProfile(); });
  $('#btn-ai-profile-del').addEventListener('click', () => { void deleteProfile(); });

  $('#opt-ai-provider').addEventListener('change', () => applyProviderPreset($('#opt-ai-provider').value));

  for (const selector of ['#opt-ai-name', '#opt-ai-baseurl', '#opt-ai-model', '#opt-ai-key',
    '#opt-ai-temperature', '#opt-ai-max-tokens', '#opt-ai-timeout', '#opt-ai-extra-body']) {
    $(selector).addEventListener('input', scheduleProfileSave);
  }
  $('#opt-ai-thinking').addEventListener('change', scheduleProfileSave);

  $('#btn-ai-key-toggle').addEventListener('click', () => {
    changeKeyVisibility($('#opt-ai-key').type !== 'text');
  });

  $('#btn-ai-authorize').addEventListener('click', () => { void handleAuthorize(); });
  $('#btn-ai-test').addEventListener('click', () => { void handleTest(); });

  $('#opt-ai-history-limit').addEventListener('change', async () => {
    const saved = await updateSettings((draft) => {
      draft.ai.historyLimit = Math.round(clamp(numberOr($('#opt-ai-history-limit').value, 6), 0, 20));
    });
    if (saved) $('#opt-ai-history-limit').value = String(saved.ai.historyLimit);
  });

  $('#opt-ai-min-interval').addEventListener('change', async () => {
    const saved = await updateSettings((draft) => {
      draft.ai.minIntervalMs = Math.round(clamp(numberOr($('#opt-ai-min-interval').value, 1500), 0, 60000));
    });
    if (saved) $('#opt-ai-min-interval').value = String(saved.ai.minIntervalMs);
  });

  $('#opt-ai-daily-limit').addEventListener('change', async () => {
    const saved = await updateSettings((draft) => {
      draft.ai.dailyRequestLimit = Math.round(clamp(numberOr($('#opt-ai-daily-limit').value, 200), 0, 100000));
    });
    if (saved) $('#opt-ai-daily-limit').value = String(saved.ai.dailyRequestLimit);
  });

  bindCheckbox('#opt-ai-stream', (draft, checked) => { draft.ai.stream = checked; });
  bindCheckbox('#opt-ai-context', (draft, checked) => { draft.ai.includePlatformContext = checked; });
  bindCheckbox('#opt-ai-library', (draft, checked) => { draft.ai.includeLibraryExamples = checked; });

  $('#opt-ai-system-append').addEventListener('input', debounce(() => {
    void updateSettings((draft) => { draft.ai.systemPromptAppend = $('#opt-ai-system-append').value; });
  }, 400));

  $('#opt-ai-system-prompt').addEventListener('input', debounce(() => {
    const value = $('#opt-ai-system-prompt').value;
    const normalized = value.trim();
    // 与内置文本完全一致时不落库，未来扩展升级默认提示词才能自动生效
    const useDefault = !normalized || normalized === DEFAULT_SYSTEM_PROMPT.trim();
    updateSettings((draft) => {
      draft.ai.systemPrompt = useDefault ? '' : value;
    }).then((saved) => {
      if (saved) updateSystemPromptState();
    });
  }, 400));

  // 清空后失焦自动回填默认文本，避免用户以为提示词被删没了
  $('#opt-ai-system-prompt').addEventListener('blur', () => {
    if ($('#opt-ai-system-prompt').value.trim()) return;
    $('#opt-ai-system-prompt').value = DEFAULT_SYSTEM_PROMPT;
  });

  $('#btn-ai-system-reset').addEventListener('click', async () => {
    const saved = await updateSettings((draft) => { draft.ai.systemPrompt = ''; });
    if (!saved) return;
    $('#opt-ai-system-prompt').value = DEFAULT_SYSTEM_PROMPT;
    updateSystemPromptState();
    toast('已恢复内置系统提示词', 'success');
  });

  $('#btn-ai-clear-history').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '清空 AI 对话历史',
      message: '确定清空全部 AI 对话历史吗？操作不可撤销。',
      confirmText: '清空',
      danger: true
    });
    if (!ok) return;
    await setAiHistory([]);
    toast('AI 对话历史已清空', 'success');
  });
}

function bindData() {
  $('#btn-platform-add').addEventListener('click', () => openPlatformDialog(null));
  $('#btn-item-add').addEventListener('click', () => editItem(null));

  const builtinSearch = $('#builtin-search');
  builtinSearch?.addEventListener('input', debounce(() => {
    builtinQuery = builtinSearch.value;
    builtinLimit = BUILTIN_PAGE;
    renderBuiltinList();
  }, 150));

  $('#builtin-only-hidden')?.addEventListener('change', (event) => {
    builtinOnlyHidden = Boolean(event.target.checked);
    builtinLimit = BUILTIN_PAGE;
    renderBuiltinList();
  });

  $('#btn-hidden-restore-all')?.addEventListener('click', () => { void restoreAllHidden(); });

  $('#btn-builtin-more')?.addEventListener('click', () => {
    builtinLimit += BUILTIN_PAGE;
    renderBuiltinList();
  });

  $('#btn-clear-recents').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '清空最近使用',
      message: '确定清空最近使用记录吗？',
      confirmText: '清空',
      danger: true
    });
    if (!ok) return;
    await setRecents([]);
    toast('最近使用已清空', 'success');
  });

  $('#btn-clear-variables').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '清空变量记忆',
      message: '确定清空所有已记忆的变量值吗？',
      confirmText: '清空',
      danger: true
    });
    if (!ok) return;
    await setVariables({});
    toast('变量记忆已清空', 'success');
  });

  $('#btn-clear-favorites').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '清空收藏',
      message: '确定清空全部收藏吗？',
      confirmText: '清空',
      danger: true
    });
    if (!ok) return;
    await setFavorites([]);
    toast('收藏已清空', 'success');
  });
}

function bindImport() {
  $('#btn-export').addEventListener('click', () => { void handleExport(); });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // 允许连续导入同一文件
    if (file) await handleImport(file);
  });

  $('#btn-reset').addEventListener('click', () => { void handleReset(); });
}

/* ------------------------------------------------------------------ */
/* storage 同步（只响应 custom / usage，不响应 settings，                  */
/* 避免其他页面改设置时覆盖正在编辑的表单）                              */
/* ------------------------------------------------------------------ */

function handleStorageChange(changes) {
  if (changes[STORAGE_KEYS.hidden]) {
    void (async () => {
      state.hidden = await getHidden();
      renderBuiltinList();
    })();
  }
  if (changes[STORAGE_KEYS.custom]) {
    if (Date.now() < ignoreCustomUntil) return;
    void (async () => {
      state.custom = await getCustom();
      invalidateCache();
      await refreshData();
      renderPlatformList();
      renderItemList();
      renderSources();
    })();
    return;
  }
  if (changes[STORAGE_KEYS.usage]) {
    void renderUsage();
  }
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  if (initialized) return;
  initialized = true;

  state.settings = await getSettings();
  state.custom = await getCustom();
  applyTheme(state.settings.theme);
  updateThemeButton();

  bindHeader();
  bindNav();
  bindGeneral();
  bindAi();
  bindData();
  bindImport();

  fillAll();
  renderAboutVersion();

  // 从面板“已隐藏 N 条 · 恢复”跳转过来时默认只看已隐藏，
  // 避免用户落在一整份内置条目列表里还要自己找勾选框
  if (new URLSearchParams(location.search).get('onlyHidden') === '1') {
    builtinOnlyHidden = true;
    const onlyHidden = $('#builtin-only-hidden');
    if (onlyHidden) onlyHidden.checked = true;
  }

  await refreshData();
  renderPlatformList();
  renderItemList();
  renderSources();
  await renderUsage();

  onStorageChanged(handleStorageChange);

  const hash = (location.hash || '').replace(/^#/, '');
  showSection(SECTIONS.includes(hash) ? hash : 'general');

  notifyBackground();
}

function handleInitError(err) {
  console.error('[RuleBox] 设置页初始化失败', err);
  setStatus('初始化失败，请刷新页面重试', 'error');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init().catch(handleInitError); });
} else {
  init().catch(handleInitError);
}
