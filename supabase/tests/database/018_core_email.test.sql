-- Email schema (migration *_core_email.sql, plan Phase 3 Task 3.6, P3-18, P3-21, P3-26).
-- Covers: privileges on the four tables and every RPC and helper; the catalogue checks
-- (key prefix, variables, placeholders) and the seeded core.staff_invite; email_settings rows
-- for every org (trigger + backfill rule for reply_to); list / save / reset of templates
-- (versions, audit, module filter, placeholder rule shared with _shared/format.ts, lengths,
-- the `{{` + 10 000 spaces probe); the sender (single-mailbox checks, domain rewrite, who may
-- change what); email_log RLS (view_permission against the permission array, or
-- settings.email_manage; org isolation), list_email_log (filters, keyset, clamp) and
-- list_subject_emails; the service-role send path (get_email_context, queue_email,
-- mark_email_sent, mark_email_failed), apply_email_event (monotonic, final states, the
-- provider_unavailable override, module gate, org check), count_org_emails_today; the two
-- maintenance jobs (retention, stale queued rows) and their cron entries.
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(149);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A (America/Toronto, professionals on, email contact@a.test): admin A, adjointe D
-- (override settings.email_manage granted), conseillère C, provider P (override users.view
-- granted), disabled admin X.
-- Org B (professionals off, an email that is not a single mailbox): admin B.
-- Test default professionals.test_notice (module professionals, professionals.view).
-- email_log rows c…01–c…11 (ids below), queued rows created by the test in table `q`.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone, email, privacy_officer_name, privacy_officer_email) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto', 'contact@a.test', 'Christine A', 'vie.privee@a.test'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org "B" <test>', 'America/Toronto', 'a<b@b.test', null, null);
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',         'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe D',      'adjointe@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C',   'c@a.test',        'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Provider P',      'p@a.test',        'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Admin désactivé', 'x@a.test',        'disabled'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',         'admin@b.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'settings.email_manage', true),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'users.view',            true);

insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission)
values
  ('professionals.test_notice', 'professionals', 'Avis test', 'Test', 'Pourquoi test.',
   'Bonjour {{professional.first_name}}', 'Un avis.', null,
   '[{"path": "professional.first_name", "label": "Prénom", "sample": "Marie", "required": true, "kind": "text"}]',
   'professionals.view');

insert into public.email_log
  (id, org_id, module_key, template_key, template_version, to_email, subject_type, subject_id,
   status, error_code, resend_id, view_permission, created_at)
values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.staff_invite', 0, 'x@a.test',
   'staff_invitation', 'd0000000-0000-0000-0000-000000000001', 'sent', null, 're_c01', 'users.view', now() - interval '1 hour'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'core', 'core.staff_invite', 0, 'x@b.test',
   'staff_invitation', 'd0000000-0000-0000-0000-000000000002', 'sent', null, 're_c02', 'users.view', now()),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.test_notice', 0, 'pro@a.test',
   'professional', 'd0000000-0000-0000-0000-000000000003', 'sent', null, 're_c03', 'professionals.view', now() - interval '30 minutes'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'professionals', 'professionals.test_notice', 0, 'pro@b.test',
   'professional', 'd0000000-0000-0000-0000-000000000004', 'sent', null, 're_c04', 'professionals.view', now()),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.staff_invite', 0, 'old@a.test',
   'staff_invitation', 'd0000000-0000-0000-0000-000000000005', 'delivered', null, null, 'users.view', now() - interval '25 months'),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.staff_invite', 0, 'recent@a.test',
   'staff_invitation', 'd0000000-0000-0000-0000-000000000006', 'delivered', null, null, 'users.view', now() - interval '23 months'),
  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.staff_invite', 0, 'q16@a.test',
   'staff_invitation', 'd0000000-0000-0000-0000-000000000007', 'queued', null, null, 'users.view', now() - interval '16 minutes'),
  ('c0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.staff_invite', 0, 'q14@a.test',
   'staff_invitation', 'd0000000-0000-0000-0000-000000000008', 'queued', null, null, 'users.view', now() - interval '14 minutes'),
  ('c0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.staff_invite', 0, 'unknown@a.test',
   'staff_invitation', 'd0000000-0000-0000-0000-000000000009', 'failed', 'provider_unavailable', null, 'users.view', now() - interval '2 hours'),
  ('c0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.staff_invite', 0, 'rejected@a.test',
   'staff_invitation', 'd0000000-0000-0000-0000-000000000010', 'failed', 'provider_rejected', null, 'users.view', now() - interval '3 hours'),
  ('c0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000b', 'core', 'core.staff_invite', 0, 'y@b.test',
   'staff_invitation', 'd0000000-0000-0000-0000-000000000011', 'delivered', null, null, 'users.view', now() - interval '2 days');

