-- Clients C5b.4: « Demander une nouvelle signature à tous les clients actifs » (migration
-- *_clients_consent_campaigns.sql, CC-20). Covers: privileges; who may start (clients.manage),
-- P3-40, an unknown consent, no text published, one running per consent; the targets (a consent in
-- force not on the version published now, files active, no request out) flagged « À signer de
-- nouveau »; the job's batch (the author as actor, `sending`), the outcomes, the campaign done;
-- 100 a day per clinic; a stale claim queued again; « Arrêter »; nothing while reserved.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f || ': the app')
  from (values ('start_client_consent_campaign', array['text']), ('cancel_client_consent_campaign', array['uuid'])) as x(f, a);
select function_privs_are('public', f, a, r, e, f || ': ' || r)
  from (values ('client_consent_campaign_batch_for_service', array['uuid', 'integer']),
               ('finish_client_consent_campaign_item_for_service', array['uuid', 'uuid', 'boolean', 'uuid', 'text'])) as x(f, a)
 cross join (values ('authenticated', array[]::text[]), ('service_role', array['EXECUTE'])) as y(r, e);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'pro@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true), ('b0000000-0000-0000-0000-00000000000a', 'clients', true);
-- The admin tests Clients: she keeps clients.manage while it is reserved.
insert into public.org_module_testers (org_id, module_key, user_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'clients', 'a0000000-0000-0000-0000-000000000001');

-- Kim and Zoé (imported general consents), Lou (signed the version published below), Sam (imported,
-- a request out), Ana (imported, archived); 101 files with an imported « liste d'attente ».
insert into public.clients (id, org_id, first_name, last_name, archived_at) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Kim', 'Un', null),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Deux', null),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Lou', 'Trois', null),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Sam', 'Quatre', null),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Ana', 'Cinq', now());
insert into public.clients (org_id, first_name, last_name)
select 'b0000000-0000-0000-0000-00000000000a', 'Essai', 'N' || n from generate_series(1, 101) n;

select set_config('test.vg', (select v.id::text from public.document_template_versions v join public.document_templates t on t.id = v.template_id
  where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr'), true);
select set_config('test.vw', (select v.id::text from public.document_template_versions v join public.document_templates t on t.id = v.template_id
  where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_waitlist_fr'), true);
insert into public.client_consents (org_id, client_id, consent_key, language, template_version_id, version_label, signed_at, signed_by, source)
select 'b0000000-0000-0000-0000-00000000000a', c, 'general', 'fr', null, 'GOrendezvous', now() - interval '1 year', '[]', 'import'
  from (values ('d0000000-0000-0000-0000-000000000001'::uuid), ('d0000000-0000-0000-0000-000000000002'::uuid),
               ('d0000000-0000-0000-0000-000000000004'::uuid), ('d0000000-0000-0000-0000-000000000005'::uuid)) x(c);
insert into public.client_consents (org_id, client_id, consent_key, language, template_version_id, version_label, signed_at, signed_by, source)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'general', 'fr',
        current_setting('test.vg')::uuid, 'v1', now() - interval '1 day', '[]', 'app');
insert into public.client_consents (org_id, client_id, consent_key, language, version_label, signed_at, signed_by, source)
select 'b0000000-0000-0000-0000-00000000000a', c.id, 'waitlist', 'fr', 'GOrendezvous', now() - interval '1 year', '[]', 'import'
  from public.clients c where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.first_name = 'Essai';
insert into public.client_consent_requests (org_id, client_id, consent_key, language, template_version_id, state)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004', 'general', 'fr',
        current_setting('test.vg')::uuid, 'pending');

-- =============================================================================
-- Start
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.start_client_consent_campaign('general') $$, '42501', null, 'a provider cannot (clients.manage)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.start_client_consent_campaign('general') $$,
  'P0001', 'Le texte de ce consentement n''est pas encore publié : publiez-le dans Paramètres → Consentements.', 'no text published yet');
select lives_ok($$ select public.publish_client_consent_version(current_setting('test.vg')::uuid, 'new_clients') $$,
  'the general French text published (Lou''s version)');
select lives_ok($$ select public.publish_client_consent_version(current_setting('test.vw')::uuid, 'new_clients') $$,
  'the waitlist French text published');
select throws_ok($$ select public.start_client_consent_campaign('nope') $$, 'P0001', 'Ce consentement n''existe pas.', 'an unknown consent');
reset role;
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.start_client_consent_campaign('general') $$,
  'P0001', 'Le module Clients est réservé aux testeurs : aucune demande ne part aux clients avant son ouverture à tous.', 'P3-40: not while reserved');
