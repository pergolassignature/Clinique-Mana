-- The contact's « Prénom » and « Nom » (migration *_demandes_contact_first_last.sql, D-56).
-- Covers: the columns and their checks (lengths, tidy, a last name needs a first name); the
-- backfill's rule (first word / the rest, contact_name untouched); contact_name maintained by the
-- trigger (parts written → « Prénom Nom », contact_name alone → split, untouched otherwise);
-- create_demande / update_demande with the parts; get_demande and list_demandes (the person, the
-- search) return the right names; the rule « someone to call back » unchanged; the journal
-- redacts both parts; the proposal's email greets by the first name; the booking writes the parts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select has_column('public', 'demandes', 'contact_first_name', 'contact_first_name');
select has_column('public', 'demandes', 'contact_last_name', 'contact_last_name');
select has_column('public', 'demandes', 'contact_name', 'contact_name is kept');

-- =============================================================================
-- Fixtures (as postgres): org A with a counselor; org B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'u1@cfl.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@cfl.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('clients'), ('demandes')) m(key);

-- =============================================================================
-- The backfill's rule: rows written before the trigger existed (simulated with it off)
-- =============================================================================
alter table public.demandes disable trigger demandes_contact_names;
insert into public.demandes (id, org_id, contact_name) values
  ('e0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000a', 'Marie-Ève Tremblay Roy'),
  ('e0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-00000000000a', 'Bob');
update public.demandes d
   set contact_first_name = nullif(pg_catalog.btrim(pg_catalog.left(s.parts[1], 100)), ''),
       contact_last_name = nullif(pg_catalog.btrim(pg_catalog.left(s.parts[2], 100)), '')
  from (select x.id, pg_catalog.regexp_match(pg_catalog.btrim(x.contact_name), '^(\S+)\s*(.*)$') as parts
          from public.demandes x where x.contact_name is not null) s
 where d.id = s.id and d.id in ('e0000000-0000-0000-0000-0000000000b1', 'e0000000-0000-0000-0000-0000000000b2');
alter table public.demandes enable trigger demandes_contact_names;
select ok((select prosrc from pg_proc where proname = 'demandes_contact_names') is not null, 'the trigger function exists');
select results_eq($$ select contact_first_name, contact_last_name, contact_name from public.demandes
                      where id in ('e0000000-0000-0000-0000-0000000000b1', 'e0000000-0000-0000-0000-0000000000b2') order by id $$,
  $$ values ('Marie-Ève'::text, 'Tremblay Roy'::text, 'Marie-Ève Tremblay Roy'::text), ('Bob', null, 'Bob') $$,
  'backfill: the first word, then the rest (null for one word); contact_name untouched');

-- =============================================================================
-- contact_name maintained
-- =============================================================================
insert into public.demandes (id, org_id, contact_first_name, contact_last_name) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', ' Marie Ève ', 'Tremblay');
select is((select contact_name from public.demandes where id = 'e0000000-0000-0000-0000-000000000001'), 'Marie Ève Tremblay',
  'the parts written (trimmed) → « Prénom Nom »');
insert into public.demandes (id, org_id, contact_name) values
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Jean Dupont Lavoie');
select results_eq($$ select contact_first_name, contact_last_name from public.demandes where id = 'e0000000-0000-0000-0000-000000000002' $$,
  $$ values ('Jean'::text, 'Dupont Lavoie'::text) $$, 'contact_name alone (an old writer) → split');
update public.demandes set contact_name = 'Paul' where id = 'e0000000-0000-0000-0000-000000000002';
select results_eq($$ select contact_first_name, contact_last_name, contact_name from public.demandes where id = 'e0000000-0000-0000-0000-000000000002' $$,
  $$ values ('Paul'::text, null::text, 'Paul'::text) $$, 'an update of contact_name alone → split again');
update public.demandes set contact_last_name = 'Gagnon' where id = 'e0000000-0000-0000-0000-000000000002';
select is((select contact_name from public.demandes where id = 'e0000000-0000-0000-0000-000000000002'), 'Paul Gagnon',
  'a part changed → contact_name follows');
update public.demandes set contact_first_name = 'Pierre', contact_name = 'Ignoré Ignoré' where id = 'e0000000-0000-0000-0000-000000000002';
select is((select contact_name from public.demandes where id = 'e0000000-0000-0000-0000-000000000002'), 'Pierre Gagnon',
  'both written: the parts win');
update public.demandes set is_urgent = true where id = 'e0000000-0000-0000-0000-000000000002';
select results_eq($$ select contact_first_name, contact_last_name, contact_name from public.demandes where id = 'e0000000-0000-0000-0000-000000000002' $$,
  $$ values ('Pierre'::text, 'Gagnon'::text, 'Pierre Gagnon'::text) $$, 'another update leaves the three as they are');

