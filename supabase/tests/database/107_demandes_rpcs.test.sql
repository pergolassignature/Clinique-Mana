-- Demandes (migration *_demandes_rpcs.sql, plan D1 part 2): the RPCs. Covers: privileges (every
-- RPC for authenticated only, definer); create (the « saisie rapide » and the full intake, motifs,
-- source with utm_* only, the note needs demandes.notes, an assignee must work requests, unknown
-- keys refused, the created event); update (only the keys given, motifs replaced, urgent events,
-- closed refused); states (allowed moves only, closing needs a reason, matching needs an active
-- professional of the clinic and links the client, leaving matched unlinks the professional,
-- reopening); assign; contact attempts; tasks (add, complete with its contact, cancel); the note;
-- the participants as a set; permissions per role (adjointe without the note, professional and
-- another clinic refused); the journal names each RPC.
begin;
create extension if not exists pgtap with schema extensions;
select plan(78);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', f.name, f.args, 'anon', array[]::text[], f.name || ': not anon')
  from (values
    ('create_demande', array['jsonb']), ('update_demande', array['uuid', 'jsonb']),
    ('set_demande_state', array['uuid', 'text', 'text', 'uuid']), ('assign_demande', array['uuid', 'uuid']),
    ('log_demande_contact', array['uuid', 'text', 'text', 'timestamp with time zone']),
    ('add_demande_task', array['uuid', 'text', 'timestamp with time zone', 'uuid']),
    ('complete_demande_task', array['uuid', 'uuid', 'text']), ('cancel_demande_task', array['uuid', 'uuid']),
    ('set_demande_note', array['uuid', 'text']), ('set_demande_participants', array['uuid', 'jsonb'])
  ) as f(name, args);
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_demande', 'update_demande', 'set_demande_state', 'assign_demande', 'log_demande_contact',
                       'add_demande_task', 'complete_demande_task', 'cancel_demande_task', 'set_demande_note', 'set_demande_participants')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute'))
$$, 'every RPC is SECURITY DEFINER and callable by authenticated');

