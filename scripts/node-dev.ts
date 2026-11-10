// Run the Worker in plain Node instead of workerd — for machines where outbound traffic must go
// through an HTTPS proxy (workerd ignores HTTPS_PROXY). Same code, same /api routes, same UI.
//   NODE_USE_ENV_PROXY=1 node scripts/node-dev.ts      (npm run dev:node)
// Vars come from wrangler.toml [vars], then .dev.vars, then process.env (highest).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import worker from "../src/worker.ts";

const root = new URL("..", import.meta.url).pathname;
const env: Record<string, unknown> = {};
const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
const varsBlock = toml.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
for (const m of varsBlock.matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/gm)) env[m[1]] = m[2];
if (existsSync(join(root, ".dev.vars"))) {
  for (const line of readFileSync(join(root, ".dev.vars"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[2]) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
for (const k of Object.keys(env).concat(["NVIDIA_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "API_511_KEY", "BART_API_KEY", "MAPBOX_TOKEN", "PEMS_FEED_URL", "ALERT_WEBHOOK_URL"])) {
  if (process.env[k]) env[k] = process.env[k];
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
env.ASSETS = {
  async fetch(req: Request) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(root, "public", p));
    if (!file.startsWith(join(root, "public")) || !existsSync(file)) return new Response("Not found", { status: 404 });
    return new Response(await readFile(file), { headers: { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" } });
  },
};

const port = Number(process.env.PORT ?? 8787);
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method, headers: req.headers as Record<string, string>,
    body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks),
  });
  const r = await worker.fetch(request, env as any);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.log(`node dev server on http://127.0.0.1:${port} (LLM: ${env.NVIDIA_API_KEY ? env.NVIDIA_MODEL : "off"})`));