-- =============================================================================
-- Checks
-- =============================================================================
select throws_ok($$ insert into public.demandes (org_id, contact_last_name, contact_phone_e164)
                    values ('b0000000-0000-0000-0000-00000000000a', 'Seul', '+15145550100') $$,
  '23514', null, 'a last name needs a first name');
select throws_ok($$ insert into public.demandes (org_id, contact_first_name) values ('b0000000-0000-0000-0000-00000000000a', repeat('a', 101)) $$,
  '23514', null, 'a first name of 101 characters is refused (100, like Clients)');
select lives_ok($$ insert into public.demandes (org_id, contact_first_name, contact_last_name)
                   values ('b0000000-0000-0000-0000-00000000000a', repeat('a', 100), repeat('b', 100)) $$,
  '100 + 100: the full name fits (201)');
select throws_ok($$ insert into public.demandes (org_id, contact_first_name) values ('b0000000-0000-0000-0000-00000000000a', E'Ma​rie') $$,
  '23514', null, 'a first name must be tidy text');

-- =============================================================================
-- The RPCs, as the counselor
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d', public.create_demande('{"contact_first_name": "Élodie", "contact_last_name": "Bélanger-Roy", "channel": "phone"}')::text, true);
select results_eq($$ select d -> 'demande' ->> 'contact_first_name', d -> 'demande' ->> 'contact_last_name', d -> 'demande' ->> 'contact_name'
                       from (select public.get_demande(current_setting('test.d')::uuid) as d) x $$,
  $$ values ('Élodie'::text, 'Bélanger-Roy'::text, 'Élodie Bélanger-Roy'::text) $$, 'create_demande: the parts; get_demande returns the three');
select is((select person_name from public.list_demandes() where id = current_setting('test.d')::uuid), 'Élodie Bélanger-Roy',
  'the inbox shows « Prénom Nom »');
select is((select count(*)::int from public.list_demandes(p_search => 'belanger') where id = current_setting('test.d')::uuid), 1,
  'the inbox''s search finds the last name (accents ignored)');
select set_config('test.only_first', public.create_demande('{"contact_first_name": "Lina", "channel": "phone"}')::text, true);
select is((select public.get_demande(current_setting('test.only_first')::uuid) -> 'demande' ->> 'contact_name'), 'Lina',
  'a first name alone is enough');
select lives_ok($$ select public.update_demande(current_setting('test.d')::uuid, '{"contact_first_name": "Élo", "contact_last_name": null}') $$,
  'update_demande: the parts');
select results_eq($$ select d -> 'demande' ->> 'contact_first_name', d -> 'demande' ->> 'contact_last_name', d -> 'demande' ->> 'contact_name'
                       from (select public.get_demande(current_setting('test.d')::uuid) as d) x $$,
  $$ values ('Élo'::text, null::text, 'Élo'::text) $$, '… the full name follows');
select throws_ok($$ select public.create_demande('{"channel": "phone"}') $$, 'P0001',
  'Indiquez comment joindre la personne : un dossier, un nom, un courriel ou un téléphone.',
  'still someone to call back');
select throws_ok($$ select public.create_demande('{"contact_first_name": 3}') $$, '22023', null, 'the parts are strings');
reset role;

-- =============================================================================
-- The journal, the emails, the booking
-- =============================================================================
select results_eq($$ select changed_fields ->> 'contact_first_name', changed_fields ->> 'contact_last_name', changed_fields ->> 'contact_name'
                       from public.audit_log where table_name = 'demandes' and record_id = current_setting('test.d') and action = 'insert' $$,
  $$ values ('[redacted]'::text, '[redacted]'::text, '[redacted]'::text) $$, 'the journal redacts both parts and the full name');
update public.demandes set contact_email = 'me@cfl.test' where id = 'e0000000-0000-0000-0000-000000000001';
select is((select first_name from private.demandes_recipient('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001')),
  'Marie Ève', 'the proposal''s email greets by the first name as typed (a two-word first name stays whole)');
select ok((select p.prosrc like '%''contact_first_name'', v_first%' and p.prosrc like '%''contact_last_name'', v_last%'
                  and p.prosrc not like '%''contact_name''%'
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'book_discovery_call_for_service'),
  'the booking page writes the first and last names it asks, never one joined name');
select ok((select p.prosrc like '%contact_first_name%' from pg_proc p
            where p.pronamespace = 'private'::regnamespace and p.proname = 'waitlist_email_of'),
  'the waiting list''s email reads the first name');

select * from finish();
rollback;
