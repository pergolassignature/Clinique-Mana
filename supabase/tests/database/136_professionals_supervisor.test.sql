-- Professionnels for Facturation F2 (migration *_professionals_supervisor.sql): an intern's supervisor.
-- Covers: privileges; professionals.manage; never herself, never a supervised supervisor, never a
-- supervisor supervised; the receipt facts (title, order, licence, the supervisor's); the
-- agreement in force for a dossier.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select function_privs_are('public', 'set_professional_supervisor', array['uuid', 'uuid'], 'authenticated', array['EXECUTE'],
  'set_professional_supervisor: authenticated');
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('professional_receipt_facts', array['uuid', 'uuid[]']),
               ('professional_client_agreement_on', array['uuid', 'uuid', 'uuid', 'date'])) as x(f, a);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status, gender) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Superviseure', 'pro1@a.test', 'active', 'female'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Simon', 'Stagiaire', 'pro2@a.test', 'active', 'male'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Iris', 'Troisième', 'pro3@a.test', 'active', 'female');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p.id, t.id, p.lic, true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid, 'L-1'), ('c0000000-0000-0000-0000-000000000002'::uuid, 'S-2')) as p(id, lic)
  cross join public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai');
insert into public.professional_client_agreements
  (org_id, professional_id, client_label, client_id, duration, professional_amount_cents, client_price_cents, effective_from, note)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'Léa E.', 'd0000000-0000-0000-0000-000000000001',
        50, 6000, 9000, '2026-01-01', 'Tarif réduit');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_supervisor('c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001') $$,
  '42501', 'Permission refusée : professionals.manage', 'the conseillère does not set a supervisor');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_supervisor('c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Un professionnel ne se supervise pas lui-même.', 'never herself');
select lives_ok($$ select public.set_professional_supervisor('c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001') $$,
  'Hélène supervises Simon');
select throws_ok($$ select public.set_professional_supervisor('c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Ce professionnel est lui-même supervisé : choisissez un membre de son ordre qui supervise.', 'an intern supervises no one');
select throws_ok($$ select public.set_professional_supervisor('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Ce professionnel supervise déjà des stagiaires : il ne peut pas être supervisé.', 'a supervisor is not supervised');
reset role;

select results_eq($$ select name, title, licence_number, supervisor_name, supervisor_title, supervisor_licence_number, supervisor_order_acronym is not null
                       from private.professional_receipt_facts('b0000000-0000-0000-0000-00000000000a', array['c0000000-0000-0000-0000-000000000002'::uuid]) $$,
  $$ select 'Simon Stagiaire'::text, private.profession_title_label(t.name, t.name_feminine, t.name_masculine, 'male'), 'S-2'::text,
            'Hélène Superviseure'::text, private.profession_title_label(t.name, t.name_feminine, t.name_masculine, 'female'), 'L-1'::text, true
       from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue' $$,
  'an intern''s receipt facts name her supervisor, title and licence');
select results_eq($$ select supervisor_id is null from private.professional_receipt_facts('b0000000-0000-0000-0000-00000000000a', array['c0000000-0000-0000-0000-000000000001'::uuid]) $$,
  $$ values (true) $$, 'a supervisor has none');
select results_eq($$ select client_price_cents, note from private.professional_client_agreement_on('b0000000-0000-0000-0000-00000000000a',
                       'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '2026-10-05') $$,
  $$ values (9000, 'Tarif réduit'::text) $$, 'the agreement in force for the dossier');
select is((select count(*)::int from private.professional_client_agreement_on('b0000000-0000-0000-0000-00000000000a',
             'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', '2026-10-05')), 0, '… none with another professional');

set local role authenticated;
select lives_ok($$ select public.set_professional_supervisor('c0000000-0000-0000-0000-000000000002', null) $$, 'the supervisor removed');
reset role;
select is((select supervisor_professional_id from public.professionals where id = 'c0000000-0000-0000-0000-000000000002'), null, '… none');

select * from finish();
rollback;
