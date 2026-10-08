-- Professionnels import (migration *_professionals_import.sql, plan Phase 4 Task 4a.19).
-- Covers: privileges (the RPC and its private helpers, security invoker); the dry run, by default,
-- writes nothing (no row, no audit row, no sequence but audit_log's identity moves, the audit
-- source put back); the real run writes through the app's paths (normalised values, titles and
-- licences, sets with stars, IVAC, activation, audit source `import` and the person as actor);
-- idempotent re-runs (`skipped`); unknown keys reported per field, never more than three named,
-- personal-looking values masked; the forms' messages for plain fields; the RPCs' refusals routed
-- to their field (names, email, licence by title row, IVAC, restricted motifs, at most two titles),
-- several at once, motifs skipped after a refused title; activation with the override reason;
-- permission refusals (manage, activate_override, module off), another clinic; contract errors.
begin;
create extension if not exists pgtap with schema extensions;
select plan(78);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider and a conseillère; org B
-- with an admin. An existing professional in org A (with an IVAC number), created by the admin.
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
-- A restricted motif (none is by default, P4-16).
update public.motifs set is_restricted = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'psychose';

-- The rows imported below (JSON as the script sends it).
select set_config('test.row', $json${
  "first_name": "  Élise ", "last_name": "Bouchard", "email": " Elise.Bouchard@Example.TEST ",
  "personal_phone": "514 555-0101", "city": "Montréal", "province": "qc", "postal_code": "h2x-1y4", "years_experience": 12,
  "professions": [{"title_key": "psychologue", "licence_number": "12345", "is_primary": true},
                  {"title_key": "psychotherapeute", "licence_number": "PT-99"}],
  "languages": ["fr", "EN"],
  "clienteles": [{"key": "adults", "specialized": true}, {"key": "couples"}],
  "approaches": [{"key": "cbt", "specialized": true}, {"key": "act"}],
  "motifs": ["anxiete", "deuil", "estime_de_soi"],
  "ivac": "ivac-1234", "activate": true
}$json$, true);
select set_config('test.unknown', $json${
  "first_name": "Hugo", "last_name": "Lemieux", "email": "hugo.lemieux@example.test",
  "professions": [{"title_key": "psy"}], "languages": ["fr", "xx"], "clienteles": [{"key": "adultes"}],
  "approaches": [{"key": "tcc"}], "motifs": ["anxiete", "anxite"]
}$json$, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.existing', public.create_professional('Existant', 'Déjà', 'existant@example.test')::text, true);
select public.set_professional_payer_number(current_setting('test.existing')::uuid, 'ivac', 'IVAC-777');
reset role;

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'import_professional', array['jsonb', 'boolean'], 'authenticated', array['EXECUTE'], 'authenticated may call import_professional');
select function_privs_are('public', 'import_professional', array['jsonb', 'boolean'], 'anon', array[]::text[], 'anon cannot call import_professional');
select function_privs_are('public', 'import_professional', array['jsonb', 'boolean'], 'service_role', array[]::text[], 'service_role cannot call import_professional (user-scoped)');
select is((select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.import_professional(jsonb, boolean)'::regprocedure), false,
  'import_professional is security invoker: it adds no privilege');
select is((select count(*)::int from pg_catalog.pg_proc p
            where p.pronamespace = 'private'::regnamespace and p.proname like 'import\_%' and p.prosecdef), 0,
  'its private helpers are security invoker too');
select function_privs_are('private', 'import_professional_apply', array['jsonb', 'jsonb', 'jsonb', 'boolean'], 'anon', array[]::text[], 'anon cannot call the helpers');

-- =============================================================================
-- Dry run (the default): nothing is written
-- =============================================================================
select set_config('test.audit_before', (select coalesce(max(id), 0)::text from public.audit_log), true);
-- Every sequence but pgTAP's own (temporary) counter.
select set_config('test.seq_before', (select jsonb_object_agg(schemaname || '.' || sequencename, last_value)::text
                                        from pg_catalog.pg_sequences where schemaname !~ '^pg_temp'), true);
select set_config('app.audit_source', 'test-marker', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.dry', public.import_professional(current_setting('test.row')::jsonb, true)::text, true);
select set_config('test.default', public.import_professional(current_setting('test.row')::jsonb)::text, true);
reset role;

select is(current_setting('test.dry')::jsonb,
  '{"status": "ok", "dry_run": true, "id": null, "activated": true, "complete": true, "missing": []}'::jsonb,
  'dry run: ok, what the real run would do, no id');
select is(current_setting('test.default')::jsonb ->> 'dry_run', 'true', 'without p_dry_run, the call is a dry run');
select is((select count(*)::int from public.professionals where email = 'elise.bouchard@example.test'), 0, 'dry run: no professional');
select is((select count(*)::int from public.professional_payer_numbers where number = 'IVAC-1234'), 0, 'dry run: no IVAC number');
select is((select count(*)::int from public.audit_log where id > current_setting('test.audit_before')::bigint), 0, 'dry run: no audit row');
select is(
  (select coalesce(array_agg(key order by key), '{}')
     from jsonb_each(current_setting('test.seq_before')::jsonb) a
     full join (select schemaname || '.' || sequencename as key, coalesce(to_jsonb(last_value), 'null') as value
                  from pg_catalog.pg_sequences where schemaname !~ '^pg_temp') b using (key)
    where a.value is distinct from b.value
      and key <> 'public.audit_log_id_seq'),
  '{}'::text[], 'dry run: no sequence moved but audit_log''s identity (its rolled-back numbers are skipped)');
select is(current_setting('app.audit_source', true), 'test-marker', 'dry run: the audit source is put back');

-- =============================================================================
-- Real run: the app's paths
-- =============================================================================
select set_config('test.audit_before', (select max(id)::text from public.audit_log), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.real', public.import_professional(current_setting('test.row')::jsonb, false)::text, true);
select set_config('test.id', current_setting('test.real')::jsonb ->> 'id', true);
select is(public.get_professional_readiness(current_setting('test.id')::uuid) ->> 'complete', 'true', 'the imported file is complete (readiness)');
reset role;

select is(current_setting('test.real')::jsonb - 'id',
  '{"status": "ok", "dry_run": false, "activated": true, "complete": true, "missing": []}'::jsonb, 'real run: ok');
select ok(current_setting('test.id') ~ '^[0-9a-f-]{36}$', 'real run: the new id');
select is(
  (select row(p.first_name, p.last_name, p.email, p.personal_phone, p.city, p.province, p.postal_code, p.years_experience,
              p.status, p.activation_override_reason, p.created_by, p.status_changed_by)::text
     from public.professionals p where p.id = current_setting('test.id')::uuid),
  row('Élise', 'Bouchard', 'elise.bouchard@example.test', '+15145550101', 'Montréal', 'QC', 'H2X 1Y4', 12::smallint,
      'active', null::text, 'a0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid)::text,
  'identity and contact normalised as the forms store them; active without an override reason (complete file)');
select results_eq(
  $$ select t.key, pp.licence_number, pp.is_primary from public.professional_professions pp
       join public.profession_titles t on t.id = pp.profession_title_id
      where pp.professional_id = current_setting('test.id')::uuid order by pp.is_primary desc $$,
  $$ values ('psychologue'::text, '12345'::text, true), ('psychotherapeute', 'PT-99', false) $$,
  'titles and licences, the flagged one primary');
select is((select array_agg(l.code order by l.code) from public.professional_languages pl join public.languages l on l.id = pl.language_id
            where pl.professional_id = current_setting('test.id')::uuid), array['en', 'fr'], 'languages by code (case ignored)');
select results_eq(
  $$ select c.key, pc.is_specialized from public.professional_clienteles pc join public.clienteles c on c.id = pc.clientele_id
      where pc.professional_id = current_setting('test.id')::uuid order by c.key $$,
  $$ values ('adults'::text, true), ('couples', false) $$, 'clientèles with their star');
select results_eq(
  $$ select s.key, ps.is_specialized from public.professional_specialties ps join public.specialties s on s.id = ps.specialty_id
      where ps.professional_id = current_setting('test.id')::uuid order by s.key $$,
  $$ values ('act'::text, false), ('cbt', true) $$, 'approaches with their star');
select is((select array_agg(m.key order by m.key) from public.professional_motifs pm join public.motifs m on m.id = pm.motif_id
            where pm.professional_id = current_setting('test.id')::uuid), array['anxiete', 'deuil', 'estime_de_soi'], 'motifs');
select is((select number from public.professional_payer_numbers where professional_id = current_setting('test.id')::uuid),
  'IVAC-1234', 'IVAC number, upper-cased');
select ok((select count(*) from public.audit_log where org_id = 'b0000000-0000-0000-0000-00000000000a'
            and left(record_id, 36) = current_setting('test.id')) >= 10, 'real run: the record''s audit rows exist');
select is(
  (select count(*)::int from public.audit_log where id > current_setting('test.audit_before')::bigint
      and (source <> 'import' or actor_id is distinct from 'a0000000-0000-0000-0000-000000000001')),
  0, 'every audit row of the run has source import and the person as actor');
select is(current_setting('app.audit_source', true), 'test-marker', 'real run: the audit source is put back');
select is((select status from public.professionals where id = current_setting('test.existing')::uuid), 'draft',
  'the run touched no other professional');

-- =============================================================================
-- Re-runs are idempotent
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_professional(current_setting('test.row')::jsonb, false),
  jsonb_build_object('status', 'skipped', 'dry_run', false, 'id', current_setting('test.id'), 'reason', 'Courriel déjà présent'),
  'the same row again: skipped, with the existing id');
select is(public.import_professional(jsonb_set(current_setting('test.row')::jsonb, '{email}', '"ELISE.BOUCHARD@example.test  "'), true) ->> 'status',
  'skipped', 'the email is compared as stored (case, spaces)');
select is(public.import_professional('{"email": "existant@example.test", "first_name": "", "motifs": ["inconnu"]}', true) ->> 'status',
  'skipped', 'an existing email is skipped whatever the rest of the row says');
reset role;
select is((select count(*)::int from public.professionals where email = 'elise.bouchard@example.test'), 1, 'still one professional');

-- =============================================================================
-- Unknown keys: reported per field, nothing written, even with p_dry_run false
-- =============================================================================
select set_config('test.audit_before', (select max(id)::text from public.audit_log), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.unknown_result', public.import_professional(current_setting('test.unknown')::jsonb, false)::text, true);
select set_config('test.many', public.import_professional(
  '{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "motifs": ["a1", "b2", "jean@exemple.test", "c3", "d4", "a1", "deuil"]}', true)::text, true);
select set_config('test.three', public.import_professional(
  '{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "languages": ["xx", "5145550101", " "], "approaches": [{"key": "a"}, {"key": "b"}]}', true)::text, true);
reset role;

select is(current_setting('test.unknown_result')::jsonb - 'errors',
  '{"status": "error", "dry_run": false, "id": null}'::jsonb, 'unknown keys: status error, no id');
select is(current_setting('test.unknown_result')::jsonb -> 'errors',
  '[{"field": "professions.0.titleId", "message": "Titre inconnu : psy"},
    {"field": "languages", "message": "Langue inconnue : xx"},
    {"field": "clienteles", "message": "Clientèle inconnue : adultes"},
    {"field": "approaches", "message": "Approche inconnue : tcc"},
    {"field": "motifs", "message": "Motif inconnu : anxite"}]'::jsonb,
  'one error per field, naming the unknown key; no consequential error from the skipped steps');
select is((select count(*)::int from public.professionals where email = 'hugo.lemieux@example.test'), 0, 'unknown keys: nothing written');
select is((select count(*)::int from public.audit_log where id > current_setting('test.audit_before')::bigint), 0, 'unknown keys: no audit row');
select is(current_setting('test.many')::jsonb -> 'errors',
  '[{"field": "motifs", "message": "Motifs inconnus : a1, b2, (valeur masquée) et 2 autres"}]'::jsonb,
  'more than three: three named (once each), then a count; an address is masked');
select is(current_setting('test.three')::jsonb -> 'errors',
  '[{"field": "languages", "message": "Langues inconnues : xx et (valeur masquée)"},
    {"field": "approaches", "message": "Approches inconnues : a et b"}]'::jsonb,
  'two or three named with « et »; a number is masked; a blank key is ignored');

-- =============================================================================
-- Plain fields: the forms' messages, all at once
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_professional(jsonb_build_object(
    'first_name', 'Léa', 'last_name', 'Roy', 'email', 'lea.roy@example.test', 'personal_phone', 'abc', 'city', repeat('a', 101),
    'province', 'QQ', 'postal_code', 'XYZ', 'years_experience', 75), true) -> 'errors',
  '[{"field": "personalPhone", "message": "Numéro à 10 chiffres."},
    {"field": "city", "message": "100 caractères maximum."},
    {"field": "province", "message": "Province invalide."},
    {"field": "postalCode", "message": "Code postal invalide (ex. : H2X 1Y4)."},
    {"field": "yearsExperience", "message": "Entre 0 et 60 ans."}]'::jsonb,
  'phone, city, province, postal code and years: every error of the row');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "years_experience": 3.5}', true) -> 'errors',
  '[{"field": "yearsExperience", "message": "Entre 0 et 60 ans."}]'::jsonb, 'years: whole numbers only');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "personal_phone": "+44 20 7946 0958"}', true) -> 'errors',
  '[{"field": "personalPhone", "message": "Numéro à 10 chiffres."}]'::jsonb, 'phone: a leading + must be +1');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "personal_phone": "1 (450) 555–0199", "years_experience": 0, "province": "", "postal_code": " g1r 4p5 "}', true) ->> 'status',
  'ok', 'accepted as the forms accept them: 1 (450) 555–0199, 0 years, blank province, g1r 4p5');

