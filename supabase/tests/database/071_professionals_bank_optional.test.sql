-- Professionnels: « Dépôt direct » is optional in the questionnaire (migration
-- *_professionals_bank_optional.sql, P4-480, reverses part of P4-173). Covers: the step
-- « Fiscalité et banque » is complete with the three bank values empty, incomplete with one or two
-- of them (entered here or on file), complete with all three; the SIN rule unchanged while
-- collect_sin is on; the step still has to be saved; the format checks of
-- save_my_submission_private unchanged; an empty deposit submitted and applied leaves the record
-- without one.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, provider 03 linked to P1), P1 active with an open
-- update draft (d2) asking « Fiscalité et banque » only.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pia Un', 'u3@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'u3@a.test', 'active');
insert into public.professional_public_profiles (org_id, professional_id)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
insert into public.professional_matching_profiles (org_id, professional_id)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
insert into public.professional_submissions
  (id, org_id, professional_id, kind, status, requested_sections, prefill, submitted_values, requested_by)
values
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'update', 'draft', array['tax_bank'], '{}', '{}', 'a0000000-0000-0000-0000-000000000001');

create function pg_temp.gaps() returns text[] language sql as $$
  select private.submission_gaps(s) from public.professional_submissions s where s.id = 'd0000000-0000-0000-0000-000000000002'
$$;
-- The submission's private row, as save_my_submission_private would leave it (the account encrypted).
create function pg_temp.set_sub(p_inst text, p_transit text, p_account text) returns void language sql as $$
  delete from public.professional_submission_private where submission_id = 'd0000000-0000-0000-0000-000000000002';
  insert into public.professional_submission_private
    (org_id, professional_id, submission_id, bank_institution, bank_transit, bank_account, bank_account_last4, key_version)
  values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
          p_inst, p_transit, private.encrypt_pii(p_account, private.pii_current_key_version()), right(p_account, 4),
          private.pii_current_key_version());
$$;
-- The record's private row (what is on file).
create function pg_temp.set_file(p_inst text, p_transit text, p_account text) returns void language sql as $$
  delete from public.professional_private where professional_id = 'c0000000-0000-0000-0000-000000000001';
  insert into public.professional_private
    (org_id, professional_id, bank_institution, bank_transit, bank_account, bank_account_last4, key_version)
  values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
          p_inst, p_transit, private.encrypt_pii(p_account, private.pii_current_key_version()), right(p_account, 4),
          private.pii_current_key_version());
$$;

-- =============================================================================
-- Privileges (as postgres)
-- =============================================================================
select function_privs_are('public', 'submit_my_submission', array[]::text[], 'authenticated', array['EXECUTE'],
  'authenticated may send the questionnaire');
select function_privs_are('public', 'save_my_submission_private', array['text', 'text', 'text', 'text', 'text', 'text', 'text'],
  'authenticated', array['EXECUTE'], 'authenticated may save the private step');

-- =============================================================================
-- The section's completeness (private.submission_gaps, as postgres)
-- =============================================================================
select is(pg_temp.gaps(), array['tax_bank'], 'the step never saved is still incomplete');

select pg_temp.set_sub(null, null, null);
select is(pg_temp.gaps(), '{}'::text[], 'saved with the three bank values empty: complete (P4-480)');

select pg_temp.set_sub('815', null, null);
select is(pg_temp.gaps(), array['tax_bank'], 'the institution alone: incomplete');
select pg_temp.set_sub(null, '30000', null);
select is(pg_temp.gaps(), array['tax_bank'], 'the transit alone: incomplete');
select pg_temp.set_sub(null, null, '1234567');
select is(pg_temp.gaps(), array['tax_bank'], 'the account alone: incomplete');
select pg_temp.set_sub('815', '30000', null);
select is(pg_temp.gaps(), array['tax_bank'], 'institution and transit without an account: incomplete');
select pg_temp.set_sub(null, '30000', '1234567');
select is(pg_temp.gaps(), array['tax_bank'], 'transit and account without an institution: incomplete');
select pg_temp.set_sub('815', '30000', '1234567');
select is(pg_temp.gaps(), '{}'::text[], 'the three: complete');

