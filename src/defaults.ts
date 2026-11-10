import type { Prefs } from "./types.ts";

// Default commute: Mountain House → Great America Pkwy (Santa Clara), arrive ~9:00 AM, flexible.
// Every value is editable on the website ("Your commute" / "Your stations").
// Times and costs below are starting estimates — adjust them to your real experience.
export const DEFAULT_PREFS: Prefs = {
  origin: { label: "Mountain House Pkwy, Mountain House, CA", lat: 37.7832, lon: -121.5441 },
  destination: { label: "Great America Pkwy, Santa Clara, CA", lat: 37.4029, lon: -121.9763 },
  arriveBy: "09:00",
  arrivalMode: "flexible",
  // You leave around 7:30; the window lets the agent suggest leaving a bit earlier or later.
  earliestDepart: "07:00",
  latestDepart: "08:00",
  workdays: [1, 2, 3, 4, 5],
  bufferMin: 10,
  drive: {
    // I-580 W over the Altamont, then I-680 S through Sunol, to CA-237 / Great America Pkwy.
    enabled: true, corridor: "I-580 W, I-680 S", baselineMin: 55, miles: 50,
    costPerMile: 0.3, tollUsd: 0, parkingUsd: 0,
  },
  bart: {
    // Dublin/Pleasanton → Milpitas (transfer at Bay Fair), then VTA Orange Line light rail toward Great America.
    enabled: true, originStation: "DUBL", originName: "Dublin/Pleasanton", destStation: "MLPT", destName: "Milpitas",
    direction: "s", driveToStationMin: 30, parkingBufferMin: 7, rideMin: 55, egressMin: 30,
    headwayMin: 15, scheduleAnchor: "06:04", fareUsd: 10.3, parkingUsd: 3,
  },
  caltrain: {
    // San Jose Diridon → Santa Clara (northbound), then ~4 mi last mile (shuttle / bike / rideshare) to Great America Pkwy.
    enabled: true, originStation: "70261", originName: "San Jose Diridon", destStation: "70241", destName: "Santa Clara",
    direction: "N", driveToStationMin: 60, parkingBufferMin: 6, rideMin: 6, egressMin: 18,
    headwayMin: 20, scheduleAnchor: "06:12", fareUsd: 4.5, parkingUsd: 5.5,
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
