-- Demandes, batch D2 (migration *_demandes_inbox.sql): the inbox (the 24–48 h promise in business
-- hours, « sans réponse », filters, order, counts), the record's bundle, « Je m'en occupe », the
-- reference lists.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- =============================================================================
-- Privileges
-- =============================================================================
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('list_demandes', 'demandes_counts', 'get_demande', 'get_demandes_reference', 'set_demande_handler')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the D2 RPCs: SECURITY DEFINER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('demandes_inbox_rows', 'demandes_business_hours', 'demandes_promise', 'demandes_fold', 'demandes_handling_window')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');

-- =============================================================================
-- The promise in business hours
-- =============================================================================
select is(private.demandes_business_hours('2026-10-09 16:00 America/Toronto', '2026-10-12 10:00 America/Toronto', 'America/Toronto'), 18.0,
  'Friday 16 h → Monday 10 h: 8 + 10 business hours, the weekend left out');
select is(private.demandes_business_hours('2026-10-10 09:00 America/Toronto', '2026-10-11 18:00 America/Toronto', 'America/Toronto'), 0.0,
  'a weekend counts nothing');
select is(private.demandes_business_hours('2026-10-13 10:00 America/Toronto', '2026-10-12 10:00 America/Toronto', 'America/Toronto'), 0.0,
  'backwards: nothing');
