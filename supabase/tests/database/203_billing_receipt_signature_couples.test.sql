-- Facturation, R-86 and R-87 (migration *_billing_receipt_signature_couples): what a receipt
-- prints of the professional's signature and of the people a session served.
-- Covers: a couple's session (two clients) names both people on its line, the file's client
-- first; an individual session names no one more; the professional's signature (bucket and path)
-- beside her receipt facts, none without one; the same through the user's preview RPC.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
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
select set_config('test.s60', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
-- e1: Léa and Marc together with Hélène (a couple's session); e2: Léa alone with Simon.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
select x.id, 'b0000000-0000-0000-0000-00000000000a', x.pro, current_setting('test.s60')::uuid,
       t.s, t.s + interval '50 minutes', t.s + interval '60 minutes', 'completed', t.s + interval '50 minutes'
  from (values ('e0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 3),
               ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 2)) as x(id, pro, d)
  cross join lateral (select (((now() at time zone 'America/Toronto')::date - x.d + pg_catalog.make_time(9, 0, 0))
                               at time zone 'America/Toronto') as s) t;
insert into public.appointment_participants (appointment_id, client_id, org_id, presence, role) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'present', 'second'),
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present', 'client'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present', 'client');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.couple', public.create_invoice(array['e0000000-0000-0000-0000-000000000001'::uuid], null, false)::text, true);
select set_config('test.alone', public.create_invoice(array['e0000000-0000-0000-0000-000000000002'::uuid], null, false)::text, true);
select public.finalize_invoice(current_setting('test.couple')::uuid);
select public.finalize_invoice(current_setting('test.alone')::uuid);
select set_config('test.r1', public.record_payment(current_setting('test.couple')::uuid, 'interac',
  (select i.total_cents from public.invoices i where i.id = current_setting('test.couple')::uuid))::text, true);
select set_config('test.r2', public.record_payment(current_setting('test.alone')::uuid, 'interac',
  (select i.total_cents from public.invoices i where i.id = current_setting('test.alone')::uuid))::text, true);
select set_config('test.preview', (public.get_billing_document('receipt', current_setting('test.r1')::uuid) -> 'document')::text, true);
reset role;

select set_config('test.d1', private.billing_document('b0000000-0000-0000-0000-00000000000a', 'receipt', current_setting('test.r1')::uuid)::text, true);
select set_config('test.d2', private.billing_document('b0000000-0000-0000-0000-00000000000a', 'receipt', current_setting('test.r2')::uuid)::text, true);

select is(current_setting('test.d1')::jsonb -> 'client' ->> 'name', 'Léa Essai', 'the couple''s receipt: the file''s client is Léa');
select results_eq($$ select s.v ->> 'id', s.v ->> 'name'
                      from pg_catalog.jsonb_array_elements(current_setting('test.d1')::jsonb -> 'lines') l,
                           pg_catalog.jsonb_array_elements(l -> 'served') with ordinality s(v, n)
                     where l ->> 'line_type' = 'service' order by s.n $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::text, 'Léa Essai'::text), ('d0000000-0000-0000-0000-000000000002', 'Marc Essai') $$,
  '… its session line names both people served, the first client first (R-87)');
select ok((select bool_and(l -> 'served' = 'null'::jsonb or not (l ? 'served'))
             from pg_catalog.jsonb_array_elements(current_setting('test.d2')::jsonb -> 'lines') l),
  'an individual session names no one more');

select is(current_setting('test.d1')::jsonb -> 'professionals' -> 0 -> 'signature',
  pg_catalog.jsonb_build_object('bucket', 'documents', 'object_path',
    'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000001/e1000000-0000-0000-0000-000000000001.png'),
  'Hélène''s signature beside her receipt facts (R-86)');
select is(current_setting('test.d1')::jsonb -> 'professionals' -> 0 ->> 'name', 'Hélène Un', '… her facts unchanged');
select is(current_setting('test.d2')::jsonb -> 'professionals' -> 0 -> 'signature', 'null'::jsonb,
  'Simon, without a signature: none');
select is(current_setting('test.preview')::jsonb -> 'professionals' -> 0 -> 'signature' ->> 'bucket', 'documents',
  'the preview RPC carries the same');

update public.stored_files set status = 'deleted', deleted_at = now() where id = 'e1000000-0000-0000-0000-000000000001';
select is(private.billing_document('b0000000-0000-0000-0000-00000000000a', 'receipt', current_setting('test.r1')::uuid)
            -> 'professionals' -> 0 -> 'signature', 'null'::jsonb,
  'a deleted image prints nothing');

select * from finish();
rollback;
