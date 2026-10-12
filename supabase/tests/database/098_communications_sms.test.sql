-- Communications, batch SM (migration *_communications_sms.sql): textos through the Yeastar PBX.
-- Covers: privileges (tables, the view, user and service RPCs, private helpers); the number,
-- keyword and business-hours helpers; the SMS settings and their rules; the consent (staff entry,
-- the consent notice queued, the audit row redacted, the withdrawal keeping the grant's date);
-- private.send_sms (refusals without a consent, the business-hours rule); RLS per clinic; the
-- send path (queue, claim, mark); the webhook RPCs (inbound text, « ARRÊT », « OUI », a duplicate,
-- the module gate, delivery reports); the PBX session in Vault and its lease; the purge job; the
-- jobs' catalogue rows and cron entries; claim_webhook_event accepting yeastar.
begin;
create extension if not exists pgtap with schema extensions;
select plan(185);

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'sms_consents', 'anon', array[]::text[], 'sms_consents: anon nothing');
select table_privs_are('public', 'sms_consents', 'authenticated', array['SELECT'], 'sms_consents: authenticated select only');
select table_privs_are('public', 'sms_messages', 'anon', array[]::text[], 'sms_messages: anon nothing');
select table_privs_are('public', 'sms_messages', 'authenticated', array['SELECT'], 'sms_messages: authenticated select only');
select table_privs_are('public', 'sms_threads', 'anon', array[]::text[], 'sms_threads: anon nothing');
select table_privs_are('public', 'sms_threads', 'authenticated', array['SELECT'], 'sms_threads: authenticated select only');
select table_privs_are('public', 'sms_provider_sessions', 'anon', array[]::text[], 'sms_provider_sessions: anon nothing');
select table_privs_are('public', 'sms_provider_sessions', 'authenticated', array[]::text[], 'sms_provider_sessions: authenticated nothing');

select function_privs_are('public', f.name, f.args, 'anon', array[]::text[], f.name || ': anon cannot call')
  from (values
    ('get_sms_settings', array[]::text[]),
    ('set_sms_settings', array['jsonb']),
    ('set_sms_consent', array['text', 'text', 'text', 'uuid', 'text']),
    ('queue_sms_for_service', array['uuid', 'uuid', 'text', 'text', 'text']),
    ('claim_sms_batch_for_service', array['uuid', 'integer']),
    ('mark_sms_sent', array['uuid', 'uuid', 'bigint', 'bigint']),
    ('mark_sms_failed', array['uuid', 'uuid', 'text']),
    ('record_inbound_sms', array['uuid', 'text', 'text', 'text', 'jsonb', 'bigint', 'bigint', 'timestamp with time zone']),
    ('apply_sms_delivery_event', array['uuid', 'bigint', 'text', 'text']),
    ('sms_event_known_for_service', array['uuid', 'bigint', 'bigint']),
    ('get_sms_provider_context', array['uuid']),
    ('acquire_sms_provider_lock', array['uuid', 'uuid', 'integer']),
    ('release_sms_provider_lock', array['uuid', 'uuid']),
    ('store_sms_provider_session', array['uuid', 'text', 'text', 'text', 'timestamp with time zone', 'timestamp with time zone']),
    ('set_sms_provider_channel', array['uuid', 'text'])
  ) as f(name, args);
select function_privs_are('public', f.name, f.args, 'authenticated', array[]::text[], f.name || ': authenticated cannot call a service RPC')
  from (values
    ('queue_sms_for_service', array['uuid', 'uuid', 'text', 'text', 'text']),
    ('claim_sms_batch_for_service', array['uuid', 'integer']),
    ('mark_sms_sent', array['uuid', 'uuid', 'bigint', 'bigint']),
    ('mark_sms_failed', array['uuid', 'uuid', 'text']),
    ('record_inbound_sms', array['uuid', 'text', 'text', 'text', 'jsonb', 'bigint', 'bigint', 'timestamp with time zone']),
    ('apply_sms_delivery_event', array['uuid', 'bigint', 'text', 'text']),
    ('sms_event_known_for_service', array['uuid', 'bigint', 'bigint']),
    ('get_sms_provider_context', array['uuid']),
    ('acquire_sms_provider_lock', array['uuid', 'uuid', 'integer']),
    ('release_sms_provider_lock', array['uuid', 'uuid']),
    ('store_sms_provider_session', array['uuid', 'text', 'text', 'text', 'timestamp with time zone', 'timestamp with time zone']),
    ('set_sms_provider_channel', array['uuid', 'text'])
  ) as f(name, args);