select results_eq($$ select private.demandes_promise(h, c) from (values (5.0, false), (24.0, false), (47.9, false), (48.0, false), (30.0, true), (60.0, true)) v(h, c) $$,
  $$ values ('ok'), ('soon'), ('soon'), ('late'), ('met'), ('met_late') $$, 'ok, soon from 24 h, late from 48 h; met or met late once contacted');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@dem3.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 5) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@dem3.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'u2@dem3.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'u3@dem3.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u4@dem3.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u5@dem3.test', 'active');
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
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'u3@dem3.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@dem3.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pro', 'B', 'pro3@dem3.test', 'active');
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Tremblay'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Tremblay'),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Autre', 'Clinique');
select set_config('test.m1', (select id::text from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a' order by key limit 1), true);
select set_config('test.m2', (select id::text from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a' order by key offset 1 limit 1), true);
select set_config('test.src', (select id::text from public.referral_sources where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'google'), true);


-- Requests, as the counselor (04): an old one never called (late), an urgent fresh one, one called
-- without an answer, one of the adjointe's, a closed one.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.old', public.create_demande(jsonb_build_object('contact_name', 'Élodie Ancienne', 'contact_phone_e164', '+15145550199',
  'received_at', (now() - interval '8 days')::text))::text, true);
select set_config('test.urgent', public.create_demande('{"contact_name": "Urgent Maintenant", "is_urgent": true}')::text, true);
select set_config('test.called', public.create_demande(jsonb_build_object('client_id', 'd0000000-0000-0000-0000-000000000001',
  'received_at', (now() - interval '1 hour')::text, 'assigned_to', 'a0000000-0000-0000-0000-000000000004'))::text, true);
select public.log_demande_contact(current_setting('test.called')::uuid, 'phone', 'no_answer', now() + interval '1 day');
select set_config('test.theirs', public.create_demande(jsonb_build_object('contact_name', 'Autre Personne',
  'assigned_to', 'a0000000-0000-0000-0000-000000000002'))::text, true);
select set_config('test.closed', public.create_demande('{"contact_name": "Fermée"}')::text, true);
select public.set_demande_state(current_setting('test.closed')::uuid, 'closed', 'duplicate');

-- =============================================================================
-- The inbox
-- =============================================================================
select results_eq($$ select id::text from public.list_demandes() $$,
  $$ values (current_setting('test.urgent')), (current_setting('test.old')), (current_setting('test.called')), (current_setting('test.theirs')) $$,
  'open: the urgent first, then the late, then the oldest; the closed one apart');
select results_eq($$ select promise, waiting_hours > 48, first_contact_at is null from public.list_demandes() where id = current_setting('test.old')::uuid $$,
  $$ values ('late', true, true) $$, 'eight days without a call: late');
select results_eq($$ select promise, no_answer, last_outcome, contact_attempts, person_name from public.list_demandes()
                     where id = current_setting('test.called')::uuid $$,
  $$ values ('met', true, 'no_answer', 1, 'Alice Tremblay') $$, 'called within the hour: met; no answer yet; the file''s name');
select results_eq($$ select id::text from public.list_demandes('open', 'any', array['no_answer']) $$,
  $$ values (current_setting('test.called')) $$, '« sans réponse »');
select results_eq($$ select id::text from public.list_demandes('open', 'any', array['late']) $$,
  $$ values (current_setting('test.old')) $$, 'late only');
select results_eq($$ select id::text from public.list_demandes('open', 'any', array['urgent']) $$,
  $$ values (current_setting('test.urgent')) $$, 'urgent only');
select results_eq($$ select id::text from public.list_demandes('open', 'me') $$,
  $$ values (current_setting('test.called')) $$, 'mine');
select results_eq($$ select id::text from public.list_demandes('open', 'none') order by 1 $$,
  $$ select x from (values (current_setting('test.old')), (current_setting('test.urgent'))) v(x) order by 1 $$, 'unassigned');
select results_eq($$ select id::text from public.list_demandes('closed') $$, $$ values (current_setting('test.closed')) $$, 'the closed view');
select is((select count(*)::int from public.list_demandes('all')), 5, 'every request');
select results_eq($$ select id::text from public.list_demandes('open', 'any', '{}', 'elodie') $$,
  $$ values (current_setting('test.old')) $$, 'the search ignores accents');
select results_eq($$ select id::text from public.list_demandes('open', 'any', '{}', '555-0199') $$,
  $$ values (current_setting('test.old')) $$, '… and finds a phone by its digits');
select results_eq($$ select id::text from public.list_demandes('all', 'any', '{}', (select reference from public.demandes where id = current_setting('test.closed')::uuid)) $$,
  $$ values (current_setting('test.closed')) $$, '… and the number');
select is((select count(*)::int from public.list_demandes('open', 'any', '{}', null, 0, 2)), 2, 'pages');
select throws_ok($$ select * from public.list_demandes('nope') $$, '22023', null, 'an unknown view is refused');
select results_eq($$ select open, late, no_answer, mine, unassigned, waitlist from public.demandes_counts() $$,
  $$ values (4::bigint, 1::bigint, 1::bigint, 1::bigint, 2::bigint, 0::bigint) $$, 'the counters');

-- =============================================================================
-- « Je m'en occupe »
-- =============================================================================
select lives_ok($$ select public.set_demande_handler(current_setting('test.old')::uuid, true) $$, 'the counselor takes the old one');
select results_eq($$ select handled_by::text, handled_by_name from public.list_demandes() where id = current_setting('test.old')::uuid $$,
  $$ values ('a0000000-0000-0000-0000-000000000004', 'Conseillère A') $$, 'the inbox shows who handles it');
reset role;
update public.demandes set handled_at = now() - interval '3 hours' where id = current_setting('test.old')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select handled_by from public.list_demandes() where id = current_setting('test.old')::uuid), null::uuid,
  'after two hours it is no longer shown');
select lives_ok($$ select public.set_demande_handler(current_setting('test.old')::uuid, false) $$, '« Je laisse »');
reset role;
select is((select handled_by from public.demandes where id = current_setting('test.old')::uuid), null::uuid, 'released');

-- =============================================================================
-- The record
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_demande_note(current_setting('test.called')::uuid, 'Préfère le soir.');
select public.add_demande_task(current_setting('test.called')::uuid, 'callback', now() + interval '2 days', null);
select results_eq($$
  select j->'demande'->>'reference' is not null, j->'client'->>'display_name', jsonb_array_length(j->'events'),
         (select string_agg(x->>'kind', ',' order by x->>'kind') from jsonb_array_elements(j->'events') x),
         j->'events'->0->>'by_name', jsonb_array_length(j->'tasks'), j->'note'->>'internal_note',
         (j->'can'->>'manage')::boolean, j->'demande' ? 'handled_at', j->'demande'->>'promise'
    from (select public.get_demande(current_setting('test.called')::uuid) j) x
$$, $$ values (true, 'Alice Tremblay', 2, 'contact,created', 'Conseillère A', 1, 'Préfère le soir.', true, true, 'met') $$,
  'the bundle: the request, its file, its history with names, its tasks, the note');
select ok(not (public.get_demande(current_setting('test.called')::uuid)->'demande' ? 'reference_seq'), 'internal numbering stays out');
reset role;
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'demandes.notes', false);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_demande(current_setting('test.called')::uuid)->'note', 'null'::jsonb, 'without demandes.notes: no note in the bundle');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.get_demande(current_setting('test.called')::uuid), null::jsonb, 'another clinic: nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_demande(current_setting('test.called')::uuid) $$, '42501', null, 'the professional (no demandes.view) is refused');
select throws_ok($$ select * from public.list_demandes() $$, '42501', null, '… the inbox too');
select throws_ok($$ select public.set_demande_handler(current_setting('test.old')::uuid, true) $$, '42501', null, '… and « Je m''en occupe »');

-- =============================================================================
-- The reference lists
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select x->>'display_name' from jsonb_array_elements(public.get_demandes_reference()->'workers') x order by 1 $$,
  $$ values ('Adjointe A'), ('Admin A'), ('Conseillère A') $$, 'the people who work requests (never the professional)');
select ok((select jsonb_array_length(r->'motifs') > 0 and jsonb_array_length(r->'referral_sources') > 0
                  and jsonb_array_length(r->'profession_titles') > 0 and r->'motifs'->0 ? 'category_name'
             from (select public.get_demandes_reference() r) x),
  'the motifs by category, the referral sources, the titles');
select ok(not (public.get_demandes_reference()::text like '%org_id%'), 'no clinic id in the lists');

select * from finish();
rollback;
