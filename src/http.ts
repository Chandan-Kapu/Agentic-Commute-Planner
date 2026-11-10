import type { Env } from "./env.ts";
import type { SourceResult } from "./types.ts";

/** fetch + timeout + JSON parse. 511.org responses start with a UTF-8 BOM, so strip it. */
export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const txt = (await r.text()).replace(/^﻿/, "");
    return JSON.parse(txt);
  } catch (e: any) {
    // Never echo the URL: it can contain API keys.
    throw new Error(e?.name === "AbortError" ? "timeout" : String(e?.message ?? e));
  } finally {
    clearTimeout(t);
  }
}

const mem = new Map<string, { exp: number; val: unknown }>();

/**
 * Cache successful ("live") source results. Per-isolate memory first, then KV if bound.
 * Keys must never contain secrets.
 */
export async function cachedSource<T>(
  env: Env, key: string, ttlSec: number, source: string, fn: () => Promise<T>,
): Promise<SourceResult<T>> {
  const hit = mem.get(key);
  if (hit && hit.exp > Date.now()) return hit.val as SourceResult<T>;
  if (env.CACHE) {
    try {
      const v = await env.CACHE.get(key, "json");
      if (v) {
        mem.set(key, { exp: Date.now() + ttlSec * 1000, val: v });
        return v as SourceResult<T>;
      }
    } catch { /* cache is best-effort */ }
  }
  try {
    const data = await fn();
    const res: SourceResult<T> = { source, status: "live", fetchedAt: new Date().toISOString(), data };
    mem.set(key, { exp: Date.now() + ttlSec * 1000, val: res });
    if (env.CACHE) {
      try { await env.CACHE.put(key, JSON.stringify(res), { expirationTtl: Math.max(60, ttlSec) }); } catch {}
    }
    return res;
  } catch (e: any) {
    return { source, status: "error", fetchedAt: new Date().toISOString(), data: null, note: String(e?.message ?? e) };
  }
}

export const mock = <T>(source: string, data: T, note: string): SourceResult<T> =>
  ({ source, status: "mock", fetchedAt: new Date().toISOString(), data, note });

export const off = <T>(source: string, note: string): SourceResult<T> =>
  ({ source, status: "off", fetchedAt: new Date().toISOString(), data: null, note });
