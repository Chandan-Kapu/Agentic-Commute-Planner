// Deploy entry: serves the embedded UI (src/static.gen.ts) and delegates /api/* + cron to worker.ts.
import worker from "./worker.ts";
import type { Env } from "./env.ts";
import { STATIC } from "./static.gen.ts";

const assets = {
  async fetch(req: Request): Promise<Response> {
    let p = new URL(req.url).pathname;
    if (p.endsWith("/")) p += "index.html";
    const f = STATIC[p] ?? STATIC[`${p}.html`]; // /help → /help.html
    if (!f) return new Response("Not found", { status: 404 });
    return new Response(f.body, {
      headers: { "Content-Type": f.type, "Cache-Control": p.endsWith(".html") ? "no-cache" : "public, max-age=300" },
    });
  },
} as unknown as Fetcher;

export default {
  fetch(req: Request, env: Env) {
    return worker.fetch(req, { ...env, ASSETS: assets });
  },
  scheduled(c: ScheduledController, env: Env, ctx: ExecutionContext) {
    return worker.scheduled(c, env, ctx);
  },
} satisfies ExportedHandler<Env>;
