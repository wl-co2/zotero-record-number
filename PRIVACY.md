# Zotero Record Number 隐私检查

## 结论

插件代码不上传数据、不含遥测，也没有第三方运行依赖。唯一允许的外网访问是 Zotero 自身从 GitHub 读取插件版本清单并下载用户可安装的新版 XPI。

Zotero 7.0.15 的安装器强制要求非空 `update_url`。清单使用 `https://raw.githubusercontent.com/wl-co2/zotero-record-number/main/updates.json`。更新清单只包含插件版本、兼容范围、XPI 下载地址和文件哈希。

## 检查范围

- XPI 中只允许包含 `manifest.json`、`bootstrap.js`、`prefs.js` 和 `record-number-core.js`。
- 检查网络入口：`fetch`、`XMLHttpRequest`、`WebSocket`、`Zotero.HTTP` 和 HTTP/HTTPS URL。
- 检查遥测、分析、Pro/授权、PDF 与图像处理相关标识。
- 检查清单是否只包含规定的 GitHub `update_url`，并确认没有其他联网地址或 `homepage_url`。
- 检查源码是否声明 npm 或其他第三方运行依赖。

## 数据访问

- 读取：仅“我的文库”普通文献的 `title`、`dateAdded`、`Extra`、条目 ID 和 library ID。
- 写入：仅向缺失编号的普通文献 `Extra` 追加一行 `Record Number: 数字`。
- 本地设置：自动发号开关和已经发放过的最大号码。
- 不读取 PDF、附件内容、笔记正文、账号、Cookie、API 密钥或文件系统中的其他资料。

## Zotero 同步边界

插件代码没有网络 API。Zotero 插件管理器会访问上述 GitHub 更新清单，GitHub 因而能够看到普通 HTTPS 访问产生的 IP、时间和 User-Agent 等连接信息，但请求中不含题录、PDF、Record Number 或使用行为。如果用户本来启用了 Zotero 数据同步，Zotero 会把修改后的 `Extra` 元数据同步到用户配置的 Zotero 账户；这是实现跨电脑显示相同编号所必需的 Zotero 原生行为。关闭 Zotero 同步后，编号只保留在本机。

## 第三方代码

成品不包含 Zotero One 的 `fabric`、`pdf-lib`、`pdfjs-dist`、`zotero-plugin-toolkit` 或其构建依赖。列注册使用 Zotero 官方 `ItemTreeManager` API，菜单使用 Zotero 主窗口原生元素。

## 尚未执行的验证

为避免未经允许修改正在运行的 Zotero 和真实文库，本次不自动安装 XPI，也不在真实文库上执行发号。功能验证采用核心逻辑自动测试、JavaScript 语法检查、静态隐私扫描及 XPI 内容检查。

## 本次验证结果

- JavaScript 语法检查：通过。
- 编号解析、追加、缺失、无效与重复检测测试：通过。
- 模拟 Zotero API 的初始化、列显示、连续发号和删除后不复用测试：通过。
- Zotero 原生进度窗口的数量、总数和百分比更新测试：通过。
- XPI 静态扫描：未发现网络 API、遥测、授权、PDF 或图像处理代码；清单中唯一 URL 是 GitHub `updates.json`。
- XPI 实际内容：`bootstrap.js`、`manifest.json`、`prefs.js`、`record-number-core.js`，共 4 个文件。
- XPI 大小：5733 字节。
- SHA-256：`67A5D313941EAFCAC114A870E3CD4CB872DB18870CFDD61B74A57F62034C6AB8`。
