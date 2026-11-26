# RuleBox 隐私政策

最后更新：2026-11-27

RuleBox（以下简称“本扩展”）是一款在浏览器本地运行的安全语法与 Payload 速取面板。本政策说明本扩展如何处理你的数据。

## 1. 我们不收集任何数据

本扩展没有账号体系，不含统计、埋点、遥测或广告 SDK，也不会把你的任何数据回传到开发者或第三方服务器。开发者无法看到你的查询内容、API Key、收藏或对话记录。

## 2. 仅保存在本机的数据

以下数据通过浏览器提供的 `chrome.storage.local` 保存在你本机的浏览器配置目录中：

- 面板设置（主题、每页条数、导出选项等）
- 收藏与最近使用记录
- 自定义语法与自定义 Payload
- 变量填写历史
- 上一次聚合查询的结果快照
- AI 对话记录
- 你在设置页填写的各平台 API Key 与 AI 接口档案

这些数据不会离开你的设备。卸载本扩展或在设置页清除数据后即被删除。

## 3. 会向外发起的网络请求

只有在**你主动操作**时，本扩展才会发起请求，且请求直接发往你选择的服务：

| 场景 | 去向 | 发送内容 |
| --- | --- | --- |
| 聚合查询 / 测试连接 | 你选中的网络空间测绘平台官方 API | 查询语法、该平台的 API Key |
| AI 助手对话 | 你在设置中配置的 AI 供应商 | 你的提问、面板注入的语法库上下文 |
| 自定义 AI 端点 | 你填写的接口地址 | 同上，仅在授权该域名后可用 |

本扩展不注入任何页面脚本，不读取网页内容、浏览历史、书签、密码或本地文件。

## 4. 数据共享与出售

不共享、不出售、不转让任何数据。除上述你主动触发的请求外，本扩展不与任何服务器通信。

## 5. 权限用途

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存上述本地设置与记录 |
| `clipboardWrite` | 把语法或 Payload 复制到剪贴板 |
| `contextMenus` | 提供右键菜单快捷入口 |
| `sidePanel` | 提供侧边栏常驻模式 |
| 测绘平台与 AI 供应商域名 | 仅在对应功能被使用时发出请求 |
| `https://*/*`（可选） | 你添加自定义 AI 端点时，在点击操作内动态申请授权 |

## 6. 数据删除

卸载扩展即清除全部本地数据；也可在设置页使用“清除数据”功能单独清除。本扩展不保留任何云端副本。

## 7. 政策变更

本政策更新时会同步修改本页顶部的日期；涉及数据处理方式的重大变更会在版本更新说明中提示。

## 8. 联系方式

如有疑问，请在本项目仓库提交 Issue：<https://github.com/EdenSec/RuleBox/issues>

---

# Privacy Policy (English summary)

RuleBox runs entirely in your browser. It does **not** collect, transmit, share, or sell any personal data, and contains no analytics, telemetry, or advertising SDKs.

All settings, favorites, custom items, API keys, query snapshots, and AI chat history are stored locally via `chrome.storage.local` and never leave your device. Network requests occur only when you explicitly trigger a feature, and go directly to the service you selected: cyberspace-mapping platform APIs (your query and that platform's key) or the AI provider you configured (your prompt and built-in syntax context). No page scripts are injected, and the extension cannot read your browsing history, page content, bookmarks, or local files.

Uninstalling the extension deletes all locally stored data. Contact: <https://github.com/EdenSec/RuleBox/issues>
