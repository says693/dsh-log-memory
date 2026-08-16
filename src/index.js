/**
 * dsh-log-memory — server half.
 *
 * 打开 Web 即弹窗（客户端负责），弹窗内可完成四件事：
 *   ① 是否立即备份；② 设置提醒间隔（10–180 分钟，自由选择，持久化）；
 *   ③ 首次安装时选择/确认备份文件夹（绝对路径，持久化）；
 *   ④ 备份格式二选一（可随时切换，持久化）：
 *      - 鱼话版（fish）：原样增量复制 session.jsonl(.zstd)，机器格式，可用于恢复；
 *      - 人话版（human）：把每个会话渲染成可直接阅读的 .txt 聊天记录
 *        （含标题/时间/token 用量档案头、按轮次排版的用户消息、
 *         助手思考与正文、工具调用与结果）。
 * 两种格式各自维护独立增量索引（fileIndex / textIndex），切换后首次
 * 备份会为当前格式生成全量，之后恢复增量。
 *
 * 约定：
 * - 运行时设置（intervalMinutes / backupDir / backupMode）优先于
 *   cordis.patch.yml 静态 config，存于状态文件，重启不丢；
 * - 路由只接受同源 POST；备份是纯本机文件操作，不联网、不上报；
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
import zlib from "node:zlib";

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

/** zstd 逐帧解压；非 zstd（裸 .jsonl）按 UTF-8 原样返回文本。 */
function decompressToText(buf) {
  if (!(buf.length >= 4 && buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd)) {
    return buf.toString("utf8");
  }
  const cands = [];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) cands.push(i);
  }
  const parts = [];
  let pos = 0;
  let ci = 0;
  while (ci < cands.length) {
    const start = cands[ci];
    if (start < pos) {
      ci += 1;
      continue;
    }
    let matched = false;
    for (let cj = ci + 1; cj < cands.length && !matched; cj++) {
      try {
        parts.push(zlib.zstdDecompressSync(buf.subarray(start, cands[cj])));
        pos = cands[cj];
        ci = cj;
        matched = true;
      } catch {
        /* 尝试下一帧边界 */
      }
    }
    if (!matched) {
      try {
        parts.push(zlib.zstdDecompressSync(buf.subarray(start)));
        pos = buf.length;
      } catch {
        /* 尾帧损坏则丢弃 */
      }
      ci += 1;
    }
  }
  return Buffer.concat(parts).toString("utf8");
}

