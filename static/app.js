// Herdr Mobile Client Application

(function () {
  let state = {
    agents: [],
    activePaneId: null,
    historyText: "",
    linesCount: 100,
    showStatusBar: false,
    isUserScrolledUp: false,
    pollInterval: 2000,
    timer: null,
    isSending: false,
  };

  // DOM Elements
  const elConn = document.getElementById("conn-indicator");
  const elBtnRefresh = document.getElementById("btn-refresh");
  const elAgentSelect = document.getElementById("agent-select");
  const elAgentSelectDot = document.getElementById("agent-select-dot");
  const elAgentSelectName = document.getElementById("agent-select-name");
  const elAgentPicker = document.getElementById("agent-picker");
  const elAgentList = document.getElementById("agent-list");
  const elBtnClosePicker = document.getElementById("btn-close-picker");
  const elAgentTitle = document.getElementById("agent-title-text");
  const elAgentCwd = document.getElementById("agent-cwd-text");
  const elAgentStatus = document.getElementById("agent-status-badge");
  const elHistoryContainer = document.getElementById("history-container");
  const elHistoryContent = document.getElementById("history-content");
  const elBtnScrollBottom = document.getElementById("btn-scroll-bottom");
  const elPromptForm = document.getElementById("prompt-form");
  const elPromptInput = document.getElementById("prompt-input");
  const elBtnSend = document.getElementById("btn-send");
  const elBtnCtrlC = document.getElementById("btn-ctrl-c");
  const elBtnEsc = document.getElementById("btn-esc");
  const elBtnCopy = document.getElementById("btn-copy");
  const elLinesSelect = document.getElementById("lines-select");
  const elBtnSettings = document.getElementById("btn-settings");
  const elBtnCloseSheet = document.getElementById("btn-close-sheet");
  const elSheet = document.getElementById("settings-sheet");
  const elSheetBackdrop = document.getElementById("sheet-backdrop");
  const elToggleStatusBar = document.getElementById("toggle-statusbar");

  // Haptic feedback helper
  function triggerHaptic(type = "light") {
    if (navigator.vibrate) {
      if (type === "warning") navigator.vibrate([30, 50, 30]);
      else navigator.vibrate(12);
    }
  }

  // Set Connection Status
  function setConnected(connected) {
    elConn.classList.toggle("connected", connected);
    elConn.classList.toggle("disconnected", !connected);
  }

  /* ---------------------------------------------------------------------
   * Transcript parsing
   *
   * The pane text is a stripped terminal dump padded to the desktop's
   * terminal width, so it carries artefacts that read badly on a phone:
   * full-width horizontal rules around the input box (which wrap into
   * several lines of dashes) and status-bar lines padded with long runs of
   * spaces. Classify each line by its leading marker so it can be coloured,
   * and turn the noise into structure rather than text.
   * ------------------------------------------------------------------- */

  const RE_RULE_GLYPH = /[─━┄┅┈┉═—–_=]/g;
  const MARKERS = [
    { re: /^❯/, cls: "user" },        // > user message / live input
    { re: /^⏺/, cls: "assistant" },   // assistant message or tool call
    { re: /^⎿/, cls: "tool" },        // tool result
    { re: /^[✻✽✳]/, cls: "meta" }, // "Worked for 1m 8s"
    { re: /^※/, cls: "tip" },         // tips
    { re: /^⏵⏵/, cls: "status" }, // "auto mode on ..."
  ];
  const RE_BOX = /^[┌┐└┘├┤┬┴┼│╭╮╯╰┏┓┗┛┣┫┳┻╋┃║╔╗╚╝╠╣╦╩╬]/;
  // Long runs of rule glyphs anywhere in a line, not just whole-line rules.
  const RE_INLINE_RULE = /([─━┄┅┈┉═—–_=*.])\1{7,}/g;

  /* Is this line one of the terminal's horizontal rules? Returns null if not,
     otherwise the caption embedded in it - the input box's top border carries
     the session title ("──────… Get this to work in herdr ─"), which is worth
     keeping as a heading rather than 200 wrapped dashes. */
  function ruleLabel(trimmed) {
    const glyphs = (trimmed.match(RE_RULE_GLYPH) || []).length;
    if (glyphs < 8) return null;
    const label = trimmed.replace(RE_RULE_GLYPH, " ").trim();
    if (!label) return "";
    // A caption has to contain words; leftover frame glyphs are not one.
    if (!/[\p{L}\p{N}]/u.test(label)) return "";
    if (glyphs >= 16 && label.length <= 60) return label;
    return null; // prose that merely contains a long run of glyphs
  }

  function classifyLine(trimmed) {
    if (!trimmed) return null;
    if (RE_BOX.test(trimmed)) return "table";
    if (ruleLabel(trimmed) !== null) return "rule";
    for (const m of MARKERS) {
      if (m.re.test(trimmed)) return m.cls;
    }
    return null; // continuation of whatever came before
  }

  function parseTranscript(text) {
    const raw = text.split("\n").map((l) => l.replace(/\s+$/, ""));

    // Everything after the final rule is the agent's own status bar.
    let lastRule = -1;
    raw.forEach((l, i) => {
      if (ruleLabel(l.trim()) !== null) lastRule = i;
    });

    const blocks = [];
    let current = "assistant";
    raw.forEach((line, i) => {
      const trimmed = line.trim();
      let cls = classifyLine(trimmed);

      if (lastRule >= 0 && i > lastRule && cls !== "rule") cls = "status";

      if (cls === "rule") {
        const label = ruleLabel(trimmed);
        const prev = blocks[blocks.length - 1];
        // Collapse runs of rules, but let a captioned one win.
        if (prev && prev.cls === "rule") {
          if (label) prev.label = label;
          return;
        }
        blocks.push({ cls: "rule", label, lines: [] });
        return;
      }

      if (cls === null) {
        cls = current; // continuation line inherits the active block
      } else {
        current = cls;
      }

      const last = blocks[blocks.length - 1];
      if (last && last.cls === cls) last.lines.push(line);
      else blocks.push({ cls, lines: [line] });
    });

    // Drop leading/trailing empties inside each block, then empty blocks.
    return blocks.filter((b) => {
      if (b.cls === "rule") return true;
      while (b.lines.length && !b.lines[0].trim()) b.lines.shift();
      while (b.lines.length && !b.lines[b.lines.length - 1].trim()) b.lines.pop();
      return b.lines.length > 0;
    });
  }

  function renderTranscript(text) {
    if (!text) {
      elHistoryContent.innerHTML =
        '<div class="history-empty">(No output recorded yet)</div>';
      return;
    }

    // Resolve each block to its final text, dropping the ones that render
    // to nothing: an empty input box, or the status bar when hidden.
    const visible = [];
    for (const b of parseTranscript(text)) {
      if (b.cls === "rule") {
        visible.push({ cls: "rule", label: b.label });
        continue;
      }
      if (b.cls === "status" && !state.showStatusBar) continue;

      let body = b.lines.join("\n");
      if (b.cls === "status") {
        // Status lines are padded across the full terminal width.
        body = b.lines
          .map((l) => l.trim().replace(/\s{3,}/g, "  ·  "))
          .filter(Boolean)
          .join("\n");
      }
      // A bare marker is an empty prompt box, not content.
      if (!body.replace(/^[❯⏺⎿✻✽✳※]/, "").trim()) continue;
      // Tables need their padding; everywhere else a long run of rule glyphs
      // is decoration that would wrap across several phone lines.
      if (b.cls !== "table") body = body.replace(RE_INLINE_RULE, "$1$1$1");
      visible.push({ cls: b.cls, body });
    }

    // Separators only mean something between two blocks.
    const trimmed = [];
    for (const b of visible) {
      if (b.cls === "rule" && (!trimmed.length || trimmed[trimmed.length - 1].cls === "rule")) {
        continue;
      }
      trimmed.push(b);
    }
    while (trimmed.length && trimmed[trimmed.length - 1].cls === "rule") trimmed.pop();

    const html = trimmed
      .map((b) => {
        if (b.cls !== "rule") {
          return `<div class="t-block t-${b.cls}">${escapeHtml(b.body)}</div>`;
        }
        return b.label
          ? `<div class="t-rule-label"><span>${escapeHtml(b.label)}</span></div>`
          : '<div class="t-rule"></div>';
      })
      .join("");

    elHistoryContent.innerHTML =
      html || '<div class="history-empty">(No output recorded yet)</div>';
  }

  // Fetch Agent List
  async function fetchAgents() {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("Failed to fetch agents");
      const data = await res.json();
      setConnected(true);

      state.agents = data.agents || [];
      renderAgentBar();

      // If no agent selected or active agent no longer exists, select first available
      if (
        !state.activePaneId ||
        !state.agents.some((a) => a.pane_id === state.activePaneId)
      ) {
        if (state.agents.length > 0) {
          selectAgent(state.agents[0].pane_id);
        } else {
          state.activePaneId = null;
          renderActiveAgentMeta();
          elHistoryContent.innerHTML = '<div class="history-empty">No active agents in Herdr.</div>';
        }
      } else {
        renderActiveAgentMeta();
      }
    } catch (err) {
      console.warn("fetchAgents error:", err);
      setConnected(false);
    }
  }

  // Header button showing the current project
  function renderAgentBar() {
    const agent = state.agents.find((a) => a.pane_id === state.activePaneId);
    elAgentSelectName.textContent = agent
      ? agent.name || agent.pane_id
      : state.agents.length
      ? "Select project"
      : "No agents";
    elAgentSelectDot.className = `agent-dot ${agent ? agent.status || "unknown" : "unknown"}`;

    if (!elAgentPicker.classList.contains("hidden")) renderAgentList();
  }

  // Full-screen project list
  function renderAgentList() {
    if (state.agents.length === 0) {
      elAgentList.innerHTML = '<div class="history-empty">No active agents in Herdr.</div>';
      return;
    }

    elAgentList.innerHTML = state.agents
      .map((agent) => {
        const isActive = agent.pane_id === state.activePaneId;
        const status = agent.status || "unknown";
        return `
          <button class="agent-row ${isActive ? "active" : ""}" data-pane-id="${agent.pane_id}">
            <span class="agent-dot ${status}"></span>
            <span class="agent-row-text">
              <span class="agent-row-name">${escapeHtml(agent.name || agent.pane_id)}</span>
              <span class="agent-row-title">${escapeHtml(agent.title || agent.cwd || "")}</span>
            </span>
            <span class="status-badge status-${status}">${escapeHtml(status)}</span>
          </button>
        `;
      })
      .join("");
  }

  function openPicker() {
    triggerHaptic();
    renderAgentList();
    elAgentPicker.classList.remove("hidden");
  }

  function closePicker() {
    elAgentPicker.classList.add("hidden");
  }

  // Select an Agent
  function selectAgent(paneId) {
    if (state.activePaneId === paneId) {
      closePicker();
      return;
    }
    closePicker();
    state.activePaneId = paneId;
    state.historyText = "";
    elHistoryContent.innerHTML = '<div class="history-empty">Loading…</div>';
    triggerHaptic();

    renderAgentBar();
    renderActiveAgentMeta();
    fetchHistory(true);
  }

  // Render Metadata (lives in the settings sheet)
  function renderActiveAgentMeta() {
    const agent = state.agents.find((a) => a.pane_id === state.activePaneId);
    if (!agent) {
      elAgentTitle.textContent = "No agent selected";
      elAgentCwd.textContent = "";
      elAgentStatus.className = "status-badge status-unknown";
      elAgentStatus.textContent = "--";
      return;
    }

    elAgentTitle.textContent = agent.title || agent.name || agent.pane_id;
    elAgentCwd.textContent = agent.cwd || "";

    const status = agent.status || "unknown";
    elAgentStatus.className = `status-badge status-${status}`;
    elAgentStatus.textContent = status;
  }

  // Fetch Agent History
  async function fetchHistory(forceScroll = false) {
    if (!state.activePaneId) return;

    try {
      const url = `/api/agents/${encodeURIComponent(state.activePaneId)}/history?lines=${state.linesCount}&source=recent_unwrapped`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      setConnected(true);

      const newText = data.text || "";
      if (newText !== state.historyText) {
        state.historyText = newText;
        renderTranscript(newText);

        // Auto-scroll to bottom if user hasn't scrolled up, or if forced
        if (!state.isUserScrolledUp || forceScroll) {
          scrollToBottom();
        }
      }
    } catch (err) {
      console.warn("fetchHistory error:", err);
      setConnected(false);
    }
  }

  // Scroll to Bottom
  function scrollToBottom(smooth = false) {
    if (smooth) {
      elHistoryContainer.scrollTo({
        top: elHistoryContainer.scrollHeight,
        behavior: "smooth",
      });
    } else {
      elHistoryContainer.scrollTop = elHistoryContainer.scrollHeight;
    }
    state.isUserScrolledUp = false;
    updateScrollButton();
  }

  // Check scroll position
  function onHistoryScroll() {
    const threshold = 80;
    const distanceToBottom =
      elHistoryContainer.scrollHeight -
      elHistoryContainer.scrollTop -
      elHistoryContainer.clientHeight;

    state.isUserScrolledUp = distanceToBottom > threshold;
    updateScrollButton();
  }

  function updateScrollButton() {
    elBtnScrollBottom.classList.toggle("hidden", !state.isUserScrolledUp);
  }

  // Settings sheet
  function openSheet() {
    triggerHaptic();
    elSheet.classList.remove("hidden");
    elSheetBackdrop.classList.remove("hidden");
  }

  function closeSheet() {
    elSheet.classList.add("hidden");
    elSheetBackdrop.classList.add("hidden");
  }

  // Send Prompt
  async function submitPrompt(e) {
    if (e) e.preventDefault();
    const text = elPromptInput.value.trim();
    if (!text || !state.activePaneId || state.isSending) return;

    state.isSending = true;
    elBtnSend.disabled = true;
    triggerHaptic();

    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(state.activePaneId)}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const errData = await res.json();
        alert("Prompt failed: " + (errData.error?.message || errData.error || "Unknown error"));
        return;
      }

      // Success
      elPromptInput.value = "";
      autoResizeTextarea();
      elBtnSend.disabled = true;

      state.isUserScrolledUp = false;
      setTimeout(() => {
        fetchAgents();
        fetchHistory(true);
      }, 300);
    } catch (err) {
      alert("Error sending prompt: " + err.message);
    } finally {
      state.isSending = false;
    }
  }

  // Send Key Action
  async function sendKey(key) {
    if (!state.activePaneId) return;
    triggerHaptic("warning");

    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(state.activePaneId)}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });

      if (res.ok) {
        setTimeout(() => fetchHistory(true), 300);
      }
    } catch (err) {
      console.error("Failed to send key:", err);
    }
  }

  // Copy visible history text
  async function copyHistory() {
    if (!state.historyText) return;
    try {
      await navigator.clipboard.writeText(state.historyText);
      triggerHaptic();
      const origText = elBtnCopy.textContent;
      elBtnCopy.textContent = "Copied!";
      setTimeout(() => {
        elBtnCopy.textContent = origText;
      }, 1500);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  }

  // Auto-resize textarea
  function autoResizeTextarea() {
    elPromptInput.style.height = "auto";
    const newHeight = Math.min(elPromptInput.scrollHeight, 120);
    elPromptInput.style.height = `${newHeight}px`;
    elBtnSend.disabled = elPromptInput.value.trim().length === 0;
  }

  // Poll loop
  async function loop() {
    await fetchAgents();
    await fetchHistory();
  }

  function startPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(loop, state.pollInterval);
  }

  function stopPolling() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  // Utilities
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Preferences that should survive a reload
  function loadPrefs() {
    try {
      const lines = parseInt(localStorage.getItem("herdr.lines"), 10);
      if (lines) {
        state.linesCount = lines;
        elLinesSelect.value = String(lines);
      }
      state.showStatusBar = localStorage.getItem("herdr.statusbar") === "1";
      elToggleStatusBar.checked = state.showStatusBar;
    } catch (err) {
      /* localStorage unavailable in private mode; defaults are fine */
    }
  }

  function savePref(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* ignore */
    }
  }

  // Event Listeners
  elAgentSelect.addEventListener("click", openPicker);
  elBtnClosePicker.addEventListener("click", closePicker);

  elAgentList.addEventListener("click", (e) => {
    const row = e.target.closest(".agent-row");
    if (row && row.dataset.paneId) {
      selectAgent(row.dataset.paneId);
    }
  });

  elBtnRefresh.addEventListener("click", () => {
    triggerHaptic();
    loop();
  });

  elBtnSettings.addEventListener("click", openSheet);
  elBtnCloseSheet.addEventListener("click", closeSheet);
  elSheetBackdrop.addEventListener("click", closeSheet);

  elHistoryContainer.addEventListener("scroll", onHistoryScroll, { passive: true });
  elBtnScrollBottom.addEventListener("click", () => scrollToBottom(true));

  elPromptInput.addEventListener("input", autoResizeTextarea);
  elPromptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  });

  elPromptForm.addEventListener("submit", submitPrompt);

  elBtnCtrlC.addEventListener("click", () => {
    if (confirm("Send interrupt (Ctrl+C) to agent?")) {
      sendKey("ctrl+c");
    }
  });

  elBtnEsc.addEventListener("click", () => sendKey("esc"));
  elBtnCopy.addEventListener("click", copyHistory);

  elLinesSelect.addEventListener("change", (e) => {
    state.linesCount = parseInt(e.target.value, 10) || 100;
    savePref("herdr.lines", String(state.linesCount));
    fetchHistory(true);
  });

  elToggleStatusBar.addEventListener("change", (e) => {
    state.showStatusBar = e.target.checked;
    savePref("herdr.statusbar", state.showStatusBar ? "1" : "0");
    renderTranscript(state.historyText);
    scrollToBottom();
  });

  // Handle page visibility for battery savings & wake-up
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
    } else {
      loop();
      startPolling();
    }
  });

  // Init
  loadPrefs();
  autoResizeTextarea();
  loop();
  startPolling();
})();
