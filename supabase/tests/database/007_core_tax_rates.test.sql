-- Dated tax rates (migration *_core_tax_rates.sql): tax_rates, seeding trigger,
-- tax_rate_on / add_tax_rate / delete_tax_rate.
-- Covers: seeding of new orgs, privileges, rate lookup by date, appending and
-- deleting rates, the no-overlap exclusion constraint, role access, org isolation, audit.
-- « Clinic today » (test.today) is computed like private.clinic_today(): now() in org A's
-- time zone, read from the org. now() is fixed for the whole transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe and a provider; org B with an admin;
-- org C with an admin (its seeded rates are left fresh, created_at = now()).
-- All orgs are created after the migration, so the seeding trigger runs.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@c.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B'),
  ('b0000000-0000-0000-0000-00000000000c', 'Org C');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'admin@b.test'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000c', 'Admin C',    'admin@c.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000c', 'admin');

-- =============================================================================
-- Seeding: GST 5 % from 2008 and QST 9.975 % from 2013, both open
-- =============================================================================
select results_eq(
  $$ select tax, rate, effective_from, effective_to from public.tax_rates
      where org_id = 'b0000000-0000-0000-0000-00000000000a' order by tax $$,
  $$ values ('gst'::text, 0.05::numeric, '2008-01-01'::date, null::date),
            ('qst'::text, 0.09975::numeric, '2013-01-01'::date, null::date) $$,
  'org A is seeded with the default GST and QST rates');
select results_eq(
  $$ select tax, rate, effective_from, effective_to from public.tax_rates
      where org_id = 'b0000000-0000-0000-0000-00000000000b' order by tax $$,
  $$ values ('gst'::text, 0.05::numeric, '2008-01-01'::date, null::date),
            ('qst'::text, 0.09975::numeric, '2013-01-01'::date, null::date) $$,
  'org B is seeded with the default GST and QST rates');

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'tax_rates', 'anon', array[]::text[], 'anon: no privileges on tax_rates');
select table_privs_are('public', 'tax_rates', 'authenticated', array['SELECT'], 'authenticated: select only on tax_rates');

select function_privs_are('public', 'tax_rate_on',     array['text', 'date'],            'anon', array[]::text[], 'anon cannot call tax_rate_on');
select function_privs_are('public', 'add_tax_rate',    array['text', 'numeric', 'date'], 'anon', array[]::text[], 'anon cannot call add_tax_rate');
select function_privs_are('public', 'delete_tax_rate', array['uuid'],                    'anon', array[]::text[], 'anon cannot call delete_tax_rate');
select function_privs_are('public', 'tax_rate_on',     array['text', 'date'],            'authenticated', array['EXECUTE'], 'authenticated can call tax_rate_on');
select function_privs_are('public', 'add_tax_rate',    array['text', 'numeric', 'date'], 'authenticated', array['EXECUTE'], 'authenticated can call add_tax_rate');
select function_privs_are('public', 'delete_tax_rate', array['uuid'],                    'authenticated', array['EXECUTE'], 'authenticated can call delete_tax_rate');
select function_privs_are('private', 'seed_org_tax_rates', array[]::text[], 'authenticated', array[]::text[], 'clients cannot execute the seeding trigger function');
select function_privs_are('private', 'seed_org_tax_rates', array[]::text[], 'service_role',  array[]::text[], 'service_role cannot execute the seeding trigger function');

-- =============================================================================
-- Table checks (as postgres)
-- =============================================================================
select throws_ok($$ insert into public.tax_rates (org_id, tax, rate, effective_from)
                    values ('b0000000-0000-0000-0000-00000000000a', 'qst', 0.1, '2020-01-01') $$,
  '23P01', null, 'an overlapping QST period is refused by the exclusion constraint');
select lives_ok($$ insert into public.tax_rates (org_id, tax, rate, effective_from, effective_to)
                   values ('b0000000-0000-0000-0000-00000000000b', 'qst', 0.1, '2000-01-01', '2013-01-01') $$,
  'an adjacent period ([) bounds) does not overlap');
select throws_ok($$ insert into public.tax_rates (org_id, tax, rate, effective_from, effective_to)
                    values ('b0000000-0000-0000-0000-00000000000b', 'gst', 0.07, '2000-01-01', '2000-01-01') $$,
  '23514', null, 'a period must end after it starts');
