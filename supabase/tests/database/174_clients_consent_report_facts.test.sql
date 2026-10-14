-- Clients: the consents' facts for Rapports (migration *_clients_consent_report_facts.sql, CC-19).
-- Covers: no role executes them; one state per active file and active consent, as the record tab
-- says (signed, pending, overdue, withdrawn, none), never an archived, anonymised or merged file;
-- the signatures (app with the first send, import) and the withdrawals of a period, its bounds.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select function_privs_are('private', f, a, r, array[]::text[], f || ': not ' || r)
  from (values ('client_consent_state_facts', array['uuid']),
               ('client_consent_event_facts', array['uuid', 'timestamp with time zone', 'timestamp with time zone'])) as x(f, a)
 cross join (values ('authenticated'), ('service_role')) as y(r);

insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'p1@a.test', 'active');
-- Kim (pro 1), Lou, Sam, Ana (archived), Zed (another clinic).
insert into public.clients (id, org_id, first_name, last_name, primary_professional_id, archived_at) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Kim', 'Un', 'c0000000-0000-0000-0000-000000000001', null),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Lou', 'Deux', null, null),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Sam', 'Trois', null, null),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Ana', 'Quatre', null, now()),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Zed', 'Autre', null, null);
create temporary table v as
select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr';
insert into public.client_consent_requests (id, org_id, client_id, consent_key, language, template_version_id, state, signed_at, due_at, created_at) values
  -- Kim's general: sent on Sept. 1, signed on Sept. 5. Lou's: pending, overdue.
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'general', 'fr', (select id from v), 'signed', '2026-09-05 12:00 America/Toronto', null, '2026-09-01 12:00 America/Toronto'),
  ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'general', 'fr', (select id from v), 'pending', null, now() - interval '1 day', now() - interval '10 days');
insert into public.client_consents (org_id, client_id, consent_key, language, template_version_id, version_label, signed_at, signed_by, request_id, source, withdrawn_at) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'general', 'fr', (select id from v), 'v1', '2026-09-05 12:00 America/Toronto', '[]', 'e1000000-0000-0000-0000-000000000001', 'app', null),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'coaching', 'fr', (select id from v), 'v1', '2026-08-20 12:00 America/Toronto', '[]', null, 'app', '2026-09-30 23:30 America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'general', 'fr', null, 'GOrendezvous', '2026-09-10 12:00 America/Toronto', '[]', null, 'import', null),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004', 'general', 'fr', null, 'GOrendezvous', '2026-09-11 12:00 America/Toronto', '[]', null, 'import', null);

select results_eq($$ select client_id, primary_professional_id, state from private.client_consent_state_facts('b0000000-0000-0000-0000-00000000000a')
                      where consent_key = 'general' order by client_id $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 'signed'::text),
            ('d0000000-0000-0000-0000-000000000002', null, 'overdue'), ('d0000000-0000-0000-0000-000000000003', null, 'signed') $$,
  'the general consent: each active file''s state as its tab says (never the archived one)');
select is((select state from private.client_consent_state_facts('b0000000-0000-0000-0000-00000000000a')
            where client_id = 'd0000000-0000-0000-0000-000000000001' and consent_key = 'coaching'), 'withdrawn', 'a withdrawn consent');
select is((select state from private.client_consent_state_facts('b0000000-0000-0000-0000-00000000000a')
            where client_id = 'd0000000-0000-0000-0000-000000000002' and consent_key = 'waitlist'), 'none', 'never asked: none');
select is((select count(distinct client_id)::int from private.client_consent_state_facts('b0000000-0000-0000-0000-00000000000a')), 3,
  'the active files of the clinic only');
select is((select count(distinct consent_key)::int from private.client_consent_state_facts('b0000000-0000-0000-0000-00000000000a')), 7,
  'every active consent');

select results_eq($$ select kind, consent_key, source, requested_at is not null
                       from private.client_consent_event_facts('b0000000-0000-0000-0000-00000000000a',
                              '2026-09-01 00:00 America/Toronto', '2026-10-01 00:00 America/Toronto')
                      order by at $$,
  $$ values ('signed'::text, 'general'::text, 'app'::text, true), ('signed', 'general', 'import', false),
            ('signed', 'general', 'import', false), ('withdrawn', 'coaching', 'app', false) $$,
  'September: the signatures (the app''s with its first send, the imported ones) and the withdrawal');
select is((select count(*)::int from private.client_consent_event_facts('b0000000-0000-0000-0000-00000000000a',
             '2026-09-01 00:00 America/Toronto', '2026-09-30 23:00 America/Toronto')), 3, 'the period''s end excluded');

select * from finish();
rollback;
