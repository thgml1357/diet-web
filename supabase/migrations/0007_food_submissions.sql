-- User-submitted foods for the search list. Only the admin (users.is_admin) can approve; others see approved foods + their own submissions.
alter table public.users add column if not exists is_admin boolean not null default false;

-- clients may never change their own admin flag (service role / SQL editor have auth.uid() = null)
create or replace function public.guard_is_admin() returns trigger language plpgsql as $$
begin
  if new.is_admin is distinct from old.is_admin and auth.uid() is not null then
    raise exception 'is_admin cannot be changed from the app';
  end if;
  return new;
end $$;
drop trigger if exists users_guard_is_admin on public.users;
create trigger users_guard_is_admin before update on public.users for each row execute function public.guard_is_admin();

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.users where id = auth.uid()), false)
$$;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.food_submissions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade default auth.uid(),
  name       text not null check (char_length(name) between 1 and 40),
  grams      numeric check (grams between 0 and 3000),
  kcal       numeric not null check (kcal between 0 and 3000),
  cat        text not null default '간식' check (cat in ('식사','외식','간식','음료','디저트')),
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
alter table public.food_submissions enable row level security;
drop policy if exists fs_select on public.food_submissions;
drop policy if exists fs_insert on public.food_submissions;
drop policy if exists fs_update on public.food_submissions;
drop policy if exists fs_delete on public.food_submissions;
create policy fs_select on public.food_submissions for select to authenticated using (status = 'approved' or user_id = auth.uid() or public.is_admin());
create policy fs_insert on public.food_submissions for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
create policy fs_update on public.food_submissions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy fs_delete on public.food_submissions for delete to authenticated using ((user_id = auth.uid() and status = 'pending') or public.is_admin());
revoke all on public.food_submissions from anon;
grant select, insert, update, delete on public.food_submissions to authenticated;
grant all on public.food_submissions to service_role;
