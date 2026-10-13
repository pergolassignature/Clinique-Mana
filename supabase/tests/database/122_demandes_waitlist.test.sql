-- Demandes, batch D3 (migration *_demandes_waitlist.sql): the waiting list, part 1 — registration,
-- order and rank, complete / active (consent and fee), follow-ups, offers noted by hand, exits, the
-- request's state following, the follow-up job and its « still waiting? » link, P3-40.
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

-- =============================================================================
-- Privileges
-- =============================================================================
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('get_demandes_waitlist_settings', 'set_demandes_waitlist_settings', 'register_waitlist', 'update_waitlist_entry',
                       'set_waitlist_fee', 'log_waitlist_contact', 'add_waitlist_offer', 'answer_waitlist_offer', 'exit_waitlist',
                       'list_waitlist', 'waitlist_lists', 'get_waitlist_entry')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the D3 user RPCs: SECURITY DEFINER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('waitlist_followup_for_service', 'prepare_waitlist_followup_for_service', 'resolve_waitlist_followup_link',
                       'answer_waitlist_followup_for_service')
     and (not p.prosecdef or not has_function_privilege('service_role', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the follow-up RPCs: service role only');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname like any (array['waitlist\_%', 'demandes\_waitlist\_%'])
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@wl.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@wl.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'u2@wl.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u3@wl.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u4@wl.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('services'), ('clients'), ('demandes')) m(key);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'Pro', 'Un', 'u2@wl.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Brouillon', 'pro2@wl.test', 'draft');
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Attente', 'alice@wl.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Attente', 'bruno@wl.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Attente', null);
select set_config('test.psy', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' order by sort_order, key limit 1), true);
select set_config('test.other', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' order by sort_order, key offset 1 limit 1), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.da', public.create_demande(jsonb_build_object('client_id', 'd0000000-0000-0000-0000-000000000001',
  'availability_periods', array['evening'], 'modality', 'video', 'language', 'fr'))::text, true);
select set_config('test.db', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000002"}')::text, true);
select set_config('test.dc', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000003"}')::text, true);
select set_config('test.nofile', public.create_demande('{"contact_name": "Sans Dossier"}')::text, true);

-- =============================================================================
-- Settings
-- =============================================================================
select is(public.get_demandes_waitlist_settings(), '{"followup_weeks": 8, "followup_email": false, "answer_days": 14}'::jsonb, 'the defaults');
select throws_ok($$ select public.set_demandes_waitlist_settings('{"followup_weeks": 40}') $$, 'P0001',
  'Le rappel se fait après 1 à 26 semaines sans nouvelles.', 'weeks out of range: in French');
select is(public.set_demandes_waitlist_settings('{"followup_weeks": 6, "followup_email": false, "answer_days": 10}') ->> 'followup_weeks', '6',
  'the counselor saves the follow-up');

-- =============================================================================
-- Registration
-- =============================================================================
select throws_ok(format($$ select public.register_waitlist(%L, '[{"title_id": "%s"}]') $$, current_setting('test.nofile'), current_setting('test.psy')),
  'P0001', 'Rattachez d''abord le dossier du client (onglet Accueil).', 'a request without a file is refused');
select throws_ok(format($$ select public.register_waitlist(%L, '[{"title_id": "%s"}]', 'priority') $$, current_setting('test.da'), current_setting('test.psy')),
  'P0001', 'Indiquez pourquoi l''inscription est prioritaire.', 'a priority needs its reason');
select throws_ok(format($$ select public.register_waitlist(%L, '[{"title_id": "%s"}, {"title_id": "%s"}]') $$,
  current_setting('test.da'), current_setting('test.psy'), current_setting('test.other')),
  'P0001', 'Une profession et un professionnel au plus.', 'two professions: refused');
select throws_ok(format($$ select public.register_waitlist(%L, '[{"professional_id": "c0000000-0000-0000-0000-000000000002"}]') $$, current_setting('test.da')),
  'P0001', 'Choisissez un professionnel actif de la clinique.', 'a draft professional: refused');
select throws_ok(format($$ select public.set_demande_state(%L, 'waitlist') $$, current_setting('test.da')),
  'P0001', 'Pour la liste d''attente, inscrivez la demande : « Inscrire sur la liste d''attente ».', 'the state alone: refused');

-- A (oldest): psychology and Pro Un; B: psychology; C: psychology, priority (newest).
select set_config('test.ea', (public.register_waitlist(current_setting('test.da')::uuid,
  format('[{"title_id": "%s"}, {"professional_id": "c0000000-0000-0000-0000-000000000001"}]', current_setting('test.psy'))::jsonb))[1]::text, true);
select set_config('test.ea_pro', (select id::text from public.waitlist_entries where demande_id = current_setting('test.da')::uuid
                                   and target_professional_id is not null), true);
select set_config('test.eb', (public.register_waitlist(current_setting('test.db')::uuid,
  format('[{"title_id": "%s"}]', current_setting('test.psy'))::jsonb))[1]::text, true);
select set_config('test.ec', (public.register_waitlist(current_setting('test.dc')::uuid,
  format('[{"title_id": "%s"}]', current_setting('test.psy'))::jsonb, 'priority', 'Détresse importante'))[1]::text, true);
-- One transaction has one now(): the registrations get their own days.
reset role;
update public.waitlist_entries set registered_at = now() - interval '3 days' where demande_id = current_setting('test.da')::uuid;
update public.waitlist_entries set registered_at = now() - interval '2 days' where demande_id = current_setting('test.db')::uuid;
update public.waitlist_entries set registered_at = now() - interval '1 day' where demande_id = current_setting('test.dc')::uuid;
set local role authenticated;

select results_eq($$ select state, client_id::text, availability_periods, modality, fee_status, registered_by::text from public.waitlist_entries
                     where id = current_setting('test.ea')::uuid $$,
  $$ values ('incomplete', 'd0000000-0000-0000-0000-000000000001', array['evening'], 'video', 'to_invoice', 'a0000000-0000-0000-0000-000000000001') $$,
  'the criteria come from the request; incomplete, the fee to invoice');
select results_eq($$ select state from public.demandes where id = current_setting('test.da')::uuid $$, $$ values ('waitlist') $$,
  'the request is « Liste d''attente »');
select ok(exists (select 1 from public.demande_events where demande_id = current_setting('test.da')::uuid and kind = 'state_changed' and to_state = 'waitlist'),
  'the history says so');
select throws_ok(format($$ select public.register_waitlist(%L, '[{"title_id": "%s"}]') $$, current_setting('test.db'), current_setting('test.psy')),
  'P0001', 'Cette demande est déjà sur cette liste d''attente.', 'once per list');

-- =============================================================================
-- Order and rank
-- =============================================================================
select results_eq(format($$ select id::text, rank, list_size from public.list_waitlist(%L) $$, current_setting('test.psy')),
  $$ values (current_setting('test.ec'), 1::bigint, 3::bigint), (current_setting('test.ea'), 2::bigint, 3::bigint), (current_setting('test.eb'), 3::bigint, 3::bigint) $$,
  'the priority first, then the oldest: ranks 1, 2, 3 of 3');
select results_eq($$ select id::text, rank, list_size, target_name from public.list_waitlist(null, 'c0000000-0000-0000-0000-000000000001') $$,
  $$ values (current_setting('test.ea_pro'), 1::bigint, 1::bigint, 'Pro Un') $$, 'the professional''s own list');
select results_eq(format($$ select count(*)::int from public.list_waitlist(null, null, null, %L) $$, current_setting('test.da')),
  $$ values (2) $$, 'a request''s entries');
select results_eq(format($$ select open_count, incomplete_count from public.waitlist_lists() where target_id = %L $$, current_setting('test.psy')),
  $$ values (3, 3) $$, 'the lists: three, all incomplete');

-- =============================================================================
-- Complete: the consent (rule off → not required) and the fee
-- =============================================================================
select is((select consent_state from public.list_waitlist() where id = current_setting('test.eb')::uuid), 'not_required',
  'the consent''s rule is off: not required');
select throws_ok(format($$ select public.set_waitlist_fee(%L, 'waived') $$, current_setting('test.eb')),
  'P0001', 'Indiquez pourquoi les frais sont exonérés.', 'waived needs a reason');
select throws_ok(format($$ select public.set_waitlist_fee(%L, 'invoiced') $$, current_setting('test.eb')),
  '22023', 'Unknown fee status', 'invoiced is Facturation''s');
select lives_ok(format($$ select public.set_waitlist_fee(%L, 'waived', 'PAE') $$, current_setting('test.eb')), 'waived (PAE)');
select is((select state from public.waitlist_entries where id = current_setting('test.eb')::uuid), 'active', 'fee waived, no consent needed: active');
select lives_ok(format($$ select public.set_waitlist_fee(%L, 'to_invoice') $$, current_setting('test.eb')), 'back to invoice');
select is((select state from public.waitlist_entries where id = current_setting('test.eb')::uuid), 'incomplete', 'incomplete again');

-- The rule on: the consent is missing, then signed (Clients' side): the list makes it active.
reset role;
update public.client_consent_rules set is_active = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and consent_key = 'waitlist';
set local role authenticated;
select lives_ok(format($$ select public.set_waitlist_fee(%L, 'paid') $$, current_setting('test.eb')), 'paid');
select results_eq($$ select state, consent_state from public.list_waitlist() where id = current_setting('test.eb')::uuid $$,
  $$ values ('incomplete', 'missing') $$, 'paid but the consent missing: still incomplete');
reset role;
insert into public.client_consents (org_id, client_id, consent_key, language, version_label, signed_at, source)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'waitlist', 'fr', 'v1', now() - interval '1 hour', 'import');
set local role authenticated;
select results_eq($$ select state, consent_state from public.list_waitlist() where id = current_setting('test.eb')::uuid $$,
  $$ values ('active', 'signed') $$, 'the consent signed: active when the list is read');
select isnt((select consent_signed_at from public.waitlist_entries where id = current_setting('test.eb')::uuid), null, 'with its date');

-- A and C: fee waived and consent signed too (for what follows).
reset role;
insert into public.client_consents (org_id, client_id, consent_key, language, version_label, signed_at, source)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'waitlist', 'fr', 'v1', now(), 'import'),
       ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'waitlist', 'fr', 'v1', now(), 'import');
set local role authenticated;
select public.set_waitlist_fee(current_setting('test.ea')::uuid, 'paid');
select public.set_waitlist_fee(current_setting('test.ea_pro')::uuid, 'paid');
select public.set_waitlist_fee(current_setting('test.ec')::uuid, 'waived', 'IVAC');
select results_eq(format($$ select count(*)::int from public.list_waitlist(%L, null, array['active']) $$, current_setting('test.psy')),
  $$ values (3) $$, 'three active');

-- =============================================================================
-- Work on an entry
-- =============================================================================
select lives_ok(format($$ select public.update_waitlist_entry(%L, '{"priority": "priority", "priority_reason": "Enfant en attente", "bridge_professional_id": "c0000000-0000-0000-0000-000000000001"}') $$,
  current_setting('test.eb')), 'priority and a bridge professional');
select results_eq(format($$ select id::text, bridge_name from public.list_waitlist(%L) $$, current_setting('test.psy')),
  $$ values (current_setting('test.eb'), 'Pro Un'), (current_setting('test.ec'), null::text), (current_setting('test.ea'), null) $$,
  'two priorities: the older one first, then the normal one');
select throws_ok(format($$ select public.update_waitlist_entry(%L, '{"motif_ids": ["00000000-0000-0000-0000-000000000000"]}') $$, current_setting('test.eb')),
  'P0001', 'Un motif n''est pas dans le catalogue de la clinique.', 'motifs from the catalogue');

-- Follow-ups: no answer keeps « À rappeler », reaching her ends it.
reset role;
update public.waitlist_entries set state = 'to_call' where id = current_setting('test.ea')::uuid;
set local role authenticated;
select public.log_waitlist_contact(current_setting('test.ea')::uuid, 'call', 'no_answer');
select results_eq($$ select state, last_contact_at is null from public.waitlist_entries where id = current_setting('test.ea')::uuid $$,
  $$ values ('to_call', true) $$, 'no answer: still to call');
select public.log_waitlist_contact(current_setting('test.ea')::uuid, 'call', 'reached', now() + interval '30 days');
select results_eq($$ select state, last_contact_at is not null, next_contact_at is not null from public.waitlist_entries where id = current_setting('test.ea')::uuid $$,
  $$ values ('active', true, true) $$, 'reached: active again, the next call noted');

-- =============================================================================
-- Offers noted by hand, placement
-- =============================================================================
select set_config('test.offer', public.add_waitlist_offer(current_setting('test.eb')::uuid, 'c0000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 50 minutes')))::text, true);
select is((select state from public.waitlist_entries where id = current_setting('test.eb')::uuid), 'offered', 'offered');
select throws_ok(format($$ select public.add_waitlist_offer(%L, 'c0000000-0000-0000-0000-000000000001') $$, current_setting('test.eb')),
  'P0001', 'Une offre attend déjà sa réponse.', 'one pending offer at a time');
select public.answer_waitlist_offer(current_setting('test.eb')::uuid, current_setting('test.offer')::uuid, 'declined');
select is((select state from public.waitlist_entries where id = current_setting('test.eb')::uuid), 'active', 'declined: active again, rank kept');

-- A accepts: both her entries close « Placée », her request is matched.
select set_config('test.offer2', public.add_waitlist_offer(current_setting('test.ea')::uuid, 'c0000000-0000-0000-0000-000000000001')::text, true);
select public.answer_waitlist_offer(current_setting('test.ea')::uuid, current_setting('test.offer2')::uuid, 'accepted');
select results_eq(format($$ select state, exit_reason from public.waitlist_entries where demande_id = %L order by id $$, current_setting('test.da')),
  $$ values ('closed', 'placed'), ('closed', 'placed') $$, 'accepted: every entry of the request placed');
select results_eq($$ select state, matched_professional_id::text from public.demandes where id = current_setting('test.da')::uuid $$,
  $$ values ('matched', 'c0000000-0000-0000-0000-000000000001') $$, 'the request is matched with her');
select results_eq(format($$ select id::text, rank from public.list_waitlist(%L) $$, current_setting('test.psy')),
  $$ values (current_setting('test.eb'), 1::bigint), (current_setting('test.ec'), 2::bigint) $$, 'the others move up');
select throws_ok(format($$ select public.log_waitlist_contact(%L, 'call', 'reached') $$, current_setting('test.ea')),
  'P0001', 'Cette personne n''est plus sur la liste d''attente.', 'a closed entry is read-only');

-- =============================================================================
-- The follow-up job, the link, P3-40
-- =============================================================================
-- (as the database: the service RPCs' grants are checked above)
reset role;
update public.waitlist_entries set registered_at = now() - interval '9 weeks', last_contact_at = null
 where id in (current_setting('test.eb')::uuid, current_setting('test.ec')::uuid);
select is(public.waitlist_followup_for_service('b0000000-0000-0000-0000-00000000000a'),
  '{"promoted": 0, "to_call": 2, "no_answer": 0, "email": []}'::jsonb, 'two without news for 6 weeks: to call; the email is off');
select is((select count(*)::int from public.notifications where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'demandes.waitlist_to_call'),
  1, 'one notice for the counselors');
select is(public.prepare_waitlist_followup_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.eb')::uuid,
  decode(repeat('ab', 32), 'hex')), null, 'the email off: nothing prepared');

-- The email on; Demandes reserved for its testers: still nothing (P3-40).
reset role;
update public.org_module_settings set settings = settings || '{"waitlist": {"followup_weeks": 6, "followup_email": true, "answer_days": 10}}'
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
select is(public.waitlist_followup_for_service('b0000000-0000-0000-0000-00000000000a') -> 'email', '[]'::jsonb,
  'P3-40: reserved for its testers, no email listed');
select is(public.prepare_waitlist_followup_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.eb')::uuid,
  decode(repeat('ab', 32), 'hex')), null, 'P3-40: nor prepared');

