-- Agentic Commute Planner — Supabase schema. Run in the Supabase SQL editor.
-- The Worker writes with the service-role key; browsers (anon key + user JWT) can only read their own rows.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('night', 'morning')),
  target_date date not null,
  plan jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists plans_user_kind_date on public.plans (user_id, kind, target_date, created_at desc);

create table if not exists public.alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id bigint references public.plans (id) on delete set null,
  severity text not null check (severity in ('info', 'warn', 'urgent')),
  title text not null,
  message text not null,
  fingerprint text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

-- Memory: what the user actually did, used to learn mode bias (and later, real door-to-door times).
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id bigint references public.plans (id) on delete set null,
  chosen_mode text not null check (chosen_mode in ('drive', 'bart', 'caltrain', 'ace')),
  actual_depart time,
  actual_arrive time,
  rating smallint check (rating between 1 and 5),
  note text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.plans    enable row level security;
alter table public.alerts   enable row level security;
alter table public.feedback enable row level security;

create policy "own profile"  on public.profiles for select using (auth.uid() = id);
create policy "own plans"    on public.plans    for select using (auth.uid() = user_id);
create policy "own alerts"   on public.alerts   for select using (auth.uid() = user_id);
create policy "mark read"    on public.alerts   for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own feedback" on public.feedback for select using (auth.uid() = user_id);

-- Keep history bounded (run daily via pg_cron, or manually).
-- delete from public.plans where created_at < now() - interval '90 days';

-- Migration for databases created before ACE was added:
-- alter table public.feedback drop constraint if exists feedback_chosen_mode_check;
-- alter table public.feedback add constraint feedback_chosen_mode_check check (chosen_mode in ('drive', 'bart', 'caltrain', 'ace'));
