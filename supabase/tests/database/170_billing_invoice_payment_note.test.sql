-- Parity audit P13 (migration *_billing_invoice_payment_note, decision BI-21): what an invoice
-- says about paying. The clinic's Interac address (Paramètres → Coordonnées bancaires) and a
-- standing note per language (Paramètres → Facturation, « reçu dans les 24 h ouvrables » by
-- default), in the document's data and the invoice emails' catalogue.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select function_privs_are('public', 'set_billing_invoice_note', array['text', 'text'], 'authenticated', array['EXECUTE'], 'set_billing_invoice_note: users');
select function_privs_are('private', 'billing_default_invoice_note', array['text'], 'authenticated', array[]::text[], 'the default note: no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@a.test'), ('a0000000-0000-0000-0000-000000000002', 'adjointe@a.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
select u::uuid, 'b0000000-0000-0000-0000-00000000000a', n, e, 'active'
  from (values ('a0000000-0000-0000-0000-000000000001', 'Admin A', 'admin@a.test'),
               ('a0000000-0000-0000-0000-000000000002', 'Adjointe A', 'adjointe@a.test')) as v(u, n, e);
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);

-- The defaults, before anything is set.
select alike(private.billing_clinic('b0000000-0000-0000-0000-00000000000a') ->> 'invoice_note_fr', '%24 h ouvrables%',
  'a clinic''s invoices say the receipt follows within 24 business hours, by default (fr)');
select alike(private.billing_clinic('b0000000-0000-0000-0000-00000000000a') ->> 'invoice_note_en', '%24 business hours%', '… and in English');
select is(private.billing_clinic('b0000000-0000-0000-0000-00000000000a') ->> 'etransfer_email', null, 'no Interac address yet');

-- Fictitious bank details (test values only).
insert into public.organization_bank_details (org_id, institution_number, transit_number, account_number, account_last4, etransfer_email)
values ('b0000000-0000-0000-0000-00000000000a', '001', '00011', '\x00'::bytea, '0000', 'paiements@a.test');
select is(private.billing_clinic('b0000000-0000-0000-0000-00000000000a') ->> 'etransfer_email', 'paiements@a.test',
  'the clinic''s Interac address, from its bank details');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_billing_invoice_note('Merci', null) $$, '42501', 'Permission refusée : billing.settings',
  'the adjointe does not change the note');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format($$ select public.set_billing_invoice_note(%L, null) $$, repeat('x', 1001)), 'P0001',
  'La note des factures compte 1 000 caractères au plus.', 'a note of 1 000 characters at most');
select lives_ok($$ select public.set_billing_invoice_note('  Merci de payer le jour même.  ', '') $$, 'the admin sets the notes');
select results_eq($$ select s ->> 'invoice_note_fr', s ->> 'invoice_note_en', (s ->> 'invoice_note_fr_default')::boolean
                       from public.get_billing_settings() s $$,
  $$ values ('Merci de payer le jour même.'::text, ''::text, false) $$, 'the notes saved: French trimmed, English none');
reset role;
select is(private.billing_clinic('b0000000-0000-0000-0000-00000000000a') ->> 'invoice_note_en', '', '… none in English');

-- The invoice emails know the variable.
select is((select count(*)::int from public.email_template_defaults d, pg_catalog.jsonb_array_elements(d.variables) v
            where d.key in ('billing.invoice', 'billing.invoice_en') and v ->> 'path' = 'document.payment_note'
              and d.body like '%{{document.payment_note}}%'), 2, 'the invoice emails print the payment note');

select * from finish();
rollback;
