-- Demandes: the inbox reads its page first (migration *_demandes_inbox_page_first.sql). On a
-- volume-shaped set (600 requests over 15 months, every state, files, contacts, tasks, urgent,
-- assigned or not, accents, phones), `list_demandes` answers exactly what the full read answered
-- (the previous body, kept here as the reference) for every view, sort, counselor filter, flag,
-- search and page.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'list_demandes'), 1,
  'list_demandes keeps one signature');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'list_demandes'
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
          or not ('search_path=""' = any (p.proconfig)))
$$, 'list_demandes: SECURITY DEFINER, search_path empty, authenticated, not anon');

-- The clinic, a counselor (the caller) and a colleague.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a7000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@pf.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 2) n;
insert into public.organizations (id, name) values ('b7000000-0000-0000-0000-00000000000a', 'Org PF');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-00000000000a', 'Conseillère PF', 'u1@pf.test', 'active'),
  ('a7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-00000000000a', 'Collègue PF', 'u2@pf.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b7000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('demandes')) y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-00000000000a', 'Hélène', 'Psy', 'p1@pf.test', 'active');
insert into public.clients (id, org_id, first_name, last_name, email, mobile_e164)
select ('d7000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'b7000000-0000-0000-0000-00000000000a',
       (array['Élodie', 'Bruno', 'Chloé', 'Zoë'])[1 + n % 4], 'Essai' || n, 'client' || n || '@pf.test',
       '+1514555' || lpad((1000 + n)::text, 4, '0')
  from generate_series(1, 200) n;

-- 600 requests, one every ~18 hours back from now (weekends included), every state.
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, received_at, channel, contact_name, contact_email,
                             contact_phone_e164, state, closed_reason, closed_at, matched_professional_id, matched_at, client_id,
                             is_urgent, assigned_to, next_contact_at, beneficiary)