-- =============================================================================
-- The RPCs' refusals, under their field
-- =============================================================================
select is(public.import_professional('{"first_name": "  ", "last_name": "Roy", "email": "lea.roy@example.test", "motifs": ["deuil"]}', true) -> 'errors',
  '[{"field": "firstName", "message": "Le prénom est obligatoire."}]'::jsonb, 'blank first name (create_professional, HINT first_name); nothing else runs');
select is(public.import_professional('{"first_name": "Léa", "last_name": "", "email": "lea.roy@example.test"}', true) -> 'errors',
  '[{"field": "lastName", "message": "Le nom est obligatoire."}]'::jsonb, 'blank last name');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "x"}', true) -> 'errors',
  '[{"field": "email", "message": "Courriel invalide."}]'::jsonb, 'invalid email');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "Conseillere@a.test"}', true) -> 'errors',
  '[{"field": "email", "message": "Ce courriel est déjà utilisé."}]'::jsonb, 'a staff member''s email is an error, not skipped (P4-34)');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "professions": [{"title_key": "psychologue"}]}', true) -> 'errors',
  '[{"field": "professions.0.licenceNumber", "message": "Le numéro de permis est requis pour ce titre."}]'::jsonb, 'regulated title without licence: under titre 1');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "professions": [{"title_key": "naturopathe"}, {"title_key": "psychologue", "licence_number": "x_1"}]}', true) -> 'errors',
  '[{"field": "professions.1.licenceNumber", "message": "Numéro de permis invalide : lettres, chiffres, espaces et traits d''union (30 caractères au plus)."}]'::jsonb,
  'the refusal names its title row (DETAIL): titre 2');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "professions": [{"title_key": "naturopathe"}, {"title_key": "sexologue", "licence_number": "1"}, {"title_key": "psychologue", "licence_number": "2"}]}', true) -> 'errors',
  '[{"field": "professions", "message": "Un professionnel a au plus deux titres."}]'::jsonb, 'three titles: about the titles as a whole');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "ivac": "x"}', true) -> 'errors',
  '[{"field": "ivac", "message": "Numéro IVAC invalide : 3 à 30 lettres, chiffres ou traits d''union."}]'::jsonb, 'invalid IVAC number');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "ivac": " ivac-777 "}', true) -> 'errors',
  '[{"field": "ivac", "message": "Ce numéro IVAC est déjà attribué à un autre professionnel."}]'::jsonb, 'IVAC number held by another professional');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "professions": [{"title_key": "naturopathe"}], "motifs": ["psychose", "deuil"]}', true) -> 'errors',
  '[{"field": "motifs", "message": "Le motif « Psychose » est réservé aux professions réglementées."}]'::jsonb, 'restricted motif without a regulated title');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "professions": [{"title_key": "psychologue"}], "motifs": ["psychose"], "ivac": "x", "postal_code": "nope"}', false) -> 'errors',
  '[{"field": "postalCode", "message": "Code postal invalide (ex. : H2X 1Y4)."},
    {"field": "professions.0.licenceNumber", "message": "Le numéro de permis est requis pour ce titre."},
    {"field": "ivac", "message": "Numéro IVAC invalide : 3 à 30 lettres, chiffres ou traits d''union."}]'::jsonb,
  'several steps refused at once; motifs skipped after a refused title (no repeated refusal)');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "professions": [{"title_key": "psychologue", "licence_number": "1"}], "motifs": ["psychose"], "languages": []}', true) ->> 'status',
  'ok', 'a restricted motif with a regulated title; an empty language list keeps French');
