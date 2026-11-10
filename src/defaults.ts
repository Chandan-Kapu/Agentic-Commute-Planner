import type { Prefs } from "./types.ts";

// Demo commute: Willow Glen (San Jose) → SoMa (SF). Every value is user-editable.
// Station codes: BART uses abbreviations (api.bart.gov); Caltrain uses 511 stop codes —
// verify yours at https://511.org/open-data/transit (GTFS stops for agency CT).
export const DEFAULT_PREFS: Prefs = {
  origin: { label: "Willow Glen, San Jose, CA", lat: 37.3083, lon: -121.8996 },
  destination: { label: "4th & King, San Francisco, CA", lat: 37.7766, lon: -122.3947 },
  arriveBy: "09:00",
  arrivalMode: "by",
  earliestDepart: "06:30",
  latestDepart: "08:45",
  workdays: [1, 2, 3, 4, 5],
  bufferMin: 10,
  drive: {
    enabled: true, corridor: "US-101 N", baselineMin: 52, miles: 49,
    costPerMile: 0.3, tollUsd: 0, parkingUsd: 28,
  },
  bart: {
    enabled: true, originStation: "BERY", originName: "Berryessa", destStation: "MONT", destName: "Montgomery St",
    direction: "n", driveToStationMin: 16, parkingBufferMin: 6, rideMin: 64, egressMin: 12,
    headwayMin: 15, scheduleAnchor: "06:03", fareUsd: 8.2, parkingUsd: 3,
  },
  caltrain: {
    enabled: true, originStation: "70261", originName: "San Jose Diridon", destStation: "70011", destName: "San Francisco",
    direction: "N", driveToStationMin: 9, parkingBufferMin: 6, rideMin: 62, egressMin: 4,
    headwayMin: 20, scheduleAnchor: "06:12", fareUsd: 8.25, parkingUsd: 5.5,
  },
  weights: { time: 1, reliability: 1, cost: 0.5, early: 0.3 },
  modeBias: { drive: 0, bart: 0, caltrain: 0 },
  alerts: { enabled: true, thresholdMin: 10 },
};

/** Deep-merge user prefs over defaults so old/partial records stay valid. */
export function withDefaults(p: Partial<Prefs> | null | undefined): Prefs {
  const d = structuredClone(DEFAULT_PREFS);
  if (!p) return d;
  const out: any = { ...d, ...p };
  for (const k of ["origin", "destination", "drive", "bart", "caltrain", "weights", "modeBias", "alerts"] as const) {
    out[k] = { ...(d as any)[k], ...((p as any)[k] ?? {}) };
  }
  return out as Prefs;
}
