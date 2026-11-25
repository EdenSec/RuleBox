/**
 * 本地示例召回
 * 从内置语法库 / Payload 库中挑出与本次问题最接近的少量条目，作为 few-shot 示例随请求发送。
 * 纯本地计算：不联网、不上传全库，只把召回到的几条拼进提示词。
 */

/**
 * 中文高频双字组。
 * 自然语言问句里大量出现这些词，若参与匹配会把完全不相关的条目顶上来。
 */
const STOP_BIGRAMS = new Set([
  '帮我', '生成', '语法', '查询', '语句', '请给', '请列', '说明', '一下', '我要', '需要',
  '如何', '怎么', '能否', '可以', '全部', '所有', '每个', '以及', '并且', '同时', '然后',
  '这个', '那个', '一个', '我们', '你们', '他们', '是否', '进行', '使用', '相关', '对应',
  '输出', '列出', '给出', '告诉', '具体', '尽量', '要求', '注意', '问题', '当前', '目标',
  '哪种', '哪些', '什么', '怎样', '还有', '另外', '如果', '其中', '已经', '自己', '用来'
]);

/** 英文虚词：出现在问句里但没有检索价值 */
const ASCII_STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'were',
  'you', 'can', 'not', 'but', 'any', 'use', 'using', 'get', 'set', 'its', 'our'
]);

/** 低于该分数视为不相关，宁可不给示例也不给错示例 */
const MIN_SCORE = 6;

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, ' ')
    .trim();
}

/** 提取英文 / 数字词元（redis、spring、heapdump、200 等） */
function asciiTokensOf(text) {
  const tokens = normalize(text).split(/\s+/);
  const result = [];
  for (const token of tokens) {
    if (!/^[a-z0-9._-]+$/.test(token)) continue;
    if (token.length < 2 || ASCII_STOP.has(token)) continue;
    if (!result.includes(token)) result.push(token);
  }
  return result;
}

/** 把中文连续片段切成双字组，避免依赖分词库 */
function bigramsOf(text) {
  const result = [];
  const runs = String(text || '').match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const run of runs) {
    for (let index = 0; index < run.length - 1; index += 1) {
      const gram = run.slice(index, index + 2);
      if (STOP_BIGRAMS.has(gram)) continue;
      if (!result.includes(gram)) result.push(gram);
    }
  }
  return result;
}

function pick(item) {
  return {
    id: item.id || '',
    kind: item.kind || '',
    title: String(item.title || ''),
    code: String(item.code || ''),
    desc: String(item.desc || ''),
    score: 0
  };
}

function scoreItem(item, context) {
  const title = String(item.title || '').toLowerCase();
  const tags = (Array.isArray(item.tags) ? item.tags.join(' ') : '').toLowerCase();
  const meta = `${tags} ${item.category || ''} ${item.group || ''}`.toLowerCase();
  const body = `${item.code || ''} ${item.desc || ''}`.toLowerCase();
  const primary = `${title} ${meta}`;

  let score = 0;

  for (const token of context.asciiTokens) {
    if (primary.includes(token)) score += 8;
    else if (body.includes(token)) score += 3;
  }

  // 标题命中权重最高；同一维度最多计三次，避免长文本靠堆字把分数刷高
  let titleHits = 0;
  let metaHits = 0;
  let bodyHits = 0;
  for (const gram of context.bigrams) {
    if (titleHits < 3 && title.includes(gram)) {
      score += 5;
      titleHits += 1;
    } else if (metaHits < 3 && meta.includes(gram)) {
      score += 4;
      metaHits += 1;
    } else if (bodyHits < 3 && body.includes(gram)) {
      score += 1;
      bodyHits += 1;
    }
  }

  return score;
}

/**
 * 召回示例
 * @param {object} params
 * @param {string} params.question 用户本次问题
 * @param {Array} params.snippets 语法条目（已按隐藏名单过滤）
 * @param {Array} params.payloads Payload 条目
 * @param {string} params.platformId 当前 AI 目标平台，'all' 表示不限定
 * @param {number} params.limit 最多返回几条
 * @param {number} params.maxChars 示例总长度上限（字符）
 * @returns {Array<{id:string,kind:string,title:string,code:string,desc:string,score:number}>}
 */
export function retrieveExamples({
  question,
  snippets = [],
  payloads = [],
  platformId = 'all',
  limit = 5,
  maxChars = 1200
} = {}) {
  const text = String(question || '').trim();
  if (!text) return [];

  const context = { asciiTokens: asciiTokensOf(text), bigrams: bigramsOf(text) };
  if (!context.asciiTokens.length && !context.bigrams.length) return [];

  // 指定平台时只看该平台的语法；两者混用容易让模型把测绘语法和 Payload 拼在一起
  const pool = platformId && platformId !== 'all'
    ? snippets.filter((item) => item.platform === platformId)
    : snippets.concat(payloads);
  if (!pool.length) return [];

  const seenCode = new Set();
  const scored = [];

  for (const item of pool) {
    if (!item || !item.code) continue;
    const score = scoreItem(item, context);
    if (score < MIN_SCORE) continue;

    const key = String(item.code).replace(/\s+/g, '').toLowerCase();
    if (seenCode.has(key)) continue;
    seenCode.add(key);

    scored.push({ ...pick(item), score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title, 'zh-Hans-CN');
  });

  const selected = [];
  let used = 0;
  for (const item of scored) {
    const cost = item.title.length + item.code.length + item.desc.length;
    if (selected.length >= limit) break;
    if (used + cost > maxChars) continue;
    used += cost;
    selected.push(item);
  }

  return selected;
}
