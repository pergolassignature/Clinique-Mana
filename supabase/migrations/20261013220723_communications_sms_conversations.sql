-- =============================================================================
-- Module Communications: two-way SMS conversations (decisions SM-14 … SM-17)
-- =============================================================================
-- Plan: docs/plans/2026-10-11-modules-coding-plan.md (« SMS two-way conversations », after SM);
-- PS Hub's texting (its inbox matched to contacts, « Associer » an unassigned thread, the texts
-- on the contact's record) as the reference; CM2b's mail thread → client link as the pattern.
-- Needs: SM's `sms_messages`, `sms_threads`, `record_inbound_sms`; Clients' `clients_directory`,
-- `client_relations` and its merge / anonymisation handler catalogues (data, ADR 0003).
--
-- * Clients publishes `private.clients_match_phone(org, phones[])` (the files whose mobile, home or
--   work number it is; else the files related to them) and `private.clients_phones_of(org, client)`
--   (a file's own numbers), granted to no role.
-- * `sms_thread_links`: one row per clinic and number (the thread), `unlinked` / `needs_review` /
--   `linked`, source `auto` or `manual`. Audited, the number redacted; its key is a uuid so the
--   number never reaches the audit's record id.
-- * Automatic (SM-14): each inbound text, and each consent the staff records, links its number
--   (`record_inbound_sms` and `set_sms_consent` call `private.communications_link_sms_threads`): one file → linked, several → to review (« À
--   rattacher », ≤ 20 candidates), none → unlinked. Only while Clients is on. A person's link or
--   unlink is never touched again. The texts received before this migration are linked now.
-- * Manual (SM-15, `communications.sms` and `clients.view`): `link_sms_thread`, `unlink_sms_thread`
--   (a number with no text yet may be linked: the first text written from a file).
-- * Read: `list_sms_conversations(view, search)` (« Toutes » / « À rattacher », a file's name or the
--   number's digits; the file's name only with `clients.view`), `get_sms_thread_link(phone)`,
--   `list_client_sms(client)` (SM-16: a file's own numbers and the numbers linked to it, each with
--   its consent and texts count; the panel in the file's « Courriels » tab).
-- * A merge re-points the links, an anonymisation removes them (the handlers replaced); the purge
--   job drops a link whose number has no text left after 24 months (SM-8).
-- * P3-40 is unchanged: a reply goes through `sms-send`, refused while Communications is reserved
--   for its testers (SM-17: nothing new sends).
-- Additive: a table, functions, `create or replace` of five functions.

select pg_catalog.set_config('app.audit_source', 'migration:communications_sms_conversations', true);

-- -----------------------------------------------------------------------------
-- Clients: the files of a number, a file's numbers (published, granted to no role)
-- -----------------------------------------------------------------------------
create function private.clients_match_phone(p_org uuid, p_phones text[])
returns table (phone text, client_id uuid, match_kind text)
language sql
stable
set search_path = ''
as $$
  with wanted as (
    select distinct pg_catalog.btrim(p) as phone
      from pg_catalog.unnest(coalesce(p_phones, '{}'::text[])) p
     where pg_catalog.btrim(p) ~ '^\+[1-9][0-9]{7,14}$'
  ),
  holders as (
    select w.phone, c.id, c.client_number
      from wanted w
      join public.clients c on c.org_id = p_org and w.phone in (c.mobile_e164, c.home_e164, c.work_e164)
     where c.merged_into_id is null and c.anonymized_at is null
  ),
  usable as (
    -- A number shared by more than five files (a switchboard) names none.
    select h.* from holders h where (select count(*) from holders x where x.phone = h.phone) < 6
  ),
  matches as (
    select u.phone, u.id as client_id, 'client'::text as match_kind, u.client_number from usable u
    union
    select u.phone, o.id, 'relation'::text, o.client_number
      from usable u
      join public.client_relations r on r.org_id = p_org and u.id in (r.client_a_id, r.client_b_id)
      join public.clients o on o.org_id = p_org and o.id = case when r.client_a_id = u.id then r.client_b_id else r.client_a_id end
     where o.merged_into_id is null and o.anonymized_at is null
  )
  select m.phone, m.client_id, m.match_kind
    from matches m
   where m.match_kind = 'client'
      or not exists (select 1 from matches x where x.phone = m.phone and x.client_id = m.client_id and x.match_kind = 'client')
   order by m.phone, m.match_kind, m.client_number;
$$;

create function private.clients_phones_of(p_org uuid, p_client_id uuid)
returns table (phone text, kind text)
language sql
stable
set search_path = ''
as $$
  select x.phone, x.kind
    from public.clients c
   cross join lateral (values (c.mobile_e164, 'mobile', 1), (c.home_e164, 'home', 2), (c.work_e164, 'work', 3)) as x(phone, kind, ord)
   where c.org_id = p_org and c.id = p_client_id and x.phone is not null and c.anonymized_at is null
   order by x.ord;
$$;
revoke all on function private.clients_match_phone(uuid, text[]), private.clients_phones_of(uuid, uuid)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- sms_thread_links: a number's thread → its client
-- -----------------------------------------------------------------------------
create table public.sms_thread_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  peer_e164 text not null check (peer_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'unlinked',
  client_id uuid,
  candidate_client_ids uuid[] not null default '{}',
  source text,
  linked_by uuid references public.profiles(user_id) on delete set null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_thread_links_peer_key unique (org_id, peer_e164),
  constraint sms_thread_links_status_check check (status in ('unlinked', 'needs_review', 'linked')),
  constraint sms_thread_links_client_check check ((status = 'linked') = (client_id is not null)),
  constraint sms_thread_links_source_check check (source is null or source in ('auto', 'manual')),
  constraint sms_thread_links_candidates_check check (pg_catalog.cardinality(candidate_client_ids) <= 20)
);
create index sms_thread_links_org_status_idx on public.sms_thread_links (org_id, status);
create index sms_thread_links_org_client_idx on public.sms_thread_links (org_id, client_id) where client_id is not null;
create index sms_thread_links_linked_by_idx on public.sms_thread_links (linked_by);

revoke all on public.sms_thread_links from anon, authenticated;
grant select on public.sms_thread_links to authenticated;
alter table public.sms_thread_links enable row level security;
create policy sms_thread_links_select on public.sms_thread_links
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('communications.sms'))
  );
