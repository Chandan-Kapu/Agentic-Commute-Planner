// Agent layer: an NVIDIA NIM model (OpenAI-compatible chat completions with tool calling)
// inspects live data via tools and picks among the planner's candidates. If the key is
// missing, the call fails, or the model returns an invalid choice, we fall back to the
// deterministic recommendation — the plan never depends on the LLM being right.
import type { Env } from "./env.ts";
import type { Option, Prefs, Snapshot, TraceStep } from "./types.ts";
import type { PlannerOutput } from "./planner.ts";
import { describe } from "./planner.ts";
import { fmt } from "./time.ts";

export interface AgentOutput {
  agent: string;
  recommended: Option;
  summary: string;
  reasoning: string[];
  trace: TraceStep[];
}

const TOOLS = [
  { name: "get_preferences", description: "The commuter's saved preferences: arrival target, modes, weights, learned mode bias." },
  { name: "get_traffic_incidents", description: "Active 511.org traffic incidents on the driving corridor." },
  { name: "get_freeway_speeds", description: "Current Caltrans PeMS corridor speed vs free-flow." },
  { name: "get_transit_departures", description: "Real-time (or timetable) departures for BART, Caltrain or ACE at the commuter's boarding station.",
    params: { system: { type: "string", enum: ["bart", "caltrain", "ace"] } } },
  { name: "get_weather", description: "Hourly precipitation/temperature forecast for the commute window." },
  { name: "evaluate_options", description: "Scored commute options from the deterministic planner (ids, departure, arrival, late risk, cost)." },
].map((t) => ({
  type: "function",
  function: {
    name: t.name, description: t.description,
    parameters: { type: "object", properties: (t as any).params ?? {}, required: (t as any).params ? Object.keys((t as any).params) : [] },
  },
}));

function compactOption(o: Option) {
  return { id: o.id, label: o.label, depart: fmt(o.departMin), arrive: fmt(o.arriveMin), minutes: o.durationMin,
    lateRiskPct: Math.round(o.lateRisk * 100), costUsd: o.costUsd, score: o.score, data: o.dataQuality, notes: o.notes };
}

function runTool(name: string, args: any, prefs: Prefs, snap: Snapshot, plan: PlannerOutput, nowEpoch: number): { out: unknown; title: string; detail: string } {
  switch (name) {
    case "get_preferences": {
      const { arriveBy, arrivalMode, earliestDepart, latestDepart, bufferMin, weights, modeBias } = prefs;
      return { out: { arriveBy, arrivalMode, earliestDepart, latestDepart, bufferMin, weights, modeBias,
        modes: { drive: prefs.drive.enabled, bart: prefs.bart.enabled, caltrain: prefs.caltrain.enabled, ace: !!prefs.ace?.enabled } },
        title: "Read preferences", detail: `Arrive ${arrivalMode === "by" ? "by " + arriveBy : "flexibly ~" + arriveBy}` };
    }
    case "get_traffic_incidents": {
      const inc = snap.traffic.data?.incidents ?? [];
      return { out: { status: snap.traffic.status, incidents: inc }, title: "511 traffic",
        detail: inc.length ? `${inc.length} on ${prefs.drive.corridor}: ${inc[0].headline}` : `No incidents on ${prefs.drive.corridor}` };
    }
    case "get_freeway_speeds": {
      const s = snap.speeds.data;
      return { out: { status: snap.speeds.status, ...s }, title: "PeMS speeds",
        detail: s ? `${s.corridor}: ${s.speedMph} mph (${s.ratio.toFixed(2)}× free-flow)` : "Unavailable" };
    }
    case "get_transit_departures": {
      const sys = (["caltrain", "ace"].includes(args?.system) ? args.system : "bart") as "bart" | "caltrain" | "ace";
      const deps = (snap[sys].data?.departures ?? []).slice(0, 6).map((d) => ({
        inMin: Math.round((d.epochMs - nowEpoch) / 60000), to: d.destination, delayMin: d.delayMin, line: d.line }));
      return { out: { status: snap[sys].status, departures: deps }, title: `${{ bart: "BART", caltrain: "Caltrain", ace: "ACE" }[sys]} departures`,
        detail: deps.length ? deps.slice(0, 3).map((d) => `${d.inMin}m`).join(", ") : snap[sys].note ?? "None",
        ...(sys === "ace" && !deps.length ? { out: { status: snap.ace.status, timetable: prefs.ace?.departures ?? [] } } : {}) };
    }
    case "get_weather": {
      const hrs = (snap.weather.data?.hours ?? []).filter((h) => h.hour >= 6 && h.hour <= 10).slice(0, 10);
      const wet = hrs.find((h) => h.precipProb >= 40);
      return { out: { status: snap.weather.status, hours: hrs }, title: "Weather",
        detail: snap.weather.status === "error" ? "Unavailable" : wet ? `Rain likely ~${wet.hour}:00 (${wet.precipProb}%)` : "Dry commute window" };
    }
    case "evaluate_options":
      return { out: { evaluatedCandidates: plan.evaluated, options: plan.options.map(compactOption) }, title: "Scored options",
        detail: `${plan.evaluated} candidates → ${plan.options.length} finalists` };
    default:
      return { out: { error: `unknown tool ${name}` }, title: `Unknown tool ${name}`, detail: "" };
  }
}

