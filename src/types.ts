export type Mode = "drive" | "bart" | "caltrain";
export type SourceStatus = "live" | "mock" | "error" | "off";

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

export interface TransitPrefs {
  enabled: boolean;
  originStation: string; // BART abbr (e.g. "DUBL") or Caltrain 511 stop code (e.g. "70261")
  originName: string;
  destStation: string;
  destName: string;
  direction: string; // BART: "n" | "s"; Caltrain: informational
  driveToStationMin: number;
  parkingBufferMin: number; // park + walk to platform
  rideMin: number;
  egressMin: number; // station → destination door
  headwayMin: number; // fallback when no live departures
  scheduleAnchor: string; // "HH:MM" of any scheduled departure, used with headway as a fallback timetable
  fareUsd: number;
  parkingUsd: number;
  /** BART only: abbreviations of train destinations that reach destStation without going the wrong way. */
  lineHeads?: string[];
}

export interface Prefs {
  origin: Place;
  destination: Place;
  arriveBy: string; // "HH:MM"
  arrivalMode: "by" | "flexible";
  earliestDepart: string;
  latestDepart: string;
  workdays: number[]; // 0=Sun
  bufferMin: number;
  drive: {
    enabled: boolean;
    corridor: string; // e.g. "US-101 N"
    baselineMin: number; // free-flow door-to-door minutes
    miles: number;
    costPerMile: number;
    tollUsd: number;
    parkingUsd: number;
  };
  bart: TransitPrefs;
  caltrain: TransitPrefs;
  weights: { time: number; reliability: number; cost: number; early: number };
  modeBias: Record<Mode, number>; // learned from feedback, in minute-equivalents (negative = preferred)
  alerts: { enabled: boolean; thresholdMin: number; webhookUrl?: string };
}

export interface SourceResult<T> {
  source: string;
  status: SourceStatus;
  fetchedAt: string;
  data: T | null;
  note?: string;
}

export interface Incident {
  headline: string;
  severity: string;
  road: string;
  type: string;
  penaltyMin: number;
}

export interface Departure {
  epochMs: number;
  destination: string;
  delayMin: number;
  line?: string;
}

export interface WeatherHour {
  date: string;
  hour: number;
  tempC: number;
  precipProb: number;
  precipMm: number;
  code: number;
}

export interface Snapshot {
  nowEpoch: number;
  traffic: SourceResult<{ incidents: Incident[] }>;
  speeds: SourceResult<{ corridor: string; speedMph: number; freeFlowMph: number; ratio: number }>;
  route: SourceResult<{ minutes: number }>;
  bart: SourceResult<{ departures: Departure[] }>;
  caltrain: SourceResult<{ departures: Departure[] }>;
  weather: SourceResult<{ hours: WeatherHour[] }>;
}

export interface Leg {
  kind: "drive" | "park" | "wait" | "ride" | "walk";
  label: string;
  startMin: number;
  endMin: number;
}

export interface Option {
  id: string;
  mode: Mode;
  label: string;
  departMin: number;
  arriveMin: number;
  durationMin: number;
  sdMin: number;
  lateRisk: number;
  costUsd: number;
  score: number;
  legs: Leg[];
  notes: string[];
  dataQuality: "live" | "forecast" | "fallback";
}

export interface TraceStep {
  kind: "tool" | "think" | "decide" | "warn";
  title: string;
  detail: string;
}

export interface Alert {
  severity: "info" | "warn" | "urgent";
  title: string;
  message: string;
  fingerprint: string;
}

export interface PlanResult {
  id?: number;
  kind: "night" | "morning";
  targetDate: string;
  generatedAt: string;
  simulatedNow?: string;
  agent: string;
  recommended: Option;
  alternatives: Option[];
  summary: string;
  reasoning: string[];
  trace: TraceStep[];
  sources: { name: string; status: SourceStatus; note?: string }[];
  warnings: string[];
  alert?: Alert | null;
}
