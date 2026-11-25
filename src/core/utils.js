/**
 * 通用工具函数
 * 说明：本项目不使用任何构建工具，所有模块为原生 ES Module，便于审计。
 */

/** 查询单个元素 */
export function $(selector, root = document) {
  return root.querySelector(selector);
}

/** 查询多个元素并转为数组 */
export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * 创建 DOM 元素
 * 统一使用 textContent 写入文本，避免 innerHTML 带来的 XSS 风险。
 */
export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  const { className, text, html, attrs, dataset, style } = options;

  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  // html 仅用于内部可信的静态 SVG 图标，禁止传入用户或 AI 内容
  if (html !== undefined) node.innerHTML = html;

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value === null || value === undefined) continue;
      if (key === 'disabled' || key === 'checked' || key === 'selected') {
        node[key] = Boolean(value);
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }

  if (dataset) {
    for (const [key, value] of Object.entries(dataset)) {
      if (value !== undefined && value !== null) node.dataset[key] = String(value);
    }
  }

  if (style) {
    for (const [key, value] of Object.entries(style)) {
      node.style.setProperty(key, String(value));
    }
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/** 防抖 */
export function debounce(fn, delay = 200) {
  let timer = null;
  return function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, delay);
  };
}

/** 生成短 ID */
export function uid(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

/** 限制数值范围 */
export function clamp(value, min, max) {
  const num = Number(value);
  if (Number.isNaN(num)) return min;
  return Math.min(max, Math.max(min, num));
}

/** 安全 JSON 解析，失败返回兜底值 */
export function safeParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * 校验是否为允许的 http(s) 地址
 * 内置 AI 提供商使用 https；本地 Ollama 允许 http://localhost 或 127.0.0.1
 */
export function isAllowedEndpoint(url, { allowLocalHttp = true } = {}) {
  if (typeof url !== 'string' || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (allowLocalHttp && parsed.protocol === 'http:') {
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  }
  return false;
}

/** 去除 URL 末尾斜杠 */
export function trimTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

/** 格式化时间戳为可读文本 */
export function formatTime(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 截断文本 */
export function truncate(text, max = 120) {
  const str = String(text || '');
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/** 字节数格式化 */
export function formatBytes(bytes) {
  const num = Number(bytes) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / 1024 / 1024).toFixed(2)} MB`;
}

/** 复制文本并返回是否成功 */
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // 回退到临时 textarea 方案
    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 规范化下载文件名
 * 只保留纯文件名，去掉路径分隔符与控制字符，防止条目数据里出现「../」之类的内容
 * 造成写到下载目录以外的地方。
 */
export function sanitizeFilename(name, fallback = 'rulebox.txt') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/**
 * Base64 解码为字节数组
 * 兼容 data URL 前缀（data:image/png;base64,）与换行空白；非法输入返回 null，由调用方提示
 * @param {string} value
 * @returns {Uint8Array|null}
 */
export function base64ToBytes(value) {
  const raw = String(value || '').trim().replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) return null;
  try {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * 把若干片段（字符串或 Uint8Array）拼成 Blob 并触发下载
 * 字符串按 UTF-8 编码，Uint8Array 原样写入，用于「二进制前缀 + 文本代码」这类图片马成品
 * @param {string} filename
 * @param {Array<string|Uint8Array>} parts
 * @param {string} mime
 * @returns {number} 写入字节数，内容为空时返回 0
 */
export function downloadBlob(filename, parts, mime = 'application/octet-stream') {
  const list = (parts || []).filter((part) => (typeof part === 'string' ? part.length : part?.length));
  if (!list.length) return 0;
  const blob = new Blob(list, { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFilename(filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 立即 revoke 会让下载读不到数据，留出窗口期；popup 关闭后定时器随文档销毁，无副作用
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return blob.size;
}

/**
 * 把文本另存为文件（Blob + <a download>）
 * 不申请 downloads 权限：语法与 Payload 都是体积很小的文本，锚点下载即可完成。
 * @returns {number} 写入的字节数，内容为空时返回 0（调用方据此提示）
 */
export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const content = String(text ?? '');
  if (!content) return 0;
  return downloadBlob(filename, [content], mime);
}

/** 等待指定毫秒 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 数组去重 */
export function unique(list) {
  return Array.from(new Set(list));
}

/**
 * 是否 macOS / iOS 环境（用于快捷键文案显示 ⌘ 还是 Ctrl）。
 * popup 与设置页共用这一处判断，避免两个宿主各写一套正则而出现文案不一致。
 */
export function isMacPlatform() {
  const platform = String(navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  return platform.includes('mac') || /mac os x|iphone|ipad/.test(String(navigator.userAgent).toLowerCase());
}