create trigger sms_thread_links_set_updated_at before update on public.sms_thread_links
  for each row execute function private.set_updated_at();
create trigger sms_thread_links_audit after insert or update or delete on public.sms_thread_links
  for each row execute function private.audit_trigger('peer_e164');

-- -----------------------------------------------------------------------------
-- The automatic link (SM-14)
-- -----------------------------------------------------------------------------
-- Links p_org's numbers p_phones (no link yet, or still unlinked / to review, never a person's):
-- the files whose number it is win over the files related to them. Returns how many were evaluated.
create function private.communications_link_sms_threads(p_org uuid, p_phones text[])
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_phone text;
  v_candidates uuid[];
  v_count int := 0;
begin
  if p_phones is null or pg_catalog.cardinality(p_phones) = 0 or not public.module_enabled_for_org(p_org, 'clients') then
    return 0;
  end if;
  for v_phone in
    select distinct p from pg_catalog.unnest(p_phones) p
     where p ~ '^\+[1-9][0-9]{7,14}$'
       and not exists (select 1 from public.sms_thread_links l
                        where l.org_id = p_org and l.peer_e164 = p and (l.source = 'manual' or l.status = 'linked'))
  loop
    select coalesce((select array_agg(distinct x.client_id) from private.clients_match_phone(p_org, array[v_phone]) x where x.match_kind = 'client'),
                    (select array_agg(distinct x.client_id) from private.clients_match_phone(p_org, array[v_phone]) x where x.match_kind = 'relation'),
                    '{}')
      into v_candidates;
    insert into public.sms_thread_links as l (org_id, peer_e164, status, client_id, candidate_client_ids, source, linked_at)
    values (p_org, v_phone,
            case pg_catalog.cardinality(v_candidates) when 0 then 'unlinked' when 1 then 'linked' else 'needs_review' end,
            case when pg_catalog.cardinality(v_candidates) = 1 then v_candidates[1] end,
            case when pg_catalog.cardinality(v_candidates) > 1 then v_candidates[1:20] else '{}' end,
            case when pg_catalog.cardinality(v_candidates) > 0 then 'auto' end,
            case when pg_catalog.cardinality(v_candidates) = 1 then pg_catalog.now() end)
    on conflict (org_id, peer_e164) do update
      set status = excluded.status, client_id = excluded.client_id, candidate_client_ids = excluded.candidate_client_ids,
          source = excluded.source, linked_at = excluded.linked_at
      where l.source is distinct from 'manual' and l.status <> 'linked';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.communications_link_sms_threads(uuid, text[]) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Manual link (SM-15: communications.sms and clients.view)
