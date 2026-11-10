# Project status and next steps

Last updated: 2026-11-10 · Branch: `main`

## Done
- Cloudflare Worker + static UI (`wrangler.toml`, `src/worker.ts`, `public/`)
- **Your commute** inputs: start/destination addresses (geocoded), arrive-by (hard or flexible), departure window, workdays, drive options
- **Your stations** inputs: BART, Caltrain and ACE (fixed timetable) board/get-off dropdowns (`public/stations.js`), BART trip lookup (`/api/bart-trip`), Caltrain platform code and direction
- Data adapters with cache and fallbacks (`src/sources/`): 511 traffic + Caltrain, BART ETD, PeMS feed, Open-Meteo weather, Mapbox ETA
- Deterministic planner (`src/planner.ts`): mode × departure-time scoring, late risk, a wait-it-out option
- NVIDIA NIM tool-calling agent with deterministic fallback (`src/agent.ts`)
- Morning-vs-night alerts with hysteresis, plus ntfy/Slack webhooks (`src/alerts.ts`, `src/notify.ts`)
- Supabase schema with RLS (`supabase/schema.sql`), fetch-based client and magic-link sign-in (`src/db.ts`)
- Cron handler: night plan at ~9 PM and morning re-plans every 10 min
- Tests: `npm test` (planner + alerts) and `npm run typecheck`

## Verified live (Nov 10, 2026, cloud environment `agentic-commute-planner`)
- NVIDIA agent end to end: tool calls, valid choice, explanation (`nvidia/nemotron-3.5-lightning-30b-a3b`, ~11 s)
- Model fallback guardrail: a model that returned no valid choice fell back to the deterministic pick
- BART real-time departures (public key), Open-Meteo weather, Nominatim geocoding
- Cloudflare API token (stored as a network secret for `api.cloudflare.com`, Authorization: Bearer): token active, 1 account visible, and `wrangler whoami` works with `CLOUDFLARE_API_TOKEN=proxy-injected`. Ready to deploy (step 4).
- Models on this account that do tool calling: nemotron-3.5-lightning-30b-a3b, nemotron-3-ultra-550b-a55b (slow), nemotron-3.5-super-vl-120b-a12b (unreliable JSON). Not enabled: meta/llama-3.3-70b-instruct and several others (404)

## Not yet verified
Development ran with no API keys, and the session's network blocked BART, Open-Meteo and Nominatim, so:
- None of the live API parsers (511, BART ETD and trip planner, Open-Meteo, Mapbox, Nominatim) has run against real responses
- The Supabase flows (sign-in, saving prefs, plans, alerts, the cron job) have not been run against a real project
- Caltrain stop codes (`70xx1` northbound / `70xx2` southbound) need checking against 511 GTFS

## Next steps
1. ~~Commute details~~ done: Mountain House Pkwy → Great America Pkwy, arrive ~9:00 (flexible), leave ~7:30 (window 7:00–8:00), Mon–Fri, Dublin/Pleasanton BART and San Jose Diridon Caltrain (now the defaults in `src/defaults.ts`). Still to collect: keys (NVIDIA, Supabase, 511, optional BART/Mapbox) and the alert webhook URL
2. Run `cp .dev.vars.example .dev.vars`, fill in the keys, run `npm run dev`, and check that each source shows **LIVE**
3. Supabase: run `supabase/schema.sql`, enable email magic links, set redirect URLs
4. Deploy: `npx wrangler kv namespace create CACHE` (uncomment it in `wrangler.toml`), set the secrets, run `npm run deploy`
5. Accuracy:
   - Load the BART/Caltrain GTFS timetables so night-before plans use exact trains
   - Calibrate drive time with logged trips (the `feedback` table), or a routing API with `depart_at`
   - Auto-suggest the nearest stations and estimate drive-to-station time
6. PeMS: build the ingestion job that feeds `PEMS_FEED_URL`, or drop it in favor of 511/Mapbox speeds
7. Production hardening: rate limiting on `/api/plan` and `/api/geocode`, Web Push (VAPID), error monitoring, end-to-end tests
8. ~~Add ACE~~ done (Tracy → Great America). To do: verify the default train times (05:00, 06:15, 07:20, 07:45 from Tracy are placeholders) against acerail.com, and find the 511 stop code for live ACE times
9. ~~Merge into `main`~~ done

## Resume locally
```bash
git clone https://github.com/Chandan-Kapu/Agentic-Commute-Planner.git
```
```bash
cd Agentic-Commute-Planner
```
```bash
npm install && npm test && npm run dev
```