/** 人话版渲染用的小工具。 */
const pad2 = (n) => String(n).padStart(2, "0");
const clockOf = (ms) => {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const squeeze = (s, n = Infinity) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * 把一个会话日志文件渲染成「人话版」文本。
 * 返回 { text, title, sid }；解析失败时 text 为空串。
 */
function renderTranscript(rawBuf) {
  let events = [];
  try {
    events = decompressToText(rawBuf)
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((o) => o !== null);
  } catch {
    return { text: "", title: "解析失败", sid: "error" };
  }
  const meta = events.find((o) => o.type === "session") ?? {};
  const sid = String(meta.id ?? "session-?").replace("session-", "").slice(0, 8);
  const titles = events
    .filter((o) => o.type === "session/title")
    .map((o) => (o.data !== null && typeof o.data === "object" ? o.data.title : o.data))
    .filter(Boolean);
  const firstUser = events.find((o) => o.type === "user/message");
  let firstUserText = "";
  if (firstUser !== undefined) {
    const d = firstUser.data;
    firstUserText =
      typeof d === "string"
        ? d
        : d?.text ??
          (Array.isArray(d?.content) ? d.content.filter((b) => b.type === "text").map((b) => b.text).join(" ") : "") ??
          "";
  }
  const title = squeeze(titles.at(-1) ?? "", 24) || squeeze(firstUserText, 24) || "空会话";

  const userMsgs = events.filter((o) => o.type === "user/message");
  const asstMsgs = events.filter((o) => o.type === "assistant/message");
  const toolCalls = events.filter((o) => o.type === "tool/call");
  let tokIn = 0;
  let tokOut = 0;
  for (const m of asstMsgs) {
    const u = m.data !== null && typeof m.data === "object" ? m.data.usage ?? {} : {};
    tokIn += u.inputTokens ?? u.input_tokens ?? u.input ?? 0;
    tokOut += u.outputTokens ?? u.output_tokens ?? u.output ?? 0;
  }
  const times = events.map((o) => (typeof o.time === "number" ? o.time : 0)).filter(Boolean);
  const t0 = meta.createdAt ?? times[0] ?? 0;
  const t1 = times.length > 0 ? Math.max(...times) : t0;

  const out = [];
  out.push("═".repeat(56));
  out.push(`会话：${titles.at(-1) ?? title}`);
  out.push(`ID：${meta.id ?? "？"}`);
  out.push(`工作目录：${meta.cwd ?? "？"}`);
  out.push(`时间：${clockOf(t0)} → ${clockOf(t1)}`);
  out.push(
    `规模：${userMsgs.length} 条用户消息 · ${asstMsgs.length} 条回复 · ${toolCalls.length} 次工具调用 · ${events.length} 行事件`,
  );
  if (tokIn > 0 || tokOut > 0) {
    out.push(`用量：输入约 ${(tokIn / 10000).toFixed(1)} 万 · 输出约 ${(tokOut / 10000).toFixed(1)} 万 tokens`);
  }
  out.push("═".repeat(56));
  out.push("");

  let turn = 0;
  for (const o of events) {
    if (o.type === "turn/start") {
      turn = o.data?.turn ?? turn + 1;
      out.push(`───── 第 ${turn} 轮 ─────`);
    } else if (o.type === "user/message") {
      const d = o.data;
      const txt =
        typeof d === "string"
          ? d
          : d?.text ??
            (Array.isArray(d?.content) ? d.content.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "") ??
            "";
      const body = String(txt).trim();
      if (body.startsWith("<")) continue; // 系统注入的上下文快照
      out.push(`🧑 用户 [${clockOf(o.time)}]`);
      out.push(body.replace(/^/gm, "  "));
      out.push("");
    } else if (o.type === "assistant/message") {
      const m = o.data?.message ?? {};
      const model = o.data?.source?.model ?? "";
      out.push(`🐋 ${model || "助手"} [${clockOf(o.time)}]`);
      for (const blk of Array.isArray(m.content) ? m.content : []) {
        if (blk.type === "reasoning" && blk.text) out.push(`  💭 ${squeeze(blk.text, 200)}`);
        if (blk.type === "text" && blk.text) out.push(String(blk.text).replace(/^/gm, "  "));
      }
      out.push("");
    } else if (o.type === "tool/call") {
      const args = JSON.stringify(o.data?.args ?? o.data?.input ?? "");
      out.push(`  🔧 调用 ${o.data?.name ?? o.data?.tool ?? "?"}: ${squeeze(args, 160)}`);
    } else if (o.type === "tool/result") {
      const r = typeof o.data === "string" ? o.data : JSON.stringify(o.data ?? "");
      out.push(`  📤 结果: ${squeeze(r, 200)}`);
    }
  }
  return { text: out.join("\r\n"), title, sid };
}

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
  const cfgBackupMode = config.backupMode === "human" ? "human" : "fish";
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
    lastBackup: null, // { atMs, dest, copied, skipped, bytes, totalFiles, mode }
    mutedDate: null, // "YYYY-MM-DD"（北京时间）
    fileIndex: {}, // 鱼话版增量索引："rel:size:mtimeMs" -> true
    textIndex: {}, // 人话版增量索引："rel:size:mtimeMs" -> true
    lastDestByMode: { fish: null, human: null }, // 每种格式最近一次真正写盘的目录
    settings: {
      intervalMinutes: null, // null = 未设置，回落到 yml config / 30
      backupDir: null, // null = 未设置，回落到 yml config / 用户主目录默认
      backupMode: null, // null = 未设置，回落到 yml config / "fish"
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
            textIndex:
              parsed.textIndex !== null && typeof parsed.textIndex === "object" && !Array.isArray(parsed.textIndex)
                ? parsed.textIndex
                : {},
            lastDestByMode: {
              fish: typeof parsed.lastDestByMode?.fish === "string" ? parsed.lastDestByMode.fish : null,
              human: typeof parsed.lastDestByMode?.human === "string" ? parsed.lastDestByMode.human : null,
            },
            settings: {
              intervalMinutes:
                Number.isFinite(iv) && iv >= INTERVAL_MIN && iv <= INTERVAL_MAX ? Math.floor(iv) : null,
              backupDir: bd,
              backupMode: s.backupMode === "human" || s.backupMode === "fish" ? s.backupMode : null,
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
            textIndex: state.textIndex,
            lastDestByMode: state.lastDestByMode,
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
  const effBackupMode = () =>
    state.settings.backupMode === "human" || state.settings.backupMode === "fish"
      ? state.settings.backupMode
      : cfgBackupMode;
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
    const mode = effBackupMode();
    const files = listArtifacts(sessionsDir).slice().sort((a, b) => a.mtimeMs - b.mtimeMs);
    const destRoot = join(backupDir, stampDirName());
    const index = mode === "human" ? state.textIndex : state.fileIndex;
    let copied = 0;
    let skipped = 0;
    let bytes = 0;
    const seen = new Set();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const key = `${f.rel}:${f.size}:${Math.floor(f.mtimeMs)}`;
      seen.add(key);
      if (index[key] === true) {
        skipped += 1;
        continue;
      }
      if (mode === "fish") {
        const dest = join(destRoot, f.rel.replace(/\//g, sep));
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(f.abs, dest);
        bytes += f.size;
      } else {
        // 人话版：渲染为可直接阅读的 .txt；序号取会话在全量中的位置，跨批次保持稳定。
        let rendered;
        try {
          rendered = renderTranscript(readFileSync(f.abs));
        } catch (error) {
          log("warn", `render failed, fallback raw copy: ${f.rel}: ${error instanceof Error ? error.message : String(error)}`);
          const dest = join(destRoot, f.rel.replace(/\//g, sep));
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(f.abs, dest);
          bytes += f.size;
          copied += 1;
          index[key] = true;
          continue;
        }
        const safeTitle = rendered.title.replace(/[\\/:*?"<>|]/g, "_");
        const dest = join(destRoot, `${pad2(i + 1)}_${safeTitle}_${rendered.sid}.txt`);
        mkdirSync(destRoot, { recursive: true });
        const body = "\uFEFF" + rendered.text + "\r\n";
        writeFileSync(dest, body, "utf8");
        bytes += Buffer.byteLength(body);
      }
      copied += 1;
      index[key] = true;
    }
    // 清理已消失文件的索引项（两种格式一并清理），防止无限增长。
    for (const key of Object.keys(state.fileIndex)) {
      if (!seen.has(key)) delete state.fileIndex[key];
    }
    for (const key of Object.keys(state.textIndex)) {
      if (!seen.has(key)) delete state.textIndex[key];
    }
    if (copied > 0) {
      state.lastDestByMode[mode] = destRoot;
    }
    // 无变化时不新开目录：报告该格式最近一次真正写盘且仍存在的位置，避免指向幽灵目录；
    // 旧状态没有 lastDestByMode 记录时，兜底取备份根下最近一个真实存在的时间戳批次。
    const knownDest = state.lastDestByMode[mode];
    let reportDest;
    if (copied > 0) {
      reportDest = destRoot;
    } else if (typeof knownDest === "string" && existsSync(knownDest)) {
      reportDest = knownDest;
    } else {
      let latest = null;
      try {
        latest =
          readdirSync(backupDir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(e.name))
            .map((e) => join(backupDir, e.name))
            .sort()
            .at(-1) ?? null;
      } catch {
        /* 备份根不存在则保持 destRoot */
      }
      reportDest = latest !== null && existsSync(latest) ? latest : destRoot;
    }
    state.lastBackup = {
      atMs: Date.now(),
      dest: reportDest,
      copied,
      skipped,
      bytes,
      totalFiles: files.length,
      mode,
    };
    persist();
    log("info", `backup(${mode}) done: copied=${copied} skipped=${skipped} bytes=${bytes} -> ${destRoot}`);
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
      backupMode: effBackupMode(),
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

    // 运行时设置：提醒间隔（10–180 分钟）、备份文件夹（绝对路径）、备份格式（fish/human）。
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
      if (body.backupMode !== undefined) {
        if (body.backupMode === "human" || body.backupMode === "fish") {
          state.settings.backupMode = body.backupMode;
        }
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

    // 立即备份（按当前格式：鱼话版 / 人话版）。
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
    `已启动：提醒间隔 ${effInterval()} 分钟（弹窗内可调 ${INTERVAL_MIN}–${INTERVAL_MAX}）；备份目录 ${effBackupDir()}；备份格式 ${effBackupMode() === "human" ? "人话版（可读 .txt）" : "鱼话版（原始 .zstd）"}${backupDisabledFor(effBackupDir()) ? "（配置无效：位于会话目录内）" : ""}`,
  );
}
