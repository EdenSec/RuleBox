/**
 * 网络空间测绘平台接入定义
 *
 * 纯逻辑模块：不依赖 DOM / chrome 全局对象，可直接在 Service Worker 中运行，
 * 也便于用 Node 对响应解析做离线校验。
 *
 * 约定：
 * - 请求构造与响应解析集中在同一处，UI 与后台只接触统一结构；
 * - 所有文本字段都会截断，避免异常响应把界面撑坏；
 * - 本模块不保存、不打印 API Key，错误信息返回前会剔除 Key。
 */

export const SEARCH_PAGE_SIZES = [10, 20, 50];
export const SEARCH_QUERY_MAX = 512;

/**
 * 「测试连接」的最小探测条数。
 * 测绘平台多按每页条数或调用次数扣额度，验证连通性只需要一条：
 * Quake / ZoomEye / 0.zone / DayDayMap 都接受 1；
 * Hunter 的 page_size 只支持 10 / 20 / 50 / 100，最小合法值就是 10。
 * FOFA / Shodan 走账号信息接口、不发起检索，这里的值不会用到。
 */
export const PROVIDER_PROBE_SIZE = {
  fofa: 1,
  hunter: 10,
  quake: 1,
  zoomeye: 1,
  shodan: 1,
  zerozone: 1,
  daydaymap: 1
};

/** 支持的测绘平台（与语法库平台 ID 保持一致，便于复制语法后直接跳转查询） */
export const SEARCH_PROVIDERS = [
  {
    id: 'fofa',
    name: 'FOFA',
    vendor: '白帽汇',
    color: '#4c8dff',
    keyUrl: 'https://fofa.info/userInfo',
    docUrl: 'https://fofa.info/api/',
    placeholder: 'domain="example.com"',
    keyHint: '个人中心 → API 管理'
  },
  {
    id: 'hunter',
    name: 'Hunter 鹰图',
    vendor: '奇安信',
    color: '#f0a020',
    keyUrl: 'https://hunter.qianxin.com/',
    docUrl: 'https://hunter.qianxin.com/home/helpCenter',
    placeholder: 'domain="example.com"',
    keyHint: '个人中心 → API 管理'
  },
  {
    id: 'quake',
    name: 'Quake 360',
    vendor: '360',
    color: '#2f9e6e',
    keyUrl: 'https://quake.360.net/',
    docUrl: 'https://quake.360.net/quake/#/help',
    placeholder: 'domain: "example.com"',
    keyHint: '个人中心 → 密钥管理'
  },
  {
    id: 'zoomeye',
    name: 'ZoomEye',
    vendor: '知道创宇',
    color: '#a06bff',
    // ZoomEye 按区域拆分服务：国内账号用 .org，海外账号用 .ai，跨区调用会返回区域不可用
    keyUrl: 'https://www.zoomeye.org/profile',
    docUrl: 'https://www.zoomeye.org/',
    placeholder: 'domain="example.com"',
    keyHint: '个人中心 → API Key'
  },
  {
    id: 'shodan',
    name: 'Shodan',
    vendor: 'Shodan',
    color: '#e5534b',
    keyUrl: 'https://account.shodan.io/',
    docUrl: 'https://developer.shodan.io/api',
    placeholder: 'hostname:example.com',
    keyHint: 'Account → API Key'
  },
  {
    id: 'zerozone',
    name: '零零信安 0.zone',
    vendor: '零零信安',
    color: '#8b949e',
    keyUrl: 'https://0.zone/',
    docUrl: 'https://0.zone/grammarList',
    placeholder: 'url==example.com',
    keyHint: '个人中心 → API 管理'
  },
  {
    id: 'daydaymap',
    name: 'DayDayMap',
    vendor: '盛邦安全',
    color: '#5bc0be',
    keyUrl: 'https://www.daydaymap.com/',
    docUrl: 'https://www.daydaymap.com/help/document?type=api-data',
    placeholder: 'domain="example.com"',
    keyHint: '个人中心 → API Key'
  }
];