reset role;
select is((select count(*)::int from public.professionals where email = 'lea.roy@example.test'), 0, 'refused rows wrote nothing (real run included)');

-- =============================================================================
-- Activation
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_professional('{"first_name": "Nora", "last_name": "Gagné", "email": "nora.gagne@example.test", "professions": [{"title_key": "naturopathe"}], "activate": true}', true),
  '{"status": "ok", "dry_run": true, "id": null, "activated": true, "complete": false, "missing": ["clientele", "motif"]}'::jsonb,
  'an incomplete file: the dry run says it is activated with what it lacks');
select set_config('test.nora', public.import_professional('{"first_name": "Nora", "last_name": "Gagné", "email": "nora.gagne@example.test", "professions": [{"title_key": "naturopathe"}], "activate": true}', false) ->> 'id', true);
select set_config('test.paul', public.import_professional('{"first_name": "Paul", "last_name": "Ouellet", "email": "paul.ouellet@example.test", "activate": false}', false) ->> 'id', true);
reset role;
select is((select row(status, activation_override_reason)::text from public.professionals where id = current_setting('test.nora')::uuid),
  row('active', 'Dossier complété hors application')::text, 'activated with the override reason');
select is((select status from public.professionals where id = current_setting('test.paul')::uuid), 'draft', 'activate false: stays « À inviter »');
select is((select array_agg(l.code) from public.professional_languages pl join public.languages l on l.id = pl.language_id
            where pl.professional_id = current_setting('test.paul')::uuid), array['fr'], 'no language given: French, as at creation');