update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
select is(public.waitlist_followup_for_service('b0000000-0000-0000-0000-00000000000a') -> 'email',
  jsonb_build_array(current_setting('test.eb')), 'open to everyone: B is emailed (C has no address)');
select is(public.prepare_waitlist_followup_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.eb')::uuid,
  decode(repeat('ab', 32), 'hex')) - 'link_expires_at' - 'demande_id' - 'list_name',
  '{"email": "bruno@wl.test", "first_name": "Bruno", "language": "fr", "clinic_name": "Org A"}'::jsonb, 'prepared: her address and name');
select is(public.waitlist_followup_for_service('b0000000-0000-0000-0000-00000000000a') -> 'email', '[]'::jsonb,
  'emailed once: not listed again');
select is(public.resolve_waitlist_followup_link((select id from public.secure_links where token_hash = decode(repeat('ab', 32), 'hex'))) ->> 'clinic_name',
  'Org A', 'the link shows the clinic');

select is(public.answer_waitlist_followup_for_service(decode(repeat('ab', 32), 'hex'), 'stay'), '{"state": "stay"}'::jsonb, '« Oui »');
select results_eq($$ select state, last_contact_at is not null from public.waitlist_entries where id = current_setting('test.eb')::uuid $$,
  $$ values ('active', true) $$, 'she stays: active, the counselors need not call');
