-- Professionnels: invitation delivery (migration *_professionals_invitation_delivery.sql, P4-490 –
-- P4-494). Covers: privileges (the table, the copy and stamp RPCs, the private body); an emailed
-- link's delivery row and its audit; « Copier le lien » (a new link, the previous one revoked, the
-- delivery `copied`, the audit naming the actor, the same refusals as an invitation); the stamp
-- (first failure only, emailed links of the clinic only, arguments); the onboarding line (delivery,
-- the latest invitation or reminder email since the link, the stamp when no email, nothing for a
-- copied link; the list reads the same); the reminders (a copied link is never due, a re-issued link
-- is an emailed one); the history tables.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

create function private.test_error_hint(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return nullif(v_hint, '');
end;
$$;
grant execute on function private.test_error_hint(text) to authenticated, service_role;

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'professional_invitation_deliveries', 'authenticated', array[]::text[], 'authenticated: nothing on the deliveries');
select table_privs_are('public', 'professional_invitation_deliveries', 'anon', array[]::text[], 'anon: nothing on the deliveries');
select function_privs_are('public', 'copy_professional_invitation_link', array['uuid', 'uuid', 'bytea'], 'service_role', array['EXECUTE'],
  'service_role copies a link (professionals-invite)');
select function_privs_are('public', 'copy_professional_invitation_link', array['uuid', 'uuid', 'bytea'], 'authenticated', array[]::text[],
  'a user never chooses the token hash');
select function_privs_are('public', 'copy_professional_invitation_link', array['uuid', 'uuid', 'bytea'], 'anon', array[]::text[], 'nor anon');
select function_privs_are('public', 'record_professional_invitation_email_failure_for_service', array['uuid', 'uuid', 'text'], 'service_role',
  array['EXECUTE'], 'service_role stamps a failure');
select function_privs_are('public', 'record_professional_invitation_email_failure_for_service', array['uuid', 'uuid', 'text'], 'authenticated',
  array[]::text[], 'a user may not');
select function_privs_are('private', 'create_professional_invitation', array['uuid', 'uuid', 'bytea', 'text', 'text'], 'service_role',
  array[]::text[], 'the shared body is granted to no role');
select function_privs_are('public', 'create_professional_invitation', array['uuid', 'uuid', 'bytea'], 'authenticated', array[]::text[],
  'create_professional_invitation keeps its grants: not authenticated');
select function_privs_are('public', 'list_professional_invitation_states', array[]::text[], 'authenticated', array['EXECUTE'],
  'the list states: authenticated');
select function_privs_are('public', 'list_professional_invitation_states', array[]::text[], 'service_role', array[]::text[],
  'the list states: not the service role (user-scoped)');

-- =============================================================================
-- Fixtures (as postgres): org A (admin, adjointe, conseillère), org B (admin). P1, P2 drafts,
-- P3 with an account, P4 inactive in org A; P5 draft in org B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status, deactivation_reason_id) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Un', 'p1@exemple.test', 'draft', null),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pia', 'Deux', 'p2@exemple.test', 'draft', null),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pat', 'Trois', 'provider@a.test', 'active', null),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', null, 'Paz', 'Quatre', 'p4@exemple.test', 'inactive',
   (select r.id from public.deactivation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'leave')),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', null, 'Pom', 'Cinq', 'p5@exemple.test', 'draft', null);
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';
select set_config('test.audit_start', (select coalesce(max(id), 0)::text from public.audit_log), true);

-- =============================================================================
-- An emailed link, then « Copier le lien » (service role, the actor named)
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.inv1', public.create_professional_invitation('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
  extensions.digest('token-1', 'sha256'))::text, true);
select set_config('test.copy1', public.copy_professional_invitation_link('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
  extensions.digest('token-2', 'sha256'))::text, true);
