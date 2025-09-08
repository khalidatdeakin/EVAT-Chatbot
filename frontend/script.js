/* =========================================================
   EVAT Chat Frontend – Safe, DOM-only rendering
   Fixes implemented:
   1) "Get Directions" button now calls sendMessage(payload)
   2) Removed duplicate formatters; single fmtDistance/fmtPower
   3) Greet message uses plain text (no markdown)
   4) Quick-reply allowlist broadened (configurable)
   5) Demo renderer gated & scoped
   6) User avatar added to match existing CSS
   ========================================================= */

(() => {
  "use strict";

  /***** CONFIG *****/
  const RASA_REST_URL = "http://localhost:5005/webhooks/rest/webhook"; // update if needed
  const SENDER_ID = "web-" + Math.random().toString(36).slice(2);
  const DEMO = false; // set false in production

  // Quick reply buttons permitted from backend (text to display => payload to send; if payload === null, use the same text)
  const QUICK_ALLOWLIST = new Set([
    "Get Directions",
    "Show Availability",
    "Open in Maps",
    "Cheapest nearby",
    "Fastest chargers"
  ]);

  /***** DOM *****/
  const chatEl    = document.getElementById("chat");
  const quickEl   = document.getElementById("quick-replies");
  const cardsEl   = document.getElementById("station-cards");
  const pagerEl   = document.getElementById("pager");
  const typingEl  = document.getElementById("typing-indicator");
  const form      = document.getElementById("chat-form");
  const input     = document.getElementById("user-input");
  const clearBtn  = document.getElementById("clear-btn");

  if (!chatEl || !form || !input) {
    console.error("Required DOM elements not found. Check IDs in chat.html.");
    return;
  }

  /***** UTIL *****/
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function fmtDistance(meters) {
    if (meters == null || isNaN(meters)) return "–";
    if (meters < 950) return `${Math.round(meters)} m`;
    return `${(meters/1000).toFixed(1)} km`;
  }

  function fmtPower(kw) {
    if (kw == null || isNaN(kw)) return "–";
    return `${kw} kW`;
  }

  function scrollToBottom() {
    // Keep the latest message/cards in view
    chatEl.parentElement?.scrollTo({ top: chatEl.parentElement.scrollHeight, behavior: "smooth" });
  }

  /***** MESSAGE RENDERING *****/
  function bubble(role, text) {
    const row = document.createElement("div");
    row.className = `row ${role}`;

    const avatar = document.createElement("div");
    avatar.className = `avatar ${role}`;
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = role === "bot" ? "⚡" : "🙂";

    const msg = document.createElement("div");
    msg.className = "message";
    msg.textContent = text ?? ""; // DOM-safe

    row.appendChild(avatar);
    row.appendChild(msg);
    return row;
  }

  function addMessage(role, text) {
    chatEl.appendChild(bubble(role, text));
    scrollToBottom();
  }

  function setTyping(on) {
    if (!typingEl) return;
    typingEl.classList.toggle("hidden", !on);
  }

  /***** QUICK REPLIES *****/
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

  /***** STATION CARDS *****/
  function stationCardEl(s) {
    // expected fields (best effort): station_id, name, address, distance_m, price, power_kw, availability
    const card = document.createElement("article");
    card.className = "station-card";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", s?.name || "Charging station");

    const h = document.createElement("h3");
    h.textContent = s?.name || "Unknown station";
    card.appendChild(h);

    const meta = document.createElement("div");
    meta.className = "meta";

    const addr = document.createElement("div");
    addr.className = "meta-item";
    addr.textContent = s?.address || "Address: –";
    meta.appendChild(addr);

    const dist = document.createElement("div");
    dist.className = "meta-item";
    dist.textContent = `Distance: ${fmtDistance(Number(s?.distance_m))}`;
    meta.appendChild(dist);

    const power = document.createElement("div");
    power.className = "meta-item";
    power.textContent = `Power: ${fmtPower(Number(s?.power_kw))}`;
    meta.appendChild(power);

    const price = document.createElement("div");
    price.className = "meta-item";
    price.textContent = s?.price ? `Price: ${s.price}` : "Price: –";
    meta.appendChild(price);

    const avail = document.createElement("div");
    avail.className = "meta-item";
    avail.textContent = s?.availability ? `Availability: ${s.availability}` : "Availability: –";
    meta.appendChild(avail);

    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    // Primary action: send structured intent to Rasa (Fix #1)
    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "btn primary";
    goBtn.textContent = "Get Directions";
    goBtn.addEventListener("click", () => {
      const payload = `/get_directions{"station_id":"${s?.station_id ?? ""}","name":"${(s?.name ?? "").replace(/"/g, '\\"')}","address":"${(s?.address ?? "").replace(/"/g, '\\"')}"}`;
      sendMessage(payload);
    });
    actions.appendChild(goBtn);

    // Fallback: open native maps link (optional)
    if (s?.lat && s?.lng) {
      const mapA = document.createElement("a");
      mapA.className = "btn";
      mapA.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.lat + "," + s.lng)}`;
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

    // pager
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

  /***** BACKEND I/O *****/
  async function sendMessage(text) {
    // render user message
    addMessage("user", text);

    // clear composer quick actions
    clearQuick();

    // show typing
    setTyping(true);

    try {
      const res = await fetch(RASA_REST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: SENDER_ID,
          message: text
        })
      });

      const data = await res.json();

      // parse responses
      for (const m of data) {
        if (m.text) addMessage("bot", m.text);

        // Rasa "buttons" (Fix #4 – allowlist)
        if (Array.isArray(m.buttons) && m.buttons.length) {
          renderQuickReplies(m.buttons);
        }

        // Custom payload: stations list
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

  /***** GREETING (Fix #3) *****/
  function greet() {
    addMessage(
      "bot",
      [
        "Hi! I’m EVAT. I can help you find EV charging stations near you.",
        "",
        "Try things like:",
        "• “Nearest fast chargers under $0.45/kWh”",
        "• “Show availability by Docklands”",
        "• “Get directions to the cheapest nearby”"
      ].join("\n")
    );
  }

  /***** FORM & INPUT *****/
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
  input.addEventListener("compositionend",  () => (isComposing = false));
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

  /***** DEMO DATA (Fix #5 – strictly gated) *****/
  const DEMO_STATIONS = [
    { station_id: "STN-001", name: "Spark Hub – Flinders St", address: "123 Flinders St, Melbourne VIC", distance_m: 420,  power_kw: 50, price: "$0.40/kWh", availability: "3/4", lat: -37.8183, lng: 144.9671 },
    { station_id: "STN-002", name: "Volt Lane – Docklands",    address: "88 Harbour Esplanade, Docklands VIC", distance_m: 1600, power_kw: 150, price: "$0.48/kWh", availability: "2/6", lat: -37.8149, lng: 144.9500 },
    { station_id: "STN-003", name: "ChargePoint – Carlton",     address: "45 Lygon St, Carlton VIC", distance_m: 2300, power_kw: 22, price: "$0.35/kWh", availability: "5/8", lat: -37.8000, lng: 144.9667 },
    { station_id: "STN-004", name: "PowerStop – Southbank",     address: "200 City Rd, Southbank VIC", distance_m: 1800, power_kw: 350, price: "$0.55/kWh", availability: "1/4", lat: -37.8226, lng: 144.9650 },
    { station_id: "STN-005", name: "GreenCharge – Fitzroy",     address: "12 Brunswick St, Fitzroy VIC", distance_m: 3100, power_kw: 11, price: "$0.30/kWh", availability: "7/10", lat: -37.7984, lng: 144.9783 },
    { station_id: "STN-006", name: "AmpUp – St Kilda",          address: "1 Acland St, St Kilda VIC", distance_m: 5200, power_kw: 50, price: "$0.45/kWh", availability: "4/6", lat: -37.8676, lng: 144.9750 },
    { station_id: "STN-007", name: "JuiceBox – Richmond",       address: "77 Swan St, Richmond VIC", distance_m: 4000, power_kw: 22, price: "$0.33/kWh", availability: "6/8", lat: -37.8245, lng: 144.9980 }
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

  /***** INIT *****/
  greet();
  if (DEMO) renderDemoOnce();
})();
