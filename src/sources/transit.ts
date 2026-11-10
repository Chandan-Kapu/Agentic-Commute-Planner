import type { Env } from "../env.ts";
import type { Departure, Prefs, SourceResult } from "../types.ts";
import { cachedSource, fetchJson, mock, off } from "../http.ts";

// BART's documented public demo key. Register your own at https://api.bart.gov for production.
const BART_PUBLIC_KEY = "MW9S-E7SL-26DU-VV8V";

export async function bartDepartures(env: Env, prefs: Prefs): Promise<SourceResult<{ departures: Departure[] }>> {
  const src = "BART real-time departures";
  const b = prefs.bart;
  if (!b.enabled) return off(src, "BART disabled in preferences");
  const st = encodeURIComponent(b.originStation);
  const heads = (b.lineHeads ?? []).map((h) => h.toUpperCase());
  // Prefer filtering by the train lines that reach your destination; fall back to a direction filter.
  const dirParam = heads.length ? "" : `&dir=${b.direction === "s" ? "s" : "n"}`;
  return cachedSource(env, `bart:${b.originStation}:${heads.join(",") || dirParam}`, 60, src, async () => {
    const key = env.BART_API_KEY || BART_PUBLIC_KEY;
    const fetchedAt = Date.now();
    const j = await fetchJson(`https://api.bart.gov/api/etd.aspx?cmd=etd&orig=${st}${dirParam}&key=${key}&json=y`);
    const deps: Departure[] = [];
    for (const e of j?.root?.station?.[0]?.etd ?? []) {
      if (heads.length && !heads.includes(String(e.abbreviation ?? "").toUpperCase())) continue;
      for (const est of e.estimate ?? []) {
        const mins = est.minutes === "Leaving" ? 0 : Number(est.minutes);
        if (!Number.isFinite(mins)) continue;
        deps.push({
          epochMs: fetchedAt + mins * 60_000,
          destination: String(e.destination ?? e.abbreviation ?? ""),
          delayMin: Math.round(Number(est.delay || 0) / 60),
          line: est.color,
        });
      }
    }
    deps.sort((a, b) => a.epochMs - b.epochMs);
    return { departures: deps };
  });
}

export async function caltrainDepartures(env: Env, prefs: Prefs, nowEpoch: number): Promise<SourceResult<{ departures: Departure[] }>> {
  const src = "Caltrain real-time (511.org)";
  const c = prefs.caltrain;
  if (!c.enabled) return off(src, "Caltrain disabled in preferences");
  if (!env.API_511_KEY) {
    const deps: Departure[] = [];
    for (let i = 0; i < 4; i++) {
      deps.push({ epochMs: nowEpoch + (7 + i * c.headwayMin) * 60_000, destination: c.destName, delayMin: i === 0 ? 3 : 0, line: i % 2 ? "Local" : "Limited" });
    }
    return mock(src, { departures: deps }, "No API_511_KEY — showing sample departures");
  }
  return cachedSource(env, `511:ct:${c.originStation}`, 90, src, async () => {
    const j = await fetchJson(
      `https://api.511.org/transit/StopMonitoring?api_key=${env.API_511_KEY}&agency=CT&stopCode=${encodeURIComponent(c.originStation)}&format=json`,
    );
    const smd = j?.ServiceDelivery?.StopMonitoringDelivery;
    const visits: any[] = (Array.isArray(smd) ? smd[0] : smd)?.MonitoredStopVisit ?? [];
    const deps: Departure[] = [];
    for (const v of visits) {
      const mvj = v?.MonitoredVehicleJourney ?? {};
      const call = mvj.MonitoredCall ?? {};
      const exp = call.ExpectedDepartureTime || call.ExpectedArrivalTime || call.AimedDepartureTime;
      const aim = call.AimedDepartureTime || call.AimedArrivalTime;
      const t = Date.parse(exp);
      if (!Number.isFinite(t)) continue;
      deps.push({
        epochMs: t,
        destination: String(mvj.DestinationName ?? ""),
        delayMin: aim ? Math.max(0, Math.round((t - Date.parse(aim)) / 60_000)) : 0,
        line: mvj.LineRef ? String(mvj.LineRef) : undefined,
      });
    }
    deps.sort((a, b) => a.epochMs - b.epochMs);
    return { departures: deps };
  });
}

const parseClock = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(t).trim());
  if (!m) return NaN;
  return ((Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(m[2]);
};

/** BART trip planner: ride minutes + which train lines (head stations) to board, for the "Your stations" form. */
export async function bartTrip(env: Env, orig: string, dest: string) {
  const ok = /^[A-Z0-9]{4}$/;
  if (!ok.test(orig) || !ok.test(dest) || orig === dest) throw new Error("bad stations");
  const key = env.BART_API_KEY || BART_PUBLIC_KEY;
  const j = await fetchJson(`https://api.bart.gov/api/sched.aspx?cmd=depart&orig=${orig}&dest=${dest}&date=today&time=8:00am&b=0&a=4&key=${key}&json=y`);
  const trips: any[] = j?.root?.schedule?.request?.trip ?? [];
  const mins: number[] = [];
  const heads = new Set<string>();
  let transfers = 0;
  for (const t of trips) {
    const tt = Number(t["@tripTime"]);
    const m = Number.isFinite(tt) && tt > 0 ? tt : parseClock(t["@destTimeMin"]) - parseClock(t["@origTimeMin"]);
    if (m > 0) mins.push(m);
    const legs: any[] = Array.isArray(t.leg) ? t.leg : t.leg ? [t.leg] : [];
    if (legs[0]?.["@trainHeadStation"]) heads.add(String(legs[0]["@trainHeadStation"]).toUpperCase());
    transfers = Math.max(transfers, legs.length - 1);
  }
  if (!mins.length) throw new Error("no trips");
  mins.sort((a, b) => a - b);
  return { minutes: mins[Math.floor(mins.length / 2)], heads: [...heads], transfers };
}
