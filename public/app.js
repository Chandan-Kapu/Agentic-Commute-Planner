// Commute Agent UI — vanilla JS, no build step.
import { BART, CALTRAIN, bartName, caltrainTrip } from "/stations.js";
const $ = (s) => document.querySelector(s);
const hm = (t) => { const [h, m] = String(t).split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = { config: null, prefs: null, token: null, supabase: null, lastPlan: null };

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) };
  const r = await fetch(path, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------- auth (optional Supabase magic link) ----------
async function initAuth() {
  const { supabaseUrl, supabaseAnonKey } = state.config;
  if (!supabaseUrl || !supabaseAnonKey) return;
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    state.supabase = mod.createClient(supabaseUrl, supabaseAnonKey);
    const { data } = await state.supabase.auth.getSession();
    state.token = data.session?.access_token ?? null;
    state.supabase.auth.onAuthStateChange((_e, s) => { state.token = s?.access_token ?? null; renderAuth(); });
    const btn = $("#authBtn");
    btn.hidden = false;
    btn.onclick = async () => {
      if (state.token) { await state.supabase.auth.signOut(); state.token = null; renderAuth(); return; }
      $("#authDlg").showModal();
    };
    $("#authForm").addEventListener("submit", async (e) => {
      if (e.submitter?.value !== "send") return;
      const email = $("#authEmail").value.trim();
      const { error } = await state.supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
      banner(error ? `Sign-in failed: ${error.message}` : "Check your inbox for the sign-in link.");
    });
    renderAuth();
  } catch (e) { console.warn("Supabase unavailable", e); }
}
function renderAuth() {
  $("#authBtn").textContent = state.token ? "Sign out" : "Sign in";
  $("#prefsMeta").textContent = state.token ? "Saved to your account (Supabase)." : "Demo mode — saved in this browser only.";
}

// ---------- prefs: "Your commute" + "Your stations" ----------
const get = (o, path) => path.split(".").reduce((a, k) => a?.[k], o);
const set = (o, path, v) => { const ks = path.split("."); let a = o; ks.slice(0, -1).forEach((k) => (a = a[k] ??= {})); a[ks.at(-1)] = v; };
const SPECIAL = new Set(["origin", "destination", "workday"]);

