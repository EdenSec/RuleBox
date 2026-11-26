# RuleBox 开发与维护文档

> 本文档面向后续所有开发 / 修复 / 扩展 RuleBox 的开发者与贡献者。
> **核心约定：任何开发动手之前，先通读本文档对应章节，并在代码库中检索是否已存在同类实现，禁止重复造轮子**（禁止新开同功能组件、同义字段、重复端点/存储键/映射）。若发现既有实现与期望不一致，优先修正旧实现并同步本文档，而不是另起一套。

## 1. 技术形态与总体架构

- Chrome 扩展 **Manifest V3**，无构建工具、无框架，纯 vanilla ES Modules。
- `minimum_chrome_version: 116`（`chrome.sidePanel.open` 需要手势可用版本）。
- **浏览器兼容**：Chrome 与 Edge 均基于 Chromium，同一份 MV3 源码可直接「加载已解压扩展」（`chrome://extensions/` / `edge://extensions/`），无需构建、无需改动清单。Edge 官方边栏文档同样使用 `side_panel` 键 + `sidePanel` 权限，因此侧边栏在 Edge 中可正常工作。
  - 所有 `sidePanel.*` / `action.openPopup` 调用点必须保留可选链（`chrome.sidePanel?.open`、`chrome.action?.openPopup`）与三级降级（侧边栏 → 弹窗 → 标签页），缺 API 时只隐藏对应入口，不允许抛错或白屏。
  - 不同浏览器的 `chrome.storage.local` 互相隔离：设置、收藏、最近使用不共享，排查问题时先确认当前浏览器上下文。
- **同一个页面三种宿主**：工具栏弹窗（action popup）、侧边栏（side panel）、普通标签页（TAB，含设置页的“打开面板”入口）都加载 `src/popup/popup.html`。
  - 上下文唯一判定点：`app.js` 的 `detectContextType()`，用 `chrome.runtime.getContexts({ contextTypes: ['TAB', 'POPUP', 'SIDE_PANEL'] })` 返回项的 `documentUrl`（去掉 query）与 `location.href` 比对；查不到或 API 不可用时返回 `''`。
  - 尺寸策略由 `applyContextLayout()` 加 `body.is-fluid` 切换：**POPUP 保持 CSS 固定 420×580**；SIDE_PANEL / TAB 铺满可视区。**禁止用 `@media` 按视口宽度改写 body 尺寸**（见第 7 节陷阱 14）。
  - `state.isPopup` 只对真实 action popup 为 `true`，`ui.closeAfterCopy` 等弹窗语义只在此时生效。
  - 面板 AI 工具栏的「模型」下拉直接写 `settings.ai.activeProfileId`（`patchSettings`），与设置页共用同一份档案列表；设置页改动经 `onStorageChanged` 同步回面板，不要在面板另存一份模型选择。
  - 面板筛选行的「+」复用 `item-dialog.js`；提交成功后必须主动 `loadAll(true)` + `renderAll()`，不能只依赖 storage 变更事件（普通网页预览走 localStorage，没有 `chrome.storage.onChanged`）。
- **设置页** `src/options/options.html` 通过 `manifest.options_ui`（`open_in_tab: true`）以独立标签页打开；代码里统一走 `chrome.runtime.openOptionsPage()` / `openOptions()`（`app.js`），不要自己 `tabs.create` 拼地址。
- **数据驱动**：所有条目来自 `src/data/` 下的 JSON；界面不硬编码任何条目。用户自定义数据存 `chrome.storage.local`，运行时与内置数据合并（`src/core/data.js`）。
- 本地网页预览（非扩展环境）自动回退 `localStorage`，可直接用静态服务器打开 `src/popup/popup.html` 调试。

```
src\
├─ background\service-worker.js   # MV3 SW：右键菜单、sidePanel.setOptions 同步、rb:sync 消息、rb:cyber-search 聚合查询
├─ core\                          # 全部无 DOM 依赖的核心逻辑（SW 也可复用）
│   ├─ defaults.js                # STORAGE_KEYS、DEFAULT_SETTINGS、mergeSettings（唯一配置定义点）
│   ├─ storage.js                 # chrome.storage.local 封装 + localStorage 回退 + 各业务键读写
│   ├─ data.js                    # JSON 数据加载、归一化、缓存（loadAll / invalidateCache）
│   ├─ search.js                  # 搜索与分类统计（searchItems / filterByCategory / countCategories）
│   ├─ retrieve.js                # 本地示例召回（retrieveExamples：为 AI 挑选库内近似条目，纯本地、不联网）
│   ├─ template.js               # {{变量}} 提取 / 填充 / 校验（applyVars / extractVars / missingVars / describeVar）
│   ├─ clipboard.js               # 复制格式化（formatCopy：code | markdown | title-code）
│   ├─ providers.js               # AI 供应商预设（PROVIDERS 数组，6 家预设 + custom，共 7 项）
│   ├─ search-providers.js        # 测绘平台接入（平台元数据、请求构造、响应归一化、错误脱敏，无 DOM/chrome 依赖）
│   ├─ ai-client.js               # OpenAI 兼容 Chat Completions 客户端（SSE 流式、testConnection、hasEndpointPermission）
│   ├─ logger.js                  # 日志与敏感信息脱敏（mask）
│   └─ utils.js                    # $、$$、el、uid、clamp、safeParse、debounce、copyText、truncate、sanitizeFilename、isAllowedEndpoint 等
├─ data\                          # 内置数据（schema 见第 3 节）
│   ├─ index.json                 # 数据索引（snippets/payloads 文件路径清单 + version + updated）
│   ├─ platforms.json             # 平台注册表
│   ├─ prompts.json               # AI 提示词库
│   ├─ snippets\*.json            # 各平台语法库（11 个文件）
│   └─ payloads\*.json            # 各类 Payload 库（19 个文件）
├─ options\                       # 设置页 HTML/CSS
├─ popup\                         # 面板 HTML/CSS（popup 与 side panel 共用）
├─ shared\                        # tokens.css（设计令牌）、base.css、components.css
└─ ui\
    ├─ app.js                     # 面板逻辑（标签切换、搜索、复制、收藏、聚合查询、AI 对话、pendingSearch 消费）
    ├─ options.js                 # 设置页逻辑（每个控件变更即自动保存）
    ├─ form-dialog.js             # 共享弹窗与表单（mountOverlay / openInfoDialog / openFormDialog），options 与 popup 共用
    ├─ item-dialog.js             # 共享条目表单（新增 / 编辑语法与 Payload，风险等级自动推断）
    ├─ components.js              # 可复用组件（itemCard、syncFilterSelect、toast、confirmDialog、riskBadge、copyWithVariables…）
    ├─ icons.js                   # SVG 图标（icon(name) 返回 span；条目卡片用 edit / eyeOff / trash 图标）
    └─ theme.js                   # auto/dark/light 主题
```

