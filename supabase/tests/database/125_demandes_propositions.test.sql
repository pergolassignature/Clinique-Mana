-- Demandes, batch D3b (migration *_demandes_propositions.sql): proposals on Rendez-vous' held
-- appointments — made by the actor (P3-40, Rendez-vous on, a file, an address), the link (once),
-- accepted (booked, the others freed, the request matched), declined, withdrawn, expired (the
-- job), the request closed, a slot no longer possible, permissions, clinics.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('proposition_services', 'withdraw_proposition', 'list_demande_propositions')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the user RPCs: SECURITY DEFINER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_proposition_for_service', 'resolve_proposition_link', 'answer_proposition_for_service')
     and (not p.prosecdef or not has_function_privilege('service_role', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the service RPCs: service role only');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('demandes_recipient', 'demandes_after_proposition', 'demandes_end_proposition', 'job_demandes_propositions_expire')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@pr.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@pr.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'u2@pr.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u3@pr.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('services'), ('clients'), ('appointments'), ('demandes')) m(key);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@pr.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Prop', 'alice@pr.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Prop', 'bruno@pr.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'SansCourriel', null);
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
-- Pro Un works Monday and Tuesday 9:00–12:00.
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', d, '09:00', '12:00', '{}', true, false, '2026-10-01', null)
  from (values (1), (2)) as w(d);
select is((select count(*)::int from public.proposition_services('c0000000-0000-0000-0000-000000000001') where id = current_setting('test.s50')::uuid),
  1, 'her bookable services include the 50-minute session');
-- Requests (accepted first: « Proposée » follows « Acceptée » or the waiting list).
select set_config('test.d' || n, public.create_demande(jsonb_build_object('client_id', c))::text, true)
  from (values (1, 'd0000000-0000-0000-0000-000000000001'), (2, 'd0000000-0000-0000-0000-000000000002'), (3, 'd0000000-0000-0000-0000-000000000003')) v(n, c);
select public.set_demande_state(current_setting('test.d' || n)::uuid, 'accepted') from generate_series(1, 3) n;
select set_config('test.nofile', public.create_demande('{"contact_name": "Sans Dossier", "contact_email": "x@pr.test"}')::text, true);
select set_config('test.dnew', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000002"}')::text, true);
select public.set_demande_state(current_setting('test.nofile')::uuid, 'accepted');

-- =============================================================================
-- Proposing (as the function: the service role, the actor verified)
-- =============================================================================
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- Professionnels' display facts (no user needed: a job, a link).
select set_config('test.title', (select private.profession_title_label(t.name, t.name_feminine, t.name_masculine, p.gender)
  from public.profession_titles t, public.professionals p
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue' and p.id = 'c0000000-0000-0000-0000-000000000001'), true);
select results_eq($$ select display_name, title, status from private.professional_display_facts('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001') $$,
  $$ values ('Pro Un', current_setting('test.title'), 'active') $$,
  'Professionnels'' display facts: the name and the primary title, as on the fiche');
select is_empty($$ select * from private.professional_display_facts('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000001') $$,
  '… nothing for another clinic');
select ok(not has_function_privilege('authenticated', 'private.professional_display_facts(uuid, uuid)', 'execute')
          and not has_function_privilege('service_role', 'private.professional_display_facts(uuid, uuid)', 'execute'),
  '… granted to no role');
-- Reserved for its testers, the counselor among them: she may work, nothing leaves for a client.
insert into public.org_module_testers (org_id, module_key, user_id)
values ('b0000000-0000-0000-0000-00000000000a', 'demandes', 'a0000000-0000-0000-0000-000000000001');
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
select throws_ok($$ select public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.d1')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 13:00Z'::timestamptz], 'video', decode(repeat('a1', 32), 'hex')) $$,
  'P0001', 'Demandes est réservé aux testeurs : aucune proposition ne part vers un client pour le moment.', 'P3-40: reserved for its testers, no proposal');
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
select throws_ok($$ select public.create_proposition_for_service('a0000000-0000-0000-0000-000000000002', current_setting('test.d1')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 13:00Z'::timestamptz], 'video', decode(repeat('a1', 32), 'hex')) $$,
  '42501', null, 'the actor must work the requests');
select throws_ok($$ select public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.dnew')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 13:00Z'::timestamptz], 'video', decode(repeat('a1', 32), 'hex')) $$,
  'P0001', 'Une proposition se fait sur une demande « Acceptée » ou sur la liste d''attente : changez d''abord son état.', 'a « Nouvelle » request: not yet');
select throws_ok($$ select public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.nofile')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 13:00Z'::timestamptz], 'video', decode(repeat('a1', 32), 'hex')) $$,
  'P0001', 'Rattachez d''abord le dossier du client (onglet Accueil).', 'a file first');