-- Queued rows (written as service_role).
create temp table q (step text primary key, id uuid) on commit drop;
grant select, insert on q to service_role;

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'email_template_defaults', 'anon', array[]::text[], 'anon: nothing on email_template_defaults');
select table_privs_are('public', 'email_template_defaults', 'authenticated', array['SELECT'], 'authenticated: select on email_template_defaults');
select table_privs_are('public', 'email_templates', 'anon', array[]::text[], 'anon: nothing on email_templates');
select table_privs_are('public', 'email_templates', 'authenticated', array['SELECT'], 'authenticated: select on email_templates');
select table_privs_are('public', 'email_settings', 'anon', array[]::text[], 'anon: nothing on email_settings');
select table_privs_are('public', 'email_settings', 'authenticated', array['SELECT'], 'authenticated: select on email_settings');
select table_privs_are('public', 'email_log', 'anon', array[]::text[], 'anon: nothing on email_log');
select table_privs_are('public', 'email_log', 'authenticated', array['SELECT'], 'authenticated: select on email_log');
select is_empty($$
  select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
   where table_schema = 'public'
     and table_name in ('email_template_defaults', 'email_templates', 'email_settings', 'email_log')
     and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
$$, 'no column privilege beyond select on the email tables');

-- (name, anon, authenticated, service_role) for every public email RPC.
select results_eq($$
  select p.proname::text collate "default",
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('set_email_sender', 'set_email_sending_domain', 'list_email_templates',
                       'save_email_template', 'reset_email_template', 'list_email_log',
                       'list_subject_emails', 'get_email_context', 'queue_email', 'mark_email_sent',
                       'mark_email_failed', 'apply_email_event', 'count_org_emails_today')
   order by 1
$$, $$ values
  ('apply_email_event'::text, false, false, true),
  ('count_org_emails_today', false, false, true),
  ('get_email_context', false, false, true),
  ('list_email_log', false, true, false),
  ('list_email_templates', false, true, false),
  ('list_subject_emails', false, true, false),
  ('mark_email_failed', false, false, true),
  ('mark_email_sent', false, false, true),
  ('queue_email', false, false, true),
  ('reset_email_template', false, true, false),
  ('save_email_template', false, true, false),
  ('set_email_sender', false, true, false),
  ('set_email_sending_domain', false, true, false)
$$, 'user RPCs for authenticated only, send-path RPCs for service_role only');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('is_mailbox', 'email_variables_valid', 'email_variable_paths', 'email_placeholder_error',
                       'seed_org_email_settings', 'job_email_log_retention', 'job_email_log_stale_queued')
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the private email helpers, trigger and jobs are callable by no client role');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'private'::regnamespace
              and p.proname in ('is_mailbox', 'email_variables_valid', 'email_variable_paths', 'email_placeholder_error',
                                'seed_org_email_settings', 'job_email_log_retention', 'job_email_log_stale_queued')),
  7, 'the seven private email functions exist');

select results_eq($$
  select indexname::text collate "default" from pg_indexes
   where schemaname = 'public' and tablename = 'email_log'
     and indexname in ('email_log_org_created_idx', 'email_log_subject_idx', 'email_log_retention_idx', 'email_log_queued_idx')
   order by 1
$$, array['email_log_org_created_idx', 'email_log_queued_idx', 'email_log_retention_idx', 'email_log_subject_idx'],
  'email_log has the list, timeline, retention and stale-queue indexes');
select is((select pg_get_expr(pol.polqual, pol.polrelid) like '%current_permission_keys()%'
             from pg_policy pol where pol.polname = 'email_log_select'),
  true, 'email_log_select tests view_permission against the permission array');

-- =============================================================================
-- Catalogue
-- =============================================================================
select results_eq($$
  select module_key, label, why_line, subject, button_label, view_permission, recipient_mode, allows_attachments
    from public.email_template_defaults where key = 'core.staff_invite'
$$, $$ values ('core'::text, 'Invitation d''un membre du personnel'::text,
  'Vous recevez ce courriel parce que la clinique vous invite à créer votre accès.'::text,
  'Votre accès à {{clinic.name}}'::text, 'Créer mon accès'::text, 'users.view'::text, 'subject'::text, false) $$,
  'core.staff_invite is seeded');
select results_eq($$
  select v->>'path', (v->>'required')::boolean, v->>'kind'
    from public.email_template_defaults d, jsonb_array_elements(d.variables) v
   where d.key = 'core.staff_invite' order by 1
$$, $$ values ('clinic.name'::text, true, 'text'::text), ('invitation.expires_at', true, 'datetime'),
              ('invitee.display_name', true, 'text'), ('inviter.display_name', true, 'text') $$,
  'core.staff_invite declares its four required variables');
select is((select pg_catalog.length(body) > 0 and body !~* '(th[ée]rap|diagnos|sant[ée] mentale)'
             from public.email_template_defaults where key = 'core.staff_invite'),
  true, 'core.staff_invite has a body with no clinical wording');

select throws_ok($$
  insert into public.email_template_defaults (key, module_key, label, description, why_line, subject, body, variables, view_permission)
  values ('core.wrong_prefix', 'professionals', 'X', 'X', 'X', 'Objet', 'Texte', '[]', 'users.view') $$,
  '23514', null, 'a default key must start with its module key');