select is(public.answer_waitlist_followup_for_service(decode(repeat('ab', 32), 'hex'), 'leave'), '{"state": "invalid"}'::jsonb,
  'the link answers once');

-- No answer after `answer_days`.
update public.waitlist_entries set state = 'to_call' where id = current_setting('test.eb')::uuid;
delete from public.waitlist_contacts where entry_id = current_setting('test.eb')::uuid;
insert into public.waitlist_contacts (entry_id, org_id, kind, outcome, at)
values (current_setting('test.eb')::uuid, 'b0000000-0000-0000-0000-00000000000a', 'followup_email', 'message_sent', now() - interval '11 days');
select is(public.waitlist_followup_for_service('b0000000-0000-0000-0000-00000000000a') -> 'no_answer', '1'::jsonb, 'no answer in 10 days: noted');
select is((select followup_unanswered from private.waitlist_rows('b0000000-0000-0000-0000-00000000000a') where id = current_setting('test.eb')::uuid),
  true, '« Sans réponse » on the list');

-- « Non »: she leaves, her request (no entry left) closes « Ne souhaite plus ».
select ok(public.prepare_waitlist_followup_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.eb')::uuid,
  decode(repeat('cd', 32), 'hex')) is null, 'B was emailed within the weeks: no second email');
delete from public.waitlist_contacts where entry_id = current_setting('test.eb')::uuid and kind = 'followup_email';
select isnt(public.prepare_waitlist_followup_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.eb')::uuid,
  decode(repeat('cd', 32), 'hex')), null, 'a new email');
