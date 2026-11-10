import type { Alert } from "./types.ts";

/** Push an alert to ntfy.sh, a Slack incoming webhook, or any HTTPS JSON webhook. */
export async function sendWebhook(url: string | undefined, a: Alert): Promise<boolean> {
  if (!url || !/^https:\/\//i.test(url)) return false;
  try {
    let init: RequestInit;
    if (/hooks\.slack\.com/.test(url)) {
      init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `*${a.title}* — ${a.message}` }) };
    } else if (/ntfy\./.test(url)) {
      init = { method: "POST", headers: { Title: a.title, Priority: a.severity === "urgent" ? "high" : "default", Tags: "car,train" }, body: a.message };
    } else {
      init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) };
    }
    const r = await fetch(url, init);
    return r.ok;
  } catch {
    return false;
  }
}