select throws_ok($$ select public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.d3')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 13:00Z'::timestamptz], 'video', decode(repeat('a1', 32), 'hex')) $$,
  'P0001', 'Aucune adresse courriel pour envoyer la proposition : ajoutez-la au dossier, ou proposez par téléphone.', 'an address to send it to');
select throws_ok($$ select public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.d1')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 20:00Z'::timestamptz], 'video', decode(repeat('a1', 32), 'hex')) $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', 'Rendez-vous'' rules: in her availability');

select set_config('test.p1', (public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.d1')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-16 13:00Z'::timestamptz, '2027-03-15 13:00Z'::timestamptz],
  'video', decode(repeat('a1', 32), 'hex')) ->> 'proposition_id'), true);
select results_eq($$ select response, jsonb_array_length(slots), mode, directory_snapshot ->> 'display_name', proposed_by::text
                      from public.demande_propositions where id = current_setting('test.p1')::uuid $$,
  $$ values ('pending', 2, 'video', 'Pro Un', 'a0000000-0000-0000-0000-000000000001') $$, 'a pending proposal of two slots, as she proposed it');
select results_eq($$ select state, hold_reference::text from public.appointments where hold_reference = current_setting('test.p1')::uuid order by starts_at $$,
  $$ values ('held', current_setting('test.p1')), ('held', current_setting('test.p1')) $$, 'each slot a held appointment (R1b)');
select is((select state from public.demandes where id = current_setting('test.d1')::uuid), 'proposed', 'the request is « Proposée »');
select throws_ok($$ select public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.d1')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-22 13:00Z'::timestamptz], 'video', decode(repeat('a2', 32), 'hex')) $$,
  'P0001', 'Une proposition attend déjà sa réponse : retirez-la d''abord.', 'one pending proposal per request');
select is(jsonb_array_length(public.resolve_proposition_link((select id from public.secure_links where token_hash = decode(repeat('a1', 32), 'hex'))) -> 'slots'),
  2, 'the link shows the two slots');

-- =============================================================================
-- Accepted
-- =============================================================================
select set_config('test.a1', (select id::text from public.appointments where hold_reference = current_setting('test.p1')::uuid and starts_at = '2027-03-15 13:00Z'), true);
select is(public.answer_proposition_for_service(decode(repeat('a1', 32), 'hex'), 'f0000000-0000-0000-0000-000000000001') ->> 'state', 'invalid',
  'a slot not of this proposal: invalid');
select is(public.answer_proposition_for_service(decode(repeat('a1', 32), 'hex'), current_setting('test.a1')::uuid) ->> 'state', 'accepted', '« Accepter »');
select results_eq($$ select state from public.appointments where hold_reference = current_setting('test.p1')::uuid $$,
  $$ values ('booked') $$, 'the slot chosen is booked, the other freed');
select results_eq($$ select d.state, d.matched_professional_id::text, x.response, x.accepted_appointment_id::text
                      from public.demandes d join public.demande_propositions x on x.demande_id = d.id where x.id = current_setting('test.p1')::uuid $$,
  $$ values ('matched', 'c0000000-0000-0000-0000-000000000001', 'accepted', current_setting('test.a1')) $$, 'the request matched with her');
select is((select count(*)::int from public.notifications where kind = 'demandes.proposition_accepted'), 1, 'the counselors are told');
select is(public.answer_proposition_for_service(decode(repeat('a1', 32), 'hex'), current_setting('test.a1')::uuid) ->> 'state', 'invalid', 'the link answers once');

-- =============================================================================
-- Declined, withdrawn, expired, closed, no longer possible, switched off
-- =============================================================================
select set_config('test.p2', (public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.d2')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 14:00Z'::timestamptz], 'phone',
  decode(repeat('b1', 32), 'hex')) ->> 'proposition_id'), true);
select is(public.answer_proposition_for_service(decode(repeat('b1', 32), 'hex'), null, 'schedule') ->> 'state', 'declined', '« Aucune ne me convient »');
select results_eq($$ select x.response, x.decline_reason, d.state, (select count(*)::int from public.appointments a where a.hold_reference = x.id)
                      from public.demande_propositions x join public.demandes d on d.id = x.demande_id where x.id = current_setting('test.p2')::uuid $$,
  $$ values ('declined', 'schedule', 'accepted', 0) $$, 'declined: its slot freed, the request back to « Acceptée »');

select set_config('test.p3', (public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.d2')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 14:00Z'::timestamptz], 'video',
  decode(repeat('b2', 32), 'hex')) ->> 'proposition_id'), true);
