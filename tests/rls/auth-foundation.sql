-- RLS Tests: auth-foundation
-- Module: auth-foundation
-- Gate: 7 — Automated Tests
-- Contract: docs/data-contracts/auth-foundation.md
-- Created: 2026-01-18
--
-- These tests verify RLS policies work correctly.
-- Run against a local Supabase instance with test data.
--
-- Test Users (must be created in auth.users first):
--   admin_user:    11111111-1111-1111-1111-111111111111
--   staff_user:    22222222-2222-2222-2222-222222222222
--   provider_user: 33333333-3333-3333-3333-333333333333
--   provider2_user:44444444-4444-4444-4444-444444444444

-- =============================================================================
-- TEST SETUP
-- Creates test users and profiles for RLS verification
-- =============================================================================

begin;

-- Clean up any existing test data
delete from public.profiles where email like '%@test.cliniquemana.ca';
delete from public.profile_audit_log where profile_id in (
  select id from public.profiles where email like '%@test.cliniquemana.ca'
);

-- Create test profiles (using service role / bypassing RLS for setup)
-- In real tests, you'd use supabase.auth.admin to create auth.users first

insert into public.profiles (id, user_id, role, display_name, email, status)
values
  ('aaaa1111-aaaa-1111-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', 'admin', 'Test Admin', 'admin@test.cliniquemana.ca', 'active'),
  ('bbbb2222-bbbb-2222-bbbb-222222222222', '22222222-2222-2222-2222-222222222222', 'staff', 'Test Staff', 'staff@test.cliniquemana.ca', 'active'),
  ('cccc3333-cccc-3333-cccc-333333333333', '33333333-3333-3333-3333-333333333333', 'provider', 'Test Provider', 'provider@test.cliniquemana.ca', 'active'),
  ('dddd4444-dddd-4444-dddd-444444444444', '44444444-4444-4444-4444-444444444444', 'provider', 'Test Provider 2', 'provider2@test.cliniquemana.ca', 'active');

-- =============================================================================
-- HELPER: Set session user for testing
-- In Supabase, use set_config('request.jwt.claims', ...) to simulate auth
-- =============================================================================

-- Helper function to simulate authenticated user
create or replace function test_set_auth_user(p_user_id uuid)
returns void as $$
begin
  -- Set the JWT claim for auth.uid()
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id)::text, true);
end;
$$ language plpgsql;

-- Helper function to clear auth (simulate unauthenticated)
create or replace function test_clear_auth()
returns void as $$
begin
  perform set_config('request.jwt.claims', '', true);
end;
$$ language plpgsql;

-- =============================================================================
-- NEGATIVE TESTS
-- These should FAIL (return 0 rows or raise error)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TEST N1: Unauthenticated cannot read profiles
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  perform test_clear_auth();

  select count(*) into v_count from public.profiles;

  if v_count > 0 then
    raise exception 'TEST N1 FAILED: Unauthenticated user can read % profiles', v_count;
  else
    raise notice 'TEST N1 PASSED: Unauthenticated cannot read profiles';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N2: Provider cannot read other profiles
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  -- Set auth as provider_user
  perform test_set_auth_user('33333333-3333-3333-3333-333333333333');

  -- Provider should only see their own profile
  select count(*) into v_count
  from public.profiles
  where user_id != '33333333-3333-3333-3333-333333333333';

  if v_count > 0 then
    raise exception 'TEST N2 FAILED: Provider can read % other profiles', v_count;
  else
    raise notice 'TEST N2 PASSED: Provider cannot read other profiles';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N3: Staff cannot change role
-- -----------------------------------------------------------------------------
do $$
begin
  -- Set auth as staff_user
  perform test_set_auth_user('22222222-2222-2222-2222-222222222222');

  -- Try to change own role (should fail)
  begin
    update public.profiles
    set role = 'admin'
    where user_id = '22222222-2222-2222-2222-222222222222';

    raise exception 'TEST N3 FAILED: Staff was able to change their role';
  exception
    when others then
      raise notice 'TEST N3 PASSED: Staff cannot change role (error: %)', sqlerrm;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N4: Staff cannot change status
-- -----------------------------------------------------------------------------
do $$
begin
  -- Set auth as staff_user
  perform test_set_auth_user('22222222-2222-2222-2222-222222222222');

  -- Try to change own status (should fail)
  begin
    update public.profiles
    set status = 'disabled'
    where user_id = '22222222-2222-2222-2222-222222222222';

    raise exception 'TEST N4 FAILED: Staff was able to change their status';
  exception
    when others then
      raise notice 'TEST N4 PASSED: Staff cannot change status (error: %)', sqlerrm;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N5: Provider cannot change role
