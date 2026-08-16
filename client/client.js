/**
 * dsh-log-memory — browser half（零依赖原生 DOM 客户端模块）。
 *
 * - 打开 Web 即弹窗（未「今日不再提醒」时）：一个面板三件事——
 *   ① 询问是否备份：「立即备份到文件夹」/「本次跳过」；
 *   ② 提醒时间设定：预设档（10 分钟/30 分钟/1 小时/2 小时/3 小时）+
 *      滑杆自由微调（10–180 分钟），改动即保存（POST /settings）并热重排定时器；
 *   ③ 备份文件夹设定：文本框预填当前路径，首次安装（firstRun）高亮引导，
 *      修改后在备份/保存时一并提交；
 * - 定期提醒弹窗与开屏弹窗同款面板；备份成功后展示结果并顺带 ack；
 * - 「今日不再提醒」按北京时间自然日生效（开屏弹窗同样尊重）；
 * - 已授权通知权限时，定期提醒会同步弹一条系统级 Notification
 *   （开屏弹窗不弹系统通知，避免每次刷新都骚扰）。
 */
window.__ModuleLoader__.load({
  id: "dsh-log-memory",
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    //#region styles
    const CSS_ID = "dsh-log-memory/styles.css";
    if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-log-memory";
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = [
        ".dslm_backdrop{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font-family:var(--dsw-alias-font-family,system-ui,sans-serif)}",
        ".dslm_modal{width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 64px);overflow:auto;background:var(--dsw-alias-bg-primary,#202127);color:var(--dsw-alias-label-primary,#e8e8ea);border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.12));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);padding:18px 20px;box-sizing:border-box}",
        ".dslm_head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}",
        ".dslm_title{font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}",
        ".dslm_close{background:none;border:none;color:var(--dsw-alias-label-tertiary,#9a9aa2);font-size:18px;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1}",
        ".dslm_close:hover{background:rgba(255,255,255,.08);color:var(--dsw-alias-label-primary,#e8e8ea)}",
        ".dslm_sub{font-size:12px;color:var(--dsw-alias-label-secondary,#b6b6bd);margin-bottom:12px;line-height:1.7}",
        ".dslm_section{margin-bottom:14px}",
        ".dslm_label{font-size:12.5px;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:6px}",
        ".dslm_label_hint{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,#9a9aa2)}",
        ".dslm_first{font-size:12px;color:var(--dsw-alias-state-warning-primary,#f2b24c);background:rgba(242,178,76,.12);border:1px solid rgba(242,178,76,.3);border-radius:8px;padding:6px 10px;margin-bottom:10px}",
        ".dslm_input{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.14));background:rgba(0,0,0,.25);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12.5px;font-family:inherit}",
        ".dslm_input:focus{outline:none;border-color:var(--dsw-alias-accent-primary,#4c8dff)}",
        ".dslm_folder_row{display:flex;gap:8px}",
        ".dslm_browse_btn{flex:0 0 auto;padding:7px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.14));background:rgba(255,255,255,.06);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12.5px;cursor:pointer;font-family:inherit}",
        ".dslm_browse_btn:hover{background:rgba(255,255,255,.12)}",
        ".dslm_browser{margin-top:8px;border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.12));border-radius:9px;background:rgba(0,0,0,.18);padding:8px 10px}",
        ".dslm_brow_head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}",
        ".dslm_crumb{flex:1;min-width:120px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#9a9aa2);word-break:break-all}",
        ".dslm_mini_btn{padding:3px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.16));background:rgba(255,255,255,.06);color:var(--dsw-alias-label-secondary,#b6b6bd);font-size:11.5px;cursor:pointer;font-family:inherit}",
        ".dslm_mini_btn:hover{background:rgba(255,255,255,.12)}",
        ".dslm_jump{flex:1;min-width:140px;padding:4px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.14));background:rgba(0,0,0,.25);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:11.5px;font-family:inherit}",
        ".dslm_jump:focus{outline:none;border-color:var(--dsw-alias-accent-primary,#4c8dff)}",
        ".dslm_dir_list{max-height:170px;overflow-y:auto;border-top:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.08))}",
        ".dslm_dir_item{display:block;width:100%;text-align:left;padding:4px 8px;border:none;background:none;color:var(--dsw-alias-label-secondary,#b6b6bd);cursor:pointer;border-radius:6px;font-size:12.5px;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".dslm_dir_item:hover{background:rgba(255,255,255,.08);color:var(--dsw-alias-label-primary,#e8e8ea)}",
        ".dslm_brow_foot{display:flex;justify-content:flex-end;margin-top:8px}",
        ".dslm_mode_row{display:flex;gap:10px}",
        ".dslm_mode{flex:1;padding:9px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.16));background:rgba(255,255,255,.05);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:13px;cursor:pointer;font-family:inherit;text-align:center;line-height:1.5}",
        ".dslm_mode:hover{background:rgba(255,255,255,.1)}",
        ".dslm_mode_sub{display:block;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#9a9aa2);margin-top:2px}",
        ".dslm_mode_on{background:var(--dsw-alias-accent-primary,#4c8dff);border-color:transparent;color:#fff;box-shadow:0 2px 8px rgba(76,141,255,.4)}",
        ".dslm_mode_on:hover{background:var(--dsw-alias-accent-hover,#3d7bef)}",
        ".dslm_mode_on .dslm_mode_sub{color:rgba(255,255,255,.85)}",
        ".dslm_info{background:rgba(255,255,255,.05);border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.1));border-radius:8px;padding:8px 10px;font-size:12px;color:var(--dsw-alias-label-secondary,#b6b6bd);margin-bottom:12px;line-height:1.7;word-break:break-all}",
        ".dslm_info b{color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:600}",
        ".dslm_actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
        ".dslm_btn{flex:1;min-width:110px;padding:8px 14px;border-radius:9px;border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.14));background:rgba(255,255,255,.06);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:13px;cursor:pointer;font-family:inherit}",
        ".dslm_btn:hover{background:rgba(255,255,255,.12)}",
        ".dslm_btn_primary{background:var(--dsw-alias-accent-primary,#4c8dff);border-color:transparent;color:#fff}",
        ".dslm_btn_primary:hover{background:var(--dsw-alias-accent-hover,#3d7bef)}",
        ".dslm_btn[disabled]{opacity:.5;cursor:not-allowed}",
        ".dslm_chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}",
        ".dslm_chip{padding:4px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.16));background:rgba(255,255,255,.05);color:var(--dsw-alias-label-secondary,#b6b6bd);font-size:11.5px;cursor:pointer;font-family:inherit}",
        ".dslm_chip:hover{background:rgba(255,255,255,.1)}",
        ".dslm_chip_on{background:var(--dsw-alias-accent-primary,#4c8dff);border-color:transparent;color:#fff;font-weight:600}",
        ".dslm_slider_row{display:flex;align-items:center;gap:10px}",
        ".dslm_slider{flex:1;accent-color:var(--dsw-alias-accent-primary,#4c8dff)}",
        ".dslm_interval_label{font-size:12px;color:var(--dsw-alias-label-secondary,#b6b6bd);min-width:64px;text-align:right}",
        ".dslm_saved{font-size:11px;color:var(--dsw-alias-state-success-primary,#5ec98f);margin-top:4px;min-height:14px}",
        ".dslm_err{font-size:12px;color:var(--dsw-alias-state-danger-primary,#e5484d);background:rgba(229,72,77,.1);border:1px solid rgba(229,72,77,.3);border-radius:8px;padding:6px 10px;margin-top:8px;display:none;word-break:break-all}",
        ".dslm_check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#b6b6bd);cursor:pointer;margin-top:12px;user-select:none}",
        ".dslm_check input{accent-color:var(--dsw-alias-accent-primary,#4c8dff)}",
        ".dslm_result{font-size:13px;line-height:1.8;margin-bottom:10px}",
        ".dslm_ok{color:var(--dsw-alias-state-success-primary,#5ec98f)}",
        ".dslm_err_line{color:var(--dsw-alias-state-danger-primary,#e5484d)}",
        ".dslm_path{display:block;margin-top:6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#9a9aa2);word-break:break-all}"
      ].join("\n");
      document.head.appendChild(tag);
    }
    //#endregion

    //#region state
    const POLL_MS = 15000;
    const PRESETS = [
      { v: 10, label: "10 分钟" },
      { v: 30, label: "30 分钟" },
      { v: 60, label: "1 小时" },
      { v: 120, label: "2 小时" },
      { v: 180, label: "3 小时" },
    ];
    let lastState = null; // 最近一次 /state 响应
    let shownNonce = null; // 已弹过提醒的 nonce
    let modalEl = null; // 当前弹窗根节点（null = 未显示）
    let pollTimer = null;
    //#endregion

    const esc = (s) =>
      String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    const fmtClock = (ms) => {
      if (!Number.isFinite(ms)) return "—";
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, "0");
      return `${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const fmtTime = (ms) => {
      const d = new Date(Number(ms));
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const intervalText = (v) => (v >= 60 ? `${(v / 60).toFixed(v % 60 === 0 ? 0 : 1)} 小时` : `${v} 分钟`);

    async function post(path, body) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body === undefined ? {} : body),
      });
      return res.json();
    }

    async function fetchState() {
      try {
        const res = await fetch("/ds-log-memory/state", { cache: "no-store" });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }

    function notifyOS(title, body) {
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(title, { body });
        }
      } catch {
        /* 通知失败无所谓，页面内弹窗才是主通道 */
      }
    }

    function hideModal() {
      if (modalEl !== null && modalEl.isConnected) modalEl.remove();
      modalEl = null;
    }

    function closeModal(muteChecked) {
      hideModal();
      // 关闭即上报：普通关闭 ack；勾选「今日不再提醒」走 mute-today。
      const nonce = lastState !== null && lastState.reminder !== null && typeof lastState.reminder.nonce === "string"
        ? lastState.reminder.nonce
        : undefined;
      const path = muteChecked ? "/ds-log-memory/mute-today" : "/ds-log-memory/ack";
      void post(path, muteChecked ? {} : { nonce }).catch(() => {});
    }

    //#region modal
    /**
     * 统一面板：reason = "open"（打开 Web 即弹）或 "reminder"（定期提醒）。
     */
    function showModal(state, reason) {
      hideModal();
      lastState = state;
      const s = state.settings;
      const root = document.createElement("div");
      root.className = "dslm_backdrop";

      const modal = document.createElement("div");
      modal.className = "dslm_modal";

      // -- 头部 --
      const head = document.createElement("div");
      head.className = "dslm_head";
      const title = document.createElement("div");
      title.className = "dslm_title";
      title.textContent = reason === "reminder" ? "🐋 该保存会话日志啦" : "🐋 会话日志守护";
      const close = document.createElement("button");
      close.className = "dslm_close";
      close.textContent = "×";
      close.setAttribute("aria-label", "关闭");
      head.appendChild(title);
      head.appendChild(close);

      const sub = document.createElement("div");
      sub.className = "dslm_sub";
      sub.textContent = `每 ${intervalText(s.intervalMinutes)}提醒一次 · 下次提醒 ${fmtClock(state.nextRemindAtMs)} · 鱼的记忆只有七秒，日志可不能只有七秒。`;

      // -- 首次引导提示 --
      let firstTip = null;
      if (state.firstRun === true) {
        firstTip = document.createElement("div");
        firstTip.className = "dslm_first";
        firstTip.textContent = "初次使用：请在下方设置备份文件夹，离开前记得保存。";
      }

      // -- 备份文件夹 --
      const folderSection = document.createElement("div");
      folderSection.className = "dslm_section";
      const folderLabel = document.createElement("div");
      folderLabel.className = "dslm_label";
      folderLabel.textContent = "备份文件夹";
      const folderHint = document.createElement("span");
      folderHint.className = "dslm_label_hint";
      folderHint.textContent = "（绝对路径，关闭弹窗或点立即备份时自动保存）";
      folderLabel.appendChild(folderHint);
      const folderInput = document.createElement("input");
      folderInput.type = "text";
      folderInput.className = "dslm_input";
      folderInput.value = s.backupDir;
      folderInput.spellcheck = false;
      const folderRow = document.createElement("div");
      folderRow.className = "dslm_folder_row";
      const browseBtn = document.createElement("button");
      browseBtn.type = "button";
      browseBtn.className = "dslm_browse_btn";
      browseBtn.textContent = "📁 浏览…";
      folderRow.appendChild(folderInput);
      folderRow.appendChild(browseBtn);
      folderSection.appendChild(folderLabel);
      folderSection.appendChild(folderRow);

      // -- 弹窗内文件夹浏览器（点选代替手填；环境不支持 OS 对话框，用服务端列目录实现） --
      let browserEl = null;
      let curBrowsePath = "";
      const closeBrowser = () => {
        if (browserEl !== null) {
          browserEl.remove();
          browserEl = null;
        }
      };
      const renderBrowse = (j) => {
        if (browserEl === null) return;
        browserEl.innerHTML = "";
        const head = document.createElement("div");
        head.className = "dslm_brow_head";
        if (j.parent !== null) {
          const up = document.createElement("button");
          up.type = "button";
          up.className = "dslm_mini_btn";
          up.textContent = "⬆ 上一级";
          up.addEventListener("click", () => void loadBrowse(j.parent));
          head.appendChild(up);
        }
        const crumb = document.createElement("span");
        crumb.className = "dslm_crumb";
        crumb.textContent = "当前：" + j.path;
        head.appendChild(crumb);
        const jump = document.createElement("input");
        jump.type = "text";
        jump.className = "dslm_jump";
        jump.placeholder = "粘贴路径回车跳转";
        jump.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void loadBrowse(jump.value.trim());
          }
        });
        head.appendChild(jump);
        const list = document.createElement("div");
        list.className = "dslm_dir_list";
        if (j.dirs.length === 0) {
          const empty = document.createElement("div");
          empty.className = "dslm_crumb";
          empty.style.padding = "6px 8px";
          empty.textContent = "（这里没有子文件夹）";
          list.appendChild(empty);
        }
        for (const d of j.dirs) {
          const it = document.createElement("button");
          it.type = "button";
          it.className = "dslm_dir_item";
          it.textContent = "📁 " + d.name;
          it.title = d.path;
          it.addEventListener("click", () => void loadBrowse(d.path));
          list.appendChild(it);
        }
        const foot = document.createElement("div");
        foot.className = "dslm_brow_foot";
        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "dslm_mini_btn";
        pick.style.color = "var(--dsw-alias-state-success-primary,#5ec98f)";
        pick.textContent = "✓ 就用这个文件夹";
        pick.addEventListener("click", () => {
          folderInput.value = curBrowsePath;
          closeBrowser();
          void saveFolderNow(curBrowsePath);
        });
        foot.appendChild(pick);
        browserEl.appendChild(head);
        browserEl.appendChild(list);
        browserEl.appendChild(foot);
      };
      const loadBrowse = async (p) => {
        clearError();
        try {
          const res = await fetch("/ds-log-memory/browse" + (p !== "" ? "?path=" + encodeURIComponent(p) : ""), { cache: "no-store" });
          const j = await res.json();
          if (res.ok !== true || j.ok !== true) {
            showError(j.error ?? "无法读取该路径");
            return;
          }
          curBrowsePath = j.path;
          renderBrowse(j);
        } catch (e) {
          showError(e instanceof Error ? e.message : String(e));
        }
      };
      browseBtn.addEventListener("click", () => {
        if (browserEl !== null) {
          closeBrowser();
          return;
        }
        browserEl = document.createElement("div");
        browserEl.className = "dslm_browser";
        folderSection.appendChild(browserEl);
        const v = folderInput.value.trim();
        void loadBrowse(/^[A-Za-z]:[\\/]|^\\\\|^\//.test(v) ? v : "");
      });

      // -- 备份格式：鱼话版 / 人话版（互斥双钮，按下/抬起，可自由切换） --
      const modeSection = document.createElement("div");
      modeSection.className = "dslm_section";
      const modeLabel = document.createElement("div");
      modeLabel.className = "dslm_label";
      modeLabel.textContent = "备份格式";
      const modeHint = document.createElement("span");
      modeHint.className = "dslm_label_hint";
      modeHint.textContent = "（二选一，点选自由切换）";
      modeLabel.appendChild(modeHint);
      const modeRow = document.createElement("div");
      modeRow.className = "dslm_mode_row";
      const modeButtons = [];
      const makeModeBtn = (mode, main, sub) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dslm_mode" + (s.backupMode === mode ? " dslm_mode_on" : "");
        b.setAttribute("aria-pressed", String(s.backupMode === mode));
        const m = document.createElement("span");
        m.textContent = main;
        const sb = document.createElement("span");
        sb.className = "dslm_mode_sub";
        sb.textContent = sub;
        b.appendChild(m);
        b.appendChild(sb);
        b.addEventListener("click", () => {
          if (lastState !== null && lastState.settings !== undefined && lastState.settings.backupMode === mode) return;
          void saveMode(mode);
        });
        modeButtons.push({ btn: b, mode });
        return b;
      };
      modeRow.appendChild(makeModeBtn("fish", "🐟 鱼话版", "原始压缩 · 可恢复"));
      modeRow.appendChild(makeModeBtn("human", "🧑 人话版", "聊天记录 · 直接可读"));
      modeSection.appendChild(modeLabel);
      modeSection.appendChild(modeRow);

      // -- 上次备份信息 --
      const info = document.createElement("div");
      info.className = "dslm_info";
      if (state.lastBackup !== null && state.lastBackup !== undefined) {
        info.innerHTML =
          `上次备份：<b>${esc(fmtTime(state.lastBackup.atMs))}</b>（复制 ${esc(String(state.lastBackup.copied))} 个，共 ${esc(state.lastBackupBytesLabel ?? "")}）`;
      } else {
        info.textContent = "还没有备份过。";
      }

      // -- 是否备份 --
      const backupSection = document.createElement("div");
      backupSection.className = "dslm_section";
      const backupLabel = document.createElement("div");
      backupLabel.className = "dslm_label";
      backupLabel.textContent = "现在要备份吗？";
      const backupActions = document.createElement("div");
      backupActions.className = "dslm_actions";
      const backupBtn = document.createElement("button");
      backupBtn.className = "dslm_btn dslm_btn_primary";
      backupBtn.textContent = "立即备份到文件夹";
      backupBtn.disabled = state.backupDisabled === true;
      const skipBtn = document.createElement("button");
      skipBtn.className = "dslm_btn";
      skipBtn.textContent = "本次跳过";
      backupActions.appendChild(backupBtn);
      backupActions.appendChild(skipBtn);
      backupSection.appendChild(backupLabel);
      backupSection.appendChild(backupActions);

      // -- 提醒间隔设定 --
      const intervalSection = document.createElement("div");
      intervalSection.className = "dslm_section";
      const intervalLabel = document.createElement("div");
      intervalLabel.className = "dslm_label";
      intervalLabel.textContent = "提醒时间设定";
      const rangeHint = document.createElement("span");
      rangeHint.className = "dslm_label_hint";
      rangeHint.textContent = "（最短 10 分钟，最长 3 小时）";
      intervalLabel.appendChild(rangeHint);

      const chips = document.createElement("div");
      chips.className = "dslm_chips";
      const chipBtns = [];
      for (const p of PRESETS) {
        const c = document.createElement("button");
        c.className = "dslm_chip" + (s.intervalMinutes === p.v ? " dslm_chip_on" : "");
        c.textContent = p.label;
        c.addEventListener("click", () => {
          slider.value = String(p.v);
          void saveInterval(p.v);
        });
        chipBtns.push({ btn: c, v: p.v });
        chips.appendChild(c);
      }

      const sliderRow = document.createElement("div");
      sliderRow.className = "dslm_slider_row";
      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "dslm_slider";
      slider.min = String(state.intervalMin ?? 10);
      slider.max = String(state.intervalMax ?? 180);
      slider.step = "1";
      slider.value = String(s.intervalMinutes);
      const sliderLabel = document.createElement("div");
      sliderLabel.className = "dslm_interval_label";
      sliderLabel.textContent = intervalText(s.intervalMinutes);
      slider.addEventListener("input", () => {
        sliderLabel.textContent = intervalText(Number(slider.value));
      });
      slider.addEventListener("change", () => {
        void saveInterval(Number(slider.value));
      });
      sliderRow.appendChild(slider);
      sliderRow.appendChild(sliderLabel);

      const savedTip = document.createElement("div");
      savedTip.className = "dslm_saved";

      intervalSection.appendChild(intervalLabel);
      intervalSection.appendChild(chips);
      intervalSection.appendChild(sliderRow);
      intervalSection.appendChild(savedTip);

      // -- 错误行 --
      const errBox = document.createElement("div");
      errBox.className = "dslm_err";
      const showError = (msg) => {
        errBox.style.display = "block";
        errBox.textContent = msg;
      };
      const clearError = () => {
        errBox.style.display = "none";
      };

      // -- 今日不再提醒 --
      const check = document.createElement("label");
      check.className = "dslm_check";
      const checkInput = document.createElement("input");
      checkInput.type = "checkbox";
      const checkText = document.createElement("span");
      checkText.textContent = "今日不再提醒（含开屏弹窗）";
      check.appendChild(checkInput);
      check.appendChild(checkText);

      // -- 保存间隔设置 --
      async function saveInterval(v) {
        clearError();
        for (const { btn, v: pv } of chipBtns) btn.classList.toggle("dslm_chip_on", pv === v);
        sliderLabel.textContent = intervalText(v);
        try {
          const res = await post("/ds-log-memory/settings", { intervalMinutes: v });
          if (res !== null && typeof res === "object" && res.ok === true) {
            lastState = { ...lastState, settings: res.settings, nextRemindAtMs: res.nextRemindAtMs };
            sub.textContent = `每 ${intervalText(res.settings.intervalMinutes)}提醒一次 · 下次提醒 ${fmtClock(res.nextRemindAtMs)} · 鱼的记忆只有七秒，日志可不能只有七秒。`;
            savedTip.textContent = `已保存：每 ${intervalText(res.settings.intervalMinutes)}提醒一次（下次 ${fmtClock(res.nextRemindAtMs)}）`;
          } else {
            showError(res !== null && typeof res === "object" && typeof res.error === "string" ? res.error : "保存失败");
          }
        } catch (e) {
          showError(e instanceof Error ? e.message : String(e));
        }
      }

      // -- 立即保存备份文件夹（浏览面板「就用这个文件夹」用） --
      async function saveFolderNow(dir) {
        clearError();
        try {
          const res = await post("/ds-log-memory/settings", { backupDir: dir });
          if (res !== null && typeof res === "object" && res.ok === true) {
            lastState = { ...lastState, settings: res.settings };
            savedTip.textContent = `备份文件夹已更新：${res.settings.backupDir}`;
          } else {
            showError(res !== null && typeof res === "object" && typeof res.error === "string" ? res.error : "文件夹保存失败");
          }
        } catch (e) {
          showError(e instanceof Error ? e.message : String(e));
        }
      }

      // -- 备份格式切换 --
      async function saveMode(mode) {
        clearError();
        try {
          const res = await post("/ds-log-memory/settings", { backupMode: mode });
          if (res !== null && typeof res === "object" && res.ok === true) {
            lastState = { ...lastState, settings: res.settings };
            for (const { btn, mode: m } of modeButtons) {
              const on = res.settings.backupMode === m;
              btn.classList.toggle("dslm_mode_on", on);
              btn.setAttribute("aria-pressed", String(on));
            }
            savedTip.textContent = `备份格式已切换：${res.settings.backupMode === "human" ? "人话版（可读 .txt）" : "鱼话版（原始 .zstd）"}，下次备份生效`;
          } else {
            showError(res !== null && typeof res === "object" && typeof res.error === "string" ? res.error : "切换失败");
          }
        } catch (e) {
          showError(e instanceof Error ? e.message : String(e));
        }
      }

      // -- 备份执行 --
      const runBackup = async () => {
        clearError();
        backupBtn.disabled = true;
        skipBtn.disabled = true;
        try {
          // 文件夹若有改动，先保存再备份
          const dir = folderInput.value.trim();
          if (dir !== s.backupDir) {
            const sres = await post("/ds-log-memory/settings", { backupDir: dir });
            if (sres === null || typeof sres !== "object" || sres.ok !== true) {
              backupBtn.disabled = false;
              skipBtn.disabled = false;
              showError(sres !== null && typeof sres === "object" && typeof sres.error === "string" ? sres.error : "备份文件夹保存失败");
              return;
            }
            lastState = { ...lastState, settings: sres.settings };
          }
          const res = await post("/ds-log-memory/backup", {});
          if (res !== null && typeof res === "object" && res.ok === true) {
            showBackupResult(res.backup, res.bytesLabel);
            // 备份已按提醒完成：顺带关闭服务端待展示提醒，避免刷新后重复弹出。
            const nonce = state.reminder !== null && typeof state.reminder.nonce === "string" ? state.reminder.nonce : undefined;
            void post("/ds-log-memory/ack", { nonce }).catch(() => {});
            notifyOS("会话日志已备份", `已复制 ${res.backup.copied} 个文件（${res.bytesLabel}）`);
          } else {
            backupBtn.disabled = false;
            skipBtn.disabled = false;
            showError(res !== null && typeof res === "object" && typeof res.error === "string" ? res.error : "备份失败：未知错误");
          }
        } catch (e) {
          backupBtn.disabled = false;
          skipBtn.disabled = false;
          showError(e instanceof Error ? e.message : String(e));
        }
      };

      function showBackupResult(backup, bytesLabel) {
        modal.innerHTML = "";
        const result = document.createElement("div");
        result.className = "dslm_result";
        const line = document.createElement("div");
        line.className = "dslm_ok";
        line.textContent =
          backup.copied > 0
            ? `✅ 已复制 ${backup.copied} 个文件（增量跳过 ${backup.skipped} 个），共 ${bytesLabel}`
            : `✅ 所有会话日志都已是最新（共 ${backup.totalFiles} 个文件，无变化）`;
        result.appendChild(line);
        const path = document.createElement("span");
        path.className = "dslm_path";
        path.textContent = `${backup.copied > 0 ? "备份位置" : "最新备份位置（本次无变化）"}：${backup.dest}`;
        result.appendChild(path);
        const actions = document.createElement("div");
        actions.className = "dslm_actions";
        const okBtn = document.createElement("button");
        okBtn.className = "dslm_btn dslm_btn_primary";
        okBtn.textContent = "好的";
        okBtn.addEventListener("click", () => hideModal());
        actions.appendChild(okBtn);
        modal.appendChild(result);
        modal.appendChild(actions);
      }

      backupBtn.addEventListener("click", () => void runBackup());
      // 关闭前保存未提交的文件夹改动（空值不提交，合法性校验交给服务端）。
      const closeAndSaveFolder = (muteChecked) => {
        const dir = folderInput.value.trim();
        if (dir !== "" && lastState !== null && lastState.settings !== undefined && dir !== lastState.settings.backupDir) {
          void post("/ds-log-memory/settings", { backupDir: dir })
            .then((res) => {
              if (res !== null && typeof res === "object" && res.ok === true) {
                lastState = { ...lastState, settings: res.settings };
              }
            })
            .catch(() => {});
        }
        closeModal(muteChecked);
      };
      skipBtn.addEventListener("click", () => closeAndSaveFolder(checkInput.checked));
      close.addEventListener("click", () => closeAndSaveFolder(checkInput.checked));
      // 注意：不响应「点击遮罩关闭」——全屏遮罩下误触率太高（弹窗会一
      // 直挡着界面直到明确选择 × / 本次跳过 / 好的，避免误关后干等下个周期）。

      modal.appendChild(head);
      modal.appendChild(sub);
      if (firstTip !== null) modal.appendChild(firstTip);
      modal.appendChild(folderSection);
      modal.appendChild(modeSection);
      modal.appendChild(info);
      modal.appendChild(backupSection);
      modal.appendChild(intervalSection);
      modal.appendChild(errBox);
      modal.appendChild(check);
      root.appendChild(modal);
      document.body.appendChild(root);
      modalEl = root;

      if (reason === "reminder") {
        notifyOS("该保存会话日志啦", "点击 DSH 窗口中的「立即备份到文件夹」完成保存");
      }
    }
    //#endregion

    function maybeShowReminder(state) {
      if (state === null) return;
      lastState = state;
      if (state.reminder === null || typeof state.reminder !== "object") return;
      if (typeof state.reminder.nonce !== "string") return;
      if (state.reminder.nonce === shownNonce) return;
      shownNonce = state.reminder.nonce;
      // 弹窗已打开时吸收该提醒（用户正在面板里操作），不重复弹。
      if (modalEl !== null && modalEl.isConnected) return;
      showModal(state, "reminder");
    }

    //#region plugin
    function apply(ctx) {
      let disposed = false;
      const refresh = () => {
        if (disposed) return;
        void fetchState().then((state) => {
          if (disposed || state === null) return;
          maybeShowReminder(state);
        });
      };
      // 打开 Web 即弹窗：首次拉取状态后立即显示（尊重「今日不再提醒」）。
      void fetchState().then((state) => {
        if (disposed || state === null) return;
        lastState = state;
        if (state.mutedToday !== true && (modalEl === null || !modalEl.isConnected)) {
          showModal(state, "open");
        }
      });
      ctx.effect(() => {
        pollTimer = setInterval(refresh, POLL_MS);
        refresh();
        return () => {
          disposed = true;
          if (pollTimer !== null) clearInterval(pollTimer);
          hideModal();
        };
      }, "dsh-log-memory: poll");
    }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  }
});
