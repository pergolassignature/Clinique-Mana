-- Facturation, R-86 and R-87 (migration *_billing_receipt_signature_couples): what a receipt
-- prints of the people a session served and of the professional's signature.
-- Covers: a service for two with both present names both, the file's client first; an
-- individual service alone, an individual service with a companion present, and a service for
-- two with one absent name no one more; the signature images of a receipt's professionals for
-- the service role only (none without one, none for another clinic, none once deleted); the
-- user's preview document carries no storage path.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select function_privs_are('public', 'billing_receipt_signatures_for_service', array['uuid', 'uuid'], 'authenticated', array[]::text[],
  'billing_receipt_signatures_for_service: not for users');
select function_privs_are('public', 'billing_receipt_signatures_for_service', array['uuid', 'uuid'], 'service_role', array['EXECUTE'],
  'billing_receipt_signatures_for_service: the service role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Un', 'pro1@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Simon', 'Deux', 'pro2@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p.id, t.id, 'L-1', true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) as p(id)
  cross join public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, uploaded_by, confirmed_at)
values ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'documents',
        'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000001/e1000000-0000-0000-0000-000000000001.png',
        'professionals', 'professional_signature', 'professional', 'c0000000-0000-0000-0000-000000000001', 'signature.png', 'image/png',
        'png', 2048, repeat('a', 64), 'ready', 'professionals.manage', 'a0000000-0000-0000-0000-000000000002', now());
update public.professionals set signature_file_id = 'e1000000-0000-0000-0000-000000000001' where id = 'c0000000-0000-0000-0000-000000000001';
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@a.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai', 'marc@a.test');
-- e1: a couple's session (20160, for two), both present, with Hélène; e2: Léa alone (10150) with
-- Hélène; e3: Léa's individual session (10150) with Marc present beside her, with Simon; e4: a
-- couple's session, Marc absent.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
select x.id, 'b0000000-0000-0000-0000-00000000000a', x.pro,
       (select s.id from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = x.code),
       t.s, t.s + interval '50 minutes', t.s + interval '60 minutes', 'completed', t.s + interval '50 minutes'
  from (values ('e0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 20160, 5),
               ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 10150, 4),
               ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 10150, 3),
               ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 20160, 2)) as x(id, pro, code, d)
  cross join lateral (select (((now() at time zone 'America/Toronto')::date - x.d + pg_catalog.make_time(9, 0, 0))
                               at time zone 'America/Toronto') as s) t;
insert into public.appointment_participants (appointment_id, client_id, org_id, presence, role) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'present', 'second'),
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present', 'client'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present', 'client'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present', 'client'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'present', 'second'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present', 'client'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'absent', 'second');

-- One draft per session (the queue's path, a price left to type allowed).
select set_config('test.i' || n, private.billing_invoice_appointments('b0000000-0000-0000-0000-00000000000a',
         array[('e0000000-0000-0000-0000-00000000000' || n)::uuid], null, false, null, null, null, true)::text, true)
  from pg_catalog.generate_series(1, 4) n;

select results_eq($$ select s.v ->> 'id', s.v ->> 'name'
                      from pg_catalog.jsonb_array_elements(private.billing_lines('b0000000-0000-0000-0000-00000000000a',
                             array[current_setting('test.i1')::uuid])) l,
                           pg_catalog.jsonb_array_elements(l -> 'served') with ordinality s(v, n)
                     where l ->> 'line_type' = 'service' order by s.n $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::text, 'Léa Essai'::text), ('d0000000-0000-0000-0000-000000000002', 'Marc Essai') $$,
  'a service for two, both present: both people named, the file''s client first (R-87)');
select is((select l -> 'served' from pg_catalog.jsonb_array_elements(private.billing_lines('b0000000-0000-0000-0000-00000000000a',
             array[current_setting('test.i2')::uuid])) l where l ->> 'line_type' = 'service'), 'null'::jsonb,
  'an individual session alone: no one more');
select is((select l -> 'served' from pg_catalog.jsonb_array_elements(private.billing_lines('b0000000-0000-0000-0000-00000000000a',
             array[current_setting('test.i3')::uuid])) l where l ->> 'line_type' = 'service'), 'null'::jsonb,
  'an individual service with a companion present: the companion is never named');
select is((select l -> 'served' from pg_catalog.jsonb_array_elements(private.billing_lines('b0000000-0000-0000-0000-00000000000a',
             array[current_setting('test.i4')::uuid])) l where l ->> 'line_type' = 'service'), 'null'::jsonb,
  'a service for two, one absent: only the file''s client');

-- Receipts for e2 (Hélène, a signature) and e3 (Simon, none).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.finalize_invoice(current_setting('test.i2')::uuid);
select public.finalize_invoice(current_setting('test.i3')::uuid);
select set_config('test.r2', public.record_payment(current_setting('test.i2')::uuid, 'interac',
  (select i.total_cents from public.invoices i where i.id = current_setting('test.i2')::uuid))::text, true);
select set_config('test.r3', public.record_payment(current_setting('test.i3')::uuid, 'interac',
  (select i.total_cents from public.invoices i where i.id = current_setting('test.i3')::uuid))::text, true);
select set_config('test.preview', public.get_billing_document('receipt', current_setting('test.r2')::uuid)::text, true);
reset role;

select ok(current_setting('test.preview')::jsonb -> 'document' -> 'professionals' -> 0 ->> 'name' = 'Hélène Un'
          and position('/professionals/' in current_setting('test.preview')) = 0
          and not (current_setting('test.preview')::jsonb -> 'document' -> 'professionals' -> 0 ? 'signature'),
  'the user''s preview document names Hélène, never her signature''s storage path');

set local role service_role;
select is(public.billing_receipt_signatures_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.r2')::uuid),
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('professional_id', 'c0000000-0000-0000-0000-000000000001',
    'bucket', 'documents', 'object_path',
    'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000001/e1000000-0000-0000-0000-000000000001.png')),
  'the service role reads Hélène''s signature for her receipt (R-86)');
select is(public.billing_receipt_signatures_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.r3')::uuid),
  '[]'::jsonb, 'Simon, without a signature: none');
select is(public.billing_receipt_signatures_for_service('b0000000-0000-0000-0000-00000000000b', current_setting('test.r2')::uuid),
  '[]'::jsonb, 'another clinic: none');
reset role;

update public.stored_files set status = 'deleted', deleted_at = now() where id = 'e1000000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.billing_receipt_signatures_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.r2')::uuid),
  '[]'::jsonb, 'a deleted image: none');
reset role;

select * from finish();
rollback;