function fillStationLists() {
  for (const sel of document.querySelectorAll("select[data-list]")) {
    sel.innerHTML = sel.dataset.list === "bart"
      ? BART.map(([a, n]) => `<option value="${a}">${esc(n)}</option>`).join("")
      : CALTRAIN.map(([n]) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  }
}

function fillForm(p) {
  const f = $("#prefsForm");
  f.origin.value = p.origin.label; f.destination.value = p.destination.label;
  for (const el of f.elements) {
    if (!el.name || SPECIAL.has(el.name)) continue;
    const v = get(p, el.name);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
  }
  for (const el of f.querySelectorAll('input[name="workday"]')) el.checked = p.workdays.includes(Number(el.value));
  const b = p.modeBias || {};
  const learned = Object.entries(b).filter(([, v]) => v).map(([k, v]) => `${k} ${v < 0 ? "preferred" : "less preferred"} (${v > 0 ? "+" : ""}${v})`);
  $("#bias").textContent = learned.length ? `Learned from your choices: ${learned.join(" · ")}` : "Use “I took this” on a plan and it learns which mode you prefer.";
  stationNotes(p);
}

function stationNotes(p) {
  $("#bartNote").textContent = p.bart.originStation === p.bart.destStation ? "Pick two different BART stations." :
    `${bartName(p.bart.originStation)} → ${bartName(p.bart.destStation)}${p.bart.lineHeads?.length ? ` · trains toward ${p.bart.lineHeads.map(bartName).join(", ")}` : ""}`;
  const ct = caltrainTrip(p.caltrain.originName, p.caltrain.destName);
  $("#caltrainNote").textContent = ct ? `${ct.direction === "N" ? "Northbound" : "Southbound"} · 511 stop ${ct.originStation}` : "Pick two different Caltrain stations.";
}

// Rough drive estimate from straight-line distance, used until a routing key (Mapbox) gives live ETAs.
function estimateDrive(o, d) {
  const R = 3958.8, rad = Math.PI / 180;
  const a = Math.sin(((d.lat - o.lat) * rad) / 2) ** 2 + Math.cos(o.lat * rad) * Math.cos(d.lat * rad) * Math.sin(((d.lon - o.lon) * rad) / 2) ** 2;
  const miles = 2 * R * Math.asin(Math.sqrt(a)) * 1.25;
  return { miles: Math.round(miles * 10) / 10, baselineMin: Math.max(5, Math.round((miles / 55) * 60 + 6)) };
}

async function readForm() {
  const f = $("#prefsForm");
  const p = structuredClone(state.prefs);
  const notes = [];
  const before = { bart: `${p.bart.originStation}>${p.bart.destStation}`, ct: `${p.caltrain.originName}>${p.caltrain.destName}` };
  for (const el of f.elements) {
    if (!el.name || SPECIAL.has(el.name)) continue;
    set(p, el.name, el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value);
  }
  p.workdays = [...f.querySelectorAll('input[name="workday"]:checked')].map((el) => Number(el.value));
  if (hm(p.earliestDepart) >= hm(p.latestDepart)) throw new Error("“Earliest I’d leave” must be before “Latest I’d leave”.");
  if (!p.drive.enabled && !p.bart.enabled && !p.caltrain.enabled) throw new Error("Turn on at least one of driving, BART or Caltrain.");

  let moved = false;
  for (const k of ["origin", "destination"]) {
    const q = f[k].value.trim();
    if (q && q !== p[k].label) {
      const { place } = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!place) throw new Error(`Couldn't find “${q}”. Try adding the city.`);
      p[k] = place; moved = true;
    }
  }
  if (moved) {
    const est = estimateDrive(p.origin, p.destination);
    p.drive.miles = est.miles;
    if (Number(f["drive.baselineMin"].value) === state.prefs.drive.baselineMin) p.drive.baselineMin = est.baselineMin;
    $("#geoNote").textContent = `Found: ${p.origin.label} → ${p.destination.label} (~${est.miles} mi by road)`;
  }

  if (p.bart.enabled) {
    if (p.bart.originStation === p.bart.destStation) throw new Error("Pick two different BART stations.");
    p.bart.originName = bartName(p.bart.originStation); p.bart.destName = bartName(p.bart.destStation);
    if (`${p.bart.originStation}>${p.bart.destStation}` !== before.bart) {
      p.bart.lineHeads = [];
      try {
        const t = await api(`/api/bart-trip?orig=${p.bart.originStation}&dest=${p.bart.destStation}`);
        if (t.minutes) p.bart.rideMin = t.minutes;
        p.bart.lineHeads = t.heads ?? [];
        if (t.transfers) notes.push(`BART trip needs ${t.transfers} transfer(s) — ride time includes it.`);
      } catch {
        notes.push(`Couldn’t look up BART times for ${p.bart.originName} → ${p.bart.destName}. Check “Ride (min)” and “Drive to station” in Your stations.`);
      }
    }
  }
  if (p.caltrain.enabled) {
    const ct = caltrainTrip(p.caltrain.originName, p.caltrain.destName);
    if (!ct) throw new Error("Pick two different Caltrain stations.");
    Object.assign(p.caltrain, { originStation: ct.originStation, destStation: ct.destStation, direction: ct.direction });
    if (`${p.caltrain.originName}>${p.caltrain.destName}` !== before.ct) {
      p.caltrain.rideMin = ct.rideMin;
      notes.push(`Caltrain ride estimated at ${ct.rideMin} min — adjust “Ride (min)” if you usually take a Baby Bullet or local.`);
    }
  }
  if (notes.length) banner(notes.join(" "));
  return p;
}

async function loadPrefs() {
  const local = store.get("prefs");
  const r = await api("/api/prefs");
  state.prefs = r.signedIn ? r.prefs : local ? { ...r.prefs, ...local } : r.prefs;
  fillForm(state.prefs);
}

