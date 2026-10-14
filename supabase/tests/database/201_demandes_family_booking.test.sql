-- Demandes: a proposal books every file of a family (migration *_demandes_family_booking.sql, R-79).
-- Covers: the request's file first, then the participants' other files, up to Rendez-vous'
-- maximum (six); seven refused in plain words; a couple service books exactly two (three refused);
-- the helper granted to no role.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname = 'demandes_booking_clients'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helper is granted to no role');

insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.clients (id, org_id, first_name, last_name)
select ('d0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'Client' || n, 'Famille'
  from generate_series(1, 7) n;
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, contact_name, client_id)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-9101', 2026, 9101, 'Famille',
        'd0000000-0000-0000-0000-000000000001');
-- The request's file is a participant too (the main person); two children with a file, one without.
insert into public.demande_participants (demande_id, org_id, client_id, display_name, relationship, is_primary) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', null, 'self', true),
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', null, 'child', false),
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', null, 'child', false),
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Bébé', 'child', false);

select is((private.demandes_booking_clients('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', false))[1]::text,
  'd0000000-0000-0000-0000-000000000001', 'the request''s file first (the person seen)');
select is((select array_agg(x::text order by x) from pg_catalog.unnest(
             private.demandes_booking_clients('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', false)) x),
  array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003'],
  'three files: all booked together (a participant without a file is not booked)');
select throws_ok($$ select private.demandes_booking_clients('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', true) $$,
  'P0001', 'Ce service se réserve pour deux personnes, et cette demande en a 3 avec un dossier : choisissez un autre service, ou réservez ce rendez-vous dans l''agenda.',
  'a couple service books exactly two: three refused in plain words');

insert into public.demande_participants (demande_id, org_id, client_id, relationship)
select 'e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', ('d0000000-0000-0000-0000-00000000000' || n)::uuid, 'child'
  from generate_series(4, 6) n;
select is(pg_catalog.cardinality(private.demandes_booking_clients('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', false)),
  6, 'six files: the maximum, booked');
insert into public.demande_participants (demande_id, org_id, client_id, relationship)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000007', 'child');
select throws_ok($$ select private.demandes_booking_clients('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', false) $$,
  'P0001', 'Un rendez-vous compte 6 clients au plus, et cette demande en a 7 avec un dossier : réservez ce rendez-vous dans l''agenda.',
  'seven: refused in plain words');
select is(private.appointments_max_clients(), 6, 'the maximum is Rendez-vous'' published one');

select * from finish();
rollback;
