-- Facturation: « Bill annulé dans QuickBooks » (migration *_billing_qbo_bill_voided.sql, BI-27).
-- Covers: the verified path's two service RPCs (the permission first, the caller's org, a
-- validated period with a Bill, the Bill unchanged), the override (billing.payroll and
-- billing.settings, a reason of 10 characters at least), what forgetting a Bill does (the
-- invoice's id cleared, its push `failed` / `bill_voided` with a new generation, a clearance
-- row, the audit with the actor and the reason redacted), the reopening it allows, the push's
-- generation, and the period's read (the Bill id for the administration only).
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@bv.test'), ('a0000000-0000-0000-0000-000000000002', 'adjointe@bv.test'),
               ('a0000000-0000-0000-0000-000000000003', 'pro1@bv.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
select u::uuid, 'b0000000-0000-0000-0000-00000000000a', n, e, 'active'
  from (values ('a0000000-0000-0000-0000-000000000001', 'Admin A', 'admin@bv.test'),
               ('a0000000-0000-0000-0000-000000000002', 'Adjointe A', 'adjointe@bv.test'),
               ('a0000000-0000-0000-0000-000000000003', 'Pro Un', 'pro1@bv.test')) as v(u, n, e);
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select o, m, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o)
 cross join (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pro', 'Un', 'pro1@bv.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@bv.test', 'active'),
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', null, 'Pro', 'Bé', 'prob@bv.test', 'active');

insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
  view_permission, original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
select f::uuid, 'b0000000-0000-0000-0000-00000000000a', u.bucket,
       'b0000000-0000-0000-0000-00000000000a/billing/c0000000-0000-0000-0000-000000000001/' || f || '.pdf',
       'billing', u.key, 'payout_period', 'c0000000-0000-0000-0000-000000000001', 'billing.payroll', 'facture.pdf',
       'application/pdf', 'pdf', 1000, repeat('a', 64), 'ready', now()
  from public.upload_purposes u
 cross join (values ('e0000000-0000-0000-0000-000000000001'), ('e0000000-0000-0000-0000-000000000002'),
                    ('e0000000-0000-0000-0000-000000000003'), ('e0000000-0000-0000-0000-000000000004')) as x(f)
 where u.key = 'billing_professional_invoice';
-- P1 (Pro Un, September): its Bill 901 pushed. P2 (Pro Deux): no Bill. P3 (Pro Un, August): paid, Bill
-- 903. P4 (Pro Deux, August): Bill 904 pushed. PB: another clinic's.
insert into public.payout_periods (id, org_id, professional_id, month, state, validated_at, paid_at, paid_on, lines_count, total_cents) values
  ('f5000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   date '2026-09-01', 'validated', now(), null, null, 1, 345000),
  ('f5000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
   date '2026-09-01', 'validated', now(), null, null, 1, 120000),
  ('f5000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   date '2026-08-01', 'paid', now(), now(), date '2026-09-05', 1, 99000),
  ('f5000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
   date '2026-08-01', 'validated', now(), null, null, 1, 88000),
  ('f5000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b1',
   date '2026-09-01', 'validated', now(), null, null, 1, 10000);
insert into public.professional_invoices (id, org_id, period_id, source, file_id, number, issued_on, amount_cents) values
  ('f6000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001',
   'uploaded', 'e0000000-0000-0000-0000-000000000001', 'PU-2026-09', date '2026-10-01', 345000),
  ('f6000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000002',
   'uploaded', 'e0000000-0000-0000-0000-000000000002', 'PD-2026-09', date '2026-10-01', 120000),
  ('f6000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000003',
   'uploaded', 'e0000000-0000-0000-0000-000000000003', 'PU-2026-08', date '2026-09-01', 99000),
  ('f6000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000004',
   'uploaded', 'e0000000-0000-0000-0000-000000000004', 'PD-2026-08', date '2026-09-01', 88000);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select isnt(public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '123145', 'sandbox', 'Clinique A', 'acc-1', 'ref-1', now() + interval '1 hour', now() + interval '100 days'), null,
  'fixture: a QuickBooks company');
select is(public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'bill', i::uuid, null, null, b, null, null), 'pushed',
  'fixture: bill ' || b || ' pushed')
  from (values ('f6000000-0000-0000-0000-000000000001', '901'), ('f6000000-0000-0000-0000-000000000003', '903'),
               ('f6000000-0000-0000-0000-000000000004', '904')) as x(i, b);

-- =============================================================================
-- The period's read: the Bill id for the administration only
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_payout_period('f5000000-0000-0000-0000-000000000001') #>> '{invoice,qbo_bill_id}', '901',
  'get_payout_period: the administration reads the invoice''s Bill id');