$("#prefsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const action = e.submitter?.value || "save";
  const btns = [...e.currentTarget.querySelectorAll("button")]; btns.forEach((b) => (b.disabled = true));
  try {
    const p = await readForm();
    const r = await api("/api/prefs", { method: "PUT", body: JSON.stringify({ prefs: p }) });
    state.prefs = r.prefs; store.set("prefs", r.prefs); fillForm(r.prefs);
    if (action === "save") banner(r.saved ? "Saved to your account." : "Saved in this browser.");
    else await plan(action);
  } catch (err) { banner(err.message); } finally { btns.forEach((b) => (b.disabled = false)); }
});
for (const sel of document.querySelectorAll("select[data-list]")) {
  sel.addEventListener("change", () => {
    const f = $("#prefsForm"), p = structuredClone(state.prefs);
    for (const k of ["bart.originStation", "bart.destStation", "caltrain.originName", "caltrain.destName"]) set(p, k, f[k].value);
    stationNotes(p);
  });
}

// ---------- planning ----------
function banner(msg) { const b = $("#banner"); b.textContent = msg; b.hidden = !msg; clearTimeout(banner.t); banner.t = setTimeout(() => (b.hidden = true), 6000); }

async function plan(kind) {
  document.querySelectorAll("[data-plan]").forEach((b) => (b.disabled = true));
  $("#trace").innerHTML = `<li class="node ghost">Agent is calling tools…</li>`;
  try {
    const body = { kind, prefs: state.prefs, notify: true };
    if (kind === "morning") {
      body.nightPlan = store.get("nightPlan");
      if ($("#simOn").checked) body.simulateNow = $("#simNow").value;
    }
    const p = await api("/api/plan", { method: "POST", body: JSON.stringify(body) });
    if (kind === "night") store.set("nightPlan", p);
    state.lastPlan = p;
    renderPlan(p);
    if (p.alert) { const list = store.get("alerts") ?? []; list.unshift({ ...p.alert, created_at: new Date().toISOString() }); store.set("alerts", list.slice(0, 20)); }
    loadAlerts();
    $("#plan").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { banner(`Planning failed: ${e.message}`); }
  finally { document.querySelectorAll("[data-plan]").forEach((b) => (b.disabled = false)); }
}
document.querySelectorAll("[data-plan]").forEach((b) => b.addEventListener("click", () => plan(b.dataset.plan)));

const riskClass = (r) => (r < 0.1 ? "risk-low" : r < 0.3 ? "risk-mid" : "risk-high");
const MODE_ICON = { drive: "CAR", bart: "BART", caltrain: "CT" };
const STEP_ICON = { tool: "⚙︎", think: "✦", decide: "✓", warn: "!" };

function timeline(o) {
  const total = Math.max(1, o.arriveMin - o.departMin);
  return `<div class="timeline">${o.legs.map((l) => {
    const w = Math.max(0, l.endMin - l.startMin);
    return w < 0.5 ? "" : `<div class="leg-${l.kind}" style="flex:${w}" title="${esc(l.label)} · ${Math.round(w)} min">${w / total > 0.18 ? esc(l.label) : ""}</div>`;
  }).join("")}</div>
  <div class="legend">${o.legs.filter((l) => l.endMin - l.startMin >= 0.5).map((l) => `<span>${esc(l.label)} · ${Math.round(l.endMin - l.startMin)}m</span>`).join("")}</div>`;
}

function renderPlan(p) {
  const o = p.recommended;
  const when = p.kind === "night" ? `Night-before plan for ${p.targetDate}` : `Morning re-plan${p.simulatedNow ? ` (simulated ${p.simulatedNow})` : ""}`;
  $("#planMeta").textContent = `${when} · ${new Date(p.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const rec = $("#rec");
  rec.classList.remove("empty");
  rec.innerHTML = `
    <span class="tag">Recommended · ${esc(o.dataQuality)}</span>
    <h3>${esc(o.label)}</h3>
    <p class="summary">${esc(p.summary)}</p>
    <div class="stats">
      <div class="stat"><b>${fmt(o.departMin)}</b><span>Leave</span></div>
      <div class="stat"><b>${fmt(o.arriveMin)}</b><span>Arrive (±${Math.round(o.sdMin)}m)</span></div>
      <div class="stat"><b class="${riskClass(o.lateRisk)}">${Math.round(o.lateRisk * 100)}%</b><span>Late risk</span></div>
      <div class="stat"><b>$${o.costUsd.toFixed(2)}</b><span>Est. cost</span></div>
    </div>
    ${timeline(o)}
    <ul class="notes">${o.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    <div class="rec-actions"><button class="btn btn-dark btn-sm" data-took="${o.mode}">I’ll take this</button></div>`;
  $("#alts").innerHTML = p.alternatives.map((a) => `
    <div class="card alt">
      <div class="icon icon-${a.mode}">${MODE_ICON[a.mode]}</div>
      <div><h4>${esc(a.label)}</h4><p>${a.durationMin} min · arrive ${fmt(a.arriveMin)} · <span class="${riskClass(a.lateRisk)}">${Math.round(a.lateRisk * 100)}% late</span> · $${a.costUsd.toFixed(2)}</p></div>
      <div class="delta">${a.arriveMin - o.arriveMin >= 0 ? "+" : ""}${a.arriveMin - o.arriveMin} min<br /><button class="btn btn-ghost btn-sm" data-took="${a.mode}">I took this</button></div>
    </div>`).join("");
  document.querySelectorAll("[data-took]").forEach((b) => b.addEventListener("click", () => feedback(b.dataset.took)));

  const al = $("#alert");
  al.hidden = !p.alert;
  if (p.alert) { al.className = `alert ${p.alert.severity}`; al.innerHTML = `<h4>${esc(p.alert.title)}</h4><p>${esc(p.alert.message)}</p>`; }
  $("#warnings").innerHTML = p.warnings.map((w) => `<li>${esc(w)}</li>`).join("");

  $("#agentName").textContent = p.agent === "deterministic" ? "Deterministic planner (no LLM key)" : p.agent.replace("nvidia:", "NVIDIA NIM · ");
  $("#trace").innerHTML = p.trace.map((t, i) => `<li class="node ${t.kind}" style="animation-delay:${i * 60}ms"><div class="ic">${STEP_ICON[t.kind]}</div><div><b>${esc(t.title)}</b><span>${esc(t.detail)}</span></div></li>`).join("");
  $("#reasoning").innerHTML = p.reasoning.map((r) => `<li>${esc(r)}</li>`).join("");
  renderSources(p.sources);
}

function renderSources(sources) {
  $("#sourceGrid").innerHTML = sources.map((s) => `
    <div class="card source"><h4>${esc(s.name)} <span class="status s-${s.status}">${s.status}</span></h4><p>${esc(s.note || (s.status === "live" ? "Fresh data used in this plan." : ""))}</p></div>`).join("");
  for (const s of sources) {
    const chip = document.querySelector(`.chip[data-src="${CSS.escape(s.name)}"]`);
    if (chip) chip.dataset.status = s.status;
  }
}

async function feedback(mode) {
  try {
    const r = await api("/api/feedback", { method: "POST", body: JSON.stringify({ chosenMode: mode, planId: state.lastPlan?.id, prefs: state.prefs }) });
    state.prefs = r.prefs; store.set("prefs", r.prefs); fillForm(r.prefs);
    banner(`Noted — you chose ${mode}. Future plans will lean that way.`);
  } catch (e) { banner(e.message); }
}

async function loadAlerts() {
  let alerts = [];
  if (state.token) { try { alerts = (await api("/api/alerts")).alerts; } catch {} } else alerts = store.get("alerts") ?? [];
  $("#alertList").innerHTML = alerts.length
    ? alerts.map((a) => `<li class="item"><b>${esc(a.title)}</b> — ${esc(a.message)}<br /><time>${new Date(a.created_at).toLocaleString()}</time></li>`).join("")
    : `<li class="muted">No alerts yet.</li>`;
}

// ---------- boot ----------
(async function boot() {
  try {
    state.config = await api("/api/config");
    const f = state.config.features;
    $("#agentPill").textContent = f.llm ? `Agent: ${f.model}` : "Agent: deterministic (add NVIDIA key)";
    $("#flowModel").textContent = f.llm ? f.model : "deterministic planner";
    const h = new Date().getHours();
    $("#simOn").checked = h < 5 || h >= 10; // outside the morning window, simulate one
    fillStationLists();
    await initAuth();
    await loadPrefs();
    renderAuth();
    loadAlerts();
    const last = store.get("nightPlan");
    if (last) renderPlan(last);
  } catch (e) { banner(`Couldn't reach the API: ${e.message}`); }
})();
