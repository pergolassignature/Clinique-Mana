-- Facturation, R-78 (migration *_billing_relatives_opening_fee): no file-opening fee for a new file
-- when a relative already has a billed file.
-- Covers: the helper granted to no role; the file's own first invoice (fee); a relative's file
-- already billed (no fee, on the invoice and in the appointment sheet's preview); a file without
-- relative (fee); a relative's only invoice credited (fee again); the file's own credited invoice
-- (fee again); `p_except_invoice_id`; the explicit choice still wins; the morning queue's path
-- (the same private function) follows the rule.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select function_privs_are('private', 'billing_file_opening_due', array['uuid', 'uuid', 'uuid'], 'authenticated', array[]::text[],
  'billing_file_opening_due: not for users');

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
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
-- Léa and Marc spouses; Zoé alone; Ana and Ben siblings.
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@a.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai', 'marc@a.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Autre', 'zoe@a.test'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Ana', 'Soeur', 'ana@a.test'),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Ben', 'Frère', 'ben@a.test');
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'spouse', 'spouse'),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005', 'sibling', 'sibling');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
-- One completed session each (e1 Léa, e2 Marc, e3 Zoé, e4 Ana, e5 Ben, e6 Léa again, e7 Marc again), 2 to 8 days ago.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
select x.id, 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
       t.s, t.s + interval '50 minutes', t.s + interval '60 minutes', 'completed', t.s + interval '50 minutes'
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 8), ('e0000000-0000-0000-0000-000000000002'::uuid, 7),
    ('e0000000-0000-0000-0000-000000000003'::uuid, 6), ('e0000000-0000-0000-0000-000000000004'::uuid, 5),
    ('e0000000-0000-0000-0000-000000000005'::uuid, 4), ('e0000000-0000-0000-0000-000000000006'::uuid, 3),
    ('e0000000-0000-0000-0000-000000000007'::uuid, 2)
  ) as x(id, d)
  cross join lateral (select (((now() at time zone 'America/Toronto')::date - x.d + pg_catalog.make_time(9, 0, 0))
                               at time zone 'America/Toronto') as s) t;
insert into public.appointment_participants (appointment_id, client_id, org_id, presence) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'present'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'present'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'present'),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'present'),
  ('e0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present'),
  ('e0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'present');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- Léa's first invoice: her file's first, no relative billed.
select set_config('test.lea', public.create_invoice(array['e0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select ok(public.get_appointment_billing('e0000000-0000-0000-0000-000000000002') -> 'preview' -> 'file_opening' = 'null'::jsonb,
  'Marc, Léa''s spouse, once Léa is billed: the sheet''s preview says no file opening');
select set_config('test.marc', public.create_invoice(array['e0000000-0000-0000-0000-000000000002'::uuid])::text, true);
select set_config('test.zoe', public.create_invoice(array['e0000000-0000-0000-0000-000000000003'::uuid])::text, true);
-- Ana billed, issued, then credited; Ben (her brother) billed afterwards.
select set_config('test.ana', public.create_invoice(array['e0000000-0000-0000-0000-000000000004'::uuid])::text, true);
select lives_ok($$ select public.finalize_invoice(current_setting('test.ana')::uuid) $$, 'Ana''s invoice issued');
select lives_ok($$ select public.issue_credit_note(current_setting('test.ana')::uuid, 'Erreur') $$, '… then credited');
select set_config('test.ben', public.create_invoice(array['e0000000-0000-0000-0000-000000000005'::uuid])::text, true);
-- Marc again, explicitly asking for the fee: the choice wins.
select set_config('test.marc2', public.create_invoice(array['e0000000-0000-0000-0000-000000000007'::uuid], null, true)::text, true);
reset role;

select is((select count(*)::int from public.invoice_lines l where l.invoice_id = current_setting('test.lea')::uuid and l.line_type = 'file_opening'),
  1, 'Léa''s first invoice: the file-opening fee (her own file''s first, BI-6)');
select is((select count(*)::int from public.invoice_lines l where l.invoice_id = current_setting('test.marc')::uuid and l.line_type = 'file_opening'),
  0, 'Marc''s first invoice: no fee, his spouse already has a billed file (R-78)');
select is((select count(*)::int from public.invoice_lines l where l.invoice_id = current_setting('test.zoe')::uuid and l.line_type = 'file_opening'),
  1, 'Zoé, without relative: the fee');
select is((select count(*)::int from public.invoice_lines l where l.invoice_id = current_setting('test.ben')::uuid and l.line_type = 'file_opening'),
  1, 'Ben: his sister''s only invoice is credited, so the fee');
select is((select count(*)::int from public.invoice_lines l where l.invoice_id = current_setting('test.marc2')::uuid and l.line_type = 'file_opening'),
  1, 'an explicit « avec ouverture de dossier » still wins');

select is(private.billing_file_opening_due('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004'), false,
  'Ana: not due, her brother has a live invoice');
select is(private.billing_file_opening_due('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000005',
                                           current_setting('test.ben')::uuid), true,
  'Ben, his own new invoice left out: due (his sister''s is credited)');

-- Léa's invoice credited, Marc's two drafts deleted: no live invoice left in the family.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.delete_invoice_draft(current_setting('test.marc')::uuid);
select public.delete_invoice_draft(current_setting('test.marc2')::uuid);
select lives_ok($$ select public.finalize_invoice(current_setting('test.lea')::uuid) $$, 'Léa''s invoice issued');
select lives_ok($$ select public.issue_credit_note(current_setting('test.lea')::uuid, 'Erreur') $$, '… then credited');
select ok(public.get_appointment_billing('e0000000-0000-0000-0000-000000000006') -> 'preview' -> 'file_opening' <> 'null'::jsonb,
  'Léa, her only invoice credited: the preview names the fee again');
reset role;

-- The morning queue's path: the same private function, for Marc's next session.
select set_config('test.queue', private.billing_invoice_appointments('b0000000-0000-0000-0000-00000000000a',
  array['e0000000-0000-0000-0000-000000000007'::uuid], null, null, null, null, null, true)::text, true);
select is((select count(*)::int from public.invoice_lines l where l.invoice_id = current_setting('test.queue')::uuid and l.line_type = 'file_opening'),
  1, 'the queue''s draft for Marc: the fee, nobody in the family has a live invoice');

select * from finish();
rollback;
