import type { Alert, PlanResult, Prefs, Snapshot } from "./types.ts";
import { fmt } from "./time.ts";

/** Compare the night-before plan with the morning re-plan and decide whether to push an alert. */
export function computeAlert(night: PlanResult | null, morning: PlanResult, prefs: Prefs, snap: Snapshot): Alert | null {
  const th = prefs.alerts.thresholdMin;
  const m = morning.recommended;
  const all = [m, ...morning.alternatives];
  const transit = all.filter((o) => o.mode !== "drive").sort((a, b) => a.score - b.score)[0];
  const inc = [...(snap.traffic.data?.incidents ?? [])].sort((a, b) => b.penaltyMin - a.penaltyMin)[0];
  const sp = snap.speeds.data;
  const cause = inc
    ? `${prefs.drive.corridor} is backing up (${inc.headline}).`
    : sp && sp.ratio > 1.3
      ? `${prefs.drive.corridor} is slow (${sp.speedMph} mph).`
      : "Conditions changed overnight.";
  const trainAlt = (o = transit) => {
    if (!o) return "";
    const ride = o.legs.find((l) => l.kind === "ride");
    return ` Or ${o.label.charAt(0).toLowerCase() + o.label.slice(1)} — ${ride ? ride.label.split(" → ")[0] : fmt(o.departMin)}.`;
  };
  const fp = (s: string) => `${morning.targetDate}:${s}:${m.mode}:${m.departMin}`;

  if (!night) {
    if (m.lateRisk >= 0.3) {
      return { severity: "warn", title: "Tight commute today", fingerprint: fp("risk"),
        message: `${cause} Best option: ${m.label} (${Math.round(m.lateRisk * 100)}% late risk).${trainAlt()}` };
    }
    return null;
  }

  const n = night.recommended;
  const shift = m.departMin - n.departMin;
  if (m.mode !== n.mode && Math.abs(m.score - (all.find((o) => o.mode === n.mode)?.score ?? m.score)) >= 5) {
    return { severity: "urgent", title: `Switch to ${m.mode === "drive" ? "driving" : m.mode.toUpperCase()}`, fingerprint: fp("mode"),
      message: `${cause} Last night's plan was "${n.label}". Now: ${m.label}, arriving ${fmt(m.arriveMin)}.` };
  }
  if (shift <= -th) {
    return { severity: "urgent", title: `Leave ${-shift} min early`, fingerprint: fp("early"),
      message: `${cause} Leave ${-shift} minutes early (${fmt(m.departMin)})${m.mode === "drive" ? "" : ` for ${m.label}`}.${m.mode === "drive" ? trainAlt() : ""}` };
  }
  if (shift >= th) {
    return { severity: "info", title: `You can leave ${shift} min later`, fingerprint: fp("late"),
      message: `Traffic is lighter than forecast. ${m.label}, arriving ${fmt(m.arriveMin)}.` };
  }
  return null;
}
