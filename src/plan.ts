import type { Env } from "./env.ts";
import { tzOf } from "./env.ts";
import type { PlanResult, Prefs } from "./types.ts";
import { gatherSnapshot } from "./sources/index.ts";
import { buildOptions } from "./planner.ts";
import { deterministicAgent, runAgent } from "./agent.ts";
import { computeAlert } from "./alerts.ts";
import { hm, localParts, nextWorkday } from "./time.ts";

export interface PlanRequest {
  kind: "night" | "morning";
  prefs: Prefs;
  nightPlan?: PlanResult | null; // for the morning comparison
  simulateNow?: string; // "HH:MM" — pretend it's this time this morning (demo/testing)
  useLlm?: boolean;
  now?: Date;
}

export async function makePlan(env: Env, req: PlanRequest): Promise<PlanResult> {
  const tz = tzOf(env);
  const now = localParts(req.now ?? new Date(), tz);
  const simulated = req.kind === "morning" && !!req.simulateNow && /^\d{1,2}:\d{2}$/.test(req.simulateNow);
  const nowMin = simulated ? hm(req.simulateNow!) : now.minutes;
  // Night plans target the next workday. A simulated morning after today's window means "tomorrow morning".
  const pastWindow = now.minutes > hm(req.prefs.latestDepart);
  const targetDate = req.kind === "night" || (simulated && pastWindow) ? nextWorkday(now.date, req.prefs.workdays) : now.date;

  const snap = await gatherSnapshot(env, req.prefs, tz, nowMin);
  const ctx = { prefs: req.prefs, snap, targetDate, nowMin: req.kind === "morning" ? nowMin : null, simulated };
  const plan = buildOptions(ctx);
  const night = req.kind === "morning" && req.nightPlan?.targetDate === targetDate ? req.nightPlan : null;
  if (night) {
    // Hysteresis: keep last night's mode unless the new best is clearly better — avoids flip-flopping alerts.
    const same = plan.options.find((o) => o.id === night.recommended.id);
    if (same && same !== plan.recommended && same.score - plan.recommended.score < 5) {
      plan.options = [same, ...plan.options.filter((o) => o !== same)];
      plan.recommended = same;
    }
  }
  const agent = req.useLlm === false ? deterministicAgent(req.prefs, snap, plan) : await runAgent(env, req.prefs, snap, plan, req.kind);

  const sources = [snap.traffic, snap.speeds, snap.route, snap.bart, snap.caltrain, snap.ace, snap.weather]
    .map((s) => ({ name: s.source, status: s.status, note: s.note }));
  const warnings = [...plan.warnings];
  if (simulated) warnings.push(`Simulating ${req.simulateNow} — live traffic applied, live train times ignored.`);
  if (sources.some((s) => s.status === "mock")) warnings.push("Some sources are demo data (missing API keys) — don't rely on this plan yet.");
  if (sources.some((s) => s.status === "error")) warnings.push("Some live sources failed; those factors use typical schedules/profiles.");

  const result: PlanResult = {
    kind: req.kind,
    targetDate,
    generatedAt: new Date().toISOString(),
    simulatedNow: simulated ? req.simulateNow : undefined,
    agent: agent.agent,
    recommended: agent.recommended,
    alternatives: plan.options.filter((o) => o.id !== agent.recommended.id),
    summary: agent.summary,
    reasoning: agent.reasoning,
    trace: agent.trace,
    sources,
    warnings,
    alert: null,
  };
  if (req.kind === "morning") {
    result.alert = computeAlert(night, result, req.prefs, snap);
  }
  return result;
}
