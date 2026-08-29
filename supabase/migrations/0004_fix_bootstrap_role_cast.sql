-- Fixes a bug in handle_new_auth_user() from 0003: `case when v_is_first
-- then 'ADMIN' else null end` resolves to type `text` (both branches are
-- unknown-type literals with no other context), which Postgres does NOT
-- implicitly cast to the `app_role` enum column, so every signup/user
-- creation failed with "column role is of type app_role but expression
-- is of type text". Fix: cast explicitly.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_first boolean;
begin
  select not exists (select 1 from public.user_profiles) into v_is_first;

  insert into public.user_profiles (id, full_name, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    case when v_is_first then 'ADMIN'::app_role else null end,
    case when v_is_first then 'ACTIVE' else 'PENDING' end
  );
  return new;
end;
$$;