select throws_ok($$ insert into public.tax_rates (org_id, tax, rate, effective_from)
                    values ('b0000000-0000-0000-0000-00000000000b', 'hst', 0.13, '2030-01-01') $$,
  '23514', null, 'only gst and qst are stored');
-- Undo the adjacent row so org B keeps its two seeded rates.
delete from public.tax_rates where org_id = 'b0000000-0000-0000-0000-00000000000b' and effective_from = '2000-01-01';

-- Clinic today, from org A's time zone (org B has the same default).
select set_config('test.today',
  ((now() at time zone (select timezone from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'))::date)::text, true);
-- The seeded rows were created in this transaction: move org A's and B's out of
-- the 24-hour correction window so « in force » rules apply to them. Org C keeps
-- fresh rows, as a newly created org (or staging right after the backfill) has.
update public.tax_rates set created_at = now() - interval '1 year'
 where org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');

-- =============================================================================
-- Admin A: lookups
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(public.tax_rate_on('qst', '2020-06-01'), 0.09975::numeric, 'QST on 2020-06-01 is 9.975 %');
select is(public.tax_rate_on('gst', '2008-01-01'), 0.05::numeric, 'GST applies from its first day');
select is(public.tax_rate_on('gst', '2007-12-31'), null::numeric, 'no GST before 2008');

-- =============================================================================
-- Admin A: add_tax_rate
-- =============================================================================
select isnt(public.add_tax_rate('qst', 0.1, current_setting('test.today')::date + 30), null::uuid, 'admin adds a future QST rate');
select results_eq(
  $$ select rate, effective_from, effective_to from public.tax_rates
      where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'qst' order by effective_from $$,
  $$ values (0.09975::numeric, '2013-01-01'::date, current_setting('test.today')::date + 30),
            (0.1::numeric, current_setting('test.today')::date + 30, null::date) $$,
  'the open QST rate is closed on the new start date');
select is(public.tax_rate_on('qst', current_setting('test.today')::date + 29), 0.09975::numeric, 'the old rate applies the day before');
select is(public.tax_rate_on('qst', current_setting('test.today')::date + 30), 0.1::numeric, 'the new rate applies from its start date');
select is((select created_by from public.tax_rates where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'qst' and effective_to is null),
  'a0000000-0000-0000-0000-000000000001'::uuid, 'the new rate records who added it');

select throws_ok($$ select public.add_tax_rate('qst', 0.11, '2013-01-01') $$,
  'P0001', 'Le nouveau taux doit commencer après le ' || to_char(current_setting('test.today')::date + 30, 'YYYY-MM-DD') || '.',
  'a new rate must start after the open one');
select throws_ok($$ select public.add_tax_rate('hst', 0.13, '2030-01-01') $$,
  '22023', null, 'unknown tax is a technical error');
select throws_ok($$ select public.add_tax_rate('gst', 1.2, '2030-01-01') $$,
  'P0001', 'Le taux doit être d''au moins 0 % et de moins de 100 %.', 'a rate of 120 % is refused');
select throws_ok($$ select public.add_tax_rate('gst', -0.01, '2030-01-01') $$,
  'P0001', 'Le taux doit être d''au moins 0 % et de moins de 100 %.', 'a negative rate is refused');
select throws_ok($$ select public.add_tax_rate('gst', 0.9999995, '2030-01-01') $$,
  'P0001', 'Le taux doit être d''au moins 0 % et de moins de 100 %.', 'a rate rounding to 100 % is refused before the table check');
select throws_ok($$ select public.add_tax_rate('gst', 0.05, null) $$,
  'P0001', 'La date d''entrée en vigueur est requise.', 'a start date is required');

select isnt(public.add_tax_rate('qst', 0.09975000000000001, current_setting('test.today')::date + 60), null::uuid, 'admin adds a rate with extra decimals');
select is((select rate::text from public.tax_rates where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'qst' and effective_from = current_setting('test.today')::date + 60),
  '0.099750', 'the rate is stored rounded to 6 decimals');

-- =============================================================================
-- Admin A: delete_tax_rate
-- =============================================================================
select throws_ok($$ select public.delete_tax_rate((select id from public.tax_rates
                      where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'qst' and effective_from = '2013-01-01')) $$,
  'P0001', 'Seul le dernier taux peut être supprimé.', 'a closed rate cannot be deleted');
select throws_ok($$ select public.delete_tax_rate((select id from public.tax_rates
                      where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'gst')) $$,
  'P0001', 'Un taux déjà en vigueur ne peut pas être supprimé.', 'the GST rate in force (created long ago) cannot be deleted');
select throws_ok($$ select public.delete_tax_rate('00000000-0000-0000-0000-000000000000') $$,
  'P0001', 'Taux introuvable.', 'an unknown id is reported');
select lives_ok($$ select public.delete_tax_rate((select id from public.tax_rates
                     where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'qst' and effective_from = current_setting('test.today')::date + 60)) $$,
  'admin deletes the last future QST rate');
select lives_ok($$ select public.delete_tax_rate((select id from public.tax_rates
                     where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'qst' and effective_to is null)) $$,
  'admin deletes the next future QST rate');
select results_eq(
  $$ select rate, effective_from, effective_to from public.tax_rates where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'qst' $$,
  $$ values (0.09975::numeric, '2013-01-01'::date, null::date) $$,
  'the previous QST rate is open again');
select is(public.tax_rate_on('qst', current_setting('test.today')::date + 30), 0.09975::numeric, 'the old rate applies again after the deletion');

-- =============================================================================
-- Admin A: back-dated rate and the 24-hour correction window
-- =============================================================================
select isnt(public.add_tax_rate('gst', 0.06, current_setting('test.today')::date - 10), null::uuid, 'a back-dated rate is accepted');
select results_eq(
  $$ select rate, effective_from, effective_to from public.tax_rates
      where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'gst' order by effective_from $$,
  $$ values (0.05::numeric, '2008-01-01'::date, current_setting('test.today')::date - 10), (0.06::numeric, current_setting('test.today')::date - 10, null::date) $$,
  'the back-dated rate closes the open rate on its start date');
select lives_ok($$ select public.delete_tax_rate((select id from public.tax_rates
                     where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'gst' and effective_to is null)) $$,
  'a back-dated rate created just now can be deleted (correction window)');
select results_eq(
  $$ select rate, effective_from, effective_to from public.tax_rates where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'gst' $$,
  $$ values (0.05::numeric, '2008-01-01'::date, null::date) $$,
  'the previous GST rate is open again');

select isnt(public.add_tax_rate('gst', 0.06, current_setting('test.today')::date - 10), null::uuid, 'admin adds the back-dated rate again');
reset role;
update public.tax_rates set created_at = now() - interval '25 hours'
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'gst' and effective_to is null;
set local role authenticated;
select throws_ok($$ select public.delete_tax_rate((select id from public.tax_rates
                      where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'gst' and effective_to is null)) $$,
  'P0001', 'Un taux déjà en vigueur ne peut pas être supprimé.', 'a back-dated rate created 25 hours ago cannot be deleted');

-- =============================================================================
-- Adjointe A (settings.view): reads, cannot write
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select throws_ok($$ select public.add_tax_rate('qst', 0.1, '2099-01-01') $$,
  '42501', null, 'adjointe cannot add a rate');
select throws_ok($$ select public.delete_tax_rate((select id from public.tax_rates
                      where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'gst' and effective_to is null)) $$,
  '42501', null, 'adjointe cannot delete a rate');
select is((select count(*)::int from public.tax_rates where tax = 'qst'), 1, 'adjointe reads the QST history');
select is((select count(*)::int from public.tax_rates), 3, 'adjointe reads every rate of her org (GST 2008, GST back-dated, QST 2013)');
select is(public.tax_rate_on('qst', '2020-06-01'), 0.09975::numeric, 'adjointe looks up a rate');

-- =============================================================================
-- Provider A: reads the rates (receipts need them)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is((select count(*)::int from public.tax_rates), 3, 'provider reads the rates');
select is(public.tax_rate_on('gst', '2020-06-01'), 0.05::numeric, 'provider looks up a rate');
select throws_ok($$ select public.add_tax_rate('qst', 0.1, '2099-01-01') $$,
  '42501', null, 'provider cannot add a rate');
select set_config('test.org_a_gst_id',
  (select id::text from public.tax_rates where tax = 'gst' and effective_to is null), true);

-- =============================================================================
-- Admin B: sees and changes only org B
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

select results_eq($$ select distinct org_id from public.tax_rates $$,
  array['b0000000-0000-0000-0000-00000000000b'::uuid], 'org B admin sees only org B rates');
select is((select count(*)::int from public.tax_rates), 2, 'org B still has exactly its two seeded rates');
select is(public.tax_rate_on('gst', current_setting('test.today')::date), 0.05::numeric, 'org B lookups ignore org A rates');
-- Org A's open GST id, stashed while org A was visible: admin A would get
-- « déjà en vigueur », so « introuvable » proves the row is out of reach.
select throws_ok($$ select public.delete_tax_rate(current_setting('test.org_a_gst_id')::uuid) $$,
  'P0001', 'Taux introuvable.', 'org B admin cannot delete an org A rate');
select lives_ok($$ select public.add_tax_rate('qst', 0.1, '2099-01-01') $$, 'org B admin adds a rate to org B');

-- =============================================================================
-- As postgres: org A untouched by org B, audit
-- =============================================================================
reset role;

select is((select count(*)::int from public.tax_rates where org_id = 'b0000000-0000-0000-0000-00000000000a'), 3,
  'org A has its 3 rates after org B''s writes');
select is((select count(*)::int from public.audit_log
            where table_name = 'tax_rates' and action = 'insert' and org_id = 'b0000000-0000-0000-0000-00000000000a'),
  6, 'org A: 2 seeded + 4 added rates are audited as inserts');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'tax_rates' and action = 'update' and org_id = 'b0000000-0000-0000-0000-00000000000a'
     and actor_id = 'a0000000-0000-0000-0000-000000000001'
     and changed_fields -> 'effective_to' = jsonb_build_object('before', null, 'after', current_setting('test.today')::date + 30)
), 'closing the open rate is audited');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'tax_rates' and action = 'update' and org_id = 'b0000000-0000-0000-0000-00000000000a'
     and changed_fields -> 'effective_to' = jsonb_build_object('before', current_setting('test.today')::date + 30, 'after', null)
), 'reopening the previous rate is audited');
select is((select count(*)::int from public.audit_log
            where table_name = 'tax_rates' and action = 'delete' and org_id = 'b0000000-0000-0000-0000-00000000000a'),
  3, 'the 3 deleted rates are audited');

