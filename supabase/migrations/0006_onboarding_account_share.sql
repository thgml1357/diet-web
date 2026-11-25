-- Onboarding profile: {goal, place('home'|'gym'), back(bool), level, program_start}. Null = not onboarded.
alter table public.users add column if not exists profile jsonb;
-- Account deletion + read-only share links.
alter table public.users add column if not exists share_token uuid;

-- A signed-in user deletes their own auth user; FKs cascade to public.users and all records/plans.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Turn the user's share link on (new secret token) or off (token cleared).
create or replace function public.set_share(enable boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  t := case when enable then gen_random_uuid() else null end;
  update public.users set share_token = t where id = auth.uid();
  return t;
end $$;
revoke all on function public.set_share(boolean) from public, anon;
grant execute on function public.set_share(boolean) to authenticated;

-- Public, read-only snapshot for a share token (no notes, no user id, no favorites).
create or replace function public.get_shared(t uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u public.users%rowtype; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if t is null then return null; end if;
  select * into u from public.users where share_token = t;
  if not found then return null; end if;
  return jsonb_build_object(
    'start', u.start_date, 'height', u.height, 'profile', u.profile,
    'records', coalesce((select jsonb_agg(jsonb_build_object('date', r.date, 'weight', r.weight, 'steps', r.steps,
        'calories_consumed', r.calories_consumed, 'calories_burned', r.calories_burned, 'meals', r.meals, 'exercises', r.exercises, 'inbody', r.inbody) order by r.date)
      from public.daily_records r where r.user_id = u.id), '[]'::jsonb),
    'plans', coalesce((select jsonb_object_agg(m.date, jsonb_build_object('meals', m.meals, 'exercises', coalesce(e.exercises, '[]'::jsonb)))
      from public.meal_plans m left join public.exercise_plans e on e.user_id = m.user_id and e.date = m.date
      where m.user_id = u.id and m.date >= today and m.date < today + 7), '{}'::jsonb));
end $$;
revoke all on function public.get_shared(uuid) from public;
grant execute on function public.get_shared(uuid) to anon, authenticated;
