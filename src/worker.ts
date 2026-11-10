import type { Env } from "./env.ts";
import { tzOf } from "./env.ts";
import type { Mode, PlanResult, Prefs } from "./types.ts";
import { DEFAULT_PREFS, withDefaults } from "./defaults.ts";
import { db, verifyUser } from "./db.ts";
import { makePlan } from "./plan.ts";
import { geocode } from "./sources/route.ts";
import { sendWebhook } from "./notify.ts";
import { hm, localParts } from "./time.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function body(req: Request): Promise<any> {
  if (Number(req.headers.get("Content-Length") ?? 0) > 100_000) throw new HttpError(413, "Body too large");
  try { return await req.json(); } catch { return {}; }
}

/** Resolve user + prefs. With Supabase configured, a signed-in user's stored prefs win; otherwise demo mode uses prefs from the request. */
async function ctxFor(env: Env, req: Request, bodyPrefs?: Partial<Prefs>) {
  const store = db(env);
  const uid = store ? await verifyUser(env, req) : null;
  let prefs: Prefs;
  if (store && uid) prefs = withDefaults((await store.getPrefs(uid)) ?? bodyPrefs);
  else prefs = withDefaults(bodyPrefs);
  return { store, uid, prefs };
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = req.method;

  if (p === "/api/health") return json({ ok: true, time: new Date().toISOString() });

  if (p === "/api/config") {
    return json({
      supabaseUrl: env.SUPABASE_URL ?? null,
      supabaseAnonKey: env.SUPABASE_ANON_KEY ?? null,
      timezone: tzOf(env),
      features: {
        llm: !!env.NVIDIA_API_KEY, model: env.NVIDIA_API_KEY ? env.NVIDIA_MODEL ?? "meta/llama-3.3-70b-instruct" : null,
        db: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY), k511: !!env.API_511_KEY,
        mapbox: !!env.MAPBOX_TOKEN, pems: !!env.PEMS_FEED_URL, bartOwnKey: !!env.BART_API_KEY,
      },
      defaults: DEFAULT_PREFS,
    });
  }

  if (p === "/api/prefs" && m === "GET") {
    const { uid, prefs } = await ctxFor(env, req);
    return json({ signedIn: !!uid, prefs });
  }

  if (p === "/api/prefs" && m === "PUT") {
    const b = await body(req);
    const { store, uid } = await ctxFor(env, req);
    const prefs = withDefaults(b.prefs);
    if (store && uid) await store.savePrefs(uid, prefs);
    return json({ saved: !!uid, prefs });
  }

  if (p === "/api/plan" && m === "POST") {
    const b = await body(req);
    const kind = b.kind === "morning" ? "morning" : "night";
    const { store, uid, prefs } = await ctxFor(env, req, b.prefs);
    let nightPlan: PlanResult | null = b.nightPlan ?? null;
    if (kind === "morning" && store && uid) {
      const today = localParts(new Date(), tzOf(env)).date;
      nightPlan = (await store.latestPlan(uid, "night", today)) ?? nightPlan;
    }
    const plan = await makePlan(env, { kind, prefs, nightPlan, simulateNow: b.simulateNow, useLlm: b.useLlm !== false });
    if (store && uid) {
      plan.id = await store.insertPlan(uid, plan);
      if (plan.alert && !(await store.alertExists(uid, plan.alert.fingerprint))) {
        await store.insertAlert(uid, plan.alert, plan.id);
      }
    }
    if (plan.alert && b.notify) await sendWebhook(prefs.alerts.webhookUrl || env.ALERT_WEBHOOK_URL, plan.alert);
    return json(plan);
  }

  if (p === "/api/alerts" && m === "GET") {
    const { store, uid } = await ctxFor(env, req);
    return json({ alerts: store && uid ? await store.listAlerts(uid) : [] });
  }

  if (p === "/api/feedback" && m === "POST") {
    // Memory: nudge the learned mode bias toward what the user actually chose.
    const b = await body(req);
    const chosen = b.chosenMode as Mode;
    if (!["drive", "bart", "caltrain"].includes(chosen)) throw new HttpError(400, "chosenMode must be drive|bart|caltrain");
    const { store, uid, prefs } = await ctxFor(env, req, b.prefs);
    for (const k of ["drive", "bart", "caltrain"] as Mode[]) {
      const delta = k === chosen ? -1.5 : 0.5;
      prefs.modeBias[k] = Math.max(-15, Math.min(15, Math.round(((prefs.modeBias[k] ?? 0) + delta) * 10) / 10));
    }
    if (store && uid) {
      await store.insertFeedback(uid, { plan_id: Number(b.planId) || undefined, chosen_mode: chosen, rating: b.rating, note: b.note?.slice?.(0, 500) });
      await store.savePrefs(uid, prefs);
    }
    return json({ prefs });
  }

  if (p === "/api/geocode" && m === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    if (q.length < 3) throw new HttpError(400, "q too short");
    return json({ place: await geocode(env, q) });
  }

  throw new HttpError(404, "Not found");
}

/** Cron: per user, send a night-before plan at ~9 PM and re-plan every 10 min during the morning window. */
async function scheduled(env: Env) {
  const store = db(env);
  if (!store) return;
  const tz = tzOf(env);
  const now = localParts(new Date(), tz);
  const users = await store.alertProfiles();
  const useLlm = env.CRON_LLM === "true";
  // Subrequest budget: ~8 fetches per user per run; keep batches small on the Workers free plan (50/invocation).
  for (const u of users.slice(0, 40)) {
    try {
      const prefs = withDefaults(u.prefs);
      const isNight = now.minutes >= 21 * 60 && now.minutes < 21 * 60 + 10;
      const workday = prefs.workdays.includes(now.weekday);
      const inMorning = workday && now.minutes >= hm(prefs.earliestDepart) - 60 && now.minutes <= hm(prefs.latestDepart);
      if (isNight) {
        const plan = await makePlan(env, { kind: "night", prefs, useLlm });
        await store.insertPlan(u.id, plan);
        const a = { severity: "info" as const, title: `Tomorrow: ${plan.recommended.label}`, message: plan.summary, fingerprint: `${plan.targetDate}:night` };
        if (!(await store.alertExists(u.id, a.fingerprint))) {
          await store.insertAlert(u.id, a);
          await sendWebhook(prefs.alerts.webhookUrl || env.ALERT_WEBHOOK_URL, a);
        }
      } else if (inMorning) {
        const nightPlan = await store.latestPlan(u.id, "night", now.date);
        const plan = await makePlan(env, { kind: "morning", prefs, nightPlan, useLlm });
        if (plan.alert && !(await store.alertExists(u.id, plan.alert.fingerprint))) {
          const id = await store.insertPlan(u.id, plan);
          await store.insertAlert(u.id, plan.alert, id);
          await sendWebhook(prefs.alerts.webhookUrl || env.ALERT_WEBHOOK_URL, plan.alert);
        }
      }
    } catch (e) {
      console.error("cron user failed", u.id, e);
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url);
    } catch (e: any) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Internal error", detail: String(e?.message ?? e).slice(0, 200) }, 500);
    }
  },
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduled(env));
  },
} satisfies ExportedHandler<Env>;
