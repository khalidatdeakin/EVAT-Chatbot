/***** CONFIG *****/
const RASA_REST_URL = "http://localhost:5005/webhooks/rest/webhook"; // change if needed
const SENDER_ID = "web-" + Math.random().toString(36).slice(2);

let userLocation = null;

/***** DOM *****/
const chatContainer = document.getElementById("chat-container");
const chatEl = document.getElementById("chat");
const quickEl = document.getElementById("quick-replies");
const cardsEl = document.getElementById("station-cards");
const pagerEl = document.getElementById("pager");
const typingEl = document.getElementById("typing-indicator");
const form = document.getElementById("chat-form");
const input = document.getElementById("user-input");
const clearBtn = document.getElementById("clear-btn");

/***** UTILITIES *****/
function nowTime(){
  const d = new Date();
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${hh}:${mm}`;
}
// Alias used by inline chips and station-card button
const sendText = (text) => sendMessage(text);

function addTimestamp(){
  const t = document.createElement("div");
  t.className = "timestamp";
  t.textContent = nowTime();
  chatEl.appendChild(t);
}
function scrollToBottom(){ chatContainer.scrollTop = chatContainer.scrollHeight; }
function autoresize(){ input.style.height = "auto"; input.style.height = (input.scrollHeight) + "px"; }

function appendInlineNumberChips(options = [{label:'1', payload:'1'},{label:'2', payload:'2'},{label:'3', payload:'3'}]) {
  // Find the most recent bot message bubble
  const lastBotMsg = chatEl.querySelector('.row.bot:last-of-type .message');
  if (!lastBotMsg) return;

  // If already added, skip
  if (lastBotMsg.querySelector('.inline-options')) return;

  const wrap = document.createElement('div');
  wrap.className = 'inline-options';

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = opt.label;        // shows 1 / 2 / 3
    btn.addEventListener('click', () => sendText(opt.payload)); // sends "1"/"2"/"3"
    wrap.appendChild(btn);
  });

  lastBotMsg.appendChild(wrap); // ✅ appended without changing the welcome text
}

/***** CHAT RENDER *****/
function addMessage(text, who, opts = {}) {
  const row = document.createElement('div');
  row.className = 'row ' + who;

  const bubbleWrap = document.createElement('div');
  bubbleWrap.className = who;

  const bubble = document.createElement('div');
  bubble.className = 'message';
  bubble.textContent = text;

  bubbleWrap.appendChild(bubble);

  if (who === 'bot') {
    // keep existing bot avatar
    const avatar = document.createElement('div');
    avatar.className = 'avatar bot';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = '⚡';
    row.appendChild(avatar);
    row.appendChild(bubbleWrap);
  } else {
    // user: bubble then avatar on the right
    row.appendChild(bubbleWrap);
    const avatar = document.createElement('div');
    avatar.className = 'avatar user';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = '🙂';
    row.appendChild(avatar);
  }

  chatEl.appendChild(row);
  scrollToBottom();
}

/***** QUICK REPLIES *****/
function createQuickReplyButtons(buttons = [
  { label: "Get Directions", payload: "/get_directions" }
]){
  quickEl.innerHTML = "";
  buttons.forEach(({label, payload})=>{
    const b = document.createElement("button");
    b.className = "qr"; b.type = "button"; b.textContent = label;
    b.onclick = () => {
      [...quickEl.querySelectorAll("button")].forEach(x => x.disabled = true);
      sendMessage(payload);
    };
    quickEl.appendChild(b);
  });
}

/***** STATION CARDS *****/
function renderStationCards(stations, showAvailability=false){
  cardsEl.innerHTML = "";
  if (!Array.isArray(stations) || stations.length === 0) return;

  stations.forEach(s => cardsEl.appendChild(stationCardEl(s, showAvailability)));
}

function stationCardEl(s, showAvailability) {
  const el = document.createElement("article");
  el.className = "station-card";

  // --- Head ---
  const head = document.createElement("div");
  head.className = "sc-head";

  const icon = document.createElement("div");
  icon.className = "sc-icon";
  icon.textContent = "⚡";

  const headRight = document.createElement("div");
  const title = document.createElement("div");
  title.className = "sc-title";
  title.textContent = s.name ?? "Unnamed station";

  const sub = document.createElement("div");
  sub.className = "sc-sub";
  sub.textContent = s.address ?? "";

  headRight.append(title, sub);
  head.append(icon, headRight);

  if (showAvailability && s.availability) {
    const badge = document.createElement("span");
    badge.className = `badge ${badgeClass(s.availability)}`;
    badge.style.marginLeft = "auto";
    badge.textContent = badgeText(s.availability);
    head.appendChild(badge);
  }

  // --- Metrics ---
  const metrics = document.createElement("div");
  metrics.className = "sc-metrics";

  const metric = (label, valueText, extraClass) => {
    const wrap = document.createElement("div");
    const lab = document.createElement("span");
    lab.className = "label";
    lab.textContent = label;
    const val = document.createElement("span");
    val.className = "value" + (extraClass ? " " + extraClass : "");
    val.textContent = valueText;
    wrap.append(lab, val);
    return wrap;
  };

  metrics.append(
    metric("Distance", fmtDistance(s.distance_km)),
    metric("Cost", s.cost ?? "Price unknown", "cost"),
    metric("Power", fmtPower(s.power))
  );

  // --- Actions ---
  const actions = document.createElement("div");
  actions.className = "sc-actions";

  const btn = document.createElement("button");
  btn.className = "btn-primary";
  btn.textContent = "Get Directions";
  btn.addEventListener("click", () => {
    // Call your existing send function if present; otherwise log.
    if (typeof sendText === "function") {
      try {
        sendText("/get_directions", {
          station_id: s.station_id,
          name: s.name,
          address: s.address
        });
      } catch (e) {
        console.warn("sendText threw, falling back to log:", e, s);
      }
    } else {
      console.log("Get Directions clicked:", s);
    }
  });

  actions.appendChild(btn);

  // --- Assemble ---
  el.append(head, metrics, actions);
  return el;
}

function badgeClass(a){ return a==="yes"?"available":a==="no"?"busy":"unknown"; }
function badgeText(a){ return a==="yes"?"Available":a==="no"?"Busy":"Unknown"; }
function fmtDistance(km){
  if (km==null || isNaN(km)) return "—";
  return km < 10 ? `${Number(km).toFixed(1)} km` : `${Math.round(km)} km`;
}
function fmtPower(p){ return p ? (typeof p==="string"?p:`Up to ${p} kW`) : "—"; }

/***** PAGER (illustrative) *****/
function renderPager(pages=3, current=1){
  pagerEl.innerHTML = "";
  for (let i=1;i<=pages;i++){
    const d = document.createElement("button");
    d.className = "page-dot" + (i===current?" active":"");
    d.textContent = i;
    d.onclick = () => {
      document.querySelectorAll(".page-dot").forEach(x=>x.classList.remove("active"));
      d.classList.add("active");
      // hook up real paging once backend supports it
    };
    pagerEl.appendChild(d);
  }
}

/***** NETWORK *****/
async function sendMessage(message){
  if (!message) return;

  // render the user's choice
  addTimestamp();
  addMessage(prettyUserLabel(message), "user");

  typing(true);

  try{
    const body = {
      sender: SENDER_ID,
      message,
      metadata: userLocation ? { location: userLocation } : undefined
    };

    const res = await fetch(RASA_REST_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json(); // array of messages

    // reset quick replies (fresh set comes from the bot if provided)
    quickEl.innerHTML = "";

    let stations = null;
    let showAvail = false;

    if (!Array.isArray(data) || data.length === 0){
      addTimestamp();
      addMessage("Sorry, I didn’t understand that.", "bot");
    } else {
      data.forEach(msg => {
        if (msg.text){
          addTimestamp();
          addMessage(msg.text, "bot");
        }

        // Render suggested buttons returned by Rasa (optional)
        if (Array.isArray(msg.buttons)){
  const allowed = msg.buttons.filter(b =>
    (b.payload && b.payload.startsWith("/get_directions")) ||
    (b.title && /get directions/i.test(b.title))
  ).map(b => ({ label: b.title || "Get Directions", payload: b.payload || "/get_directions" }));

  if (allowed.length) {
    createQuickReplyButtons(allowed);
  } else {
    // if bot suggested other buttons, ignore them and keep our default
    createQuickReplyButtons();
  }
}

        // Custom payload with stations
        if (msg.custom && Array.isArray(msg.custom.stations)){
          stations = msg.custom.stations;
          showAvail = !!msg.custom.show_availability;
        }
      });
    }

    if (stations){
      renderStationCards(stations, showAvail);
      renderPager(3);
    }

  }catch(err){
    console.error(err);
    addTimestamp();
    addMessage("Sorry, I couldn’t reach the server.", "bot");
  }finally{
    typing(false);
    input.value = "";
    autoresize();
    scrollToBottom();
  }
}

function prettyUserLabel(message){
  if (typeof message === "string" && message.startsWith("/")){
    const name = message.split("{")[0].slice(1).replace(/_/g," ");
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return message;
}

/***** UX HELPERS *****/
function typing(on){ typingEl.classList.toggle("hidden", !on); }
function greet(){
  addTimestamp();
  addMessage("Hello! Welcome to Melbourne EV Charging Assistant ⚡\n\nPlease select an option:\n\n1. 🗺️ **Route Planning** – Plan charging stops for your journey\n2. 🚨 **Emergency Charging** – Find nearest stations when battery is low\n3. ⚡ **Charging Preferences** – Find stations by your preferences\n\n**🎯 Type 1, 2, or 3 to continue!**", "bot");
  createQuickReplyButtons(); // initial quick actions
  appendInlineNumberChips();   // adds 1/2/3 chips under the welcome text
}

/***** GEO *****/
function captureLocation(){
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      userLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
    },
    ()=>{ /* ignore errors silently */ },
    { enableHighAccuracy:true, maximumAge:30000, timeout:8000 }
  );
}

/* ===========================
   DEMO: render fake stations
   =========================== */

function fmtDistance(km) {
  if (km == null) return "—";
  const n = Number(km);
  return n < 1 ? `${Math.round(n * 1000)} m` : `${n.toFixed(1)} km`;
}
function fmtPower(p) {
  if (p == null) return "—";
  return (typeof p === "string") ? p : `${p} kW`;
}

const DUMMY_STATIONS = [
  {
    station_id: "cf-melb-central",
    name: "Melbourne Central — Chargefox",
    address: "211 La Trobe St, Melbourne VIC 3000",
    distance_km: 1.2,
    cost: "$0.45/kWh",
    power: "Up to 150 kW",
    availability: "yes"
  },
  {
    station_id: "cf-qvm",
    name: "QVM Car Park — Chargefox",
    address: "36 Peel St, North Melbourne VIC 3051",
    distance_km: 2.4,
    cost: "$0.42/kWh + $1/min idle",
    power: 75,
    availability: "no"
  },
  {
    station_id: "evie-bourke",
    name: "Bourke Street — Evie",
    address: "620 Bourke St, Melbourne VIC 3000",
    distance_km: 0.8,
    cost: "$0.55/kWh",
    power: 200,
    availability: "yes"
  }
];

function renderDummyStations() {
  let container =
    document.querySelector("#station-cards") ||
    document.querySelector(".station-cards") ||
    document.querySelector("[data-stations]");

  if (!container) {
    container = document.createElement("section");
    container.id = "station-cards";
    container.style.margin = "12px 0";
    const chat = document.querySelector("#chat") || document.body;
    chat.prepend(container);
  }

  container.innerHTML = ""; // clear
  DUMMY_STATIONS.forEach(s => container.appendChild(stationCardEl(s, true)));
}

const FORCE_DEMO = false; // set true to always show
const urlParams = new URLSearchParams(window.location.search);
if (FORCE_DEMO || urlParams.get("demo") === "stations") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderDummyStations);
  } else {
    renderDummyStations();
  }
}


/***** EVENTS *****/
window.addEventListener("DOMContentLoaded", ()=>{
  captureLocation();
  greet();
  autoresize();
  input.focus();
});

form.addEventListener("submit", (e)=>{
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  sendMessage(text);
});

input.addEventListener("input", autoresize);

// --- Enter to send, Shift+Enter for newline (IME-safe) ---
let isComposing = false;
input.addEventListener("compositionstart", () => (isComposing = true));
input.addEventListener("compositionend",  () => (isComposing = false));

input.addEventListener("keydown", (e) => {
  if (isComposing) return;                 // let IME finish composing
  if (e.key === "Enter" && !e.shiftKey) {  // plain Enter
    e.preventDefault();                    // stop newline
    const text = input.value.trim();
    if (text) {
      form.requestSubmit();                // triggers your existing submit handler
    }
  }
});

clearBtn.addEventListener("click", ()=>{
  chatEl.innerHTML = "";
  cardsEl.innerHTML = "";
  pagerEl.innerHTML = "";
  quickEl.innerHTML = "";
  greet();
});
