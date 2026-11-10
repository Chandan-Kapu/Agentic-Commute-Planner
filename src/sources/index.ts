import type { Env } from "../env.ts";
import type { Prefs, Snapshot } from "../types.ts";
import { trafficEvents } from "./traffic511.ts";
import { freewaySpeeds } from "./pems.ts";
import { bartDepartures, caltrainDepartures } from "./transit.ts";
import { weather } from "./weather.ts";
import { liveRoute } from "./route.ts";

/** Fetch every source in parallel; each one degrades independently (error/mock/off) instead of failing the plan. */
export async function gatherSnapshot(env: Env, prefs: Prefs, tz: string, nowMin: number): Promise<Snapshot> {
  const nowEpoch = Date.now();
  const [traffic, speeds, route, bart, caltrain, wx] = await Promise.all([
    trafficEvents(env, prefs),
    freewaySpeeds(env, prefs, nowMin),
    liveRoute(env, prefs),
    bartDepartures(env, prefs),
    caltrainDepartures(env, prefs, nowEpoch),
    weather(env, prefs, tz),
  ]);
  return { nowEpoch, traffic, speeds, route, bart, caltrain, weather: wx };
}
