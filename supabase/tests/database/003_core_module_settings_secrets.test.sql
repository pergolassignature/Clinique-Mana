-- Module settings, module toggling and Vault secrets
-- (migration 20261007140741_core_module_settings_secrets.sql).
-- Covers: privileges (functions asserted with function_privs_are, never throws_ok),
-- dependency rules, list_modules, secret lifecycle + audit, cross-org isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(83);

-- =============================================================================
-- Fixtures (as postgres)
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'admin@b.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');

-- test_child depends on test_parent.
insert into public.modules (key, name) values ('test_parent', 'Test parent'), ('test_child', 'Test enfant');
insert into public.module_dependencies (module_key, depends_on) values ('test_child', 'test_parent');
insert into public.org_module_settings (org_id, module_key, settings) values
  ('b0000000-0000-0000-0000-00000000000a', 'test_parent', '{"reminder_hours": 24}');

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'org_module_settings', 'anon', array[]::text[], 'anon: no privileges on org_module_settings');
select table_privs_are('public', 'org_module_settings', 'authenticated', array['SELECT'], 'authenticated: select only on org_module_settings');
select table_privs_are('public', 'org_secrets', 'anon', array[]::text[], 'anon: no privileges on org_secrets');
select table_privs_are('public', 'org_secrets', 'authenticated', array[]::text[], 'authenticated: no privileges on org_secrets');

select function_privs_are('public', 'get_org_secret', array['uuid', 'text'], 'anon', array[]::text[], 'anon cannot read secret values');
select function_privs_are('public', 'get_org_secret', array['uuid', 'text'], 'authenticated', array[]::text[], 'clients cannot read secret values');
select function_privs_are('public', 'get_org_secret', array['uuid', 'text'], 'service_role', array['EXECUTE'], 'service_role can read secret values');

select function_privs_are('private', 'org_secrets_delete_vault', array[]::text[], 'service_role', array[]::text[], 'nobody can execute the vault-cleanup trigger function');
select function_privs_are('public', 'module_enabled',       array['text'],            'anon', array[]::text[], 'anon cannot call module_enabled');
select function_privs_are('public', 'set_module_enabled',   array['text', 'boolean'], 'anon', array[]::text[], 'anon cannot call set_module_enabled');
select function_privs_are('public', 'list_modules',         array[]::text[],          'anon', array[]::text[], 'anon cannot call list_modules');
select function_privs_are('public', 'set_org_secret',       array['text', 'text'],    'anon', array[]::text[], 'anon cannot call set_org_secret');
select function_privs_are('public', 'delete_org_secret',    array['text'],            'anon', array[]::text[], 'anon cannot call delete_org_secret');
select function_privs_are('public', 'list_org_secret_keys', array[]::text[],          'anon', array[]::text[], 'anon cannot call list_org_secret_keys');

select function_privs_are('public', 'module_enabled',       array['text'],            'authenticated', array['EXECUTE'], 'authenticated can call module_enabled');
select function_privs_are('public', 'set_module_enabled',   array['text', 'boolean'], 'authenticated', array['EXECUTE'], 'authenticated can call set_module_enabled');
select function_privs_are('public', 'list_modules',         array[]::text[],          'authenticated', array['EXECUTE'], 'authenticated can call list_modules');
select function_privs_are('public', 'set_org_secret',       array['text', 'text'],    'authenticated', array['EXECUTE'], 'authenticated can call set_org_secret');
select function_privs_are('public', 'delete_org_secret',    array['text'],            'authenticated', array['EXECUTE'], 'authenticated can call delete_org_secret');
select function_privs_are('public', 'list_org_secret_keys', array[]::text[],          'authenticated', array['EXECUTE'], 'authenticated can call list_org_secret_keys');

-- module_enabled_for_org: the module gate for functions without a user (webhooks, cron).
select function_privs_are('public', 'module_enabled_for_org', array['uuid', 'text'], 'anon', array[]::text[], 'anon cannot call module_enabled_for_org');
select function_privs_are('public', 'module_enabled_for_org', array['uuid', 'text'], 'authenticated', array[]::text[], 'clients cannot call module_enabled_for_org');
select function_privs_are('public', 'module_enabled_for_org', array['uuid', 'text'], 'service_role', array['EXECUTE'], 'service_role can call module_enabled_for_org');

