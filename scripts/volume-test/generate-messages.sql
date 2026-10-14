-- Volume test, pass 2 (local only, fictional): the messages around the files. Runs after
-- generate.sql (its temp tables v_ctx, v_pros, v_clients, v_dem are still there):
--   ~18 000 request events, 2 shared mailboxes with 10 000 threads and 30 000 emails over two
--   years (70 % linked to a client file), ~10 000 texts with ~1 900 numbers (linked), and
--   2 000 notices for the admin (half read).
\set ON_ERROR_STOP on
select setseed(0.43);
select pg_catalog.set_config('app.audit_source', 'volume:generate', false);

insert into public.org_modules (org_id, module_key, enabled)
select org, 'communications', true from v_ctx
on conflict (org_id, module_key) do update set enabled = true;

-- Request events: created, two or three contacts, a state change for the matched and closed ones.
insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, contact_channel, contact_outcome, at, by_user)
select d.id, d.org_id, e.kind,
       case when e.kind = 'state_changed' then 'new' end,
       case when e.kind = 'state_changed' then d.state end,
       case when e.kind = 'contact' then (array['phone', 'email', 'sms'])[1 + e.n % 3] end,
       case when e.kind = 'contact' then (array['voicemail', 'no_answer', 'reached', 'message_sent'])[1 + (e.n + d.reference_seq) % 4] end,
       d.received_at + (e.n * interval '7 hours'),
       '11111111-1111-1111-1111-111111111111'
  from public.demandes d
 cross join lateral (values (0, 'created'), (1, 'contact'), (2, 'contact'), (3, 'contact'), (4, 'state_changed')) as e(n, kind)
 where d.org_id = (select org from v_ctx)
   and (e.kind <> 'state_changed' or d.state not in ('new', 'evaluating'))
   and (e.n < 3 or d.reference_seq % 2 = 0 or e.kind = 'state_changed');

-- Two shared mailboxes.
create temp table v_mbox as
select gen_random_uuid() as id, x.n, x.addr
  from (values (1, 'info@volume.test'), (2, 'administration@volume.test')) as x(n, addr);
insert into public.mail_connections (id, org_id, email_address, kind, status, connected_by)
select m.id, c.org, m.addr, 'shared', 'connected', '11111111-1111-1111-1111-111111111111' from v_mbox m, v_ctx c;

-- Threads: 10 000 over two years, 7 in 10 from a client's address.
create temp table v_thr as
select gen_random_uuid() as id, g as n,
       (select id from v_mbox where n = 1 + (g % 7 = 0)::int) as mbox,
       now() - (g * interval '1 hour' * 1.75) as last_at,
       1 + (g % 5) as msgs,
       case when g % 10 < 7 then (select id from v_clients where n = 1 + (g * 13) % 3000) end as client,
       random() as r
  from generate_series(1, 10000) g;
insert into public.mail_threads (id, org_id, connection_id, gmail_thread_id, subject, snippet, last_from_name, last_from_address,
                                 first_message_at, last_message_at, message_count, unread_count, has_attachments, label_ids)
select t.id, c.org, t.mbox, 'thr' || t.n, 'Demande de rendez-vous ' || t.n, 'Bonjour, je vous écris au sujet de…',
       'Correspondant ' || t.n, 'correspondant' || t.n || '@volume.test',
       t.last_at - (t.msgs * interval '1 day'), t.last_at, t.msgs, case when t.r < 0.05 then 1 else 0 end, t.n % 9 = 0,
       case when t.r < 0.9 then array['INBOX'] else array['SENT'] end
  from v_thr t, v_ctx c;
insert into public.mail_messages (org_id, connection_id, thread_id, gmail_message_id, rfc_message_id, from_name, from_address,
                                  to_addresses, subject, snippet, sent_at, label_ids, is_unread, is_inbound, has_attachments, body_text)