select throws_ok($$
  insert into public.email_template_defaults (key, module_key, label, description, why_line, subject, body, variables, view_permission)
  values ('core.bad_variable', 'core', 'X', 'X', 'X', 'Objet', 'Texte',
          '[{"path": "a.b", "label": "A", "sample": "a", "required": true, "kind": "html"}]', 'users.view') $$,
  '23514', null, 'a variable kind outside text/date/datetime/url is refused');
select throws_ok($$
  insert into public.email_template_defaults (key, module_key, label, description, why_line, subject, body, variables, view_permission)
  values ('core.bad_placeholder', 'core', 'X', 'X', 'X', 'Objet {{a.b}}', 'Texte', '[]', 'users.view') $$,
  '23514', null, 'a default cannot use a placeholder it does not declare');

select results_eq($$
  select j.key, j.kind, j.sql_function, j.is_maintenance, c.schedule, c.command
    from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
   where j.key in ('core.email_log_retention', 'core.email_log_stale_queued') order by j.key
$$, $$ values
  ('core.email_log_retention'::text, 'sql'::text, 'private.job_email_log_retention'::text, true, '30 8 * * *'::text,
   'select private.run_sql_job(''core.email_log_retention'')'::text),
  ('core.email_log_stale_queued', 'sql', 'private.job_email_log_stale_queued', true, '*/5 * * * *',
   'select private.run_sql_job(''core.email_log_stale_queued'')') $$,
  'both email maintenance jobs are catalogued and scheduled');

select results_eq($$
  select org_id, from_name, from_address, reply_to, sending_domain from public.email_settings
   where org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') order by org_id
$$, $$ values
  ('b0000000-0000-0000-0000-00000000000a'::uuid, 'Org A'::text, 'no-reply@gestion.cliniquemana.com'::text,
   'contact@a.test'::text, 'gestion.cliniquemana.com'::text),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B test', 'no-reply@gestion.cliniquemana.com', null, 'gestion.cliniquemana.com') $$,
  'a new org gets its sender: org name without < > ", no-reply address, reply-to only when the org email is one mailbox');

-- The placeholder rule (_shared/format.ts PLACEHOLDER_SOURCE), linear on a lone `{{`.
set local statement_timeout = '1s';
select is(private.email_placeholder_error('{{' || repeat(' ', 10000), array['clinic.name']),
  'Accolades non fermées dans le texte.', '`{{` + 10 000 spaces is refused as unclosed, fast');
select is(private.email_placeholder_error(repeat('{{ a', 5000) || '}}', array['a']),
  'Accolades non fermées dans le texte.', 'many `{{` openings are refused as unclosed, fast');
set local statement_timeout = 0;
select is(private.email_placeholder_error('{{{clinic.name}}', array['clinic.name']), null::text,
  'a stray `{` before a placeholder is literal text, as in the renderer');

-- =============================================================================
-- Admin A: templates
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq($$
  select is_custom, version, updated_at, updated_by_name, subject, button_label
    from public.list_email_templates() where key = 'core.staff_invite'
$$, $$ values (false, 0, null::timestamptz, null::text, 'Votre accès à {{clinic.name}}'::text, 'Créer mon accès'::text) $$,
  'without an override, the default is listed (version 0)');
select results_eq($$ select key from public.list_email_templates() where key in ('core.staff_invite', 'professionals.test_notice') order by key $$,
  array['core.staff_invite', 'professionals.test_notice'], 'a template of an enabled module is listed');

select lives_ok($$ select public.save_email_template('core.staff_invite', ' Bienvenue à {{ clinic.name }} ',
  E'Bonjour {{invitee.display_name}},\n\nÀ bientôt.\n', ' Commencer ') $$,
  'admin saves an override; a placeholder with spaces is accepted');
select results_eq($$
  select is_custom, version, updated_by_name, subject, body, button_label
    from public.list_email_templates() where key = 'core.staff_invite'
$$, $$ values (true, 1, 'Admin A'::text, 'Bienvenue à {{ clinic.name }}'::text,
               E'Bonjour {{invitee.display_name}},\n\nÀ bientôt.'::text, 'Commencer'::text) $$,
  'the override is listed, trimmed, version 1');
select lives_ok($$ select public.save_email_template('core.staff_invite', 'Bienvenue', 'Bonjour.', '') $$,
  'admin saves again with an empty button label');
select results_eq($$ select version, button_label from public.list_email_templates() where key = 'core.staff_invite' $$,
  $$ values (2, null::text) $$, 'the second save bumps the version; an empty label becomes null');

select throws_ok($$ select public.save_email_template('core.staff_invite', 'Bonjour {{clinic.nom}}', 'Texte', null) $$,
  'P0001', 'Variable inconnue : {{clinic.nom}}', 'an unknown placeholder is refused with its path');
select throws_ok($$ select public.save_email_template('core.staff_invite', 'Objet', 'Bonjour {{ invitee.first_name }} et {{x}}', null) $$,
  'P0001', 'Variable inconnue : {{invitee.first_name}}', 'the first unknown placeholder is named, trimmed');
