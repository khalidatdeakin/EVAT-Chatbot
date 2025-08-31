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
function addTimestamp(){
  const t = document.createElement("div");
  t.className = "timestamp";
  t.textContent = nowTime();
  chatEl.appendChild(t);
}
function scrollToBottom(){ chatContainer.scrollTop = chatContainer.scrollHeight; }
function autoresize(){ input.style.height = "auto"; input.style.height = (input.scrollHeight) + "px"; }

/***** CHAT RENDER *****/
function addMessage(text, who = "bot"){
  const row = document.createElement("div");
  row.className = `row ${who}-row`;

  // Add a small brand avatar for bot messages
  if (who === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "avatar bot";
    avatar.textContent = "⚡";            // same logo as title
    row.appendChild(avatar);
  }

  const bubbleWrap = document.createElement("div");
  bubbleWrap.className = who;

  const bubble = document.createElement("div");
  bubble.className = "message";
  bubble.textContent = text;

  bubbleWrap.appendChild(bubble);
  row.appendChild(bubbleWrap);

  chatEl.appendChild(row);
  scrollToBottom();
}

/***** QUICK REPLIES *****/
function createQuickReplyButtons(buttons = [
  { label: "Get Directions",     payload: "/get_directions" },
  { label: "Show Traffic",       payload: "/show_traffic" },
  { label: "Check Availability", payload: "/check_availability" }
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

function stationCardEl(s, showAvailability){
  const el = document.createElement("article");
  el.className = "station-card";
  el.innerHTML = `
    <div class="sc-head">
      <div class="sc-icon">⚡</div>
      <div>
        <div class="sc-title">${s.name ?? "Unnamed station"}</div>
        <div class="sc-sub">${s.address ?? ""}</div>
      </div>
      ${showAvailability && s.availability
        ? `<span class="badge ${badgeClass(s.availability)}" style="margin-left:auto">${badgeText(s.availability)}</span>`
        : ""}
    </div>
    <div class="sc-metrics">
      <div><span class="label">Distance</span>${fmtDistance(s.distance_km)}</div>
      <div><span class="label">Cost</span>${s.cost ?? "Price unknown"}</div>
      <div><span class="label">Power</span>${fmtPower(s.power)}</div>
    </div>
    <div class="sc-actions">
      <button class="btn-primary">Get Directions</button>
    </div>
  `;

  el.querySelector(".btn-primary").onclick = () => {
    const payload = s.id
      ? `/get_directions{"station_id":"${s.id}"}`
      : "/get_directions";
    sendMessage(payload);
  };

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
          createQuickReplyButtons(msg.buttons.map(b => ({
            label: b.title, payload: b.payload
          })));
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

clearBtn.addEventListener("click", ()=>{
  chatEl.innerHTML = "";
  cardsEl.innerHTML = "";
  pagerEl.innerHTML = "";
  quickEl.innerHTML = "";
  greet();
});