## 2. 权限与安全基线

`manifest.json`：

- permissions：`storage`、`clipboardWrite`、`contextMenus`、`sidePanel`。
- host_permissions：内置 5 家 AI 供应商域名、`localhost/127.0.0.1`（Ollama），以及 FOFA / Hunter 鹰图 / Quake / ZoomEye / Shodan / 0.zone / DayDayMap 的 API 域名（聚合查询直接由 SW 发起，端点固定，不接受页面传入 URL）。
- optional_host_permissions：`https://*/*`、`http://*/*`——自定义 AI 端点在用户手势内 `chrome.permissions.request` 动态授权。
- CSP：`script-src 'self'; object-src 'self'; base-uri 'self'`（禁止内联脚本 / eval / 远程代码）。

安全实现约定（改动时不得破坏）：

- **密钥只存本地**（`rb.settings` 内 `ai.profiles[].apiKey`），导出配置自动剔除 apiKey。
- 所有外部 / 用户数据一律 `textContent` 渲染（`el()` 构造 DOM），禁止拼 HTML 字符串；仅静态 SVG 用 innerHTML。
- 自定义 AI 端点仅允许 `https://`（`isAllowedEndpoint` 校验；本机 http 仅放行 localhost）。
- 日志与错误提示必须用 `mask`（`src/core/logger.js`）脱敏，勿在 URL 或日志中输出完整 Key。
- 设置页导入配置有大小上限（`limits.maxImportBytes`，默认 512KB）与条目上限（`maxCustomItems`，默认 500），导入前 `validateConfig` 校验 + 二次确认。
- Service Worker 不 import 任何 DOM 依赖模块。
- 前端 UI 禁止渐变色、禁止廉价 AI 感；新增页面须适配移动端（已有 `@media` 断点风格）。

## 3. 内置数据 schema

### 3.1 `data/index.json`（数据索引）

```jsonc
{
  "version": 1,
  "updated": "YYYY-MM-DD",
  "snippets": [ { "path": "snippets/fofa.json", "platform": "fofa" }, ... ],
  "payloads": [ { "path": "payloads/sqli.json" }, ... ]
}
```

新增语法 / Payload 文件**必须**同步登记到 index.json，否则不会被加载。

### 3.2 `data/platforms.json`（平台注册表）

```jsonc
{
  "version": 1,
  "updated": "...",
  "notice": "整理口径说明",
  "platforms": [
    {
      "id": "fofa",              // 平台唯一 ID（小写字母数字-_，2~32 位；自定义平台同规则且不得与内置冲突）
      "name": "FOFA",
      "vendor": "白帽汇",
      "kind": "cyberspace",       // cyberspace | situation | search | command | custom
      "color": "#4c8dff",         // 平台徽标色
      "docUrl": "https://fofa.info/",
      "syntax": "field=\"value\" && ...",   // 语法速览（字符串）
      "summary": "一句话简介",
      "operators": [ { "op": "=", "desc": "模糊匹配…" }, ... ],
      "fields": [ { "key": "ip", "desc": "IP 地址" }, ... ],
      "tips": [ "使用提示…", ... ]
    }
  ]
}
```

### 3.3 `data/snippets/<platform>.json`（语法库）

```jsonc
{
  "platform": "fofa",            // 必须与 platforms.json 的 id 对应
  "version": 1,
  "categories": ["基础字段", ...], // 分类清单（条目 category 必须取自这里，UI 据此生成分类下拉）
  "items": [
    {
      "id": "fofa-domain",        // 全局唯一（推荐前缀 = 平台 id）
      "title": "根域名资产",
      "category": "基础字段",
      "code": "domain=\"{{domain}}\"",  // {{name}} 为变量占位符
      "desc": "说明文本",
      "tags": ["domain", "资产发现"],
      "vars": [ { "name": "domain", "label": "根域名", "placeholder": "example.com", "example": "example.com" } ],
      "file": "",                 // 可选：建议文件名，声明后卡片出现「存为文件」（见 3.7）
      "filePrefix": "",           // 可选：二进制前缀（Base64），下载时先解码成字节再拼接 code（见 3.7）
      "source": "FOFA 官方字段文档",   // 数据出处（要求：不瞎编，有出处）
      "risk": "recon"             // 风险等级，见第 4 节值域
    }
  ]
}
```

**语法库覆盖约定（强制）**

1. **覆盖官方全量字段**：语法库必须按平台官方字段文档逐字段落地，不得只写“常用的几种”。目标是最少“官方字段表里每一个字段至少一条条目”，运算符（`=` / `==` / `!=` / `*=` / `&&` / `||` / `()` / `!=""` 等）单独成条。
2. **条目必须与官方文档一致**：字段前缀、语义（模糊 / 精确 / 剔除 / 非空）、枚举值、会员等级限制都要与官方一致。旧条目若与官方冲突，**直接修正旧条目**，不要新建一条并列（避免同一字段两套语义）。
3. **`snippets/<platform>.json` 与 `platforms.json` 必须同步**：`platforms.json` 的 `operators` / `fields` / `syntax` / `tips` 是 [`ai-client.js`](../src/core/ai-client.js) `buildSystemPrompt()` 注入给 AI 的唯一平台上下文（由设置项 `ai.includePlatformContext` 控制）。只改 snippets 不改 platforms.json，AI 仍然“不认识”新语法。
4. **`categories` 与代码解耦**：分类下拉的选项由 `ui/app.js` 的 `countCategories()` 从条目实际 `category` 统计生成，新增分类**无需改 JS**；但仍要把新分类追加进 `snippets.categories` 数组，保持数据自描述。
5. **会员 / 权限限制写进 `desc` 或 `source`**（如“商业版及以上”），让用户在使用前就知道能力边界。