select throws_ok($$ select public.save_email_template('core.staff_invite', 'Objet', 'Bonjour {{clinic.name', null) $$,
  'P0001', 'Accolades non fermées dans le texte.', 'a lone `{{` is refused');
select throws_ok($$ select public.save_email_template('core.staff_invite', 'Objet', 'Bonjour clinic.name}}', null) $$,
  'P0001', 'Accolades non fermées dans le texte.', 'a lone `}}` is refused');
select throws_ok($$ select public.save_email_template('core.staff_invite', 'Objet', E'Bonjour {{clinic\n.name}}', null) $$,
  'P0001', 'Accolades non fermées dans le texte.', 'a line break inside braces is not a placeholder');
select throws_ok($$ select public.save_email_template('core.staff_invite', 'Objet', 'Texte', 'Aller {{nope}}') $$,
  'P0001', 'Variable inconnue : {{nope}}', 'the button label is checked too');
select throws_ok($$ select public.save_email_template('core.staff_invite', 'Objet {{', '}} texte', null) $$,
  'P0001', 'Accolades non fermées dans le texte.', 'a placeholder cannot span the subject and the body');

select throws_ok($$ select public.save_email_template('core.staff_invite', ' ', 'Texte', null) $$,
  'P0001', 'L''objet est obligatoire.', 'an empty subject is refused');
select throws_ok($$ select public.save_email_template('core.staff_invite', repeat('a', 201), 'Texte', null) $$,
  'P0001', 'L''objet ne peut pas dépasser 200 caractères.', 'a subject over 200 characters is refused');
select throws_ok($$ select public.save_email_template('core.staff_invite', E'Ligne 1\nLigne 2', 'Texte', null) $$,
  'P0001', 'L''objet doit tenir sur une seule ligne.', 'a subject with a line break is refused');
select throws_ok($$ select public.save_email_template('core.staff_invite', 'Objet', E' \n ', null) $$,
  'P0001', 'Le texte est obligatoire.', 'an empty body is refused');
select throws_ok($$ select public.save_email_template('core.staff_invite', 'Objet', repeat('a', 10001), null) $$,
  'P0001', 'Le texte ne peut pas dépasser 10 000 caractères.', 'a body over 10 000 characters is refused');
select throws_ok($$ select public.save_email_template('core.staff_invite', 'Objet', 'Texte', repeat('a', 61)) $$,
  'P0001', 'Le libellé du bouton ne peut pas dépasser 60 caractères.', 'a button label over 60 characters is refused');
select throws_ok($$ select public.save_email_template('core.nope', 'Objet', 'Texte', null) $$,
  '22023', null, 'an unknown template key is refused');

select lives_ok($$ select public.reset_email_template('core.staff_invite') $$, 'admin resets the template');
select results_eq($$ select is_custom, version, subject from public.list_email_templates() where key = 'core.staff_invite' $$,
  $$ values (false, 0, 'Votre accès à {{clinic.name}}'::text) $$, 'after a reset, the default is listed again');

reset role;
select results_eq($$
  select action, source from public.audit_log
   where table_name = 'email_templates' and record_id = 'b0000000-0000-0000-0000-00000000000a:core.staff_invite'
   order by created_at, id
$$, $$ values ('insert'::text, 'app'::text), ('update', 'app'), ('delete', 'app') $$,
  'each save and the reset are audited');
set local role authenticated;

-- =============================================================================
-- Admin A: sender
-- =============================================================================
select lives_ok($$ select public.set_email_sender(' Clinique A ', ' Contact@Gestion.CliniqueMana.com ', ' ') $$,
  'admin sets the sender');
select results_eq($$ select from_name, from_address, reply_to from public.email_settings where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('Clinique A'::text, 'contact@gestion.cliniquemana.com'::text, null::text) $$,
  'trimmed, lowercased address, empty reply-to stored as null');
select throws_ok($$ select public.set_email_sender('Clinique A', 'x@gmail.com', null) $$,
  '23514', null, 'an address outside the sending domain is refused');
select throws_ok($$ select public.set_email_sender('Clinique A', 'a,b@gestion.cliniquemana.com', null) $$,
  '23514', null, 'a comma in the local part is refused');
select throws_ok($$ select public.set_email_sender('Clinique A', 'a b@gestion.cliniquemana.com', null) $$,
  '23514', null, 'a space in the local part is refused');
select throws_ok($$ select public.set_email_sender('Clinique A', '<a>@gestion.cliniquemana.com', null) $$,
  '23514', null, 'angle brackets in the local part are refused');
select throws_ok($$ select public.set_email_sender('Clinique A', 'contact@gestion.cliniquemana.com', 'Nom <x@exemple.ca>') $$,
  '23514', null, 'a reply-to with a display name is refused');
select throws_ok($$ select public.set_email_sender('Clinique A', 'contact@gestion.cliniquemana.com', 'a@exemple.ca, b@exemple.ca') $$,
  '23514', null, 'a reply-to with two mailboxes is refused');
select lives_ok($$ select public.set_email_sender('Clinique A', 'contact@gestion.cliniquemana.com', ' Info@Exemple.ca ') $$,
  'a single-mailbox reply-to is accepted');