select is(public.get_payout_period('f5000000-0000-0000-0000-000000000002') #>> '{invoice,qbo_bill_id}', null,
  '… none when QuickBooks has no Bill');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok((public.get_payout_period('f5000000-0000-0000-0000-000000000001') -> 'invoice') ? 'number'
          and (public.get_payout_period('f5000000-0000-0000-0000-000000000001') #>> '{invoice,qbo_bill_id}') is null,
  '… the professional reads her invoice, never its Bill id');

-- =============================================================================
-- The verified path: qbo_bill_to_check_for_service, clear_qbo_bill_for_service
-- =============================================================================
select ok(not has_function_privilege('authenticated', 'public.qbo_bill_to_check_for_service(uuid, uuid, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.clear_qbo_bill_for_service(uuid, uuid, uuid, text)', 'execute'),
  'the verified path''s RPCs are the service role''s only');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select public.qbo_bill_to_check_for_service('a0000000-0000-0000-0000-000000000002',
                     'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001') $$,
  '42501', 'Permission refusée : billing.payroll', 'check: a caller without billing.payroll is refused first');
select throws_ok($$ select public.qbo_bill_to_check_for_service('a0000000-0000-0000-0000-000000000001',
                     'b0000000-0000-0000-0000-00000000000b', 'f5000000-0000-0000-0000-0000000000b1') $$,
  '42501', 'Permission refusée : billing.payroll', '… another clinic than the caller''s is refused');
select throws_ok($$ select public.qbo_bill_to_check_for_service('a0000000-0000-0000-0000-000000000001',
                     'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-0000000000b1') $$,
  'P0001', 'Période de paie introuvable.', '… another clinic''s period is not found');
select throws_ok($$ select public.qbo_bill_to_check_for_service('a0000000-0000-0000-0000-000000000001',
                     'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000002') $$,
  'P0001', 'La facture de cette période n''a pas de Bill dans QuickBooks.', '… a period without a Bill');
select throws_ok($$ select public.qbo_bill_to_check_for_service('a0000000-0000-0000-0000-000000000001',
                     'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Seule la facture d''une période validée et non versée se détache de QuickBooks.', '… a paid period');
select is(public.qbo_bill_to_check_for_service('a0000000-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001'), '{"bill_id": "901"}'::jsonb,
  '… a validated period''s Bill to ask QuickBooks about');

select throws_ok($$ select public.clear_qbo_bill_for_service('a0000000-0000-0000-0000-000000000002',
                     'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', '901') $$,
  '42501', 'Permission refusée : billing.payroll', 'clear: a caller without billing.payroll is refused first');
select throws_ok($$ select public.clear_qbo_bill_for_service('a0000000-0000-0000-0000-000000000001',
                     'b0000000-0000-0000-0000-00000000000b', 'f5000000-0000-0000-0000-0000000000b1', '901') $$,
  '42501', 'Permission refusée : billing.payroll', '… another clinic than the caller''s is refused');
select throws_ok($$ select public.clear_qbo_bill_for_service('a0000000-0000-0000-0000-000000000001',
                     'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', '999') $$,
  'P0001', 'Le Bill de cette période a changé entre-temps : vérifiez de nouveau.', '… only the Bill QuickBooks was asked about');
select lives_ok($$ select public.clear_qbo_bill_for_service('a0000000-0000-0000-0000-000000000001',
                    'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', '901') $$,
  '… QuickBooks said the Bill is gone: forgotten');
reset role;
select results_eq($$ select qbo_bill_id, exported_at from public.professional_invoices where id = 'f6000000-0000-0000-0000-000000000001' $$,
  $$ values (null::text, null::timestamptz) $$, 'the invoice forgets its Bill');
select results_eq($$ select status, qbo_id, pushed_at, last_error_code, generation from public.qbo_pushes
                      where kind = 'bill' and entity_id = 'f6000000-0000-0000-0000-000000000001' $$,
  $$ values ('failed'::text, null::text, null::timestamptz, 'bill_voided'::text, 1) $$,
  '… its push failed (bill_voided), a new generation: nothing pushed by itself');
select results_eq($$ select method, qbo_bill_id, reason, cleared_by from public.qbo_bill_clearances
                      where professional_invoice_id = 'f6000000-0000-0000-0000-000000000001' $$,
  $$ values ('verified'::text, '901'::text, null::text, 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  '… a clearance row: verified, the Bill, who');
select results_eq($$ select source, actor_id, changed_fields #>> '{qbo_bill_id,before}' from public.audit_log
                      where table_name = 'professional_invoices' and record_id = 'f6000000-0000-0000-0000-000000000001'
                        and action = 'update' order by id desc limit 1 $$,
  $$ values ('fn:qbo-bill-check'::text, 'a0000000-0000-0000-0000-000000000001'::uuid, '901'::text) $$,
  '… audited on the invoice: the function, the caller, the Bill before');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::int from public.qbo_bills_to_push_for_service('b0000000-0000-0000-0000-00000000000a')
            where invoice_id = 'f6000000-0000-0000-0000-000000000001'), 0, '… and not in the bills to push');
