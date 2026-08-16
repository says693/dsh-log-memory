# dsh-log-memory 🐋

**简体中文 | [English](./README.en.md)**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-4c1)](https://github.com/topics/dsh-plugin)
[![Version](https://img.shields.io/badge/version-1.3.0-green.svg)](./package.json)

DSH（Deepseek Harness）插件：**打开 Web 即弹窗守护会话日志**——弹窗里能备份、能调提醒间隔、能选备份文件夹。

> 会话日志是和 AI 助手的所有对话记忆——文件损坏、误删、格式迁移翻车时，一份独立备份就是救命的。

## 功能

- 🚪 **打开 Web 即弹窗**：每次打开 DSH 界面立即弹出守护面板（勾选「今日不再提醒」后当日不再打扰）
- 💾 **弹窗内询问是否备份**：「立即备份到文件夹」一键把 `~/.dsh/sessions` 下所有 `session.jsonl` / `session.jsonl.zstd` **增量复制**到备份文件夹（按「路径:大小:mtime」跳过未变化文件，完整保留 `<工作目录根>/<会话 id>/` 目录结构，索引持久化）
- ⏰ **弹窗内设定提醒时间**：预设档（10 分钟 / 30 分钟 / 1 小时 / 2 小时 / 3 小时）+ 滑杆自由微调，范围 **10 分钟 – 3 小时**，改动即保存并立即重排定时器，重启不丢
- 🎚️ **备份格式二选一（双钮自由切换）**：
  - **🐟 鱼话版**：原始 `.zstd` 压缩包，机器格式，可用于恢复
  - **🧑 人话版**：每个会话渲染成可直接阅读的 `.txt` 聊天记录（标题/时间/token 用量档案头 + 按轮次排版的用户消息、助手思考与正文、工具调用与结果）
  - 两种格式各自维护独立增量索引，切换后首次备份为该格式全量，之后恢复增量；选择持久化
- 📁 **首次安装引导**：安装后的第一个弹窗会要求确认/填写备份文件夹（绝对路径），运行期间也可随时在弹窗里修改；支持 **「📁 浏览…」弹窗内点选**（服务端列目录实现的文件夹浏览器：上一级/子目录点选/粘贴路径跳转，无需手填）
- 📅 **今日不再提醒**：按北京时间自然日静音，跨天自动恢复
- 🔒 **安全边界**：HTTP 路由仅接受同源 POST；备份是纯本机文件复制，不联网、不上报任何数据

## 安装

### 方式一：手动安装

1. 把本文件夹复制到 DSH 的 profile 依赖目录：

   ```
   C:\Users\<你>\.dsh\profiles\web\node_modules\dsh-log-memory\
   ```

2. 编辑 `C:\Users\<你>\.dsh\profiles\web\package.json`：

   在 `dependencies` 中加入：

   ```json
   "dsh-log-memory": "file:<本文件夹的绝对路径>"
   ```

   在 `dsh.profile.bundles` 数组末尾加入：

   ```json
   "dsh-log-memory"
   ```

3. 重启 DSH（Deepseek Harness EAC）。**首次打开 Web 即弹出引导面板**。

### 方式二：作为本地依赖安装

把本文件夹放到任意固定位置，然后执行方式一的第 2 步（`file:` 依赖指向该位置）并重启。

## 配置

提醒间隔与备份文件夹**优先在弹窗里设置**（持久化于 `<DSH_HOME>/profiles/<profile>/log-memory.json`）。`cordis.patch.yml` 里的 config 仅作为初始默认值：

| 键 | 默认值 | 说明 |
|---|---|---|
| `intervalMinutes` | `30` | 初始提醒间隔（分钟），需在 10–180 内 |
| `backupDir` | `''` | 初始备份文件夹（绝对路径）；留空使用 `<用户主目录>/dsh-log-memory-backups` |
| `backupMode` | `'fish'` | 初始备份格式：`fish`（鱼话版 .zstd）/ `human`（人话版 .txt） |
| `debug` | `false` | `true` 时：启动 20 秒后先弹一次提醒，并开放 `POST /ds-log-memory/test-remind` |

## HTTP 路由

| 路由 | 方法 | 说明 |
|---|---|---|
| `/ds-log-memory/state` | GET | 状态：设置、首次引导标志、间隔范围、当前提醒、上次备份、下次提醒时间 |
| `/ds-log-memory/settings` | POST | 运行时设置：`{ intervalMinutes?, backupDir?, backupMode? }`（间隔钳制 10–180；文件夹须为绝对路径且不在会话目录内；格式 fish/human 二选一） |
| `/ds-log-memory/ack` | POST | 关闭当前提醒 |
| `/ds-log-memory/mute-today` | POST | 今日不再提醒 |
| `/ds-log-memory/backup` | POST | 立即增量备份 |
| `/ds-log-memory/browse` | GET | 目录浏览（`?path=` 绝对路径，仅返回子目录列表；空 path 默认用户主目录）——弹窗内「浏览…」按钮的数据源 |
| `/ds-log-memory/test-remind` | POST | 调试：手动触发提醒（仅 `debug: true` 时可用） |

POST 路由均要求同源（校验 `Origin` 与 `Host` 一致）。

## 恢复说明

增量备份把「变化的文件」分散在各时间戳批次目录中：恢复某份会话日志时，请从**最新的批次向前**找该文件的第一个版本（各批次按时间从新到旧，每个文件取第一次出现的那份；人话版 `.txt` 同理）。恢复原始格式（鱼话版）时，把找到的 `session.jsonl(.zstd)` 放回 `~/.dsh/sessions/<对应目录>/` 即可被 DSH 重新读取。

## 架构

```
src/index.js       服务端：提醒定时器（热重排）+ 运行时设置 + 增量备份引擎 + 同源 HTTP 路由（cordis 插件）
client/client.js   客户端：开屏弹窗与提醒弹窗（同一面板）、间隔滑杆/预设、文件夹输入、备份结果（零依赖原生 DOM）
cordis.patch.yml   bundle 补丁：向 profile 注册 log-memory 插件行
```

- 服务端通过 `ctx.effect` 管理定时器生命周期，通过 `ctx.inject(["webServer"])` 注册路由；
- 客户端经 `dsh.client.inject`（`@deepseek-ai/dsh-client-runtime`）注入 Web UI，每 15 秒轮询一次状态；
- 运行时设置与备份索引持久化于 `<DSH_HOME>/profiles/<profile>/log-memory.json`。

## 兼容性

- Deepseek Harness EAC 3.0.1（封装版），dsh agent 0.1.0-rc.6（内置），Windows 11 实测通过
- 依赖 Node 内置模块（fs/crypto/os/path），无任何第三方依赖

## 许可证

[MIT](./LICENSE)