-- =============================================================================
-- Fixtures (as postgres)
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@dem2.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 5) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@dem2.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'u2@dem2.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'u3@dem2.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u4@dem2.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u5@dem2.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('clients'), ('demandes')) m(key);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'u3@dem2.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@dem2.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pro', 'B', 'pro3@dem2.test', 'active');
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Tremblay'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Tremblay'),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Autre', 'Clinique');
select set_config('test.m1', (select id::text from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a' order by key limit 1), true);
select set_config('test.m2', (select id::text from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a' order by key offset 1 limit 1), true);
select set_config('test.src', (select id::text from public.referral_sources where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'google'), true);

-- =============================================================================
-- create_demande, as the counselor
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.quick', public.create_demande('{"contact_name": " Bob Martin ", "contact_phone_e164": "+15145550102"}')::text, true);
select results_eq($$
  select reference ~ '^DEM-[0-9]{4}-0001$', state, channel, contact_name, received_by::text, assigned_to is null
    from public.demandes where id = current_setting('test.quick')::uuid
$$, $$ values (true, 'new', 'phone', 'Bob Martin', 'a0000000-0000-0000-0000-000000000004', true) $$,
  'la saisie rapide: a name and a phone, trimmed; new, by phone, unassigned');
select results_eq($$ select kind, to_state from public.demande_events where demande_id = current_setting('test.quick')::uuid $$,
  $$ values ('created', 'new') $$, 'the created event');

select set_config('test.full', public.create_demande(jsonb_build_object(
  'channel', 'booking_page', 'contact_name', 'Alice Tremblay', 'contact_email', 'Alice@Exemple.test', 'client_id', 'd0000000-0000-0000-0000-000000000001',
  'beneficiary', 'self', 'language', 'fr', 'modality', 'video', 'availability_periods', jsonb_build_array('evening', 'weekend'),
  'availability_days', jsonb_build_array(2, 4), 'preferred_pro_gender', 'female', 'concerns', 'Anxiété', 'payer_kind', 'insurance',
  'insurer', 'Desjardins', 'is_urgent', true, 'motif_ids', jsonb_build_array(current_setting('test.m1'), current_setting('test.m2')),
  'referral_source_id', current_setting('test.src'), 'source_utm', jsonb_build_object('utm_source', 'facebook', 'utm_campaign', ' automne ', 'evil', 'x', 'utm_zzz', 'y'),
  'source_referrer', 'https://www.facebook.com/', 'assigned_to', 'a0000000-0000-0000-0000-000000000004',
  'internal_note', 'Rappeler après 17 h.'))::text, true);
select results_eq($$
  select channel, contact_email, availability_periods, availability_days, is_urgent, source_campaign, source_utm, assigned_to::text
    from public.demandes where id = current_setting('test.full')::uuid
$$, $$ values ('booking_page', 'alice@exemple.test', array['evening', 'weekend'], array[2, 4]::smallint[], true, 'automne',
               '{"utm_source": "facebook", "utm_campaign": "automne"}'::jsonb, 'a0000000-0000-0000-0000-000000000004') $$,
  'the full intake: email lower-cased, the source with utm_* only and the campaign from it, assigned');
select is((select count(*)::int from public.demande_motifs where demande_id = current_setting('test.full')::uuid), 2, 'two motifs');
select is((select internal_note from public.demande_notes where demande_id = current_setting('test.full')::uuid), 'Rappeler après 17 h.', 'the note');
select throws_ok($$ select public.create_demande('{"contact_name": "X", "diagnosis": "y"}') $$, '22023', null, 'an unknown key is refused');
select throws_ok($$ select public.create_demande('{"contact_name": "X", "is_urgent": "yes"}') $$, '22023', null, 'a wrong type is refused');
select throws_ok($$ select public.create_demande('{"contact_name": "X", "assigned_to": "a0000000-0000-0000-0000-000000000003"}') $$,
  'P0001', 'Cette personne ne peut pas traiter les demandes.', 'a professional cannot be assigned');
select throws_ok($$ select public.create_demande('{}') $$, 'P0001',
  'Indiquez comment joindre la personne : un dossier, un nom, un courriel ou un téléphone.', 'nobody to call back: a French refusal');
select throws_ok($$ select public.create_demande(jsonb_build_object('contact_name', 'X', 'received_at', (now() + interval '1 day')::text)) $$,
  'P0001', 'La date de réception ne peut pas être dans le futur.', 'a request is never received in the future');
select lives_ok($$ select public.create_demande('{"contact_name": "Tableaux nuls", "availability_periods": null, "motif_ids": null}') $$,
  'a JSON null for a list is an empty list');

-- The adjointe as the counselor; the professional and clinic B's admin: no request of clinic A.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.create_demande('{"contact_name": "Avec note", "internal_note": "Y"}') $$,
  'the adjointe writes a note too (D-1)');
select lives_ok($$ select public.create_demande('{"contact_name": "Par l''adjointe"}') $$, 'but creates a request');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.create_demande('{"contact_name": "X"}') $$, '42501', null, 'the professional cannot create');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.update_demande(current_setting('test.full')::uuid, '{"concerns": "x"}') $$, 'P0001',
  'Cette demande n''existe pas.', 'another clinic cannot touch it');

-- =============================================================================
-- update_demande
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.update_demande(current_setting('test.full')::uuid,
  jsonb_build_object('modality', 'phone', 'is_urgent', false, 'motif_ids', jsonb_build_array(current_setting('test.m2')))) $$, 'update');
select results_eq($$ select modality, is_urgent, contact_email, payer_kind from public.demandes where id = current_setting('test.full')::uuid $$,
  $$ values ('phone', false, 'alice@exemple.test', 'insurance') $$, 'only the keys given changed');
select results_eq($$ select motif_id::text from public.demande_motifs where demande_id = current_setting('test.full')::uuid $$,
  $$ select current_setting('test.m2') $$, 'the motifs replaced');
select is((select count(*)::int from public.demande_events where demande_id = current_setting('test.full')::uuid and kind = 'urgent_cleared'), 1,
  'the urgent flag cleared is an event');