export const SEARCH_PROVIDER_IDS = SEARCH_PROVIDERS.map((provider) => provider.id);

/** 按 ID 获取平台定义 */
export function getSearchProvider(id) {
  return SEARCH_PROVIDERS.find((provider) => provider.id === id) || null;
}

/** 是否为受支持的平台 ID */
export function isSearchProviderId(id) {
  return SEARCH_PROVIDER_IDS.includes(String(id || ''));
}

/** 页码限制在 1 - 100，阻止构造异常翻页 */
export function clampPage(value) {
  const num = Math.floor(Number(value));
  return Number.isFinite(num) ? Math.min(100, Math.max(1, num)) : 1;
}

/**
 * 每页数量只接受 10 / 20 / 50（界面提供的选项）；
 * 1 仅供「测试连接」的最小探测使用，不会出现在下拉里。
 */
export function normalizePageSize(value) {
  const num = Number(value);
  if (SEARCH_PAGE_SIZES.includes(num)) return num;
  return num === 1 ? 1 : 20;
}

/** 修正查询语句：去首尾空白并限制长度 */
export function normalizeQuery(value) {
  return String(value ?? '').trim().slice(0, SEARCH_QUERY_MAX);
}

/**
 * UTF-8 字符串转 Base64。
 * FOFA / Hunter / ZoomEye 都要求 qbase64 形式，直接 btoa 会在中文语句上抛错。
 */