### 3.4 `data/payloads/<type>.json`（Payload 库）

```jsonc
{
  "kind": "payload",
  "version": 1,
  "group": "SQL 注入",            // Payload 分组名（类型下拉）
  "categories": ["认证绕过", ...],
  "items": [
    {
      "id": "sqli-auth-bypass",   // 全局唯一（推荐前缀 = 文件类型缩写）
      "title": "经典登录绕过",
      "category": "认证绕过",
      "code": "admin' OR '1'='1' -- ",
      "desc": "...",
      "tags": ["sqli", "login", "bypass"],
      "vars": [],                 // Payload 通常无变量
      "file": "sample.txt",       // 可选：建议文件名，声明后卡片出现下载入口（见 3.7）
      "filePrefix": "iVBORw0...", // 可选：二进制前缀（Base64），需要真实文件头的样本先解码成字节再拼接 code（见 3.7）
      "risk": "attack",
      "source": "OWASP / PayloadsAllTheThings"
    }
  ]
}
```

### 3.5 `data/prompts.json`（AI 提示词库）

```jsonc
{
  "version": 1,
  "updated": "...",
  "groups": [
    { "id": "recon", "name": "资产测绘",
      "prompts": [ { "id": "recon-subdomain", "title": "查某域名全部子域", "text": "帮我生成…" }, ... ] }
  ]
}
```

条目键（itemKey）统一为 `` `${kind}:${id}` ``（kind ∈ snippet | payload），收藏、最近使用、ID 冲突检测都用这个键。

### 3.6 变量定义归一化（`normalizeVars(vars, code)`，`src/core/data.js`）

这是**唯一**的变量格式入口，`normalizeSnippet` / `normalizePayload` 都经过它，UI 不要自行解析 `vars`：

- 输入允许两种写法：语法库的**对象写法**（`{ name, label, placeholder, example }`）与 Payload / 自定义条目的**字符串写法**（`"domain"`）；输出统一为对象 `{ name, label, placeholder, example }`。
- 空名、重复名会被丢弃（按出现顺序保留第一个）。
- 会额外扫描 `code` 中的 `{{name}}`：代码里出现但未声明的占位符也会补进 `vars`，避免复制出未替换的 `{{xxx}}`。
- 历史教训：直接把对象拼进模板会产出 `{{[object Object]}}`。新增变量相关 UI 时必须消费归一化后的 `item.vars`。

### 3.7 条目「存为文件」（`item.file` + `item.filePrefix`）

`file` 是**可选**字段，值为建议文件名（如 `sample.txt`，或与样本类型匹配的扩展名）。语义与约束：

- **只有声明了 `file` 的条目**才在卡片操作区显示下载图标；未声明的条目依旧只有「收藏 + 复制」，避免 420px 宽的 popup 里每张卡片都挤三个按钮。
- 下载内容是**变量替换后的最终代码**（与复制共用 `resolveItemText()`，`src/ui/components.js`），因此带变量的样本填完变量再下载即为完整样本文件。
- `filePrefix` 是**可选**的二进制前缀（Base64），下载时先 `base64ToBytes()` 解码成字节，**拼在代码之前**再写入 Blob。用于带签名或校验、无法用纯文本伪造文件头的二进制格式（文件头恰好是纯 ASCII 的格式可直接写成文本，属特例）。非法 Base64 会提示并中止下载，不会产出半截文件。
- `filePrefix` 只影响下载，**复制仍只复制 `code` 文本**；`code` 始终是可读的唯一真相源，二进制前缀只存「文件骨架」，两者不会出现内容漂移。
- 变量弹窗的确认按钮文案由 `confirmText` 区分：复制走默认「填充并复制」，下载传「填充并下载」。不要把它写死成单一文案，否则下载场景会误导用户以为只复制。
- 与复制不同，下载**不触发** `ui.closeAfterCopy`：一次通常要连续取多个样本。
- 文件名统一经 `sanitizeFilename()`（`src/core/utils.js`）净化，去掉路径分隔符与控制字符，防止条目数据写成 `../outside.txt` 落到下载目录之外。
- 实现用 `Blob` + `<a download>`（`downloadText()` / `downloadBlob()`），**不申请 `downloads` 权限**；延迟 4s revoke URL。
- 这两个字段都必须在 `normalizeSnippet()` / `normalizePayload()`（`src/core/data.js`）白名单里，否则会被静默丢弃——这是新增字段最容易踩的坑（见第 7 节陷阱 32）。
- 设置页「新增 / 编辑自定义条目」表单也有「文件名」「二进制前缀（Base64）」两个输入，运行时同样可配置；填了前缀却没填文件名会被表单拦下。
- 当前使用该字段的是 `payloads/webshell.json` 的 10 条可下载样本（按语言 / 容器区分的文本样本与二进制头部样本）。新增同类条目时按同样方式补 `file`，**不要**另建一套“下载专用”数据结构。

## 4. risk 风险等级值域（三方同步，禁止私加）

**唯一值域：`recon` / `safe` / `low` / `attack` / `danger`**

| 值 | 徽标文案 | 变体 | 语义 |
| --- | --- | --- | --- |
| `recon` | 信息搜集 | info | 测绘 / 查询语法（语法库默认） |
| `safe` | 安全操作 | info | 无攻击性的操作（如 fid 回溯、AiLPHA 查询） |
| `low` | 低风险 | info | 查询 / 防御类 Payload |
| `attack` | 攻击载荷 | danger | 攻击性 Payload（Payload 默认） |
| `danger` | 高危 | warn | 高危操作（WebShell、反序列化执行等） |

同步点（新增值必须三处一起改 + 更新本表）：