-- =============================================================================
-- Inconsistent history: a gap before the open rate. Deleting it must not leave
-- QST with no open rate.
-- =============================================================================
update public.tax_rates set effective_to = '2020-01-01'
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'qst' and effective_from = '2013-01-01';
insert into public.tax_rates (org_id, tax, rate, effective_from) values ('b0000000-0000-0000-0000-00000000000a', 'qst', 0.1, current_setting('test.today')::date + 90);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.delete_tax_rate((select id from public.tax_rates
                      where org_id = 'b0000000-0000-0000-0000-00000000000a' and tax = 'qst' and effective_to is null)) $$,
  'P0001', 'Le premier taux d''une taxe ne peut pas être supprimé.',
  'a delete that cannot reopen the previous rate (gap) is refused');
select is((select count(*)::int from public.tax_rates where tax = 'qst' and effective_to is null), 1,
  'the refused delete left the open QST rate in place');


-- =============================================================================
-- Admin C: a freshly seeded rate is inside the correction window but is the
-- tax's first rate, so it cannot be deleted (the tax would have no rate left).
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);

select ok((select created_at > now() - interval '24 hours' from public.tax_rates where tax = 'gst'),
  'org C''s seeded GST rate is inside the correction window');
select throws_ok($$ select public.delete_tax_rate((select id from public.tax_rates where tax = 'gst')) $$,
  'P0001', 'Le premier taux d''une taxe ne peut pas être supprimé.', 'a fresh seeded rate cannot be deleted');
select is(public.tax_rate_on('gst', current_setting('test.today')::date), 0.05::numeric,
  'org C still has its GST rate');

select * from finish();
rollback;