-- What is on file counts with what is entered.
select pg_temp.set_sub(null, null, null);
select pg_temp.set_file('815', '30000', '1234567');
select is(pg_temp.gaps(), '{}'::text[], 'nothing entered, a whole deposit on file: complete');
select pg_temp.set_file(null, null, '1234567');
select is(pg_temp.gaps(), array['tax_bank'], 'nothing entered, only an account on file: incomplete (the deposit would be partial)');
select pg_temp.set_sub('815', '30000', null);
select is(pg_temp.gaps(), '{}'::text[], 'institution and transit entered, the account on file: complete');
delete from public.professional_private where professional_id = 'c0000000-0000-0000-0000-000000000001';

-- The SIN rule is unchanged.
insert into public.org_module_settings (org_id, module_key, settings)
values ('b0000000-0000-0000-0000-00000000000a', 'professionals', '{"collect_sin": true}');
select pg_temp.set_sub(null, null, null);
select is(pg_temp.gaps(), array['tax_bank'], 'collect_sin on: an empty deposit, no SIN: incomplete');
update public.professional_submission_private
   set sin = private.encrypt_pii('046454286', key_version), sin_last3 = '286'
 where submission_id = 'd0000000-0000-0000-0000-000000000002';
select is(pg_temp.gaps(), '{}'::text[], 'collect_sin on: an empty deposit with the SIN: complete');
delete from public.org_module_settings where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
delete from public.professional_submission_private where submission_id = 'd0000000-0000-0000-0000-000000000002';

-- =============================================================================
-- The provider: the format checks stay; partial refused at « Envoyer », empty accepted
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.save_my_submission_private(null, null, null, null, '81', null, null) $$,
  'P0001', 'Le numéro d''institution compte 3 chiffres.', 'institution: still 3 digits');
select throws_ok($$ select public.save_my_submission_private(null, null, null, null, null, '3000', null) $$,
  'P0001', 'Le numéro de transit compte 5 chiffres.', 'transit: still 5 digits');
select throws_ok($$ select public.save_my_submission_private(null, null, null, null, null, null, '123456') $$,
  'P0001', 'Le numéro de compte compte de 7 à 12 chiffres.', 'account: still 7 to 12 digits');

select lives_ok($$ select public.save_my_submission_private(null, null, null, null, '815', null, null) $$,
  'a partial deposit can be saved (the draft)');
select throws_ok($$ select public.submit_my_submission() $$, 'P0001', 'Certaines sections sont incomplètes.',
  '… but not sent');
select lives_ok($$ select public.save_my_submission_private(null, null, null, null, ' ', '', null) $$,
  'the deposit emptied');
select lives_ok($$ select public.submit_my_submission() $$, 'sent without a deposit');
reset role;
select is((select s.status from public.professional_submissions s where s.id = 'd0000000-0000-0000-0000-000000000002'), 'submitted',
  'the update waits for its review');
select results_eq($$ select sp.bank_institution, sp.bank_transit, sp.bank_account is null, sp.bank_account_last4
                       from public.professional_submission_private sp
                      where sp.submission_id = 'd0000000-0000-0000-0000-000000000002' $$,
  $$ values (null::text, null::text, true, null::text) $$, 'its private row holds no deposit');

-- =============================================================================
-- The review applies it: the record stays without a deposit
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.apply_professional_submission('d0000000-0000-0000-0000-000000000002') $$,
  'the admin applies the update');
reset role;
select is((select s.status from public.professional_submissions s where s.id = 'd0000000-0000-0000-0000-000000000002'), 'approved',
  'approved');
select is((select count(*)::int from public.professional_private pp
            where pp.professional_id = 'c0000000-0000-0000-0000-000000000001' and pp.bank_account is not null), 0,
  'no account on the record');

select * from finish();
rollback;
