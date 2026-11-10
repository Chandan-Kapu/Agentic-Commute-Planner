// Deterministic planner: generates and scores every (mode × departure time) candidate.
// The LLM explains and chooses *among these*; it never invents times or durations.
import type { Departure, Leg, Mode, Option, Prefs, Snapshot, TransitMode, TransitPrefs } from "./types.ts";
import { fmt, hm } from "./time.ts";

function erf(x: number) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Typical weekday congestion multiplier vs free-flow (AM peak ~8:00, PM peak ~17:30). */
export function profile(min: number) {
  const g = (c: number, w: number, a: number) => a * Math.exp(-(((min - c) / w) ** 2));
  return 1 + g(480, 55, 0.55) + g(1050, 70, 0.6);
}

export interface PlanContext {
  prefs: Prefs;
  snap: Snapshot;
  targetDate: string;
  /** Local minutes-of-day "now" when planning for today (morning); null for a future day (night-before). */
  nowMin: number | null;
  /** True when nowMin is a simulated time — live departure lists are then ignored. */
  simulated?: boolean;
}

export interface PlannerOutput {
  options: Option[]; // best per mode (+ "wait" variant), sorted by score
  recommended: Option;
  evaluated: number;
  liveRatio: number | null;
  warnings: string[];
}

function liveRatio(ctx: PlanContext): number | null {
  const { snap, prefs } = ctx;
  if (snap.route.status === "live" && snap.route.data) return snap.route.data.minutes / prefs.drive.baselineMin;
  if ((snap.speeds.status === "live" || snap.speeds.status === "mock") && snap.speeds.data) return snap.speeds.data.ratio;
  return null;
}

function trafficMult(t: number, ctx: PlanContext, ratio: number | null) {
  const p = profile(t);
  if (ctx.nowMin == null || ratio == null) return p;
  // Blend today's anomaly (live vs typical-for-now) into the forecast, fading over ~45 min of lead time.
  const lead = Math.max(0, t - ctx.nowMin);
  const anomaly = ratio / profile(ctx.nowMin);
  return Math.max(0.9, p * (1 + (anomaly - 1) * Math.exp(-lead / 45)));
}

function incidentPenalty(t: number, ctx: PlanContext) {
  const inc = ctx.snap.traffic.data?.incidents ?? [];
  let total = 0;
  for (const i of inc) {
    const planned = /construction|closure/i.test(i.type);
    if (ctx.nowMin == null) total += planned ? i.penaltyMin * 0.5 : 0; // can't predict tomorrow's crashes
    else total += i.penaltyMin * Math.exp(-Math.max(0, t - ctx.nowMin) / 60);
  }
  return total;
}

function rainAt(t: number, ctx: PlanContext): 0 | 1 | 2 {
  const h = ctx.snap.weather.data?.hours.find((x) => x.date === ctx.targetDate && x.hour === Math.floor(t / 60));
  if (!h) return 0;
  if (h.precipMm >= 1 || h.precipProb >= 70) return 2;
  if (h.precipMm >= 0.2 || h.precipProb >= 40) return 1;
  return 0;
}

function liveDeps(mode: TransitMode, ctx: PlanContext): number[] {
  if (ctx.nowMin == null || ctx.simulated) return [];
  const src = ctx.snap[mode];
  if (src.status !== "live" && src.status !== "mock") return [];
  const now = ctx.nowMin;
  return (src.data?.departures ?? []).map((d: Departure) => now + (d.epochMs - ctx.snap.nowEpoch) / 60_000).filter((m) => m >= now - 1);
}

const SYSTEM_NAME: Record<TransitMode, string> = { bart: "BART", caltrain: "Caltrain", ace: "ACE" };