select is((select reply_to from public.email_settings where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  'Info@Exemple.ca', 'the reply-to is trimmed and kept as typed');
select throws_ok($$ select public.set_email_sender(' ', 'contact@gestion.cliniquemana.com', null) $$,
  'P0001', 'Le nom d''expéditeur doit compter de 1 à 80 caractères.', 'an empty sender name is refused');
select throws_ok($$ select public.set_email_sender(repeat('a', 81), 'contact@gestion.cliniquemana.com', null) $$,
  'P0001', 'Le nom d''expéditeur doit compter de 1 à 80 caractères.', 'a sender name over 80 characters is refused');
select throws_ok($$ select public.set_email_sender('Clinique "A"', 'contact@gestion.cliniquemana.com', null) $$,
  'P0001', 'Le nom d''expéditeur ne peut pas contenir les caractères < > ou ".', 'a sender name with a quote is refused');

select lives_ok($$ select public.set_email_sending_domain(' Mail.Exemple.CA ') $$, 'admin changes the sending domain');
select results_eq($$ select sending_domain, from_address from public.email_settings where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('mail.exemple.ca'::text, 'contact@mail.exemple.ca'::text) $$, 'changing the domain rewrites the from address');
select throws_ok($$ select public.set_email_sending_domain('exemple') $$,
  'P0001', 'Domaine d''envoi invalide.', 'a domain without a dot is refused');
select throws_ok($$ select public.set_email_sending_domain('-bad.exemple.ca') $$,
  'P0001', 'Domaine d''envoi invalide.', 'a label starting with a hyphen is refused');
select results_eq($$ select org_id from public.email_settings $$,
  array['b0000000-0000-0000-0000-00000000000a'::uuid], 'admin A reads only its own sender settings');
select throws_ok($$ update public.email_settings set from_name = 'X' $$, '42501', null, 'clients cannot update email_settings directly');

reset role;
select is((select count(*)::int from public.audit_log
            where table_name = 'email_settings' and record_id = 'b0000000-0000-0000-0000-00000000000a' and action = 'update'),
  3, 'each sender and domain change is audited');
select results_eq($$ select from_address, sending_domain from public.email_settings where org_id = 'b0000000-0000-0000-0000-00000000000b' $$,
  $$ values ('no-reply@gestion.cliniquemana.com'::text, 'gestion.cliniquemana.com'::text) $$, 'org B is untouched');
set local role authenticated;

-- =============================================================================
-- Adjointe D (settings.view + settings.email_manage override)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.set_email_sender('Clinique A', 'bonjour@mail.exemple.ca', null) $$,
  'the adjointe with settings.email_manage sets the sender');
select throws_ok($$ select public.set_email_sending_domain('autre.exemple.ca') $$,
  '42501', null, 'the adjointe without settings.integrations_manage cannot change the domain');
select lives_ok($$ select public.save_email_template('core.staff_invite', 'Accès à {{clinic.name}}', 'Bonjour {{invitee.display_name}}.', 'Créer mon accès') $$,
  'the adjointe with settings.email_manage saves a template');
select is((select count(*)::int from public.list_email_templates() where key = 'core.staff_invite' and is_custom and version = 1),
  1, 'a save after a reset starts again at version 1');

-- =============================================================================
-- Conseillère C (professionals.view only)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_email_templates() $$, '42501', null, 'the conseillère cannot list templates');
select throws_ok($$ select public.save_email_template('core.staff_invite', 'Objet', 'Texte', null) $$,
  '42501', null, 'the conseillère cannot save a template');
select throws_ok($$ select public.reset_email_template('core.staff_invite') $$, '42501', null, 'the conseillère cannot reset a template');
select throws_ok($$ select public.set_email_sender('X', 'x@mail.exemple.ca', null) $$, '42501', null, 'the conseillère cannot set the sender');
select is_empty($$ select 1 from public.email_settings $$, 'the conseillère reads no sender settings');
select is_empty($$ select 1 from public.email_templates $$, 'the conseillère reads no overrides');
select ok((select count(*) > 0 from public.email_template_defaults), 'every member reads the catalogue');

-- =============================================================================
-- Admin B (org B, professionals off)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select results_eq($$ select key from public.list_email_templates() where key in ('core.staff_invite', 'professionals.test_notice') $$,
  array['core.staff_invite'], 'a template of a disabled module is hidden');
select throws_ok($$ select public.save_email_template('professionals.test_notice', 'Objet', 'Texte', null) $$,
  '22023', null, 'a template of a disabled module cannot be saved');
select is_empty($$ select 1 from public.email_templates where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  'admin B reads no org A override');

-- =============================================================================
-- email_log RLS (fixture rows c…01 org A users.view, c…02 org B users.view,
-- c…03 org A professionals.view)
-- =============================================================================
select results_eq($$ select id from public.email_log where id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003') order by id $$,
  array['c0000000-0000-0000-0000-000000000002'::uuid], 'admin B sees only org B rows');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select id from public.email_log where id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003') order by id $$,
  array['c0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000003'], 'admin A sees every org A row');
