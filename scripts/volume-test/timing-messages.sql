-- Volume test, pass 2: the messages' screens as the seed's admin, each run 2 or 3 times.
\set ON_ERROR_STOP on
load 'auto_explain';
set auto_explain.log_min_duration = 50;
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
select (now() at time zone 'America/Toronto')::date as today \gset
select id as mbox from public.mail_connections where email_address = 'info@volume.test' \gset
select client_id as mclient from public.mail_thread_links where status = 'linked' group by client_id order by count(*) desc limit 1 \gset
select l.client_id as sclient, l.peer_e164 as phone from public.sms_thread_links l where l.status = 'linked'
 order by (select count(*) from public.sms_messages m where m.peer_e164 = l.peer_e164) desc limit 1 \gset
select id as thread from public.mail_threads where connection_id = :'mbox' order by last_message_at desc limit 1 \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
\timing on

\echo '== Courriels, inbox, first page'
select count(*) from public.list_mail_threads(:'mbox'::uuid);
select count(*) from public.list_mail_threads(:'mbox'::uuid);
select count(*) from public.list_mail_threads(:'mbox'::uuid);
\echo '== Courriels, all, search'
select count(*) from public.list_mail_threads(:'mbox'::uuid, 'all', null, 'rendez-vous 12');
select count(*) from public.list_mail_threads(:'mbox'::uuid, 'all', null, 'rendez-vous 12');
\echo '== Courriels, « À rattacher »'
select count(*) from public.list_mail_threads(:'mbox'::uuid, 'to_link');
select count(*) from public.list_mail_threads(:'mbox'::uuid, 'to_link');
\echo '== Courriels, one thread'
select length(public.get_mail_thread(:'thread'::uuid)::text);
select length(public.get_mail_thread(:'thread'::uuid)::text);
\echo '== mailboxes list'
select count(*) from public.list_mail_connections();
\echo '== client « Courriels » tab'
select count(*) from public.list_client_mail_threads(:'mclient'::uuid);
select count(*) from public.list_client_mail_threads(:'mclient'::uuid);
\echo '== Textos, conversations'
select count(*) from public.list_sms_conversations();
select count(*) from public.list_sms_conversations();
\echo '== Textos, « À rattacher »'
select count(*) from public.list_sms_conversations('to_link');
\echo '== Textos, search'
select count(*) from public.list_sms_conversations('all', 'essai 12');
select count(*) from public.list_sms_conversations('all', 'essai 12');
\echo '== Textos, one conversation'
select count(*) from public.list_sms_thread(:'phone');
select count(*) from public.list_sms_thread(:'phone');
\echo '== client « Textos » tab'
select count(*) from public.list_client_sms(:'sclient'::uuid);
select count(*) from public.list_client_sms(:'sclient'::uuid);
\echo '== bell count'
select public.count_my_unread_notifications();
select public.count_my_unread_notifications();
select public.count_my_unread_notifications();
\echo '== bell list'
select count(*) from public.list_my_notifications();
select count(*) from public.list_my_notifications();
\echo '== demandes inbox, open (with events)'
select count(*) from public.list_demandes();
select count(*) from public.list_demandes();
\echo '== demandes inbox, all, search (with events)'
select count(*) from public.list_demandes(p_view => 'all', p_search => 'essai 12');
select count(*) from public.list_demandes(p_view => 'all', p_search => 'essai 12');
\echo '== demandes inbox, all, no search'
select count(*) from public.list_demandes(p_view => 'all');
select count(*) from public.list_demandes(p_view => 'all');
\echo '== demandes indicators over a year'
select length(public.report_demandes(:'today'::date - 365, :'today'::date)::text);
select length(public.report_demandes(:'today'::date - 365, :'today'::date)::text);