function nextTrain(at: number, tp: TransitPrefs, live: number[]): { dep: number; next: number; live: boolean } | null {
  const horizon = live.length ? live[live.length - 1] : -Infinity;
  if (at <= horizon) {
    const i = live.findIndex((m) => m >= at);
    if (i >= 0) return { dep: live[i], next: live[i + 1] ?? live[i] + tp.headwayMin, live: true };
  }
  const table = (tp.departures ?? []).filter((t) => /^\d{1,2}:\d{2}$/.test(t)).map(hm).sort((a, b) => a - b);
  if (table.length) {
    const i = table.findIndex((m) => m >= at);
    if (i < 0) return null; // missed the last train
    // Missing the last train is costly: model the "next" option as ~2 hours later (i.e. you'd drive instead).
    return { dep: table[i], next: table[i + 1] ?? table[i] + 120, live: false };
  }
  const anchor = hm(tp.scheduleAnchor);
  const k = Math.ceil((at - anchor) / tp.headwayMin);
  const dep = anchor + k * tp.headwayMin;
  return { dep, next: dep + tp.headwayMin, live: false };
}

interface Raw { mode: Mode; depart: number; arrive: number; sd: number; cost: number; legs: Leg[]; notes: string[]; quality: Option["dataQuality"] }

function score(r: Raw, ctx: PlanContext) {
  const { prefs: p } = ctx;
  const w = p.weights;
  const target = hm(p.arriveBy);
  const travel = r.arrive - r.depart;
  const lateRisk = 1 - phi((target - r.arrive) / Math.max(1, r.sd));
  let s = w.time * travel + w.cost * r.cost + (p.modeBias[r.mode] ?? 0);
  if (p.arrivalMode === "by") {
    s += w.reliability * lateRisk * 100 + w.early * Math.max(0, target - p.bufferMin - r.arrive);
  } else {
    s += 0.25 * Math.max(0, r.arrive - target); // flexible: mild cost for arriving later
  }
  return { s, lateRisk };
}

function toOption(id: string, label: string, r: Raw, ctx: PlanContext): Option {
  const { s, lateRisk } = score(r, ctx);
  return {
    id, mode: r.mode, label,
    departMin: Math.round(r.depart), arriveMin: Math.round(r.arrive),
    durationMin: Math.round(r.arrive - r.depart), sdMin: Math.round(r.sd * 10) / 10,
    lateRisk: Math.round(lateRisk * 100) / 100, costUsd: Math.round(r.cost * 100) / 100,
    score: Math.round(s * 10) / 10, legs: r.legs, notes: r.notes, dataQuality: r.quality,
  };
}

