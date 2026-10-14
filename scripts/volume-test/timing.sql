-- Volume test timings: the hot RPCs as the seed's admin, each run 3 times (\timing); the inner
-- statements over 50 ms are logged with their plans (auto_explain) for the slow ones.
\set ON_ERROR_STOP on
load 'auto_explain';
set auto_explain.log_min_duration = 50;
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
set auto_explain.log_format = 'text';
select (date_trunc('week', now() at time zone 'America/Toronto'))::date as monday \gset
select (now() at time zone 'America/Toronto')::date as today \gset
select id as pro from public.professionals where last_name = 'Volume7' \gset
select id as client from public.clients where last_name = 'Essai7' \gset
select id as service from public.services where org_id = '00000000-0000-0000-0000-000000000001' and code = 10150 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
\timing on

\echo '== agenda week, every professional'
select count(*) from public.list_agenda((:'monday'::date + time '00:00') at time zone 'America/Toronto', (:'monday'::date + 7 + time '00:00') at time zone 'America/Toronto', null);
select count(*) from public.list_agenda((:'monday'::date + time '00:00') at time zone 'America/Toronto', (:'monday'::date + 7 + time '00:00') at time zone 'America/Toronto', null);
select count(*) from public.list_agenda((:'monday'::date + time '00:00') at time zone 'America/Toronto', (:'monday'::date + 7 + time '00:00') at time zone 'America/Toronto', null);
\echo '== agenda week, one professional'
select count(*) from public.list_agenda((:'monday'::date + time '00:00') at time zone 'America/Toronto', (:'monday'::date + 7 + time '00:00') at time zone 'America/Toronto', array[:'pro'::uuid]);
select count(*) from public.list_agenda((:'monday'::date + time '00:00') at time zone 'America/Toronto', (:'monday'::date + 7 + time '00:00') at time zone 'America/Toronto', array[:'pro'::uuid]);
\echo '== agenda month (42 days), every professional'
select count(*) from public.list_agenda((:'monday'::date - 7 + time '00:00') at time zone 'America/Toronto', (:'monday'::date + 35 + time '00:00') at time zone 'America/Toronto', null);
select count(*) from public.list_agenda((:'monday'::date - 7 + time '00:00') at time zone 'America/Toronto', (:'monday'::date + 35 + time '00:00') at time zone 'America/Toronto', null);
\echo '== open slots, 4 weeks, one professional'
select count(*) from public.get_open_slots(:'pro'::uuid, :'service'::uuid, :'today'::date, :'today'::date + 28);
select count(*) from public.get_open_slots(:'pro'::uuid, :'service'::uuid, :'today'::date, :'today'::date + 28);
\echo '== clients list: first page, by name'
select count(*) from public.list_clients();
select count(*) from public.list_clients();
\echo '== clients list: search'
select count(*) from public.list_clients(p_query => 'essai12');
select count(*) from public.list_clients(p_query => 'essai12');
\echo '== clients list: one professional'
select count(*) from public.list_clients(p_professional_id => :'pro'::uuid);
\echo '== clients list: by last visit, most recent'
select count(*) from public.list_clients(p_sort => 'visit_recent');
select count(*) from public.list_clients(p_sort => 'visit_recent');
\echo '== clients list: no visit for 6 months'
select count(*) from public.list_clients(p_last_visit => 'over_180');
\echo '== client record and billing'
select length(public.get_client_summary(:'client'::uuid)::text);
select length(public.get_client_billing(:'client'::uuid)::text);
select length(public.get_client_billing(:'client'::uuid)::text);
\echo '== demandes inbox, open'
select count(*) from public.list_demandes();
select count(*) from public.list_demandes();
\echo '== demandes inbox, all, search'
select count(*) from public.list_demandes(p_view => 'all', p_search => 'essai 12');
select count(*) from public.list_demandes(p_view => 'all', p_search => 'essai 12');
\echo '== waiting list'
select count(*) from public.list_waitlist();
\echo '== morning queue'
select count(*) from public.list_morning_queue();
select count(*) from public.list_morning_queue();
\echo '== invoices list, first page'
select count(*) from public.list_invoices(null, null, null, 50);
select count(*) from public.list_invoices(null, null, null, 50);
\echo '== overdue invoices'
select count(*) from public.list_overdue_invoices();
\echo '== reports over a year'
select length(public.report_revenue('invoice', :'today'::date - 365, :'today'::date)::text);
select length(public.report_revenue('invoice', :'today'::date - 365, :'today'::date)::text);
select length(public.report_revenue('service', :'today'::date - 365, :'today'::date)::text);
select length(public.report_revenue('payment', :'today'::date - 365, :'today'::date)::text);
select length(public.report_cancellations(:'today'::date - 365, :'today'::date)::text);
select length(public.report_clients_to_follow_up(:'today'::date - 365, :'today'::date)::text);
select length(public.report_demandes(:'today'::date - 365, :'today'::date)::text);
\echo '== ⌘K search'
select count(*) from public.search_clients('ess', 8);
select count(*) from public.search_clients('essai 2', 8);
select count(*) from public.search_clients('essai 2', 8);
select count(*) from public.search_professionals('vol', 8);
