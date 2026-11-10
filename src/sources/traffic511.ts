import type { Env } from "../env.ts";
import type { Incident, Prefs, SourceResult } from "../types.ts";
import { cachedSource, fetchJson, mock } from "../http.ts";

const SEVERITY_PENALTY: Record<string, number> = { Major: 15, Severe: 15, Moderate: 7, Minor: 3, Unknown: 4 };

/** "US-101 N" → { road: "101", dir: "north" } */
export function parseCorridor(c: string) {
  const road = (c.match(/(\d{1,3})/) ?? [])[1] ?? "";
  const d = (c.match(/\b([NSEW])\b|north|south|east|west/i)?.[0] ?? "").toLowerCase();
  const dir = ({ n: "north", s: "south", e: "east", w: "west" } as Record<string, string>)[d] ?? d;
  return { road, dir };
}

function inBox(coords: any, prefs: Prefs): boolean {
  const pt = Array.isArray(coords?.[0]) ? coords[0] : coords;
  if (!Array.isArray(pt) || pt.length < 2) return true; // no geometry → don't drop it
  const [lon, lat] = pt;
  const pad = 0.12;
  const { origin: o, destination: d } = prefs;
  return lat >= Math.min(o.lat, d.lat) - pad && lat <= Math.max(o.lat, d.lat) + pad &&
    lon >= Math.min(o.lon, d.lon) - pad && lon <= Math.max(o.lon, d.lon) + pad;
}

export async function trafficEvents(env: Env, prefs: Prefs): Promise<SourceResult<{ incidents: Incident[] }>> {
  const src = "511.org traffic events";
  // Corridor may list several freeways, e.g. "I-580 W, I-680 S".
  const corridors = prefs.drive.corridor.split(/[,;/+]|\bthen\b/i).map((c) => parseCorridor(c.trim())).filter((c) => c.road);
  if (!env.API_511_KEY) {
    return mock(src, {
      incidents: [{
        headline: `Stalled vehicle on ${prefs.drive.corridor.split(",")[0].trim()} (sample incident)`,
        severity: "Moderate", road: prefs.drive.corridor.split(",")[0].trim(), type: "INCIDENT", penaltyMin: 7,
      }],
    }, "No API_511_KEY — showing a sample incident");
  }
  // Cached 5 min: 511 default quota is ~60 requests/hour per key.
  return cachedSource(env, `511:events`, 300, src, async () => {
    const j = await fetchJson(`https://api.511.org/traffic/events?api_key=${env.API_511_KEY}&format=json&status=ACTIVE`);
    const out: Incident[] = [];
    for (const e of j?.events ?? []) {
      const roads: any[] = e.roads ?? [];
      const hit = roads.find((r) => corridors.some(({ road, dir }) => road && String(r.name ?? "").includes(road) &&
        (!dir || String(r.direction ?? "").toLowerCase().includes(dir) || !r.direction)));
      if (!hit || !inBox(e.geography?.coordinates, prefs)) continue;
      out.push({
        headline: String(e.headline ?? "Traffic event"),
        severity: String(e.severity ?? "Unknown"),
        road: `${hit.name ?? ""} ${hit.direction ?? ""}`.trim(),
        type: String(e.event_type ?? ""),
        penaltyMin: SEVERITY_PENALTY[e.severity] ?? 4,
      });
    }
    return { incidents: out.slice(0, 10) };
  }).then((r) => r);
}
