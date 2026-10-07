-- #############################################################################
-- First admin for a fresh environment (staging after plan Task 1.21).
--
-- 1. Dashboard → Authentication → Add user → email + password, "Auto Confirm User".
-- 2. BEFORE that user signs in for the first time (without a profile the app
--    shows « profil introuvable »), replace the two values below and run this
--    whole file in the SQL editor (role postgres), or with
--    psql -v ON_ERROR_STOP=1 -f scripts/bootstrap-admin.sql.
--
-- Idempotent: running it again reuses the organization, profile, role and
-- module rows; it only changes what is missing or different. Everything runs
-- in one statement, so a failure leaves nothing behind.
-- Audit rows are tagged source = 'bootstrap'.
-- #############################################################################

do $$
declare
  v_email        text := 'REPLACE_WITH_ADMIN_EMAIL';
  v_display_name text := 'REPLACE_WITH_DISPLAY_NAME';
  v_org_name     text := 'Clinique MANA';
  v_user  uuid;
  v_org   uuid;
  v_orgs  int;
begin
  -- Transaction-local: tags every audit row written by this block.
  perform pg_catalog.set_config('app.audit_source', 'bootstrap', true);

  if v_email like 'REPLACE_WITH_%' or v_display_name like 'REPLACE_WITH_%' then
    raise exception 'bootstrap-admin: replace v_email and v_display_name at the top of the script first';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(v_email));
  if v_user is null then
    raise exception 'bootstrap-admin: no auth user with email %. Create it first: Dashboard → Authentication → Add user.', v_email;
  end if;

  -- Organization: the admin's existing one, else the only one, else a new one.
  select p.org_id into v_org from public.profiles p where p.user_id = v_user;
  if v_org is null then
    select count(*) into v_orgs from public.organizations;
    if v_orgs > 1 then
      raise exception 'bootstrap-admin: % organizations exist; this script expects a fresh environment', v_orgs;
    elsif v_orgs = 1 then
      select o.id into v_org from public.organizations o;
    else
      insert into public.organizations (name) values (v_org_name) returning id into v_org;
    end if;
  end if;

  -- Profile: the email is copied from auth.users by trigger (profiles_email_from_auth). The name
  -- is trimmed like the app does (profiles_display_name_check: at most 80 characters as stored).
  insert into public.profiles (user_id, org_id, display_name)
  values (v_user, v_org, btrim(v_display_name, E' \t\r\n'))
  on conflict (user_id) do nothing;

  update public.profiles p set status = 'active'
   where p.user_id = v_user and p.status <> 'active';

  insert into public.user_roles (user_id, org_id, role)
  values (v_user, v_org, 'admin')
  on conflict (user_id) do update set role = excluded.role
   where public.user_roles.role is distinct from excluded.role;

  -- Module keys are English (`professionals`); updated_at comes from the default / trigger.
  insert into public.org_modules (org_id, module_key, enabled, updated_by)
  values (v_org, 'professionals', true, v_user)
  on conflict (org_id, module_key) do update set enabled = true, updated_by = excluded.updated_by
   where not public.org_modules.enabled;

  raise notice 'bootstrap-admin: % (user %) is admin of organization %', v_email, v_user, v_org;
end;
$$;