export function base64Utf8(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/* ------------------------------------------------------------------ */
/* 通用解析辅助                                                        */
/* ------------------------------------------------------------------ */

function text(value, max = 200) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return text(value[0], max);
  if (typeof value === 'object') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 对象 / 数组取名称（部分平台的字段可能是 { name } 或 [name]） */
function nameOf(value, max = 120) {
  if (Array.isArray(value)) return nameOf(value[0], max);
  if (value && typeof value === 'object') {
    return text(value.name || value.title || value.value || value.cn || value.en, max);
  }
  return text(value, max);
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** 仅接受 http(s) 地址，其他协议（javascript: / data: 等）一律丢弃 */
function safeHttpUrl(value) {
  const raw = text(value, 1000);
  if (!raw) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

/** 从 "example.com:8080" / "[2001:db8::1]:443" 中拆出主机与端口 */
function parseHostPort(value) {
  let raw = text(value, 300);
  if (!raw) return { host: '', port: 0 };
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');

  const bracket = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracket) return { host: bracket[1], port: toNumber(bracket[2]) };

  // 只有一个冒号才视为“主机:端口”；多个冒号是 IPv6 地址本身
  if ((raw.match(/:/g) || []).length === 1) {
    const [host, portValue] = raw.split(':');
    return { host, port: toNumber(portValue) };
  }
  return { host: raw, port: 0 };
}

/** 常见 Web 端口：只有这些端口才值得拼出 http(s) 跳转链接 */
const WEB_PORTS = new Set([
  80, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  443, 3000, 5000, 7001, 8000, 8008, 8009, 8010, 8020, 8030,
  8040, 8050, 8060, 8070, 8080, 8081, 8082, 8083, 8084, 8085,
  8086, 8087, 8088, 8089, 8090, 8181, 8443, 8880, 8888, 8899,
  9000, 9001, 9002, 9080, 9090, 9200, 9443, 10443, 18080
]);

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * 是否为可直接访问的 Web 资产。
 * SSH / Redis / MySQL 等非 Web 协议如果也拼成 http://ip:port，点开必然报错，
 * 因此只在协议含 http、端口属于常见 Web 端口，或裸域名（无端口）时才生成链接。
 */
function isWebAsset(protocol, port, host) {
  const proto = String(protocol || '').toLowerCase();
  if (proto.includes('http')) return true;
  if (port) return WEB_PORTS.has(port);
  return Boolean(host) && !IPV4_PATTERN.test(host) && !host.includes(':');
}

/** 域名 / IP 补全为可点击地址：有域名优先域名，否则用 IP + 端口 */
function assetUrl({ url, domain, hostname, ip, port, protocol }) {
  // 只有明确带 http(s) 协议的地址才直接采用；裸主机名 / IP 需要结合端口重新拼，
  // 否则会把 1.2.3.4:8080 误当成 http://1.2.3.4（丢掉端口）
  const rawUrl = text(url, 1000);
  const direct = /^https?:\/\//i.test(rawUrl) ? safeHttpUrl(rawUrl) : '';
  if (direct) return direct;

  let host = '';
  let embeddedPort = 0;
  for (const candidate of [domain, hostname, ip]) {
    const parsed = parseHostPort(candidate);
    if (parsed.host) {
      host = parsed.host;
      embeddedPort = parsed.port;
      break;
    }
  }
  if (!host) return '';

  const portNum = toNumber(port) || embeddedPort;
  if (!isWebAsset(protocol, portNum, host)) return '';

  const isHttps = String(protocol || '').toLowerCase().includes('https') || portNum === 443;
  const scheme = isHttps ? 'https' : 'http';
  const defaultPort = (isHttps && portNum === 443) || (!isHttps && portNum === 80);
  const hosted = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return safeHttpUrl(`${scheme}://${hosted}${portNum && !defaultPort ? `:${portNum}` : ''}`);
}

/** 统一结果条目结构 */
function buildItem(input) {
  const item = {
    title: text(input.title, 200),
    url: assetUrl(input),
    ip: text(input.ip, 64),
    port: toNumber(input.port),
    protocol: text(input.protocol, 40),
    domain: text(input.domain, 255),
    server: text(input.server, 120),
    location: text(input.location, 160),
    updatedAt: text(input.updatedAt, 40),
    status: toNumber(input.status)
  };
  if (!item.title) item.title = item.domain || item.ip || item.url || '未命名资产';
  return item;
}

function joinLocation(...parts) {
  return parts.map((part) => text(part, 60)).filter(Boolean).join(' · ');
}

/** 从各平台错误响应中读取可读信息 */
export function readProviderError(json) {
  if (!json || typeof json !== 'object') return '';
  const candidates = [
    typeof json.errmsg === 'string' ? json.errmsg : '',
    typeof json.message === 'string' ? json.message : '',
    typeof json.msg === 'string' ? json.msg : '',
    typeof json.error === 'string' ? json.error : '',
    json.error && typeof json.error === 'object' ? json.error.message : ''
  ];
  return text(candidates.find(Boolean), 200);
}

/** 错误信息脱敏：剔除 Key、压缩长度，避免把凭据回显到界面 */
export function sanitizeSearchError(message, apiKey = '') {
  let value = String(message || '请求失败');
  if (apiKey) value = value.split(apiKey).join('***');
  return value.replace(/\s+/g, ' ').trim().slice(0, 200) || '请求失败';
}

/** HTTP 状态码文案 */
export function describeHttpStatus(status) {
  if (status === 401 || status === 403) return '鉴权失败，请检查 API Key 或账号权限';
  if (status === 429) return '请求过于频繁，请稍后重试';
  if (status >= 500) return '平台服务异常，请稍后重试';
  return `请求失败（HTTP ${status}）`;
}

/**
 * 0.zone 按模块区分查询类型（信息系统 / 域名 / 邮箱 / 移动端应用 / 代码与文档）。
 * 只用各模块独有的字段判断，避免把 company、name 这类多模块通用字段误判；
 * 识别不到时按信息系统（site）处理。
 */
function detectZerozoneQueryType(query) {
  const rules = [
    { type: 'code', pattern: /\b(?:code_detail|related_company|timestamp_update|suffix|keyword)\b|\b(?:repository|detail_parsing)\./i },
    { type: 'email', pattern: /\b(?:email|email_domain|email_type|leakage_num)\b|\bmsg\.tags\b/i },
    { type: 'domain', pattern: /\b(?:root_domain|toplv_domain|level|domain)\b/i },
    { type: 'app', pattern: /\b(?:domain_list|description)\b/i }
  ];
  const matched = rules.find((rule) => rule.pattern.test(String(query || '')));
  return matched ? matched.type : 'site';
}

/* ------------------------------------------------------------------ */
/* 请求构造                                                            */
/* ------------------------------------------------------------------ */

/**
 * 构造平台请求参数
 * @param {string} providerId
 * @param {{query: string, page: number, size: number, apiKey: string}} options
 * @returns {{url: string, method: string, headers: Record<string,string>, body?: string}}
 */
export function buildProviderRequest(providerId, { query, page, size, apiKey }) {
  const key = String(apiKey || '').trim();
  const q = normalizeQuery(query);
  const currentPage = clampPage(page);
  const pageSize = normalizePageSize(size);

  switch (providerId) {
    case 'fofa': {
      const params = new URLSearchParams({
        key,
        qbase64: base64Utf8(q),
        page: String(currentPage),
        size: String(pageSize),
        fields: 'host,ip,port,protocol,domain,title,server,link',
        full: 'false'
      });
      return {
        url: `https://fofa.info/api/v1/search/all?${params.toString()}`,
        method: 'GET',
        headers: {}
      };
    }
    case 'hunter': {
      const params = new URLSearchParams({
        'api-key': key,
        search: base64Utf8(q),
        page: String(currentPage),
        page_size: String(pageSize),
        is_web: '3'
      });
      return {
        url: `https://hunter.qianxin.com/openApi/search?${params.toString()}`,
        method: 'GET',
        headers: {}
      };
    }
    case 'quake': {
      return {
        url: 'https://quake.360.net/api/v3/search/quake_service',
        method: 'POST',
        headers: {
          'X-QuakeToken': key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: q,
          start: (currentPage - 1) * pageSize,
          size: pageSize,
          ignore_cache: false,
          include: ['ip', 'port', 'hostname', 'transport', 'time', 'location', 'service']
        })
      };
    }
    case 'zoomeye': {
      return {
        url: 'https://api.zoomeye.org/v2/search',
        method: 'POST',
        headers: {
          'API-KEY': key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          qbase64: base64Utf8(q),
          page: currentPage,
          pagesize: pageSize,
          sub_type: 'all'
        })
      };
    }
    case 'shodan': {
      const params = new URLSearchParams({
        key,
        query: q,
        page: String(currentPage),
        minify: 'true'
      });
      return {
        url: `https://api.shodan.io/shodan/host/search?${params.toString()}`,
        method: 'GET',
        headers: {}
      };
    }
    case 'zerozone': {
      return {
        url: 'https://0.zone/api/data/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: q,
          query_type: detectZerozoneQueryType(q),
          page: currentPage,
          pagesize: pageSize,
          zone_key_id: key
        })
      };
    }
    case 'daydaymap': {
      return {
        url: 'https://www.daydaymap.com/api/v1/raymap/search/all',
        method: 'POST',
        headers: {
          'api-key': key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          page: currentPage,
          page_size: pageSize,
          keyword: base64Utf8(q)
        })
      };
    }
    default:
      throw new Error('不支持的查询平台');
  }
}