select function_privs_are('public', f.name, f.args, 'authenticated', array['EXECUTE'], f.name || ': authenticated may call')
  from (values
    ('get_sms_settings', array[]::text[]),
    ('set_sms_settings', array['jsonb']),
    ('set_sms_consent', array['text', 'text', 'text', 'uuid', 'text'])
  ) as f(name, args);
select function_privs_are('private', f.name, f.args, r.role, array[]::text[], f.name || ': no EXECUTE for ' || r.role)
  from (values
    ('sms_normalize_e164', array['text']),
    ('sms_keyword', array['text']),
    ('sms_business_send_after', array['uuid', 'timestamp with time zone']),
    ('send_sms', array['uuid', 'text', 'text', 'text', 'text', 'uuid', 'boolean', 'uuid']),
    ('sms_confirmation_hook', array['uuid', 'text', 'uuid']),
    ('job_sms_purge', array[]::text[])
  ) as f(name, args)
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);

-- =============================================================================
-- Fixtures (as postgres): org A (module on; admin 01, conseillère 02 given communications.sms by
-- the clinic, provider 03), org B (module on; admin 04). Toronto time for the business hours.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u3@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u4@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'communications', true),
  ('b0000000-0000-0000-0000-00000000000b', 'communications', true);
-- SM-11: the clinic gives the conseillères communications.sms (the template holds admin only).
insert into public.org_role_permissions (org_id, role, permission_key) values
  ('b0000000-0000-0000-0000-00000000000a', 'counselor', 'communications.sms');

select results_eq($$ select rp.role from public.role_permissions rp where rp.permission_key in ('communications.sms', 'communications.sms_manage') order by rp.role $$,
  $$ values ('admin'), ('admin') $$, 'the template grants the SMS permissions to admin only (SM-11)');
select isnt_empty($$ select 1 from public.modules where key = 'communications' $$, 'the module row exists');

-- =============================================================================
-- Helpers: numbers, keywords, business hours
-- =============================================================================
select is(private.sms_normalize_e164('(514) 555-1234'), '+15145551234', 'a 10-digit number becomes +1…');
select is(private.sms_normalize_e164('1 514 555 1234'), '+15145551234', '11 digits led by 1');
select is(private.sms_normalize_e164('+33 6 12 34 56 78'), '+33612345678', 'a + number is kept');
select is(private.sms_normalize_e164('555-1234'), null, '7 digits is not a number');
select is(private.sms_normalize_e164('0514 555 1234'), null, 'a 10-digit number cannot start with 0');
select is(private.sms_normalize_e164(''), null, 'empty is null');

select is(private.sms_keyword('ARRÊT'), 'stop', '« ARRÊT » stops');
select is(private.sms_keyword(' arret. '), 'stop', '« arret. » stops (accent, case, punctuation)');
select is(private.sms_keyword('Stop'), 'stop', '« Stop » stops');
select is(private.sms_keyword('UNSUBSCRIBE'), 'stop', '« UNSUBSCRIBE » stops');
select is(private.sms_keyword('Oui!'), 'yes', '« Oui! » confirms');
select is(private.sms_keyword('yes'), 'yes', '« yes » confirms');
select is(private.sms_keyword('stop l''envoi'), null, 'a sentence is not a keyword');
select is(private.sms_keyword(''), null, 'empty is not a keyword');

-- 2027-03-10 is a Wednesday. Toronto is UTC−5 in March before the 14th.
select is(private.sms_business_send_after('b0000000-0000-0000-0000-00000000000a', '2027-03-10T15:00:00Z'),
  '2027-03-10T15:00:00Z'::timestamptz, 'Wednesday 10:00 Toronto: now');
select is(private.sms_business_send_after('b0000000-0000-0000-0000-00000000000a', '2027-03-10T11:30:00Z'),
  '2027-03-10T13:00:00Z'::timestamptz, 'Wednesday 6:30: that day at 8:00');
select is(private.sms_business_send_after('b0000000-0000-0000-0000-00000000000a', '2027-03-10T22:00:00Z'),
  '2027-03-11T13:00:00Z'::timestamptz, 'Wednesday 17:00: Thursday 8:00');
select is(private.sms_business_send_after('b0000000-0000-0000-0000-00000000000a', '2027-03-13T15:00:00Z'),
  '2027-03-15T12:00:00Z'::timestamptz, 'Saturday: Monday 8:00 (daylight time from the 14th)');
select is(private.sms_business_send_after('b0000000-0000-0000-0000-00000000000a', '2027-03-12T21:59:59Z'),
  '2027-03-12T21:59:59Z'::timestamptz, 'Friday 16:59:59: now');

