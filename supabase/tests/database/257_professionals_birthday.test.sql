-- The professional's birthday (migration *_professionals_birthday.sql, decision P4-564,
-- Jonathan's « Suivi » of 22 October 2026). Covers: the column holds a day of the year
-- (« MM-DD »), never a year nor an impossible day; the questionnaire's « Profil professionnel »
-- saves it (normaliser), prefills it (snapshot) and applies it, and the journal never shows it;
-- the agenda reads the birthdays of a period (active professionals only, 29 February on the 28th
-- outside a leap year, a bounded period, `professionals.view`); the morning notice reaches
-- `professionals.manage` once per professional and day.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create function private.test_error_hint(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return nullif(v_hint, '');
end;
$$;
grant execute on function private.test_error_hint(text) to authenticated, service_role;

-- =============================================================================
-- Fixtures (as postgres): org A, its admin and a provider; Pia (active), Léo (active, born on
-- 29 February), Zoé (not active yet). Pia has a submitted update of « Profil professionnel ».
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@bd.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@bd.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pia Un', 'u3@bd.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Un', 'u3@bd.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Léo', 'Deux', 'leo@bd.test', 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', null, 'Zoé', 'Trois', 'zoe@bd.test', 'draft');
insert into public.professional_public_profiles (org_id, professional_id)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
insert into public.professional_matching_profiles (org_id, professional_id)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');

-- =============================================================================
-- The column: a day of the year, never a year nor an impossible day
-- =============================================================================
select has_column('public', 'professionals', 'birthday', 'the professional''s birthday');
select throws_ok($$ update public.professionals set birthday = '02-30' where id = 'c0000000-0000-0000-0000-000000000002' $$,
  '23514', null, '30 February does not exist');
select throws_ok($$ update public.professionals set birthday = '1990-03-14' where id = 'c0000000-0000-0000-0000-000000000002' $$,
  '23514', null, 'a year is never kept, only the day');
select lives_ok($$ update public.professionals set birthday = '02-29' where id = 'c0000000-0000-0000-0000-000000000002' $$,
  '29 February is a birthday');
update public.professionals set birthday = '06-10' where id = 'c0000000-0000-0000-0000-000000000003';

-- =============================================================================
-- The questionnaire: saved, prefilled, applied — and never in the journal
-- =============================================================================
select is(private.normalize_submission_section('professional', '{"birthday": " 03-14 "}') ->> 'birthday', '03-14',
  'the step saves the day, trimmed');
select is(private.test_error_hint($$ select private.normalize_submission_section('professional', '{"birthday": "04-31"}') $$),
  'birthday', 'an impossible day is refused on the field');
select ok((private.normalize_submission_section('professional', '{"birthday": ""}') -> 'birthday') = 'null'::jsonb,
  'an emptied birthday is stored as none');
select ok(not (private.normalize_submission_section('professional', '{"years_experience": 5}') ? 'birthday'),
  'a save that does not touch it leaves it as it was (P4-176)');
select results_eq($$ select section, kind from private.submission_fields() where field = 'birthday' $$,
  $$ values ('professional', 'plain') $$, 'a plain field of « Profil professionnel »');
select is(private.professional_submission_snapshot('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002')
            #>> '{professional,birthday}', '02-29', 'the questionnaire prefills it from the file');

insert into public.professional_submissions
  (id, org_id, professional_id, kind, status, requested_sections, prefill, submitted_values, requested_by, submitted_at)
values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'update', 'submitted', array['professional'], '{}', '{"professional": {"birthday": "03-14"}}',
   'a0000000-0000-0000-0000-000000000001', now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.apply_professional_submission('d0000000-0000-0000-0000-000000000001', array['birthday']) $$,
  'the review applies the birthday');
reset role;
select is((select birthday from public.professionals where id = 'c0000000-0000-0000-0000-000000000001'), '03-14',
  '… onto the file');
select is((select a.changed_fields -> 'birthday' from public.audit_log a
            where a.table_name = 'professionals' and a.record_id = 'c0000000-0000-0000-0000-000000000001'
              and a.changed_fields ? 'birthday'
            order by a.id desc limit 1),
  '"[redacted]"'::jsonb, 'the journal records that it changed, never the day (redacted, like the phone and the address)');

-- =============================================================================
-- The agenda: the birthdays of a period
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select x ->> 'name', x ->> 'day' from jsonb_array_elements(public.professional_birthdays('2027-03-10', '2027-03-20')) x $$,
  $$ values ('Pia Un', '2027-03-14') $$, 'the agenda reads who has a birthday in the period, and on which day');
select results_eq($$ select x ->> 'name', x ->> 'day' from jsonb_array_elements(public.professional_birthdays('2027-02-26', '2027-03-02')) x $$,
  $$ values ('Léo Deux', '2027-02-28') $$, '29 February is marked on the 28th outside a leap year');
select results_eq($$ select x ->> 'day' from jsonb_array_elements(public.professional_birthdays('2028-02-26', '2028-03-02')) x $$,
  $$ values ('2028-02-29') $$, '… and on the 29th in a leap year, not twice');
select is(public.professional_birthdays('2027-06-01', '2027-06-30'), '[]'::jsonb,
  'a professional who is not active yet is not shown');
select throws_ok($$ select public.professional_birthdays('2027-01-01', '2027-06-30') $$, '22023', null,
  'a period longer than the month view is refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.professional_birthdays('2027-03-10', '2027-03-20') $$, '42501', null,
  'a provider does not read her colleagues'' birthdays');
reset role;

-- =============================================================================
-- The morning notice
-- =============================================================================
-- Pia's birthday is the clinic's today; Léo's is cleared so a 28 February run cannot add his.
update public.professionals
   set birthday = pg_catalog.to_char(private.clinic_today_for_org('b0000000-0000-0000-0000-00000000000a'), 'MM-DD')
 where id = 'c0000000-0000-0000-0000-000000000001';
update public.professionals set birthday = null where id = 'c0000000-0000-0000-0000-000000000002';
set local role service_role;
select is(public.run_professionals_birthday_notices_for_service('b0000000-0000-0000-0000-00000000000a'), 1,
  'the job finds today''s birthday');
select is(public.run_professionals_birthday_notices_for_service('b0000000-0000-0000-0000-00000000000a'), 1,
  '… and a second run the same day finds it again');
reset role;
select results_eq($$ select n.title, n.recipient_permission, n.importance from public.notifications n
                      where n.org_id = 'b0000000-0000-0000-0000-00000000000a' and n.kind = 'professionals.birthday' $$,
  $$ values ('Anniversaire : Pia Un'::text, 'professionals.manage'::text, 'normal'::text) $$,
  '… but there is one notice, for those who manage the files');
select function_privs_are('public', 'run_professionals_birthday_notices_for_service', array['uuid'], 'authenticated', array[]::text[],
  'the job''s RPC is the service role''s only');

select * from finish();
rollback;
