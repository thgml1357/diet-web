-- Per-user settings the web app stores on the profile row.
-- (favorites / start_date may already exist if they were added by hand; "if not exists" keeps this safe.)
alter table public.users add column if not exists favorites jsonb not null default '[]'::jsonb;
alter table public.users add column if not exists start_date date;
-- Monday of exercise-program week 1 (progression 2→3 sets, 10→12 reps counts from here). The app fills it on first login.
alter table public.users add column if not exists program_start date;
