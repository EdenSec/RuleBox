/**
 * 轻量日志
 * 仅在内存中保留最近若干条，便于在设置页查看；不写入磁盘，不上传。
 * 严禁把密钥、Cookie、Token 写入日志。
 */

const MAX_ENTRIES = 100;
const entries = [];

const SECRET_PATTERN = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|api[_-]?key["'\s:=]+[A-Za-z0-9._-]{8,})/gi;

/** 脱敏 */
export function mask(text) {
  return String(text ?? '').replace(SECRET_PATTERN, '[已隐藏]');
}

function push(level, message, extra) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message: mask(message),
    extra: extra ? mask(typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  if (level === 'error') {
    console.error('[RuleBox]', entry.message, entry.extra);
  } else if (level === 'warn') {
    console.warn('[RuleBox]', entry.message, entry.extra);
  }
}

export const logger = {
  info(message, extra) {
    push('info', message, extra);
  },
  warn(message, extra) {
    push('warn', message, extra);
  },
  error(message, extra) {
    push('error', message, extra);
  },
  list() {
    return entries.slice();
  },
  clear() {
    entries.length = 0;
  }
};
