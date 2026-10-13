-- =============================================================================
-- Module Demandes, batch D2: the inbox, the record, « Je m'en occupe », realtime
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D2); roadmap §2.3, §3.1
-- Decisions: D-12 … (docs/plans/2026-10-07-decisions-log.md)
--
-- * The promise (« nous vous rappelons en 24 à 48 h ouvrables », the website's): measured in
--   business hours (Monday to Friday, the clinic's time zone) from reception to the first contact
--   attempt (`demande_events` kind `contact`): `ok` under 24 h, `soon` from 24 h, `late` from 48 h;
--   once contacted, `met` or `met_late` (D-12).
-- * « Sans réponse »: an open request whose latest contact attempt did not reach the person.
-- * « Je m'en occupe » (roadmap §3.1): a soft lock, `handled_by` / `handled_at`, shown for 2
--   hours, never blocking: another counselor may take it over (D-13).
-- * Realtime: the request and its children announce `{ module: 'demandes', table, record_id, op }`
--   on `org:<org>:demandes` (`*_core_realtime.sql`); the screens read again through these RPCs.
-- * Reads are definer RPCs that check `demandes.view` first and join the published directories
--   (Clients' `clients_directory`, Professionnels' `professionals_directory` and catalogues).
--   The internal note is in the record only with `demandes.notes`.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:demandes_inbox', true);

-- -----------------------------------------------------------------------------
-- « Je m'en occupe »
-- -----------------------------------------------------------------------------
alter table public.demandes
  add column handled_by uuid,
  add column handled_at timestamptz,
  add constraint demandes_handled_by_fkey foreign key (handled_by, org_id)
    references public.profiles (user_id, org_id) on delete set null (handled_by),
  -- A person who leaves the clinic leaves `handled_at` behind (on delete set null): harmless.
  add constraint demandes_handled_check check (handled_by is null or handled_at is not null);
create index demandes_handled_by_idx on public.demandes (handled_by, org_id);

-- How long « Je m'en occupe » is shown (D-13).
create function private.demandes_handling_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '2 hours'
$$;
revoke all on function private.demandes_handling_window() from public, anon, authenticated, service_role;

-- « Je m'en occupe » (p_take) or « Je laisse » (release: one's own hold only). Taking over from
-- someone else is allowed (a soft lock) when the caller names the handler she saw (p_expected):
-- if someone else took it meanwhile, a French refusal says who. Not a KPI event: the journal keeps it.
create function public.set_demande_handler(p_id uuid, p_take boolean, p_expected uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_current uuid;
  v_name text;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_id);
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_demande_handler', true);
  v_current := case when v_row.handled_at > pg_catalog.now() - private.demandes_handling_window() then v_row.handled_by end;
  if p_take then
    if v_current is not null and v_current <> auth.uid() and v_current is distinct from p_expected then
      select p.display_name into v_name from public.profiles p where p.user_id = v_current;
      raise exception '% vient de prendre cette demande.', coalesce(v_name, 'Une autre personne') using errcode = 'P0001';
    end if;
    update public.demandes d set handled_by = auth.uid(), handled_at = pg_catalog.now() where d.id = v_row.id;
  else
    update public.demandes d set handled_by = null, handled_at = null
     where d.id = v_row.id and d.handled_by = auth.uid();
  end if;
end;
$$;
revoke all on function public.set_demande_handler(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.set_demande_handler(uuid, boolean, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The promise, in business hours
-- -----------------------------------------------------------------------------
-- Hours between p_from and p_to that fall on Monday–Friday in p_tz.
create function private.demandes_business_hours(p_from timestamptz, p_to timestamptz, p_tz text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(
           extract(epoch from (least(p_to, ((d + 1)::timestamp at time zone p_tz)) - greatest(p_from, (d::timestamp at time zone p_tz)))) / 3600
         ), 0)::numeric(10, 1)
    from pg_catalog.generate_series((p_from at time zone p_tz)::date, (p_to at time zone p_tz)::date, interval '1 day') g(day)
   cross join lateral (select g.day::date as d) x
   where p_to > p_from and extract(isodow from x.d) < 6
$$;
revoke all on function private.demandes_business_hours(timestamptz, timestamptz, text) from public, anon, authenticated, service_role;

-- `ok` / `soon` / `late` before the first contact attempt, `met` / `met_late` after (D-12).
create function private.demandes_promise(p_hours numeric, p_contacted boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_contacted then case when p_hours < 48 then 'met' else 'met_late' end
           when p_hours >= 48 then 'late'
           when p_hours >= 24 then 'soon'
           else 'ok'
         end
$$;
revoke all on function private.demandes_promise(numeric, boolean) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The inbox
-- -----------------------------------------------------------------------------
-- Lower case, unaccented (the inbox's search).
create function private.demandes_fold(p_value text)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_value, '')))
$$;
revoke all on function private.demandes_fold(text) from public, anon, authenticated, service_role;

-- The rows of the inbox with what the list shows, for one clinic (the RPCs below check first):
-- only the states asked (null: all) or one request. A contact attempt is any event with a channel
-- (« Noter un appel », or a call task done). The waiting hours run to the first attempt, or to now
-- while the request is open; a request no longer open and never called has no promise (`none`).
create function private.demandes_inbox_rows(p_org uuid, p_states text[] default null, p_id uuid default null)
returns table (
  id uuid, reference text, received_at timestamptz, channel text, state text, is_urgent boolean,
  client_id uuid, client_number int, person_name text, beneficiary text,
  assigned_to uuid, assigned_name text, contact_attempts int, last_contact_at timestamptz,
  last_outcome text, next_contact_at timestamptz, first_contact_at timestamptz,
  waiting_hours numeric, promise text, no_answer boolean,
  handled_by uuid, handled_by_name text, handled_at timestamptz,
  open_tasks int, next_task_due timestamptz, motif_count int,
  search_text text, phone_digits text[]
)
language sql
stable
set search_path = ''
as $$
  with tz as (select coalesce(o.timezone, 'America/Toronto') as tz from public.organizations o where o.id = p_org)
  select d.id, d.reference, d.received_at, d.channel, d.state, d.is_urgent,
         d.client_id, c.client_number, coalesce(c.display_name, d.contact_name, d.contact_email, d.contact_phone_e164),
         d.beneficiary, d.assigned_to, pa.display_name, d.contact_attempts, d.last_contact_at,
         lc.contact_outcome, d.next_contact_at, fc.at,
         h.hours,
         case when fc.at is null and not h.open then 'none' else private.demandes_promise(h.hours, fc.at is not null) end,
         h.open and lc.contact_outcome is not null and lc.contact_outcome <> 'reached',
         case when d.handled_at > pg_catalog.now() - private.demandes_handling_window() then d.handled_by end,
         case when d.handled_at > pg_catalog.now() - private.demandes_handling_window() then ph.display_name end,
         case when d.handled_at > pg_catalog.now() - private.demandes_handling_window() then d.handled_at end,
         coalesce(t.open_tasks, 0), t.next_due,
         (select count(*)::int from public.demande_motifs m where m.org_id = d.org_id and m.demande_id = d.id),
         private.demandes_fold(concat_ws(' ', d.reference, c.display_name, d.contact_name, d.contact_email, c.email)),
         array_remove(array[pg_catalog.regexp_replace(coalesce(d.contact_phone_e164, ''), '[^0-9]', '', 'g'),
                            pg_catalog.regexp_replace(coalesce(c.mobile_e164, ''), '[^0-9]', '', 'g')], '')
    from public.demandes d
    left join public.clients_directory c on c.id = d.client_id
    left join public.profiles pa on pa.user_id = d.assigned_to
    left join public.profiles ph on ph.user_id = d.handled_by
    left join lateral (select e.contact_outcome from public.demande_events e
                        where e.org_id = d.org_id and e.demande_id = d.id and e.contact_channel is not null
                        order by e.at desc, e.id desc limit 1) lc on true
    left join lateral (select min(e.at) as at from public.demande_events e
                        where e.org_id = d.org_id and e.demande_id = d.id and e.contact_channel is not null) fc on true
    left join lateral (select count(*)::int as open_tasks, min(k.due_at) as next_due from public.demande_tasks k
                        where k.org_id = d.org_id and k.demande_id = d.id and k.state = 'open') t on true
    cross join lateral (
      select d.state not in ('matched', 'closed') as open,
             case when fc.at is null and d.state in ('matched', 'closed') then 0::numeric(10, 1)
                  else private.demandes_business_hours(d.received_at, coalesce(fc.at, pg_catalog.now()), (select tz from tz)) end as hours
    ) h
   where d.org_id = p_org
     and (p_states is null or d.state = any (p_states))
     and (p_id is null or d.id = p_id)
$$;
revoke all on function private.demandes_inbox_rows(uuid, text[], uuid) from public, anon, authenticated, service_role;

-- The inbox (`demandes.view`): one view, filters, 50 a page.
-- p_view: `open` (new, evaluating, accepted, proposed), `matched`, `waitlist`, `closed`, `all`.
-- p_assigned: `me`, `none`, `any`. p_flags (all must hold): `late` (the promise broken),
-- `no_answer` (« sans réponse »), `urgent`, `due` (a callback or a task due now).
-- p_search: the number, a name, an email (accents ignored) or 4+ digits of a phone.
-- Open views: urgent first, then late, then the oldest; the others: the newest first.
create function public.list_demandes(
  p_view text default 'open',
  p_assigned text default 'any',
  p_flags text[] default '{}',
  p_search text default null,
  p_offset int default 0,
  p_limit int default 50
)
returns table (
  id uuid, reference text, received_at timestamptz, channel text, state text, is_urgent boolean,
  client_id uuid, client_number int, person_name text, beneficiary text,
  assigned_to uuid, assigned_name text, contact_attempts int, last_contact_at timestamptz,
  last_outcome text, next_contact_at timestamptz, first_contact_at timestamptz,
  waiting_hours numeric, promise text, no_answer boolean,
  handled_by uuid, handled_by_name text, handled_at timestamptz,
  open_tasks int, next_task_due timestamptz, motif_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_me uuid := auth.uid();
  v_search text := nullif(private.demandes_fold(pg_catalog.btrim(pg_catalog.left(p_search, 100))), '');
  v_digits text := nullif(pg_catalog.regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g'), '');
begin
  perform private.demandes_require('demandes.view');
  if p_view not in ('open', 'matched', 'waitlist', 'closed', 'all') or p_assigned not in ('me', 'none', 'any')
     or not (coalesce(p_flags, '{}') <@ array['late', 'no_answer', 'urgent', 'due']) then
    raise exception 'Unknown filter' using errcode = '22023';
  end if;
  return query
    select r.id, r.reference, r.received_at, r.channel, r.state, r.is_urgent, r.client_id, r.client_number, r.person_name,
           r.beneficiary, r.assigned_to, r.assigned_name, r.contact_attempts, r.last_contact_at, r.last_outcome,
           r.next_contact_at, r.first_contact_at, r.waiting_hours, r.promise, r.no_answer,
           r.handled_by, r.handled_by_name, r.handled_at, r.open_tasks, r.next_task_due, r.motif_count
      from private.demandes_inbox_rows(v_org,
             case p_view when 'open' then array['new', 'evaluating', 'accepted', 'proposed'] when 'all' then null else array[p_view] end) r
     where case p_assigned when 'me' then r.assigned_to = v_me when 'none' then r.assigned_to is null else true end
       and (not ('late' = any (p_flags)) or r.promise = 'late')
       and (not ('no_answer' = any (p_flags)) or r.no_answer)
       and (not ('urgent' = any (p_flags)) or r.is_urgent)
       and (not ('due' = any (p_flags)) or r.next_contact_at <= pg_catalog.now() or r.next_task_due <= pg_catalog.now())
       and (v_search is null or pg_catalog.strpos(r.search_text, v_search) > 0
            or (pg_catalog.length(v_digits) >= 4 and exists (select 1 from unnest(r.phone_digits) p where pg_catalog.strpos(p, v_digits) > 0)))
     order by case when p_view = 'open' then r.is_urgent end desc nulls last,
              case when p_view = 'open' then r.promise = 'late' end desc nulls last,
              case when p_view = 'open' then r.received_at end asc,
              r.received_at desc, r.id
     offset greatest(coalesce(p_offset, 0), 0)
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;
revoke all on function public.list_demandes(text, text, text[], text, int, int) from public, anon, authenticated;
grant execute on function public.list_demandes(text, text, text[], text, int, int) to authenticated;

-- The inbox's counters (`demandes.view`): open, late, no answer, due, mine, unassigned, waiting list.
create function public.demandes_counts()
returns table (open bigint, late bigint, no_answer bigint, due bigint, mine bigint, unassigned bigint, waitlist bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  perform private.demandes_require('demandes.view');
  return query
    select count(*) filter (where o),
           count(*) filter (where o and r.promise = 'late'),
           count(*) filter (where o and r.no_answer),
           count(*) filter (where o and (r.next_contact_at <= pg_catalog.now() or r.next_task_due <= pg_catalog.now())),
           count(*) filter (where o and r.assigned_to = auth.uid()),
           count(*) filter (where o and r.assigned_to is null),
           count(*) filter (where r.state = 'waitlist')
      from (select x.*, x.state in ('new', 'evaluating', 'accepted', 'proposed') as o
              from private.demandes_inbox_rows(v_org, array['new', 'evaluating', 'accepted', 'proposed', 'waitlist']) x) r;
end;
$$;
revoke all on function public.demandes_counts() from public, anon, authenticated;
grant execute on function public.demandes_counts() to authenticated;

-- -----------------------------------------------------------------------------
-- The record: one bundle (CLAUDE.md §8: the tabs read it, never refetching)
-- -----------------------------------------------------------------------------
-- Null when the request is not the caller's clinic's. The note only with demandes.notes.
create function public.get_demande(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.demandes;
  v_inbox record;
  v_notes boolean;
begin
  perform private.demandes_require('demandes.view');
  select * into v_row from public.demandes d where d.id = p_id and d.org_id = v_org;
  if v_row.id is null then
    return null;
  end if;
  select * into v_inbox from private.demandes_inbox_rows(v_org, null, v_row.id) r;
  v_notes := private.has_permission('demandes.notes');
  return jsonb_build_object(
    'demande', to_jsonb(v_row) - 'handled_by' - 'handled_at' - 'reference_year' - 'reference_seq'
               || jsonb_build_object(
                    'handled_by', v_inbox.handled_by, 'handled_by_name', v_inbox.handled_by_name, 'handled_at', v_inbox.handled_at,
                    'assigned_name', v_inbox.assigned_name,
                    'received_by_name', (select p.display_name from public.profiles p where p.user_id = v_row.received_by),
                    'waiting_hours', v_inbox.waiting_hours, 'promise', v_inbox.promise, 'no_answer', v_inbox.no_answer,
                    'first_contact_at', v_inbox.first_contact_at, 'last_outcome', v_inbox.last_outcome,
                    'person_name', v_inbox.person_name),
    'client', (select jsonb_build_object('id', c.id, 'client_number', c.client_number, 'display_name', c.display_name,
                                         'email', c.email, 'mobile_e164', c.mobile_e164, 'birthday', c.birthday,
                                         'is_archived', c.is_archived)
                 from public.clients_directory c where c.id = v_row.client_id),
    'matched_professional', (select jsonb_build_object('id', p.id, 'display_name', p.display_name)
                               from public.professionals_directory p where p.id = v_row.matched_professional_id),
    'motif_ids', coalesce((select jsonb_agg(m.motif_id order by m.motif_id) from public.demande_motifs m where m.demande_id = v_row.id), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', p.id, 'client_id', p.client_id, 'display_name', p.display_name,
                                'relationship', p.relationship, 'birthday', p.birthday, 'is_primary', p.is_primary,
                                'client', (select jsonb_build_object('client_number', c.client_number, 'display_name', c.display_name)
                                             from public.clients_directory c where c.id = p.client_id))
                                order by p.is_primary desc, p.created_at, p.id)
                                from public.demande_participants p where p.demande_id = v_row.id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', k.id, 'kind', k.kind, 'due_at', k.due_at, 'state', k.state, 'outcome', k.outcome,
                         'assigned_to', k.assigned_to,
                         'assigned_name', (select p.display_name from public.profiles p where p.user_id = k.assigned_to),
                         'done_at', k.done_at,
                         'done_by_name', (select p.display_name from public.profiles p where p.user_id = k.done_by))
                         order by (k.state = 'open') desc, k.due_at, k.id)
                         from public.demande_tasks k where k.demande_id = v_row.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', e.id, 'kind', e.kind, 'from_state', e.from_state, 'to_state', e.to_state,
                          'closed_reason', e.closed_reason, 'contact_channel', e.contact_channel,
                          'contact_outcome', e.contact_outcome,
                          'professional_name', (select p.display_name from public.professionals_directory p where p.id = e.professional_id),
                          'assignee_name', (select p.display_name from public.profiles p where p.user_id = e.assignee),
                          'at', e.at,
                          'by_name', (select p.display_name from public.profiles p where p.user_id = e.by_user))
                          order by e.at desc, e.id desc)
                          from public.demande_events e where e.demande_id = v_row.id), '[]'::jsonb),
    'note', case when v_notes then
              (select jsonb_build_object('internal_note', n.internal_note, 'updated_at', n.updated_at,
                                         'updated_by_name', (select p.display_name from public.profiles p where p.user_id = n.updated_by))
                 from public.demande_notes n where n.demande_id = v_row.id)
            end,
    'can', jsonb_build_object('manage', private.has_permission('demandes.manage'), 'notes', v_notes)
  );
