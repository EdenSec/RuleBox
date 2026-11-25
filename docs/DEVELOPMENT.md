# RuleBox 开发与维护文档

> 本文档面向后续所有开发 / 修复 / 扩展 RuleBox 的开发者与 AI Agent。
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
├─ background\service-worker.js   # MV3 SW：右键菜单、sidePanel.setOptions 同步、rb:sync 消息
├─ core\                          # 全部无 DOM 依赖的核心逻辑（SW 也可复用）
│   ├─ defaults.js                # STORAGE_KEYS、DEFAULT_SETTINGS、mergeSettings（唯一配置定义点）
│   ├─ storage.js                 # chrome.storage.local 封装 + localStorage 回退 + 各业务键读写
│   ├─ data.js                    # JSON 数据加载、归一化、缓存（loadAll / invalidateCache）
│   ├─ search.js                  # 搜索与分类统计（searchItems / filterByCategory / countCategories）
│   ├─ template.js               # {{变量}} 提取 / 填充 / 校验（applyVars / extractVars / missingVars / describeVar）
│   ├─ clipboard.js               # 复制格式化（formatCopy：code | markdown | title-code）
│   ├─ providers.js               # AI 供应商预设（PROVIDERS 数组，7 家 + custom）
│   ├─ ai-client.js               # OpenAI 兼容 Chat Completions 客户端（SSE 流式、testConnection、hasEndpointPermission）
│   ├─ logger.js                  # 日志
│   └─ utils.js                    # $、$$、el、uid、clamp、safeParse、debounce、copyText、truncate、mask、isAllowedEndpoint 等
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
    ├─ app.js                     # 面板逻辑（标签切换、搜索、复制、收藏、AI 对话、pendingSearch 消费）
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
- host_permissions：内置 5 家 AI 供应商域名 + `localhost/127.0.0.1`（Ollama）。
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
  "updated": "2026-10-22",
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
      "file": "shell.php",        // 可选：成品文件名，声明后可直接下载为可上传文件（见 3.7）
      "filePrefix": "iVBORw0...", // 可选：二进制前缀（Base64），图片马等样本先解码成字节再拼接 code（见 3.7）
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

`file` 是**可选**字段，值为建议文件名（如 `shell.php`）。语义与约束：

- **只有声明了 `file` 的条目**才在卡片操作区显示下载图标；未声明的条目依旧只有「收藏 + 复制」，避免 420px 宽的 popup 里每张卡片都挤三个按钮。
- 下载内容是**变量替换后的最终代码**（与复制共用 `resolveItemText()`，`src/ui/components.js`），因此带变量的样本填完变量再下载即为可直接上传的成品。
- `filePrefix` 是**可选**的二进制前缀（Base64），下载时先 `base64ToBytes()` 解码成字节，**拼在代码之前**再写入 Blob。用于真 PNG / JPG 这类无法用纯文本伪造的文件头（GIF 只用 `GIF89a` 六个 ASCII 字符即可，属于特例）。非法 Base64 会提示并中止下载，不会产出半截文件。
- `filePrefix` 只影响下载，**复制仍只复制 `code` 文本**；`code` 始终是可读的唯一真相源，二进制前缀只存「图片骨架」，两者不会出现内容漂移。
- 变量弹窗的确认按钮文案由 `confirmText` 区分：复制走默认「填充并复制」，下载传「填充并下载」。不要把它写死成单一文案，否则下载场景会误导用户以为只复制。
- 与复制不同，下载**不触发** `ui.closeAfterCopy`：一次通常要连续取多个样本。
- 文件名统一经 `sanitizeFilename()`（`src/core/utils.js`）净化，去掉路径分隔符与控制字符，防止条目数据写成 `../x.php` 落到下载目录之外。
- 实现用 `Blob` + `<a download>`（`downloadText()` / `downloadBlob()`），**不申请 `downloads` 权限**；延迟 4s revoke URL。
- 这两个字段都必须在 `normalizeSnippet()` / `normalizePayload()`（`src/core/data.js`）白名单里，否则会被静默丢弃——这是新增字段最容易踩的坑（见第 7 节陷阱 32）。
- 设置页「新增 / 编辑自定义条目」表单也有「文件名」「二进制前缀（Base64）」两个输入，运行时同样可配置；填了前缀却没填文件名会被表单拦下。
- 当前使用该字段的是 `payloads/webshell.json` 的 10 条可执行样本（php / jsp / jspx / aspx / ashx / GIF 图片马 / PNG 图片马）。新增同类样本时按同样方式补 `file`，**不要**另建一套"下载专用"数据结构。

## 4. risk 风险等级值域（三方同步，禁止私加）