select throws_ok($$ update public.email_log set status = 'delivered' $$, '42501', null, 'clients cannot write email_log');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select id from public.email_log where id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003') order by id $$,
  array['c0000000-0000-0000-0000-000000000001'::uuid], 'a users.view override holder sees the users.view row only');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select id from public.email_log where id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003') order by id $$,
  array['c0000000-0000-0000-0000-000000000003'::uuid], 'the conseillère sees the professionals.view row, not the users.view one');
select is_empty($$ select 1 from public.list_subject_emails('staff_invitation', 'd0000000-0000-0000-0000-000000000001') $$,
  'the conseillère gets no staff invitation timeline');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select id from public.email_log where id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003') order by id $$,
  array['c0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000003'],
  'a settings.email_manage holder without users.view sees every org A row');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is_empty($$ select 1 from public.email_log where id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003') $$,
  'a disabled admin sees nothing');

-- =============================================================================
-- Admin A: list_email_log and list_subject_emails
-- Org A staff_invite rows, newest first: c08 (-14 min), c07 (-16 min), c01 (-1 h), c09 (-2 h),
-- c10 (-3 h), c06 (-23 months), c05 (-25 months).
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select id, template_label, status from public.list_email_log(p_template_key => 'core.staff_invite', p_limit => 3) $$,
  $$ values ('c0000000-0000-0000-0000-000000000008'::uuid, 'Invitation d''un membre du personnel'::text, 'queued'::text),
            ('c0000000-0000-0000-0000-000000000007', 'Invitation d''un membre du personnel', 'queued'),
            ('c0000000-0000-0000-0000-000000000001', 'Invitation d''un membre du personnel', 'sent') $$,
  'list_email_log filters by template, newest first, with the label');
select results_eq($$
  select id from public.list_email_log(p_template_key => 'core.staff_invite', p_limit => 2,
    p_before => now() - interval '1 hour', p_before_id => 'c0000000-0000-0000-0000-000000000001')
$$, array['c0000000-0000-0000-0000-000000000009'::uuid, 'c0000000-0000-0000-0000-000000000010'],
  'keyset paging continues after the last row');
select results_eq($$ select id, error_code from public.list_email_log(p_status => 'failed') $$,
  $$ values ('c0000000-0000-0000-0000-000000000009'::uuid, 'provider_unavailable'::text),
            ('c0000000-0000-0000-0000-000000000010', 'provider_rejected') $$, 'list_email_log filters by status');
select results_eq($$ select id from public.list_email_log(p_from => now() - interval '24 months', p_to => now() - interval '1 day') $$,
  array['c0000000-0000-0000-0000-000000000006'::uuid], 'list_email_log filters by period');
select is((select count(*)::int from public.list_email_log(p_limit => 0)), 1, 'p_limit is clamped to at least 1');
select is((select count(*)::int from public.list_email_log(p_limit => 1000)), 8, 'p_limit is clamped to 100 (8 visible rows)');
select results_eq($$ select id, template_label, to_email from public.list_subject_emails('staff_invitation', 'd0000000-0000-0000-0000-000000000001') $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid, 'Invitation d''un membre du personnel'::text, 'x@a.test'::text) $$,
  'list_subject_emails returns the subject''s timeline');
select is_empty($$ select 1 from public.list_subject_emails('staff_invitation', 'd0000000-0000-0000-0000-000000000002') $$,
  'list_subject_emails never crosses orgs');

-- =============================================================================
-- Service role: context
-- =============================================================================
reset role;
set local role service_role;

select results_eq($$
  select c->>'module_key', (c->>'module_enabled')::boolean, c->>'timezone',
         (c->'template'->>'version')::int, c->'template'->>'subject', c->'template'->>'why_line',
         c->'template'->>'view_permission', c->'template'->>'recipient_mode',
         (c->'template'->>'allows_attachments')::boolean, jsonb_array_length(c->'template'->'variables')
    from public.get_email_context('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite') c
$$, $$ values ('core'::text, true, 'America/Toronto'::text, 1, 'Accès à {{clinic.name}}'::text,
  'Vous recevez ce courriel parce que la clinique vous invite à créer votre accès.'::text,
  'users.view'::text, 'subject'::text, false, 4) $$,
  'get_email_context returns the effective template with its catalogue fields');
select results_eq($$
  select array_agg(k order by k) from public.get_email_context('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite') c,
         jsonb_object_keys(c->'template') k
$$, $$ values (array['allows_attachments', 'body', 'button_label', 'key', 'recipient_mode', 'subject',
                     'variables', 'version', 'view_permission', 'why_line']) $$,
  'the template object has exactly the fields of the send path contract');
select is((select c->'sender' from public.get_email_context('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite') c),
  '{"from_name": "Clinique A", "from_address": "bonjour@mail.exemple.ca", "reply_to": null}'::jsonb,
  'get_email_context returns the sender');
select is((select c->'clinic' from public.get_email_context('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite') c),
  '{"name": "Org A", "address_line1": null, "address_line2": null, "city": null, "province": "QC", "postal_code": null,
    "phone": null, "website": null, "privacy_officer_name": "Christine A", "privacy_officer_email": "vie.privee@a.test"}'::jsonb,
  'get_email_context returns the clinic footer');
