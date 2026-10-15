# WLOC Control Center 1.1.1：Surge 适配

模块链接：
https://raw.githubusercontent.com/summer87279149/wloc/main/modules/wloc-control-center.sgmodule

## 使用

请使用支持 WebView 脚本引擎的 Surge（iOS 5.9.0+ / Mac 5.5.0+）。路线脚本用该引擎解码控制中心传来的 Base64 路线数据。

1. 在 Surge 的「模块」中选择「安装新模块」，粘贴上面的链接。
2. 关闭其他 WLOC 模块，启用这个模块。
3. 开启 Surge 的 MITM。按 Surge 的提示安装并信任 CA 证书。
4. 在同一台设备打开 https://wloc.app ，连接 Device Bridge，再保存坐标或路线。
5. 打开 https://gs-loc.apple.com/wloc-settings/ping 。成功时返回 JSON，包含 `ok: true`、`tool: Surge` 和版本 `1.1.1`。
6. 在控制中心查看状态和诊断，或访问 https://gs-loc.apple.com/wloc-settings/status 。

模块没有默认经纬度。静态坐标和路线均未生效时，原样放行 WLOC 响应。坐标保存在 Surge 的 `$persistentStore`；Shadowrocket 中的数据不会自动迁移。

要停止路线，请先在控制中心停止或清除路线。仅清除静态坐标不会停止正在运行的路线。关闭模块会停止后续改写，但已缓存的系统定位可能不会立刻变化。

## 适配内容

保留原模块的三个脚本、两个 Apple 域名、25m 精度、diagnostic 模式、info 参数和 `https://wloc.app` 控制中心地址。

- 使用 `.sgmodule`，添加 Surge 模块名称和说明。
- 布尔参数改为 `true/false`；不限响应体大小使用 Surge 的 `max-size=-1`。
- 修正响应脚本的 `$done` 返回值。Surge 的 `http-response` 直接返回 `{ status, headers, body }`。`http-request` 的本地 JSON 响应仍返回 `{ response }`。
- 路线请求脚本显式使用 `engine=webview`，确保可调用 `atob`。
- 将三个脚本的 1.1.1 快照放在 `dist/control-center-1.1.1/`，模块从本仓库加载。除响应返回值外，保留原脚本逻辑。`sources.json` 记录下载地址及原文件 SHA-256。

该模块仅处理 Apple WLOC 请求，不能保证所有 App 的定位都会改变。

## 验证

运行 `node --test tests/wloc-control-center-surge.test.cjs`，在模拟 Surge 全局变量的环境下检查设备桥、坐标读写、路线控制、二进制响应和异常透传。未在真实 iPhone 的 Surge 中验证系统定位结果。

Surge 官方文档：

- 模块：https://manual.nssurge.com/profile/module.html
- 请求脚本：https://manual.nssurge.com/scripting/http-request.html
- 响应脚本：https://manual.nssurge.com/scripting/http-response.html

来源：https://wloc.app/modules/wloc.module 及对应 1.1.1 脚本。保留原仓库的旧模块 `modules/wloc.sgmodule`，两者不要同时启用。