**唯一值域：`recon` / `safe` / `low` / `attack` / `danger`**

| 值 | 徽标文案 | 变体 | 语义 |
| --- | --- | --- | --- |
| `recon` | 信息搜集 | info | 测绘 / 查询语法（语法库默认） |
| `safe` | 安全操作 | info | 无攻击性的操作（如 fid 回溯、Alpha 查询） |
| `low` | 低风险 | info | 查询 / 防御类 Payload |
| `attack` | 攻击载荷 | danger | 攻击性 Payload（Payload 默认） |
| `danger` | 高危 | warn | 高危操作（WebShell、反序列化执行等） |

同步点（新增值必须三处一起改 + 更新本表）：

1. `src/ui/components.js` 的 `RISK_LABELS`（徽标渲染，未知值兜底 low）。
2. `src/ui/item-dialog.js` 的 `RISK_VALUES` 白名单 + risk 下拉 options。
3. 内置 JSON 数据 / 用户自定义数据实际取值。

> 风险等级只用于卡片徽标，**不参与搜索、筛选与 AI 上下文**。新增条目时按类型自动推断（语法 → `recon`，Payload → `attack`），字段收进表单「高级选项」；用户手动改过之后不再随类型覆盖。

> 历史教训：数据文件使用了 `recon`/`safe`，而 UI 初版只认 `low`/`attack`/`danger`，导致徽标被兜底成“低风险”且自定义条目选不到正确值。2026-10 已按“扩展 UI 值域”方案统一（未改 300+ 处数据）。归一化兜底默认值（`data.js`）：snippet 缺 risk → `low`，payload 缺 risk → `attack`。

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

`rb.settings` 结构（`DEFAULT_SETTINGS`，`mergeSettings` 做深合并保证旧配置兼容）：

- `theme`：`auto | dark | light`
- `ui`：`closeAfterCopy`、`recentsLimit`、`defaultTab`、`showRiskBadges`、`copyFormat`、`showDesc`
- `features`：`sidePanel`、`contextMenu`、`ai`（功能开关，右键菜单 / 侧边栏开关变更后需向 SW 发 `rb:sync` 消息）
- `ai`：`enabled`、`activeProfileId`、`profiles[]`（id/name/providerId/baseUrl/model/apiKey/temperature/maxTokens/timeoutMs/thinking/extraBody）、`systemPrompt`（空字符串 = 使用内置默认）、`systemPromptAppend`、`includePlatformContext`、`historyLimit`、`stream`、`minIntervalMs`、`dailyRequestLimit`、`notifyOnQuotaError`
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

每个控件 change 即调 `updateSettings(mutator)` → `patchSettings(draft => { mutator(draft); return draft; })`。`patchSettings` 的 updater **必须 return**，否则保存 undefined 导致配置被重置。

`patchSettings` 内部维护模块级串行队列 `settingsWriteQueue`：每次“读 → 改 → 写”按序执行，单次失败不会中断队列（失败结果只 reject 给调用方）。**不要绕过它直接 `saveSettings` 做局部更新**——连续快速切换多个开关时会因并发读改写互相覆盖而丢配置（已实测复现并修复）。自定义数据写入后用 `invalidateCache()` 刷新共享缓存并向 SW 发 `rb:sync`。

## 7. 已知实现陷阱（改动前必读）