select throws_ok($$ select public.clear_qbo_bill_for_service('a0000000-0000-0000-0000-000000000001',
                     'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', '901') $$,
  'P0001', 'La facture de cette période n''a pas de Bill dans QuickBooks.', '… forgotten once');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.reopen_payout_period('f5000000-0000-0000-0000-000000000001', 'Erreur de calcul') $$,
  'the period reopens now');
reset role;
select is((select state from public.payout_periods where id = 'f5000000-0000-0000-0000-000000000001'), 'to_validate',
  '… back to « À valider », its invoice detached');

-- =============================================================================
-- The override: force_clear_qbo_bill
-- =============================================================================
-- The assistant may run the payroll here, not QuickBooks.
insert into public.org_role_permissions (org_id, role, permission_key)
values ('b0000000-0000-0000-0000-00000000000a', 'admin_assistant', 'billing.payroll');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.force_clear_qbo_bill('f5000000-0000-0000-0000-000000000004', 'QuickBooks est inaccessible aujourd''hui') $$,
  '42501', 'Permission refusée : billing.settings', 'force: billing.payroll alone is not enough');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.force_clear_qbo_bill('f5000000-0000-0000-0000-000000000004', 'QuickBooks est inaccessible aujourd''hui') $$,
  '42501', null, '… nor is the professional allowed');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.force_clear_qbo_bill('f5000000-0000-0000-0000-000000000004', 'Supprimé') $$,
  'P0001', 'Indiquez la raison (10 à 500 caractères).', '… the reason is required (10 characters at least)');
select throws_ok($$ select public.force_clear_qbo_bill('f5000000-0000-0000-0000-000000000004', null) $$,
  'P0001', 'Indiquez la raison (10 à 500 caractères).', '… never without one');
select throws_ok($$ select public.force_clear_qbo_bill('f5000000-0000-0000-0000-0000000000b1', 'QuickBooks est inaccessible aujourd''hui') $$,
  'P0001', 'Période de paie introuvable.', '… another clinic''s period is not found');
select throws_ok($$ select public.force_clear_qbo_bill('f5000000-0000-0000-0000-000000000002', 'QuickBooks est inaccessible aujourd''hui') $$,
  'P0001', 'La facture de cette période n''a pas de Bill dans QuickBooks.', '… a period without a Bill');
select throws_ok($$ select public.force_clear_qbo_bill('f5000000-0000-0000-0000-000000000003', 'QuickBooks est inaccessible aujourd''hui') $$,
  'P0001', 'Seule la facture d''une période validée et non versée se détache de QuickBooks.', '… a paid period');
select lives_ok($$ select public.force_clear_qbo_bill('f5000000-0000-0000-0000-000000000004', '  Bill 904 supprimé, QuickBooks déconnecté  ') $$,
  '… an administrator with a reason: forgotten');
reset role;
select results_eq($$ select method, qbo_bill_id, reason, cleared_by from public.qbo_bill_clearances
                      where professional_invoice_id = 'f6000000-0000-0000-0000-000000000004' $$,
  $$ values ('override'::text, '904'::text, 'Bill 904 supprimé, QuickBooks déconnecté'::text, 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  '… a clearance row: override, the Bill, the reason (trimmed), who');
select results_eq($$ select changed_fields ->> 'reason', changed_fields ->> 'method', source from public.audit_log
                      where table_name = 'qbo_bill_clearances' and action = 'insert' and changed_fields ->> 'qbo_bill_id' = '904' $$,
  $$ values ('[redacted]'::text, 'override'::text, 'rpc:force_clear_qbo_bill'::text) $$,
  '… audited, the reason redacted as the module''s other reasons');
select results_eq($$ select qbo_bill_id, (select status from public.qbo_pushes q where q.kind = 'bill' and q.entity_id = i.id)
                      from public.professional_invoices i where i.id = 'f6000000-0000-0000-0000-000000000004' $$,
  $$ values (null::text, 'failed'::text) $$, '… the invoice forgets its Bill, its push failed');

-- « Réessayer » pushes the same invoice again, with the new generation (a new requestid).
select set_config('test.push_id', (select q.id::text from public.qbo_pushes q
                                     where q.kind = 'bill' and q.entity_id = 'f6000000-0000-0000-0000-000000000004'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.retry_qbo_push(current_setting('test.push_id')::uuid) $$,
  '« Réessayer » on the forgotten Bill');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq($$ select generation, attempts from public.qbo_bills_to_push_for_service('b0000000-0000-0000-0000-00000000000a')
                      where invoice_id = 'f6000000-0000-0000-0000-000000000004' $$,
  $$ values (1, 0) $$, '… back in the bills to push, generation 1');
select results_eq($$ select generation from public.qbo_bills_to_push_for_service('b0000000-0000-0000-0000-00000000000a')
                      where invoice_id = 'f6000000-0000-0000-0000-000000000002' $$,
  $$ values (0) $$, '… a bill never pushed: generation 0 (its requestid unchanged)');
reset role;

select * from finish();
rollback;