/**
 * 构造“测试连接”请求。
 * 优先使用平台提供的账号信息接口：既不消耗查询额度，也能准确区分
 * “Key 无效”和“有 Key 但查询语法的账号无权限”。
 * FOFA / Shodan 的账号接口有公开文档依据；其余平台没有稳定的账号接口，
 * 返回 null，由后台退化为一次最小检索。
 */
export function buildProviderTestRequest(providerId, apiKey) {
  const key = String(apiKey || '').trim();
  if (providerId === 'fofa') {
    return {
      url: `https://fofa.info/api/v1/info/my?key=${encodeURIComponent(key)}`,
      method: 'GET',
      headers: {}
    };
  }
  if (providerId === 'shodan') {
    return {
      url: `https://api.shodan.io/api-info?key=${encodeURIComponent(key)}`,
      method: 'GET',
      headers: {}
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 响应解析                                                            */
/* ------------------------------------------------------------------ */

/**
 * 解析平台响应为统一结构
 * @returns {{total: number, items: Array, quota?: string}}
 */
export function parseProviderResponse(providerId, json) {
  switch (providerId) {
    case 'fofa':
      return parseFofa(json);
    case 'hunter':
      return parseHunter(json);
    case 'quake':
      return parseQuake(json);
    case 'zoomeye':
      return parseZoomEye(json);
    case 'shodan':
      return parseShodan(json);
    case 'zerozone':
      return parseZerozone(json);
    case 'daydaymap':
      return parseDaydaymap(json);
    default:
      throw new Error('不支持的查询平台');
  }
}

function parseFofa(json) {
  if (!json || typeof json !== 'object') throw new Error('FOFA 返回内容为空');
  if (json.error) throw new Error(readProviderError(json) || 'FOFA 查询失败');

  // 字段顺序与请求里的 fields 参数严格对应
  const rows = Array.isArray(json.results) ? json.results : [];
  const items = rows.map((row) => {
    const cells = Array.isArray(row) ? row : [];
    const [host, ip, port, protocol, domain, title, server, link] = cells;
    return buildItem({
      title: title || domain || host,
      url: link || host,
      hostname: host,
      ip,
      port,
      protocol,
      domain,
      server
    });
  });

  return {
    total: toNumber(json.size) || toNumber(json.total) || items.length,
    items
  };
}

function parseHunter(json) {
  if (!json || typeof json !== 'object') throw new Error('Hunter 返回内容为空');
  if (toNumber(json.code) !== 200) {
    throw new Error(readProviderError(json) || 'Hunter 查询失败');
  }

  const data = json.data || {};
  const rows = Array.isArray(data.arr) ? data.arr : [];
  const items = rows.map((row) => buildItem({
    title: row.web_title || row.domain || row.ip,
    url: row.url,
    ip: row.ip,
    port: row.port,
    protocol: row.protocol || row.base_protocol,
    domain: row.domain,
    server: row.header_server || row.component,
    location: joinLocation(row.country, row.province, row.city),
    updatedAt: row.updated_at,
    status: row.status_code
  }));

  return {
    total: toNumber(data.total) || items.length,
    items,
    quota: text(data.rest_quota, 40)
  };
}

function parseQuake(json) {
  if (!json || typeof json !== 'object') throw new Error('Quake 返回内容为空');
  if (toNumber(json.code) !== 0) {
    throw new Error(readProviderError(json) || 'Quake 查询失败');
  }

  const rows = Array.isArray(json.data) ? json.data : [];
  const items = rows.map((row) => {
    const http = row.service?.http || {};
    const location = row.location || {};
    return buildItem({
      title: nameOf(http.title) || nameOf(row.title) || nameOf(row.service?.name),
      url: nameOf(http.url) || nameOf(row.url) || nameOf(http.host) || nameOf(row.hostname),
      ip: row.ip,
      port: row.port,
      protocol: [text(row.transport, 20), nameOf(row.service?.name, 40)].filter(Boolean).join('/'),
      domain: nameOf(row.domain) || nameOf(row.hostname) || nameOf(http.host),
      server: nameOf(http.server) || nameOf(row.service?.name),
      location: joinLocation(location.country_cn, location.province_cn, location.city_cn),
      updatedAt: row.time,
      status: http.status_code
    });
  });

  return {
    total: toNumber(json.meta?.pagination?.total) || items.length,
    items
  };
}

function parseZoomEye(json) {
  if (!json || typeof json !== 'object') throw new Error('ZoomEye 返回内容为空');
  if (toNumber(json.code) !== 60000) {
    throw new Error(readProviderError(json) || 'ZoomEye 查询失败');
  }

  // 不同版本的 ZoomEye 响应外层字段略有差异：兼容 data 为数组 / list / items 三种形态
  const payload = json.data;
  const rows = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.list) ? payload.list : (Array.isArray(payload?.items) ? payload.items : []));
  const items = rows.map((row) => {
    const portinfo = row.portinfo || {};
    const http = row.http || {};
    return buildItem({
      title: nameOf(row.title) || nameOf(portinfo.title) || nameOf(http.title),
      url: row.url || row.domain || row.hostname,
      ip: row.ip,
      port: row.port || portinfo.port,
      protocol: nameOf(row.service) || nameOf(portinfo.app),
      domain: nameOf(row.domain) || nameOf(row.hostname),
      server: nameOf(row.product) || nameOf(http.header?.server?.name) || nameOf(http.server),
      location: joinLocation(row.geoinfo?.country?.names?.en, row.geoinfo?.province?.names?.en, row.geoinfo?.city?.names?.en),
      updatedAt: row.update_time,
      status: row.http?.status_code || http.status_code
    });
  });

  return {
    total: toNumber(json.total) || toNumber(payload?.total) || items.length,
    items
  };
}

function parseShodan(json) {
  if (!json || typeof json !== 'object') throw new Error('Shodan 返回内容为空');
  if (json.error) throw new Error(readProviderError(json) || 'Shodan 查询失败');

  const rows = Array.isArray(json.matches) ? json.matches : [];
  const items = rows.map((row) => {
    const http = row.http || {};
    const location = row.location || {};
    const host = text(row.domains?.[0], 255) || text(row.hostnames?.[0], 255);
    return buildItem({
      title: nameOf(http.title) || host || row.ip_str,
      url: host || row.ip_str,
      ip: row.ip_str,
      port: row.port,
      protocol: row.transport,
      domain: host,
      server: nameOf(http.server) || nameOf(row.product),
      location: joinLocation(location.country_name, location.city),
      updatedAt: row.timestamp,
      status: http.status
    });
  });

  return {
    total: toNumber(json.total) || items.length,
    items
  };
}

function parseZerozone(json) {
  if (!json || typeof json !== 'object') throw new Error('0.zone 返回内容为空');
  if (toNumber(json.code) !== 0) {
    throw new Error(readProviderError(json) || '0.zone 查询失败');
  }

  const payload = json.data;
  const rows = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.list) ? payload.list : []);
  const items = rows.map((row) => buildItem({
    title: row.title || row.url || row.ip,
    url: row.url,
    ip: row.ip,
    port: row.port,
    protocol: row.service,
    domain: '',
    server: row.component || row.cms,
    location: joinLocation(row.country, row.province, row.city),
    updatedAt: row.timestamp,
    status: row.status_code
  }));

  return {
    total: toNumber(json.total) || items.length,
    items
  };
}

function parseDaydaymap(json) {
  if (!json || typeof json !== 'object') throw new Error('DayDayMap 返回内容为空');
  const code = toNumber(json.code);
  if (code && code !== 200) {
    throw new Error(readProviderError(json) || 'DayDayMap 查询失败');
  }

  const payload = json.data;
  const rows = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.list) ? payload.list : []);
  const items = rows.map((row) => buildItem({
    title: row.title || row.domain || row.ip,
    url: row.url,
    ip: row.ip,
    port: row.port,
    protocol: row.protocol || row.service,
    domain: row.domain,
    server: row.server || row.service,
    location: joinLocation(row.country, row.province, row.city),
    updatedAt: row.time_stamp || row.timestamp,
    status: row.status_code
  }));

  return {
    total: toNumber(payload?.total) || toNumber(json.total) || items.length,
    items
  };
}
