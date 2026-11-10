import type { Env } from "../env.ts";
import type { Place, Prefs, SourceResult } from "../types.ts";
import { cachedSource, fetchJson, off } from "../http.ts";

/** Optional live door-to-door ETA from Mapbox's traffic-aware driving profile. */
export async function liveRoute(env: Env, prefs: Prefs): Promise<SourceResult<{ minutes: number }>> {
  const src = "Live drive ETA (Mapbox)";
  if (!env.MAPBOX_TOKEN) return off(src, "No MAPBOX_TOKEN — drive time derived from speeds + profile");
  const { origin: o, destination: d } = prefs;
  const key = `route:${o.lat.toFixed(3)},${o.lon.toFixed(3)}:${d.lat.toFixed(3)},${d.lon.toFixed(3)}`;
  return cachedSource(env, key, 180, src, async () => {
    const j = await fetchJson(
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${o.lon},${o.lat};${d.lon},${d.lat}?overview=false&access_token=${env.MAPBOX_TOKEN}`,
    );
    const s = Number(j?.routes?.[0]?.duration);
    if (!(s > 0)) throw new Error("no route");
    return { minutes: s / 60 };
  });
}

export async function geocode(env: Env, q: string): Promise<Place | null> {
  if (env.MAPBOX_TOKEN) {
    const j = await fetchJson(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=us&limit=1&access_token=${env.MAPBOX_TOKEN}`,
    );
    const f = j?.features?.[0];
    return f ? { label: f.place_name, lon: f.center[0], lat: f.center[1] } : null;
  }
  // Nominatim usage policy: ≤1 req/s and an identifying User-Agent. Fine for saving prefs, not for bulk use.
  const j = await fetchJson(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`,
    { headers: { "User-Agent": "agentic-commute-planner/0.1" } },
  );
  const f = j?.[0];
  return f ? { label: f.display_name, lat: Number(f.lat), lon: Number(f.lon) } : null;
}