1. `src/ui/components.js` 的 `RISK_LABELS`（徽标渲染，未知值兜底 low）。
2. `src/ui/item-dialog.js` 的 `RISK_VALUES` 白名单 + risk 下拉 options。
3. 内置 JSON 数据 / 用户自定义数据实际取值。

> 风险等级只用于卡片徽标，**不参与搜索、筛选与 AI 上下文**。新增条目时按类型自动推断（语法 → `recon`，Payload → `attack`），字段收进表单「高级选项」；用户手动改过之后不再随类型覆盖。

> 历史教训：数据文件使用了 `recon`/`safe`，而 UI 初版只认 `low`/`attack`/`danger`，导致徽标被兜底成“低风险”且自定义条目选不到正确值。现已按“扩展 UI 值域”方案统一（未改 300+ 处数据）。归一化兜底默认值（`data.js`）：snippet 缺 risk → `low`，payload 缺 risk → `attack`。

## 5. 存储键清单（chrome.storage.local）

**新增任何存储键必须先在此登记，且只允许在 `src/core/defaults.js` 的 `STORAGE_KEYS` 定义。**

| 键 | 内容 | 读写字段 |
| --- | --- | --- |
| `rb.settings` | 全局设置（结构见 `DEFAULT_SETTINGS`） | `getSettings / saveSettings / patchSettings` |
| `rb.favorites` | 收藏条目 key 数组（`kind:id`） | `getFavorites / setFavorites` |
| `rb.recents` | 最近使用 key 数组 | `getRecents / setRecents` |
| `rb.variables` | 变量记忆 `{ {{name}}: value }` | `getVariables / setVariables` |
| `rb.custom` | 自定义数据 `{ platforms: [], items: [] }` | `getCustom / setCustom` |
| `rb.hidden` | 内置条目隐藏名单（`kind:id` 数组，仅影响面板展示，不删除数据） | `getHidden / setHidden` |
| `rb.aiHistory` | AI 对话历史（应用层截 40 条） | `getAiHistory / setAiHistory` |
| `rb.usage` | 每日 AI 请求计数 `{ date: 'yyyy-MM-dd', count }` | `getUsage`（内部） |
| `rb.pendingSearch` | 右键菜单传入的待搜索关键词，**一次性**（面板消费后立即删除） | `getItems / removeItems` |
| `rb.lastTab` | 上次停留的标签页 ID（`snippets / payloads / cyber / ai`），供“跟随上次使用”恢复；独立键避免切标签就触发设置变更重绘 | `getItems / setItems` |

`rb.settings` 结构（`DEFAULT_SETTINGS`，`mergeSettings` 做深合并保证旧配置兼容）：

- `theme`：`auto | dark | light`
- `ui`：`closeAfterCopy`、`recentsLimit`、`defaultTab`、`openMode`、`showRiskBadges`、`copyFormat`、`showDesc`
  - `openMode`：`last`（默认，跟随 `rb.lastTab`）| `fixed`（固定打开 `defaultTab`）；设置页只有一个下拉，选“上次使用”写 `last`，选具体标签页写 `fixed` + `defaultTab`。`mergeSettings` 会校验两者取值。
- `features`：`sidePanel`、`contextMenu`、`ai`（功能开关，右键菜单 / 侧边栏开关变更后需向 SW 发 `rb:sync` 消息）
- `search`：`enabled`（聚合查询总开关）、`promptAfterCopy`（复制语法后是否提示一站式查询）、`pageSize`（10/20/50）、`lastProviders[]`（上次使用的平台，空数组表示还没有记录，面板会回退到已配置 Key 的平台）、`providers{ <平台ID>: { apiKey } }`（密钥只存本地，导出 / 导入时由 `storage.js` 清空）
- `ai`：`enabled`、`activeProfileId`、`profiles[]`（id/name/providerId/baseUrl/model/apiKey/temperature/maxTokens/timeoutMs/thinking/extraBody）、`systemPrompt`（空字符串 = 使用内置默认）、`systemPromptAppend`、`includePlatformContext`、`includeLibraryExamples`、`historyLimit`、`stream`、`minIntervalMs`、`dailyRequestLimit`
- 系统提示词由 [`ai-client.js`](../src/core/ai-client.js) 的 `DEFAULT_SYSTEM_PROMPT` 提供基准：设置页展示并允许编辑，与内置文本完全一致或留空时存空字符串，保证扩展升级默认提示词后能自动生效；平台字段上下文与 `systemPromptAppend` 始终由 `buildSystemPrompt()` 拼接，不受用户编辑影响。
- `limits`：`maxImportBytes`、`maxCustomItems`

注意双开关语义：`features.ai` 控制界面入口展示，`ai.enabled` 控制是否真正发起请求，设置页两者联动同步。

## 6. 模块间关键流程

### 6.1 右键菜单搜索（`rb.pendingSearch`）

```
用户选中网页文本 → 右键“在 RuleBox 中搜索”
  → SW: chrome.contextMenus.onClicked
       setItems({ rb.pendingSearch: selectionText 截 500 字符 })
       → openPanel(tabId)（sidePanel.open → action.openPopup → tabs.create 三级降级）
  → popup: init 末尾 consumePendingSearch() / 已开面板由 onStorageChanged 监听消费
       读取 → removeItems（一次性）→ 切到语法库标签 → 填入搜索框 → renderAll → 聚焦选中
```

**决策记录**：右键菜单只做“搜索”，**不做“复制选中文本到剪贴板”**。原因：MV3 Service Worker 无页面焦点时 `navigator.clipboard.writeText` 不可靠，官方推荐 offscreen document 方案，引入该复杂度收益低（用户本来就能 Ctrl+C）。不要重复尝试在 SW 里写剪贴板。

### 6.2 复制流程

```
点击条目复制 → copyWithVariables(item)
  → item.vars 非空：openVariableDialog 填写（记住值到 rb.variables）→ missingVars 校验
  → applyVars 替换 → formatCopy（按 settings.ui.copyFormat）→ copyText
  → toast 反馈；**仅真实 POPUP 上下文**（state.isPopup）且 ui.closeAfterCopy 为 true 时延时关闭窗口
```