-- Its hold expired meanwhile (the proposal not yet): the slot is no longer possible, the link stays.
update public.appointments set held_until = now() - interval '1 minute' where hold_reference = current_setting('test.p3')::uuid;
select is(public.answer_proposition_for_service(decode(repeat('b2', 32), 'hex'),
  (select id from public.appointments where hold_reference = current_setting('test.p3')::uuid)),
  '{"state": "unavailable", "reason": "hold_expired"}'::jsonb, 'a slot no longer held: unavailable, with R1b''s HINT');
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';
select is(public.answer_proposition_for_service(decode(repeat('b2', 32), 'hex'), null) ->> 'state', 'invalid', 'Rendez-vous switched off: invalid');
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';

-- Expired: the job (48 h passed).
update public.demande_propositions set expires_at = now() - interval '1 minute' where id = current_setting('test.p3')::uuid;
select is(private.job_demandes_propositions_expire(), 'expired=1', 'the job expires it');
select results_eq($$ select x.response, d.state, (select count(*)::int from public.appointments a where a.hold_reference = x.id)
                      from public.demande_propositions x join public.demandes d on d.id = x.demande_id where x.id = current_setting('test.p3')::uuid $$,
  $$ values ('expired', 'accepted', 0) $$, 'expired: its slot freed, the request back');
select is((select count(*)::int from public.notifications where kind = 'demandes.proposition_expired'), 1, '« Rappelez-la »');
select is(public.answer_proposition_for_service(decode(repeat('b2', 32), 'hex'), null) ->> 'state', 'invalid', 'its link answers nothing');

-- A proposal pending: the request does not move by hand; placed through the waiting list, it is withdrawn.
select set_config('test.p6', (public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.d2')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 14:00Z'::timestamptz], 'video',
  decode(repeat('b5', 32), 'hex')) ->> 'proposition_id'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format($$ select public.set_demande_state(%L, 'accepted') $$, current_setting('test.d2')),
  'P0001', 'Une proposition attend sa réponse : retirez-la d''abord (onglet Suivi).', 'no move by hand while a proposal is pending');
select set_config('test.w6', (public.register_waitlist(current_setting('test.d2')::uuid,
  (select format('[{"title_id": "%s"}]', id) from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'psychologue')::jsonb))[1]::text, true);
select public.exit_waitlist(current_setting('test.w6')::uuid, 'placed', 'c0000000-0000-0000-0000-000000000001');
select results_eq($$ select x.response, d.state, (select count(*)::int from public.appointments a where a.hold_reference = x.id)
                      from public.demande_propositions x join public.demandes d on d.id = x.demande_id where x.id = current_setting('test.p6')::uuid $$,
  $$ values ('withdrawn', 'matched', 0) $$, 'placed through the waiting list: the pending proposal withdrawn, its slot freed');
select public.set_demande_state(current_setting('test.d2')::uuid, 'accepted');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Withdrawn by the counselor; then the request closed with a pending proposal.
select set_config('test.p4', (public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.d2')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 14:00Z'::timestamptz], 'video',
  decode(repeat('b3', 32), 'hex')) ->> 'proposition_id'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(format($$ select public.withdraw_proposition(%L) $$, current_setting('test.p4')), '« Retirer la proposition »');
select results_eq($$ select x.response, d.state from public.demande_propositions x join public.demandes d on d.id = x.demande_id
                     where x.id = current_setting('test.p4')::uuid $$,
  $$ values ('withdrawn', 'accepted') $$, 'withdrawn: the request back');
select throws_ok(format($$ select public.withdraw_proposition(%L) $$, current_setting('test.p4')), 'P0001', 'Cette proposition a déjà sa réponse.', 'once');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.p5', (public.create_proposition_for_service('a0000000-0000-0000-0000-000000000001', current_setting('test.d2')::uuid,
  'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, array['2027-03-15 14:00Z'::timestamptz], 'video',
  decode(repeat('b4', 32), 'hex')) ->> 'proposition_id'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_demande_state(current_setting('test.d2')::uuid, 'closed', 'withdrew');
select results_eq($$ select x.response, (select count(*)::int from public.appointments a where a.hold_reference = x.id)
                      from public.demande_propositions x where x.id = current_setting('test.p5')::uuid $$,
  $$ values ('withdrawn', 0) $$, 'the request closed: its proposal withdrawn, its slot freed');

-- =============================================================================
-- Reads, permissions, clinics
-- =============================================================================
select results_eq(format($$ select response, professional_name, proposed_by_name from public.list_demande_propositions(%L) order by proposed_at $$, current_setting('test.d1')),
  $$ values ('accepted', 'Pro Un', 'Conseillère A') $$, 'the record lists its proposals');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(format($$ select * from public.list_demande_propositions(%L) $$, current_setting('test.d1')), '42501', null, 'a professional reads none');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty(format($$ select * from public.list_demande_propositions(%L) $$, current_setting('test.d1')), 'another clinic sees nothing');
select throws_ok(format($$ select public.withdraw_proposition(%L) $$, current_setting('test.p1')), 'P0001', 'Cette proposition n''existe pas.', 'nor withdraws one');

select * from finish();
rollback;