select is((select (c->>'module_enabled')::boolean from public.get_email_context('b0000000-0000-0000-0000-00000000000b', 'professionals.test_notice') c),
  false, 'get_email_context reports a disabled module');
select is((select c->'template'->>'subject' from public.get_email_context('b0000000-0000-0000-0000-00000000000b', 'core.staff_invite') c),
  'Votre accès à {{clinic.name}}', 'another org gets the default, not org A''s override');
select throws_ok($$ select public.get_email_context('b0000000-0000-0000-0000-00000000000a', 'core.nope') $$,
  '22023', null, 'an unknown template key raises 22023');
select throws_ok($$ select public.get_email_context('b0000000-0000-0000-0000-0000000000ff', 'core.staff_invite') $$,
  '22023', null, 'an unknown org raises 22023');

-- =============================================================================
-- Service role: queue, mark, events
-- =============================================================================
insert into q select 'q1', public.queue_email('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite', 1, 'Invitee@A.test',
  null, 'staff_invitation', 'd0000000-0000-0000-0000-000000000020', 'users.view', 'a0000000-0000-0000-0000-000000000001', 0::smallint);
select results_eq($$
  select e.status, e.module_key, e.template_version, e.to_email, e.attempts, e.sent_by, e.attachment_count, e.view_permission
    from public.email_log e join q on q.id = e.id where q.step = 'q1'
$$, $$ values ('queued'::text, 'core'::text, 1, 'Invitee@A.test'::text, 0,
               'a0000000-0000-0000-0000-000000000001'::uuid, 0::smallint, 'users.view'::text) $$,
  'queue_email logs a queued row with the template''s module');
select throws_ok($$ select public.queue_email('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite', 1, 'x@a.test',
  null, 'staff_invitation', 'd0000000-0000-0000-0000-000000000020', 'nope.view', null, 0::smallint) $$,
  '22023', null, 'queue_email refuses an unknown view permission');
select throws_ok($$ select public.queue_email('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite', 1, 'x@a.test',
  'a0000000-0000-0000-0000-000000000006', 'staff_invitation', 'd0000000-0000-0000-0000-000000000020', 'users.view', null, 0::smallint) $$,
  '22023', null, 'queue_email refuses a recipient profile of another org');
select throws_ok($$ select public.queue_email('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite', 1, 'x@a.test',
  null, 'staff_invitation', 'd0000000-0000-0000-0000-000000000020', 'users.view', 'a0000000-0000-0000-0000-000000000006', 0::smallint) $$,
  '22023', null, 'queue_email refuses a sender of another org');
select throws_ok($$ select public.queue_email('b0000000-0000-0000-0000-00000000000a', 'core.nope', 1, 'x@a.test',
  null, 'staff_invitation', 'd0000000-0000-0000-0000-000000000020', 'users.view', null, 0::smallint) $$,
  '22023', null, 'queue_email refuses an unknown template');
select throws_ok($$ select public.queue_email('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite', 1, 'x@a.test',
  null, 'staff_invitation', 'd0000000-0000-0000-0000-000000000020', 'users.view', null, 4::smallint) $$,
  '23514', null, 'queue_email refuses more than three attachments');

select lives_ok($$ select public.mark_email_sent((select id from q where step = 'q1'), 're_q1', 2) $$, 'mark_email_sent');
select results_eq($$ select e.status, e.resend_id, e.attempts, e.sent_at is not null from public.email_log e join q on q.id = e.id where q.step = 'q1' $$,
  $$ values ('sent'::text, 're_q1'::text, 2, true) $$, 'the row is sent with the provider id and the attempts');
select throws_ok($$ select public.mark_email_sent('c0000000-0000-0000-0000-0000000000ff', 're_x', 1) $$,
  '22023', null, 'mark_email_sent refuses an unknown row');

select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', (select id from q where step = 'q1'), 're_q1', 'delivered', now()),
  'applied', 'sent → delivered is applied');
select results_eq($$ select e.status, e.last_event_at from public.email_log e join q on q.id = e.id where q.step = 'q1' $$,
  $$ values ('delivered'::text, now()) $$, 'the row is delivered and records the event time');
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', (select id from q where step = 'q1'), 're_q1', 'delivery_delayed', now()),
  'ignored', 'delivery_delayed after delivered is ignored');
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', (select id from q where step = 'q1'), 're_q1', 'sent', now()),
  'ignored', 'sent after delivered is ignored');
select lives_ok($$ select public.mark_email_sent((select id from q where step = 'q1'), 're_q1', 3) $$,
  'a late mark_email_sent is accepted');
select is((select e.status from public.email_log e join q on q.id = e.id where q.step = 'q1'),
  'delivered', 'a late mark_email_sent never moves the row back');
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', (select id from q where step = 'q1'), 're_q1', 'complained', now()),
  'applied', 'a complaint after delivery is applied');
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', (select id from q where step = 'q1'), 're_q1', 'delivered', now()),
  'ignored', 'complained is final');