- 无 `vars` 的条目直接复制，不弹窗（与 `rb.variables` 是否已保存过无关）。
- SIDE_PANEL / TAB 永不自关（否则用户会丢失正在浏览的页面），只弹 toast。
- 语法库复制成功后若平台支持聚合查询，会调用 `maybeShowCopyGuide()` 在底部显示提示条；提示出现时**跳过** `closeAfterCopy` 自关，否则用户来不及点击“去查询”。
- 变量弹窗 `<form>` 的提交按钮（`.rb-dialog-foot` 内的 `type=submit`）必须位于 `<form>` 内部，否则回车/点击都不会触发提交。

**「存为文件」流程**（与复制同源，只差最后一步）：

```
点击下载图标 → downloadWithVariables(item)
  → resolveItemText（与 copyWithVariables 共用变量弹窗与 missingVars 校验）
  → sanitizeFilename(item.file)
  → item.filePrefix ? base64ToBytes(前缀) → downloadBlob([字节, 代码]) : downloadText(代码)
  → toast「已保存 xxx（大小）」，不关闭窗口
```

app.js 侧只在 `item.file` 非空时才把 `onDownload` 传给 `itemCard`，未声明文件名的条目不会出现按钮。星标按钮用 `data-action="favorite"` 定位，**不要再**用 `.rb-btn--ghost` 取「第一个 ghost」，操作区现在有多个 ghost 按钮。

### 6.3 AI 请求

```
app.js bindAi → sendAi → requestAI（ai-client.js）
  → 入口前置：features.ai 关闭 → toast「AI 功能已在设置中关闭」，不请求
  → 未启用 / 未配置（ai.enabled 关闭或活动档案缺 Key）→ toast 说明原因 + openOptions() 跳设置页
  → requestAI 内校验：活动档案 / endpoint 授权（hasEndpointPermission）/ 每日限额（rb.usage）/ 最小间隔
  → SSE 流式（settings.ai.stream）或普通响应；历史按 historyLimit 截取
  → 额度 / 鉴权类错误 → 直接在面板内显示可操作提示（不写告警记录、不上报）
```

未配置 Key 时仍会保留本轮“用户提问 + 助手错误提示”两条消息并写入 `rb.aiHistory`（便于用户回看失败原因），属于既定 UX，不要改成静默失败。

### 6.4 设置页自动保存

每个控件 change 即调 `updateSettings(mutator)` → `patchSettings(draft => { mutator(draft); return draft; })`。updater 建议显式 `return draft`；即使忘记返回，`patchSettings` 也会回退到被修改过的 draft，并且 `saveSettings` 拒绝非对象写入——这两层兜底是为修复“updater 返回 undefined → `mergeSettings` 当成新配置 → 本地 API Key 与默认标签页被整体重置”的事故，不要回退。

`patchSettings` 内部维护模块级串行队列 `settingsWriteQueue`：每次“读 → 改 → 写”按序执行，单次失败不会中断队列（失败结果只 reject 给调用方）。**不要绕过它直接 `saveSettings` 做局部更新**——连续快速切换多个开关时会因并发读改写互相覆盖而丢配置（已修复，回归时重点验证）。自定义数据写入后用 `invalidateCache()` 刷新共享缓存并向 SW 发 `rb:sync`。

### 6.5 聚合查询（`rb:cyber-search`）

```
面板选择平台（默认单选下拉，点「多选」切换为复选面板）+ 输入语法
  → chrome.runtime.sendMessage({ type:'rb:cyber-search', query, providers[], page, size })
  → SW handleCyberSearch：校验 sender.id、query 长度、平台 ID 白名单、page/size 范围
       → 读取 rb.settings.search.providers[].apiKey（仅 SW 用于发起请求；面板只判断“是否已配置”）
       → Promise.all 并行 searchOneProvider（固定端点 + 20s 超时）
       → 逐平台返回 { ok, total, items[] } 或 { ok:false, error }
  → 面板按平台分组渲染，支持翻页、点击跳转、复制地址、批量复制与导出
```

- 平台默认值：`lastProviders` 有记录就恢复；没有记录时优先已配置 Key 的平台，最后才回退 FOFA。`lastProviders` 默认为空数组，避免“首次打开被写成 FOFA”掩盖无历史状态。
- 会话快照：每次查询成功写入 `rb.cyberSession`（语法、平台、页码、每页条数、结果分组），面板初始化时恢复并在状态栏标注「上次查询（时间）」。popup 关闭会销毁页面内存，没有快照就只能重查、白耗额度；快照只存展示字段（最多 7 个平台 × 50 条），不含任何 Key，`resetAll` 会一并清除。快照始终写同一个键、覆盖旧值，不会随查询次数累积。
- 批量操作：状态行右侧「复制全部」把当前页所有成功条目转成 `url`（无 url 时用 `ip:port`）逐行复制并去重；「导出」按状态行的格式下拉生成 `rulebox-cyber-<时间>.<json|csv|md|txt>`：JSON 保留语法、平台、页码与完整字段；CSV 带 UTF-8 BOM、逗号/引号/换行按规范转义，便于表格软件直接打开；Markdown 输出元信息 + 表格；TXT 每行一条去重后的资产地址。两者都只作用于当前页已查到的结果，不会为了“导出全量”继续翻页消耗额度。
- 设置页每个平台提供「测试连接」（`rb:cyber-test`）：SW 只从设置读取 Key，同一平台 3 秒冷却；FOFA / Shodan 走账号信息接口（不消耗额度），其余平台用一次最小检索验证，探测条数见 `PROVIDER_PROBE_SIZE`（默认 1，Hunter 因接口枚举限制为 10）。`normalizePageSize` 允许 1 仅为此场景，界面下拉仍只有 10 / 20 / 50。

