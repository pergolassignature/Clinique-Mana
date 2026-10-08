-- « Places offertes » and « Bon à savoir » (migration *_professionals_places_and_note.sql, plan
-- Phase 4, P4-382 … P4-387).
-- Covers: privileges (the places column updatable, its stamp not; the note table select only;
-- set_professional_matching_note authenticated only); the stamp (set when the number changes, kept
-- otherwise, null with it, never written by a client) and the 0–99 bounds; the note (trimmed,
-- 1000 characters at most with HINT note, the same text writes nothing, empty deletes, the record's
-- updated_at bumped) for the conseillère and the adjointe; never for the provider (no write, no
-- read: table, record, public profile, questionnaire snapshot); another clinic; the audit (the text
-- redacted) and the history; the directory's three new columns.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- =============================================================================
-- Privileges
-- =============================================================================
select column_privs_are('public', 'professional_matching_profiles', 'new_client_places', 'authenticated', array['SELECT', 'UPDATE'],
  'new_client_places is updatable (professionals.matching through RLS)');
select column_privs_are('public', 'professional_matching_profiles', 'new_client_places_set_at', 'authenticated', array['SELECT'],
  'new_client_places_set_at is not (the trigger stamps it)');
select table_privs_are('public', 'professional_matching_notes', 'authenticated', array['SELECT'], 'authenticated: select only on the note table');
select table_privs_are('public', 'professional_matching_notes', 'anon', array[]::text[], 'anon: nothing on the note table');
select function_privs_are('public', 'set_professional_matching_note', array['uuid', 'text'], 'authenticated', array['EXECUTE'],
  'authenticated may call set_professional_matching_note');
select function_privs_are('public', 'set_professional_matching_note', array['uuid', 'text'], 'anon', array[]::text[],
  'anon may not call set_professional_matching_note');
select function_privs_are('public', 'set_professional_matching_note', array['uuid', 'text'], 'service_role', array[]::text[],
  'service_role may not call set_professional_matching_note');
select function_privs_are('private', 'stamp_new_client_places', array[]::text[], 'authenticated', array[]::text[],
  'no client role may call the stamp trigger function');