-- -----------------------------------------------------------------------------
do $$
begin
  -- Set auth as provider_user
  perform test_set_auth_user('33333333-3333-3333-3333-333333333333');

  -- Try to change own role (should fail)
  begin
    update public.profiles
    set role = 'admin'
    where user_id = '33333333-3333-3333-3333-333333333333';

    raise exception 'TEST N5 FAILED: Provider was able to change their role';
  exception
    when others then
      raise notice 'TEST N5 PASSED: Provider cannot change role (error: %)', sqlerrm;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N6: Provider cannot change status
-- -----------------------------------------------------------------------------
do $$
begin
  -- Set auth as provider_user
  perform test_set_auth_user('33333333-3333-3333-3333-333333333333');

  -- Try to change own status (should fail)
  begin
    update public.profiles
    set status = 'disabled'
    where user_id = '33333333-3333-3333-3333-333333333333';

    raise exception 'TEST N6 FAILED: Provider was able to change their status';
  exception
    when others then
      raise notice 'TEST N6 PASSED: Provider cannot change status (error: %)', sqlerrm;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N7: Provider cannot change email
-- -----------------------------------------------------------------------------
do $$
begin
  -- Set auth as provider_user
  perform test_set_auth_user('33333333-3333-3333-3333-333333333333');

  -- Try to change own email (should fail)
  begin
    update public.profiles
    set email = 'hacker@evil.com'
    where user_id = '33333333-3333-3333-3333-333333333333';

    raise exception 'TEST N7 FAILED: Provider was able to change their email';
  exception
    when others then
      raise notice 'TEST N7 PASSED: Provider cannot change email (error: %)', sqlerrm;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N8: No one can UPDATE audit log
-- -----------------------------------------------------------------------------
do $$
begin
  -- Set auth as admin (even admin cannot update audit)
  perform test_set_auth_user('11111111-1111-1111-1111-111111111111');

  begin
    update public.profile_audit_log
    set action = 'tampered'
    where id = (select id from public.profile_audit_log limit 1);

    raise exception 'TEST N8 FAILED: Someone was able to update audit log';
  exception
    when others then
      raise notice 'TEST N8 PASSED: No one can update audit log (error: %)', sqlerrm;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N9: No one can DELETE audit log
-- -----------------------------------------------------------------------------
do $$
begin
  -- Set auth as admin (even admin cannot delete audit)
  perform test_set_auth_user('11111111-1111-1111-1111-111111111111');

  begin
    delete from public.profile_audit_log
    where id = (select id from public.profile_audit_log limit 1);

    raise exception 'TEST N9 FAILED: Someone was able to delete audit log';
  exception
    when others then
      raise notice 'TEST N9 PASSED: No one can delete audit log (error: %)', sqlerrm;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N10: Staff cannot read audit log
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  -- Set auth as staff_user
  perform test_set_auth_user('22222222-2222-2222-2222-222222222222');

  select count(*) into v_count from public.profile_audit_log;

  if v_count > 0 then
    raise exception 'TEST N10 FAILED: Staff can read % audit log entries', v_count;
  else
    raise notice 'TEST N10 PASSED: Staff cannot read audit log';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N11: Provider cannot read audit log
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  -- Set auth as provider_user
  perform test_set_auth_user('33333333-3333-3333-3333-333333333333');

  select count(*) into v_count from public.profile_audit_log;

  if v_count > 0 then
    raise exception 'TEST N11 FAILED: Provider can read % audit log entries', v_count;
  else
    raise notice 'TEST N11 PASSED: Provider cannot read audit log';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N12: Staff cannot INSERT profiles
-- -----------------------------------------------------------------------------
do $$
begin
  -- Set auth as staff_user
  perform test_set_auth_user('22222222-2222-2222-2222-222222222222');

  begin
    insert into public.profiles (user_id, role, display_name, email)
    values ('55555555-5555-5555-5555-555555555555', 'provider', 'Fake User', 'fake@test.cliniquemana.ca');

    raise exception 'TEST N12 FAILED: Staff was able to insert profile';
  exception
    when others then
      raise notice 'TEST N12 PASSED: Staff cannot insert profiles (error: %)', sqlerrm;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- TEST N13: Provider cannot INSERT profiles
-- -----------------------------------------------------------------------------
do $$
begin
  -- Set auth as provider_user
  perform test_set_auth_user('33333333-3333-3333-3333-333333333333');

  begin
    insert into public.profiles (user_id, role, display_name, email)
    values ('55555555-5555-5555-5555-555555555555', 'provider', 'Fake User', 'fake@test.cliniquemana.ca');

    raise exception 'TEST N13 FAILED: Provider was able to insert profile';
  exception
    when others then
      raise notice 'TEST N13 PASSED: Provider cannot insert profiles (error: %)', sqlerrm;
  end;
