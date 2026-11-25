-- Diet tracker schema. Run in Supabase SQL Editor, or via `supabase db push`.
-- Tracking starts 2026-10-06.

create extension if not exists "pgcrypto";

-- users: profile row mirroring auth.users (id is the same UUID) ---------------
create table if not exists public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- daily_records ---------------------------------------------------------------
create table if not exists public.daily_records (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade default auth.uid(),
  date              date not null,
  weight            numeric(5,2) check (weight is null or weight > 0),
  steps             integer check (steps is null or steps >= 0),
  calories_consumed integer check (calories_consumed is null or calories_consumed >= 0),
  calories_burned   integer check (calories_burned is null or calories_burned >= 0),
  -- meals:     [{"name":"Chicken salad","type":"lunch","grams":250,"kcal":420}]
  meals             jsonb not null default '[]'::jsonb check (jsonb_typeof(meals) = 'array'),
  -- exercises: [{"name":"Running","duration":30,"kcal":300,"notes":"5km"}]
  exercises         jsonb not null default '[]'::jsonb check (jsonb_typeof(exercises) = 'array'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, date)
);
create index if not exists daily_records_user_date_idx on public.daily_records (user_id, date desc);

-- meal_plans ------------------------------------------------------------------
create table if not exists public.meal_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade default auth.uid(),
  date       date not null,
  -- meals: [{"name":"Oatmeal","grams":80,"kcal":300}]
  meals      jsonb not null default '[]'::jsonb check (jsonb_typeof(meals) = 'array'),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
create index if not exists meal_plans_user_date_idx on public.meal_plans (user_id, date);

-- exercise_plans --------------------------------------------------------------
create table if not exists public.exercise_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade default auth.uid(),
  date       date not null,
  -- exercises: [{"name":"Walk","duration":40,"notes":"after dinner"}]
  exercises  jsonb not null default '[]'::jsonb check (jsonb_typeof(exercises) = 'array'),
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
create index if not exists exercise_plans_user_date_idx on public.exercise_plans (user_id, date);

-- updated_at trigger ----------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists daily_records_set_updated_at on public.daily_records;
create trigger daily_records_set_updated_at
  before update on public.daily_records
  for each row execute function public.set_updated_at();

-- auto-create profile row when someone signs up -------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
