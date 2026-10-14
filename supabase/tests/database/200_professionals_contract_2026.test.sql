-- Professionnels: the 2026 service contract text (migration *_professionals_contract_2026.sql,
-- decisions P4-554 … P4-557).
-- Covers: the template's content (no banner, the image-rights mark, every placeholder declared,
-- Annexe A alone on its line, a signature page last, no real name or address, the phone
-- variable); the seed for a new clinic; the data fix (a never-edited seeded draft rewritten, a
-- published v1 without a draft gets a new draft v2, an edited draft with its banner untouched,
-- idempotent); the printed terms' phone; the
-- 2026 draft passes publish_template_version.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- =============================================================================
-- Fixtures (as postgres): orgs A, B, C with an admin in A.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, legal_name, address_line1, city, province, postal_code, signatory_name, signatory_title) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'Clinique A inc.', '100, rue Principale', 'Québec', 'QC', 'G1A 1A1', 'Dominique Exemple', 'présidente'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', null, null, null, null, null, null, null),
  ('b0000000-0000-0000-0000-00000000000c', 'Org C', null, null, null, null, null, null, null);
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);

select set_config('test.tpl', (select json_object_agg(t.org_id, t.id)::text from public.document_templates t
                                where t.key = 'professionals.service_contract'
                                  and t.org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b',
                                                   'b0000000-0000-0000-0000-00000000000c')), true);
select set_config('test.v', (select json_object_agg(v.org_id, v.id)::text from public.document_template_versions v
                              where v.template_id::text in (select value from json_each_text(current_setting('test.tpl')::json))), true);

-- =============================================================================
-- The template's content
-- =============================================================================
select is(private.professionals_contract_template() -> 'body' ->> 'title', 'Convention de prestation de services professionnels',
  'the 2026 title');
select is(private.professionals_contract_template() -> 'body' -> 'grantsImageRights', 'true'::jsonb,
  'the body says it grants the image rights (article 6.2)');
select ok(private.professionals_contract_template()::text !~ 'Texte à faire valider', 'no validation banner (Jonathan supplied the final text)');
select ok(private.professionals_contract_template()::text !~ 'Christine|Sirois|Pins|Irénée|G0T|70 %|30 %|75 %|85 %',
  'no real name, address, rate or percentage in the template');
select ok(exists (select 1 from jsonb_array_elements(private.professionals_contract_template() -> 'body' -> 'blocks') b
                   where b ->> 'type' = 'paragraph' and b -> 'runs' = '[{"text": "{{pricing.annexe_a}}"}]'::jsonb),
  'Annexe A is a paragraph holding only its placeholder (P4-433)');
select is(private.professionals_contract_template() -> 'body' -> 'blocks' -> -1 ->> 'type', 'signaturePage', 'the signature page is last');
select ok(exists (select 1 from jsonb_array_elements(private.professionals_contract_template() -> 'body' -> 'blocks') b
                   where b ->> 'type' = 'heading' and b ->> 'text' = '6.2 Promotion des services professionnels'),
  'the image-rights article (6.2) is in the body');
select is((select v -> 'required' from jsonb_array_elements(private.professionals_contract_template() -> 'variables') v
            where v ->> 'path' = 'professional.phone'), 'false'::jsonb, 'the phone is a declared, optional variable');
-- Every placeholder of the body, the subject and the message is declared, and every variable is used.
select is_empty($$ select m[1] from (select private.professionals_contract_template() t) x,
                         regexp_matches((x.t -> 'body')::text || (x.t ->> 'email_subject') || (x.t ->> 'email_message'),
                                        '\{\{\s*([a-z_.]+)\s*\}\}', 'g') m
                   except select v ->> 'path' from jsonb_array_elements(private.professionals_contract_template() -> 'variables') v $$,
  'every placeholder is a declared variable');
select is_empty($$ select v ->> 'path' from jsonb_array_elements(private.professionals_contract_template() -> 'variables') v
                   except select m[1] from (select private.professionals_contract_template() t) x,
                         regexp_matches((x.t -> 'body')::text || (x.t ->> 'email_subject') || (x.t ->> 'email_message'),
                                        '\{\{\s*([a-z_.]+)\s*\}\}', 'g') m $$,
  'every declared variable is used');

