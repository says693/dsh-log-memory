/**
 * dsh-log-memory — server half.
 *
 * 打开 Web 即弹窗（客户端负责），弹窗内可完成三件事：
 *   ① 是否立即备份；② 设置提醒间隔（10–180 分钟，自由选择，持久化）；
 *   ③ 首次安装时选择/确认备份文件夹（绝对路径，持久化）。
 * 定期提醒仍按当前有效间隔触发；POST /ds-log-memory/backup 一键把
 * ~/.dsh/sessions 下的会话日志（session.jsonl / .jsonl.zstd）增量复制到
 * backupDir/<时间戳>/，索引持久化在 profile 目录 log-memory.json。
 *
 * 约定：
 * - 运行时设置（settings.intervalMinutes / settings.backupDir）优先于
 *   cordis.patch.yml 里的静态 config，存于状态文件，重启不丢；
 * - 路由只接受同源 POST；备份为纯本机复制，不联网、不上报；
 * - 「今日不再提醒」按北京时间日期判定，跨天自然失效。
 */
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

/** 稳定插件名（profile 组合中的行 id）。 */
export const name = "log-memory";

/** 会话日志文件名（新格式 .jsonl.zstd，旧格式 .jsonl）。 */
const ARTIFACT_RE = /^session\.jsonl(\.zstd)?$/;

/** 提醒间隔范围（分钟）：最短 10，最长 180（3 小时）。 */
const INTERVAL_MIN = 10;
const INTERVAL_MAX = 180;

/** Windows 绝对路径：盘符、UNC 或以 / 开头。 */
const ABSOLUTE_RE = /^([A-Za-z]:[\\/]|\\\\|\/)/;

/** 从运行参数推断 profile 名（与市场插件同一套逻辑）。 */
function argvProfile() {
  const argv = typeof process !== "undefined" ? process.argv : [];
  const flag = argv.indexOf("--profile");
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith("-")) {
    return argv[flag + 1];
  }
  return undefined;
}

/** 北京时间（Asia/Shanghai）的 YYYY-MM-DD。 */
function shanghaiDate(nowMs = Date.now()) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    const d = new Date(nowMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}