-- =============================================================================
-- Fixtures (as postgres): org A with an adjointe, a conseillère and a provider linked to P1; org B
-- with an admin and P2.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Un', 'provider@a.test'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Deux', 'p2@exemple.ca');
insert into public.professional_public_profiles (org_id, professional_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000002');
insert into public.professional_matching_profiles (org_id, professional_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000002');

select is((select row(new_client_places, new_client_places_set_at)::text from public.professional_matching_profiles
            where professional_id = 'c0000000-0000-0000-0000-000000000001'), '(,)', 'a new matching profile tracks no places');

-- =============================================================================
-- Places offertes (P4-382): the conseillère, through the column grant
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
update public.professional_matching_profiles set new_client_places = 4 where professional_id = 'c0000000-0000-0000-0000-000000000001';
select results_eq($$ select new_client_places::int, new_client_places_set_at = now() from public.professional_matching_profiles
                     where professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values (4, true) $$, '4 places, stamped now');
select throws_ok($$ update public.professional_matching_profiles set new_client_places_set_at = now() - interval '9 days'
                     where professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'a client cannot write the stamp');
select throws_ok($$ update public.professional_matching_profiles set new_client_places = 100
                     where professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514', null, '100 places is refused (0–99)');
select throws_ok($$ update public.professional_matching_profiles set new_client_places = -1
                     where professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a negative number is refused');
reset role;

-- An older stamp (as postgres, the trigger off) to see what keeps it.
alter table public.professional_matching_profiles disable trigger professional_matching_profiles_stamp_places;
update public.professional_matching_profiles set new_client_places_set_at = '2026-10-01 12:00:00+00'
 where professional_id = 'c0000000-0000-0000-0000-000000000001';
alter table public.professional_matching_profiles enable trigger professional_matching_profiles_stamp_places;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
update public.professional_matching_profiles set new_client_places = 4, women_only = true where professional_id = 'c0000000-0000-0000-0000-000000000001';
select is((select new_client_places_set_at from public.professional_matching_profiles where professional_id = 'c0000000-0000-0000-0000-000000000001'),
  '2026-10-01 12:00:00+00'::timestamptz, 'the same number keeps the stamp (other fields saved)');
update public.professional_matching_profiles set new_client_places = 0 where professional_id = 'c0000000-0000-0000-0000-000000000001';
select results_eq($$ select new_client_places::int, new_client_places_set_at = now() from public.professional_matching_profiles
                     where professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values (0, true) $$, 'a new number (0 included) is stamped again');
update public.professional_matching_profiles set new_client_places = null where professional_id = 'c0000000-0000-0000-0000-000000000001';
select is((select row(new_client_places, new_client_places_set_at)::text from public.professional_matching_profiles
            where professional_id = 'c0000000-0000-0000-0000-000000000001'), '(,)', 'cleared: no number, no stamp');
update public.professional_matching_profiles set new_client_places = 3 where professional_id = 'c0000000-0000-0000-0000-000000000001';

-- The provider cannot write it (no professionals.matching: RLS hides the row from the update).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
update public.professional_matching_profiles set new_client_places = 9 where professional_id = 'c0000000-0000-0000-0000-000000000001';
reset role;
select is((select new_client_places::int from public.professional_matching_profiles where professional_id = 'c0000000-0000-0000-0000-000000000001'), 3,
  'the provider''s update changes nothing');
select ok(exists (select 1 from public.audit_log a where a.table_name = 'professional_matching_profiles'
                   and a.record_id = 'c0000000-0000-0000-0000-000000000001'
                   and a.changed_fields -> 'new_client_places' = '{"before": null, "after": 3}'),
  'the change is audited with its values (not private)');

-- =============================================================================
-- Bon à savoir (P4-384, P4-385)
-- =============================================================================
alter table public.professionals disable trigger professionals_set_updated_at;
update public.professionals set updated_at = '2026-01-01 00:00:00+00' where id = 'c0000000-0000-0000-0000-000000000001';
alter table public.professionals enable trigger professionals_set_updated_at;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.set_professional_matching_note('c0000000-0000-0000-0000-000000000001', E'  Préfère les adultes.\n') ->> 'note',
  'Préfère les adultes.', 'the conseillère saves the note, trimmed');
select is((select note from public.professional_matching_notes where professional_id = 'c0000000-0000-0000-0000-000000000001'),
  'Préfère les adultes.', 'the staff read it');
reset role;
select ok((select updated_at > '2026-01-01 00:00:00+00' from public.professionals where id = 'c0000000-0000-0000-0000-000000000001'),
  'the record''s updated_at follows (the directory says « profil modifié »)');
select is((select a.changed_fields ->> 'note' from public.audit_log a
            where a.table_name = 'professional_matching_notes' and a.action = 'insert'
              and a.record_id = 'c0000000-0000-0000-0000-000000000001'), '[redacted]',
  'the audit never holds the text');
select is((select count(*)::int from public.audit_log a where a.changed_fields::text like '%Préfère%'), 0,
  'the text is nowhere in the audit');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_matching_note('c0000000-0000-0000-0000-000000000001', 'Préfère les adultes.') $$,
  'the adjointe saves the same text again');
reset role;
select is((select count(*)::int from public.audit_log a where a.table_name = 'professional_matching_notes'), 1,
  'the same text writes nothing (one audit row)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_matching_note('c0000000-0000-0000-0000-000000000001', repeat('x', 1001)) $$,
  'P0001', 'La note compte au plus 1000 caractères.', '1001 characters are refused');
select lives_ok($$ select public.set_professional_matching_note('c0000000-0000-0000-0000-000000000001', repeat('x', 1000)) $$,
  '1000 characters are accepted');
select is(public.set_professional_matching_note('c0000000-0000-0000-0000-000000000001', 'Pas de couples le vendredi.') ->> 'note',
  'Pas de couples le vendredi.', 'the adjointe changes it');

-- The directory (Demandes' staff read model) and the record.
select results_eq($$ select new_client_places::int, new_client_places_set_at is not null, matching_note from public.professionals_directory
                     where id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values (3, true, 'Pas de couples le vendredi.'::text) $$, 'the directory publishes the places, their date and the note');
select is(public.get_professional_record('c0000000-0000-0000-0000-000000000001') -> 'matching_note' ->> 'note',
  'Pas de couples le vendredi.', 'the record carries the note for staff');
select results_eq($$ select (x -> 'matching_profile' ->> 'new_client_places')::int, x -> 'matching_profile' ? 'new_client_places_set_at'
                       from public.get_professional_record('c0000000-0000-0000-0000-000000000001') x $$,
  $$ values (3, true) $$, 'the record carries the places and their date');
select ok(public.get_professional_public_profile('c0000000-0000-0000-0000-000000000001')::text not like '%vendredi%',
  'the public profile never carries the note');
select ok(exists (select 1 from public.list_professional_history('c0000000-0000-0000-0000-000000000001') h
                   where h.table_name = 'professional_matching_notes' and h.action = 'update'
                     and h.changed_fields ->> 'note' = '[redacted]'),
  'the history lists the note''s change, text redacted');

-- The provider: no write, no read, anywhere.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_matching_note('c0000000-0000-0000-0000-000000000001', 'x') $$,
  '42501', 'Permission refusée : professionals.matching', 'the provider cannot write it');
select is_empty($$ select 1 from public.professional_matching_notes $$, 'the provider reads no note');
select ok(public.get_professional_record('c0000000-0000-0000-0000-000000000001') is not null, 'the provider reads their own record');
select is(public.get_professional_record('c0000000-0000-0000-0000-000000000001') -> 'matching_note', 'null'::jsonb,
  'their record carries no note');
select ok(public.get_professional_record('c0000000-0000-0000-0000-000000000001')::text not like '%vendredi%',
  'nothing of the text is in their record');
reset role;
select ok(private.professional_submission_snapshot('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001')::text not like '%vendredi%',
  'nor in the questionnaire''s snapshot');

-- Another clinic.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_matching_note('c0000000-0000-0000-0000-000000000001', 'x') $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s admin cannot write it');
select is_empty($$ select 1 from public.professional_matching_notes $$, 'nor read it');

-- Cleared.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select ok(public.set_professional_matching_note('c0000000-0000-0000-0000-000000000001', E' \n ') is null, 'a blank note clears it (null back)');
select is_empty($$ select 1 from public.professional_matching_notes where professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  'the row is gone');
select ok(public.set_professional_matching_note('c0000000-0000-0000-0000-000000000001', null) is null, 'clearing again is a no-op');
reset role;
select is((select a.changed_fields ->> 'note' from public.audit_log a
            where a.table_name = 'professional_matching_notes' and a.action = 'delete'), '[redacted]',
  'the deletion is audited, text redacted');
select is((select count(*)::int from public.audit_log a where a.table_name = 'professional_matching_notes' and a.action = 'delete'), 1,
  'clearing an absent note writes nothing');

select * from finish();
rollback;
