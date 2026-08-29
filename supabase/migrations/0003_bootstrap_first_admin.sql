-- The very first person to sign up becomes ADMIN/ACTIVE automatically —
-- otherwise nobody could ever assign the first role (role_permissions
-- writes require requesting_role() = 'ADMIN', and nobody has that yet).
-- Every signup after the first still lands as role=null/status=PENDING.
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
    case when v_is_first then 'ADMIN' else null end,
    case when v_is_first then 'ACTIVE' else 'PENDING' end
  );
  return new;
end;
$$;
