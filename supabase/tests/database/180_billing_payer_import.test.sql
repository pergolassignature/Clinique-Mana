-- Facturation, the GOrendezvous import of « Payé par » (migration *_billing_payer_import.sql;
-- decision I-17). Covers: privileges (billing.manage); a dry run writes nothing; the default payer
-- from its date, under the audit source `import`, read by `billing_default_payer`; a re-run, the
-- client herself `skipped`; a payer without the right « recevoir reçus et factures », a client or
-- a payer not found `unmatched`; an unreadable date refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select function_privs_are('public', 'import_default_payer', array['jsonb', 'boolean'], 'authenticated', array['EXECUTE'], 'import_default_payer: authenticated');
select function_privs_are('public', 'import_default_payer', array['jsonb', 'boolean'], 'anon', array[]::text[], 'import_default_payer: never anon');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adj@bp.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cons@bp.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adj@bp.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@bp.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
-- Léa (a teen) with her two parents: Paul receives her invoices, Anne does not.
insert into public.clients (id, org_id, first_name, last_name, external_ref) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'gorendezvous:601'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Paul', 'Essai', 'gorendezvous:602'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Anne', 'Essai', 'gorendezvous:603');
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, b_receives_invoices) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'child', 'parent', true),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'child', 'parent', false);
select set_config('test.row', '{"client_name": "Léa Essai", "payer_name": "ESSAI, Paul", "effective_from": "2025-09-01"}', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.import_default_payer(current_setting('test.row')::jsonb, true) $$, '42501', null, 'the conseillère: refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_default_payer(current_setting('test.row')::jsonb, true) ->> 'status', 'ok', 'a dry run: ok');
reset role;
select is((select count(*)::int from public.billing_payer_defaults where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, '… nothing written');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.import_default_payer(current_setting('test.row')::jsonb, false)::text, true);
reset role;
select results_eq($$ select client_id, payer_client_id, effective_from from public.billing_payer_defaults
                      where id = (current_setting('test.r')::jsonb ->> 'id')::uuid $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid, date '2025-09-01') $$,
  'Paul pays Léa''s invoices from that date');
select is(private.billing_default_payer('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', current_date),
  'd0000000-0000-0000-0000-000000000002'::uuid, '… her default payer today');
select is((select source from public.audit_log where table_name = 'billing_payer_defaults' and record_id = current_setting('test.r')::jsonb ->> 'id' and action = 'insert'),
  'import', 'written under the audit source « import »');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_default_payer(current_setting('test.row')::jsonb, false) ->> 'reason', 'Déjà le payeur par défaut', 'a re-run: skipped');
select is(public.import_default_payer('{"client_name": "Paul Essai", "payer_ref": "gorendezvous:602"}', false) ->> 'status', 'skipped',
  'the client pays herself: skipped');
select is(public.import_default_payer('{"client_name": "Léa Essai", "payer_name": "Anne Essai"}', false) ->> 'reason', 'payer_not_allowed',
  'a parent without « recevoir reçus et factures »: unmatched');
select is(public.import_default_payer('{"client_name": "Léa Essai", "payer_name": "Personne Inconnue"}', true) ->> 'reason', 'payer_not_found',
  'a payer not imported: unmatched');
select is(public.import_default_payer('{"client_name": "Personne Inconnue", "payer_name": "Paul Essai"}', true) ->> 'reason', 'client_not_found',
  'a client not imported: unmatched');
select is(public.import_default_payer('{"client_name": "Léa Essai", "payer_name": "Paul Essai", "effective_from": "1er septembre"}', true) -> 'errors' -> 0 ->> 'field',
  'effective_from', 'an unreadable date: refused');
reset role;

select * from finish();
rollback;
