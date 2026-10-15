-- Clients' files for a new request (migration *_clients_intake_matches.sql, D-55). Covers: granted
-- to no role; a meaningful input only (a valid email, a 10-digit phone, a first and a last name);
-- the duplicate rule's matches (phone, email: case and spaces ignored; a contact shared with
-- another name) first, then the same or a similar name alone (accents ignored); the masked hints
-- (the phone's last 4 digits, the email's first 2 characters and domain) and the birth year, never
-- the full contact; merged, anonymised and another clinic's files never; the limit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select ok(not has_function_privilege('authenticated', 'private.clients_intake_matches(uuid, text, text, text, text, int)', 'execute')
          and not has_function_privilege('service_role', 'private.clients_intake_matches(uuid, text, text, text, text, int)', 'execute'),
  'granted to no role (Demandes'' definer RPC calls it)');

-- =============================================================================
-- Fixtures (as postgres)
-- =============================================================================
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.clients (id, org_id, client_number, first_name, last_name, email, mobile_e164, birthday) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 9001, 'Virginie', 'Tremblay', 'virginie@cfl.test', '+15145550101', '1985-03-02'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 9002, 'Virginie', 'Tremblai', null, null, null),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 9003, 'Léa', 'Tremblay', 'parent@cfl.test', '+15145550101', '2012-06-01'),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 9009, 'Virginie', 'Tremblay', 'virginie@cfl.test', '+15145550101', null);
-- A merged file and an anonymised one, with the same phone: never shown.
insert into public.clients (id, org_id, client_number, first_name, last_name, mobile_e164, archived_at, merged_into_id) values
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 9004, 'Virginie', 'Tremblay', '+15145550101', now(),
   'd0000000-0000-0000-0000-000000000001');
insert into public.clients (id, org_id, client_number, first_name, last_name, mobile_e164, anonymized_at) values
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 9005, 'Anonyme', 'Anonyme', '+15145550101', now());

-- =============================================================================
-- What starts a lookup
-- =============================================================================
select is_empty($$ select 1 from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', 'Virginie', null, 'virginie@', '514555', 5) $$,
  'nothing meaningful (a first name alone, an invalid email, a short phone): nothing');
select is_empty($$ select 1 from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', null, null, null, null, 5) $$, 'nothing typed: nothing');

-- =============================================================================
-- The matches
-- =============================================================================
select results_eq($$ select client_number, matched_on, phone_hint, email_hint
                       from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', null, null, null, '+1 (514) 555-0101', 5) $$,
  $$ values (9001, array['phone'], '0101'::text, null::text), (9003, array['phone'], '0101', null) $$,
  'a phone: every file holding it (a parent''s phone on a child''s file too), its last 4 digits only; merged, anonymised and another clinic''s never');
select results_eq($$ select client_number, matched_on, email_hint
                       from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', null, null, ' VIRGINIE@cfl.test ', null, 5) $$,
  $$ values (9001, array['email'], 'vi•••@cfl.test'::text) $$, 'an email: case and spaces ignored; the address masked');
select results_eq($$ select client_number, matched_on
                       from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', 'Vírginie', 'TRÉMBLAY', null, null, 5) $$,
  $$ values (9001, array['name']), (9002, array['name']) $$,
  'a first and a last name alone: the same name (accents and case ignored) and a similar one (Tremblai)');
select results_eq($$ select client_number, matched_on
                       from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', 'Virginie', 'Tremblay', null, '5145550101', 5) $$,
  $$ values (9001, array['phone', 'name']), (9003, array['phone']), (9002, array['name']) $$,
  'the duplicate rule first (HIGH, then MEDIUM), then the name alone');
select is((select birth_year from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', null, null, 'virginie@cfl.test', null, 5)),
  1985, 'the birth year, never the birthday');
select is((select display_name from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', null, null, 'virginie@cfl.test', null, 5)),
  'Virginie Tremblay', 'the file''s name');
select is_empty($$ select 1 from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', 'Virginie', 'Tr', null, null, 5) $$,
  'a name too far from any file: nothing (a name needs a similarity above 0.8, as the duplicate rule)');
select is((select count(*)::int from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', 'Virginie', 'Tremblay', null, '5145550101', 1)),
  1, 'the limit');
select is((select count(*)::int from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000b', null, null, null, '5145550101', 5)),
  1, 'another clinic: its own files only');
select is((select client_number from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', 'Virginie', 'Tremblay', null, '4385550101', 5) limit 1),
  9001, 'a partial phone (the last 7 digits) with the same name: shown, as the duplicate rule''s MEDIUM');
select is((select phone_hint from private.clients_intake_matches('b0000000-0000-0000-0000-00000000000a', 'Virginie', 'Tremblay', null, '4385550101', 5) limit 1),
  '0101', '… its hint is the file''s own last 4 digits');

select * from finish();
rollback;