-- Only the intended RPCs are exposed through the API.
select functions_are('public', array[
  'get_my_access', 'module_enabled', 'module_enabled_for_org', 'set_module_enabled', 'list_modules',
  'set_org_secret', 'delete_org_secret', 'list_org_secret_keys', 'get_org_secret',
  'tax_rate_on', 'add_tax_rate', 'delete_tax_rate',
  'get_bank_details', 'reveal_bank_account_number', 'set_bank_details', 'pii_health_check',
  'list_org_users', 'set_user_role', 'set_user_status', 'set_permission_override', 'clear_permission_override',
  'clear_permission_overrides',
  'set_role_permission', 'create_role', 'rename_role', 'delete_role',
  'list_audit_entries', 'list_audit_actors',
  'consume_rate_limit', 'claim_webhook_event', 'complete_webhook_event', 'fail_webhook_event', 'last_webhook_event_at',
  'list_job_orgs', 'start_job_run', 'finish_job_run',
  'list_scheduled_jobs', 'list_scheduled_job_runs', 'set_scheduled_job_enabled', 'run_scheduled_job_now',
  'set_email_sender', 'set_email_sending_domain', 'list_email_templates', 'save_email_template', 'reset_email_template',
  'list_email_log', 'list_subject_emails',
  'get_email_context', 'queue_email', 'mark_email_sent', 'mark_email_failed', 'apply_email_event', 'count_org_emails_today',
  'create_notification', 'list_my_notifications', 'count_my_unread_notifications', 'mark_notifications_read',
  'mark_all_notifications_read',
  'peek_secure_link',
  'create_staff_invitation', 'renew_staff_invitation', 'revoke_staff_invitation', 'list_staff_invitations',
  'resolve_staff_invitation', 'accept_staff_invitation',
  'create_pending_upload', 'get_pending_upload', 'confirm_stored_file', 'reject_stored_file', 'register_system_file',
  'list_files_to_purge', 'mark_files_purged', 'set_org_asset',
  'set_signing_settings', 'create_document_template', 'create_template_version', 'update_template_version',
  'publish_template_version', 'archive_template_version', 'list_document_templates',
  'list_subject_signature_requests', 'get_signature_request',
  'get_signing_context', 'create_signature_request', 'mark_signature_request_sent', 'mark_signature_request_failed',
  'apply_signing_event', 'complete_signature_request', 'list_signature_requests_to_reconcile', 'expire_signature_request',
  'set_document_template_active', 'cancel_signature_request',
  'get_signing_request', 'discard_system_file', 'begin_signature_request_send', 'recover_signature_request',
  'get_signing_credentials', 'record_signature_sync', 'list_unverified_signature_requests',
  'save_professional_order', 'save_profession_category', 'save_profession_title', 'save_clientele', 'save_motif_category', 'save_motif', 'save_language', 'save_deactivation_reason', 'set_professionals_reference_active', 'reorder_professionals_reference', 'get_professionals_catalog', 'get_professionals_settings', 'set_professionals_settings',
  'create_professional', 'set_professional_email', 'set_professional_professions', 'set_professional_clienteles', 'set_professional_motifs', 'set_professional_languages', 'set_professional_payer_number', 'list_professionals_reference_usage',
  'get_professional_readiness', 'activate_professional', 'deactivate_professional', 'list_professionals', 'get_professional_record', 'get_professional_public_profile', 'list_professional_history',
  'import_professional',
  'get_professional_private', 'reveal_professional_private', 'set_professional_tax_numbers', 'set_professional_bank',
  'set_professional_sin', 'clear_professional_private_field',
  'set_compensation_rate', 'delete_compensation_rate', 'set_retention_grid', 'delete_retention_grid',
  'record_monthly_sessions', 'decide_retention', 'delete_professional_retention',
  'set_professional_client_agreement', 'end_professional_client_agreement', 'delete_professional_client_agreement',
  'get_professional_compensation', 'list_retention_review',
  'create_professional_invitation', 'revoke_professional_invitation', 'request_professional_update',
  'resolve_professional_invitation', 'link_professional_account', 'list_professional_invitation_states', 'get_professional_onboarding',
  'get_my_submission', 'save_my_submission_draft', 'save_my_submission_private', 'sign_my_consent', 'submit_my_submission',
  'get_my_professional_private', 'start_my_profile_update',
  'get_submission_review', 'apply_professional_submission', 'reject_professional_submission',
  'list_professional_invitations_to_remind_for_service', 'reissue_professional_invitation_for_service',
  'get_professional_submission_notice_for_service',
  'set_user_preference', 'delete_user_preference',
  'mark_professional_fiche_generated', 'get_professional_fiche_upload', 'get_professional_public_fees',
  'list_professional_submissions', 'get_my_professional_record',
  'get_professional_account_status', 'set_professional_matching_note',
  'cancel_professional_submission'
], 'public schema exposes exactly the intended RPCs');