select is((select count(*)::int from public.professional_professions where professional_id = current_setting('test.paul')::uuid), 0, 'no title given: none');

-- =============================================================================
-- Permissions, module gate, other clinic
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.import_professional('{"first_name": "A", "last_name": "B", "email": "c@example.test"}') $$,
  '42501', 'Permission refusée : professionals.manage', 'the conseillère cannot import');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.import_professional('{"first_name": "A", "last_name": "B", "email": "c@example.test"}') $$,
  '42501', 'Permission refusée : professionals.manage', 'the provider cannot import');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.import_professional('{"first_name": "A", "last_name": "B", "email": "c@example.test", "activate": true}') $$,
  '42501', 'Permission refusée : professionals.activate_override', 'the adjointe cannot import with activation');
select is(public.import_professional('{"first_name": "A", "last_name": "B", "email": "c@example.test", "activate": false}') ->> 'status',
  'ok', 'the adjointe can import without activation');
select throws_ok($$ select public.import_professional('{"email": "existant@example.test", "activate": true}') $$,
  '42501', 'Permission refusée : professionals.activate_override', 'permissions are checked before anything is looked up');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.import_professional(current_setting('test.row')::jsonb, true) ->> 'status', 'ok',
  'another clinic: an email of org A is not « déjà présent » there (P4-34)');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000b' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.import_professional('{"first_name": "A", "last_name": "B", "email": "c@example.test"}') $$,
  '42501', 'Permission refusée : professionals.manage', 'module off: refused');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000b' and module_key = 'professionals';

