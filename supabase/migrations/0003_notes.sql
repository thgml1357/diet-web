-- Free-text daily memo (e.g. condition, back pain, remarks).
alter table public.daily_records add column if not exists note text;