-- =============================================================================
-- Settings
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_sms_settings() $$, '42501', null, 'a provider cannot read the SMS settings');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((public.get_sms_settings()) ->> 'sms_did', null, 'the conseillère reads the settings (no number yet)');
select alike((public.get_sms_settings()) ->> 'sms_consent_text', '%ARRÊT%', 'the default consent text names ARRÊT');
select throws_ok($$ select public.set_sms_settings('{"sms_did": "418 555 0199"}') $$, '42501', null, 'communications.sms_manage to change them');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_sms_settings('{"sms_base_url": "http://pbx.exemple.com"}') $$, 'P0001',
  'L''adresse de la centrale doit commencer par https:// et ne contenir que son nom d''hôte (par exemple https://pbx.exemple.com).',
  'the PBX address must be https and a host');
select throws_ok($$ select public.set_sms_settings('{"sms_did": "555-0199"}') $$, 'P0001',
  'Le numéro de la clinique doit être un numéro à 10 chiffres (par exemple 418 555-0199).', 'the number must be readable');
select throws_ok($$ select public.set_sms_settings('{"sms_consent_text": "Vous acceptez de recevoir nos textos. Merci beaucoup."}') $$, 'P0001',
  'Le texte de consentement doit dire comment se désabonner : il doit contenir le mot ARRÊT.', 'the consent text must name ARRÊT');
select throws_ok($$ select public.set_sms_settings('{"sms_opt_out_reply": "Merci."}') $$, 'P0001',
  'Le texte doit compter de 20 à 480 caractères.', 'a text too short is refused');
select throws_ok($$ select public.set_sms_settings('{"unknown": 1}') $$, '22023', null, 'an unknown key is a developer error');
select is((public.set_sms_settings('{"sms_base_url": "https://pbx.exemple.com/", "sms_client_id": "mana-app", "sms_did": "(418) 555-0199"}')) ->> 'sms_did',
  '+14185550199', 'the number is stored as E.164');
select is((public.get_sms_settings()) ->> 'sms_base_url', 'https://pbx.exemple.com', 'the address loses its trailing slash');
reset role;
select is((select a.source from public.audit_log a where a.table_name = 'org_module_settings'
            and a.record_id = 'b0000000-0000-0000-0000-00000000000a:communications' order by a.id desc limit 1),
  'rpc:set_sms_settings', 'the settings write is audited under the RPC');

-- =============================================================================
-- Consent (the staff's entry) and the consent notice
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.set_sms_consent('514 555 1234', 'opted_in') $$, '42501', null, 'a provider records no consent');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_sms_consent('555', 'opted_in') $$, 'P0001',
  'Le numéro de téléphone n''est pas valide : indiquez un numéro à 10 chiffres.', 'an unreadable number is refused in French');
select throws_ok($$ select public.set_sms_consent('514 555 1234', 'maybe') $$, '22023', null, 'an unknown status is a developer error');
select is((public.set_sms_consent('(514) 555-1234', 'opted_in', null, null, 'Au téléphone le 12 oct.')) ->> 'status', 'opted_in',
  'the conseillère records a consent given by phone');
reset role;
select results_eq($$ select c.phone_e164, c.source, c.updated_by, c.note, c.granted_at is not null, c.withdrawn_at
                       from public.sms_consents c where c.org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('+15145551234', 'staff', 'a0000000-0000-0000-0000-000000000002'::uuid, 'Au téléphone le 12 oct.', true, null::timestamptz) $$,
  'the consent row: number as E.164, source staff, the actor, the note, granted');
select results_eq($$ select m.kind, m.status, m.send_after, m.direction, m.body = (private.sms_settings('b0000000-0000-0000-0000-00000000000a') ->> 'sms_consent_text')
                       from public.sms_messages m where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.peer_e164 = '+15145551234' $$,
  $$ values ('consent_notice', 'queued', null::timestamptz, 'out', true) $$,
  'a new consent queues the consent notice, at once, with the clinic''s text');
select results_eq($$ select a.changed_fields -> 'phone_e164', a.changed_fields -> 'note', a.changed_fields ->> 'status', a.actor_id
                       from public.audit_log a where a.table_name = 'sms_consents' and a.org_id = 'b0000000-0000-0000-0000-00000000000a' and a.action = 'insert' $$,
  $$ values ('"[redacted]"'::jsonb, '"[redacted]"'::jsonb, 'opted_in', 'a0000000-0000-0000-0000-000000000002'::uuid) $$,
  'the audit row keeps the status and the actor, never the number or the note');

