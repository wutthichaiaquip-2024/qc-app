-- Fixes custom_access_token_hook: the `supabase_auth_admin` role that
-- invokes this hook has search_path='auth' only (confirmed via
-- pg_roles.rolconfig), so the unqualified `app_role` type reference
-- failed to resolve, causing every login to fail with
-- "Error running hook URI: pg-functions://postgres/public/custom_access_token_hook".
-- Fix: pin search_path on the function and schema-qualify the type.
create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  claims jsonb;
  v_role public.app_role;
  v_site_ids uuid[];
begin
  select role into v_role
  from public.user_profiles
  where id = (event ->> 'user_id')::uuid;

  select coalesce(array_agg(site_id), '{}')
  into v_site_ids
  from public.user_sites
  where user_id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);

  if v_role is not null then
    claims := jsonb_set(claims, '{app_role}', to_jsonb(v_role::text));
  end if;

  claims := jsonb_set(claims, '{site_ids}', to_jsonb(v_site_ids));

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant execute on function custom_access_token_hook to supabase_auth_admin;
revoke execute on function custom_access_token_hook from authenticated, anon, public;
