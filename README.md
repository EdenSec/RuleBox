# RuleBox · 安全语法与 Payload 速取

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue) ![Chrome](https://img.shields.io/badge/Chrome-116%2B-green) ![Edge](https://img.shields.io/badge/Edge-116%2B-green) ![Manifest](https://img.shields.io/badge/Manifest-V3-3fb950) ![License](https://img.shields.io/badge/license-MIT-3fb950) ![Build](https://img.shields.io/badge/build-none-3fb950) ![Backend](https://img.shields.io/badge/backend-none-3fb950) ![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)

**面向网络安全工程师的浏览器速取面板** — 测绘语法、安全测试 Payload、AI 助手，三者合一，一键复制。

<sub>RuleBox — a local-first browser panel for security recon syntax, payloads, and AI-assisted query generation.</sub>

</div>

---

> 如果 RuleBox 对你有帮助，欢迎点一个 Star；发现语法过期或有更好的写法，欢迎提 Issue / PR。

## 📑 目录

- [这是什么](#-这是什么)
- [界面预览](#preview)
- [快速安装](#-快速安装)
- [快捷键](#shortcuts)
- [功能一览](#-功能一览)
- [AI 配置](#-ai-配置可选)
- [权限与隐私](#-权限与隐私)
- [FAQ](#-faq)
- [帮助、反馈与贡献](#-帮助反馈与贡献)
- [数据来源与免责声明](#-数据来源与免责声明)

---

## ✨ 这是什么？

做安全的都懂：`domain="example.com" && title="后台"` 这种 FOFA 语法、`' AND IF(1=1, SLEEP(5), 0) --` 这种 SQL Payload，每次做测试都在脑子里记、浏览器里搜。

**RuleBox 把这些变成了一个可搜索、可筛选、可变量填充的面板** — 装到 Chrome / Edge 里，按一下快捷键就弹出来，搜一下、填变量、点复制，直接粘到测试工具里。

- 🗂️ **11 个语法库**：8 个测绘与态势平台（FOFA / Hunter / Quake / ZoomEye / Shodan / Alpha / DayDayMap / 0.zone）+ Google / 百度 + 常用命令行工具
- 💣 **19 类安全测试 Payload / 252 条**：SQLi / XSS / SSRF / RCE / LFI / XXE / SSTI / Deserialization / JWT / NoSQL / LDAP / CRLF / Redirect / Upload / JNDI / Shell / Webshell / Sensitive / WAF
- 🤖 **AI 助手**（可选）：6 家预设 + 任意 OpenAI 兼容端点，自然语言生成定制语法与 Payload

目前内置 **730 条语法、252 条 Payload、20 条 AI 提示词**，全部可搜索、可筛选、可收藏。

---

<a id="preview"></a>

## 🖼️ 界面预览

**从搜索到复制（动图）**：搜索语法 → 点复制 → 填写 `example.com` → 预览确认 → 一键复制

<p align="center">
  <img src="assets/demo-varfill.gif" alt="搜索条目、填写变量并一键复制的完整流程" width="420">
</p>

**深色主题**（默认）

<p align="center">
  <img src="assets/screenshot-popup-dark.png" alt="主面板 · 语法库搜索" width="420">
  <img src="assets/screenshot-payloads-dark.png" alt="Payload 库 · 按类型与分类筛选" width="420">
</p>

<p align="center">
  <img src="assets/screenshot-varfill-dark.png" alt="变量填充 · 实时预览最终语法" width="420">
  <img src="assets/screenshot-ai-dark.png" alt="AI 助手" width="420">
</p>

<p align="center">
  <img src="assets/screenshot-settings-dark.png" alt="设置页" width="920">
</p>

<details>
<summary><b>浅色主题预览</b>（点击展开）</summary>

<br>

<p align="center">
  <img src="assets/screenshot-popup-light.png" alt="主面板 · 语法库搜索 · 浅色" width="420">
  <img src="assets/screenshot-payloads-light.png" alt="Payload 库 · 浅色" width="420">
</p>

<p align="center">
  <img src="assets/screenshot-varfill-light.png" alt="变量填充 · 浅色" width="420">
  <img src="assets/screenshot-ai-light.png" alt="AI 助手 · 浅色" width="420">
</p>

<p align="center">
  <img src="assets/screenshot-settings-light.png" alt="设置页 · 浅色" width="920">
</p>

</details>

> 主题可在设置页切换：跟随系统 / 深色 / 浅色；也可点击面板右上角的主题按钮快速切换。

---

## 🚀 快速安装

本项目是标准的 Manifest V3 扩展，**无需构建、无需打包**，直接加载源码目录即可。

### Chrome

1. 打开 `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本项目根目录（包含 `manifest.json` 的目录）
4. 点击工具栏的拼图图标，把 RuleBox 固定到工具栏（可选，但建议固定，方便随时打开）

### Edge

1. 打开 `edge://extensions/`
2. 打开「开发人员模式」
3. 点击「加载解压缩的扩展」，选择本项目根目录（包含 `manifest.json` 的目录）
4. 点击工具栏的拼图图标，把 RuleBox 固定到工具栏

> Edge 与 Chrome 扩展的存储互不共用 — 同一份源码可以同时装进两个浏览器，设置、收藏、最近使用按浏览器隔离。

### 更新

- 通过 Git 使用：`git pull` 后，在扩展管理页点击 RuleBox 卡片上的刷新按钮
- 通过 ZIP 使用：重新下载并解压覆盖原目录，再点击刷新
- 如果界面没有变化，关闭并重新打开面板

---

<a id="shortcuts"></a>

## ⌨️ 快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| `Ctrl+Shift+Y` / `Cmd+Shift+Y` | 打开 RuleBox 面板 |
| `Ctrl+K` / `Cmd+K` | 聚焦搜索框 |
| `Ctrl+1` / `2` / `3` | 切换 语法库 / Payload / AI 助手 |
| `Ctrl+Enter` | AI 输入框内发送请求 |
| `Escape` | 清空搜索 / 关闭弹窗 |

> 如果 `Ctrl+Shift+Y` 与其它扩展冲突，可在 `chrome://extensions/shortcuts` 中修改。

---

## 🧭 功能一览

### 语法库 / Payload 库

- **多维筛选**：平台 → 分类 → 关键词，三级组合快速定位
- **变量填充**：`{{domain}}`、`{{ip}}`、`{{target}}` 这类占位符复制时弹窗填写，填过的值自动记忆
- **复制格式**：仅代码 / Markdown 代码块 / 标题 + 代码，设置页一键切换
- **存为文件**：WebShell 等 10 条样本支持填完变量后一键下载为文件，直接用于授权测试
- **收藏 / 最近使用**：高频条目收藏后只看收藏；最近 20 条自动记录（可在设置中调整）
- **隐藏内置条目**：暂时用不到的点眼睛图标隐藏，不删除任何数据；设置页可恢复
- **自定义条目**：筛选行的 `+` 可就地新增；自定义卡片支持直接编辑、删除，跟内置的一样用
- **右键搜索**：选中网页文本后右键「在 RuleBox 中搜索」，关键词直接带入
- **侧边栏模式**：Chrome 116+ / Edge 116+ 固定常驻；低版本或侧边栏不可用时自动降级到弹窗 / 标签页

### AI 助手

- **自然语言生成**：「查询响应码为 200 的告警」→ 直接生成完整语法
- **提示词库**：内置 5 个场景、20 条提示词（资产测绘 / 暴露面排查 / 告警与研判 / Payload 定制 / 语法解释），也可以自己写
- **多供应商**：6 家预设 DeepSeek / 通义千问 / Kimi / 智谱 GLM / OpenAI / Ollama（本地），也支持任意 OpenAI 兼容端点
- **流式输出**：token 一个接一个出，不用等整批
- **本地召回示例**：请求前从库内检索最相关的少量条目作为参考，让生成风格贴近库内写法；只发送命中的少量示例，不上传全库
- **安全**：API Key 仅保存在本地 `chrome.storage.local`，请求时只发往你选择的供应商，导出配置时自动剔除；请求有域名授权、每日限额、最小间隔三重防护
- **错误即时提示**：额度不足、鉴权失败、限流等在对话里直接显示原因

### 深色终端风主题

- 深色 / 浅色 / 跟随系统三档
- 无渐变、无花哨装饰，信息密度高、长时间看不累
- 原生控件（下拉框等）随主题着色，深浅一致

---

## 🤖 AI 配置（可选）

1. 打开面板右上角「设置」→「AI 助手」
2. 打开「启用 AI 助手」总开关
3. 选择供应商（6 家预设：DeepSeek / 通义千问 / Kimi / 智谱 GLM / OpenAI / Ollama，或自定义任意 OpenAI 兼容端点），填入 API Key
4. 非内置域名端点首次使用需点击「授权域名」
5. 可调：模型、温度、超时、流式、历史条数、每日限额、系统提示词等

**接口异常时**：对话里立即显示错误原因与控制台入口；错误只在本机展示，不写入记录、不上传、不推送。

---

## 🔐 权限与隐私

RuleBox 没有后端服务，不上传语法库、Payload、收藏、历史，也没有遥测或统计上报。

| 权限 | 用途 |
| :--- | :--- |
| `storage` | 保存设置、收藏、最近使用、自定义条目 |
| `clipboardWrite` | 点击复制时写入剪贴板 |
| `contextMenus` | 提供「在 RuleBox 中搜索」右键菜单 |
| `sidePanel` | 侧边栏常驻模式 |
| `host_permissions` | 仅包含 5 家内置 AI 服务与本地 Ollama 地址 |
| `optional_host_permissions` | 自定义 AI 端点首次使用时按需申请，不授权则不发起请求 |

---

## ❓ FAQ

**数据保存在哪里？卸载会丢吗？**

设置、收藏、最近使用、自定义条目都保存在浏览器本地 `chrome.storage.local`。卸载扩展或清除扩展数据会丢失，建议定期在设置页导出配置备份。

**会把我的数据上传吗？**

不会。只有在你启用 AI 并主动发起请求时，才会把当前输入、对话历史和命中的少量示例发给你选择的 AI 供应商；不启用 AI 时，扩展不会向外部服务器发起请求。

**有 Chrome 应用商店版本吗？**

当前主要通过源码方式分发，方便审计、修改和二次开发；应用商店版本暂未提供。

**快捷键冲突怎么办？**

在 `chrome://extensions/shortcuts` 中修改。

**更新源码后要做什么？**

在扩展管理页点击 RuleBox 卡片上的刷新按钮；如果界面没有变化，关闭并重新打开面板。

**AI 必须配置吗？**

不必须。语法库、Payload 库、复制、收藏、自定义等核心功能完全离线可用。

**支持 Firefox / Safari 吗？**

当前仅支持 Chromium 系浏览器（Chrome / Edge 116+），未适配 Firefox / Safari。

---

## 🤝 帮助、反馈与贡献

- **遇到问题**：[提交 Issue](../../issues/new/choose)，尽量附上浏览器与扩展版本、复现步骤、控制台报错
- **想加语法 / Payload**：可以直接在面板或设置页新增，随加随用；也可以提 PR 修改 `src/data/` 下的 JSON（开发约定见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)）
- **提交代码前**：请先读 [DEVELOPMENT.md](docs/DEVELOPMENT.md)，保持无构建、纯原生 ES Module 的结构，不要在代码或数据里写入真实密码、Key、真实单位与个人的信息
- **贡献流程**：Fork → 新建分支 → 修改并本地加载验证 → 提交 PR；数据和代码贡献都欢迎

---

## 📖 数据来源与免责声明

- 语法与字段依据各平台**公开文档**与公开技术资料整理，条目内标注 `source` 来源；平台语法可能随官方改版而变化，欢迎纠错
- Alpha 态势感知为私有部署产品，字段参考通用模式整理，不同版本可能存在差异，示例值均为**通用占位**
- 本插件提供语法与 Payload 的速查、复制、生成与样本导出能力，所有内容仅供**已授权的安全测试与防御研究**使用。使用者在未授权目标上使用相关内容所产生的一切后果自行承担。

---

## 🗂️ 目录结构

```
RuleBox/
├─ manifest.json              # MV3 清单
├─ LICENSE                    # MIT 开源协议
├─ icons/                     # 扩展图标（16/32/48/128）
├─ assets/                    # README 截图与图片
├─ src/
│  ├─ background/             # Service Worker（右键菜单 / 侧边栏）
│  ├─ core/                   # 核心逻辑（存储、数据、AI、搜索、模板…）
│  ├─ data/                   # 内置 JSON 数据（平台 / 语法 / Payload / 提示词）
│  ├─ options/                # 设置页（HTML/CSS）
│  ├─ popup/                  # 弹窗（HTML/CSS）
│  ├─ shared/                 # 设计令牌与基础样式
│  └─ ui/                     # 界面逻辑（面板 / 设置页 / 组件库）
└─ docs/DEVELOPMENT.md        # 开发与维护文档
```

---

## 📜 License

本项目基于 [MIT License](LICENSE) 开源。

---

如果这个项目帮你省下了翻文档、拼 Payload 的时间，欢迎点一个 Star 支持一下。
