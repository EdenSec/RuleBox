/**
 * 剪贴板模块
 * 复制内容统一走这里，便于统计与格式控制。
 */

import { copyText } from './utils.js';

/** 根据设置格式化复制内容 */
export function formatCopy(item, format = 'code') {
  const code = String(item?.code || '');
  if (format === 'markdown') {
    // 语法与 Payload 都不是严格意义上的可高亮代码，统一标注为 text
    return `\`\`\`text\n${code}\n\`\`\``;
  }
  if (format === 'title-code') {
    return `${item?.title || ''}\n${code}`;
  }
  return code;
}

/** 复制条目 */
export async function copyItem(item, format = 'code') {
  const text = formatCopy(item, format);
  const ok = await copyText(text);
  return { ok, text };
}

/** 复制任意文本 */
export async function copyPlain(text) {
  return copyText(text);
}