insert into q select 'q2', public.queue_email('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite', 1, 'b@a.test',
  null, 'staff_invitation', 'd0000000-0000-0000-0000-000000000021', 'users.view', null, 0::smallint);
select lives_ok($$ select public.mark_email_sent((select id from q where step = 'q2'), 're_q2', 1) $$, 'q2 is sent');
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', null, 're_q2', 'bounced', now()),
  'applied', 'an event without an email_log id is matched by resend_id');
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', (select id from q where step = 'q2'), 're_q2', 'delivered', now()),
  'ignored', 'a late delivered after bounced is ignored');
select is((select e.status from public.email_log e join q on q.id = e.id where q.step = 'q2'), 'bounced', 'the row stays bounced');
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000b', (select id from q where step = 'q2'), 're_q2', 'delivered', now()),
  'not_found', 'another org''s event is not_found');
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000ff', 're_nope', 'sent', now()),
  'not_found', 'an unknown row is not_found');
select throws_ok($$ select public.apply_email_event('b0000000-0000-0000-0000-00000000000a', null, 're_q2', 'failed', now()) $$,
  '22023', null, 'an event status outside the webhook statuses raises 22023');

select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000004', 're_c04', 'delivered', now()),
  'ignored', 'an event of a disabled module is ignored');
select is((select status from public.email_log where id = 'c0000000-0000-0000-0000-000000000004'), 'sent',
  'the disabled module''s row is unchanged');

select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000009', 're_c09', 'delivered', now()),
  'applied', 'failed(provider_unavailable) can be moved on by a later delivered');
select results_eq($$ select status, error_code, resend_id from public.email_log where id = 'c0000000-0000-0000-0000-000000000009' $$,
  $$ values ('delivered'::text, null::text, 're_c09'::text) $$, 'the outcome is no longer unknown: error code cleared, provider id kept');
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000010', null, 'delivered', now()),
  'ignored', 'any other failure is final');

insert into q select 'q3', public.queue_email('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite', 1, 'c@a.test',
  null, 'staff_invitation', 'd0000000-0000-0000-0000-000000000022', 'users.view', null, 0::smallint);
select lives_ok($$ select public.mark_email_failed((select id from q where step = 'q3'), 'provider_rejected', 1) $$, 'mark_email_failed');
select results_eq($$ select e.status, e.error_code, e.attempts from public.email_log e join q on q.id = e.id where q.step = 'q3' $$,
  $$ values ('failed'::text, 'provider_rejected'::text, 1) $$, 'the row is failed with its code');
select throws_ok($$ select public.mark_email_failed((select id from q where step = 'q3'), 'Bad Code', 1) $$,
  '22023', null, 'mark_email_failed refuses a free-text error');

insert into q select 'q4', public.queue_email('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite', 1, 'd@a.test',
  null, 'staff_invitation', 'd0000000-0000-0000-0000-000000000023', 'users.view', null, 0::smallint);
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', (select id from q where step = 'q4'), 're_q4', 'sent', now()),
  'applied', 'the webhook sees q4 sent before the function records it');
select lives_ok($$ select public.mark_email_failed((select id from q where step = 'q4'), 'provider_unavailable', 3) $$,
  'mark_email_failed after the webhook already saw the send');
select results_eq($$ select e.status, e.error_code, e.resend_id from public.email_log e join q on q.id = e.id where q.step = 'q4' $$,
  $$ values ('sent'::text, null::text, 're_q4'::text) $$, 'a late failure never overrides a webhook outcome');

select is(public.count_org_emails_today('b0000000-0000-0000-0000-00000000000b'), 2,
  'count_org_emails_today counts the clinic day only');

-- =============================================================================
-- Jobs (as postgres)
-- =============================================================================
reset role;
select ok(private.job_email_log_stale_queued() ~ '^failed=[0-9]+$', 'the stale-queue job reports a count');
select results_eq($$ select id, status, error_code from public.email_log
                      where id in ('c0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000008') order by id $$,
  $$ values ('c0000000-0000-0000-0000-000000000007'::uuid, 'failed'::text, 'provider_unavailable'::text),
            ('c0000000-0000-0000-0000-000000000008', 'queued', null) $$,
  'a row queued 16 minutes ago fails as provider_unavailable; one queued 14 minutes ago stays queued');
select is(public.apply_email_event('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000007', 're_c07', 'sent', now()),
  'applied', 'a stale-queued row can still be moved on by a webhook');

select ok(private.job_email_log_retention() ~ '^anonymised=[0-9]+$', 'the retention job reports a count');
select results_eq($$ select id, to_email from public.email_log
                      where id in ('c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000006') order by id $$,
  $$ values ('c0000000-0000-0000-0000-000000000005'::uuid, null::text), ('c0000000-0000-0000-0000-000000000006', 'recent@a.test') $$,
  'a row from 25 months ago loses its address; one from 23 months ago keeps it');
select is((select status from public.email_log where id = 'c0000000-0000-0000-0000-000000000005'), 'delivered',
  'the anonymised row is kept');

select * from finish();
rollback;