select is(public.answer_waitlist_followup_for_service(decode(repeat('cd', 32), 'hex'), 'leave'), '{"state": "leave"}'::jsonb, '« Non »');
select results_eq($$ select e.state, e.exit_reason, d.state, d.closed_reason from public.waitlist_entries e join public.demandes d on d.id = e.demande_id
                     where e.id = current_setting('test.eb')::uuid $$,
  $$ values ('closed', 'withdrew', 'closed', 'withdrew') $$, 'off the list; the request closed');
select is((select count(*)::int from public.notifications where kind = 'demandes.waitlist_left'), 1, 'the counselors are told');

-- =============================================================================
-- Exits and the request's state
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format($$ select public.exit_waitlist(%L, 'placed') $$, current_setting('test.ec')),
  'P0001', 'Choisissez un professionnel actif de la clinique.', 'placed needs the professional');
select public.set_demande_state(current_setting('test.dc')::uuid, 'closed', 'referred_out');
select results_eq($$ select state, exit_reason from public.waitlist_entries where id = current_setting('test.ec')::uuid $$,
  $$ values ('closed', 'referred_elsewhere') $$, 'the request closed « Orientée ailleurs »: its entry follows');
select results_eq(format($$ select open_count, average_wait_days from public.waitlist_lists() where target_id = %L $$, current_setting('test.psy')),
  $$ values (0, 3) $$, 'nobody left; the placed one waited 3 days');

