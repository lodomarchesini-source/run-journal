-- Strava integration schema. Run once in the Supabase SQL editor.

-- Per-user Strava OAuth tokens.
create table if not exists public.strava_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null, -- unix seconds, from Strava
  athlete_id bigint,
  updated_at timestamptz not null default now()
);

alter table public.strava_connections enable row level security;

drop policy if exists "strava_select_own" on public.strava_connections;
create policy "strava_select_own"
  on public.strava_connections
  for select
  using (auth.uid() = user_id);

drop policy if exists "strava_insert_own" on public.strava_connections;
create policy "strava_insert_own"
  on public.strava_connections
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "strava_update_own" on public.strava_connections;
create policy "strava_update_own"
  on public.strava_connections
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "strava_delete_own" on public.strava_connections;
create policy "strava_delete_own"
  on public.strava_connections
  for delete
  using (auth.uid() = user_id);

-- Track which Strava activity a run came from, so it isn't prefilled twice.
alter table public.runs add column if not exists strava_activity_id bigint;

create index if not exists runs_strava_activity_idx
  on public.runs (user_id, strava_activity_id);
