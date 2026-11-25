-- Row-Level Security: every user can only touch their own rows.

alter table public.users          enable row level security;
alter table public.daily_records  enable row level security;
alter table public.meal_plans     enable row level security;
alter table public.exercise_plans enable row level security;

-- users: read/update own profile (insert is done by the signup trigger)
drop policy if exists "users_select_own" on public.users;
drop policy if exists "users_update_own" on public.users;
create policy "users_select_own" on public.users for select to authenticated
  using (id = (select auth.uid()));
create policy "users_update_own" on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- the three data tables share the same policy shape
do $$
declare t text;
begin
  foreach t in array array['daily_records','meal_plans','exercise_plans'] loop
    execute format('drop policy if exists "%1$s_select_own" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_insert_own" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_update_own" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_delete_own" on public.%1$s', t);
    execute format('create policy "%1$s_select_own" on public.%1$s for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_insert_own" on public.%1$s for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_update_own" on public.%1$s for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_delete_own" on public.%1$s for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- anonymous (not logged in) visitors get nothing
revoke all on public.users, public.daily_records, public.meal_plans, public.exercise_plans from anon;
grant select, insert, update, delete on public.daily_records, public.meal_plans, public.exercise_plans to authenticated;
grant select, update on public.users to authenticated;