select throws_ok($$ insert into public.org_module_settings (org_id, module_key, settings) values ('b0000000-0000-0000-0000-00000000000b', 'test_parent', '[]') $$,
  '23514', null, 'module settings must be a JSON object');

-- =============================================================================
-- Admin A: module toggling
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select ok(not public.module_enabled('test_parent'), 'modules start disabled');
select ok(public.module_enabled('core'), 'core is always enabled');
select throws_ok($$ select public.set_module_enabled('test_child', true) $$, 'P0001', 'Activez d''abord : Test parent', 'cannot enable a module before its dependency (message names the module)');
select throws_ok($$ select public.set_module_enabled('nope', true) $$, '22023', null, 'unknown module is rejected');
select throws_ok($$ select public.set_module_enabled('core', false) $$, '22023', null, 'core cannot be toggled');
select lives_ok($$ select public.set_module_enabled('test_parent', true) $$, 'admin enables the parent');
select ok(public.module_enabled('test_parent'), 'module_enabled reflects the change');
select lives_ok($$ select public.set_module_enabled('test_child', true) $$, 'dependent module can now be enabled');
select throws_ok($$ select public.set_module_enabled('test_parent', false) $$, 'P0001', 'Désactivez d''abord : Test enfant', 'cannot disable a module others depend on (message names the module)');
select is((select updated_by from public.org_modules where module_key = 'test_parent'),
  'a0000000-0000-0000-0000-000000000001'::uuid, 'org_modules records who toggled');
select results_eq(
  $$ select key, depends_on, enabled from public.list_modules() where key like 'test\_%' order by key $$,
  $$ values ('test_child'::text, array['test_parent']::text[], true), ('test_parent'::text, array[]::text[], true) $$,
  'list_modules returns dependencies and state');
select ok(not exists (select 1 from public.list_modules() where key = 'core'), 'list_modules hides core');
select is(public.get_my_access() -> 'modules', '["test_child", "test_parent"]'::jsonb, 'get_my_access lists enabled modules');
select lives_ok($$ select public.set_module_enabled('test_child', false) $$, 'dependent module can be disabled');
select ok(not public.module_enabled('test_child'), 'disabled module reports false');
select is((select count(*)::int from public.audit_log where table_name = 'org_modules'), 3, 'each toggle is audited');
select results_eq('select settings from public.org_module_settings', array['{"reminder_hours": 24}'::jsonb], 'admin reads org module settings');

-- =============================================================================
-- Admin A: secrets
-- =============================================================================
select lives_ok($$ select public.set_org_secret('documenso_api_key', 'secret-value') $$, 'admin stores a secret');
select throws_ok($$ select public.set_org_secret('Bad Key', 'x') $$, '22023', null, 'secret key format is validated');
select throws_ok($$ select public.set_org_secret('empty_key', '') $$, '22023', null, 'empty secret values are rejected');
select results_eq($$ select key from public.list_org_secret_keys() $$, array['documenso_api_key'], 'secret key is listed, value is not');
select throws_ok('select count(*) from public.org_secrets', '42501', null, 'org_secrets is unreadable for clients');
select lives_ok($$ select public.set_org_secret('documenso_api_key', 'rotated-value') $$, 'admin rotates the secret');
select results_eq(
  $$ select source, changed_fields, record_id from public.audit_log where table_name = 'org_secrets' and source = 'rpc:set_org_secret' $$,
  $$ values ('rpc:set_org_secret'::text, '{"value": {"rotated": true}}'::jsonb, 'b0000000-0000-0000-0000-00000000000a:documenso_api_key'::text) $$,
  'rotation writes an explicit audit row');
select is((select changed_fields -> 'version' from public.audit_log where table_name = 'org_secrets' and action = 'update' and source <> 'rpc:set_org_secret'),
  '{"before": 1, "after": 2}'::jsonb, 'rotation bumps the version');
select is((select changed_fields -> 'vault_secret_id' from public.audit_log where table_name = 'org_secrets' and action = 'insert'),
  '"[redacted]"'::jsonb, 'vault ids are redacted from the log');

-- =============================================================================
-- Adjointe A (settings.view; no settings.integrations_manage, settings.manage or modules.manage)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_module_enabled('test_child', true) $$, '42501', null, 'adjointe cannot toggle modules');
select throws_ok($$ select public.set_org_secret('documenso_api_key', 'x') $$, '42501', null, 'adjointe cannot write secrets');
select throws_ok($$ select public.delete_org_secret('documenso_api_key') $$, '42501', null, 'adjointe cannot delete secrets');
select results_eq($$ select key from public.list_org_secret_keys() $$, array['documenso_api_key'], 'adjointe with settings.view sees secret keys');
select results_eq('select count(*)::int from public.org_module_settings', array[1], 'adjointe with settings.view reads module settings');