export function deterministicAgent(prefs: Prefs, snap: Snapshot, plan: PlannerOutput, note?: string): AgentOutput {
  const trace: TraceStep[] = [];
  for (const [name, args] of [["get_preferences"], ["get_traffic_incidents"], ["get_freeway_speeds"],
    ["get_transit_departures", { system: "bart" }], ["get_transit_departures", { system: "caltrain" }], ["get_transit_departures", { system: "ace" }], ["get_weather"], ["evaluate_options"]] as const) {
    const r = runTool(name, args, prefs, snap, plan, snap.nowEpoch);
    trace.push({ kind: "tool", title: r.title, detail: r.detail });
  }
  if (note) trace.push({ kind: "warn", title: "LLM fallback", detail: note });
  const rec = plan.recommended;
  const alt = plan.options.filter((o) => o.id !== rec.id);
  trace.push({ kind: "decide", title: "Recommend", detail: rec.label });
  return {
    agent: "deterministic",
    recommended: rec,
    summary: `${rec.label}. ${rec.durationMin} min door-to-door, arriving ${fmt(rec.arriveMin)} with a ${Math.round(rec.lateRisk * 100)}% chance of being late.`,
    reasoning: [describe(rec), ...alt.map((o) => `vs. ${describe(o)} (score +${(o.score - rec.score).toFixed(1)})`)],
    trace,
  };
}

const SYSTEM = `You are a Bay Area commute-planning agent. Use the tools to inspect live traffic, freeway speeds,
BART/Caltrain/ACE departures, weather and the user's preferences, then call evaluate_options.
You MUST choose one option id returned by evaluate_options — never invent times, durations or options.
Prefer the lowest score unless live evidence (e.g. a major incident, a delayed train, rain) or stated preferences justify another option; say why.
When finished, reply with ONLY a JSON object:
{"choice":"<option id>","summary":"<one or two sentences, plain English>","reasoning":["<short bullet>", "..."]}`;

export async function runAgent(env: Env, prefs: Prefs, snap: Snapshot, plan: PlannerOutput, kind: "night" | "morning"): Promise<AgentOutput> {
  if (!env.NVIDIA_API_KEY) return deterministicAgent(prefs, snap, plan);
  const models = [env.NVIDIA_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b", env.NVIDIA_FALLBACK_MODEL].filter(Boolean) as string[];
  let model = models[0];
  const base = (env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
  const trace: TraceStep[] = [];
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: kind === "night"
      ? "Plan tomorrow's commute (night-before plan). Live incidents may clear by morning; rely on typical traffic and schedules."
      : "Re-plan this morning's commute using live conditions. Flag anything that changed." },
  ];
  try {
    for (let step = 0; step < 8; step++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 25_000);
      let j: any;
      try {
        const r = await fetch(`${base}/chat/completions`, {
          method: "POST", signal: ac.signal,
          headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.2, max_tokens: 900 }),
        });
        if (!r.ok) {
          // Model not enabled for this account (404), overloaded (5xx/429): switch to the fallback model once.
          const next = models[models.indexOf(model) + 1];
          if (next && (r.status === 404 || r.status === 429 || r.status >= 500)) {
            trace.push({ kind: "warn", title: "Model fallback", detail: `${model} returned HTTP ${r.status}; switching to ${next}` });
            model = next;
            step--;
            continue;
          }
          throw new Error(`NVIDIA API HTTP ${r.status}`);
        }
        j = await r.json();
      } catch (e: any) {
        const next = models[models.indexOf(model) + 1];
        if (e?.name === "AbortError" && next) {
          trace.push({ kind: "warn", title: "Model fallback", detail: `${model} timed out; switching to ${next}` });
          model = next;
          continue;
        }
        throw e;
      } finally { clearTimeout(timer); }
      const msg = j?.choices?.[0]?.message;
      if (!msg) throw new Error("empty response");
      const calls: any[] = msg.tool_calls ?? [];
      if (calls.length) {
        messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
        for (const c of calls) {
          let args: any = {};
          try { args = JSON.parse(c.function?.arguments || "{}"); } catch {}
          const res = runTool(c.function?.name, args, prefs, snap, plan, snap.nowEpoch);
          trace.push({ kind: "tool", title: res.title, detail: res.detail });
          messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(res.out) });
        }
        continue;
      }
      const text = String(msg.content ?? "");
      if (msg.content && text.trim()) trace.push({ kind: "think", title: "Model reasoning", detail: text.slice(0, 280) });
      const parsed = JSON.parse((text.match(/\{[\s\S]*\}/) ?? ["{}"])[0]);
      const chosen = plan.options.find((o) => o.id === parsed.choice);
      if (!chosen) {
        return deterministicAgent(prefs, snap, plan, `Model chose "${parsed.choice}", which is not a valid option`);
      }
      if (!trace.some((t) => t.title === "Scored options")) {
        const r = runTool("evaluate_options", {}, prefs, snap, plan, snap.nowEpoch);
        trace.push({ kind: "tool", title: r.title, detail: r.detail });
      }
      trace.push({ kind: "decide", title: "Recommend", detail: chosen.label });
      return {
        agent: `nvidia:${model}`,
        recommended: chosen,
        summary: String(parsed.summary || describe(chosen)).slice(0, 600),
        reasoning: (Array.isArray(parsed.reasoning) ? parsed.reasoning : []).map(String).slice(0, 6),
        trace,
      };
    }
    return deterministicAgent(prefs, snap, plan, "Model did not finish within 8 steps");
  } catch (e: any) {
    return deterministicAgent(prefs, snap, plan, String(e?.message ?? e));
  }
}
