-- Demandes reads Clients' published `referral_sources_catalog`, never the table (D3c follow-up,
-- migration *_demandes_sources_catalog.sql). The behaviour of the booking page, the booking and the
-- view is covered by 116_demandes_booking; this checks the reads themselves.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(pg_catalog.pg_get_functiondef('public.demandes_booking_page_for_service(uuid)'::regprocedure) like '%public.referral_sources_catalog%',
  'the booking page lists the catalogue');
select ok(pg_catalog.pg_get_functiondef('public.demandes_booking_page_for_service(uuid)'::regprocedure) !~ 'public\.referral_sources[^_]',
  'never the table');
select ok(pg_catalog.pg_get_functiondef('public.book_discovery_call_for_service(uuid, jsonb, bytea)'::regprocedure) like '%public.referral_sources_catalog%',
  'the booking checks the source against the catalogue');
select ok(pg_catalog.pg_get_functiondef('public.book_discovery_call_for_service(uuid, jsonb, bytea)'::regprocedure) !~ 'public\.referral_sources[^_]',
  'never the table');
select ok(pg_catalog.pg_get_viewdef('public.demandes_sources'::regclass) like '%referral_sources_catalog%', 'the view names sources from the catalogue');
select ok(pg_catalog.pg_get_viewdef('public.demandes_sources'::regclass) !~ 'referral_sources[^_]', 'never the table');

select * from finish();
rollback;