select throws_ok($$ select public.copy_professional_invitation_link('a0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001',
  extensions.digest('token-x', 'sha256')) $$, '42501', 'Permission refusée : professionals.invite', 'the conseillère cannot copy a link');
select throws_ok($$ select public.copy_professional_invitation_link('a0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001',
  extensions.digest('token-x', 'sha256')) $$, 'P0001', 'Professionnel introuvable.', 'nor another clinic''s admin');
select is(private.test_error_hint($$ select public.copy_professional_invitation_link('a0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000003', extensions.digest('token-x', 'sha256')) $$), 'account', 'a file with an account: refused (HINT account)');
select is(private.test_error_hint($$ select public.copy_professional_invitation_link('a0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000004', extensions.digest('token-x', 'sha256')) $$), 'status', 'an inactive file: refused (HINT status)');
select throws_ok($$ select public.copy_professional_invitation_link('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
  '\x00'::bytea) $$, '22023', null, 'a hash of 32 bytes only');
select throws_ok($$ select public.record_professional_invitation_email_failure_for_service('b0000000-0000-0000-0000-00000000000a',
  (current_setting('test.inv1')::jsonb ->> 'link_id')::uuid, 'Not Configured') $$, '22023', null, 'the stamp takes a code only');
reset role;

select is(current_setting('test.copy1')::jsonb - 'link_id' - 'submission_id' - 'expires_at',
  '{"email": "p1@exemple.test", "first_name": "Paul"}'::jsonb, 'the copy answers what the email would have needed (no token)');
select results_eq($$ select d.method, d.created_by, d.email_failure from public.professional_invitation_deliveries d
                      where d.link_id = (current_setting('test.inv1')::jsonb ->> 'link_id')::uuid $$,
  $$ values ('email'::text, 'a0000000-0000-0000-0000-000000000002'::uuid, null::text) $$, 'the invitation: an emailed delivery by the actor');
select results_eq($$ select d.method, d.created_by, d.org_id from public.professional_invitation_deliveries d
                      where d.link_id = (current_setting('test.copy1')::jsonb ->> 'link_id')::uuid $$,
  $$ values ('copied'::text, 'a0000000-0000-0000-0000-000000000002'::uuid, 'b0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'the copy: a copied delivery by the actor');
select ok((select l.revoked_at is not null from public.secure_links l where l.id = (current_setting('test.inv1')::jsonb ->> 'link_id')::uuid),
  'the copy revokes the emailed link');
select results_eq($$ select l.revoked_at is null, l.token_hash = extensions.digest('token-2', 'sha256'), l.scope
                      from public.secure_links l where l.id = (current_setting('test.copy1')::jsonb ->> 'link_id')::uuid $$,
  $$ values (true, true, '{"email": "p1@exemple.test"}'::jsonb) $$, 'the copied link is live, stored as its hash only, bound to the address');
select is((select s.secure_link_id from public.professional_submissions s
            where s.professional_id = 'c0000000-0000-0000-0000-000000000001' and s.kind = 'onboarding' and s.status = 'draft'),
  (current_setting('test.copy1')::jsonb ->> 'link_id')::uuid, 'the onboarding draft points at the copied link');
select ok(exists (select 1 from public.audit_log a where a.id > current_setting('test.audit_start')::bigint
                   and a.table_name = 'professional_invitation_deliveries' and a.action = 'insert'
                   and a.record_id like 'c0000000-0000-0000-0000-000000000001:%'
                   and a.changed_fields ->> 'method' = 'copied'
                   and a.actor_id = 'a0000000-0000-0000-0000-000000000002' and a.source = 'rpc:copy_professional_invitation_link'),
  'the copy is audited: who, when, which file');
select ok(exists (select 1 from public.audit_log a where a.id > current_setting('test.audit_start')::bigint
                   and a.table_name = 'professional_invitation_deliveries' and a.changed_fields ->> 'method' = 'email'
                   and a.source = 'rpc:create_professional_invitation'),
  'the emailed delivery is audited under create_professional_invitation');
select is_empty($$ select 1 from public.audit_log a where a.id > current_setting('test.audit_start')::bigint
                     and a.table_name = 'professional_invitation_deliveries'
                     and (a.changed_fields ? 'token_hash' or a.changed_fields::text like '%token%') $$,
  'no token nor hash in the deliveries'' audit');
select ok('professional_invitation_deliveries' = any (private.professional_history_tables()), 'the history reads the deliveries');

-- =============================================================================
-- The onboarding line
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select r -> 'invitation' ->> 'state', r -> 'invitation' ->> 'delivery', r -> 'invitation' -> 'email_status',
                            r -> 'invitation' -> 'email_error'
                       from public.get_professional_onboarding('c0000000-0000-0000-0000-000000000001') r $$,
  $$ values ('sent'::text, 'copied'::text, 'null'::jsonb, 'null'::jsonb) $$, 'a copied link: delivery copied, no email expected');
reset role;

-- P2: an emailed link without any email yet: no status, no stamp.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.inv2', public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002',
  extensions.digest('token-3', 'sha256'))::text, true);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select r -> 'invitation' ->> 'delivery', r -> 'invitation' -> 'email_status', r -> 'invitation' -> 'email_error'
                       from public.get_professional_onboarding('c0000000-0000-0000-0000-000000000002') r $$,
  $$ values ('email'::text, 'null'::jsonb, 'null'::jsonb) $$, 'an emailed link without an email: neither status nor failure');