-- -----------------------------------------------------------------------------
create function public.link_sms_thread(p_phone text, p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_phone text := private.sms_normalize_e164(p_phone);
begin
  if not private.has_permission('communications.sms') or not private.has_permission('clients.view') then
    raise exception 'Permission refusée : communications.sms, clients.view' using errcode = '42501';
  end if;
  if v_phone is null then
    raise exception 'Le numéro de téléphone n''est pas valide : indiquez un numéro à 10 chiffres.' using errcode = 'P0001', hint = 'phone';
  end if;
  if p_client_id is null or not exists (
       select 1 from public.clients_directory c
        where c.id = p_client_id and c.org_id = v_org and c.merged_into_id is null and not c.is_anonymized) then
    raise exception 'Choisissez un dossier client de la clinique.' using errcode = 'P0001', hint = 'client_id';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:link_sms_thread', true);
  insert into public.sms_thread_links as l (org_id, peer_e164, status, client_id, candidate_client_ids, source, linked_by, linked_at)
  values (v_org, v_phone, 'linked', p_client_id, '{}', 'manual', auth.uid(), pg_catalog.now())
  on conflict (org_id, peer_e164) do update
    set status = 'linked', client_id = p_client_id, candidate_client_ids = '{}', source = 'manual',
        linked_by = auth.uid(), linked_at = pg_catalog.now();
end;
$$;
revoke all on function public.link_sms_thread(text, uuid) from public, anon;
grant execute on function public.link_sms_thread(text, uuid) to authenticated;

-- « Détacher »: the number is unlinked by a person, so a later text never links it again.
create function public.unlink_sms_thread(p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_phone text := private.sms_normalize_e164(p_phone);
begin
  if not private.has_permission('communications.sms') or not private.has_permission('clients.view') then
    raise exception 'Permission refusée : communications.sms, clients.view' using errcode = '42501';
  end if;
  if v_phone is null then
    raise exception 'Le numéro de téléphone n''est pas valide : indiquez un numéro à 10 chiffres.' using errcode = 'P0001', hint = 'phone';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:unlink_sms_thread', true);
  insert into public.sms_thread_links as l (org_id, peer_e164, status, source, linked_by, linked_at)
  values (v_org, v_phone, 'unlinked', 'manual', auth.uid(), pg_catalog.now())
  on conflict (org_id, peer_e164) do update
    set status = 'unlinked', client_id = null, candidate_client_ids = '{}', source = 'manual',
        linked_by = auth.uid(), linked_at = pg_catalog.now();
end;
$$;
revoke all on function public.unlink_sms_thread(text) from public, anon;
grant execute on function public.unlink_sms_thread(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Read
-- -----------------------------------------------------------------------------
-- A number's link: status, source, the file and the candidates. Definer (the number is
-- normalised by a private helper), communications.sms first; the files come from Clients'
-- `clients_directory`, which still filters on the caller's clients.view (no name without it). The
-- number travels in the body (an RPC), never in a URL.
create function public.get_sms_thread_link(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.sms_thread_links;
begin
  if not private.has_permission('communications.sms') then
    raise exception 'Permission refusée : communications.sms' using errcode = '42501';
  end if;
  select x.* into l from public.sms_thread_links x
   where x.org_id = private.current_user_org_id() and x.peer_e164 = private.sms_normalize_e164(p_phone);
  return pg_catalog.jsonb_build_object(
    'status', coalesce(l.status, 'unlinked'),
    'source', l.source,
    'client', (select pg_catalog.jsonb_build_object('id', c.id, 'client_number', c.client_number, 'display_name', c.display_name)
                 from public.clients_directory c where c.id = l.client_id),
    'candidates', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                              'id', c.id, 'client_number', c.client_number, 'display_name', c.display_name)
                              order by c.client_number)
                              from public.clients_directory c where c.id = any (coalesce(l.candidate_client_ids, '{}'))), '[]'::jsonb));
