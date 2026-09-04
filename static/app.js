// Herdr Mobile Client Application

(function () {
  let state = {
    agents: [],
    activePaneId: null,
    historyText: "",
    linesCount: 100,
    isUserScrolledUp: false,
    pollInterval: 2000,
    timer: null,
    isSending: false,
  };

  // DOM Elements
  const elConn = document.getElementById("conn-indicator");
  const elBtnRefresh = document.getElementById("btn-refresh");
  const elAgentBar = document.getElementById("agent-bar");
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

  // Haptic feedback helper
  function triggerHaptic(type = "light") {
    if (navigator.vibrate) {
      if (type === "warning") navigator.vibrate([30, 50, 30]);
      else navigator.vibrate(12);
    }
  }

  // Set Connection Status
  function setConnected(connected) {
    if (connected) {
      elConn.classList.add("connected");
      elConn.classList.remove("disconnected");
    } else {
      elConn.classList.remove("connected");
      elConn.classList.add("disconnected");
    }
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

  // Render Agent Carousel Pills
  function renderAgentBar() {
    if (state.agents.length === 0) {
      elAgentBar.innerHTML = '<div class="agent-pill">No agents found</div>';
      return;
    }

    const html = state.agents
      .map((agent) => {
        const isActive = agent.pane_id === state.activePaneId;
        const statusClass = agent.status || "unknown";
        const label = agent.name || agent.pane_id;
        return `
          <div class="agent-pill ${isActive ? "active" : ""}" data-pane-id="${agent.pane_id}">
            <span class="agent-dot ${statusClass}"></span>
            <span>${escapeHtml(label)}</span>
          </div>
        `;
      })
      .join("");

    elAgentBar.innerHTML = html;
  }

  // Select an Agent
  function selectAgent(paneId) {
    if (state.activePaneId === paneId) return;
    state.activePaneId = paneId;
    state.historyText = "";
    elHistoryContent.textContent = "Loading history...";
    triggerHaptic();

    renderAgentBar();
    renderActiveAgentMeta();
    fetchHistory(true);
  }

  // Render Metadata Bar
  function renderActiveAgentMeta() {
    const agent = state.agents.find((a) => a.pane_id === state.activePaneId);
    if (!agent) {
      elAgentTitle.textContent = "No agent selected";
      elAgentCwd.textContent = "";
      elAgentStatus.className = "status-badge status-unknown";
      elAgentStatus.textContent = "--";
      return;
    }

    elAgentTitle.textContent = agent.title || `${agent.agent} (${agent.pane_id})`;
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
        elHistoryContent.textContent = newText || "(No output recorded yet)";

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
    if (state.isUserScrolledUp) {
      elBtnScrollBottom.classList.remove("hidden");
    } else {
      elBtnScrollBottom.classList.add("hidden");
    }
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
        body: jsonStringify({ text }),
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

      // Append temporary visual feedback or fetch immediately
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
        body: jsonStringify({ key }),
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

  function jsonStringify(obj) {
    return JSON.stringify(obj);
  }

  // Event Listeners
  elAgentBar.addEventListener("click", (e) => {
    const pill = e.target.closest(".agent-pill");
    if (pill && pill.dataset.paneId) {
      selectAgent(pill.dataset.paneId);
    }
  });

  elBtnRefresh.addEventListener("click", () => {
    triggerHaptic();
    loop();
  });

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
    fetchHistory(true);
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
  autoResizeTextarea();
  loop();
  startPolling();
})();