-- A clinic created now gets the 2026 text (the seed function reads the template function).
select is((select v.body -> 'grantsImageRights' from public.document_template_versions v
            where v.id = (current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000a')::uuid),
  'true'::jsonb, 'a new clinic''s draft is the 2026 text');

-- =============================================================================
-- The data fix, per clinic: a never-edited seeded draft is rewritten; no draft → a new draft;
-- an edited draft (its banner still there) is left untouched
-- =============================================================================
-- The original seed as the fix receives it (here a short stand-in): body and variables.
select set_config('test.seed', jsonb_build_object(
  'body', jsonb_build_object('title', 'Contrat de service', 'footer', jsonb_build_object('text', 'x'),
                             'blocks', jsonb_build_array(
                               jsonb_build_object('type', 'paragraph', 'runs', jsonb_build_array(jsonb_build_object(
                                 'text', 'Texte à faire valider par la direction avant publication', 'bold', true))),
                               jsonb_build_object('type', 'paragraph', 'runs', '[{"text": "1.1. Les parties déclarent."}]'::jsonb),
                               jsonb_build_object('type', 'paragraph', 'runs', '[{"text": "{{pricing.annexe_a}}"}]'::jsonb))),
  'variables', '[{"path": "pricing.annexe_a", "label": "Annexe", "sample": "x", "required": true, "kind": "text"}]'::jsonb)::text, true);
-- Org A: its draft is the seed, never edited. Org C: the seed with one paragraph changed, the banner
-- kept. Org B: its v1 edited and published (as production), no draft.
update public.document_template_versions v
   set body = current_setting('test.seed')::jsonb -> 'body', variables = current_setting('test.seed')::jsonb -> 'variables'
 where v.id in ((current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000a')::uuid,
                (current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000c')::uuid);
update public.document_template_versions v
   set body = jsonb_set(v.body, '{blocks,1}', '{"type": "paragraph", "runs": [{"text": "1.1. Notre texte."}]}'::jsonb)
 where v.id = (current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000c')::uuid;
update public.document_template_versions v
   set body = jsonb_set(current_setting('test.seed')::jsonb -> 'body', '{blocks,0}', '{"type": "paragraph", "runs": [{"text": "Notre contrat"}]}'::jsonb),
       variables = current_setting('test.seed')::jsonb -> 'variables', email_subject = 'Votre contrat'
 where v.id = (current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000b')::uuid;
update public.document_template_versions v set status = 'published', published_at = now()
 where v.id = (current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000b')::uuid;
select set_config('test.c_before', (select v.body::text from public.document_template_versions v
                                     where v.id = (current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000c')::uuid), true);

select is(private.professionals_contract_2026_text(current_setting('test.seed')::jsonb), 2,
  'two drafts written: org A''s rewritten, org B''s created');
select results_eq($$ select v.body, v.variables from public.document_template_versions v
                      where v.id = (current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000a')::uuid $$,
  $$ select t -> 'body', t -> 'variables' from (select private.professionals_contract_template() t) x $$,
  'org A''s never-edited draft is the 2026 body and variables');
select results_eq($$ select v.version, v.status, v.body = (private.professionals_contract_template() -> 'body'),
                            v.variables = (private.professionals_contract_template() -> 'variables'),
                            v.signers = (private.professionals_contract_template() -> 'signers'), v.email_subject <> ''
                       from public.document_template_versions v
                      where v.template_id = (current_setting('test.tpl')::json ->> 'b0000000-0000-0000-0000-00000000000b')::uuid
                      order by v.version $$,
  $$ values (1, 'published'::text, false, false, true, true), (2, 'draft'::text, true, true, true, true) $$,
  'org B (v1 published, no draft): a new draft v2 holds the 2026 text; v1 stays published');
select is((select v.body::text from public.document_template_versions v
            where v.id = (current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000c')::uuid),
  current_setting('test.c_before'), 'a draft the clinic edited (its banner still there) is left untouched');
select is(private.professionals_contract_2026_text(current_setting('test.seed')::jsonb), 0, 'idempotent: nothing left to write');
select function_privs_are('private', 'professionals_contract_2026_text', array['jsonb'], 'authenticated', array[]::text[],
  'no client runs the data fix');

-- =============================================================================
-- The printed terms: the professional's phone (« Téléphone »)
-- =============================================================================
insert into public.professionals (id, org_id, first_name, last_name, email, personal_phone, address_line1, city, province, postal_code, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pia', 'Un', 'pia@exemple.ca', '+14185550123', null, null, 'QC', null, 'draft'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Paul', 'Deux', 'paul@exemple.ca', null,
   '200, avenue Exemple', 'Lévis', 'QC', 'G6V 1A1', 'draft');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p.id, t.id, '12345-67', true
  from public.profession_titles t
 cross join (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) p(id)
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
select is(private.professional_contract_terms('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001')
            -> 'values' -> 'professional' ->> 'phone', '418 555-0123', 'the phone, as the app writes it');
select is(private.professional_contract_terms('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002')
            -> 'values' -> 'professional' -> 'phone', 'null'::jsonb, 'no phone: null (an optional variable, printed empty)');
select ok(private.professional_contract_terms('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001')
            -> 'values' -> 'professional' ? 'membership', 'the older versions'' values stay (membership, today)');

-- =============================================================================
-- The 2026 draft publishes (publish_template_version's checks), as the admin
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}', true);
select lives_ok($$ select public.publish_template_version((current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000a')::uuid) $$,
  'the 2026 draft passes publish_template_version');
reset role;
select is((select v.status from public.document_template_versions v
            where v.id = (current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000a')::uuid),
  'published', 'published');
select lives_ok($$ select private.professional_contract_check('b0000000-0000-0000-0000-00000000000a',
                    (current_setting('test.v')::json ->> 'b0000000-0000-0000-0000-00000000000a')::uuid,
                    private.professional_contract_terms('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002') -> 'values') $$,
  'a send''s checks pass without a phone (optional) once the clinic''s address is set');

select * from finish();
rollback;
