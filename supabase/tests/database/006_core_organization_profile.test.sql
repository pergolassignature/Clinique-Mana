-- Organization profile columns (migration *_core_organization_profile.sql):
-- identity, tax numbers, signatory and Loi 25 columns on public.organizations.
-- Covers: column privileges, check constraints, audit of an update, read access for
-- every member (provider included), write refused without settings.manage, org isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider and a disabled admin;
-- org B with an admin.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'disabled@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Disabled A', 'disabled@a.test', 'disabled'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'admin@b.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');

-- =============================================================================
-- Privileges: table stays select-only, each new column has its own update grant
-- =============================================================================
select table_privs_are('public', 'organizations', 'anon', array[]::text[], 'anon: still no privileges on organizations');
select table_privs_are('public', 'organizations', 'authenticated', array['SELECT'], 'authenticated: still select only on organizations');

select column_privs_are('public', 'organizations', 'legal_name',             'authenticated', array['SELECT', 'UPDATE'], 'legal_name is updatable');
select column_privs_are('public', 'organizations', 'neq',                    'authenticated', array['SELECT', 'UPDATE'], 'neq is updatable');
select column_privs_are('public', 'organizations', 'address_line1',          'authenticated', array['SELECT', 'UPDATE'], 'address_line1 is updatable');
select column_privs_are('public', 'organizations', 'address_line2',          'authenticated', array['SELECT', 'UPDATE'], 'address_line2 is updatable');
select column_privs_are('public', 'organizations', 'city',                   'authenticated', array['SELECT', 'UPDATE'], 'city is updatable');
select column_privs_are('public', 'organizations', 'province',               'authenticated', array['SELECT', 'UPDATE'], 'province is updatable');
select column_privs_are('public', 'organizations', 'postal_code',            'authenticated', array['SELECT', 'UPDATE'], 'postal_code is updatable');
select column_privs_are('public', 'organizations', 'country',                'authenticated', array['SELECT'],           'country is read-only');
select column_privs_are('public', 'organizations', 'phone',                  'authenticated', array['SELECT', 'UPDATE'], 'phone is updatable');
select column_privs_are('public', 'organizations', 'email',                  'authenticated', array['SELECT', 'UPDATE'], 'email is updatable');
select column_privs_are('public', 'organizations', 'website',                'authenticated', array['SELECT', 'UPDATE'], 'website is updatable');
select column_privs_are('public', 'organizations', 'gst_number',             'authenticated', array['SELECT', 'UPDATE'], 'gst_number is updatable');
select column_privs_are('public', 'organizations', 'qst_number',             'authenticated', array['SELECT', 'UPDATE'], 'qst_number is updatable');
select column_privs_are('public', 'organizations', 'signatory_name',         'authenticated', array['SELECT', 'UPDATE'], 'signatory_name is updatable');
select column_privs_are('public', 'organizations', 'signatory_title',        'authenticated', array['SELECT', 'UPDATE'], 'signatory_title is updatable');
select column_privs_are('public', 'organizations', 'privacy_officer_name',   'authenticated', array['SELECT', 'UPDATE'], 'privacy_officer_name is updatable');
select column_privs_are('public', 'organizations', 'privacy_officer_email',  'authenticated', array['SELECT', 'UPDATE'], 'privacy_officer_email is updatable');
select column_privs_are('public', 'organizations', 'privacy_policy_url',     'authenticated', array['SELECT', 'UPDATE'], 'privacy_policy_url is updatable');
select column_privs_are('public', 'organizations', 'record_retention_years', 'authenticated', array['SELECT', 'UPDATE'], 'record_retention_years is updatable');

-- =============================================================================
-- Admin A: writes and checks
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select country from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'), 'CA', 'country defaults to CA');

select lives_ok($$
  update public.organizations set
    legal_name = '9999-9999 Québec inc.', neq = '1234567890',
    gst_number = '123456789RT0001', qst_number = '1234567890TQ0001',
    postal_code = 'H2X 1Y4', province = 'QC', phone = '+15145551234',
    website = 'https://cliniquemana.com', record_retention_years = 7
  where id = 'b0000000-0000-0000-0000-00000000000a'
$$, 'admin updates the organization profile');

select results_eq(
  $$ select legal_name, neq, gst_number, qst_number, postal_code, province, phone, website, record_retention_years
       from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('9999-9999 Québec inc.'::text, '1234567890'::text, '123456789RT0001'::text, '1234567890TQ0001'::text,
             'H2X 1Y4'::text, 'QC'::text, '+15145551234'::text, 'https://cliniquemana.com'::text, 7::smallint) $$,
  'admin reads the values back');