- 平台元数据、请求构造与响应解析全部在 `src/core/search-providers.js`，UI 不拼 URL、不解析平台响应；新增平台只改这一个文件（并在 `manifest.json` 补 host 权限）。
- SW 不接受页面传入的 URL / header，避免被利用做 SSRF；`providers` 只认注册表里的 ID。
- 每个平台独立 try/catch，单平台失败不影响其他平台；错误信息经 `sanitizeSearchError()` 剔除 API Key 后返回。
- 结果条目的标题 / 地址 / 字段均截断，地址只接受 `http(s)`；渲染统一走 `textContent`，禁止把平台返回值拼进 HTML。
- 平台语法不做跨平台翻译：切到多选后，同一段语法会原样发往各平台，语法差异由用户自行选择匹配的平台。
- 复制后提示条：仅 `kind === 'snippet'`、平台在 `SEARCH_PROVIDERS` 中、`search.enabled` 与 `search.promptAfterCopy` 均未关闭时出现；点击“不再提示”会写回设置，点击“去查询”会带入语法并在有 Key、无未填 `{{变量}}` 时自动检索。

## 7. 已知实现陷阱（改动前必读）

1. **`patchSettings` updater 应显式 `return draft`**（同上；漏写有兜底，但不要依赖兜底）。
2. **`el(tag, options, children)` 只扁平一层**：children 传嵌套数组会渲染成字符串，调用处必须自行展平。
3. **`chrome` 未声明时可选链抛 ReferenceError**：一律先判 `typeof chrome !== 'undefined'`（各文件有 `hasChrome` 常量）。
4. **`chrome.permissions.request` 必须在用户手势内、任何 `await` 之前同步调用**（`handleAuthorize` 已实现：先同步拿 Promise 再 await）。
5. **`testConnection` 会 reject（AIError）**，必须 try/catch，不要只看返回值。
6. **数字输入空值**：`Number('') === 0`，先 `numberOr(raw, fallback)` 判空再 clamp。
7. **多 overlay 的 Escape**：`mountOverlay`（`src/ui/form-dialog.js`）用 capture 阶段 + 最顶层判定 + stopPropagation，压制 `confirmDialog` 的 bubble 级无条件 Escape；新增弹窗要么走 `openFormDialog`，要么遵守同一约定。
8. **`.rb-field[hidden]` 需要 `display:none`**（flex 覆盖 UA 样式），已在 `src/shared/components.css` 统一提供，勿删。
9. **徽章类名**：设置页可用 `badge()/riskBadge()`（变体 accent/danger/warn/info）；`.rb-badge--platform` 只存在于 popup.css。
10. **条目卡片按钮顺序固定**为收藏 → 隐藏 / 编辑 / 删除 → 存为文件 → 复制：内置条目只有「隐藏」（写 `rb.hidden`，可恢复），自定义条目才出现编辑 / 删除；新增按钮一律用 `data-action` 或独立引用定位，不要按 ghost 顺序取。
11. **toast 类型**：`success / warn / danger / info`（无 error）。
12. **用脚本生成图标时注意编码**：无 BOM 的脚本文件在部分环境下按 ANSI/GBK 解析，脚本内容需保持 ASCII-only；`GraphicsPath.AddArc / SolidBrush / Pen` 的构造调用不够稳定，图标改用逐像素 `SetPixel` 方案生成（icons/ 下 4 个 PNG 已做像素级校验）。
13. **文件一律 UTF-8**：JS 内中文注释正常写；若出现“中文变 ？”乱码立即回滚定位编码问题。
14. **禁止用 `@media` 按视口宽度改写 `body` 尺寸**：Chrome 打开 action popup 时会先用一个很小的视口测量内容；若命中“窄屏兜底”把 body 改成 `100vw/100vh`，会与测量互相触发，把 popup 永久锁死在一个极小尺寸（曾出现 `154×187`）。正确做法：`popup.css` 中 body 固定 `420px × 580px`，SIDE_PANEL / TAB 由 `body.is-fluid` 铺满（类名由 `app.js` 的 `applyContextLayout()` 按上下文添加）。
15. **变量弹窗提交按钮必须在 `<form>` 内**：`.rb-dialog-foot` 若被放到 `</form>` 之后，`type=submit` 的按钮与回车都失效；`components.js` 的 `openVariableDialog` 已按“form 包裹 body + foot”实现，复用时不要拆开。
16. **`chrome.windows.create({ type: 'popup' })` 不是 POPUP 上下文**：它创建的是 `TAB` 上下文，`getContexts({ contextTypes: ['POPUP'] })` 查不到。测试真实 action popup（如 `closeAfterCopy`、固定尺寸）必须用 `chrome.action.openPopup()` 打开；否则会得到错误结论。
17. **筛选控件只有下拉一种实现**：平台 / 语法分类 / Payload 类型 / Payload 分类 / AI 提示词场景统一用 `<select class="rb-select rb-select--filter">`，由 `components.js` 的 `syncFilterSelect()` 生成选项，调用方必须把返回值写回 `state`。**禁止再引入任何横向滚动的 chip 条 / 标签条做筛选**——popup 固定 420px 宽，16 个平台排成滚动条一次只看得到 3 个，没有溢出提示，还会叠出多条同权重滚动行（旧实现已移除）。`syncFilterSelect()` 用 `dataset.optionSignature` 比对选项集合，只有集合真变化才重建 `<option>`，避免下拉展开中被强行收起、键盘焦点丢失。
18. **列表纵向滚动复位只发生在“换了一批结果”时**：平台 / 分类 / Payload 类型 / 搜索 / 收藏过滤 / 右键菜单搜索切换会调用 `app.js` 的 `resetContentScroll()`；“加载更多”只追加卡片，**禁止**调用，否则会打断阅读位置。
19. **禁止写 `scrollbar-width` / `scrollbar-color`**：Chromium 121+ 中这两个标准属性一旦出现，会整体覆盖 `::-webkit-scrollbar` 定制（`options.css`、`base.css` 两处都已剔除并留注释）。滚动条样式只能走 `::-webkit-scrollbar-thumb`；确需横向滚动的容器（如设置页左侧导航）配 `overscroll-behavior-x: contain` 防止滚动穿透。
20. **搜索与平台 / 类型 / 分类筛选是叠加关系**：`snippetScope()` / `payloadScope()` 先按平台（类型）取子集，再在子集内按关键词过滤；因此各下拉括号内的计数必须与实际结果同源（含“只看收藏”），页脚 `#footer-count` 也走同一份结果，禁止另算一套计数。
21. **列表容器不做 live region**：筛选 / 搜索会整体重建几十张卡片，逐条播报会淹没读屏；结果条数统一由页脚 `#footer-count`（`role="status"` + `aria-atomic`）播报。AI 消息区是唯一带 `aria-live="polite"` 的列表，生成中另加 `aria-busy`。
22. **弹窗焦点管理统一走 `components.js` 的 `manageDialogFocus()`**（已导出）：它负责记录触发元素、把焦点移入弹窗、Tab 循环陷阱与关闭后归还焦点。`form-dialog.js` 的 `mountOverlay()` 复用同一实现，新增弹窗不要另写一套焦点逻辑。
23. **筛选值必须在数据重载后回落**：自定义数据可被导入 / 删除，原先选中的平台、语法分类、Payload 类型 / 分类、AI 提示词场景可能已不存在；若不校验会得到“下拉显示空白 + 列表筛成空”。`syncFilterSelect()` 已内置“值不存在则回落首个选项”，并把校正后的值返回给调用方写回 `state`；新增筛选维度必须复用该函数，不要手写回落。
24. **自定义平台加载期必须去重**：`applyConfig` 不校验 `custom.platforms`，导入的配置可能带内置同 ID、彼此重复或空 ID 的平台。`data.js` 的 `loadAll()` 用 `seenPlatformIds` 统一过滤，否则平台下拉里会重复出现同一平台，且 `platformMap` 被后者覆盖。
25. **主题色不要硬编码前景色**：实心强调按钮的前景色用 `--rb-accent-contrast`（深色主题 `#07130a`、浅色主题 `#ffffff`），写在 tokens.css 的三处（`:root` / `[data-theme="light"]` / `prefers-color-scheme: light` 下的 `[data-theme="auto"]`）。直接写死深色会在浅色主题下变成深绿底深字（对比度不足 2:1）。这三处同时声明了 `color-scheme`（dark / light）——删掉它，深色主题下展开筛选下拉会得到白底 + 浅色字，选项几乎不可读。
26. **AI 历史必须过滤失败 / 生成中的回复**：请求失败或用户停止时，回复会以普通 assistant 消息留在 `state.ai.messages`；带进上下文会让模型把“请求失败：…”当成自己说过的话。组装 history 时过滤 `message.pending || message.error`。
27. **AI 错误样式类挂在消息节点**：`is-error` 必须加到 `.rb-ai-msg` 自身（`aiMessageNode()`），CSS 选择器是 `.rb-ai-msg.is-assistant.is-error`；加到 `.rb-ai-body` 不会生效。
28. **代码块正则两处必须同步**：`ai-client.js` 的 `extractCodeBlocks` 与 `app.js` 的 `renderRichText` 都要写成 `/```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g`，否则 CRLF 换行的模型回复既提不出代码块也渲染不出高亮。SSE 分帧同理，用 `/\r?\n\r?\n/`。
29. **IME 输入保护**：中文输入法回车确认候选词时会触发 `keydown` / `keyup`，所有“回车提交 / 回车复制”的监听必须先判 `event.isComposing`（或 `keyCode === 229`）再执行，否则会误触发搜索或复制。
30. **异常提示只做面板内反馈**：浏览器扩展没有 socket / SMTP 能力，任何“真发邮件”都要引入第三方 API 或自建服务端，与本地优先、零后端的定位冲突；`mailto:` 又依赖系统默认邮件处理器，无法校验送达，多数环境下会静默失败。群机器人 Webhook 同样需要用户自建通道、失败难排查。**不要引入邮件 / Webhook / 本地告警记录等通知链路**：额度 / 鉴权 / 限流等错误只在 AI 对话内显示可读提示（含错误码与控制台入口），不落库、不上报。历史遗留的通知类配置字段由 `mergeSettings()` 兜底清理。
31. **条目的 `vars` 必须与 `code` 里的 `{{占位符}}` 一一对应**：替换只认 `{{name}}`（`template.js` 的 `VAR_PATTERN`），`applyVars()` / `missingVars()` / `extractVars()` 都不识别 `<xxx>`、`{xxx}`、`$xxx` 等其它写法。声明了 `vars` 却把 `code` 写成 `<域名>` 字面量，用户填的值会被**静默丢弃**，复制出去仍是占位文本；反过来 `code` 里有 `{{}}` 而 `vars` 没声明，`normalizeVars()` 会自动补一个无名变量（无标签、无示例），体验同样差。另：`desc` 不参与变量替换，**禁止在 `desc` 里写 `{{}}`**。
32. **数据规范化是白名单式的**：`normalizeSnippet()` / `normalizePayload()`（`src/core/data.js`）只复制显式列出的字段，任何新字段（如 `file`、`filePrefix`）不同时加进这两个函数就会被静默丢弃，表现为「数据里明明有、UI 上就是不出现」。自定义条目也走同一套规范化，所以设置页表单新字段也要在这条链路上打通。新增字段时同步补 3.x schema 与本表。
33. **二进制文件头不能用纯文本凑**：有些格式的文件头恰好是纯 ASCII，可以直接写成文本；而带签名与 CRC 校验的二进制格式（如 PNG）用纯文本拼接只会得到损坏文件。这类样本必须用 `filePrefix`（Base64 真实字节）承载，且 `code` 只放可读的代码片段——不要把整段 Base64 塞进 `code`，否则复制出去是一串乱码，卡片预览也不可读。

## 8. 扩展指南

### 8.1 新增一个平台的语法

1. `data/platforms.json` 增加平台对象（`id` 唯一），**同时**填全 `operators` / `fields` / `syntax` / `tips`（AI 上下文，见 3.3 约定第 3 条）。
2. 新建 `data/snippets/<id>.json`（schema 见 3.3，条目 `source` 必须有出处），按官方字段表**全量覆盖**。
3. `data/index.json` 的 `snippets` 登记 `{ "path": "snippets/<id>.json", "platform": "<id>" }`。
4. 无需改任何 JS——数据层自动合并，平台下拉里会自动多出该项（选项与计数由 `syncFilterSelect()` 生成）。

### 8.2 新增一类 Payload

同上：`data/payloads/<type>.json` + index.json 登记 `payloads`。

若该组包含**可下载的样本文件**，给对应条目补 `file`（如 `"sample.txt"` 或与样本类型匹配的扩展名），卡片即出现「存为文件」按钮，用户填完变量可一键拿到完整样本。机制与约束见 3.7；不要在 UI 层另写下载逻辑。

若样本需要**真实二进制文件头**，再补 `filePrefix`（该文件的 Base64 骨架），下载时会先解码为字节再拼接 `code`。带签名 / 校验的格式不能用纯文本头伪造，必须给完整字节。

### 8.3 新增 AI 供应商

`src/core/providers.js` 的 `PROVIDERS` 数组加预设；若域名不在 manifest host_permissions，用户自定义端点会走 optional permissions 授权流程，无需改 manifest（除非要开箱即用）。

### 8.4 用户自定义（运行时）

设置页「自定义数据」支持新增平台与条目（存在 `rb.custom`，与内置合并渲染，ID/键冲突会校验拦截）。自定义平台语法条目必须挂到某个平台（内置或自定义均可）。

内置条目的隐藏名单（`rb.hidden`）在设置页有独立分区「内置条目显示」，不在「自定义数据」里，避免和多份自定义列表混在一起难找；面板页脚在存在隐藏条目时把快捷键提示换成「已隐藏 N 条 · 恢复」，点击带上 `?onlyHidden=1#builtin` 打开该分区并自动勾选“只看已隐藏”，直接看到可恢复的条目。面板隐藏写入串行执行（`hiddenWriteQueue`），连续快速点多个眼睛图标不会因并发读改写互相覆盖。

