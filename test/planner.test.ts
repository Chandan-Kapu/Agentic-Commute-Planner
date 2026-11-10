import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOptions, profile } from "../src/planner.ts";
import { computeAlert } from "../src/alerts.ts";
import { withDefaults } from "../src/defaults.ts";
import { SJ_SF_PREFS as DEFAULT_PREFS } from "./fixtures.ts";
import type { PlanResult, Snapshot } from "../src/types.ts";

const t0 = Date.UTC(2026, 10, 11, 15, 0);
const src = (data: any, status: any = "live") => ({ source: "t", status, fetchedAt: "", data });
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    nowEpoch: t0,
    traffic: src({ incidents: [] }),
    speeds: src({ corridor: "US-101 N", speedMph: 60, freeFlowMph: 65, ratio: 65 / 60 }),
    route: src(null, "off"),
    bart: src({ departures: [] }),
    caltrain: src({ departures: [] }),
    weather: src({ hours: [] }),
    ...over,
  };
}
const asPlan = (out: ReturnType<typeof buildOptions>, kind: "night" | "morning"): PlanResult => ({
  kind, targetDate: "2026-11-11", generatedAt: "", agent: "test", recommended: out.recommended,
  alternatives: out.options.slice(1), summary: "", reasoning: [], trace: [], sources: [], warnings: [],
});

test("traffic profile peaks around 8 AM", () => {
  assert.ok(profile(480) > profile(400));
  assert.ok(profile(480) > profile(600));
});

test("produces one option per enabled mode, sorted by score", () => {
  const out = buildOptions({ prefs: DEFAULT_PREFS, snap: snap(), targetDate: "2026-11-11", nowMin: null });
  const modes = new Set(out.options.map((o) => o.mode));
  assert.ok(modes.has("drive") && modes.has("bart") && modes.has("caltrain"));
  for (let i = 1; i < out.options.length; i++) assert.ok(out.options[i - 1].score <= out.options[i].score);
  assert.ok(out.recommended.arriveMin <= 9 * 60 + 5, "recommendation should be ~on time");
});

test("a major incident in the morning makes driving worse and triggers an alert", () => {
  const prefs = withDefaults({ ...DEFAULT_PREFS, caltrain: { ...DEFAULT_PREFS.caltrain }, bart: { ...DEFAULT_PREFS.bart, enabled: false } });
  const night = buildOptions({ prefs, snap: snap(), targetDate: "2026-11-11", nowMin: null });
  const bad = snap({
    traffic: src({ incidents: [{ headline: "Crash blocking 2 lanes", severity: "Major", road: "US-101 N", type: "INCIDENT", penaltyMin: 25 }] }),
    speeds: src({ corridor: "US-101 N", speedMph: 22, freeFlowMph: 65, ratio: 65 / 22 }),
  });
  const morning = buildOptions({ prefs, snap: bad, targetDate: "2026-11-11", nowMin: 6 * 60 + 30 });
  assert.equal(night.recommended.mode, "drive");
  assert.notEqual(morning.recommended.mode, "drive", "should switch away from the jammed freeway");
  const alert = computeAlert(asPlan(night, "night"), asPlan(morning, "morning"), prefs, bad);
  assert.ok(alert, "expected an alert");
  assert.match(alert!.message, /backing up/);
});

test("flexible arrival can recommend waiting out the peak", () => {
  const prefs = withDefaults({ ...DEFAULT_PREFS, arrivalMode: "flexible", arriveBy: "09:30", earliestDepart: "07:45", latestDepart: "09:30",
    bart: { ...DEFAULT_PREFS.bart, enabled: false }, caltrain: { ...DEFAULT_PREFS.caltrain, enabled: false } });
  const out = buildOptions({ prefs, snap: snap(), targetDate: "2026-11-11", nowMin: null });
  assert.ok(out.recommended.departMin >= 8 * 60 + 30, `expected a late departure, got ${out.recommended.departMin}`);
});

test("default Mountain House commute plans all four modes and prefers driving on a normal day", async () => {
  const { DEFAULT_PREFS: MH } = await import("../src/defaults.ts");
  const out = buildOptions({ prefs: MH, snap: snap(), targetDate: "2026-11-11", nowMin: null });
  assert.deepEqual(new Set(out.options.map((o) => o.mode)), new Set(["drive", "bart", "caltrain", "ace"]));
  assert.equal(out.recommended.mode, "drive");
});

test("traffic filter understands multi-freeway corridors", async () => {
  const { parseCorridor } = await import("../src/sources/traffic511.ts");
  assert.deepEqual("I-580 W, I-680 S".split(",").map((c) => parseCorridor(c.trim())), [{ road: "580", dir: "west" }, { road: "680", dir: "south" }]);
});

test("ACE uses its fixed timetable and is skipped after the last train", async () => {
  const { DEFAULT_PREFS: MH } = await import("../src/defaults.ts");
  const prefs = withDefaults({ ...MH, drive: { ...MH.drive, enabled: false }, bart: { ...MH.bart, enabled: false }, caltrain: { ...MH.caltrain, enabled: false },
    ace: { ...MH.ace, departures: ["07:20", "07:45"] }, earliestDepart: "06:30", latestDepart: "07:30" });
  const out = buildOptions({ prefs, snap: snap(), targetDate: "2026-11-11", nowMin: null });
  const ride = out.recommended.legs.find((l) => l.kind === "ride")!;
  assert.equal(out.recommended.mode, "ace");
  assert.ok([7 * 60 + 20, 7 * 60 + 45].includes(ride.startMin), `train at ${ride.startMin}`);
  const late = withDefaults({ ...prefs, earliestDepart: "07:40", latestDepart: "08:00" });
  assert.throws(() => buildOptions({ prefs: late, snap: snap(), targetDate: "2026-11-11", nowMin: null }), /No modes/);
});
