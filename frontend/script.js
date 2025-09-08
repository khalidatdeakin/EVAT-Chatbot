/* =========================================================
   EVAT Chat Frontend — Safe DOM rendering
   - Bot Markdown (bold, lists) safely supported
   - User bubble/avatar appear on the right (via .row.user)
   - Station cards structured like the screenshot
   - "Get Directions" sends an intent payload to Rasa
   - Demo stations gated by DEMO flag
   ========================================================= */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  const RASA_REST_URL = "http://localhost:5005/webhooks/rest/webhook"; // adjust if needed
  const SENDER_ID = "web-" + Math.random().toString(36).slice(2);
  const DEMO = true; // set to false for real backend-only behavior

  // Whitelisted quick buttons from backend
  const QUICK_ALLOWLIST = new Set([
    "Get Directions",
    "Show Availability",
    "Open in Maps",
    "Cheapest nearby",
    "Fastest chargers"
  ]);

  /* ---------- DOM ---------- */
  const chatEl   = document.getElementById("chat");
  const quickEl  = document.getElementById("quick-replies");
  const cardsEl  = document.getElementById("station-cards");
  const pagerEl  = document.getElementById("pager");
  const typingEl = document.getElementById("typing-indicator");
  const form     = document.getElementById("chat-form");
  const input    = document.getElementById("user-input");
  const clearBtn = document.getElementById("clear-btn");

  if (!chatEl || !form || !input) {
    console.error("Required DOM elements not found. Check IDs in chat.html.");
    return;
  }

  /* ---------- UTIL ---------- */
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function fmtDistance(meters) {
    if (meters == null || isNaN(meters)) return "–";
    if (meters < 950) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  function fmtPower(kw) {
    if (kw == null || isNaN(kw)) return "–";
    // allow strings like "Up to 150" to pass through
    return typeof kw === "number" ? `${kw} kW` : `${kw} kW`;
  }

  function scrollToBottom() {
    chatEl.parentElement?.scrollTo({
      top: chatEl.parentElement.scrollHeight,
      behavior: "smooth"
    });
  }

  /* ---------- Minimal, safe Markdown for BOT only ---------- */
  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function inlineMd(s) {
    // **bold**
    return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }
  function mdToSafeHtml(md) {
    const lines = String(md ?? "").split("\n");
    let html = "";
    let listOpen = null; // "ol" | "ul"
    const flush = () => {
      if (listOpen) {
        html += `</${listOpen}>`;
        listOpen = null;
      }
    };
    for (const raw of lines) {
      const line = raw.trimEnd();

      // ordered list: "1. text"
      let mNum = line.match(/^\s*\d+\.\s+(.*)$/);
      if (mNum) {
        const item = inlineMd(escapeHtml(mNum[1]));
        if (listOpen !== "ol") {
          flush();
          html += "<ol>";
          listOpen = "ol";
        }
        html += `<li>${item}</li>`;
        continue;
      }

      // unordered list: "- text" or "• text"
      let mBul = line.match(/^\s*(?:-|•)\s+(.*)$/);
      if (mBul) {
        const item = inlineMd(escapeHtml(mBul[1]));
        if (listOpen !== "ul") {
          flush();
          html += "<ul>";
          listOpen = "ul";
        }
        html += `<li>${item}</li>`;
        continue;
      }

      if (line.trim() === "") {
        flush();
        html += "<br/>";
        continue;
      }

      flush();
      html += inlineMd(escapeHtml(line)) + "<br/>";
    }
    flush();
    return html;
  }

  /* ---------- Chat bubbles ---------- */
  function bubble(role, text) {
    const row = document.createElement("div");
    row.className = `row ${role}`; // CSS handles .row.user { flex-direction: row-reverse }

    const avatar = document.createElement("div");
    avatar.className = `avatar ${role}`;
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = role === "bot" ? "⚡" : "🙂";

    const msg = document.createElement("div");
    msg.className = "message";

    if (role === "bot") {
      msg.innerHTML = mdToSafeHtml(text);
    } else {
      msg.textContent = text ?? "";
    }

    row.appendChild(avatar);
    row.appendChild(msg);
    return row;
  }

  function addMessage(role, text) {
    chatEl.appendChild(bubble(role, text));
    scrollToBottom();
  }

  function setTyping(on) {
    typingEl?.classList.toggle("hidden", !on);
  }

  /* ---------- Quick replies ---------- */
  function clearQuick() {
    if (quickEl) quickEl.innerHTML = "";
  }

  function renderQuickReplies(buttons) {
    clearQuick();
    if (!quickEl || !Array.isArray(buttons) || !buttons.length) return;

    for (const b of buttons) {
      const title = (b.title || b.payload || "").trim();
      if (!title || !QUICK_ALLOWLIST.has(title)) continue;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = title;
      const payload = b.payload || title;
      btn.addEventListener("click", () => sendMessage(payload));
      quickEl.appendChild(btn);
    }
  }

  /* ---------- Station cards ---------- */
  function computeStatus(s) {
    // Prefer explicit s.status; otherwise infer from availability like "3/4"
    let label = "Available";
    let kind = "success";
    if (typeof s?.status === "string") {
      const t = s.status.toLowerCase();
      if (t.includes("busy") || t.includes("full") || t.includes("unavailable")) {
        label = "Busy";
        kind = "danger";
      }
    } else if (typeof s?.availability === "string" && s.availability.includes("/")) {
      const [a, b] = s.availability.split("/").map((x) => parseInt(x, 10));
      if (!isNaN(a) && !isNaN(b)) {
        if (a <= 0) {
          label = "Busy";
          kind = "danger";
        } else {
          label = "Available";
          kind = "success";
        }
      }
    }
    return { label, kind };
  }

  function stationCardEl(s) {
    const card = document.createElement("article");
    card.className = "station-card";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", s?.name || "Charging station");

    // Header: icon + name/provider + status badge
    const header = document.createElement("div");
    header.className = "station-header";

    const icon = document.createElement("div");
    icon.className = "station-icon";
    icon.textContent = "⚡";
    header.appendChild(icon);

    const titleWrap = document.createElement("div");
    titleWrap.className = "station-title-wrap";

    const title = document.createElement("h3");
    const provider = s?.provider || s?.network || ""; // optional
    title.textContent = provider
      ? `${s?.name || "Unknown"} — ${provider}`
      : (s?.name || "Unknown");
    titleWrap.appendChild(title);

    const addr = document.createElement("div");
    addr.className = "station-addr";
    addr.textContent = s?.address || "";
    titleWrap.appendChild(addr);

    header.appendChild(titleWrap);

    const { label: statusLabel, kind: statusKind } = computeStatus(s);
    const badge = document.createElement("span");
    badge.className = `badge ${statusKind}`;
    badge.textContent = statusLabel;
    header.appendChild(badge);

    card.appendChild(header);

    // Meta grid: Distance | Cost | Power
    const grid = document.createElement("div");
    grid.className = "meta-grid";

    // Distance
    const distBlock = document.createElement("div");
    distBlock.className = "meta-block";
    const distLabel = document.createElement("div");
    distLabel.className = "label";
    distLabel.textContent = "Distance";
    const distValue = document.createElement("div");
    distValue.className = "value";
    distValue.textContent = fmtDistance(Number(s?.distance_m));
    distBlock.appendChild(distLabel);
    distBlock.appendChild(distValue);
    grid.appendChild(distBlock);

    // Cost (green-ish positive look; CSS should style .value.positive)
    const costBlock = document.createElement("div");
    costBlock.className = "meta-block";
    const costLabel = document.createElement("div");
    costLabel.className = "label";
    costLabel.textContent = "Cost";
    const costValue = document.createElement("div");
    costValue.className = "value positive";
    costValue.textContent = s?.price || s?.cost || "–";
    costBlock.appendChild(costLabel);
    costBlock.appendChild(costValue);
    grid.appendChild(costBlock);

    // Power
    const powerBlock = document.createElement("div");
    powerBlock.className = "meta-block";
    const powerLabel = document.createElement("div");
    powerLabel.className = "label";
    powerLabel.textContent = "Power";
    const powerValue = document.createElement("div");
    powerValue.className = "value";
    // accept strings like "Up to 150 kW" or numbers
    powerValue.textContent =
      s?.power_kw != null
        ? (typeof s.power_kw === "number" ? `${s.power_kw} kW` : String(s.power_kw))
        : (s?.power || "–");
    powerBlock.appendChild(powerLabel);
    powerBlock.appendChild(powerValue);
    grid.appendChild(powerBlock);

    card.appendChild(grid);

    // Actions row
    const actions = document.createElement("div");
    actions.className = "actions";

    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "btn primary";
    goBtn.textContent = "Get Directions";
    goBtn.addEventListener("click", () => {
      const payload = `/get_directions{"station_id":"${s?.station_id ?? ""}","name":"${(s?.name ?? "").replace(/"/g, '\\"')}","address":"${(s?.address ?? "").replace(/"/g, '\\"')}"}`;
      sendMessage(payload);
    });
    actions.appendChild(goBtn);

    if (s?.lat && s?.lng) {
      const mapA = document.createElement("a");
      mapA.className = "btn";
      mapA.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        s.lat + "," + s.lng
      )}`;
      mapA.target = "_blank";
      mapA.rel = "noopener";
      mapA.textContent = "Open in Maps";
      actions.appendChild(mapA);
    }

    card.appendChild(actions);
    return card;
  }

  function renderStations(stations = [], page = 1, perPage = 6) {
    if (!cardsEl || !pagerEl) return;
    cardsEl.innerHTML = "";
    pagerEl.innerHTML = "";
    if (!stations.length) return;

    const total = stations.length;
    const pages = Math.ceil(total / perPage) || 1;
    const p = clamp(page, 1, pages);
    const start = (p - 1) * perPage;
    const slice = stations.slice(start, start + perPage);

    for (const s of slice) {
      cardsEl.appendChild(stationCardEl(s));
    }

    if (pages > 1) {
      for (let i = 1; i <= pages; i++) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "page-dot" + (i === p ? " active" : "");
        dot.textContent = String(i);
        dot.addEventListener("click", () => renderStations(stations, i, perPage));
        pagerEl.appendChild(dot);
      }
    }
    scrollToBottom();
  }

  /* ---------- Backend I/O ---------- */
  async function sendMessage(text) {
    // show user message
    addMessage("user", text);
    clearQuick();
    setTyping(true);

    try {
      const res = await fetch(RASA_REST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: SENDER_ID, message: text })
      });

      const data = await res.json();

      for (const m of data) {
        if (m.text) addMessage("bot", m.text);

        if (Array.isArray(m.buttons) && m.buttons.length) {
          renderQuickReplies(m.buttons);
        }

        if (m.custom && Array.isArray(m.custom.stations)) {
          renderStations(m.custom.stations);
        }
      }
    } catch (err) {
      console.error(err);
      addMessage("bot", "Sorry, I couldn’t reach the server. Please try again.");
    } finally {
      setTyping(false);
    }
  }

  /* ---------- Greeting (formatted) ---------- */
  function greet() {
    const md = [
      "Hello! Welcome to Melbourne EV Charging Assistant ⚡",
      "",
      "Please select an option:",
      "",
      "1. 🗺️ **Route Planning** – Plan charging stops for your journey",
      "2. 🚨 **Emergency Charging** – Find nearest stations when battery is low",
      "3. ⚡ **Charging Preferences** – Find stations by your preferences",
      "",
      "**🎯 Type 1, 2, or 3 to continue!**"
    ].join("\n");
    addMessage("bot", md);
  }

  /* ---------- Form & input ---------- */
  // autoresize textarea
  function autoresize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 220) + "px";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    autoresize();
    sendMessage(text);
  });

  // Enter to send / Shift+Enter newline with IME safety
  let isComposing = false;
  input.addEventListener("compositionstart", () => (isComposing = true));
  input.addEventListener("compositionend", () => (isComposing = false));
  input.addEventListener("keydown", (e) => {
    if (isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", autoresize);

  clearBtn?.addEventListener("click", () => {
    chatEl.innerHTML = "";
    cardsEl.innerHTML = "";
    pagerEl.innerHTML = "";
    quickEl.innerHTML = "";
    greet();
  });

  /* ---------- Demo data (turn off by setting DEMO=false) ---------- */
  const DEMO_STATIONS = [
    {
      station_id: "CFX-001",
      name: "Melbourne Central",
      provider: "Chargefox",
      address: "211 La Trobe St, Melbourne VIC 3000",
      distance_m: 1200,
      price: "$0.45/kWh",
      power_kw: "Up to 150",
      availability: "3/6",
      status: "available",
      lat: -37.8103, lng: 144.9631
    },
    {
      station_id: "CFX-002",
      name: "QVM Car Park",
      provider: "Chargefox",
      address: "36 Peel St, North Melbourne VIC 3051",
      distance_m: 2400,
      price: "$0.42/kWh + $1/min idle",
      power_kw: 75,
      availability: "0/4",
      status: "busy",
      lat: -37.8068, lng: 144.9567
    },
    {
      station_id: "EVIE-003",
      name: "Bourke Street",
      provider: "Evie",
      address: "620 Bourke St, Melbourne VIC 3000",
      distance_m: 800,
      price: "$0.55/kWh",
      power_kw: 200,
      availability: "5/6",
      status: "available",
      lat: -37.8156, lng: 144.9601
    }
  ];

  function renderDemoOnce() {
    if (!DEMO) return;
    renderStations(DEMO_STATIONS, 1, 6);
    renderQuickReplies([
      { title: "Get Directions", payload: "/get_directions" },
      { title: "Show Availability", payload: "/show_availability" },
      { title: "Open in Maps", payload: "/open_maps" }
    ]);
  }

  /* ---------- Init ---------- */
  greet();
  if (DEMO) renderDemoOnce();
})();
