# dsh-log-memory 🐋

**[简体中文](./README.md) | English**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-4c1)](https://github.com/topics/dsh-plugin)
[![Version](https://img.shields.io/badge/version-1.3.0-green.svg)](./package.json)

A DSH (Deepseek Harness) plugin that **pops up a guardian panel for your session logs the moment you open the Web UI** — back up, tune the reminder interval, and pick your backup folder, all inside the popup.

> Session logs are the entire memory of your conversations with the AI assistant. When a file gets corrupted, deleted by accident, or breaks during a format migration, an independent backup is a lifesaver.

## Features

- 🚪 **Popup on open** — every time you open the DSH Web UI, the guardian panel appears immediately (check "Don't remind me today" to silence it for the rest of the day)
- 💾 **One-click backup in the popup** — "Back up now" incrementally copies every `session.jsonl` / `session.jsonl.zstd` under `~/.dsh/sessions` into your backup folder (unchanged files are skipped via a `path:size:mtime` index; the `<workspace-root>/<session-id>/` structure is preserved; the index persists)
- ⏰ **Reminder interval in the popup** — presets (10 min / 30 min / 1 h / 2 h / 3 h) plus a free slider across **10 minutes – 3 hours**; changes save instantly, the timer reschedules on the fly, and settings survive restarts
- 🎚️ **Two backup formats (toggle freely)**:
  - **🐟 Fish format**: the raw `.zstd` archive — machine format, can be restored
  - **🧑 Human format**: every session rendered into a directly readable `.txt` chat log (title/time/token-usage header + per-turn layout of user messages, assistant reasoning and replies, tool calls and results)
  - Each format keeps its own incremental index; the first backup after switching is a full pass, then it goes incremental again; your choice persists
- 📁 **First-run wizard** — the first popup after installation asks you to confirm/paste a backup folder (absolute path); you can also change it any time later, or pick it interactively via the in-popup **"📁 Browse…"** folder browser (server-side directory listing: go up, click subfolders, or paste a path to jump)
- 📅 **"Don't remind me today"** — muted until the next calendar day (Beijing time), resumes automatically
- 🔒 **Security boundaries** — HTTP routes accept same-origin POST only; backups are pure local file copies; no network access, no telemetry

## Install

### Option 1: dsh CLI (recommended)

```sh
dsh plugin --profile web add github:says693/dsh-log-memory
```

Restart DSH (Deepseek Harness EAC) afterwards. **The first time you open the Web UI, the wizard panel pops up.**

> Run `dsh --profile web --dump-config` to confirm the plugin made it into the final config. To hack on the source, clone the repo and run `dsh plugin --profile web add .` inside it.

### Option 2: Manual copy

1. Copy this folder into your DSH profile's dependency directory:

   ```
   C:\Users\<you>\.dsh\profiles\web\node_modules\dsh-log-memory\
   ```

2. Edit `C:\Users\<you>\.dsh\profiles\web\package.json`:

   add to `dependencies`:

   ```json
   "dsh-log-memory": "file:<absolute path to this folder>"
   ```

   and append `"dsh-log-memory"` to the end of the `dsh.profile.bundles` array.

3. Restart DSH. **The first time you open the Web UI, the wizard panel pops up.**

## Configuration

The interval and backup folder are **primarily configured in the popup** (persisted at `<DSH_HOME>/profiles/<profile>/log-memory.json`). The `cordis.patch.yml` config only provides initial defaults:

| Key | Default | Notes |
|---|---|---|
| `intervalMinutes` | `30` | Initial reminder interval in minutes, clamped to 10–180 |
| `backupDir` | `''` | Initial backup folder (absolute path); empty = `<home>/dsh-log-memory-backups` |
| `backupMode` | `'fish'` | Initial format: `fish` (raw .zstd) / `human` (readable .txt) |
| `debug` | `false` | `true`: fire one reminder 20 s after startup and enable `POST /ds-log-memory/test-remind` |

## HTTP routes

| Route | Method | Description |
|---|---|---|
| `/ds-log-memory/state` | GET | State: settings, first-run flag, interval bounds, current reminder, last backup, next reminder time |
| `/ds-log-memory/settings` | POST | Runtime settings: `{ intervalMinutes?, backupDir?, backupMode? }` (interval clamped to 10–180; folder must be absolute and outside the sessions dir; mode is fish/human) |
| `/ds-log-memory/ack` | POST | Dismiss the current reminder |
| `/ds-log-memory/mute-today` | POST | Mute for today |
| `/ds-log-memory/backup` | POST | Run an incremental backup now |
| `/ds-log-memory/browse` | GET | Directory browse (`?path=` absolute path, returns subdirectories only; empty path = user home) — powers the in-popup "Browse…" button |
| `/ds-log-memory/test-remind` | POST | Debug: manually fire a reminder (`debug: true` only) |

All POST routes require same-origin requests (`Origin` must match `Host`).

## Restoring

Incremental backups scatter "changed files" across timestamped batch folders. To restore a session log, walk the batches **from newest to oldest** and take the first copy of the file you find (each file's first occurrence wins; same for human-format `.txt`). For the fish format, put the recovered `session.jsonl(.zstd)` back under `~/.dsh/sessions/<matching dir>/` and DSH will read it again.

## Architecture

```
src/index.js       Server: reminder timer (hot rescheduling) + runtime settings + incremental backup engine + same-origin HTTP routes (cordis plugin)
client/client.js   Client: on-open/reminder popup (same panel), interval slider/presets, folder input, backup result (zero-dependency vanilla DOM)
cordis.patch.yml   Bundle patch: registers the log-memory plugin row into the profile
```

- The server manages timer lifecycles via `ctx.effect` and registers routes via `ctx.inject(["webServer"])`;
- the client is injected into the Web UI via `dsh.client.inject` (`@deepseek-ai/dsh-client-runtime`) and polls state every 15 s;
- runtime settings and backup indexes persist at `<DSH_HOME>/profiles/<profile>/log-memory.json`.

## Compatibility

- Deepseek Harness EAC 3.0.1 (packaged), dsh agent 0.1.0-rc.6 (bundled), verified on Windows 11
- Node built-ins only (fs/crypto/os/path), zero third-party dependencies

## License

[MIT](./LICENSE)