### 8.5 新增一个聚合查询平台

1. `src/core/search-providers.js` 的 `SEARCH_PROVIDERS` 增加平台元数据（`id` 必须与语法库平台 ID 一致；`keyUrl` / `keyHint` 用于设置页指引）。
2. 同文件补充 `buildProviderRequest()` 分支与 `parseProviderResponse()` 解析函数，统一输出 `{ total, items[], quota? }`，条目由 `buildItem()` 归一化。
3. `manifest.json` 的 `host_permissions` 增加该平台 API 域名（端点固定，不接受运行时传入）。
4. 无需改 UI：平台选择、设置页密钥行、分页、复制与跳转都从注册表自动生成。

已在用的平台：FOFA、Hunter 鹰图、Quake 360、ZoomEye、Shodan、0.zone、DayDayMap。ZoomEye 使用 `api.zoomeye.ai/v2/search`（`API-KEY` 头 + `qbase64`）；Quake 使用旧版 `X-QuakeToken` 端点，若账号已切换到新的 APPID/SECRET 签名接口，需要在此扩展鉴权方式；0.zone 将 `zone_key_id` 放在 JSON body，并按语法中的模块独有字段推断 `query_type`（site / domain / email / app / code），识别不到时按 site；DayDayMap 使用 `api-key` 头且 `keyword` 为 Base64。

