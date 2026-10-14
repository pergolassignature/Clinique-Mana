-- Clients: an IVAC payer's event date and a PAE agreement's tiers (migration
-- *_clients_payer_event_tiers.sql; R-84, R-85). Covers: the columns and their checks; privileges
-- (the new `save_client_payer`, the private helpers granted to no role); the event date (IVAC only,
-- never in the future, redacted in the audit log, « Payeurs à compléter » when missing, blanked by
-- an anonymisation); the tiers (PAE only, normalised, refused when malformed, without the coverage
-- that follows them, or past the agreement's maximum of sessions); the coverage of a session from
-- the count already covered (each tier's boundary, the coverage after them, no tiers); the facts
-- published to Facturation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- Shape and privileges.
select has_column('public', 'client_payers', 'event_on', 'client_payers.event_on');
select col_type_is('public', 'client_payers', 'event_on', 'date', '… a date-only field');
select has_column('public', 'client_payers', 'coverage_tiers', 'client_payers.coverage_tiers');
select is((select c.column_default from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = 'client_payers' and c.column_name = 'coverage_tiers'),
  '''[]''::jsonb', '… no tiers by default');
select function_privs_are('public', 'save_client_payer',
  array['uuid', 'uuid', 'text', 'text', 'text', 'integer', 'integer', 'integer', 'date', 'date', 'text', 'integer', 'integer', 'integer',
        'integer', 'integer', 'date', 'date', 'jsonb'],
  'authenticated', array['EXECUTE'], 'save_client_payer (with the event date and the tiers): users');
select function_privs_are('public', 'save_client_payer',
  array['uuid', 'uuid', 'text', 'text', 'text', 'integer', 'integer', 'integer', 'date', 'date', 'text', 'integer', 'integer', 'integer',
        'integer', 'integer', 'date', 'date', 'jsonb'],
  'anon', array[]::text[], '… never anon');
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('client_payer_details_of', array['uuid', 'uuid[]']),
               ('client_payer_session_coverage', array['jsonb', 'integer', 'integer', 'integer'])) as x(f, a);
select function_privs_are('private', f, a, 'service_role', array[]::text[], f || ': not the service role either')
  from (values ('client_payer_details_of', array['uuid', 'uuid[]']),
               ('client_payer_session_coverage', array['jsonb', 'integer', 'integer', 'integer'])) as x(f, a);

-- Fixtures: a clinic, its adjointe, three clients.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@r84.test', '', now(), '{}', '{}', now(), now()),
       ('a2000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@r84.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values ('b2000000-0000-0000-0000-00000000000a', 'Org R84', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-00000000000a', 'Adjointe', 'adjointe@r84.test', 'active'),
  ('a2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-00000000000a', 'Admin', 'admin@r84.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b2000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients')) as y(m);
insert into public.clients (id, org_id, first_name, last_name) values
  ('d2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-00000000000a', 'Iris', 'Essai'),
  ('d2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-00000000000a', 'Paul', 'Essai'),
  ('d2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-00000000000a', 'Zoé', 'Essai');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- R-84: the IVAC event date.
select set_config('test.iris', public.save_client_payer('d2000000-0000-0000-0000-000000000001', null, 'ivac', null, 'IV-84', null, null, null,
  null, null, null)::text, true);
select results_eq($$ select x -> 'missing' from pg_catalog.jsonb_array_elements(public.list_client_payers_to_complete()) x
                      where x ->> 'client_payer_id' = current_setting('test.iris') $$,
  $$ values ('["event_on"]'::jsonb) $$, 'an IVAC payer without its event date is « à compléter » (the date only)');
select throws_ok(format($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000001', %L, 'ivac', null, 'IV-84', null, null, null,
                          null, null, null, p_event_on => (now() at time zone 'America/Toronto')::date + 1) $$, current_setting('test.iris')),
  'P0001', 'La date de l''évènement est une date passée.', 'an event date in the future is refused');
select lives_ok(format($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000001', %L, 'ivac', null, 'IV-84', null, null, null,
                         null, null, null, p_event_on => date '2026-03-02') $$, current_setting('test.iris')), 'the event date saved');
reset role;
select is((select event_on from public.client_payers where id = current_setting('test.iris')::uuid), date '2026-03-02', '… stored as a calendar date');
select results_eq($$ select distinct changed_fields -> 'event_on' from public.audit_log
                      where table_name = 'client_payers' and record_id like '%' || current_setting('test.iris') and changed_fields ? 'event_on' $$,
  $$ values ('"[redacted]"'::jsonb) $$, '… redacted in the audit log (the date of a criminal act)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is_empty($$ select 1 from pg_catalog.jsonb_array_elements(public.list_client_payers_to_complete()) x
                    where x ->> 'client_payer_id' = current_setting('test.iris') $$, '… and the payer is complete');
select is((select p ->> 'event_on' from pg_catalog.jsonb_array_elements(public.get_client_summary('d2000000-0000-0000-0000-000000000001') -> 'payers') p),
  '2026-03-02', 'the record''s bundle carries it');
select throws_ok($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000002', null, 'pae', 'Fournisseur Y', 'PY-1', null, null, null,
                   null, null, null, 50, p_event_on => date '2026-03-02') $$,
  'P0001', 'La date de l''évènement se note pour un dossier IVAC seulement.', 'a PAE has no event date');

-- R-85: a PAE's tiers.
select throws_ok($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000001', null, 'pae', 'Fournisseur Y', 'PY-2', null, null, null,
                   null, null, null, 50, p_coverage_tiers => '{"sessions": 3}'::jsonb) $$,
  'P0001', 'Les paliers d''une entente sont une liste.', 'tiers are a list');
select throws_ok($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000002', null, 'pae', 'Fournisseur Y', 'PY-1', null, null, null,
                   null, null, null, null, p_coverage_tiers => '[{"sessions": 3, "coverage_percent": 100}]'::jsonb) $$,
  'P0001', 'Indiquez ce que le PAE couvre après les paliers.', 'tiers need the coverage that follows them');
select throws_ok($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000002', null, 'pae', 'Fournisseur Y', 'PY-1', null, null, null,
                   null, null, null, 50, p_coverage_tiers => '[{"sessions": 0, "coverage_percent": 100}]'::jsonb) $$,
  'P0001', 'Chaque palier compte de 1 à 999 séances.', 'a tier of 0 sessions is refused');
select throws_ok($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000002', null, 'pae', 'Fournisseur Y', 'PY-1', null, null, null,
                   null, null, null, 50, p_coverage_tiers => '[{"sessions": 3, "coverage_percent": 100, "session_amount_cents": 5000}]'::jsonb) $$,
  'P0001', 'Un palier couvre un montant par séance ou une part de la séance (1 % à 100 %), pas les deux.', 'a tier covers an amount or a share, not both');
select throws_ok($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000002', null, 'pae', 'Fournisseur Y', 'PY-1', null, null, null,
                   null, null, null, 50, p_coverage_tiers => '[{"sessions": 3, "coverage_percent": 101}]'::jsonb) $$,
  'P0001', 'Un palier couvre un montant par séance ou une part de la séance (1 % à 100 %), pas les deux.', 'a share above 100 % is refused');
select throws_ok($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000002', null, 'pae', 'Fournisseur Y', 'PY-1', null, null, null,
                   null, null, null, 50, p_coverage_tiers => (select pg_catalog.jsonb_agg('{"sessions": 1, "coverage_percent": 100}'::jsonb)
                                                                from pg_catalog.generate_series(1, 6))) $$,
  'P0001', 'Une entente a 5 paliers au maximum avant sa couverture habituelle.', 'at most 5 tiers');
select throws_ok($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000002', null, 'pae', 'Fournisseur Y', 'PY-1', null, 3, null,
                   null, null, null, 50, p_coverage_tiers => '[{"sessions": 4, "coverage_percent": 100}]'::jsonb) $$,
  'P0001', 'Les paliers comptent plus de séances que le maximum de l''entente.', 'tiers never pass the agreement''s maximum of sessions');
select throws_ok(format($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000001', %L, 'ivac', null, 'IV-84', null, null, null,
                   null, null, null, p_coverage_tiers => '[{"sessions": 3, "coverage_percent": 100}]'::jsonb) $$, current_setting('test.iris')),
  'P0001', 'Les paliers sont ceux d''une entente PAE.', 'IVAC has no tiers');
select set_config('test.paul', public.save_client_payer('d2000000-0000-0000-0000-000000000002', null, 'pae', 'Fournisseur Y', 'PY-1', null, 8, 80000,
  null, null, null, 50, 3, 31,
  p_coverage_tiers => '[{"sessions": 3, "coverage_percent": 100, "note": "ignoré"}, {"sessions": 2, "session_amount_cents": 6000}]'::jsonb)::text, true);
reset role;
select is((select coverage_tiers from public.client_payers where id = current_setting('test.paul')::uuid),
  '[{"sessions": 3, "coverage_percent": 100}, {"sessions": 2, "session_amount_cents": 6000}]'::jsonb,
  '« 3 séances à 100 %, puis 2 à 60 $, ensuite 50 % »: stored in order, normalised');
select results_eq($$ select d.event_on, d.coverage_tiers from private.client_payer_details_of('b2000000-0000-0000-0000-00000000000a',
                        array[current_setting('test.iris')::uuid, current_setting('test.paul')::uuid]) d order by d.event_on nulls last $$,
  $$ values (date '2026-03-02', '[]'::jsonb),
            (null::date, '[{"sessions": 3, "coverage_percent": 100}, {"sessions": 2, "session_amount_cents": 6000}]'::jsonb) $$,
  'Facturation reads the event date and the tiers (client_payer_details_of)');
select is_empty($$ select 1 from private.client_payer_details_of('b2000000-0000-0000-0000-00000000000b', array[current_setting('test.paul')::uuid]) $$,
  '… only the org it names');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
-- A save without tiers drops them: the agreement is back to one coverage.
select lives_ok(format($$ select public.save_client_payer('d2000000-0000-0000-0000-000000000002', %L, 'pae', 'Fournisseur Y', 'PY-1', null, 8, 80000,
                         null, null, null, 50, 3, 31) $$, current_setting('test.paul')), 'saved again without tiers');
reset role;
select is((select coverage_tiers from public.client_payers where id = current_setting('test.paul')::uuid), '[]'::jsonb, '… one coverage again');
select throws_ok($$ update public.client_payers set coverage_tiers = '[{"sessions": 1, "coverage_percent": 100}]' where id = current_setting('test.iris')::uuid $$,
  '23514', null, 'the table refuses tiers on an IVAC payer');
select throws_ok($$ update public.client_payers set event_on = date '2026-01-01' where id = current_setting('test.paul')::uuid $$,
  '23514', null, '… and an event date on a PAE');

-- The coverage of a session from the count already covered in the agreement's year.
select results_eq($$ select n, c.session_amount_cents, c.coverage_percent
                      from pg_catalog.generate_series(0, 6) n
                      cross join lateral private.client_payer_session_coverage(
                        '[{"sessions": 3, "coverage_percent": 100}, {"sessions": 2, "session_amount_cents": 6000}]'::jsonb, null, 50, n) c
                     order by n $$,
  $$ values (0, null::int, 100), (1, null, 100), (2, null, 100), (3, 6000, null), (4, 6000, null), (5, null, 50), (6, null, 50) $$,
  'sessions 1–3 at 100 %, 4–5 at 60 $, then 50 % (each boundary)');
select results_eq($$ select c.session_amount_cents, c.coverage_percent from private.client_payer_session_coverage('[]'::jsonb, 4000, null, 7) c $$,
  $$ values (4000, null::int) $$, 'no tiers: the agreement''s one coverage');
select results_eq($$ select c.session_amount_cents, c.coverage_percent from private.client_payer_session_coverage(null, null, 80, null) c $$,
  $$ values (null::int, 80) $$, '… also with nothing counted yet');

-- An anonymisation blanks the event date.
insert into public.client_payers (id, client_id, org_id, kind, file_number, event_on) values
  ('f2000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-00000000000a', 'ivac', 'IV-ZOE', date '2025-06-01');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.anonymize_client('d2000000-0000-0000-0000-000000000003') $$, 'Zoé anonymised');
reset role;
select results_eq($$ select event_on, file_number, is_active from public.client_payers where id = 'f2000000-0000-0000-0000-000000000003' $$,
  $$ values (null::date, 'anonymisé'::text, false) $$, '… her IVAC payer keeps no event date');

select * from finish();
rollback;