reset role;
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select set_config('test.general', (public.start_client_consent_campaign('general') ->> 'campaign_id'), true);
reset role;
select results_eq($$ select i.client_id from public.client_consent_campaign_items i where i.campaign_id = current_setting('test.general')::uuid order by i.client_id $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid), ('d0000000-0000-0000-0000-000000000002'::uuid) $$,
  'Kim and Zoé (imported): never Lou (on the version in force), Sam (a request out), Ana (archived)');
select results_eq($$ select client_id, state from public.client_consents_status where consent_key = 'general'
                      and client_id in ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003') order by client_id $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'resign'::text), ('d0000000-0000-0000-0000-000000000003', 'signed') $$,
  '… flagged « À signer de nouveau »; Lou still signed');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.start_client_consent_campaign('general') $$,
  'P0001', 'Une campagne de nouvelles signatures est déjà en cours pour ce consentement.', 'one running per consent');
select is((select total::int from public.client_consent_campaigns_summary where id = current_setting('test.general')::uuid), 2, 'the summary: 2 to ask');

-- =============================================================================
-- The job
-- =============================================================================
reset role;
set local role service_role;
select set_config('test.batch', public.client_consent_campaign_batch_for_service('b0000000-0000-0000-0000-00000000000a')::text, true);
select results_eq($$ select (x ->> 'client_id')::uuid, x ->> 'consent_key', (x ->> 'actor')::uuid
                       from jsonb_array_elements(current_setting('test.batch')::jsonb) x order by 1 $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'general'::text, 'a0000000-0000-0000-0000-000000000001'::uuid),
            ('d0000000-0000-0000-0000-000000000002', 'general', 'a0000000-0000-0000-0000-000000000001') $$,
  'the batch: both, with the author as actor');
select is(jsonb_array_length(public.client_consent_campaign_batch_for_service('b0000000-0000-0000-0000-00000000000a')), 0, '… claimed once');
select lives_ok($$ select public.finish_client_consent_campaign_item_for_service('b0000000-0000-0000-0000-00000000000a',
                     (x ->> 'item_id')::uuid, (x ->> 'client_id') like '%1', null,
                     case when (x ->> 'client_id') like '%2' then 'signer_email' end)
                     from jsonb_array_elements(current_setting('test.batch')::jsonb) x $$, 'Kim sent, Zoé failed (no address)');
reset role;
select results_eq($$ select state, queued::int, sent::int, failed::int from public.client_consent_campaigns_summary where id = current_setting('test.general')::uuid $$,
  $$ values ('done'::text, 0, 1, 1) $$, '… the campaign done');
select is((select failure from public.client_consent_campaign_items where client_id = 'd0000000-0000-0000-0000-000000000002'), 'signer_email', '… the refusal kept');

-- 100 a day per clinic: 2 used already, 98 of the 101.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.waitlist', (public.start_client_consent_campaign('waitlist') ->> 'campaign_id'), true);
reset role;
set local role service_role;
select is(jsonb_array_length(public.client_consent_campaign_batch_for_service('b0000000-0000-0000-0000-00000000000a')), 98,
  '100 a day per clinic: 98 left today');
select is(jsonb_array_length(public.client_consent_campaign_batch_for_service('b0000000-0000-0000-0000-00000000000a')), 0, '… then none');
reset role;
update public.client_consent_campaign_items set processed_at = now() - interval '2 hours'
 where id = (select id from public.client_consent_campaign_items where campaign_id = current_setting('test.waitlist')::uuid and state = 'sending' limit 1);
set local role service_role;
select is(jsonb_array_length(public.client_consent_campaign_batch_for_service('b0000000-0000-0000-0000-00000000000a')), 1,
  'a claim older than an hour is queued again, then taken');

-- « Arrêter », P3-40.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.cancel_client_consent_campaign(current_setting('test.waitlist')::uuid) $$, '« Arrêter la campagne »');
reset role;
select results_eq($$ select state, skipped::int from public.client_consent_campaigns_summary where id = current_setting('test.waitlist')::uuid $$,
  $$ values ('cancelled'::text, 3) $$, '… cancelled, the 3 queued skipped');
-- The same campaign running again with today's quota free (yesterday's sends): reserved, nothing.
update public.client_consent_campaigns set state = 'running', finished_at = null, cancelled_by = null where id = current_setting('test.waitlist')::uuid;
update public.client_consent_campaign_items set state = 'sent' where state = 'sending';
update public.client_consent_campaign_items set state = 'queued', processed_at = null where state = 'skipped';
update public.client_consent_campaign_items set processed_at = now() - interval '1 day' where processed_at is not null;
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role service_role;
select is(public.client_consent_campaign_batch_for_service('b0000000-0000-0000-0000-00000000000a'), '[]'::jsonb, 'P3-40: nothing while reserved');
reset role;
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role service_role;
select is(jsonb_array_length(public.client_consent_campaign_batch_for_service('b0000000-0000-0000-0000-00000000000a')), 3, '… open again: the 3 left');

select * from finish();
rollback;
