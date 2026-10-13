-- Facturation FP, part 3 (migration *_billing_payer_documents): what a payer invoice prints.
-- Covers: Professionnels' published payer numbers (no role may call it); an IVAC invoice's payer
-- with the clinic's provider number and each professional's IVAC number; a PAE invoice's payer
-- with its own provider number and no IVAC number; a client's invoice unchanged (no numbers).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select function_privs_are('private', 'professional_payer_numbers_of', array['uuid', 'uuid[]', 'text'], r, array[]::text[],
                          'professional_payer_numbers_of: no ' || r)
  from (values ('authenticated'), ('anon')) as x(r);

insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
update public.payer_organisations set provider_number = 'FOURN-IVAC-1', billing_email = 'factures@ivac.test'
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'ivac';
select set_config('test.ivac', (select id::text from public.payer_organisations where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'ivac'), true);
insert into public.payer_organisations (id, org_id, kind, name, provider_number, cadence)
values ('f8000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'pae', 'Fournisseur X', 'FX-77', 'threshold');

insert into public.professionals (id, org_id, first_name, last_name, email, status, gender) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Pro', 'pro1@a.test', 'active', 'female'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Pro', 'pro2@a.test', 'active', 'male');
insert into public.professional_payer_numbers (org_id, professional_id, payer_type, number) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'ivac', 'IVAC-123'),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', 'ivac', 'IVAC-456');
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Ivan', 'Essai', 'ivan@a.test');

-- Three drafts of the same dossier: to IVAC (Hélène's session only), to the PAE, to the client.
insert into public.invoices (id, org_id, client_id, payer_kind, payer_client_id, payer_organisation_id, payer_reference, source_type) values
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'organisation',
   'd0000000-0000-0000-0000-000000000001', current_setting('test.ivac')::uuid, 'IV-1', 'payer'),
  ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'organisation',
   'd0000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', 'PX-9', 'payer'),
  ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'client',
   'd0000000-0000-0000-0000-000000000001', null, null, 'manual');
insert into public.invoice_lines (org_id, invoice_id, position, line_type, professional_id, description, unit_price_cents, subtotal_cents, total_cents)
select 'b0000000-0000-0000-0000-00000000000a', i::uuid, 1, 'service', 'c0000000-0000-0000-0000-000000000001', 'Séance', 9450, 9450, 9450
  from (values ('e1000000-0000-0000-0000-000000000001'), ('e1000000-0000-0000-0000-000000000002'), ('e1000000-0000-0000-0000-000000000003')) as x(i);

select is(private.billing_document('b0000000-0000-0000-0000-00000000000a', 'invoice', 'e1000000-0000-0000-0000-000000000001') -> 'payer_numbers',
  '[{"professional_id": "c0000000-0000-0000-0000-000000000001", "number": "IVAC-123"}]'::jsonb,
  'an IVAC invoice names its professional''s IVAC number, only hers');
select results_eq($$ select d -> 'payer' ->> 'organisation_kind', d -> 'payer' ->> 'provider_number', d -> 'payer' ->> 'name'
                       from private.billing_document('b0000000-0000-0000-0000-00000000000a', 'invoice', 'e1000000-0000-0000-0000-000000000001') d $$,
  $$ values ('ivac'::text, 'FOURN-IVAC-1'::text, 'IVAC'::text) $$, '… its payer: IVAC with the clinic''s provider number');
select is(private.billing_document('b0000000-0000-0000-0000-00000000000a', 'invoice', 'e1000000-0000-0000-0000-000000000002') -> 'payer_numbers',
  '[]'::jsonb, 'a PAE invoice names no IVAC number');
select is(private.billing_document('b0000000-0000-0000-0000-00000000000a', 'invoice', 'e1000000-0000-0000-0000-000000000002') -> 'payer' ->> 'provider_number',
  'FX-77', '… and carries its own provider number');
select is(private.billing_document('b0000000-0000-0000-0000-00000000000a', 'invoice', 'e1000000-0000-0000-0000-000000000003') -> 'payer_numbers',
  '[]'::jsonb, 'a client''s invoice: no payer number');

select * from finish();
rollback;