select lives_ok($$
  update public.organizations set
    address_line1 = '1234, rue Saint-Denis', address_line2 = 'Bureau 200', city = 'Montréal',
    email = 'info@cliniquemana.com', signatory_name = 'Marie Tremblay', signatory_title = 'Directrice',
    privacy_officer_name = 'Julie Gagnon', privacy_officer_email = 'confidentialite@cliniquemana.com',
    privacy_policy_url = 'https://cliniquemana.com/confidentialite'
  where id = 'b0000000-0000-0000-0000-00000000000a'
$$, 'admin fills the address, contact, signatory and privacy columns');
select results_eq(
  $$ select address_line1, address_line2, city, email, signatory_name, signatory_title,
            privacy_officer_name, privacy_officer_email, privacy_policy_url
       from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('1234, rue Saint-Denis'::text, 'Bureau 200'::text, 'Montréal'::text, 'info@cliniquemana.com'::text,
             'Marie Tremblay'::text, 'Directrice'::text, 'Julie Gagnon'::text,
             'confidentialite@cliniquemana.com'::text, 'https://cliniquemana.com/confidentialite'::text) $$,
  'admin reads those values back');

select lives_ok($$
  update public.organizations set address_line2 = null, website = null
  where id = 'b0000000-0000-0000-0000-00000000000a'
$$, 'admin clears optional fields back to null');
select ok((select address_line2 is null and website is null
             from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  'cleared fields read back as null');

select throws_ok($$ update public.organizations set neq = '123' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'NEQ must be 10 digits');
select throws_ok($$ update public.organizations set neq = '１２３４５６７８９０' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'NEQ refuses non-ASCII (fullwidth) digits');
select throws_ok($$ update public.organizations set gst_number = '123456789' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'GST number needs the RT program suffix');
select throws_ok($$ update public.organizations set qst_number = '1234567890RT0001' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'QST number needs the TQ program suffix');
select throws_ok($$ update public.organizations set postal_code = 'h2x1y4' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'postal code is stored normalised (A1A 1A1)');
select throws_ok($$ update public.organizations set province = 'XX' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'province must be a Canadian code');
select throws_ok($$ update public.organizations set phone = '514-555-1234' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'phone is stored in E.164 (+1XXXXXXXXXX)');
select throws_ok($$ update public.organizations set website = 'http://x.ca' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'website must use https');
select throws_ok($$ update public.organizations set email = 'pas-un-courriel' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'email must look like an email');
select throws_ok($$ update public.organizations set record_retention_years = 0 where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'retention is at least 1 year');
select throws_ok($$ update public.organizations set record_retention_years = 51 where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'retention is at most 50 years');
select throws_ok($$ update public.organizations set legal_name = '   ' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'legal name cannot be blank');
select throws_ok($$ update public.organizations set legal_name = E'\t\n' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'tabs and line breaks count as blank');
select throws_ok($$ update public.organizations set legal_name = repeat('a', 201) where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'legal name is at most 200 characters');
select throws_ok($$ update public.organizations set privacy_officer_email = 'a@b' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'privacy officer email must look like an email');
select throws_ok($$ update public.organizations set privacy_policy_url = 'cliniquemana.com/confidentialite' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'privacy policy URL must use https');
select throws_ok($$ update public.organizations set country = 'US' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'country cannot be changed by clients');

-- =============================================================================
-- Adjointe A (settings.view only): reads, cannot write
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is_empty($$
  update public.organizations set legal_name = 'Adjointe inc.', neq = '0000000000'
  where id = 'b0000000-0000-0000-0000-00000000000a' returning 1
$$, 'adjointe updates no row');
select results_eq(
  $$ select legal_name, neq from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('9999-9999 Québec inc.'::text, '1234567890'::text) $$,
  'adjointe reads the unchanged values');
select is((select gst_number from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  '123456789RT0001', 'adjointe reads the tax numbers');

-- =============================================================================
-- Provider A: reads the legal name (it appears on contracts), cannot write
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is((select legal_name from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  '9999-9999 Québec inc.', 'provider reads the legal name');
select is_empty($$
  update public.organizations set legal_name = 'Provider inc.'
  where id = 'b0000000-0000-0000-0000-00000000000a' returning 1
$$, 'provider updates no row');

-- =============================================================================
-- Disabled admin A: no current org, no permission, so no write
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select is_empty($$
  update public.organizations set legal_name = 'Disabled inc.'
  where id = 'b0000000-0000-0000-0000-00000000000a' returning 1
$$, 'disabled admin updates no row');

-- =============================================================================
-- Admin B: org A is invisible and untouchable
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

select is_empty($$ select legal_name from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  'org B admin cannot see org A');
select is_empty($$
  update public.organizations set legal_name = 'Hacked inc.'
  where id = 'b0000000-0000-0000-0000-00000000000a' returning 1
$$, 'org B admin updates no row of org A');

-- =============================================================================
-- As postgres: final state and audit
-- =============================================================================
reset role;

select is((select legal_name from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  '9999-9999 Québec inc.', 'org A legal name survived the refused writes');
select ok(exists (
  select 1 from public.audit_log
   where table_name = 'organizations'
     and record_id = 'b0000000-0000-0000-0000-00000000000a'
     and action = 'update'
     and actor_id = 'a0000000-0000-0000-0000-000000000001'
     and changed_fields ? 'neq'
     and changed_fields -> 'neq' = '{"before": null, "after": "1234567890"}'::jsonb
), 'the profile update is audited with its changed fields');

select * from finish();
rollback;
