export interface Env {
  ASSETS: Fetcher;
  CACHE?: KVNamespace;
  TIMEZONE?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_MODEL?: string;
  NVIDIA_FALLBACK_MODEL?: string;
  NVIDIA_BASE_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  API_511_KEY?: string;
  BART_API_KEY?: string;
  MAPBOX_TOKEN?: string;
  PEMS_FEED_URL?: string;
  ALERT_WEBHOOK_URL?: string;
  CRON_LLM?: string;
}

export const tzOf = (env: Env) => env.TIMEZONE || "America/Los_Angeles";
