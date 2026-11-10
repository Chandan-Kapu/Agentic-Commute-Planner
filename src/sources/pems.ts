import type { Env } from "../env.ts";
import type { Prefs, SourceResult } from "../types.ts";
import { cachedSource, fetchJson, mock } from "../http.ts";
import { profile } from "../planner.ts";

type Speed = { corridor: string; speedMph: number; freeFlowMph: number; ratio: number };

/**
 * Caltrans PeMS has no public real-time REST API (it needs an account and serves 5-minute
 * station files). So this reads PEMS_FEED_URL: a small JSON feed you produce from PeMS
 * (e.g. a scheduled job that aggregates station speeds per corridor), shaped as
 *   { "corridors": { "US-101 N": { "speedMph": 34, "freeFlowMph": 65 } } }
 */
export async function freewaySpeeds(env: Env, prefs: Prefs, nowMin: number): Promise<SourceResult<Speed>> {
  const src = "Caltrans PeMS speeds";
  const corridor = prefs.drive.corridor;
  if (!env.PEMS_FEED_URL) {
    const ff = 65;
    const speed = Math.round(ff / profile(nowMin));
    return mock(src, { corridor, speedMph: speed, freeFlowMph: ff, ratio: ff / speed },
      "No PEMS_FEED_URL — using a typical weekday speed profile");
  }
  return cachedSource(env, `pems:${corridor}`, 300, src, async () => {
    const j = await fetchJson(env.PEMS_FEED_URL!);
    const c = j?.corridors?.[corridor] ?? j;
    const speed = Number(c?.speedMph);
    const ff = Number(c?.freeFlowMph ?? 65);
    if (!(speed > 0)) throw new Error(`no speed for ${corridor}`);
    return { corridor, speedMph: speed, freeFlowMph: ff, ratio: Math.min(4, Math.max(1, ff / speed)) };
  });
}