end;
$$;
revoke all on function public.get_sms_thread_link(text) from public, anon;
grant execute on function public.get_sms_thread_link(text) to authenticated;

-- « Textos »'s list (SM-15): the threads, newest first (200 at most), with their link and file.
-- `p_view`: 'all' or 'to_link' (not linked, never unlinked by a person). `p_search`: the file's
-- name (with clients.view) or the number's digits (3 at least). Invoker (the tables' RLS).
create function public.list_sms_conversations(p_view text default 'all', p_search text default null)
returns table (
  phone text, last_message_at timestamptz, last_direction text, last_status text, last_body text, last_body_purged boolean,
  last_has_media boolean, message_count int, last_inbound_at timestamptz, consent_status text,
  link_status text, link_source text, client_id uuid, client_number int, client_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select nullif(pg_catalog.btrim(coalesce(p_search, '')), '') as text,
           pg_catalog.regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g') as digits
  )
  select t.peer_e164, t.last_message_at, t.last_direction, t.last_status, t.last_body, t.last_body_purged,
         t.last_has_media, t.message_count, t.last_inbound_at, t.consent_status,
         coalesce(l.status, 'unlinked'), l.source, c.id, c.client_number, c.display_name
    from public.sms_threads t
    cross join q
    left join public.sms_thread_links l on l.org_id = t.org_id and l.peer_e164 = t.peer_e164
    left join public.clients_directory c on c.id = l.client_id
   where case coalesce(p_view, 'all')
           when 'all' then true
           when 'to_link' then coalesce(l.status, 'unlinked') <> 'linked' and l.source is distinct from 'manual'
           else false
         end
     and (q.text is null
          or (pg_catalog.length(q.digits) >= 3 and pg_catalog.strpos(t.peer_e164, q.digits) > 0)
          or (c.display_name is not null
              and pg_catalog.strpos(pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, c.display_name)),
                                    pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, q.text))) > 0))
   order by t.last_message_at desc
   limit 200
$$;
revoke all on function public.list_sms_conversations(text, text) from public, anon;
grant execute on function public.list_sms_conversations(text, text) to authenticated;

-- A file's texts (SM-16): its own numbers (mobile, home, work) and the numbers linked to it, each
-- with its consent and how many texts. Definer: communications.sms and clients.view first, the
-- file of the caller's clinic.
create function public.list_client_sms(p_client_id uuid)
returns table (phone text, kind text, consent_status text, message_count int, last_message_at timestamptz, link_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('communications.sms') or not private.has_permission('clients.view') then
    raise exception 'Permission refusée : communications.sms, clients.view' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients c where c.org_id = v_org and c.id = p_client_id) then
    raise exception 'Dossier introuvable.' using errcode = 'P0001', hint = 'client_id';
  end if;
  return query
    with numbers as (
      select o.phone, o.kind, 1 as ord from private.clients_phones_of(v_org, p_client_id) o
      union all
      select l.peer_e164, 'linked', 2 from public.sms_thread_links l
       where l.org_id = v_org and l.client_id = p_client_id and l.status = 'linked'
         and l.peer_e164 not in (select o.phone from private.clients_phones_of(v_org, p_client_id) o)
    )
    select n.phone, n.kind,
           (select k.status from public.sms_consents k where k.org_id = v_org and k.phone_e164 = n.phone),
           (select pg_catalog.count(*)::int from public.sms_messages m where m.org_id = v_org and m.peer_e164 = n.phone),
           (select pg_catalog.max(m.created_at) from public.sms_messages m where m.org_id = v_org and m.peer_e164 = n.phone),
           coalesce((select l.status from public.sms_thread_links l where l.org_id = v_org and l.peer_e164 = n.phone), 'unlinked')
      from numbers n
     order by n.ord, n.phone;