export function buildOptions(ctx: PlanContext): PlannerOutput {
  const { prefs: p } = ctx;
  const ratio = liveRatio(ctx);
  const warnings: string[] = [];
  let start = hm(p.earliestDepart);
  let end = hm(p.latestDepart);
  if (ctx.nowMin != null) {
    start = Math.max(start, Math.ceil(ctx.nowMin / 5) * 5);
    if (start > end) {
      end = start + 90;
      warnings.push(`It is past your latest departure (${p.latestDepart}); planning from now instead.`);
    }
  }
  const isLive = ctx.nowMin != null && !ctx.simulated;
  const all: Record<Mode, { o: Option; raw: Raw }[]> = { drive: [], bart: [], caltrain: [], ace: [] };
  let evaluated = 0;

  for (let d = start; d <= end; d += 5) {
    const m = trafficMult(d, ctx, ratio);
    const rain = rainAt(d, ctx);
    const wf = rain === 2 ? 1.15 : rain === 1 ? 1.07 : 1;

    if (p.drive.enabled) {
      const inc = incidentPenalty(d, ctx);
      const dur = p.drive.baselineMin * m * wf + inc;
      const sd = dur * (0.07 + 0.12 * (m - 1)) + (rain ? 4 : 0) + inc * 0.4;
      const notes = [`Traffic ${m.toFixed(2)}× free-flow`];
      if (inc > 1) notes.push(`+${Math.round(inc)} min for incidents`);
      if (rain) notes.push("Rain slows traffic");
      const raw: Raw = {
        mode: "drive", depart: d, arrive: d + dur, sd,
        cost: p.drive.miles * p.drive.costPerMile + p.drive.tollUsd + p.drive.parkingUsd,
        legs: [{ kind: "drive", label: `Drive via ${p.drive.corridor}`, startMin: d, endMin: d + dur }],
        notes, quality: isLive && ratio != null ? "live" : "forecast",
      };
      all.drive.push({ o: toOption("drive", `Leave ${fmt(d)} and drive`, raw, ctx), raw });
      evaluated++;
    }

    for (const mode of ["bart", "caltrain", "ace"] as const) {
      const tp = p[mode];
      if (!tp?.enabled) continue;
      const access = tp.driveToStationMin * (1 + (m - 1) * 0.35) * wf;
      const atPlatform = d + access + tp.parkingBufferMin;
      const train = nextTrain(atPlatform, tp, liveDeps(mode, ctx));
      if (!train) continue;
      const egress = tp.egressMin + (rain ? 2 : 0);
      const arrive = train.dep + tp.rideMin + egress;
      const slack = train.dep - atPlatform;
      const pMiss = 1 - phi(slack / (1.5 + access * 0.08));
      const gap = train.next - train.dep;
      const sd = Math.sqrt(2.5 ** 2 + pMiss * (1 - pMiss) * gap ** 2);
      const sys = SYSTEM_NAME[mode];
      const raw: Raw = {
        mode, depart: d, arrive: arrive + pMiss * gap, sd,
        cost: tp.fareUsd + tp.parkingUsd + (tp.driveToStationMin / 60) * 30 * p.drive.costPerMile,
        legs: [
          { kind: "drive", label: `Drive to ${tp.originName}`, startMin: d, endMin: d + access },
          { kind: "park", label: "Park + walk to platform", startMin: d + access, endMin: atPlatform },
          { kind: "wait", label: "Wait on platform", startMin: atPlatform, endMin: train.dep },
          { kind: "ride", label: `${sys} ${fmt(train.dep)} → ${tp.destName}`, startMin: train.dep, endMin: train.dep + tp.rideMin },
          { kind: "walk", label: "Walk to destination", startMin: train.dep + tp.rideMin, endMin: arrive },
        ],
        notes: [
          `${train.live ? "Live" : "Scheduled"} ${sys} departure ${fmt(train.dep)}`,
          ...(pMiss > 0.15 ? [`${Math.round(pMiss * 100)}% chance to miss it (${Math.round(slack)} min slack)`] : []),
        ],
        quality: train.live ? "live" : isLive ? "fallback" : "forecast",
      };
      const label = mode === "bart" ? `Drive to ${tp.originName} BART` : `${sys} from ${tp.originName}`;
      all[mode].push({ o: toOption(mode, label, raw, ctx), raw });
      evaluated++;
    }
  }

  const best = (xs: { o: Option }[]) => xs.reduce<Option | null>((b, x) => (!b || x.o.score < b.score ? x.o : b), null);
  const options: Option[] = [];
  for (const mode of ["drive", "bart", "caltrain", "ace"] as const) {
    const b = best(all[mode]);
    if (b) options.push(b);
  }

  // "Wait it out": a later drive that saves meaningful time in traffic while staying (mostly) on time.
  const bestDrive = options.find((o) => o.mode === "drive");
  if (bestDrive) {
    const later = all.drive
      .map((x) => x.o)
      .filter((o) => o.departMin >= bestDrive.departMin + 20 && (p.arrivalMode === "flexible" || o.lateRisk < 0.25))
      .sort((a, b) => a.durationMin - b.durationMin)[0];
    if (later && bestDrive.durationMin - later.durationMin >= 8) {
      options.push({ ...later, id: "drive_wait", label: `Wait until ${fmt(later.departMin)}, then drive`,
        notes: [`${bestDrive.durationMin - later.durationMin} min less in traffic`, ...later.notes] });
    }
  }

  options.sort((a, b) => a.score - b.score);
  if (!options.length) throw new Error("No modes enabled — enable at least one of drive, BART, Caltrain.");
  return { options, recommended: options[0], evaluated, liveRatio: ratio, warnings };
}

export function describe(o: Option): string {
  const risk = Math.round(o.lateRisk * 100);
  return `${o.label}: ${o.durationMin} min door-to-door, arrive ${fmt(o.arriveMin)}, ${risk}% late risk, $${o.costUsd.toFixed(2)}`;
}