-- =============================================================================
-- States
-- =============================================================================
select throws_ok($$ select public.set_demande_state(current_setting('test.quick')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Cette demande ne peut pas passer de « Nouvelle » à « Jumelée ».', 'new cannot jump to matched');
select lives_ok($$ select public.set_demande_state(current_setting('test.full')::uuid, 'evaluating') $$, 'new → evaluating');
select lives_ok($$ select public.set_demande_state(current_setting('test.full')::uuid, 'accepted') $$, 'evaluating → accepted');
select throws_ok($$ select public.set_demande_state(current_setting('test.full')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Choisissez un professionnel actif de la clinique.', 'a professional not active cannot be matched');
select throws_ok($$ select public.set_demande_state(current_setting('test.full')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Choisissez un professionnel actif de la clinique.', 'nor another clinic''s');
select lives_ok($$ select public.set_demande_state(current_setting('test.full')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000001') $$,
  'accepted → matched with P1');
reset role;
select results_eq($$ select state, matched_professional_id::text, matched_at is not null from public.demandes where id = current_setting('test.full')::uuid $$,
  $$ values ('matched', 'c0000000-0000-0000-0000-000000000001', true) $$, 'matched to P1');
select is((select reason from public.client_professional_links where client_id = 'd0000000-0000-0000-0000-000000000001'
            and professional_id = 'c0000000-0000-0000-0000-000000000001'), 'demande', 'the client is linked to P1 (Clients, reason demande)');
select results_eq($$ select from_state, to_state, professional_id::text from public.demande_events
                     where demande_id = current_setting('test.full')::uuid and kind = 'state_changed' order by from_state $$,
  $$ values ('accepted', 'matched', 'c0000000-0000-0000-0000-000000000001'), ('evaluating', 'accepted', null), ('new', 'evaluating', null) $$,
  'each move is an event');
-- The professional reads it now.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.my_demandes where id = current_setting('test.full')::uuid), 1, 'P1 reads the request matched to her (my_demandes)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_demande_state(current_setting('test.full')::uuid, 'closed') $$, 'P0001',
  'Indiquez pourquoi la demande est fermée.', 'closing needs a reason');
select lives_ok($$ select public.set_demande_participants(current_setting('test.full')::uuid,
  '[{"display_name": "Alice Tremblay", "relationship": "self", "is_primary": true}, {"client_id": "d0000000-0000-0000-0000-000000000002", "relationship": "partner"}]') $$,
  'a participant with a file added to the matched request');
reset role;
select is((select reason from public.client_professional_links where client_id = 'd0000000-0000-0000-0000-000000000002'
            and professional_id = 'c0000000-0000-0000-0000-000000000001'), 'demande', 'the participant''s file is linked to P1 too');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.set_demande_state(current_setting('test.full')::uuid, 'accepted') $$, 'matched → accepted (first appointment cancelled)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.demandes where id = current_setting('test.full')::uuid), 0, 'P1 no longer reads it');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.set_demande_state(current_setting('test.full')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000001') $$,
  'matched again');
select lives_ok($$ select public.set_demande_state(current_setting('test.full')::uuid, 'closed', 'other') $$, 'matched → closed');
select is((select matched_professional_id::text from public.demandes where id = current_setting('test.full')::uuid),
  'c0000000-0000-0000-0000-000000000001', 'closing keeps who was matched');
select lives_ok($$ select public.set_demande_state(current_setting('test.quick')::uuid, 'closed', 'no_answer') $$, 'closed: no answer');
select results_eq($$ select state, closed_reason, closed_at is not null from public.demandes where id = current_setting('test.quick')::uuid $$,
  $$ values ('closed', 'no_answer', true) $$, 'closed with its reason and date');
select throws_ok($$ select public.update_demande(current_setting('test.quick')::uuid, '{"concerns": "x"}') $$, 'P0001',
  'Cette demande est fermée : rouvrez-la pour la modifier.', 'a closed request is not edited');
select lives_ok($$ select public.set_demande_state(current_setting('test.quick')::uuid, 'new') $$, 'reopened');
select results_eq($$ select state, closed_reason, closed_at from public.demandes where id = current_setting('test.quick')::uuid $$,
  $$ values ('new', null::text, null::timestamptz) $$, 'reopening clears the closing');

-- =============================================================================
-- assign, contact attempts, tasks
-- =============================================================================
select lives_ok($$ select public.assign_demande(current_setting('test.quick')::uuid, 'a0000000-0000-0000-0000-000000000002') $$,
  'assigned to the adjointe');
select throws_ok($$ select public.assign_demande(current_setting('test.quick')::uuid, 'a0000000-0000-0000-0000-000000000005') $$,
  'P0001', 'Cette personne ne peut pas traiter les demandes.', 'not to someone of another clinic');
select is(public.log_demande_contact(current_setting('test.quick')::uuid, 'phone', 'voicemail', now() + interval '1 day'), 1,
  'a contact attempt counts');
select results_eq($$ select contact_attempts, last_contact_at is not null, next_contact_at > now() from public.demandes where id = current_setting('test.quick')::uuid $$,
  $$ values (1, true, true) $$, 'the attempts, the last contact and the next try');
select throws_ok($$ select public.log_demande_contact(current_setting('test.quick')::uuid, 'phone', 'voicemail', now() - interval '1 day') $$,
  'P0001', 'La prochaine tentative doit être dans le futur.', 'the next try is in the future');
select throws_ok($$ select public.log_demande_contact(current_setting('test.quick')::uuid, null, null) $$,
  'P0001', 'Indiquez le moyen de contact et le résultat.', 'a contact attempt says how and what');
select set_config('test.task', public.add_demande_task(current_setting('test.quick')::uuid, 'discovery_call', now() + interval '2 hours')::text, true);
select lives_ok($$ select public.complete_demande_task(current_setting('test.quick')::uuid, current_setting('test.task')::uuid, 'reached') $$,
  'the discovery call done: reached');
select results_eq($$ select t.state, t.outcome, d.contact_attempts, d.next_contact_at from public.demande_tasks t join public.demandes d on d.id = t.demande_id
                     where t.id = current_setting('test.task')::uuid $$,
  $$ values ('done', 'reached', 2, null::timestamptz) $$, 'done, a contact attempt of the request, the next try cleared (reached)');
select throws_ok($$ select public.complete_demande_task(current_setting('test.quick')::uuid, current_setting('test.task')::uuid, 'reached') $$,
  'P0001', 'Cette tâche n''est plus ouverte.', 'a done task is closed');
select set_config('test.task2', public.add_demande_task(current_setting('test.quick')::uuid, 'callback', now() + interval '1 day',
  'a0000000-0000-0000-0000-000000000004')::text, true);
select lives_ok($$ select public.cancel_demande_task(current_setting('test.quick')::uuid, current_setting('test.task2')::uuid) $$, 'a task cancelled');

-- =============================================================================
-- The note and the participants
-- =============================================================================
select lives_ok($$ select public.set_demande_note(current_setting('test.quick')::uuid, 'Parle anglais.') $$, 'a note');
select lives_ok($$ select public.set_demande_note(current_setting('test.quick')::uuid, '   ') $$, 'an empty note removes it');
select is((select count(*)::int from public.demande_notes where demande_id = current_setting('test.quick')::uuid), 0, 'removed');
select lives_ok($$ select public.set_demande_participants(current_setting('test.quick')::uuid,
  '[{"display_name": "Bob Martin", "relationship": "self", "is_primary": true}, {"display_name": "Léa Martin", "relationship": "child"}]') $$,
  'two participants');
select lives_ok($$ select public.set_demande_participants(current_setting('test.quick')::uuid, jsonb_build_array(
  jsonb_build_object('id', (select id from public.demande_participants where display_name = 'Léa Martin'), 'display_name', 'Léa Martin',
                     'relationship', 'child', 'is_primary', true))) $$, 'replaced: Léa becomes the main person, Bob removed');
select results_eq($$ select display_name, is_primary from public.demande_participants where demande_id = current_setting('test.quick')::uuid $$,
  $$ values ('Léa Martin', true) $$, 'the set as given');
select throws_ok($$ select public.set_demande_participants(current_setting('test.quick')::uuid,
  '[{"display_name": "A", "is_primary": true}, {"display_name": "B", "is_primary": true}]') $$, 'P0001',
  'Une seule personne est la personne principale.', 'one main person');
select throws_ok($$ select public.set_demande_participants(current_setting('test.quick')::uuid, '[{"display_name": "A"}]') $$, 'P0001',
  'Une seule personne est la personne principale.', '… and not none');
select lives_ok($$ select public.set_demande_participants(current_setting('test.quick')::uuid, jsonb_build_array(jsonb_build_object(
  'id', (select id from public.demande_participants where demande_id = current_setting('test.full')::uuid and is_primary),
  'display_name', 'Volée', 'is_primary', true))) $$, 'another request''s participant id …');
select is((select count(*)::int from public.demande_participants where display_name = 'Alice Tremblay'), 1, '… becomes a new row, the other request untouched');
select throws_ok($$ select public.set_demande_participants(current_setting('test.quick')::uuid,
  '[{"client_id": "d0000000-0000-0000-0000-000000000009", "is_primary": true}]') $$, '23503', null, 'a client of another clinic is refused');

-- A counselor whose role is overridden without demandes.notes reads and writes no note.
reset role;
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'demandes.notes', false);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.demande_notes), 0, 'without demandes.notes: no note read');
select throws_ok($$ select public.set_demande_note(current_setting('test.quick')::uuid, 'X') $$, '42501', null, '… none written');
select throws_ok($$ select public.create_demande('{"contact_name": "X", "internal_note": "Y"}') $$, '42501', null, '… none at creation');

-- The journal names the RPC.
reset role;
select is((select a.source from public.audit_log a where a.table_name = 'demandes' and a.record_id = current_setting('test.quick')
            and a.action = 'insert'), 'rpc:create_demande', 'the journal names create_demande');

select * from finish();
rollback;