/** 本地时间戳目录名：YYYY-MM-DD_HHmm。 */
function stampDirName(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 递归收集会话日志文件：{ abs, rel(posix，相对会话根), size, mtimeMs }。出现异常按部分结果返回。 */
function listArtifacts(rootDir, depth = 0, baseDir = rootDir) {
  const out = [];
  if (depth > 6) return out;
  let entries = [];
  try {
    entries = readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const abs = join(rootDir, ent.name);
    if (ent.isDirectory()) {
      out.push(...listArtifacts(abs, depth + 1, baseDir));
    } else if (ent.isFile() && ARTIFACT_RE.test(ent.name)) {
      try {
        const st = statSync(abs);
        out.push({
          abs,
          rel: relative(baseDir, abs).split(sep).join("/"),
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      } catch {
        /* 文件正被写入时 stat 失败：跳过本轮 */
      }
    }
  }
  return out;
}

const fmtBytes = (n) => {
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export function apply(ctx, config = {}) {
  const profile =
    typeof config.profile === "string" && config.profile !== ""
      ? config.profile
      : argvProfile() ?? "web";

  const cfgIntervalRaw = Number(config.intervalMinutes);
  const cfgInterval =
    Number.isFinite(cfgIntervalRaw) && cfgIntervalRaw >= INTERVAL_MIN && cfgIntervalRaw <= INTERVAL_MAX
      ? Math.floor(cfgIntervalRaw)
      : 30;
  const debug = config.debug === true;

  const home =
    typeof process !== "undefined" && process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ""
      ? process.env.DSH_HOME
      : join(homedir(), ".dsh");
  const sessionsDir =
    typeof config.sessionsDir === "string" && config.sessionsDir !== ""
      ? config.sessionsDir
      : join(home, "sessions");
  const cfgBackupDir =
    typeof config.backupDir === "string" && config.backupDir.trim() !== ""
      ? config.backupDir.trim()
      : null;
  const defaultBackupDir = join(homedir(), "dsh-log-memory-backups");

  const statePath = join(home, "profiles", profile, "log-memory.json");

  const log = (level, msg) => {
    try {
      if (ctx.logger !== undefined && ctx.logger !== null && typeof ctx.logger[level] === "function") {
        ctx.logger[level](`[log-memory] ${msg}`);
      }
    } catch {
      /* 日志失败不影响功能 */
    }
  };

  // ---- 状态（内存 + 持久化） ----
  let state = {
    reminder: null, // { nonce, atMs, intervalMinutes, test? }
    lastBackup: null, // { atMs, dest, copied, skipped, bytes, totalFiles }
    mutedDate: null, // "YYYY-MM-DD"（北京时间）
    fileIndex: {}, // "rel:size:mtimeMs" -> true
    settings: {
      intervalMinutes: null, // null = 未设置，回落到 yml config / 30
      backupDir: null, // null = 未设置，回落到 yml config / 用户主目录默认
      onboarded: false, // 是否已在弹窗里完成过一次设置（首次引导标志）
    },
  };

  const loadState = () => {
    try {
      if (existsSync(statePath)) {
        const parsed = JSON.parse(readFileSync(statePath, "utf8"));
        if (parsed !== null && typeof parsed === "object") {
          const s =
            parsed.settings !== null && typeof parsed.settings === "object" && !Array.isArray(parsed.settings)
              ? parsed.settings
              : {};
          const iv = Number(s.intervalMinutes);
          const bd = typeof s.backupDir === "string" && s.backupDir.trim() !== "" ? s.backupDir.trim() : null;
          state = {
            reminder: null,
            lastBackup:
              parsed.lastBackup !== null && typeof parsed.lastBackup === "object" ? parsed.lastBackup : null,
            mutedDate: typeof parsed.mutedDate === "string" ? parsed.mutedDate : null,
            fileIndex:
              parsed.fileIndex !== null && typeof parsed.fileIndex === "object" && !Array.isArray(parsed.fileIndex)
                ? parsed.fileIndex
                : {},
            settings: {
              intervalMinutes:
                Number.isFinite(iv) && iv >= INTERVAL_MIN && iv <= INTERVAL_MAX ? Math.floor(iv) : null,
              backupDir: bd,
              onboarded: s.onboarded === true,
            },
          };
        }
      }
    } catch (error) {
      log("warn", `state load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const persist = () => {
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(
        statePath,
        JSON.stringify(
          {
            lastBackup: state.lastBackup,
            mutedDate: state.mutedDate,
            fileIndex: state.fileIndex,
            settings: state.settings,
          },
          null,
          2,
        ),
        "utf8",
      );
    } catch (error) {
      log("warn", `state save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // ---- 有效设置（运行时 settings > yml config > 默认） ----
  const effInterval = () => {
    const v = state.settings.intervalMinutes;
    return typeof v === "number" && v >= INTERVAL_MIN && v <= INTERVAL_MAX ? v : cfgInterval;
  };
  const effBackupDir = () =>
    state.settings.backupDir !== null ? state.settings.backupDir : cfgBackupDir !== null ? cfgBackupDir : defaultBackupDir;
  // 路径统一成正斜杠并去尾斜杠再比较：用户输入 H:/x 与 H:\x 视为同一目录。
  const normDir = (d) => String(d).replace(/\\/g, "/").replace(/\/+$/, "");
  const backupDisabledFor = (dir) => {
    const a = normDir(dir);
    const b = normDir(sessionsDir);
    return a === b || a.startsWith(b + "/");
  };

  // ---- 定时提醒（间隔可在运行时调整，热重排） ----
  let remindTimer = null;
  let nextRemindAtMs = null;
  let firstArm = true;
  let fireCount = 0;

  const fireReminder = (test = false) => {
    const today = shanghaiDate();
    if (!test && !debug && state.mutedDate === today) {
      state.reminder = null;
      return;
    }
    fireCount += 1;
    state.reminder = {
      nonce: randomUUID(),
      atMs: Date.now(),
      intervalMinutes: effInterval(),
      test: test === true,
    };
    log("info", `reminder #${fireCount}${test ? " (test)" : ""} ready`);
  };

  const armTimer = () => {
    if (remindTimer !== null) clearTimeout(remindTimer);
    const delay = firstArm && debug ? 20 * 1000 : effInterval() * 60 * 1000;
    firstArm = false;
    nextRemindAtMs = Date.now() + delay;
    remindTimer = setTimeout(() => {
      fireReminder();
      armTimer();
    }, delay);
  };

  loadState();
  ctx.effect(() => {
    armTimer();
    return () => {
      if (remindTimer !== null) clearTimeout(remindTimer);
    };
  }, "log-memory: reminder timer");

  // ---- 备份 ----
  const doBackup = () => {
    const backupDir = effBackupDir();
    if (backupDisabledFor(backupDir)) {
      throw new Error("备份文件夹不能位于会话目录内部");
    }
    const files = listArtifacts(sessionsDir);
    const destRoot = join(backupDir, stampDirName());
    let copied = 0;
    let skipped = 0;
    let bytes = 0;
    const seen = new Set();
    for (const f of files) {
      const key = `${f.rel}:${f.size}:${Math.floor(f.mtimeMs)}`;
      seen.add(key);
      if (state.fileIndex[key] === true) {
        skipped += 1;
        continue;
      }
      const dest = join(destRoot, f.rel.replace(/\//g, sep));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(f.abs, dest);
      copied += 1;
      bytes += f.size;
      state.fileIndex[key] = true;
    }
    // 清理已消失文件的索引项，防止无限增长。
    for (const key of Object.keys(state.fileIndex)) {
      if (!seen.has(key)) delete state.fileIndex[key];
    }
    state.lastBackup = {
      atMs: Date.now(),
      dest: destRoot,
      copied,
      skipped,
      bytes,
      totalFiles: files.length,
    };
    persist();
    log("info", `backup done: copied=${copied} skipped=${skipped} bytes=${bytes} -> ${destRoot}`);
    return state.lastBackup;
  };

  // ---- HTTP 路由 ----
  ctx.inject(["webServer"], (webCtx) => {
    const sameOrigin = (req) => {
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (typeof origin !== "string" || origin === "" || typeof host !== "string" || host === "") return false;
      try {
        return new URL(origin).host === host;
      } catch {
        return false;
      }
    };

    const sendJson = (res, status, value) => {
      const body = JSON.stringify(value);
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
    };

    const readJson = (req) =>
      new Promise((resolvePromise) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
          size += chunk.length;
          if (size > 16 * 1024) {
            req.destroy();
            resolvePromise(null);
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (chunks.length === 0) {
            resolvePromise(null);
            return;
          }
          try {
            resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            resolvePromise(null);
          }
        });
        req.on("error", () => resolvePromise(null));
      });

    const route = (path, handler) => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: "exact",
            path,
            handler,
          }),
        `log-memory: route ${path}`,
      );
    };

    const serializedSettings = () => ({
      intervalMinutes: effInterval(),
      backupDir: effBackupDir(),
      onboarded: state.settings.onboarded === true,
    });

    route("/ds-log-memory/state", (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return;
      }
      const payload = {
        enabled: true,
        debug,
        firstRun: state.settings.onboarded !== true,
        intervalMin: INTERVAL_MIN,
        intervalMax: INTERVAL_MAX,
        settings: serializedSettings(),
        backupDisabled: backupDisabledFor(effBackupDir()),
        reminder: state.reminder,
        lastBackup: state.lastBackup,
        lastBackupBytesLabel: state.lastBackup === null ? null : fmtBytes(state.lastBackup.bytes),
        mutedToday: state.mutedDate === shanghaiDate() && !debug,
        nextRemindAtMs,
        serverTime: Date.now(),
      };
      const body = JSON.stringify(payload);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(req.method === "HEAD" ? undefined : body);
    });

    // 运行时设置：提醒间隔（10–180 分钟）与备份文件夹（绝对路径）。
    route("/ds-log-memory/settings", async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" });
        res.end();
        return;
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { ok: false, error: "untrusted origin" });
        return;
      }
      const body = await readJson(req);
      if (body === null || typeof body !== "object") {
        sendJson(res, 400, { ok: false, error: "bad json" });
        return;
      }
      let intervalChanged = false;
      if (body.intervalMinutes !== undefined) {
        const v = Math.round(Number(body.intervalMinutes));
        if (Number.isFinite(v)) {
          state.settings.intervalMinutes = Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, v));
          intervalChanged = true;
        }
      }
      if (typeof body.backupDir === "string") {
        const dir = body.backupDir.trim();
        if (dir === "") {
          sendJson(res, 400, { ok: false, error: "备份文件夹不能为空" });
          return;
        }
        if (!ABSOLUTE_RE.test(dir)) {
          sendJson(res, 400, { ok: false, error: "备份文件夹需为绝对路径（例如 H:/备份 或 D:\\备份）" });
          return;
        }
        if (backupDisabledFor(dir)) {
          sendJson(res, 400, { ok: false, error: "备份文件夹不能位于会话目录内部" });
          return;
        }
        state.settings.backupDir = dir;
      }
      state.settings.onboarded = true;
      if (intervalChanged) armTimer();
      persist();
      sendJson(res, 200, { ok: true, settings: serializedSettings(), nextRemindAtMs });
    });

    // 关闭当前提醒。
    route("/ds-log-memory/ack", async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" });
        res.end();
        return;
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { ok: false, error: "untrusted origin" });
        return;
      }
      const body = await readJson(req);
      if (body !== null && typeof body.nonce === "string" && state.reminder !== null && body.nonce !== state.reminder.nonce) {
        sendJson(res, 400, { ok: false, error: "nonce mismatch" });
        return;
      }
      state.reminder = null;
      sendJson(res, 200, { ok: true });
    });

    // 今日不再提醒（北京时间自然日）。
    route("/ds-log-memory/mute-today", async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" });
        res.end();
        return;
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { ok: false, error: "untrusted origin" });
        return;
      }
      state.mutedDate = shanghaiDate();
      state.reminder = null;
      persist();
      sendJson(res, 200, { ok: true, mutedDate: state.mutedDate });
    });

    // 立即备份。
    route("/ds-log-memory/backup", async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" });
        res.end();
        return;
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { ok: false, error: "untrusted origin" });
        return;
      }
      try {
        const result = doBackup();
        sendJson(res, 200, { ok: true, backup: result, bytesLabel: fmtBytes(result.bytes) });
      } catch (error) {
        log("warn", `backup failed: ${error instanceof Error ? error.message : String(error)}`);
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    // 调试：手动触发一次提醒（仅 debug 模式）。
    route("/ds-log-memory/test-remind", async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { Allow: "POST" });
        res.end();
        return;
      }
      if (!debug) {
        sendJson(res, 403, { ok: false, error: "debug disabled" });
        return;
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { ok: false, error: "untrusted origin" });
        return;
      }
      fireReminder(true);
      sendJson(res, 200, { ok: true, reminder: state.reminder });
    });
  });

  log(
    "info",
    `已启动：提醒间隔 ${effInterval()} 分钟（弹窗内可调 ${INTERVAL_MIN}–${INTERVAL_MAX}）；备份目录 ${effBackupDir()}${backupDisabledFor(effBackupDir()) ? "（配置无效：位于会话目录内）" : ""}`,
  );
}
