/**
 * dsh-log-memory — browser half（零依赖原生 DOM 客户端模块）。
 *
 * - 每 15 秒轮询 GET /ds-log-memory/state；出现新提醒（nonce 未见过）时弹窗：
 *   「🐋 该保存会话日志啦」+ 上次备份信息；
 *   「立即备份到文件夹」→ POST /backup，成功后展示结果（复制/跳过文件数、体积、路径）；
 *   「知道了」→ POST /ack 关闭；勾选「今日不再提醒」后改走 POST /mute-today；
 * - 已授权通知权限时同时弹一条系统级 Notification（不主动请求权限，避免骚扰）；
 * - 弹窗风格沿用 DSW 主题变量，退化为深色默认值。
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
        ".dslm_modal{width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 64px);overflow:auto;background:var(--dsw-alias-bg-primary,#202127);color:var(--dsw-alias-label-primary,#e8e8ea);border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.12));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);padding:18px 20px;box-sizing:border-box}",
        ".dslm_head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}",
        ".dslm_title{font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}",
        ".dslm_close{background:none;border:none;color:var(--dsw-alias-label-tertiary,#9a9aa2);font-size:18px;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1}",
        ".dslm_close:hover{background:rgba(255,255,255,.08);color:var(--dsw-alias-label-primary,#e8e8ea)}",
        ".dslm_sub{font-size:12.5px;color:var(--dsw-alias-label-secondary,#b6b6bd);margin-bottom:12px;line-height:1.7}",
        ".dslm_info{background:rgba(255,255,255,.05);border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.1));border-radius:8px;padding:8px 10px;font-size:12px;color:var(--dsw-alias-label-secondary,#b6b6bd);margin-bottom:12px;line-height:1.7;word-break:break-all}",
        ".dslm_info b{color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:600}",
        ".dslm_actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
        ".dslm_btn{flex:1;min-width:120px;padding:8px 14px;border-radius:9px;border:1px solid var(--dsw-alias-border-primary,rgba(255,255,255,.14));background:rgba(255,255,255,.06);color:var(--dsw-alias-label-primary,#e8e8ea);font-size:13px;cursor:pointer;font-family:inherit}",
        ".dslm_btn:hover{background:rgba(255,255,255,.12)}",
        ".dslm_btn_primary{background:var(--dsw-alias-accent-primary,#4c8dff);border-color:transparent;color:#fff}",
        ".dslm_btn_primary:hover{background:var(--dsw-alias-accent-hover,#3d7bef)}",
        ".dslm_btn[disabled]{opacity:.5;cursor:not-allowed}",
        ".dslm_check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#b6b6bd);cursor:pointer;margin-top:12px;user-select:none}",
        ".dslm_check input{accent-color:var(--dsw-alias-accent-primary,#4c8dff)}",
        ".dslm_result{font-size:13px;line-height:1.8;margin-bottom:10px}",
        ".dslm_ok{color:var(--dsw-alias-state-success-primary,#5ec98f)}",
        ".dslm_err{color:var(--dsw-alias-state-danger-primary,#e5484d)}",
        ".dslm_path{display:block;margin-top:6px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#9a9aa2);word-break:break-all}"
      ].join("\n");
      document.head.appendChild(tag);
    }
    //#endregion

    //#region state
    const POLL_MS = 15000;
    let shownNonce = null; // 已弹过提醒的 nonce
    let modalEl = null; // 当前弹窗根节点（null = 未显示）
    let pollTimer = null;
    //#endregion

    const esc = (s) =>
      String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    const fmtTime = (ms) => {
      const d = new Date(Number(ms));
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };

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

    //#region modal
    function hideModal() {
      if (modalEl !== null && modalEl.isConnected) modalEl.remove();
      modalEl = null;
    }

    function closeModal(state, muteChecked) {
      hideModal();
      // 关闭即上报：普通关闭 ack；勾选「今日不再提醒」走 mute-today。
      const path = muteChecked ? "/ds-log-memory/mute-today" : "/ds-log-memory/ack";
      void post(path, muteChecked ? {} : { nonce: state !== null && state.reminder !== null ? state.reminder.nonce : undefined }).catch(() => {});
    }

    function notifyOS(title, body) {
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(title, { body, silent: false });
        }
      } catch {
        /* 通知失败无所谓，页面内弹窗才是主通道 */
      }
    }

    function showBackupResult(container, backup, bytesLabel) {
      container.innerHTML = "";
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
      path.textContent = `备份位置：${backup.dest}`;
      result.appendChild(path);
      container.appendChild(result);
      const actions = document.createElement("div");
      actions.className = "dslm_actions";
      const okBtn = document.createElement("button");
      okBtn.className = "dslm_btn dslm_btn_primary";
      okBtn.textContent = "好的";
      okBtn.addEventListener("click", () => hideModal());
      actions.appendChild(okBtn);
      container.appendChild(actions);
    }

    function showBackupError(container, message, retryFn) {
      container.innerHTML = "";
      const result = document.createElement("div");
      result.className = "dslm_result";
      const line = document.createElement("div");
      line.className = "dslm_err";
      line.textContent = `❌ 备份失败：${message}`;
      result.appendChild(line);
      container.appendChild(result);
      const actions = document.createElement("div");
      actions.className = "dslm_actions";
      const retryBtn = document.createElement("button");
      retryBtn.className = "dslm_btn dslm_btn_primary";
      retryBtn.textContent = "重试";
      retryBtn.addEventListener("click", retryFn);
      const closeBtn = document.createElement("button");
      closeBtn.className = "dslm_btn";
      closeBtn.textContent = "关闭";
      closeBtn.addEventListener("click", () => hideModal());
      actions.appendChild(retryBtn);
      actions.appendChild(closeBtn);
      container.appendChild(actions);
    }

    function showModal(state) {
      hideModal();
      const reminder = state.reminder;
      const root = document.createElement("div");
      root.className = "dslm_backdrop";

      const modal = document.createElement("div");
      modal.className = "dslm_modal";

      const head = document.createElement("div");
      head.className = "dslm_head";
      const title = document.createElement("div");
      title.className = "dslm_title";
      title.textContent = `🐋 ${reminder.test === true ? "（测试）" : ""}该保存会话日志啦`;
      const close = document.createElement("button");
      close.className = "dslm_close";
      close.textContent = "×";
      close.setAttribute("aria-label", "关闭");
      head.appendChild(title);
      head.appendChild(close);

      const sub = document.createElement("div");
      sub.className = "dslm_sub";
      sub.textContent = `每 ${reminder.intervalMinutes} 分钟提醒一次：把会话日志妥善存进备份文件夹，鱼的记忆只有七秒，日志可不能只有七秒。`;

      const info = document.createElement("div");
      info.className = "dslm_info";
      if (state.lastBackup !== null && state.lastBackup !== undefined) {
        info.innerHTML =
          `上次备份：<b>${esc(fmtTime(state.lastBackup.atMs))}</b>（复制 ${esc(String(state.lastBackup.copied))} 个，共 ${esc(state.lastBackupBytesLabel ?? "")}）<br>` +
          `目标文件夹：<b>${esc(state.backupDir)}</b>`;
      } else {
        info.innerHTML = `还没有备份过。目标文件夹：<b>${esc(state.backupDir)}</b>`;
      }

      const body = document.createElement("div"); // 备份结果替换区
      const actions = document.createElement("div");
      actions.className = "dslm_actions";

      const runBackup = () => {
        for (const btn of actions.querySelectorAll("button")) btn.disabled = true;
        void post("/ds-log-memory/backup", {})
          .then((res) => {
            if (res !== null && typeof res === "object" && res.ok === true) {
              showBackupResult(body, res.backup, res.bytesLabel);
              actions.remove();
              // 备份已按提醒完成：顺带关闭服务端待展示提醒，避免刷新页面后同一条提醒再次弹出。
              void post("/ds-log-memory/ack", { nonce: reminder.nonce }).catch(() => {});
              notifyOS("会话日志已备份", `已复制 ${res.backup.copied} 个文件（${res.bytesLabel}）`);
            } else {
              showBackupError(body, res !== null && typeof res === "object" && typeof res.error === "string" ? res.error : "未知错误", () => {
                actions.remove();
                showModal(state); // 重新渲染初始弹窗再试
              });
            }
          })
          .catch((error) => {
            showBackupError(body, error instanceof Error ? error.message : String(error), () => {
              actions.remove();
              showModal(state);
            });
          });
      };

      const backupBtn = document.createElement("button");
      backupBtn.className = "dslm_btn dslm_btn_primary";
      backupBtn.textContent = "立即备份到文件夹";
      backupBtn.disabled = state.backupDisabled === true;
      backupBtn.addEventListener("click", runBackup);
      const ackBtn = document.createElement("button");
      ackBtn.className = "dslm_btn";
      ackBtn.textContent = "知道了";
      actions.appendChild(backupBtn);
      actions.appendChild(ackBtn);

      const check = document.createElement("label");
      check.className = "dslm_check";
      const checkInput = document.createElement("input");
      checkInput.type = "checkbox";
      const checkText = document.createElement("span");
      checkText.textContent = "今日不再提醒";
      check.appendChild(checkInput);
      check.appendChild(checkText);

      modal.appendChild(head);
      modal.appendChild(sub);
      modal.appendChild(info);
      modal.appendChild(body);
      modal.appendChild(actions);
      modal.appendChild(check);
      root.appendChild(modal);
      root.addEventListener("click", (e) => {
        if (e.target === root) closeModal(state, checkInput.checked);
      });
      close.addEventListener("click", () => closeModal(state, checkInput.checked));
      ackBtn.addEventListener("click", () => closeModal(state, checkInput.checked));
      document.body.appendChild(root);
      modalEl = root;

      notifyOS("该保存会话日志啦", "点击 DSH 窗口中的「立即备份到文件夹」完成保存");
    }
    //#endregion

    function maybeShowReminder(state) {
      if (state === null || state.reminder === null || typeof state.reminder !== "object") return;
      if (typeof state.reminder.nonce !== "string") return;
      if (state.reminder.nonce === shownNonce) return;
      shownNonce = state.reminder.nonce;
      showModal(state);
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