-- =============================================================================
-- Provider A (no settings access)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq('select count(*)::int from public.list_org_secret_keys()', array[0], 'provider sees no secret keys');
select results_eq('select count(*)::int from public.org_module_settings', array[0], 'provider cannot read module settings');
select ok(public.module_enabled('test_parent'), 'any member can check whether a module is enabled');

-- =============================================================================
-- Admin B (cross-org isolation)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(not public.module_enabled('test_parent'), 'org B does not inherit org A modules');
select results_eq('select count(*)::int from public.org_modules', array[0], 'org B admin sees no org A module rows');
select results_eq('select count(*)::int from public.org_module_settings', array[0], 'org B admin sees no org A settings');
select results_eq('select count(*)::int from public.list_org_secret_keys()', array[0], 'org B admin sees no org A secret keys');
select ok(not exists (select 1 from public.list_modules() where enabled), 'list_modules reports org B state');

-- =============================================================================
-- Service role (edge functions)
-- =============================================================================
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.get_org_secret('b0000000-0000-0000-0000-00000000000a', 'documenso_api_key'), 'rotated-value', 'service_role reads the current secret value');
select is(public.get_org_secret('b0000000-0000-0000-0000-00000000000b', 'documenso_api_key'), null, 'secrets are per org');
-- Org A: test_parent enabled, test_child disabled (toggled above).
select ok(public.module_enabled_for_org('b0000000-0000-0000-0000-00000000000a', 'test_parent'), 'module_enabled_for_org: true for an enabled module');
select ok(not public.module_enabled_for_org('b0000000-0000-0000-0000-00000000000a', 'test_child'), 'module_enabled_for_org: false for a disabled module');
select ok(public.module_enabled_for_org('b0000000-0000-0000-0000-00000000000a', 'core'), 'module_enabled_for_org: core is always enabled');
select ok(not public.module_enabled_for_org('b0000000-0000-0000-0000-00000000000a', 'nope'), 'module_enabled_for_org: false for an unknown module');
select ok(not public.module_enabled_for_org('b0000000-0000-0000-0000-00000000000b', 'test_parent'), 'module_enabled_for_org: per org (org B has it disabled)');

-- =============================================================================
-- Storage checks (as postgres)
-- =============================================================================
reset role;
select is((select version from public.org_secrets where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'documenso_api_key'), 2, 'org_secrets.version counts rotations');
select is((select count(*)::int from vault.secrets where name = 'org:b0000000-0000-0000-0000-00000000000a:documenso_api_key'), 1, 'one Vault secret per org key');
select is((select count(*)::int from public.audit_log where changed_fields::text like '%secret-value%' or changed_fields::text like '%rotated-value%'),
  0, 'secret values never reach the audit log');

-- =============================================================================
-- Admin A deletes the secret
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.delete_org_secret('documenso_api_key') $$, 'admin deletes the secret');
select results_eq('select count(*)::int from public.list_org_secret_keys()', array[0], 'deleted key is no longer listed');
select lives_ok($$ select public.delete_org_secret('documenso_api_key') $$, 'deleting a missing key is a no-op');
select lives_ok($$ select public.set_org_secret('documenso_api_key', 'fresh-value') $$, 'the key can be set again after deletion');
select results_eq(
  $$ select action from public.audit_log where table_name = 'org_secrets' and source <> 'rpc:set_org_secret' order by id $$,
  $$ values ('insert'::text), ('update'::text), ('delete'::text), ('insert'::text) $$,
  'secret lifecycle is audited');
reset role;
select is((select count(*)::int from vault.secrets where name = 'org:b0000000-0000-0000-0000-00000000000a:documenso_api_key'), 1, 'delete removed the Vault secret (only the fresh one remains)');
select is((select version from public.org_secrets where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'documenso_api_key'), 1, 'a re-created secret starts at version 1');

-- Deleting an org cascades to org_secrets, and the Vault entries go with it.
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000c', 'Org C');
insert into public.org_secrets (org_id, key, vault_secret_id)
values ('b0000000-0000-0000-0000-00000000000c', 'resend_api_key',
        vault.create_secret('c-value', 'org:b0000000-0000-0000-0000-00000000000c:resend_api_key'));
select is((select count(*)::int from vault.secrets where name like 'org:b0000000-0000-0000-0000-00000000000c:%'), 1, 'org C has a Vault secret');
delete from public.organizations where id = 'b0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from vault.secrets where name like 'org:b0000000-0000-0000-0000-00000000000c:%'), 0, 'deleting an org removes its Vault secrets');

select * from finish();
rollback;
