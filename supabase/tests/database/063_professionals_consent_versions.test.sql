-- « Consentements » (migration *_professionals_documents_settings.sql, plan Phase 4 Task 4c.3,
-- P4-452). Covers: privileges; the read (versions newest first, the current one, who published,
-- signatures per version; drafts for staff); save a draft (created as the next version, rewritten
-- in place, one per key, refusals with their HINT); publish (signing then uses it, a published
-- version is never published again nor discarded); discard a draft; permissions (settings to
-- write, manage or settings to read, never the provider or another clinic); audit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

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
-- Fixtures (as postgres): org A (admin 01, adjointe 02, provider 03 linked to P1, conseillère 04),
-- org B (admin 05). Each clinic has version 1 of « droit à l'image », published by the seed.
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
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'provider@a.test', 'active');

select set_config('test.v1', (select id::text from public.consent_versions
                                where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'image_rights' and version = 1), true);
-- One signature of version 1 (as 4b.1's apply leaves it).
insert into public.professional_consents (org_id, professional_id, consent_version_id, signer_name, signed_at, expires_on)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.v1')::uuid,
        'Pia Un', now(), current_date + 365);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'get_consent_versions', array['text'], 'authenticated', array['EXECUTE'], 'read: authenticated');
select function_privs_are('public', 'save_consent_draft', array['text', 'text', 'text'], 'authenticated', array['EXECUTE'], 'save: authenticated');
select function_privs_are('public', 'publish_consent_version', array['uuid'], 'authenticated', array['EXECUTE'], 'publish: authenticated');
select function_privs_are('public', 'discard_consent_draft', array['uuid'], 'authenticated', array['EXECUTE'], 'discard: authenticated');
select function_privs_are('public', 'get_consent_versions', array['text'], 'anon', array[]::text[], 'read: not anon');
select function_privs_are('public', 'save_consent_draft', array['text', 'text', 'text'], 'service_role', array[]::text[], 'save: not the service role');
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_consent_versions', 'save_consent_draft', 'publish_consent_version', 'discard_consent_draft')
     and (not p.prosecdef or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the RPCs are security definer, for authenticated only');
select function_privs_are('private', 'consent_draft_for_update', array['uuid', 'text'], 'authenticated', array[]::text[],
  'the draft lock helper is granted to no API role');

-- =============================================================================
-- Read, then a draft
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select (public.get_consent_versions() ->> 'current_id')::uuid,
                            jsonb_array_length(public.get_consent_versions() -> 'versions'),
                            (public.get_consent_versions() #>> '{versions,0,signed_count}')::int,
                            public.get_consent_versions() #>> '{versions,0,published_at}' is not null $$,
  $$ values (current_setting('test.v1')::uuid, 1, 1, true) $$,
  'the seeded version is current, published, with its one signature');

select set_config('test.v2', public.save_consent_draft('image_rights', '  Consentement   au droit à l''image ',
  E'  Nouveau texte.\n\nDeuxième paragraphe.  ')::text, true);
select results_eq($$ select version, title, body, published_at from public.consent_versions where id = current_setting('test.v2')::uuid $$,
  $$ values (2, 'Consentement au droit à l''image'::text, E'Nouveau texte.\n\nDeuxième paragraphe.'::text, null::timestamptz) $$,
  'a draft: the next version, title tidied, text trimmed (paragraphs kept), not published');
select is((public.get_consent_versions() ->> 'current_id')::uuid, current_setting('test.v1')::uuid,
  'signing still uses version 1 while the draft waits');
select is((public.get_consent_versions() #>> '{versions,0,version}')::int, 2, 'versions newest first, the draft included');
select is(public.save_consent_draft('image_rights', 'Titre révisé', 'Texte révisé.'), current_setting('test.v2')::uuid,
  'saving again rewrites the same draft (one per consent)');
select is((select count(*)::int from public.consent_versions where org_id = 'b0000000-0000-0000-0000-00000000000a'), 2,
  'still two versions');
select is((select title from public.consent_versions where id = current_setting('test.v2')::uuid), 'Titre révisé', 'the draft''s title changed');

select is(private.test_error_hint($$ select public.save_consent_draft('image_rights', '   ', 'Texte') $$), 'title',
  'a title is required (HINT title)');
select throws_ok($$ select public.save_consent_draft('image_rights', 'Titre', E' \n ') $$,
  'P0001', 'Le texte du consentement est obligatoire.', 'a text is required');
select is(private.test_error_hint($$ select public.save_consent_draft('image_rights', 'Titre', repeat('a', 20001)) $$), 'body',
  'the text has at most 20 000 characters (HINT body)');
select throws_ok($$ select public.save_consent_draft('photo_rights', 'Titre', 'Texte') $$, '22023', null, 'an unknown consent: 22023');

-- =============================================================================
-- Publish, discard
-- =============================================================================
select lives_ok($$ select public.publish_consent_version(current_setting('test.v2')::uuid) $$, 'the admin publishes the draft');
reset role;
select results_eq($$ select published_at is not null, published_by from public.consent_versions where id = current_setting('test.v2')::uuid $$,
  $$ values (true, 'a0000000-0000-0000-0000-000000000001'::uuid) $$, 'published, by whom');
select is(private.current_consent_version('b0000000-0000-0000-0000-00000000000a', 'image_rights'), current_setting('test.v2')::uuid,
  'signing now uses version 2');
select is((select consent_version_id from public.professional_consents where professional_id = 'c0000000-0000-0000-0000-000000000001'),
  current_setting('test.v1')::uuid, 'the signature keeps the version it signed');
select ok(exists (select 1 from public.audit_log a where a.table_name = 'consent_versions' and a.record_id = current_setting('test.v2')
                                                   and a.action = 'update' and a.changed_fields ? 'published_at'),
  'the publication is audited');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((public.get_consent_versions() #>> '{versions,0,published_by_name}'), 'Admin A', 'who published it');
select throws_ok($$ select public.publish_consent_version(current_setting('test.v2')::uuid) $$,
  'P0001', 'Cette version est déjà publiée.', 'a version is published once');
select throws_ok($$ select public.discard_consent_draft(current_setting('test.v1')::uuid) $$,
  'P0001', 'Une version publiée ne peut pas être supprimée.', 'a published version is never removed');
select set_config('test.v3', public.save_consent_draft('image_rights', 'Version 3', 'Texte 3.')::text, true);
select is((select version from public.consent_versions where id = current_setting('test.v3')::uuid), 3, 'the next draft is version 3');
select lives_ok($$ select public.discard_consent_draft(current_setting('test.v3')::uuid) $$, 'a draft can be discarded');
select is((select count(*)::int from public.consent_versions where id = current_setting('test.v3')::uuid), 0, 'the draft is gone');
select is(private.test_error_hint($$ select public.publish_consent_version(current_setting('test.v3')::uuid) $$), 'version',
  'an unknown version (HINT version)');

-- =============================================================================
-- Who
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(jsonb_array_length(public.get_consent_versions() -> 'versions'), 2, 'the adjointe (manage) reads the versions');
select throws_ok($$ select public.save_consent_draft('image_rights', 'Titre', 'Texte') $$, '42501', null, 'the adjointe does not write them');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.get_consent_versions() $$, '42501', null, 'the conseillère does not read the settings');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_consent_versions() $$, '42501', null, 'the provider does not read the settings');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((public.get_consent_versions() #>> '{versions,0,version}')::int, 1, 'another clinic sees only its own versions');
select throws_ok($$ select public.publish_consent_version(current_setting('test.v2')::uuid) $$,
  'P0001', 'Version introuvable.', 'another clinic''s version is not found');
reset role;

select * from finish();
rollback;