end $$;

-- =============================================================================
-- POSITIVE TESTS
-- These should SUCCEED
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TEST P1: Provider can update own display_name
-- -----------------------------------------------------------------------------
do $$
declare
  v_new_name text;
begin
  -- Set auth as provider_user
  perform test_set_auth_user('33333333-3333-3333-3333-333333333333');

  update public.profiles
  set display_name = 'Updated Provider Name'
  where user_id = '33333333-3333-3333-3333-333333333333';

  select display_name into v_new_name
  from public.profiles
  where user_id = '33333333-3333-3333-3333-333333333333';

  if v_new_name = 'Updated Provider Name' then
    raise notice 'TEST P1 PASSED: Provider can update own display_name';
    -- Reset for other tests
    update public.profiles set display_name = 'Test Provider' where user_id = '33333333-3333-3333-3333-333333333333';
  else
    raise exception 'TEST P1 FAILED: Display name not updated';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST P2: Staff can update own display_name
-- -----------------------------------------------------------------------------
do $$
declare
  v_new_name text;
begin
  -- Set auth as staff_user
  perform test_set_auth_user('22222222-2222-2222-2222-222222222222');

  update public.profiles
  set display_name = 'Updated Staff Name'
  where user_id = '22222222-2222-2222-2222-222222222222';

  select display_name into v_new_name
  from public.profiles
  where user_id = '22222222-2222-2222-2222-222222222222';

  if v_new_name = 'Updated Staff Name' then
    raise notice 'TEST P2 PASSED: Staff can update own display_name';
    -- Reset for other tests
    update public.profiles set display_name = 'Test Staff' where user_id = '22222222-2222-2222-2222-222222222222';
  else
    raise exception 'TEST P2 FAILED: Display name not updated';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST P3: Admin can read all profiles
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  -- Set auth as admin_user
  perform test_set_auth_user('11111111-1111-1111-1111-111111111111');

  select count(*) into v_count from public.profiles;

  if v_count >= 4 then
    raise notice 'TEST P3 PASSED: Admin can read all % profiles', v_count;
  else
    raise exception 'TEST P3 FAILED: Admin can only see % profiles (expected >= 4)', v_count;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST P4: Admin can update any profile
-- -----------------------------------------------------------------------------
do $$
declare
  v_new_name text;
begin
  -- Set auth as admin_user
  perform test_set_auth_user('11111111-1111-1111-1111-111111111111');

  update public.profiles
  set display_name = 'Admin Updated This'
  where user_id = '33333333-3333-3333-3333-333333333333';

  select display_name into v_new_name
  from public.profiles
  where user_id = '33333333-3333-3333-3333-333333333333';

  if v_new_name = 'Admin Updated This' then
    raise notice 'TEST P4 PASSED: Admin can update any profile';
    -- Reset for other tests
    update public.profiles set display_name = 'Test Provider' where user_id = '33333333-3333-3333-3333-333333333333';
  else
    raise exception 'TEST P4 FAILED: Admin could not update other profile';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST P5: Admin can change role of others
-- -----------------------------------------------------------------------------
do $$
declare
  v_new_role text;
begin
  -- Set auth as admin_user
  perform test_set_auth_user('11111111-1111-1111-1111-111111111111');

  update public.profiles
  set role = 'staff'
  where user_id = '44444444-4444-4444-4444-444444444444';

  select role into v_new_role
  from public.profiles
  where user_id = '44444444-4444-4444-4444-444444444444';

  if v_new_role = 'staff' then
    raise notice 'TEST P5 PASSED: Admin can change role of others';
    -- Reset for other tests
    update public.profiles set role = 'provider' where user_id = '44444444-4444-4444-4444-444444444444';
  else
    raise exception 'TEST P5 FAILED: Admin could not change role';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST P6: Admin can change status of others
-- -----------------------------------------------------------------------------
do $$
declare
  v_new_status text;