-- The same consent again: no second notice.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.set_sms_consent('514-555-1234', 'opted_in') $$, 'recording an existing consent again is harmless');
reset role;
select is((select count(*)::int from public.sms_messages m where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.kind = 'consent_notice'), 1,
  '… and queues no second notice');

-- =============================================================================
-- private.send_sms: the plug-in
-- =============================================================================
select throws_ok($$ select private.send_sms('b0000000-0000-0000-0000-00000000000a', '514 555 9999', 'Rappel', 'reminder') $$, 'P0001',
  'Aucun texto ne peut être envoyé à ce numéro : la personne n''a pas donné son consentement, ou l''a retiré.',
  'no text to a number without consent');
select throws_ok($$ select private.send_sms('b0000000-0000-0000-0000-00000000000a', '514 555 1234', '', 'reminder') $$, 'P0001',
  'Le texto doit compter de 1 à 1600 caractères.', 'an empty text is refused');
select throws_ok($$ select private.send_sms('b0000000-0000-0000-0000-00000000000a', '514 555 1234', 'x', 'bogus') $$, '22023', null, 'an unknown kind is a developer error');
select isa_ok(private.send_sms('b0000000-0000-0000-0000-00000000000a', '514 555 1234', 'Rappel : votre rendez-vous de demain.', 'reminder', 'appointment', 'd0000000-0000-0000-0000-000000000001'),
  'uuid', 'a reminder to a consented number is queued');
select is((select m.send_after = private.sms_business_send_after('b0000000-0000-0000-0000-00000000000a', now())
             from public.sms_messages m where m.kind = 'reminder' and m.org_id = 'b0000000-0000-0000-0000-00000000000a'),
  true, 'a reminder waits for the business hours (SM-5)');
select is((select m.subject_id from public.sms_messages m where m.kind = 'reminder' and m.org_id = 'b0000000-0000-0000-0000-00000000000a'),
  'd0000000-0000-0000-0000-000000000001'::uuid, '… and names its appointment');
select lives_ok($$ select private.send_sms('b0000000-0000-0000-0000-00000000000a', '514 555 9999', 'Test', 'test') $$,
  'a test needs no consent (SM-6)');
select lives_ok($$ select private.send_sms('b0000000-0000-0000-0000-00000000000a', '514 555 9999', 'Vous ne recevrez plus de textos.', 'opt_out_ack') $$,
  'the acknowledgement of a withdrawal needs none either (SM-6)');
delete from public.sms_messages where org_id = 'b0000000-0000-0000-0000-00000000000a' and peer_e164 = '+15145559999';

-- =============================================================================
-- RLS: the conseillère of A reads A's rows; B reads nothing of A; the provider nothing
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.sms_messages), 2, 'the conseillère sees the clinic''s two texts');
select results_eq($$ select t.peer_e164, t.message_count, t.consent_status, t.last_direction from public.sms_threads t $$,
  $$ values ('+15145551234', 2, 'opted_in', 'out') $$, 'the threads view: one thread, two texts, the consent in force');
select is((select count(*)::int from public.sms_consents), 1, '… and the consent');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.sms_messages), 0, 'B sees none of A''s texts');
select is((select count(*)::int from public.sms_threads), 0, '… nor its threads');
select is((select count(*)::int from public.sms_consents), 0, '… nor its consents');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.sms_messages), 0, 'the provider (no communications.sms) sees nothing');
reset role;

-- =============================================================================
-- The send path: queue (sms-send), claim (sms-dispatch), mark
-- =============================================================================
set local role service_role;
select throws_ok($$ select public.queue_sms_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', '514 555 1234', 'Bonjour', 'reply') $$,
  '42501', null, 'a provider cannot reply');
select throws_ok($$ select public.queue_sms_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', '514 555 0000', 'Test', 'test') $$,
  '42501', null, 'a test needs communications.sms_manage');
select throws_ok($$ select public.queue_sms_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', '514 555 1234', 'Bonjour', 'reply') $$,
  '42501', null, 'a member of another clinic cannot act in A');
select throws_ok($$ select public.queue_sms_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', '514 555 9999', 'Bonjour', 'reply') $$,
  'P0001', null, 'a reply to a number without consent is refused');
