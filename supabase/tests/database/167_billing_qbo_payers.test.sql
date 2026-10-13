-- Facturation, FQ follow-up (migration *_billing_qbo_payers.sql): a third-party payer's invoice
-- (FP) goes to the organisation's customer — the company's of the same name, matched once, else
-- made — through the dossier's sub-customer; the links, their shape and privileges; the payer
-- lines' names; Clients' merge moves the dossier's link (FQ-13).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'record_qbo_organisation_link_for_service'
     and (not p.prosecdef or has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the link RPC: SECURITY DEFINER, the service role only');
select table_privs_are('public', 'qbo_organisation_links', 'authenticated', array['SELECT'], 'the links: read only');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'u1@qy.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@qy.test', 'active');
insert into public.user_roles (user_id, org_id, role) values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@qy.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Doublon', 'lea2@qy.test');
insert into public.payer_organisations (id, org_id, kind, name, cadence)
values ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'pae', 'PAE Exemple', 'monthly');

-- A connected company, its chart, its tax codes; GOrendezvous's customer « PAE Exemple ».
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '123145', 'sandbox', 'Clinique A', 'acc-1', 'ref-1', now() + interval '1 hour', now() + interval '100 days');
select public.replace_qbo_accounts('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"10","name":"Services","account_type":"Income","active":true},
  {"id":"11","name":"Ventes","account_type":"Income","active":true}
]$j$);
select public.replace_qbo_tax_codes('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"4","name":"TPS/TVQ QC - 9,975","taxable":true,"active":true},
  {"id":"8","name":"Exonéré","taxable":false,"active":true}
]$j$);
select public.upsert_qbo_customers('b0000000-0000-0000-0000-00000000000a', now(), $j$[
  {"id":"777","display_name":"PAE Exemple","company_name":"PAE Exemple","hash":"h1"}
]$j$);
reset role;

-- An invoice of the dossier billed to the organisation (FP's shape).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.inv', public.create_manual_invoice('d0000000-0000-0000-0000-000000000001')::text, true);
select public.add_invoice_line(current_setting('test.inv')::uuid, 'adjustment', null, 'Séances de septembre', 1, 8000, false);
select ok(public.finalize_invoice(current_setting('test.inv')::uuid) is not null, 'fixture: the invoice issued');
reset role;
update public.invoices set payer_kind = 'organisation', payer_organisation_id = 'f0000000-0000-0000-0000-000000000001',
       payer_reference = 'PAE-42', source_type = 'payer'
 where id = current_setting('test.inv')::uuid;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.prep', public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'invoice_issued',
  current_setting('test.inv')::uuid, current_setting('test.inv')::uuid)::text, true);
select results_eq($$ select p -> 'organisation' ->> 'name', p -> 'organisation' ->> 'reference', p ->> 'organisation_customer_id',
                            (p ->> 'organisation_matched')::boolean, p ->> 'organisation_dossier_customer_id'
                       from (select current_setting('test.prep')::jsonb p) x $$,
  $$ values ('PAE Exemple', 'PAE-42', '777', true, null::text) $$,
  'an organisation''s invoice: the company''s customer of its name, to link; no dossier yet');
select lives_ok($$ select public.record_qbo_organisation_link_for_service('b0000000-0000-0000-0000-00000000000a', 'organisation',
  'f0000000-0000-0000-0000-000000000001', null, '777', 'matched') $$, 'the organisation linked (matched)');
select lives_ok($$ select public.record_qbo_organisation_link_for_service('b0000000-0000-0000-0000-00000000000a', 'dossier',
  'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '1001', 'created') $$, '… and the dossier''s sub-customer');
select results_eq($$ select (p ->> 'organisation_matched')::boolean, p ->> 'organisation_dossier_customer_id'
                       from (select public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'invoice_issued',
                               current_setting('test.inv')::uuid, current_setting('test.inv')::uuid) p) x $$,
  $$ values (false, '1001') $$, 'next time: linked, the dossier''s customer known');
select throws_ok($$ select public.record_qbo_organisation_link_for_service('b0000000-0000-0000-0000-00000000000a', 'payer',
  'f0000000-0000-0000-0000-000000000001', null, '778', 'created') $$, '22023', null, 'a link is an organisation or a dossier');
reset role;
select throws_ok($$ insert into public.qbo_organisation_links (connection_id, org_id, kind, payer_organisation_id, client_id, qbo_customer_id, source)
  select c.id, c.org_id, 'dossier', 'f0000000-0000-0000-0000-000000000001', null, '779', 'created' from public.qbo_connections c $$,
  '23514', null, 'a dossier link names its dossier');
select is(private.qbo_line_kind_name('payer_share'), 'Part payée par un tiers', 'the payer share''s item is named plainly');

-- Clients' merge: the dossier's link follows the kept file.
select cmp_ok(private.billing_reassign_client('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002'), '>=', 1,
  'a merge moves the organisation''s dossier link');
select is((select client_id from public.qbo_organisation_links where kind = 'dossier'), 'd0000000-0000-0000-0000-000000000002'::uuid,
  '… to the kept file');

select * from finish();
rollback;