-- =============================================================================
-- Contract errors (the caller's bugs, not the row's data): 22023
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.import_professional(null) $$, '22023', 'Ligne invalide : objet JSON attendu.', 'null row');
select throws_ok($$ select public.import_professional('[]') $$, '22023', 'Ligne invalide : objet JSON attendu.', 'not an object');
select throws_ok($$ select public.import_professional('{"motif": ["deuil"]}') $$, '22023', 'Clé inconnue : motif', 'unknown key');
select throws_ok($$ select public.import_professional('{"years_experience": "12"}') $$, '22023', 'Nombre attendu : years_experience', 'years as text');
select throws_ok($$ select public.import_professional('{"first_name": 12}') $$, '22023', 'Texte attendu : first_name', 'a name as a number');
select throws_ok($$ select public.import_professional('{"activate": "oui"}') $$, '22023', 'Booléen attendu : activate', 'activate as text');
select throws_ok($$ select public.import_professional('{"motifs": "deuil"}') $$, '22023', 'Liste de 500 éléments au plus attendue : motifs', 'a list as text');
select throws_ok($$ select public.import_professional('{"professions": [{"title": "psychologue"}]}') $$, '22023', null, 'a title item with an unknown key');
select throws_ok($$ select public.import_professional('{"professions": ["psychologue"]}') $$, '22023', null, 'a title item that is not an object');
select throws_ok($$ select public.import_professional('{"clienteles": ["adults"]}') $$, '22023', null, 'a clientèle item that is not an object');
select throws_ok($$ select public.import_professional('{"motifs": [1]}') $$, '22023', 'Liste de clés (textes) attendue.', 'a motif key that is not a string');
select is(public.import_professional('{"first_name": "Léa", "last_name": "Roy", "email": "lea.roy@example.test", "professions": null, "motifs": null, "city": null}') ->> 'status',
  'ok', 'JSON null reads as absent');
reset role;

select * from finish();
rollback;