end;
$$;
revoke all on function public.get_demande(uuid) from public, anon, authenticated;
grant execute on function public.get_demande(uuid) to authenticated;

-- What the intake and the filters choose from (`demandes.view`): the people who work requests
-- (demandes.manage), the « Comment avez-vous entendu parler de MANA ? » list, and Professionnels'
-- catalogues (motifs by category, titles, clientèles).
-- TEMPORAIRE (D-14): the referral sources are read from Clients' table until Clients publishes
-- `referral_sources_catalog` (lane A, C4); the first Demandes batch after C4 switches to it.
create function public.get_demandes_reference()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  perform private.demandes_require('demandes.view');
  return jsonb_build_object(
    'workers', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'display_name', p.display_name) order by p.display_name)
                           from public.profiles p
                          where p.org_id = v_org and p.status = 'active'
                            and 'demandes.manage' = any (private.permission_keys_for(p.user_id))), '[]'::jsonb),
    'referral_sources', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.sort_order, s.name)
                                    from public.referral_sources s where s.org_id = v_org and s.is_active), '[]'::jsonb),
    'motifs', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'category_id', m.category_id,
                                                           'category_name', m.category_name)
                                         order by m.category_sort_order nulls last, m.category_name, m.sort_order, m.name)
                          from public.motifs_catalog m where m.org_id = v_org), '[]'::jsonb),
    'profession_titles', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.sort_order, t.name)
                                     from public.profession_titles_catalog t where t.org_id = v_org), '[]'::jsonb),
    'clienteles', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name)
                              from public.clienteles_catalog c where c.org_id = v_org), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_demandes_reference() from public, anon, authenticated;
grant execute on function public.get_demandes_reference() to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: the request and its children announce themselves (ids only)
-- -----------------------------------------------------------------------------
create trigger demandes_broadcast after insert or update or delete on public.demandes
  for each row execute function private.broadcast_record_change('demandes', 'id');
create trigger demande_tasks_broadcast after insert or update or delete on public.demande_tasks
  for each row execute function private.broadcast_record_change('demandes', 'demande_id', 'demandes');
create trigger demande_participants_broadcast after insert or update or delete on public.demande_participants
  for each row execute function private.broadcast_record_change('demandes', 'demande_id', 'demandes');
create trigger demande_notes_broadcast after insert or update or delete on public.demande_notes
  for each row execute function private.broadcast_record_change('demandes', 'demande_id', 'demandes');
create trigger demande_motifs_broadcast after insert or delete on public.demande_motifs
  for each row execute function private.broadcast_record_change('demandes', 'demande_id', 'demandes');
