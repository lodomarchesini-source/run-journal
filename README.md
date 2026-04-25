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
  felt text not null default 'neutral' check (felt in ('bad', 'neutral', 'good')),
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
