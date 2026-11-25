/**
 * 检索模块
 * 纯前端本地检索，不发送任何数据到外部。
 */

/** 把查询串拆为小写词元 */
function tokenize(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** 计算单条得分，0 表示不匹配 */
function scoreItem(item, tokens, platformName = '') {
  const title = item.title.toLowerCase();
  const code = item.code.toLowerCase();
  const desc = item.desc.toLowerCase();
  const category = item.category.toLowerCase();
  const tags = item.tags.join(' ').toLowerCase();
  const group = String(item.group || '').toLowerCase();
  const platform = platformName.toLowerCase();

  let total = 0;

  for (const token of tokens) {
    let tokenScore = 0;
    if (title.includes(token)) tokenScore += 6;
    if (tags.includes(token)) tokenScore += 4;
    if (category.includes(token)) tokenScore += 3;
    if (group.includes(token)) tokenScore += 3;
    if (platform.includes(token)) tokenScore += 3;
    if (code.includes(token)) tokenScore += 2;
    if (desc.includes(token)) tokenScore += 1;

    // 任一词元完全未命中则整体不匹配，保证结果是“与”关系
    if (tokenScore === 0) return 0;
    total += tokenScore;
  }

  // 完全等于标题的加权
  if (tokens.length && title === tokens.join(' ')) total += 20;
  // 自定义条目略微降权，保证内置条目优先
  if (item.custom) total -= 1;
  return total;
}

/**
 * 检索条目
 * @param {Array} items 条目数组
 * @param {string} query 查询串
 * @param {object} options { platformMap }
 */
export function searchItems(items, query, options = {}) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return items.slice();

  const platformMap = options.platformMap || new Map();
  const scored = [];

  for (const item of items) {
    const platformName = platformMap.get(item.platform)?.name || '';
    const score = scoreItem(item, tokens, platformName);
    if (score > 0) scored.push({ item, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.title.localeCompare(b.item.title, 'zh-Hans-CN');
  });

  return scored.map((entry) => entry.item);
}

/** 过滤：分类 */
export function filterByCategory(items, category) {
  if (!category || category === 'all') return items;
  return items.filter((item) => item.category === category);
}

/** 统计分类数量 */
export function countCategories(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.category, (map.get(item.category) || 0) + 1);
  }
  return map;
}