1. **`patchSettings` updater 必须 `return draft`**（同上）。
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
12. **PowerShell 5.1 生成图标**：无 BOM 文件按 ANSI/GBK 解析，脚本必须 ASCII-only；本机 `GraphicsPath.AddArc / SolidBrush / Pen` 构造调用失败，图标用逐像素 `SetPixel` 方案生成（已产出并像素级验证，icons/ 下 4 个 PNG）。
13. **文件一律 UTF-8**：JS 内中文注释正常写；若出现“中文变 ？”乱码立即回滚定位编码问题。
14. **禁止用 `@media` 按视口宽度改写 `body` 尺寸**：Chrome 打开 action popup 时会先用一个很小的视口测量内容；若命中“窄屏兜底”把 body 改成 `100vw/100vh`，会与测量互相触发，把 popup 永久锁死在 `154×187`（Chrome 151 实测）。正确做法：`popup.css` 中 body 固定 `420px × 580px`，SIDE_PANEL / TAB 由 `body.is-fluid` 铺满（类名由 `app.js` 的 `applyContextLayout()` 按上下文添加）。
15. **变量弹窗提交按钮必须在 `<form>` 内**：`.rb-dialog-foot` 若被放到 `</form>` 之后，`type=submit` 的按钮与回车都失效；`components.js` 的 `openVariableDialog` 已按“form 包裹 body + foot”实现，复用时不要拆开。
16. **`chrome.windows.create({ type: 'popup' })` 不是 POPUP 上下文**：它创建的是 `TAB` 上下文，`getContexts({ contextTypes: ['POPUP'] })` 查不到。测试真实 action popup（如 `closeAfterCopy`、固定尺寸）必须用 `chrome.action.openPopup()` 打开；否则会得到错误结论。
17. **筛选控件只有下拉一种实现**：平台 / 语法分类 / Payload 类型 / Payload 分类 / AI 提示词场景统一用 `<select class="rb-select rb-select--filter">`，由 `components.js` 的 `syncFilterSelect()` 生成选项，调用方必须把返回值写回 `state`。**禁止再引入任何横向滚动的 chip 条 / 标签条做筛选**——popup 固定 420px 宽，12 个平台排成滚动条一次只看得到 3 个，没有溢出提示，还会叠出多条同权重滚动行（旧实现已于 2026-10-23 删除）。`syncFilterSelect()` 用 `dataset.optionSignature` 比对选项集合，只有集合真变化才重建 `<option>`，避免下拉展开中被强行收起、键盘焦点丢失。
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
28. **代码块正则两处必须同步**：`ai-client.js` 的 `extractCodeBlocks` 与 `app.js` 的 `renderRichText` 都要写成 `/```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g`，否则 Windows 换行（CRLF）的模型回复既提不出代码块也渲染不出高亮。SSE 分帧同理，用 `/\r?\n\r?\n/`。
29. **IME 输入保护**：中文输入法回车确认候选词时会触发 `keydown` / `keyup`，所有“回车提交 / 回车复制”的监听必须先判 `event.isComposing`（或 `keyCode === 229`）再执行，否则会误触发搜索或复制。
30. **异常通知只做本地记录**：浏览器扩展没有 socket / SMTP 能力，任何“真发邮件”都要引入第三方 API 或自建服务端，与本地优先、零后端的定位冲突；`mailto:` 又依赖系统默认邮件处理器，无法校验送达，Windows 上常静默失败。群机器人 Webhook 同样要用户自建通道、失败难排查，对“用户主动发起对话、失败当场可见”的形态收益有限，两者均已于 2026-11-24 移除。因此通知只有两层：面板内错误提示（错误码 + 控制台入口）+ 本地告警记录（可复制内容，最多 50 条，`mask` 脱敏）。历史配置中的 `adminEmail` / `alertWebhookUrl` 会在 `mergeSettings()` 里被清理，不要再加回来。
31. **条目的 `vars` 必须与 `code` 里的 `{{占位符}}` 一一对应**：替换只认 `{{name}}`（`template.js` 的 `VAR_PATTERN`），`applyVars()` / `missingVars()` / `extractVars()` 都不识别 `<xxx>`、`{xxx}`、`$xxx` 等其它写法。声明了 `vars` 却把 `code` 写成 `<域名>` 字面量，用户填的值会被**静默丢弃**，复制出去仍是占位文本；反过来 `code` 里有 `{{}}` 而 `vars` 没声明，`normalizeVars()` 会自动补一个无名变量（无标签、无示例），体验同样差。另：`desc` 不参与变量替换，**禁止在 `desc` 里写 `{{}}`**。
32. **数据规范化是白名单式的**：`normalizeSnippet()` / `normalizePayload()`（`src/core/data.js`）只复制显式列出的字段，任何新字段（如 `file`、`filePrefix`）不同时加进这两个函数就会被静默丢弃，表现为「数据里明明有、UI 上就是不出现」。自定义条目也走同一套规范化，所以设置页表单新字段也要在这条链路上打通。新增字段时同步补 3.x schema 与本表。
33. **二进制文件头不能用纯文本凑**：`GIF89a` 恰好是 6 个 ASCII 字符，所以 GIF 图片马可以写成文本；PNG 的签名（`89 50 4E 47 0D 0A 1A 0A`）与 IHDR 带 CRC 校验，写 `PNG<?php ...` 只会得到一个坏图。这类样本必须用 `filePrefix`（Base64 真实字节）承载体，且 `code` 只放可读的代码片段——不要把整段 Base64 塞进 `code`，否则复制出去是一串乱码，卡片预览也不可读。

## 8. 扩展指南

### 8.1 新增一个平台的语法

1. `data/platforms.json` 增加平台对象（`id` 唯一），**同时**填全 `operators` / `fields` / `syntax` / `tips`（AI 上下文，见 3.3 约定第 3 条）。
2. 新建 `data/snippets/<id>.json`（schema 见 3.3，条目 `source` 必须有出处），按官方字段表**全量覆盖**。
3. `data/index.json` 的 `snippets` 登记 `{ "path": "snippets/<id>.json", "platform": "<id>" }`。
4. 无需改任何 JS——数据层自动合并，平台下拉里会自动多出该项（选项与计数由 `syncFilterSelect()` 生成）。

### 8.2 新增一类 Payload

同上：`data/payloads/<type>.json` + index.json 登记 `payloads`。

若该组包含**可直接落盘执行的样本**（WebShell / 免杀脚本等），给对应条目补 `file`（如 `"shell.php"`），卡片即出现「存为文件」按钮，用户填完变量可一键拿到可上传的成品文件。机制与约束见 3.7；不要在 UI 层另写下载逻辑。

若样本需要**真实二进制文件头**（PNG / JPG 等图片马），再补 `filePrefix`（该文件的 Base64 骨架），下载时会先解码为字节再拼接 `code`。PNG 不能用 `GIF89a` 那种纯文本头伪造：浏览器 / `getimagesize()` 会校验签名与 IHDR，必须给完整字节。

### 8.3 新增 AI 供应商

`src/core/providers.js` 的 `PROVIDERS` 数组加预设；若域名不在 manifest host_permissions，用户自定义端点会走 optional permissions 授权流程，无需改 manifest（除非要开箱即用）。

### 8.4 用户自定义（运行时）

设置页「自定义数据」支持新增平台与条目（存在 `rb.custom`，与内置合并渲染，ID/键冲突会校验拦截）。自定义平台语法条目必须挂到某个平台（内置或自定义均可）。

### 8.5 未来方向（已预留，未实现）

- 接入各测绘平台 API Key 直接查询（仅记录于 README 愿景，尚未开发——动手前先检索避免重复设计）。

## 9. 变更纪律

- 每次开发前：读本文档 + `git log`，检索是否已有同类实现（组件 / 字段 / 键 / API / 映射 / 业务逻辑）。
- 每次开发后：新增或修改存储键、数据字段、值域、组件、模块职责的，**同步更新本文档对应章节**；功能完成后自检“有没有遗漏的端点 / 字段 / 联动”，测试通过后提交 git。
- 发现各做各的重复实现（同功能多套组件、同义字段、冲突映射）：以本文档为准统一修正，并在本文档记录决策。

### 9.1 变更记录

| 日期 | 变更 | 影响范围 |
| --- | --- | --- |
| 2026-10-22 | FOFA 语法库按官方字段表全量补齐：49 → 109 条 / 11 分类；`platforms.json` FOFA 字段 35 → 74、运算符 6 → 7（补 `*=` 通配与空值语义） | `snippets/fofa.json`、`platforms.json` |
| 2026-10-22 | Hunter 语法库按官方语法全量补齐：34 → 99 条 / 13 分类；`platforms.json` Hunter 字段 24 → 76、运算符 8 → 7。**修正 4 处旧条目语义错误**：`icp.name=""` → `icp.name!=""`（非空）、`port` → `ip.port`、`os` → `ip.os`、`web.similar_icon=` → `web.similar_icon==` | `snippets/hunter.json`、`platforms.json` |
| 2026-10-22 | 新增 3.3 节「语法库覆盖约定（强制）」：官方全量字段 / 条目与官方一致 / snippets 与 platforms.json 同步 / categories 与代码解耦 / 会员限制写进 desc | `docs/DEVELOPMENT.md` |
| 2026-10-22 | Quake 360 语法库齐全：25 → 61 条 / 6 分类；`platforms.json` 字段 73、运算符 6（`:` / `AND` / `OR` / `NOT` / `()` / `""`），补充“逻辑符必须大写、数字与布尔值不加引号”的官方规则 | `snippets/quake.json`、`platforms.json` |
| 2026-10-22 | 零零信安 0.zone 语法库重写：5 → 83 条 / 7 分类；`platforms.json` 字段 58、运算符 14；旧条目与新条目字段语义统一到官方语法 | `snippets/zerozone.json`、`platforms.json` |
| 2026-10-22 | Shodan 语法库按官方 Filter Reference 重写：20 → 102 条 / 9 分类；`platforms.json` 字段 87、运算符 5；**修正 2 处非官方字段**：`http.server:` → `http.server_hash:`、`http.headers:` → `http.headers_hash:`（Shodan 无明文 server/headers 过滤器） | `snippets/shodan.json`、`platforms.json` |
| 2026-10-22 | **ZoomEye 官方语法体系改版**：`site:` 等冒号语法 → `domain=` / `=`（模糊）/ `==`（精确）等号语法。语法库 15 → 61 条 / 10 分类，旧条目全部按新语法改写（保留原 id 以延续收藏 key）；`platforms.json` 字段 44、运算符 7；`docUrl` 指向官方新版语法说明 | `snippets/zoomeye.json`、`platforms.json` |
| 2026-10-22 | **DayDayMap 官方语法体系改版**：冒号语法 → `field="value"` 等号 + `ip./web./cert./protocol.` 字段前缀。语法库 6 → 68 条 / 11 分类，旧条目全部改写（保留原 id）；`platforms.json` 字段 55、运算符 6；`docUrl` 改为官方帮助文档 | `snippets/daydaymap.json`、`platforms.json` |
| 2026-10-22 | Google Hacking 语法库补齐：16 → 26 条 / 3 分类；`platforms.json` 运算符 17（补 `allintitle:` / `allinurl:` / `allintext:` / `inanchor:` / `before:` / `after:` / `*` / `..`），字段 13；明确标注 `cache:` 已于 2024 年下线、`related:` 已弱化，仅作历史认知保留 | `snippets/google.json`、`platforms.json` |
| 2026-10-22 | **维护警示：测绘平台语法会整体改版**。ZoomEye、DayDayMap 均发生过“冒号 → 等号”的体系级变更，FOFA / Hunter 的 `=` 与 `==` 语义也需随时对照官方。改动任一条目前必须回官方文档核对，禁止凭记忆或旧博客补语法；核对后 snippets 与 `platforms.json` 同步更新，并在本表登记 | `snippets/*.json`、`platforms.json`、`docs/DEVELOPMENT.md` |
| 2026-10-22 | 补充 Edge 兼容说明（依据 Microsoft Learn 旁加载文档与 Edge 边栏扩展文档）：Chrome / Edge 共用同一份 MV3 源码，`side_panel` + `sidePanel` 在 Edge 侧边栏同样生效；README 安装章节拆为 Chrome / Edge 两节 | `README.md`、`docs/DEVELOPMENT.md` |
| 2026-10-22 | Hunter 语法库对照官方语法清单逐条复核：99 → 100 条（补缺失的裸字段 `app=`，官方组合示例 `app="Hikvision 海康威视 Firmware 5.0+" && ip.ports="8000"`）。**修正**：`is_domain` 语义改为「域名标记不为空」、`web.is_vul` 改为「存在历史漏洞」；6 条 whois 类（`domain.status` / `whois_server` / `name_server` / `creation_date` / `expiry_date` / `updated_date`）补标「特色语法」；3 条证书指纹与 `tls-jarm.ans` 的示例值替换为官方原值（原为编造）；`!==` 条目示例简化为纯精确剔除。`platforms.json` Hunter 字段 76 → 77、tips 4 → 5 | `snippets/hunter.json`、`platforms.json` |
| 2026-10-22 | FOFA 语法库对照官方「查询语法参考」逐条复核：109 → 115 条。**补遗漏**：4 条证书布尔反向变体（`cert.is_equal=false` / `cert.is_valid=false` / `cert.is_match=false` / `cert.is_expired=false`）、2 条运算符语义条目（`!=` 不匹配、`==` 完全匹配）。**修正**：`fofa-ipv6` 删除官方未提供的「IPv6 网段」臆造说明；`fofa-cert-valid` 还原官方纯形式 `cert.is_valid=true`；`fofa-subdomain` 还原官方纯形式 `type="subdomain"`（与 `fofa-type-service` 对称）；`fofa-protocol` 去掉「需配合 type="service"」的误导措辞。`platforms.json` FOFA 字段 74、运算符 7 无变化，tips 4 → 5（补独立 IP 语法须配合 `ip_filter` / `ip_exclude`） | `snippets/fofa.json`、`platforms.json` |
| 2026-10-23 | UI 细节打磨：新增 `replaceChips()` 统一 4 个 chips 挂载点，修复「横向滚到右侧后点击 chip，导航条跳回最前」的连续性问题（同时保证激活项可见、键盘焦点不丢）；新增 `resetContentScroll()`，在平台 / 分类 / Payload 类型 / 搜索 / 收藏 / 右键搜索切换时复位列表纵向滚动，「加载更多」不复位 | `src/ui/components.js`、`src/ui/app.js` |
| 2026-10-23 | 空状态文案按场景区分：已有收藏但当前筛选无命中、最近为空、平台 / 类型 / 分类为空分别给出准确提示；复制后「最近」chip 计数即时同步（定向更新计数，不重建 chips） | `src/ui/app.js` |
| 2026-10-23 | 第二轮细节打磨（交互与可达性）：4 处输入监听补 `isComposing` 保护；搜索框「清空」按钮随输入即时显隐；列表移除 `aria-live` 改由页脚 `role="status"` 播报结果条数；弹窗焦点陷阱与归还统一为 `manageDialogFocus()`；设置页表单弹窗支持 Enter 提交、校验失败自动聚焦首个错误项；快捷键文案随平台（`isMacPlatform()` 唯一实现） | `src/ui/app.js`、`src/ui/components.js`、`src/ui/options.js`、`src/core/utils.js`、`src/popup/popup.html` |
| 2026-10-23 | 第二轮细节打磨（数据与主题一致性）：平台 / 语法分类 / Payload 类型 / AI 提示词组四处筛选值失效回落 `'all'`；自定义平台加载期按 ID 去重；AI 历史过滤失败与生成中消息；AI 错误样式类改挂消息节点；新增 `--rb-accent-contrast` 令牌修复浅色主题实心按钮对比度；管理员邮箱收敛到 `DEFAULT_ADMIN_EMAIL`（设置页占位符统一使用通用示例值） | `src/core/data.js`、`src/core/defaults.js`、`src/core/notify.js`、`src/ui/app.js`、`src/ui/options.js`、`src/options/options.html`、`src/shared/tokens.css`、`src/shared/base.css` |
| 2026-10-23 | **数据语法 / Payload 全量审计**：①`payloads/` 12 个文件修正「声明 `vars` 但 `code` 用 `<xxx>` 字面量」的占位符错位（xxe 12 / ssrf 16 / jndi 11 / shell 12 / rce 16 / lfi 16 / jwt 12 / nosql 11 / redirect 11 / deserialization 12 / ldap 11 / webshell 13 条全部对齐）；②语义 / 语法硬伤：redirect.js 8 条 var-code 不对齐、deserialization 3 处（`<dnslog 域名>` 未替换、phar 路径反斜杠、CVE-2016-7124 标题与版本区间不符）、nosql 2 处（`$or` 第二分支非恒真、`$where` 放在 query-string 顶层不可行）、ldap `admin)(&(...` 非绕过改 `admin)(|(...`、webshell `find` 的 `-o`/`-type f`/`-mtime` 优先级与 ASHX 处理器不完整、gopher RESP 长度 `%2434`→`%2422`、xxe 未定义实体 `&send;`、jndi 重复条目、shell-php fd3 依赖；③`snippets/tools.json` 21 条 CLI（subfinder/amass/httpx/naabu/nmap/ffuf/whatweb/curl/nuclei/sqlmap/mysql/redis-cli/dig/whois）逐条核对**无错误**，未改动；④`snippets/fofa.json` 4 条 `cert.not_after/not_before` 时间字段无官方证据，desc 改为「可用性视套餐而定」并给出 `cert.is_expired` / `after-before` 降级写法；⑤新增第 7 节陷阱 31（vars 与 `{{}}` 必须一一对应，desc 禁止出现 `{{}}`） | `src/data/payloads/*.json`、`src/data/snippets/fofa.json`、`docs/DEVELOPMENT.md` |
| 2026-10-23 | **条目「存为文件」**：新增可选字段 `file`（建议文件名）。`utils.js` 增 `sanitizeFilename()` / `downloadText()`（Blob + `<a download>`，不申请 `downloads` 权限，4s 后 revoke）；`components.js` 把原 `copyWithVariables` 拆为 `resolveItemText()` + `copyWithVariables()` / `downloadWithVariables()`，复制与下载共用同一套变量流程；`itemCard()` 增 `onDownload`，仅 `item.file` 非空时渲染下载图标，星标按钮改用 `data-action="favorite"` 精确定位；`payloads/webshell.json` 9 条可执行样本补 `file`（`shell.php` / `shell.gif.php` / `shell.jsp` / `shell-echo.jsp` / `shell.jspx` / `shell.aspx` / `shell.ashx` 等）；设置页自定义条目表单增「文件名」输入；`options.js` 导出配置改用 `downloadText()` 消除重复下载实现 | `src/core/utils.js`、`src/ui/icons.js`、`src/core/data.js`、`src/ui/components.js`、`src/ui/app.js`、`src/ui/options.js`、`src/data/payloads/webshell.json`、`docs/DEVELOPMENT.md` |
| 2026-10-23 | **筛选区重构（替代 2026-10-23 的 chips 方案）**：popup 里两条堆叠的横向滚动 chips 在 420px 宽下只露出 3 项、无溢出提示、滚轮纵向滚动“滑不动”，且 AI 页还有第三条。四处筛选位点（平台 / 语法分类 / Payload 类型 / Payload 分类）统一改为一行并排的两个 `<select>`，AI 提示词场景改为单个下拉；删除 `chips()` / `replaceChips()` 与 `components.css` 整套 `.rb-chips/.rb-chip` 样式，新增唯一筛选实现 `syncFilterSelect()`（选项签名比对、失效值回落、`allLabel:null` 支持“必选一项”）。筛选区高度约 70px → 32px，插件内不再出现任何横向滚动条；`tokens.css` 三处补 `color-scheme`，修复深色主题下下拉选项面板白底浅字不可读 | `src/ui/components.js`、`src/ui/app.js`、`src/popup/popup.html`、`src/popup/popup.css`、`src/shared/components.css`、`src/shared/tokens.css`、`docs/DEVELOPMENT.md` |
| 2026-10-23 | **图片马支持真二进制**：新增可选字段 `filePrefix`（Base64 二进制前缀），下载时 `base64ToBytes()` 解码后拼在 `code` 之前写入 Blob，用于 PNG 这类无法用纯文本伪造文件头的样本（GIF 的 `GIF89a` 属特例）。`utils.js` 抽出 `downloadBlob()` 供 `downloadText()` 复用，新增 `base64ToBytes()`（兼容 data URL 前缀、非法输入返回 null）；`webshell.json` 新增「PNG 图片马（真图成品）」（真实 1×1 PNG 70 字节 + 尾部一句话，`file: shell.png`），可执行样本 9 → 10 条；设置页自定义条目表单增「二进制前缀（Base64）」文本域，含 Base64 合法性、必须同时填文件名的校验；补充第 7 节陷阱 33（二进制头不能用纯文本凑） | `src/core/utils.js`、`src/core/data.js`、`src/ui/components.js`、`src/ui/options.js`、`src/data/payloads/webshell.json`、`docs/DEVELOPMENT.md` |
| 2026-11-24 | 全平台语法复核：逐条对照官方文档 / 搜索框语法弹窗，修正 0.zone 邮箱模块 `company` 字段与 `leakage_num` 比较语义、Google `ext:` 标注为非官方并移除已下线的 `cache:` 字段、百度补 `filetype:all` 与 `\|` 空格规则并标注 `+` / `《》` / `()` 非官方、Alpha 注明无公开语法文档、工具命令补 PowerShell 引号差异；同步统一各平台示例中的占位单位与域名 | `snippets/*.json`、`platforms.json` |
| 2026-11-24 | 通知体验：Webhook 测试与告警回写 `delivery`（`ok/fail/off`）并展示送达徽标与失败原因；AI 档案温度 / 最大 Token / 超时 / 思考模式 / 自定义请求参数统一折叠进「高级选项」，思考模式按供应商映射为下拉选项 | `options.html`、`options.js`、`options.css`、`notify.js`、`storage.js`、`providers.js`、`ai-client.js`、`app.js` |
| 2026-11-24 | **精简通知：移除邮箱通道**。确认邮箱告警在“用户主动发起对话”的形态下价值有限（失败当场可见，已有错误码与控制台入口），且扩展无法 SMTP、`mailto` 依赖系统默认邮件应用、无法校验送达。删除管理员邮箱字段、`buildMailto()`、邮件测试按钮与相关徽标；告警记录改为「复制内容」+ 可选 Webhook（`delivery.webhook` 为 `ok/fail/off`）。`mergeSettings()` 清理历史 `adminEmail` 字段，导出去掉对应剔除逻辑 | `options.html`、`options.js`、`options.css`、`notify.js`、`defaults.js`、`storage.js`、`README.md` |
| 2026-11-24 | **彻底移除 Webhook 通知**：通知收敛为「面板内错误提示 + 本地告警记录（可复制）」两层。删除设置页 Webhook 地址输入、测试按钮、获取教程与送达徽标，删除 `notifyAdmins` 的 `postWebhook` 分支、`delivery` 回写与 `storage.updateAlert()`；`renderAlerts()` 仅保留标题 / 时间 / 详情 / 复制；`mergeSettings()` 继续清理历史 `adminEmail` 与 `alertWebhookUrl` | `src/options/options.html`、`src/options/options.css`、`src/ui/options.js`、`src/core/notify.js`、`src/core/ai-client.js`、`src/core/defaults.js`、`src/core/storage.js`、`README.md` |
| 2026-11-24 | **面板就地编辑 + 表单统一**：①AI 工具栏新增「模型」下拉，直接切换 `ai.activeProfileId`（不再被迫进设置页），档案为空时禁用并提示去配置；②语法库 / Payload 筛选行新增「+」，复用设置页条目表单就地新增，提交后主动 `loadAll(true)` + `renderAll()` 立即刷新列表（localStorage 预览环境没有 `chrome.storage.onChanged`）；③抽出 `src/ui/form-dialog.js`（`mountOverlay` / `openInfoDialog` / `openFormDialog`）与 `src/ui/item-dialog.js`，设置页与面板共用同一套字段、校验与风险规则；④条目表单修复：切换类型自动推断风险等级（语法 `recon` / Payload `attack`）、平台下拉必填并带空值占位、`file` / `filePrefix` 仅 Payload 显示、分类 / 分组提供历史输入建议、风险与低频字段收进「高级选项」；⑤原本只写在 `options.css` 的表单网格 / 折叠块迁入 `shared/components.css`，面板弹窗同样保持两列与 420px 单列适配；⑥平台表单：名称自动生成合法 ID、编辑时 ID 锁定、ID / 颜色 / 文档地址校验按字段提示 | `src/ui/form-dialog.js`、`src/ui/item-dialog.js`、`src/ui/options.js`、`src/ui/app.js`、`src/popup/popup.html`、`src/popup/popup.css`、`src/shared/components.css`、`src/options/options.css`、`docs/DEVELOPMENT.md` |
| 2026-11-24 | **系统提示词可见可编辑**：`ai-client.js` 导出 `DEFAULT_SYSTEM_PROMPT` 作为基准，新增 `ai.systemPrompt`（空字符串 = 内置默认）；设置页 AI 区新增「系统提示词」卡片，展示生效全文、可编辑、可恢复默认，并显示「内置默认 / 自定义」状态；与内置文本一致或留空时不落库，保证扩展升级默认提示词后自动生效；平台字段上下文与 `systemPromptAppend` 仍由 `buildSystemPrompt()` 系统拼接，避免用户误删字段规则；`mergeSettings` 对导入的提示词字段做字符串校验 | `src/core/ai-client.js`、`src/core/defaults.js`、`src/ui/options.js`、`src/options/options.html`、`README.md`、`docs/DEVELOPMENT.md` |
| 2026-11-25 | **移除异常告警链路**：删除 `src/core/notify.js`、`rb.alerts` 存储键与 `getAlerts / pushAlert / clearAlerts`、设置页「告警记录」卡片与相关 CSS、`ai.notifyOnQuotaError` 设置项（`mergeSettings` 兜底清理旧字段）；`ai-client.js` 去掉 `afterFailure` 与 `notifyAdmins` 调用，额度 / 鉴权 / 限流错误只在对话内提示，不落库、不上报 | `src/core/notify.js`、`src/core/defaults.js`、`src/core/storage.js`、`src/core/ai-client.js`、`src/options/options.html`、`src/options/options.css`、`src/ui/options.js`、`README.md` |
| 2026-11-25 | **条目卡片就地操作**：自定义条目卡片新增编辑 / 删除按钮（删除走 `confirmDialog` 二次确认），复用 `src/ui/item-dialog.js` 与页面同一套表单；内置条目卡片新增「隐藏」按钮，只写 `rb.hidden` 名单，不删除内置 JSON 与自定义数据；`itemCard()` 增加 `onEdit / onDelete / onHide`，按钮顺序固定为收藏 → 隐藏 / 编辑 / 删除 → 存为文件 → 复制 | `src/ui/components.js`、`src/ui/app.js`、`src/ui/icons.js`、`src/popup/popup.css` |
| 2026-11-25 | **内置条目软隐藏**：新增 `rb.hidden`（`kind:id` 数组）与 `getHidden / setHidden`；面板在数据入口 `applyHidden()` 统一过滤并重算平台 / 分组条数，保证列表、搜索、计数口径一致；设置页新增「内置条目显示」卡片，支持搜索、只看已隐藏、逐条隐藏 / 恢复与「全部恢复」（二次确认）；面板与设置页通过 `chrome.storage.onChanged` 实时同步 | `src/core/defaults.js`、`src/core/storage.js`、`src/ui/app.js`、`src/ui/options.js`、`src/options/options.html`、`src/options/options.css`、`docs/DEVELOPMENT.md` |
| 2026-11-25 | **新增条目表单简化**：隐藏类型选择（由入口决定语法 / Payload）、分类改为「分类 / 类型」并给出说明、标签与说明补充用途提示、`{{变量}}` 输入实时提示、底部增加与面板一致的卡片实时预览；共享表单同步用于设置页与面板 | `src/ui/item-dialog.js`、`src/ui/form-dialog.js`、`src/popup/popup.css`、`src/shared/components.css` |