end;
$$;
revoke all on function public.list_client_sms(uuid) from public, anon;
grant execute on function public.list_client_sms(uuid) to authenticated;

-- An inbound text links its number to its file (SM-14).
create or replace function public.record_inbound_sms(
  p_org_id uuid,
  p_from text,
  p_did text,
  p_body text,
  p_media jsonb,
  p_provider_msg_id bigint,
  p_provider_session_id bigint,
  p_received_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text := private.sms_normalize_e164(p_from);
  v_did text := private.sms_normalize_e164(p_did);
  v_body text := pg_catalog.left(coalesce(p_body, ''), 1600);
  v_media jsonb := case when pg_catalog.jsonb_typeof(p_media) = 'array' then p_media else '[]'::jsonb end;
  v_id uuid;
  v_keyword text;
  v_ack public.sms_messages%rowtype;
  v_confirmed boolean := false;
  v_already_out boolean;
begin
  if p_org_id is null or p_provider_msg_id is null then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'communications') then
    return pg_catalog.jsonb_build_object('outcome', 'ignored');
  end if;
  if v_from is null then
    return pg_catalog.jsonb_build_object('outcome', 'unreadable_number');
  end if;

  insert into public.sms_messages (org_id, direction, peer_e164, did_e164, kind, body, media, status,
                                   provider_msg_id, provider_session_id, created_at, sent_at)
  values (p_org_id, 'in', v_from, v_did, 'inbound', nullif(v_body, ''), v_media, 'received',
          p_provider_msg_id, p_provider_session_id, coalesce(p_received_at, pg_catalog.now()), coalesce(p_received_at, pg_catalog.now()))
  on conflict (org_id, provider, provider_msg_id) where provider_msg_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'duplicate');
  end if;
  -- SM-14: the number's thread links itself to its file (one person's link is never undone).
  perform private.communications_link_sms_threads(p_org_id, array[v_from]);

  v_keyword := private.sms_keyword(v_body);
  if v_keyword = 'stop' then
    v_already_out := private.sms_consent_status(p_org_id, v_from) is not distinct from 'opted_out';
    perform private.sms_record_opt_out(p_org_id, v_from, 'sms_reply');
    -- One acknowledgement per withdrawal (SM-6): a stop word from a number already withdrawn is
    -- only recorded. The acknowledgement is claimed for the webhook to send now (best effort: a
    -- failure shows in the thread as « Échec », the withdrawal itself stands).
    if not v_already_out then
      insert into public.sms_messages (org_id, direction, peer_e164, did_e164, kind, body, status, claimed_at, attempts)
      values (p_org_id, 'out', v_from, v_did, 'opt_out_ack', private.sms_settings(p_org_id) ->> 'sms_opt_out_reply', 'sending', pg_catalog.now(), 1)
      returning * into v_ack;
      update public.sms_messages m set request_id = 'mana-' || v_ack.id::text where m.id = v_ack.id returning * into v_ack;
      perform private.notify(
        p_org_id, 'communications', 'communications.sms_opted_out', 'normal', 'Retrait du consentement aux textos',
        'Une personne a répondu ARRÊT : plus aucun texto ne lui sera envoyé.',
        '/textos?message=' || v_id::text, 'sms_message', v_id,
        'communications.sms', null, 'sms_opted_out:' || v_id::text, pg_catalog.now() + interval '30 days');
    end if;
  else
    if v_keyword = 'yes' then
      v_confirmed := private.sms_confirmation_hook(p_org_id, v_from, v_id);
    end if;
    perform private.notify(
      p_org_id, 'communications', 'communications.sms_received', 'normal', 'Nouveau texto reçu',
      case when v_confirmed then 'Une personne a confirmé par texto.' else 'Une personne a écrit au numéro de la clinique.' end,
      '/textos?message=' || v_id::text, 'sms_message', v_id,
      'communications.sms', null, 'sms_received:' || v_id::text, pg_catalog.now() + interval '30 days');
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', 'recorded',
    'message_id', v_id,
    'keyword', v_keyword,
    'opted_out', v_keyword = 'stop',
    'confirmed', v_confirmed,
    'ack', case when v_ack.id is null then null
                else pg_catalog.jsonb_build_object('id', v_ack.id, 'to_e164', v_ack.peer_e164, 'body', v_ack.body, 'request_id', v_ack.request_id) end);