-- A fresh registration exits by hand: its request closes with the twin reason.
select public.set_demande_state(current_setting('test.dc')::uuid, 'new');
select set_config('test.ed', (public.register_waitlist(current_setting('test.dc')::uuid,
  format('[{"title_id": "%s"}]', current_setting('test.other'))::jsonb))[1]::text, true);
select public.exit_waitlist(current_setting('test.ed')::uuid, 'no_answer');
select results_eq($$ select state, closed_reason from public.demandes where id = current_setting('test.dc')::uuid $$,
  $$ values ('closed', 'no_answer') $$, 'the last entry out « Sans réponse »: the request closes the same');

-- =============================================================================
-- The side sheet, permissions, clinics
-- =============================================================================
select results_eq(format($$ select (r -> 'fee' ->> 'price_cents')::int, (r -> 'fee' ->> 'code')::int, jsonb_array_length(r -> 'contacts') >= 1,
                                   jsonb_array_length(r -> 'offers'), r -> 'can' ->> 'manage'
                              from public.get_waitlist_entry(%L) r $$, current_setting('test.ea')),
  $$ values (1891, 50100, true, 1, 'true') $$, 'the sheet: the fee (18,91 $), the follow-ups, the offers');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_waitlist() $$, '42501', null, 'a professional has no list');
select throws_ok(format($$ select public.exit_waitlist(%L, 'withdrew') $$, current_setting('test.ed')), '42501', null, 'nor writes');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select * from public.list_waitlist(null, null, array['active', 'closed']) $$, 'another clinic sees nothing');
select is(public.get_waitlist_entry(current_setting('test.ea')::uuid), null, 'nor an entry');
select throws_ok(format($$ select public.set_waitlist_fee(%L, 'paid') $$, current_setting('test.eb')),
  'P0001', 'Cette inscription n''existe pas.', 'nor writes one');

select * from finish();
rollback;