reset role;

-- The function stamps a failure before queueing (not_configured): read back; a second stamp, a
-- copied link and another clinic change nothing.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$ select public.record_professional_invitation_email_failure_for_service('b0000000-0000-0000-0000-00000000000a',
  (current_setting('test.inv2')::jsonb ->> 'link_id')::uuid, 'not_configured') $$, 'the stamp');
select lives_ok($$ select public.record_professional_invitation_email_failure_for_service('b0000000-0000-0000-0000-00000000000a',
  (current_setting('test.inv2')::jsonb ->> 'link_id')::uuid, 'provider_error') $$, 'a second stamp');
select lives_ok($$ select public.record_professional_invitation_email_failure_for_service('b0000000-0000-0000-0000-00000000000a',
  (current_setting('test.copy1')::jsonb ->> 'link_id')::uuid, 'not_configured') $$, 'a stamp on a copied link');
select lives_ok($$ select public.record_professional_invitation_email_failure_for_service('b0000000-0000-0000-0000-00000000000b',
  (current_setting('test.inv1')::jsonb ->> 'link_id')::uuid, 'not_configured') $$, 'a stamp for another clinic');
reset role;
select results_eq($$ select d.link_id, d.email_failure from public.professional_invitation_deliveries d
                      where d.professional_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')
                      order by d.professional_id, d.method desc $$,
  $$ values ((current_setting('test.inv1')::jsonb ->> 'link_id')::uuid, null::text),
            ((current_setting('test.copy1')::jsonb ->> 'link_id')::uuid, null::text),
            ((current_setting('test.inv2')::jsonb ->> 'link_id')::uuid, 'not_configured'::text) $$,
  'only the first failure of an emailed link of the clinic is kept');
select ok(exists (select 1 from public.audit_log a where a.id > current_setting('test.audit_start')::bigint
                   and a.table_name = 'professional_invitation_deliveries' and a.action = 'update'
                   and a.source = 'rpc:record_professional_invitation_email_failure_for_service'),
  'the stamp is audited');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select r -> 'invitation' -> 'email_status', r -> 'invitation' ->> 'email_error'
                       from public.get_professional_onboarding('c0000000-0000-0000-0000-000000000002') r $$,
  $$ values ('null'::jsonb, 'not_configured'::text) $$, 'no email row: the stamped failure');
reset role;

