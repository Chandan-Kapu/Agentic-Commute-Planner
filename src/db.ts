// Minimal Supabase client over PostgREST + GoTrue using fetch (no SDK → small Worker bundle).
import type { Env } from "./env.ts";
import type { Alert, PlanResult, Prefs } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Db = ReturnType<typeof makeDb>;

export function db(env: Env): Db | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return makeDb(env.SUPABASE_URL.replace(/\/$/, ""), env.SUPABASE_SERVICE_ROLE_KEY);
}

function makeDb(url: string, key: string) {
  const base = `${url}/rest/v1`;
  async function q(path: string, init: RequestInit = {}): Promise<any> {
    const r = await fetch(base + path, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const id = (uid: string) => {
    if (!UUID.test(uid)) throw new Error("bad user id");
    return uid;
  };
  const post = (path: string, body: unknown, prefer = "return=representation") =>
    q(path, { method: "POST", headers: { Prefer: prefer }, body: JSON.stringify(body) });

  return {
    async getPrefs(uid: string): Promise<Prefs | null> {
      return (await q(`/profiles?id=eq.${id(uid)}&select=prefs`))?.[0]?.prefs ?? null;
    },
    savePrefs(uid: string, prefs: Prefs) {
      return post(`/profiles`, { id: id(uid), prefs, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=minimal");
    },
    async insertPlan(uid: string, plan: PlanResult): Promise<number | undefined> {
      const r = await post(`/plans`, { user_id: id(uid), kind: plan.kind, target_date: plan.targetDate, plan });
      return r?.[0]?.id;
    },
    async latestPlan(uid: string, kind: string, date: string): Promise<PlanResult | null> {
      const r = await q(`/plans?user_id=eq.${id(uid)}&kind=eq.${kind}&target_date=eq.${date}&order=created_at.desc&limit=1&select=id,plan`);
      return r?.[0] ? { ...r[0].plan, id: r[0].id } : null;
    },
    async alertExists(uid: string, fingerprint: string): Promise<boolean> {
      const r = await q(`/alerts?user_id=eq.${id(uid)}&fingerprint=eq.${encodeURIComponent(fingerprint)}&select=id&limit=1`);
      return !!r?.length;
    },
    insertAlert(uid: string, a: Alert, planId?: number) {
      return post(`/alerts`, { user_id: id(uid), severity: a.severity, title: a.title, message: a.message, fingerprint: a.fingerprint, plan_id: planId ?? null }, "return=minimal");
    },
    listAlerts(uid: string) {
      return q(`/alerts?user_id=eq.${id(uid)}&order=created_at.desc&limit=20&select=id,severity,title,message,created_at`);
    },
    insertFeedback(uid: string, f: { plan_id?: number; chosen_mode: string; rating?: number; note?: string }) {
      return post(`/feedback`, { user_id: id(uid), ...f }, "return=minimal");
    },
    async alertProfiles(): Promise<{ id: string; prefs: Prefs }[]> {
      return (await q(`/profiles?select=id,prefs&prefs->alerts->>enabled=eq.true&limit=200`)) ?? [];
    },
  };
}

/** Verify a Supabase access token from the browser and return the user id. */
export async function verifyUser(env: Env, req: Request): Promise<string | null> {
  const h = req.headers.get("Authorization");
  if (!h?.startsWith("Bearer ") || !env.SUPABASE_URL) return null;
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { Authorization: h, apikey: env.SUPABASE_ANON_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "" },
  });
  if (!r.ok) return null;
  const u: any = await r.json();
  return typeof u?.id === "string" && UUID.test(u.id) ? u.id : null;
}
