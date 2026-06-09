# Run Journal Supabase Setup

This app now uses Supabase email OTP auth and stores runs per user in the cloud.

## 1) Create Supabase project

- Create a new project in [Supabase](https://supabase.com/).
- In Authentication settings, enable Email OTP sign-in.

## 2) Create `runs` table

Run this SQL in the Supabase SQL editor:

```sql
create table if not exists public.runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  distance double precision not null,
  unit text not null check (unit in ('km', 'mi')),
  duration_min double precision,
  notes text,
  time_of_day text not null default 'day' check (time_of_day in ('morning', 'day', 'evening')),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists runs_user_date_created_idx
  on public.runs (user_id, date, created_at);

alter table public.runs enable row level security;

create policy if not exists "runs_select_own"
  on public.runs
  for select
  using (auth.uid() = user_id);

create policy if not exists "runs_insert_own"
  on public.runs
  for insert
  with check (auth.uid() = user_id);

create policy if not exists "runs_update_own"
  on public.runs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy if not exists "runs_delete_own"
  on public.runs
  for delete
  using (auth.uid() = user_id);
```

If you created this table earlier with a `felt` column, the app no longer reads or writes it. You can leave the column in place or remove it when convenient:

```sql
alter table public.runs drop column if exists felt;
```

## 3) Add keys to app

Set credentials before loading the app:

```html
<script>
  window.RUNJOURNAL_SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
  window.RUNJOURNAL_SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
</script>
```

Place that snippet in `index.html` before `app.js`, or hardcode values in `app.js` constants.

## 4) Local run migration

On first successful login in a browser, old `localStorage` runs are merged once into the signed-in account, then all reads/writes use Supabase.

## 5) Strava integration (optional)

When connected, opening **+ New run** prefills the form with your most recent
Strava run (date, distance, time, when) — unless that activity was already
journaled — leaving only the notes to write.

### a) Run the Strava SQL in Supabase

Run the contents of [`supabase-strava.sql`](supabase-strava.sql) in the
Supabase SQL editor. This creates the `strava_connections` table and adds a
`strava_activity_id` column to `runs`.

Do this **before** deploying the new app code — saving runs requires the new
column.

### b) Create a Strava API application

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api) and create an app:
   - Application name: e.g. `Run Journal`
   - Category: anything (e.g. "Training")
   - Website: `https://runnny.vercel.app`
   - **Authorization Callback Domain**: `runnny.vercel.app` (no `https://`, no path)
2. Copy the **Client ID** and **Client Secret**.

### c) Configure keys

1. In the Vercel project settings, add environment variables (then redeploy):
   - `STRAVA_CLIENT_ID` — your Client ID
   - `STRAVA_CLIENT_SECRET` — your Client Secret
2. In `index.html`, set the public client ID:

```html
<script>
  window.RUNJOURNAL_STRAVA_CLIENT_ID = "YOUR_CLIENT_ID";
</script>
```

### d) Connect

On the deployed site, click **Connect Strava** in the header, approve access
on Strava, and you'll be redirected back. The button switches to
**Disconnect Strava** once linked.

Notes:

- Tokens are stored per user in `strava_connections` (RLS protected) and
  refreshed automatically via the `api/strava/token.js` Vercel function.
- The Connect button only appears when `RUNJOURNAL_STRAVA_CLIENT_ID` is set.
- The OAuth flow only works on the deployed Vercel domain (the callback
  domain must match the Strava app settings).
