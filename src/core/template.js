/**
 * 模板变量处理
 * 语法中形如 {{domain}} 的占位符会被替换为用户记忆中或本次输入的值。
 */

const VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/** 提取全部变量名（去重、保持顺序） */
export function extractVars(code) {
  const names = [];
  const text = String(code || '');
  let match;
  VAR_PATTERN.lastIndex = 0;
  while ((match = VAR_PATTERN.exec(text)) !== null) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** 是否包含变量占位符 */
export function hasVars(code) {
  VAR_PATTERN.lastIndex = 0;
  return VAR_PATTERN.test(String(code || ''));
}

/**
 * 替换变量
 * 未提供值的变量保留原占位符，避免生成看似完整但实际错误的语句。
 */
export function applyVars(code, values = {}) {
  return String(code || '').replace(VAR_PATTERN, (full, name) => {
    const value = values[name];
    if (value === undefined || value === null || value === '') return full;
    return String(value);
  });
}

/** 返回缺失变量的名称列表 */
export function missingVars(code, values = {}) {
  return extractVars(code).filter((name) => {
    const value = values[name];
    return value === undefined || value === null || value === '';
  });
}

/** 变量名转为可读提示 */
export function describeVar(name) {
  const dict = {
    domain: '域名（如 example.com）',
    host: '主机名或域名',
    ip: 'IP 地址',
    cidr: 'IP 段（如 192.168.0.0/24）',
    port: '端口号',
    keyword: '搜索关键字',
    title: '网页标题关键字',
    status: 'HTTP 状态码',
    path: '文件路径',
    target: '目标地址',
    country: '国家或地区',
    city: '城市',
    org: '组织名称',
    asn: 'ASN 编号',
    cert: '证书关键字',
    icon: '图标哈希',
    url: '完整 URL'
  };
  return dict[name] || `变量 ${name}`;
}
