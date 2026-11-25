/**
 * 存储层
 * 优先使用 chrome.storage.local；在普通网页预览时回退到 localStorage，便于本地调试。
 * 注意：密钥只保存在本地，不参与导出。
 */

import { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_CUSTOM, DEFAULT_USAGE, mergeSettings } from './defaults.js';

const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

function localGet(keys) {
  const result = {};
  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      try {
        result[key] = JSON.parse(raw);
      } catch {
        result[key] = raw;
      }
    }
  }
  return result;
}

function localSet(items) {
  for (const [key, value] of Object.entries(items)) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
}

/** 读取若干键 */
export async function getItems(keys) {
  const list = [].concat(keys);
  if (hasChromeStorage) {
    return chrome.storage.local.get(list);
  }
  return localGet(list);
}

/** 写入若干键 */
export async function setItems(items) {
  if (hasChromeStorage) {
    await chrome.storage.local.set(items);
    return;
  }
  localSet(items);
}

/** 删除若干键 */
export async function removeItems(keys) {
  const list = [].concat(keys);
  if (hasChromeStorage && chrome.storage.local.remove) {
    await chrome.storage.local.remove(list);
    return;
  }
  for (const key of list) window.localStorage.removeItem(key);
}

/** 读取设置（带默认值合并） */
export async function getSettings() {
  const data = await getItems(STORAGE_KEYS.settings);
  return mergeSettings(data[STORAGE_KEYS.settings]);
}

/** 保存设置（自动补全默认字段） */
export async function saveSettings(settings) {
  const merged = mergeSettings(settings);
  await setItems({ [STORAGE_KEYS.settings]: merged });
  return merged;
}

/**
 * 局部更新设置。
 * 用串行队列避免“读取-修改-写回”竞态：连续快速切换多个开关时，
 * 若并发执行会互相覆盖，导致部分修改丢失。
 */
let settingsWriteQueue = Promise.resolve();

export function patchSettings(updater) {
  const run = async () => {
    const current = await getSettings();
    const next = typeof updater === 'function' ? updater(structuredClone(current)) : { ...current, ...updater };
    return saveSettings(next);
  };
  const result = settingsWriteQueue.then(run, run);
  // 队列不因单次失败而中断
  settingsWriteQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/** 收藏 */
export async function getFavorites() {
  const data = await getItems(STORAGE_KEYS.favorites);
  return Array.isArray(data[STORAGE_KEYS.favorites]) ? data[STORAGE_KEYS.favorites] : [];
}

export async function setFavorites(list) {
  const value = Array.isArray(list) ? list : [];
  await setItems({ [STORAGE_KEYS.favorites]: value });
  return value;
}

/**
 * 最近使用记录规范化。
 * 旧版本只存条目 key 字符串，这里统一升级为 { key, count, lastUsed }：
 * - count 记录复制次数，用于“常用优先”的排序；
 * - lastUsed 记录最近一次使用时间，次数相同时按时间倒序。
 * 读取时容错旧格式，避免升级后历史记录全部失效。
 */
export function normalizeRecents(list) {
  if (!Array.isArray(list)) return [];
  const map = new Map();
  for (const entry of list) {
    const key = typeof entry === 'string' ? entry : String(entry?.key || '');
    if (!key) continue;
    const count = typeof entry === 'object' && entry
      ? Math.max(1, Math.round(Number(entry.count) || 1))
      : 1;
    const lastUsed = typeof entry === 'object' && entry ? Number(entry.lastUsed) || 0 : 0;
    const prev = map.get(key);
    if (prev) {
      map.set(key, {
        key,
        count: prev.count + count,
        lastUsed: Math.max(prev.lastUsed, lastUsed)
      });
    } else {
      map.set(key, { key, count, lastUsed });
    }
  }
  return Array.from(map.values()).sort(compareRecents);
}

/** 排序规则：复制次数优先，次数相同按最近使用时间倒序 */
export function compareRecents(a, b) {
  return b.count - a.count || b.lastUsed - a.lastUsed;
}

/** 最近使用 */
export async function getRecents() {
  const data = await getItems(STORAGE_KEYS.recents);
  return normalizeRecents(data[STORAGE_KEYS.recents]);
}

export async function setRecents(list) {
  const value = normalizeRecents(list);
  await setItems({ [STORAGE_KEYS.recents]: value });
  return value;
}

/** 变量记忆 */
export async function getVariables() {
  const data = await getItems(STORAGE_KEYS.variables);
  const value = data[STORAGE_KEYS.variables];
  return value && typeof value === 'object' ? value : {};
}

export async function setVariables(vars) {
  const value = vars && typeof vars === 'object' ? vars : {};
  await setItems({ [STORAGE_KEYS.variables]: value });
  return value;
}

/** 自定义数据 */
export async function getCustom() {
  const data = await getItems(STORAGE_KEYS.custom);
  const value = data[STORAGE_KEYS.custom];
  if (!value || typeof value !== 'object') return structuredClone(DEFAULT_CUSTOM);
  return {
    platforms: Array.isArray(value.platforms) ? value.platforms : [],
    items: Array.isArray(value.items) ? value.items : []
  };
}

export async function setCustom(custom) {
  const value = {
    platforms: Array.isArray(custom?.platforms) ? custom.platforms : [],
    items: Array.isArray(custom?.items) ? custom.items : []
  };
  await setItems({ [STORAGE_KEYS.custom]: value });
  return value;
}

/**
 * 内置条目隐藏名单。
 * 只是“不在面板展示”，内置 JSON 与自定义数据都不受影响，随时可恢复。
 * 统一存 kind:id，与收藏、最近使用的键格式保持一致。
 */
export async function getHidden() {
  const data = await getItems(STORAGE_KEYS.hidden);
  const value = data[STORAGE_KEYS.hidden];
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((key) => String(key || '')).filter(Boolean)));
}