select is((public.queue_sms_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', '514-555-1234', 'Bonjour, nous vous rappelons demain.', 'reply')) ->> 'to_e164',
  '+15145551234', 'the conseillère''s reply is queued and claimed');
select results_eq($$ select m.status, m.attempts, m.sent_by, m.request_id = 'mana-' || m.id::text, m.send_after
                       from public.sms_messages m where m.kind = 'reply' $$,
  $$ values ('sending', 1, 'a0000000-0000-0000-0000-000000000002'::uuid, true, null::timestamptz) $$,
  'a reply is `sending` at once, attributed, with our request id');
select is((public.queue_sms_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', '514 555 0000', 'Texto de test.', 'test')) ->> 'to_e164',
  '+15145550000', 'the admin''s test needs no consent');

select lives_ok($$ select public.mark_sms_sent('b0000000-0000-0000-0000-00000000000a', (select m.id from public.sms_messages m where m.kind = 'reply'), 10325, 3089) $$,
  'the PBX accepted the reply');
select results_eq($$ select m.status, m.provider_msg_id, m.provider_session_id, m.sent_at is not null from public.sms_messages m where m.kind = 'reply' $$,
  $$ values ('sent', 10325::bigint, 3089::bigint, true) $$, '… sent, with its ids');
select throws_ok($$ select public.mark_sms_sent('b0000000-0000-0000-0000-00000000000a', (select m.id from public.sms_messages m where m.kind = 'reply'), 1, 1) $$,
  '22023', null, 'a settled text is not marked twice');
select lives_ok($$ select public.mark_sms_failed('b0000000-0000-0000-0000-00000000000a', (select m.id from public.sms_messages m where m.kind = 'test'), 'provider_unreachable') $$,
  'the test failed');
select is((select m.error_code from public.sms_messages m where m.kind = 'test'), 'provider_unreachable', '… with its code');
select throws_ok($$ select public.mark_sms_failed('b0000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'Bad Code!') $$, '22023', null, 'a code must be an identifier');

-- The dispatch: the consent notice is due (at once); the reminder waits for the business hours
-- unless they are open now; a stale `sending` row fails; a withdrawn number fails.
reset role;
update public.sms_messages set send_after = now() - interval '1 minute' where kind = 'reminder';
insert into public.sms_messages (org_id, direction, peer_e164, kind, body, status, claimed_at, attempts)
values ('b0000000-0000-0000-0000-00000000000a', 'out', '+15145551234', 'other', 'Perdu', 'sending', now() - interval '20 minutes', 1);
insert into public.sms_consents (org_id, phone_e164, status, source, granted_at, withdrawn_at)
values ('b0000000-0000-0000-0000-00000000000a', '+15145557777', 'opted_out', 'sms_reply', now() - interval '1 day', now());
insert into public.sms_messages (org_id, direction, peer_e164, kind, body, status)
values ('b0000000-0000-0000-0000-00000000000a', 'out', '+15145557777', 'reminder', 'Rappel', 'queued');
set local role service_role;
select results_eq($$ select c.kind, c.to_e164 from public.claim_sms_batch_for_service('b0000000-0000-0000-0000-00000000000a', 10) c order by c.kind $$,
  $$ values ('consent_notice', '+15145551234'), ('reminder', '+15145551234') $$, 'the dispatch claims the due texts of consented numbers');
select results_eq($$ select m.status, m.error_code from public.sms_messages m where m.body = 'Perdu' $$,
  $$ values ('failed', 'provider_unavailable') $$, 'a text left `sending` for 15 minutes fails, outcome unknown');
select results_eq($$ select m.status, m.error_code from public.sms_messages m where m.peer_e164 = '+15145557777' $$,
  $$ values ('failed', 'consent_withdrawn') $$, 'a due text to a withdrawn number is never sent (SM-6)');
select is((select count(*)::int from public.claim_sms_batch_for_service('b0000000-0000-0000-0000-00000000000a', 10)), 0, 'a second claim finds nothing');
select throws_ok($$ select * from public.claim_sms_batch_for_service('b0000000-0000-0000-0000-00000000000a', 0) $$, '22023', null, 'the batch size is bounded');
reset role;

-- =============================================================================
-- The webhook RPCs: inbound texts, « ARRÊT », « OUI », duplicates, the module gate, delivery
-- =============================================================================
set local role service_role;
select is((public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', '+15145551234', '+14185550199', 'Merci, à demain', '[]', 20001, 3089, '2027-03-10T15:00:00Z')) ->> 'outcome',
  'recorded', 'an inbound text is recorded');
select is((public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', '+15145551234', '+14185550199', 'Merci, à demain', '[]', 20001, 3089, '2027-03-10T15:00:00Z')) ->> 'outcome',
  'duplicate', 'the same PBX message again is a duplicate');
select is((public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', 'api', null, 'x', '[]', 20002, null, null)) ->> 'outcome',
  'unreadable_number', 'a sender that is no number is not stored');
reset role;
select results_eq($$ select m.direction, m.kind, m.status, m.body, m.did_e164, m.created_at, m.provider_msg_id
                       from public.sms_messages m where m.provider_msg_id = 20001 $$,
  $$ values ('in', 'inbound', 'received', 'Merci, à demain', '+14185550199', '2027-03-10T15:00:00Z'::timestamptz, 20001::bigint) $$,
  'the inbound row: received at the PBX''s time, through the clinic''s number');
select results_eq($$ select n.kind, n.importance, n.title, n.body, n.link_path, n.recipient_permission, n.subject_type
                       from public.notifications n where n.org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('communications.sms_received', 'normal', 'Nouveau texto reçu', 'Une personne a écrit au numéro de la clinique.',
             '/textos?message=' || (select m.id::text from public.sms_messages m where m.provider_msg_id = 20001), 'communications.sms', 'sms_message') $$,
  'the staff is told a text arrived: never its content or number');

-- « OUI »: the hook (a stub until Rendez-vous) confirms nothing.
set local role service_role;
select results_eq($$ select r ->> 'keyword', r ->> 'confirmed', r ->> 'opted_out'
                       from public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', '514 555 1234', null, 'Oui', '[]', 20003, 3089, null) r $$,
  $$ values ('yes', 'false', 'false') $$, '« Oui » is read; the stub confirms nothing yet (SM-7)');

-- « ARRÊT »: the consent is withdrawn, the acknowledgement claimed for the webhook to send.
select results_eq($$ select r ->> 'keyword', r ->> 'opted_out', r -> 'ack' ->> 'to_e164', r -> 'ack' ->> 'body'
                       from public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', '514 555 1234', '+14185550199', ' Arrêt ', '[]', 20004, 3089, null) r $$,
  $$ values ('stop', 'true', '+15145551234', 'Vous ne recevrez plus de textos de la clinique. Pour les recevoir de nouveau, communiquez avec nous.') $$,
  '« Arrêt » withdraws the consent and answers the clinic''s default text');
reset role;
select results_eq($$ select c.status, c.source, c.granted_at is not null, c.withdrawn_at is not null, c.note
                       from public.sms_consents c where c.phone_e164 = '+15145551234' $$,
  $$ values ('opted_out', 'sms_reply', true, true, 'Au téléphone le 12 oct.') $$,
  'the consent is withdrawn by the person''s own text; the grant''s date and the note stay (history)');
select results_eq($$ select m.kind, m.status, m.attempts, m.did_e164 from public.sms_messages m where m.kind = 'opt_out_ack' $$,
  $$ values ('opt_out_ack', 'sending', 1, '+14185550199') $$, 'the acknowledgement is `sending`, claimed by the webhook');
select isnt_empty($$ select 1 from public.notifications n where n.kind = 'communications.sms_opted_out' and n.org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  'the staff is told of the withdrawal');
select is((select count(*)::int from public.audit_log a where a.table_name = 'sms_consents' and a.action = 'update'
             and a.changed_fields -> 'status' ->> 'after' = 'opted_out' and a.org_id = 'b0000000-0000-0000-0000-00000000000a'), 1,
  'the withdrawal is in the audit trail (status only)');
select throws_ok($$ select private.send_sms('b0000000-0000-0000-0000-00000000000a', '514 555 1234', 'Rappel', 'reminder') $$, 'P0001', null,
  'from then on nothing goes to that number');

-- A staff re-consent (the person asked by phone) grants again and notes the new date.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((public.set_sms_consent('514 555 1234', 'opted_in', 'client', 'c0000000-0000-0000-0000-000000000001', 'Rappelé le 13 oct.')) ->> 'status', 'opted_in',
  'the staff may record a new consent after a withdrawal');
reset role;
select results_eq($$ select c.source, c.withdrawn_at, c.subject_type, c.subject_id from public.sms_consents c where c.phone_e164 = '+15145551234' $$,
  $$ values ('staff', null::timestamptz, 'client', 'c0000000-0000-0000-0000-000000000001'::uuid) $$, '… in force again, linked to the person');
select is((select count(*)::int from public.sms_messages m where m.kind = 'consent_notice' and m.org_id = 'b0000000-0000-0000-0000-00000000000a'), 2,
  '… with a new consent notice');

-- Whose event is it (SM-13): the clinic's message, its session, or another tenant's.
set local role service_role;
select is(public.sms_event_known_for_service('b0000000-0000-0000-0000-00000000000a', 10325, null), 'message', 'our message id is known');
select is(public.sms_event_known_for_service('b0000000-0000-0000-0000-00000000000a', 77777, 3089), 'session', 'an unknown message of our session is known by the session');
select is(public.sms_event_known_for_service('b0000000-0000-0000-0000-00000000000a', 77777, 77), 'none', 'another tenant''s ids are unknown');
select is(public.sms_event_known_for_service('b0000000-0000-0000-0000-00000000000b', 10325, 3089), 'none', '… and so are ours to another clinic');
reset role;

-- Delivery reports.
set local role service_role;
select is(public.apply_sms_delivery_event('b0000000-0000-0000-0000-00000000000a', 10325, 'failed', 'invalid_phone_number'), 'applied', 'a delivery failure is applied');
select is(public.apply_sms_delivery_event('b0000000-0000-0000-0000-00000000000a', 10325, 'sent', null), 'applied', 'a later success too (the PBX''s word)');
select is(public.apply_sms_delivery_event('b0000000-0000-0000-0000-00000000000a', 99999, 'sent', null), 'not_found', 'an unknown message id');
select is(public.apply_sms_delivery_event('b0000000-0000-0000-0000-00000000000b', 10325, 'sent', null), 'not_found', 'another clinic''s id is not found');
select throws_ok($$ select public.apply_sms_delivery_event('b0000000-0000-0000-0000-00000000000a', 10325, 'delivered', null) $$, '22023', null, 'only sent or failed');
reset role;
select results_eq($$ select m.status, m.error_code from public.sms_messages m where m.provider_msg_id = 10325 $$,
  $$ values ('sent', null::text) $$, 'the reply ends `sent`');

-- The module gate: nothing is stored or applied while the module is off.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';
set local role service_role;
select is((public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', '514 555 1234', null, 'Allo', '[]', 20005, null, null)) ->> 'outcome', 'ignored',
  'an inbound text is ignored while the module is off');
select is(public.apply_sms_delivery_event('b0000000-0000-0000-0000-00000000000a', 10325, 'failed', null), 'ignored', 'a delivery report too');
select is((public.get_sms_provider_context('b0000000-0000-0000-0000-00000000000a')) ->> 'module_enabled', 'false', 'the context says the module is off');
reset role;
select is((select count(*)::int from public.sms_messages m where m.provider_msg_id = 20005), 0, '… and nothing was stored');
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';

-- =============================================================================
-- The PBX session: Vault, the lease, the channel, the context
-- =============================================================================
insert into public.org_secrets (org_id, key, vault_secret_id)
values ('b0000000-0000-0000-0000-00000000000a', 'yeastar_client_secret',
        vault.create_secret('local-test-client-secret', 'org:b0000000-0000-0000-0000-00000000000a:yeastar_client_secret'));
set local role service_role;
select results_eq($$ select c ->> 'base_url', c ->> 'client_id', c ->> 'client_secret', c ->> 'did', c -> 'session', c -> 'channel', c ->> 'clinic_name'
                       from public.get_sms_provider_context('b0000000-0000-0000-0000-00000000000a') c $$,
  $$ values ('https://pbx.exemple.com', 'mana-app', 'local-test-client-secret', '+14185550199', 'null'::jsonb, 'null'::jsonb, 'Org A') $$,
  'the context: the settings, the client secret from Vault, no session yet');
select is(public.acquire_sms_provider_lock('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 120), true, 'the first owner takes the lease');
select is(public.acquire_sms_provider_lock('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 120), false, 'a second owner waits');
select is(public.acquire_sms_provider_lock('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 120), true, 'the holder may take it again');
select lives_ok($$ select public.release_sms_provider_lock('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002') $$, 'another owner''s release is a no-op');
select is(public.acquire_sms_provider_lock('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 120), false, '… the lease still held');
select lives_ok($$ select public.release_sms_provider_lock('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001') $$, 'the holder releases');
select is(public.acquire_sms_provider_lock('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 120), true, '… and the second owner takes it');
reset role;
update public.sms_provider_sessions set locked_until = now() - interval '1 second' where org_id = 'b0000000-0000-0000-0000-00000000000a';
set local role service_role;
select is(public.acquire_sms_provider_lock('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000003', 120), true, 'a lapsed lease is taken over');

select lives_ok($$ select public.store_sms_provider_session('b0000000-0000-0000-0000-00000000000a', 'https://pbx.exemple.com', 'access-1', 'refresh-1', '2027-03-10T15:30:00Z', '2027-03-11T15:00:00Z') $$,
  'a session is stored');
select results_eq($$ select c -> 'session' ->> 'access_token', c -> 'session' ->> 'refresh_token', (c -> 'session' ->> 'access_expires_at')::timestamptz
                       from public.get_sms_provider_context('b0000000-0000-0000-0000-00000000000a') c $$,
  $$ values ('access-1', 'refresh-1', '2027-03-10T15:30:00Z'::timestamptz) $$, 'the context returns the tokens (to the service role only)');
select lives_ok($$ select public.store_sms_provider_session('b0000000-0000-0000-0000-00000000000a', 'https://pbx.exemple.com', 'access-2', null, '2027-03-10T16:00:00Z', null) $$,
  'a refresh without a refresh token');
reset role;
select results_eq($$ select s.refresh_secret_id, (select count(*)::int from vault.secrets v where v.name like 'sms_session:b0000000-0000-0000-0000-00000000000a:%')
                       from public.sms_provider_sessions s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values (null::uuid, 1) $$, 'the refresh entry is removed from Vault, the access entry updated in place');
select is((select v.decrypted_secret from vault.decrypted_secrets v where v.name = 'sms_session:b0000000-0000-0000-0000-00000000000a:access'), 'access-2',
  '… holding the new token');
set local role service_role;
select lives_ok($$ select public.set_sms_provider_channel('b0000000-0000-0000-0000-00000000000a', 'general') $$, 'the channel is remembered');
select is((public.get_sms_provider_context('b0000000-0000-0000-0000-00000000000a')) ->> 'channel', 'general', '… and returned while fresh');
reset role;
update public.sms_provider_sessions set channel_cached_at = now() - interval '11 minutes' where org_id = 'b0000000-0000-0000-0000-00000000000a';
set local role service_role;
select is((public.get_sms_provider_context('b0000000-0000-0000-0000-00000000000a')) -> 'channel', 'null'::jsonb, '… not after 10 minutes');
reset role;
delete from public.sms_provider_sessions where org_id = 'b0000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from vault.secrets v where v.name like 'sms_session:b0000000-0000-0000-0000-00000000000a:%'), 0,
  'deleting the session removes its Vault entries');

-- =============================================================================
-- The purge job, the catalogue rows, the cron entries, the webhook provider
-- =============================================================================
insert into public.sms_messages (org_id, direction, peer_e164, kind, body, status, created_at)
values ('b0000000-0000-0000-0000-00000000000a', 'out', '+15145551234', 'reminder', 'Vieux rappel', 'sent', now() - interval '13 months'),
       ('b0000000-0000-0000-0000-00000000000a', 'in', '+15145551234', 'inbound', 'Très vieux', 'received', now() - interval '25 months');
select is(private.job_sms_purge(), 'bodies_purged=2 numbers_purged=1', 'the purge nulls bodies after 12 months and numbers after 24 (SM-8)');
select results_eq($$ select m.body, m.peer_e164, m.body_purged_at is not null from public.sms_messages m where m.created_at < now() - interval '12 months' order by m.created_at $$,
  $$ values (null::text, null::text, true), (null::text, '+15145551234', true) $$, '… rows stay, counted');
select is(private.job_sms_purge(), 'bodies_purged=0 numbers_purged=0', 'a second run finds nothing');

select results_eq($$ select j.module_key, j.kind, j.function_name, j.sql_function, j.is_maintenance, j.local_hour, c.schedule::text
                       from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
                      where j.key in ('communications.sms_dispatch', 'communications.sms_purge') order by j.key $$,
  $$ values ('communications', 'function', 'sms-dispatch', null::text, false, null::smallint, '*/15 * * * *'),
            ('communications', 'sql', null::text, 'private.job_sms_purge', true, null::smallint, '35 8 * * *') $$,
  'the two jobs are catalogued and scheduled');
select isnt_empty($$ select 1 from public.org_scheduled_jobs s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.job_key = 'communications.sms_dispatch' and not s.enabled $$,
  'the dispatch starts off for the clinic (a business job)');

set local role service_role;
select is((select w.status from public.claim_webhook_event('yeastar', 'b0000000-0000-0000-0000-00000000000a:30031:20001', 'b0000000-0000-0000-0000-00000000000a', 'message', '{"msg_id": 20001}') w),
  'claimed', 'claim_webhook_event accepts yeastar');
select throws_ok($$ select public.claim_webhook_event('twilio', 'x', 'b0000000-0000-0000-0000-00000000000a', 'message', '{}') $$, '22023', null, '… and no other new provider');
reset role;

select * from finish();
rollback;