select ('e7000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'b7000000-0000-0000-0000-00000000000a',
       'DEM-2026-' || lpad(n::text, 4, '0'), 2026, n,
       now() - n * interval '18 hours 7 minutes',
       (array['phone', 'email', 'web_form', 'booking_page'])[1 + n % 4],
       case when n % 5 = 0 then null else 'Personne Essai ' || n || case when n % 7 = 0 then ' Gélinas' else '' end end,
       case when n % 3 = 0 then null else 'demande' || n || '@pf.test' end,
       case when n % 4 = 0 then null else '+1438555' || lpad((2000 + n)::text, 4, '0') end,
       s.state,
       case when s.state = 'closed' then 'no_answer' end,
       case when s.state = 'closed' then now() - n * interval '18 hours' + interval '7 days' end,
       case when s.state = 'matched' then 'c7000000-0000-0000-0000-000000000001'::uuid end,
       case when s.state = 'matched' then now() - n * interval '18 hours' + interval '3 days' end,
       case when n % 3 <> 1 then ('d7000000-0000-0000-0000-' || lpad((1 + n % 200)::text, 12, '0'))::uuid end,
       n % 11 = 0,
       case n % 3 when 0 then 'a7000000-0000-0000-0000-000000000001'::uuid when 1 then 'a7000000-0000-0000-0000-000000000002'::uuid end,
       case when n % 6 = 0 then now() - interval '2 hours' when n % 6 = 1 then now() + interval '1 day' end,
       'self'
  from generate_series(1, 600) n
 cross join lateral (select case when n <= 60 then (array['new', 'evaluating', 'accepted', 'proposed'])[1 + n % 4]
                                 when n % 10 < 6 then 'matched' when n % 10 = 6 then 'waitlist' else 'closed' end as state) s;

-- Contacts (with or without reaching the person) for two requests in three; open tasks, some due.
insert into public.demande_events (demande_id, org_id, kind, contact_channel, contact_outcome, at)
select d.id, d.org_id, 'contact', (array['phone', 'email', 'sms'])[1 + e.n % 3],
       (array['voicemail', 'no_answer', 'reached', 'message_sent'])[1 + (e.n + d.reference_seq) % 4],
       d.received_at + e.n * interval '9 hours'
  from public.demandes d
 cross join generate_series(1, 2) e(n)
 where d.org_id = 'b7000000-0000-0000-0000-00000000000a' and d.reference_seq % 3 <> 0 and (e.n = 1 or d.reference_seq % 2 = 0);
insert into public.demande_tasks (demande_id, org_id, kind, due_at)
select d.id, d.org_id, 'callback', case when d.reference_seq % 2 = 0 then now() - interval '1 hour' else now() + interval '2 days' end
  from public.demandes d
 where d.org_id = 'b7000000-0000-0000-0000-00000000000a' and d.reference_seq % 4 = 0 and d.state not in ('matched', 'closed');

-- The previous body: every request's row (and delay) first, then filter, sort, page.
create function pg_temp.ref_list(p_view text, p_assigned text, p_flags text[], p_search text, p_offset int, p_limit int, p_sort text)
returns setof text
language plpgsql
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_me uuid := auth.uid();
  v_search text := nullif(private.demandes_fold(pg_catalog.btrim(pg_catalog.left(p_search, 100))), '');
  v_digits text := nullif(pg_catalog.regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
  v_sort text := coalesce(p_sort, 'priority');
begin
  return query
    select row(r.id, r.reference, r.received_at, r.channel, r.state, r.is_urgent, r.client_id, r.client_number, r.person_name,
           r.beneficiary, r.assigned_to, r.assigned_name, r.contact_attempts, r.last_contact_at, r.last_outcome,
           r.next_contact_at, r.first_contact_at, r.waiting_hours, r.promise, r.no_answer,
           r.handled_by, r.handled_by_name, r.handled_at, r.open_tasks, r.next_task_due, r.motif_count)::text
      from private.demandes_inbox_rows(v_org,
             case p_view when 'open' then array['new', 'evaluating', 'accepted', 'proposed'] when 'all' then null else array[p_view] end) r
     where case p_assigned when 'me' then r.assigned_to = v_me when 'none' then r.assigned_to is null else true end
       and (not ('late' = any (p_flags)) or r.promise = 'late')
       and (not ('no_answer' = any (p_flags)) or r.no_answer)
       and (not ('urgent' = any (p_flags)) or r.is_urgent)
       and (not ('due' = any (p_flags)) or r.next_contact_at <= pg_catalog.now() or r.next_task_due <= pg_catalog.now())
       and (v_search is null or pg_catalog.strpos(r.search_text, v_search) > 0
            or (pg_catalog.length(v_digits) >= 4 and exists (select 1 from unnest(r.phone_digits) p where pg_catalog.strpos(p, v_digits) > 0)))
     order by case when v_sort = 'priority' and p_view = 'open' then r.is_urgent end desc nulls last,
              case when v_sort = 'priority' and p_view = 'open' then r.promise = 'late' end desc nulls last,
              case when v_sort = 'priority' and p_view = 'open' then r.received_at end asc,
              case when v_sort = 'received_asc' then r.received_at end asc,
              case when v_sort = 'waiting_desc' then r.waiting_hours end desc nulls last,
              case when v_sort = 'state' then pg_catalog.array_position(
                     array['new', 'evaluating', 'accepted', 'proposed', 'waitlist', 'matched', 'closed'], r.state) end asc,
              r.received_at desc, r.id
     offset greatest(coalesce(p_offset, 0), 0)
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- Both answers, as text rows in their order.
create function pg_temp.new_list(p_view text, p_assigned text, p_flags text[], p_search text, p_offset int, p_limit int, p_sort text)
returns setof text
language sql
as $$
  select row(r.id, r.reference, r.received_at, r.channel, r.state, r.is_urgent, r.client_id, r.client_number, r.person_name,
             r.beneficiary, r.assigned_to, r.assigned_name, r.contact_attempts, r.last_contact_at, r.last_outcome,
             r.next_contact_at, r.first_contact_at, r.waiting_hours, r.promise, r.no_answer,
             r.handled_by, r.handled_by_name, r.handled_at, r.open_tasks, r.next_task_due, r.motif_count)::text
    from public.list_demandes(p_view, p_assigned, p_flags, p_search, p_offset, p_limit, p_sort) r
$$;

-- The cases that read the page first (no « En retard », not « Attente la plus longue », not the open
-- view's priority order); the others keep the full read, checked below one by one.
create temp table combos as
select v.view, a.assigned, f.flags, s.search, so.sort
  from (values ('all'), ('open'), ('matched'), ('waitlist'), ('closed')) v(view)
 cross join (values ('any'), ('me'), ('none')) a(assigned)
 cross join (values ('{}'::text[]), ('{urgent}'), ('{no_answer}'), ('{due}')) f(flags)
 cross join (values (null::text), ('essai 1'), ('ELODIE'), ('gelinas'), ('5551')) s(search)
 cross join (values ('priority'), ('received_desc'), ('received_asc'), ('state')) so(sort)
 where not (v.view = 'open' and so.sort = 'priority');

select set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from combos), 1140, 'the page-first cases: 19 views and sorts × 3 counselor filters × 4 flag sets × 5 searches');
select ok((select count(*) from pg_temp.new_list('all', 'any', '{}', null, 0, 100, 'priority')) = 100
          and (select count(*) from pg_temp.new_list('all', 'any', '{}', 'essai 1', 0, 100, 'priority')) > 10
          and (select count(*) from pg_temp.new_list('all', 'any', '{no_answer}', null, 0, 100, 'state')) > 10
          and (select count(*) from pg_temp.new_list('closed', 'me', '{due}', null, 0, 100, 'received_asc')) >= 0
          and (select count(*) from pg_temp.new_list('all', 'none', '{urgent}', '5551', 0, 100, 'received_desc')) > 0,
  'the set is not trivial: full pages, searches and flags that keep rows');
select is_empty($$
  select c.* from combos c
   where array(select pg_temp.new_list(c.view, c.assigned, c.flags, c.search, 0, 50, c.sort))
         || array(select pg_temp.new_list(c.view, c.assigned, c.flags, c.search, 50, 50, c.sort))
         is distinct from array(select pg_temp.ref_list(c.view, c.assigned, c.flags, c.search, 0, 100, c.sort))
$$, 'every case, two pages: the same rows, in the same order, with the same values (delays, promise, tasks, counts)');
select is_empty($$
  select * from (values ('open', 'any', '{}'::text[], null::text, 'priority'), ('open', 'me', '{late}', null, 'priority'),
                        ('all', 'any', '{late}', null, 'received_desc'), ('all', 'any', '{}', null, 'waiting_desc'),
                        ('open', 'none', '{no_answer}', 'essai', 'waiting_desc')) c(view, assigned, flags, search, sort)
   where array(select pg_temp.new_list(c.view, c.assigned, c.flags, c.search, 0, 100, c.sort))
         is distinct from array(select pg_temp.ref_list(c.view, c.assigned, c.flags, c.search, 0, 100, c.sort))
$$, 'the full-read cases (« En retard », the longest wait, the open view''s priority): unchanged');
select results_eq($$ select * from pg_temp.new_list('all', 'any', '{}', null, 0, 5, 'priority') $$,
                  $$ select * from pg_temp.ref_list('all', 'any', '{}', null, 0, 5, 'priority') $$,
  'all, newest first: the first page, row by row');
select results_eq($$ select * from pg_temp.new_list('all', 'any', '{}', 'élodie', 50, 20, 'state') $$,
                  $$ select * from pg_temp.ref_list('all', 'any', '{}', 'élodie', 50, 20, 'state') $$,
  'all, a search with accents, by state, the second page');
select is_empty($$ select * from public.list_demandes('all', 'any', '{}', null, 5000, 50, 'priority') $$,
  'past the last page: nothing (the page read never falls back to every request)');
select is_empty($$
  select p.oid from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname = 'demandes_inbox_rows'
     and (pg_get_function_identity_arguments(p.oid) <> 'p_org uuid, p_states text[], p_id uuid, p_ids uuid[]'
          or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'demandes_inbox_rows: one signature, with the page''s ids; no role');
select throws_ok($$ select * from public.list_demandes('everything') $$, '22023', 'Unknown filter', 'an unknown view is still refused');

select * from finish();
rollback;
