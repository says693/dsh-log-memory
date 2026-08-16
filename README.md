# dsh-session-keeper 🐋

DSH（Deepseek Harness）插件：**定时弹窗提醒保存会话日志**，弹窗上可一键完成增量备份。

> 会话日志是和 AI 助手的所有对话记忆——文件损坏、误删、格式迁移翻车时，一份独立备份就是救命的。本插件每 30 分钟弹窗提醒一次，点一下「立即备份到文件夹」即可把全部会话日志增量复制到指定文件夹。

## 功能

- ⏰ **定时弹窗提醒**：默认每 30 分钟（可配置）在 Web UI 弹出提醒；浏览器已授权通知权限时，同步弹出一条系统级通知
- 💾 **一键增量备份**：把 `~/.dsh/sessions` 下所有 `session.jsonl` / `session.jsonl.zstd` 复制到 `backupDir/<年-月-日_HHmm>/`，完整保留 `<工作目录根>/<会话 id>/` 目录结构
- 🚀 **增量跳过**：按「相对路径 + 大小 + 修改时间」索引未变化的文件，日常增量极小（索引持久化，重启不丢）
- 📅 **今日不再提醒**：按北京时间自然日静音，跨天自动恢复
- 🔒 **安全边界**：HTTP 路由仅接受同源 POST；备份是纯本机文件复制，不联网、不上报任何数据

## 安装

### 方式一：手动安装

1. 把本文件夹复制到 DSH 的 profile 依赖目录：

   ```
   C:\Users\<你>\.dsh\profiles\web\node_modules\dsh-session-keeper\
   ```

2. 编辑 `C:\Users\<你>\.dsh\profiles\web\package.json`：

   在 `dependencies` 中加入：

   ```json
   "dsh-session-keeper": "file:<本文件夹的绝对路径>"
   ```

   在 `dsh.profile.bundles` 数组末尾加入：

   ```json
   "dsh-session-keeper"
   ```

3. 重启 DSH（Deepseek Harness EAC）。

### 方式二：作为本地依赖安装

把本文件夹放到任意固定位置，然后执行方式一的第 2 步（`file:` 依赖指向该位置）并重启。

## 配置（cordis.patch.yml）

| 键 | 默认值 | 说明 |
|---|---|---|
| `intervalMinutes` | `30` | 提醒间隔（分钟），范围 1–1440 |
| `backupDir` | `''` | 备份目标文件夹（绝对路径）；留空使用 `<用户主目录>/dsh-session-backups` |
| `debug` | `false` | `true` 时：启动 20 秒后先弹一次提醒，并开放 `POST /ds-session-keeper/test-remind` 手动触发接口 |

改完配置后需重新复制到 `node_modules` 并重启 DSH 才生效。

## HTTP 路由

| 路由 | 方法 | 说明 |
|---|---|---|
| `/ds-session-keeper/state` | GET | 状态：当前提醒、上次备份结果、下次提醒时间 |
| `/ds-session-keeper/ack` | POST | 关闭当前提醒 |
| `/ds-session-keeper/mute-today` | POST | 今日不再提醒 |
| `/ds-session-keeper/backup` | POST | 立即增量备份 |
| `/ds-session-keeper/test-remind` | POST | 调试：手动触发提醒（仅 `debug: true` 时可用） |

POST 路由均要求同源（校验 `Origin` 与 `Host` 一致）。

## 架构

```
src/index.js       服务端：提醒定时器 + 增量备份引擎 + 同源 HTTP 路由（cordis 插件）
client/client.js   客户端：轮询状态、渲染弹窗、调用备份接口（零依赖原生 DOM）
cordis.patch.yml   bundle 补丁：向 profile 注册 session-keeper 插件行
```

- 服务端通过 `ctx.effect` 管理定时器生命周期，通过 `ctx.inject(["webServer"])` 注册路由；
- 客户端经 `dsh.client.inject`（`@deepseek-ai/dsh-client-runtime`）注入 Web UI，每 15 秒轮询一次状态；
- 备份索引持久化于 `<DSH_HOME>/profiles/<profile>/session-keeper.json`。

## 兼容性

- Deepseek Harness EAC 3.0.1（封装版），dsh agent 0.1.0-rc.6（内置），Windows 11 实测通过
- 依赖 Node 内置模块（fs/crypto/os/path），无任何第三方依赖

## 许可证

[MIT](./LICENSE)