end;
$$;
-- A consent recorded by the staff links its number to its file too (SM-14).
create or replace function public.set_sms_consent(
  p_phone text,
  p_status text,
  p_subject_type text default null,
  p_subject_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_phone text := private.sms_normalize_e164(p_phone);
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_row public.sms_consents%rowtype;
  v_prev text;
begin
  if not private.has_permission('communications.sms') then
    raise exception 'Permission refusée : communications.sms' using errcode = '42501';
  end if;
  if v_phone is null then
    raise exception 'Le numéro de téléphone n''est pas valide : indiquez un numéro à 10 chiffres.' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('opted_in', 'opted_out') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if pg_catalog.length(v_note) > 500 then
    raise exception 'La note doit compter au plus 500 caractères.' using errcode = 'P0001';
  end if;
  if (p_subject_type is null) <> (p_subject_id is null) then
    raise exception 'Invalid subject' using errcode = '22023';
  end if;

  -- The row locked first: a second entry at the same moment sees the first one's status.
  select c.status into v_prev from public.sms_consents c where c.org_id = v_org and c.phone_e164 = v_phone for update;

  if p_status = 'opted_in' then
    insert into public.sms_consents as c (org_id, phone_e164, status, source, subject_type, subject_id, granted_at, withdrawn_at, note, updated_by)
    values (v_org, v_phone, 'opted_in', 'staff', p_subject_type, p_subject_id, pg_catalog.now(), null, v_note, auth.uid())
    on conflict (org_id, phone_e164) do update
       set status = 'opted_in',
           source = 'staff',
           subject_type = coalesce(excluded.subject_type, c.subject_type),
           subject_id = coalesce(excluded.subject_id, c.subject_id),
           granted_at = case when c.status = 'opted_in' then c.granted_at else pg_catalog.now() end,
           withdrawn_at = null,
           note = coalesce(excluded.note, c.note),
           updated_by = excluded.updated_by
    returning * into v_row;
    if v_prev is distinct from 'opted_in' then
      -- A new consent: the notice with the withdrawal word, at once.
      perform private.send_sms(v_org, v_phone, private.sms_settings(v_org) ->> 'sms_consent_text', 'consent_notice',
                               null, null, true, auth.uid());
    end if;
  else
    perform private.sms_record_opt_out(v_org, v_phone, 'staff', auth.uid());
    update public.sms_consents c
       set note = coalesce(v_note, c.note),
           subject_type = coalesce(p_subject_type, c.subject_type),
           subject_id = coalesce(p_subject_id, c.subject_id)
     where c.org_id = v_org and c.phone_e164 = v_phone
    returning * into v_row;
  end if;
  -- SM-14: a number recorded by the staff (« Nouveau numéro ») links itself to its file too.
  perform private.communications_link_sms_threads(v_org, array[v_phone]);
  return pg_catalog.to_jsonb(v_row);
end;
$$;
-- Clients' merge: the mail and the texts follow the kept file (SM-14).
create or replace function private.communications_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
  v_more int;
begin
  update public.mail_thread_links l
     set client_id = case when l.client_id = p_old then p_new else l.client_id end,
         candidate_client_ids = (select coalesce(array_agg(distinct case when x = p_old then p_new else x end), '{}')
                                   from pg_catalog.unnest(l.candidate_client_ids) x)
   where l.client_id = p_old or p_old = any (l.candidate_client_ids);
  get diagnostics v_count = row_count;
  update public.mail_drafts d set client_id = p_new where d.client_id = p_old;
  get diagnostics v_more = row_count;
  v_count := v_count + v_more;
  update public.mail_sends s set client_id = p_new where s.client_id = p_old;
  get diagnostics v_more = row_count;
  v_count := v_count + v_more;
  -- SM-14: the texts' links follow too.
  update public.sms_thread_links l
     set client_id = case when l.client_id = p_old then p_new else l.client_id end,
         candidate_client_ids = (select coalesce(array_agg(distinct case when x = p_old then p_new else x end), '{}')
                                   from pg_catalog.unnest(l.candidate_client_ids) x)
   where l.client_id = p_old or p_old = any (l.candidate_client_ids);
  get diagnostics v_more = row_count;
  return v_count + v_more;
end;
$$;
-- Clients' anonymisation: the mail and the texts are no longer hers (SM-14).
create or replace function private.communications_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
  v_more int;
begin
  update public.mail_thread_links l
     set status = case when l.client_id = p_id then 'unlinked' else l.status end,
         client_id = case when l.client_id = p_id then null else l.client_id end,
         candidate_client_ids = pg_catalog.array_remove(l.candidate_client_ids, p_id)
   where l.client_id = p_id or p_id = any (l.candidate_client_ids);
  get diagnostics v_count = row_count;
  update public.mail_drafts d set client_id = null where d.client_id = p_id;
  get diagnostics v_more = row_count;
  v_count := v_count + v_more;
  update public.mail_sends s set client_id = null where s.client_id = p_id;
  get diagnostics v_more = row_count;
  v_count := v_count + v_more;
  -- SM-14: her numbers' threads are no longer hers, nor offered.
  update public.sms_thread_links l
     set status = case when l.client_id = p_id then 'unlinked' else l.status end,
         client_id = case when l.client_id = p_id then null else l.client_id end,
         candidate_client_ids = pg_catalog.array_remove(l.candidate_client_ids, p_id)
   where l.client_id = p_id or p_id = any (l.candidate_client_ids);
  get diagnostics v_more = row_count;
  return v_count + v_more;
end;
$$;
-- The purge (SM-8): a link with no text left goes after 24 months too (SM-14).
create or replace function private.job_sms_purge()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_batch bigint;
  v_bodies bigint := 0;
  v_numbers bigint := 0;
begin
  loop
    update public.sms_messages m set body = null, media = '[]'::jsonb, body_purged_at = pg_catalog.now()
     where m.id in (select x.id from public.sms_messages x
                     where x.body_purged_at is null
                       and x.created_at < pg_catalog.now() - interval '12 months'
                     limit 5000);
    get diagnostics v_batch = row_count;
    v_bodies := v_bodies + v_batch;
    exit when v_batch < 5000;
  end loop;
  loop
    update public.sms_messages m set peer_e164 = null, did_e164 = null
     where m.id in (select x.id from public.sms_messages x
                     where x.peer_e164 is not null
                       and x.created_at < pg_catalog.now() - interval '24 months'
                     limit 5000);
    get diagnostics v_batch = row_count;
    v_numbers := v_numbers + v_batch;
    exit when v_batch < 5000;
  end loop;
  -- SM-14: a link whose number has no text left, untouched for 24 months, goes too.
  delete from public.sms_thread_links l
   where l.updated_at < pg_catalog.now() - interval '24 months'
     and not exists (select 1 from public.sms_messages m where m.org_id = l.org_id and m.peer_e164 = l.peer_e164);
  return 'bodies_purged=' || v_bodies || ' numbers_purged=' || v_numbers;
end;
$$;
-- The texts received before this migration: their numbers are linked now (each clinic with
-- Communications and Clients on).
select private.communications_link_sms_threads(o.org_id,
         (select coalesce(pg_catalog.array_agg(distinct m.peer_e164), '{}') from public.sms_messages m
           where m.org_id = o.org_id and m.direction = 'in' and m.peer_e164 is not null))
  from (select distinct m.org_id from public.org_modules m where m.module_key = 'communications' and m.enabled) o;

select pg_catalog.set_config('app.audit_source', '', true);
