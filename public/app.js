// Commute Agent UI — vanilla JS, no build step.
const $ = (s) => document.querySelector(s);
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

// ---------- prefs ----------
const get = (o, path) => path.split(".").reduce((a, k) => a?.[k], o);
const set = (o, path, v) => { const ks = path.split("."); let a = o; ks.slice(0, -1).forEach((k) => (a = a[k] ??= {})); a[ks.at(-1)] = v; };

function fillForm(p) {
  const f = $("#prefsForm");
  f.origin.value = p.origin.label; f.destination.value = p.destination.label;
  for (const el of f.elements) {
    if (!el.name || el.name === "origin" || el.name === "destination") continue;
    const v = get(p, el.name);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
  }
  const b = p.modeBias || {};
  const learned = Object.entries(b).filter(([, v]) => v).map(([k, v]) => `${k} ${v < 0 ? "preferred" : "less preferred"} (${v > 0 ? "+" : ""}${v})`);
  $("#bias").textContent = learned.length ? `Learned from your choices: ${learned.join(" · ")}` : "Tell it which option you took — it learns your mode preference.";
}

async function readForm() {
  const f = $("#prefsForm");
  const p = structuredClone(state.prefs);
  for (const el of f.elements) {
    if (!el.name || el.name === "origin" || el.name === "destination") continue;
    const v = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
    set(p, el.name, v);
  }
  for (const k of ["origin", "destination"]) {
    const q = f[k].value.trim();
    if (q && q !== p[k].label) {
      const { place } = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!place) throw new Error(`Couldn't find “${q}”`);
      p[k] = place;
    }
  }
  return p;
}

async function loadPrefs() {
  const local = store.get("prefs");
  const r = await api("/api/prefs");
  state.prefs = r.signedIn ? r.prefs : local ?? r.prefs;
  fillForm(state.prefs);
}

$("#prefsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  try {
    const p = await readForm();
    const r = await api("/api/prefs", { method: "PUT", body: JSON.stringify({ prefs: p }) });
    state.prefs = r.prefs; store.set("prefs", r.prefs); fillForm(r.prefs);
    banner(r.saved ? "Preferences saved to your account." : "Preferences saved in this browser.");
  } catch (err) { banner(err.message); } finally { btn.disabled = false; }
});

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
    await initAuth();
    await loadPrefs();
    renderAuth();
    loadAlerts();
    const last = store.get("nightPlan");
    if (last) renderPlan(last);
  } catch (e) { banner(`Couldn't reach the API: ${e.message}`); }
})();