export async function setHidden(list) {
  const value = Array.from(new Set((Array.isArray(list) ? list : []).map((key) => String(key || '')).filter(Boolean)));
  await setItems({ [STORAGE_KEYS.hidden]: value });
  return value;
}

/** AI 历史 */
export async function getAiHistory() {
  const data = await getItems(STORAGE_KEYS.aiHistory);
  return Array.isArray(data[STORAGE_KEYS.aiHistory]) ? data[STORAGE_KEYS.aiHistory] : [];
}

export async function setAiHistory(list) {
  const value = Array.isArray(list) ? list : [];
  await setItems({ [STORAGE_KEYS.aiHistory]: value });
  return value;
}

/** 每日用量统计 */
export async function getUsage() {
  const data = await getItems(STORAGE_KEYS.usage);
  const value = data[STORAGE_KEYS.usage];
  if (!value || typeof value !== 'object') return structuredClone(DEFAULT_USAGE);
  return { date: value.date || '', count: Number(value.count) || 0 };
}

export async function bumpUsage() {
  const today = new Date().toISOString().slice(0, 10);
  const current = await getUsage();
  const next = current.date === today ? { date: today, count: current.count + 1 } : { date: today, count: 1 };
  await setItems({ [STORAGE_KEYS.usage]: next });
  return next;
}

/** 监听设置变化（同一浏览器内多页面同步） */
export function onStorageChanged(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return () => {};
  const handler = (changes, area) => {
    if (area !== 'local') return;
    callback(changes);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/** 导出配置（不含任何密钥） */
export async function exportConfig() {
  const settings = await getSettings();
  const [favorites, variables, custom] = await Promise.all([getFavorites(), getVariables(), getCustom()]);

  const safeSettings = structuredClone(settings);
  safeSettings.ai = { ...safeSettings.ai };
  safeSettings.ai.profiles = safeSettings.ai.profiles.map((profile) => ({
    ...profile,
    apiKey: ''
  }));

  return {
    app: 'RuleBox',
    type: 'config',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: safeSettings,
    favorites,
    variables,
    custom
  };
}

/** 校验并导入配置 */
export function validateConfig(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: '文件内容不是有效的 JSON 对象' };
  }
  if (payload.app !== 'RuleBox' || payload.type !== 'config') {
    return { ok: false, message: '不是 RuleBox 配置文件' };
  }
  if (!payload.settings || typeof payload.settings !== 'object') {
    return { ok: false, message: '缺少 settings 字段' };
  }
  return { ok: true };
}

/** 应用导入配置 */
export async function applyConfig(payload) {
  const settings = mergeSettings(payload.settings);
  // 导入时清空密钥，避免把旧机器的密钥带进来
  settings.ai.profiles = settings.ai.profiles.map((profile) => ({ ...profile, apiKey: '' }));

  await setItems({
    [STORAGE_KEYS.settings]: settings,
    [STORAGE_KEYS.favorites]: Array.isArray(payload.favorites) ? payload.favorites : [],
    [STORAGE_KEYS.variables]: payload.variables && typeof payload.variables === 'object' ? payload.variables : {},
    [STORAGE_KEYS.custom]: {
      platforms: Array.isArray(payload.custom?.platforms) ? payload.custom.platforms : [],
      items: Array.isArray(payload.custom?.items) ? payload.custom.items : []
    }
  });

  return settings;
}

/** 重置全部数据 */
export async function resetAll() {
  await removeItems(Object.values(STORAGE_KEYS));
}