-- Emails about P2: one older than the link (not read), then the link's own.
insert into public.email_log
  (id, org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, error_code, view_permission, created_at)
values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite', 0,
   'p2@exemple.test', 'professional', 'c0000000-0000-0000-0000-000000000002', 'delivered', null, 'professionals.view', now() - interval '1 day');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select r -> 'invitation' -> 'email_status', r -> 'invitation' ->> 'email_error'
                       from public.get_professional_onboarding('c0000000-0000-0000-0000-000000000002') r $$,
  $$ values ('null'::jsonb, 'not_configured'::text) $$, 'an email older than the link is another link''s: not read');
reset role;
insert into public.email_log
  (id, org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, error_code, view_permission, created_at)
values
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite', 0,
   'p2@exemple.test', 'professional', 'c0000000-0000-0000-0000-000000000002', 'failed', 'provider_unavailable', 'professionals.view', now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select r -> 'invitation' ->> 'email_status', r -> 'invitation' ->> 'email_error'
                       from public.get_professional_onboarding('c0000000-0000-0000-0000-000000000002') r $$,
  $$ values ('failed'::text, 'provider_unavailable'::text) $$, 'the link''s email: its status and code (the stamp gives way to the row)');
select results_eq($$ select s.professional_id, s.delivery, s.email_status, s.email_error from public.list_professional_invitation_states() s
                      order by s.professional_id $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid, 'copied'::text, null::text, null::text),
            ('c0000000-0000-0000-0000-000000000002'::uuid, 'email'::text, 'failed'::text, 'provider_unavailable'::text) $$,
  'the list reads the same columns');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.list_professional_invitation_states()), 0, 'admin B reads none of org A');
reset role;
update public.email_log set status = 'delivered', error_code = null where id = 'e0000000-0000-0000-0000-000000000002';
insert into public.email_log
  (id, org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, error_code, view_permission, created_at)
values
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.profile_update', 0,
   'p2@exemple.test', 'professional', 'c0000000-0000-0000-0000-000000000002', 'bounced', null, 'professionals.view', now() + interval '1 second');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select r -> 'invitation' ->> 'email_status', r -> 'invitation' -> 'email_error'
                       from public.get_professional_onboarding('c0000000-0000-0000-0000-000000000002') r $$,
  $$ values ('delivered'::text, 'null'::jsonb) $$, 'another template does not count: the invitation was delivered');
reset role;

-- =============================================================================
-- The reminders: a copied link is never due; a re-issued link is an emailed delivery
-- =============================================================================
update public.secure_links l set created_at = now() - interval '4 days'
 where l.id in ((current_setting('test.copy1')::jsonb ->> 'link_id')::uuid, (current_setting('test.inv2')::jsonb ->> 'link_id')::uuid);
delete from public.email_log where subject_id = 'c0000000-0000-0000-0000-000000000002';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq($$ select * from public.list_professional_invitations_to_remind_for_service('b0000000-0000-0000-0000-00000000000a', 100) $$,
  $$ values ('c0000000-0000-0000-0000-000000000002'::uuid) $$, 'the emailed link is due, the copied one never');
select ok(public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  extensions.digest('token-4', 'sha256')) is null, 'the copied link is not re-issued');
select set_config('test.re2', public.reissue_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a',
  'c0000000-0000-0000-0000-000000000002', extensions.digest('token-5', 'sha256'))::text, true);
reset role;
select results_eq($$ select d.method, d.created_by, d.email_failure from public.professional_invitation_deliveries d
                      where d.link_id = (current_setting('test.re2')::jsonb ->> 'link_id')::uuid $$,
  $$ values ('email'::text, null::uuid, null::text) $$, 'the re-issued link: an emailed delivery by the system');
select ok((select l.revoked_at is null from public.secure_links l where l.id = (current_setting('test.copy1')::jsonb ->> 'link_id')::uuid),
  'the copied link still works');

select * from finish();
rollback;
