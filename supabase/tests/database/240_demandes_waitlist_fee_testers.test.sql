-- Demandes and Facturation (migration *_demandes_waitlist_fee_testers.sql): « Facturer
-- l'inscription » while Demandes is reserved for its testers (D-52, P3-40). Covers: the helper
-- granted to no role; the RPC answers the number and who holds the email; Facturation off, no
-- dossier, a fee not « À facturer » (a second click) still refused while reserved; reserved → the
-- invoice is made and finalised as always, the entry « Facturés », its delivery queued without
-- email (the PDF only); Facturation's later sends of that invoice (« Renvoyer », the receipt of a
-- payment) are held and the next-day card charge skips it, while Demandes is reserved; the entry
-- still follows its invoice (paid); Demandes open → the email is queued and prepared for the payer,
-- the card charge takes it; Facturation reserved, Demandes open → held by Facturation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

create function private.test_error_hint(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), sqlstate);
end;
$$;
grant execute on function private.test_error_hint(text) to authenticated;

select function_privs_are('private', 'billing_source_sends_held', array['uuid', 'text'], r, array[]::text[],
  'billing_source_sends_held: granted to no role (' || r || ')')
  from (values ('authenticated'), ('service_role'), ('anon')) as x(r);
select function_returns('public', 'invoice_waitlist_fee', array['uuid'], 'jsonb', 'invoice_waitlist_fee answers jsonb');

-- =============================================================================
-- Fixtures: a counselor (Demandes' tester) and an adjointe; Alice, Bruno and Chloé with an address
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cons@wt.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adj@wt.test',  '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@wt.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adj@wt.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('demandes'), ('appointments')) as y(m);
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Attente', 'alice@wt.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Attente', 'bruno@wt.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Attente', 'chloe@wt.test');
select set_config('test.psy', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' order by sort_order, key limit 1), true);
select set_config('test.psy2', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' order by sort_order, key offset 1 limit 1), true);

-- Demandes reserved for its testers (the counselor is one).
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
insert into public.org_module_testers (org_id, module_key, user_id) values ('b0000000-0000-0000-0000-00000000000a', 'demandes', 'a0000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d1', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000001"}')::text, true);
select set_config('test.d2', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000002"}')::text, true);
select set_config('test.d3', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000003"}')::text, true);
select set_config('test.e1', (public.register_waitlist(current_setting('test.d1')::uuid,
  format('[{"title_id": "%s"}]', current_setting('test.psy'))::jsonb))[1]::text, true);
select set_config('test.e2', (public.register_waitlist(current_setting('test.d2')::uuid,
  format('[{"title_id": "%s"}]', current_setting('test.psy'))::jsonb))[1]::text, true);
select set_config('test.e3', (public.register_waitlist(current_setting('test.d3')::uuid,
  format('[{"title_id": "%s"}]', current_setting('test.psy'))::jsonb))[1]::text, true);
reset role;
-- An entry without its client's dossier.
insert into public.waitlist_entries (id, org_id, demande_id, client_id, target_profession_title_id, fee_status)
values ('f0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', current_setting('test.d1')::uuid, null,
        current_setting('test.psy2')::uuid, 'to_invoice');

-- =============================================================================
-- 1. The other refusals stand while Demandes is reserved
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format($$ select public.invoice_waitlist_fee(%L) $$, current_setting('test.e1')),
  'P0001', 'La Facturation n''est pas activée : notez les frais à la main (payés ou exonérés).', 'reserved, Facturation off: still refused');
reset role;
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'billing', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_error_hint($$ select public.invoice_waitlist_fee('f0000000-0000-0000-0000-000000000009') $$), 'client_id',
  'reserved, no dossier: still refused');

-- =============================================================================
-- 2. Reserved: the invoice is made and finalised, its email held
-- =============================================================================
select set_config('test.r1', public.invoice_waitlist_fee(current_setting('test.e1')::uuid)::text, true);
select ok(current_setting('test.r1')::jsonb ->> 'number' ~ '^[0-9]{4}-1$', 'reserved: the invoice has the year''s first number');
select is(current_setting('test.r1')::jsonb ->> 'email_held_by', 'demandes', '… and says Demandes holds its email');
select throws_ok(format($$ select public.invoice_waitlist_fee(%L) $$, current_setting('test.e1')),
  'P0001', 'Les frais de cette inscription ne sont pas « À facturer ».', 'a second click: still refused');
reset role;
select set_config('test.i1', (select fee_invoice_id::text from public.waitlist_entries where id = current_setting('test.e1')::uuid), true);
select results_eq($$ select fee_status from public.waitlist_entries where id = current_setting('test.e1')::uuid $$,
  $$ values ('invoiced'::text) $$, 'the entry is « Facturés »');
select results_eq($$ select i.status, i.number, i.source_type, i.finalized_at is not null, i.payer_client_id
                       from public.invoices i where i.id = current_setting('test.i1')::uuid $$,
  format($$ values ('issued'::text, %L::text, 'waitlist_fee'::text, true, 'd0000000-0000-0000-0000-000000000001'::uuid) $$,
         current_setting('test.r1')::jsonb ->> 'number'),
  'the invoice is issued and finalised with that number, to the dossier''s payer');
select results_eq($$ select kind, send_email from public.billing_deliveries where invoice_id = current_setting('test.i1')::uuid $$,
  $$ values ('invoice'::text, false) $$, 'its one delivery: the PDF, no email');
select ok(public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 25) is not null, 'the delivery claimed');
select set_config('test.doc', public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a',
  (select id from public.billing_deliveries where invoice_id = current_setting('test.i1')::uuid))::text, true);
select is(current_setting('test.doc')::jsonb ->> 'skip_reason', 'not_requested', 'the delivery prepares the PDF only');
select is(current_setting('test.doc')::jsonb -> 'email', 'null'::jsonb, '… with no address to write to');
select ok(private.billing_source_sends_held('b0000000-0000-0000-0000-00000000000a', 'waitlist_fee'), 'the waitlist fee''s sends are held');
select ok(not private.billing_source_sends_held('b0000000-0000-0000-0000-00000000000a', 'manual'), '… not a source without a module');

-- =============================================================================
-- 3. Facturation's later sends of that invoice are held too
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.resend', public.send_billing_document('invoice', current_setting('test.i1')::uuid)::text, true);
reset role;
select ok(public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 25) is not null, '« Renvoyer au payeur » claimed');
select set_config('test.doc', public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a',
  current_setting('test.resend')::uuid)::text, true);
