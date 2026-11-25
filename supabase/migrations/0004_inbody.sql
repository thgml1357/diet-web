-- InBody measurements (only on days they were measured) and the user's height for BMI.
alter table public.daily_records add column if not exists inbody jsonb;
alter table public.users add column if not exists height numeric(5,1);