非 Web 资产（SSH / Redis / MySQL 等）不会拼出 `http://ip:port` 跳转链接，避免点开必然报错；复制时仍回退为 `ip:port`，逻辑在 `assetUrl()` / `isWebAsset()`。

### 8.6 未来方向（已预留，未实现）

- 更多国际测绘平台（Censys、Netlas、BinaryEdge、Criminal IP、FullHunt 等）与可配置的自定义 API 适配器。
- 聚合结果导出（CSV / JSON）与查询历史（需先确认存储体积与隐私边界）。

## 9. 变更纪律

- 每次开发前：读本文档 + `git log`，检索是否已有同类实现（组件 / 字段 / 键 / API / 映射 / 业务逻辑）。
- 每次开发后：新增或修改存储键、数据字段、值域、组件、模块职责的，**同步更新本文档对应章节**；功能完成后自检“有没有遗漏的端点 / 字段 / 联动”，测试通过后提交 git。
- 发现各做各的重复实现（同功能多套组件、同义字段、冲突映射）：以本文档为准统一修正，并在本文档记录决策。

### 9.1 变更记录

> 本节只按版本记录对外可见的能力变更；逐次提交的完整历史以 git 提交记录为准。

| 版本 | 主要能力 |
| --- | --- |
| 2.0.0 | 聚合查询标签页：接入 FOFA / Hunter 鹰图 / Quake / ZoomEye / Shodan / 0.zone / DayDayMap，支持多平台并行检索、10/20/50 分页、结果跳转与复制；复制语法后“一站式查询”提示（可在设置关闭）；设置页新增测绘查询分区与本地 API Key 管理（导出时自动剔除）；`search-providers.js` 统一平台请求构造与响应归一化；语法库补充奇安信天眼、安恒 AiLPHA、华为云安全云脑、深信服 SIP、长亭全悉 T-Answer、新华三 SecCenter CSAP 六个态势感知平台，并将早期误命名的条目并入安恒 AiLPHA；平台选择改为默认单选下拉 + 可切换多选面板，打开时恢复上次使用或已配置 Key 的平台；设置页新增逐平台「测试连接」（`rb:cyber-test`，3 秒冷却，仅后台读取 Key）；API Key 改为输入即保存，避免未失焦就关闭页面导致丢配置；修复 `patchSettings` updater 漏写 return 时把 `undefined` 写入设置、导致平台 API Key 与默认标签页被整体重置的问题；结果导出支持 JSON / CSV / Markdown / TXT；默认标签页可跟随上次使用或固定 |
| 1.0.0 | 11 个测绘平台语法库与 19 类 Payload 库全量入库（按官方字段表覆盖）；变量填充与一键复制、收藏与最近使用、右键菜单搜索、侧边栏模式；深色 / 浅色 / 跟随系统三档主题；AI 助手多供应商流式生成（含本地召回示例与端点、额度、间隔三重校验）；文本与二进制样本「存为文件」；内置条目软隐藏与自定义条目就地编辑 |
