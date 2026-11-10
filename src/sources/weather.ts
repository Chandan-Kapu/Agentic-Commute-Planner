import type { Env } from "../env.ts";
import type { Prefs, SourceResult, WeatherHour } from "../types.ts";
import { cachedSource, fetchJson } from "../http.ts";

/** Open-Meteo hourly forecast (no key). Note: commercial use needs an Open-Meteo plan; NWS is a free alternative. */
export async function weather(env: Env, prefs: Prefs, tz: string): Promise<SourceResult<{ hours: WeatherHour[] }>> {
  const { lat, lon } = prefs.origin;
  const key = `wx:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return cachedSource(env, key, 900, "Weather (Open-Meteo)", async () => {
    const j = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code&timezone=${encodeURIComponent(tz)}&forecast_days=2`,
    );
    const h = j?.hourly ?? {};
    const hours: WeatherHour[] = (h.time ?? []).map((t: string, i: number) => ({
      date: t.slice(0, 10),
      hour: Number(t.slice(11, 13)),
      tempC: Number(h.temperature_2m?.[i] ?? 0),
      precipProb: Number(h.precipitation_probability?.[i] ?? 0),
      precipMm: Number(h.precipitation?.[i] ?? 0),
      code: Number(h.weather_code?.[i] ?? 0),
    }));
    return { hours };
  });
}