select is(current_setting('test.doc')::jsonb ->> 'skip_reason', 'reserved', '« Renvoyer au payeur »: held while Demandes is reserved');
select is(current_setting('test.doc')::jsonb -> 'email', 'null'::jsonb, '… no address');

-- The next-day card charge skips it while Demandes is reserved.
insert into public.org_secrets (org_id, key, vault_secret_id)
values ('b0000000-0000-0000-0000-00000000000a', 'stripe_secret_key', vault.create_secret('sk_test_x', 'org:test-wt:stripe_secret_key'));
insert into public.stripe_customers (org_id, payer_client_id, stripe_customer_id, payment_method_id, card_brand, card_last4,
                                     card_exp_month, card_exp_year, card_status, consent_at)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'cus_AliceWt', 'pm_Card4242', 'visa', '4242',
        12, 2030, 'active', now() - interval '1 day');
select is((select count(*)::int from public.stripe_charges_due_for_service('b0000000-0000-0000-0000-00000000000a')
            where invoice_id = current_setting('test.i1')::uuid), 0, 'the next-day charge skips it while Demandes is reserved');
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
select is((select count(*)::int from public.stripe_charges_due_for_service('b0000000-0000-0000-0000-00000000000a')
            where invoice_id = current_setting('test.i1')::uuid), 1, '… and takes it once Demandes is open');
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';

-- Paid: the entry follows (« Payés »); the receipt's email is held.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.total', (select total_cents::text from public.invoices where id = current_setting('test.i1')::uuid), true);
select public.record_payment(current_setting('test.i1')::uuid, 'interac', current_setting('test.total')::int);
reset role;
select results_eq($$ select fee_status from public.waitlist_entries where id = current_setting('test.e1')::uuid $$,
  $$ values ('paid'::text) $$, 'paid: the entry is « Payés »');
select ok(public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 25) is not null, 'the receipt claimed');
select is(public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a',
            (select id from public.billing_deliveries where invoice_id = current_setting('test.i1')::uuid and kind = 'receipt')) ->> 'skip_reason',
  'reserved', 'the receipt''s email is held too');

-- =============================================================================
-- 4. Demandes open to all: the email is queued and goes to the payer
-- =============================================================================
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r2', public.invoice_waitlist_fee(current_setting('test.e2')::uuid)::text, true);
reset role;
select ok(current_setting('test.r2')::jsonb ->> 'number' ~ '^[0-9]{4}-2$', 'open: the next number');
select is(current_setting('test.r2')::jsonb -> 'email_held_by', 'null'::jsonb, '… nothing holds its email');
select set_config('test.i2', (select fee_invoice_id::text from public.waitlist_entries where id = current_setting('test.e2')::uuid), true);
select results_eq($$ select kind, send_email from public.billing_deliveries where invoice_id = current_setting('test.i2')::uuid $$,
  $$ values ('invoice'::text, true) $$, 'its delivery asks for the email');
select ok(public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 25) is not null, 'the delivery claimed');
select set_config('test.doc', public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a',
  (select id from public.billing_deliveries where invoice_id = current_setting('test.i2')::uuid))::text, true);
select is(current_setting('test.doc')::jsonb -> 'email' ->> 'to', 'bruno@wt.test', '… prepared for the payer''s address');

-- =============================================================================
-- 5. Facturation reserved, Demandes open: Facturation holds it
-- =============================================================================
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';
insert into public.org_module_testers (org_id, module_key, user_id) values ('b0000000-0000-0000-0000-00000000000a', 'billing', 'a0000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.invoice_waitlist_fee(current_setting('test.e3')::uuid) ->> 'email_held_by', 'billing',
  'Facturation reserved: the RPC says Facturation holds the email');
reset role;

select * from finish();
rollback;