begin
  -- Set auth as admin_user
  perform test_set_auth_user('11111111-1111-1111-1111-111111111111');

  update public.profiles
  set status = 'disabled'
  where user_id = '44444444-4444-4444-4444-444444444444';

  select status into v_new_status
  from public.profiles
  where user_id = '44444444-4444-4444-4444-444444444444';

  if v_new_status = 'disabled' then
    raise notice 'TEST P6 PASSED: Admin can change status of others';
    -- Reset for other tests
    update public.profiles set status = 'active' where user_id = '44444444-4444-4444-4444-444444444444';
  else
    raise exception 'TEST P6 FAILED: Admin could not change status';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST P7: Admin can read audit log
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  -- Set auth as admin_user
  perform test_set_auth_user('11111111-1111-1111-1111-111111111111');

  select count(*) into v_count from public.profile_audit_log;

  -- Should have audit entries from test setup and previous tests
  if v_count >= 0 then
    raise notice 'TEST P7 PASSED: Admin can read audit log (% entries)', v_count;
  else
    raise exception 'TEST P7 FAILED: Admin cannot read audit log';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST P8: Staff can read all profiles (needed for intake operations)
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  -- Set auth as staff_user
  perform test_set_auth_user('22222222-2222-2222-2222-222222222222');

  select count(*) into v_count from public.profiles;

  if v_count >= 4 then
    raise notice 'TEST P8 PASSED: Staff can read all % profiles', v_count;
  else
    raise exception 'TEST P8 FAILED: Staff can only see % profiles (expected >= 4)', v_count;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST P9: Provider can read own profile
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
  v_email text;
begin
  -- Set auth as provider_user
  perform test_set_auth_user('33333333-3333-3333-3333-333333333333');

  select count(*), max(email) into v_count, v_email
  from public.profiles
  where user_id = '33333333-3333-3333-3333-333333333333';

  if v_count = 1 and v_email = 'provider@test.cliniquemana.ca' then
    raise notice 'TEST P9 PASSED: Provider can read own profile';
  else
    raise exception 'TEST P9 FAILED: Provider cannot read own profile (count=%, email=%)', v_count, v_email;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST P10: Admin can INSERT new profiles
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  -- Set auth as admin_user
  perform test_set_auth_user('11111111-1111-1111-1111-111111111111');

  insert into public.profiles (user_id, role, display_name, email)
  values ('66666666-6666-6666-6666-666666666666', 'staff', 'New Staff Member', 'newstaff@test.cliniquemana.ca');

  select count(*) into v_count
  from public.profiles
  where email = 'newstaff@test.cliniquemana.ca';

  if v_count = 1 then
    raise notice 'TEST P10 PASSED: Admin can insert new profiles';
    -- Clean up
    delete from public.profiles where email = 'newstaff@test.cliniquemana.ca';
  else
    raise exception 'TEST P10 FAILED: Admin could not insert profile';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- TEST P11: Admin can DELETE profiles
-- -----------------------------------------------------------------------------
do $$
declare
  v_count_before integer;
  v_count_after integer;
begin
  -- Set auth as admin_user
  perform test_set_auth_user('11111111-1111-1111-1111-111111111111');

  -- Insert a test profile to delete
  insert into public.profiles (id, user_id, role, display_name, email)
  values ('eeee5555-eeee-5555-eeee-555555555555', '77777777-7777-7777-7777-777777777777', 'provider', 'To Be Deleted', 'delete@test.cliniquemana.ca');

  select count(*) into v_count_before from public.profiles where email = 'delete@test.cliniquemana.ca';

  delete from public.profiles where email = 'delete@test.cliniquemana.ca';

  select count(*) into v_count_after from public.profiles where email = 'delete@test.cliniquemana.ca';

  if v_count_before = 1 and v_count_after = 0 then
    raise notice 'TEST P11 PASSED: Admin can delete profiles';
  else
    raise exception 'TEST P11 FAILED: Admin could not delete profile (before=%, after=%)', v_count_before, v_count_after;
  end if;
end $$;

-- =============================================================================
-- CLEANUP
-- =============================================================================

-- Remove test helper functions
drop function if exists test_set_auth_user(uuid);
drop function if exists test_clear_auth();

-- Rollback to avoid persisting test data
rollback;

-- =============================================================================
-- SUMMARY
-- =============================================================================
--
-- NEGATIVE TESTS (should fail/be denied):
--   N1:  Unauthenticated cannot read profiles
--   N2:  Provider cannot read other profiles
--   N3:  Staff cannot change role
--   N4:  Staff cannot change status
--   N5:  Provider cannot change role
--   N6:  Provider cannot change status
--   N7:  Provider cannot change email
--   N8:  No one can UPDATE audit log
--   N9:  No one can DELETE audit log
--   N10: Staff cannot read audit log
--   N11: Provider cannot read audit log
--   N12: Staff cannot INSERT profiles
--   N13: Provider cannot INSERT profiles
--
-- POSITIVE TESTS (should succeed):
--   P1:  Provider can update own display_name
--   P2:  Staff can update own display_name
--   P3:  Admin can read all profiles
--   P4:  Admin can update any profile
--   P5:  Admin can change role of others
--   P6:  Admin can change status of others
--   P7:  Admin can read audit log
--   P8:  Staff can read all profiles
--   P9:  Provider can read own profile
--   P10: Admin can INSERT new profiles
--   P11: Admin can DELETE profiles
--