select c.org, t.mbox, t.id, 'msg' || t.n || '-' || k, '<' || t.n || '-' || k || '@volume.test>',
       case when k % 2 = 1 then 'Correspondant ' || t.n else 'Clinique' end,
       case when k % 2 = 1 then 'correspondant' || t.n || '@volume.test' else 'info@volume.test' end,
       '[]'::jsonb, 'Demande de rendez-vous ' || t.n, 'Bonjour, je vous écris au sujet de…',
       t.last_at - ((t.msgs - k) * interval '1 day'),
       case when k % 2 = 1 then array['INBOX'] else array['SENT'] end,
       k = t.msgs and t.r < 0.05, k % 2 = 1, false,
       'Bonjour, je vous écris au sujet de mon rendez-vous. Merci.'
  from v_thr t
 cross join v_ctx c
 cross join lateral generate_series(1, t.msgs) k;
insert into public.mail_thread_links (thread_id, org_id, status, client_id, source, linked_at)
select t.id, c.org, case when t.client is null then 'unlinked' else 'linked' end, t.client,
       case when t.client is not null then 'auto' end, case when t.client is not null then t.last_at end
  from v_thr t, v_ctx c
on conflict (thread_id) do update
  set status = excluded.status, client_id = excluded.client_id, source = excluded.source, linked_at = excluded.linked_at;

-- Texts: ~10 000 with ~1 900 numbers (the clients' mobiles), in and out, over two years.
create temp table v_sms as
select g as n, (select mobile_e164 from public.clients cl join v_clients v on v.id = cl.id where v.n = 1 + (g % 2400)) as peer,
       now() - (g * interval '1 hour' * 1.4) as at, g % 3 = 0 as inbound
  from generate_series(1, 12500) g;
insert into public.sms_messages (org_id, direction, peer_e164, kind, body, status, created_at, sent_at, sent_by)
select c.org, case when s.inbound then 'in' else 'out' end, s.peer,
       case when s.inbound then 'inbound' when s.n % 3 = 1 then 'reminder' else 'reply' end,
       'Bonjour, rappel de votre rendez-vous.', case when s.inbound then 'received' else 'sent' end,
       s.at, case when s.inbound then null else s.at end,
       case when not s.inbound and s.n % 3 = 2 then '11111111-1111-1111-1111-111111111111'::uuid end
  from v_sms s, v_ctx c
 where s.peer is not null;
insert into public.sms_thread_links (org_id, peer_e164, status, client_id, source, linked_at)
select c.org, x.peer, 'linked', (select cl.id from public.clients cl where cl.org_id = c.org and cl.mobile_e164 = x.peer limit 1), 'auto', now()
  from (select distinct peer from v_sms where peer is not null) x, v_ctx c
on conflict (org_id, peer_e164) do update
  set status = excluded.status, client_id = excluded.client_id, source = excluded.source, linked_at = excluded.linked_at;

-- The admin's bell: 2 000 notices over two years, half read.
create temp table v_notes as
select gen_random_uuid() as id, g as n, now() - (g * interval '8 hours') as at from generate_series(1, 2000) g;
insert into public.notifications (id, org_id, module_key, kind, importance, title, body, link_path, recipient_permission,
                                  recipient_user_id, created_at)
select v.id, c.org, 'appointments', 'appointments.volume_test', case when v.n % 10 = 0 then 'important' else 'normal' end,
       'Avis de test ' || v.n, 'Un avis du test de volume.', '/agenda', 'appointments.view',
       '11111111-1111-1111-1111-111111111111', v.at
  from v_notes v, v_ctx c;
insert into public.notification_reads (notification_id, user_id, org_id, read_at)
select v.id, '11111111-1111-1111-1111-111111111111', c.org, v.at + interval '1 hour'
  from v_notes v, v_ctx c where v.n % 2 = 0;

select pg_catalog.set_config('app.audit_source', '', false);
analyze;
select (select count(*) from public.demande_events) as events, (select count(*) from public.mail_threads) as threads,
       (select count(*) from public.mail_messages) as emails, (select count(*) from public.sms_messages) as texts,
       (select count(*) from public.sms_thread_links) as numbers, (select count(*) from public.notifications) as notices;
