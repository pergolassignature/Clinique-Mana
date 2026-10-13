-- =============================================================================
-- Demandes: the public discovery-call booking page that replaces Calendly (plan §10 D3c, R-74)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D3c); roadmap §2.3, §3.6
-- Decisions: R-74 (source tracking), D-7 … D-11 (this batch), P3-40 (module reserved for testers)
--
-- The page `/appel-decouverte?clinique=<org>` lists the free slots of a simple weekly rule
-- (Paramètres → Appels découverte), and books one through the public function `demandes-book-call`
-- (per-IP limit before any write, a proof-of-work check, D-7). A booking creates a « Nouvelle »
-- demande (channel `booking_page`, through D1's `private.demandes_insert`) with its source — the
-- « Comment avez-vous entendu parler de MANA ? » answer, the utm_* parameters, the referrer and the
-- landing page (the acceptance criterion) — and its `discovery_call` task at the slot; the
-- confirmation email carries a cancel link (secure link purpose `discovery_call`).
-- - New column `demandes.source_landing_page` (redacted in the audit like the referrer).
-- - The rule is `org_module_settings` (demandes, key `booking`), merged, never replaced:
--   `get_demandes_booking_settings` (demandes.view), `set_demandes_booking_settings`
--   (demandes.manage).
-- - Service RPCs (the function): `demandes_booking_page_for_service`, `book_discovery_call_for_service`,
--   `cancel_discovery_call_for_service`; `resolve_discovery_call_link` for resolve-link.
-- - P3-40: while Demandes is reserved for its testers (or disabled), the page offers nothing and a
--   booking is refused: nobody outside the clinic gets an email.
-- - Reportable (D6): the view `demandes_sources`.
-- Additive: one column, the audit trigger recreated with it, new functions, one view, catalogue rows.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_booking', true);

-- -----------------------------------------------------------------------------
-- The landing page (R-74)
-- -----------------------------------------------------------------------------
alter table public.demandes add column source_landing_page text;
alter table public.demandes add constraint demandes_source_landing_page_check
  check (char_length(source_landing_page) between 1 and 500 and source_landing_page !~ '[[:cntrl:]]');

-- The same trigger, now redacting the landing page too.
create or replace trigger demandes_audit after insert or update or delete on public.demandes
  for each row execute function private.audit_trigger(
    'contact_name', 'contact_email', 'contact_phone_e164', 'concerns', 'source_referrer', 'source_utm', 'source_landing_page');

-- -----------------------------------------------------------------------------
-- The weekly rule (org_module_settings, demandes, key `booking`)
-- -----------------------------------------------------------------------------
-- {enabled, slot_minutes (15 | 20 | 30 | 45 | 60), notice_hours (0–72), horizon_days (1–30: the cancel link lives until the call, 30 days at most),
--  capacity (1–5: how many calls at once), weekly: [{day 1 (Monday) … 7, start 'HH:MM', end
--  'HH:MM'}] (≤ 28 ranges)}. Until the clinic saves one, the defaults below (switched off).
create function private.demandes_booking_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"enabled": false, "slot_minutes": 15, "notice_hours": 4, "horizon_days": 14, "capacity": 1,
           "weekly": [{"day": 1, "start": "09:00", "end": "12:00"}, {"day": 1, "start": "13:00", "end": "17:00"},
                      {"day": 2, "start": "09:00", "end": "12:00"}, {"day": 2, "start": "13:00", "end": "17:00"},
                      {"day": 3, "start": "09:00", "end": "12:00"}, {"day": 3, "start": "13:00", "end": "17:00"},
                      {"day": 4, "start": "09:00", "end": "12:00"}, {"day": 4, "start": "13:00", "end": "17:00"},
                      {"day": 5, "start": "09:00", "end": "12:00"}]}'::jsonb
$$;
revoke all on function private.demandes_booking_defaults() from public, anon, authenticated, service_role;

create function private.demandes_booking_settings(p_org uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.demandes_booking_defaults()
         || coalesce((select s.settings -> 'booking' from public.org_module_settings s
                       where s.org_id = p_org and s.module_key = 'demandes'
                         and pg_catalog.jsonb_typeof(s.settings -> 'booking') = 'object'), '{}')
$$;
revoke all on function private.demandes_booking_settings(uuid) from public, anon, authenticated, service_role;

create function public.get_demandes_booking_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.demandes_require('demandes.view');
  return private.demandes_booking_settings(private.current_user_org_id());
end;
$$;
revoke all on function public.get_demandes_booking_settings() from public, anon, authenticated;
grant execute on function public.get_demandes_booking_settings() to authenticated;

-- Saves the whole rule (the form sends every field): French refusals with the field as HINT.
create function public.set_demandes_booking_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v jsonb := private.demandes_booking_defaults() || coalesce(p_settings, '{}');
  r jsonb;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform private.demandes_require('demandes.manage');
  if p_settings is null or pg_catalog.jsonb_typeof(p_settings) <> 'object'
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_settings) k
                 where k not in ('enabled', 'slot_minutes', 'notice_hours', 'horizon_days', 'capacity', 'weekly')) then
    raise exception 'Réglages invalides : objet JSON attendu (clés connues seulement).' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v -> 'enabled') <> 'boolean' then
    raise exception 'Activé : oui ou non.' using errcode = 'P0001', hint = 'enabled';
  end if;
  if pg_catalog.jsonb_typeof(v -> 'slot_minutes') <> 'number' or (v ->> 'slot_minutes') not in ('15', '20', '30', '45', '60') then
    raise exception 'La durée d''un appel est de 15, 20, 30, 45 ou 60 minutes.' using errcode = 'P0001', hint = 'slot_minutes';
  end if;
  if pg_catalog.jsonb_typeof(v -> 'notice_hours') <> 'number' or (v ->> 'notice_hours') !~ '^[0-9]{1,2}$' or (v ->> 'notice_hours')::int > 72 then
    raise exception 'Le délai minimal est de 0 à 72 heures.' using errcode = 'P0001', hint = 'notice_hours';
  end if;
  if pg_catalog.jsonb_typeof(v -> 'horizon_days') <> 'number' or (v ->> 'horizon_days') !~ '^[0-9]{1,2}$'
     or (v ->> 'horizon_days')::int not between 1 and 30 then
    raise exception 'Les appels se réservent de 1 à 30 jours à l''avance.' using errcode = 'P0001', hint = 'horizon_days';
  end if;
  if pg_catalog.jsonb_typeof(v -> 'capacity') <> 'number' or (v ->> 'capacity') !~ '^[1-5]$' then
    raise exception 'De 1 à 5 appels à la fois.' using errcode = 'P0001', hint = 'capacity';
  end if;
  if pg_catalog.jsonb_typeof(v -> 'weekly') <> 'array' or pg_catalog.jsonb_array_length(v -> 'weekly') > 28 then
    raise exception 'Les plages de la semaine : 28 au plus.' using errcode = 'P0001', hint = 'weekly';
  end if;
  for r in select x.value from pg_catalog.jsonb_array_elements(v -> 'weekly') x loop
    if pg_catalog.jsonb_typeof(r) <> 'object' or (r ->> 'day') !~ '^[1-7]$'
       or (r ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (r ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
       or (r ->> 'end') <= (r ->> 'start') then
      raise exception 'Chaque plage a un jour, une heure de début et une heure de fin plus tardive.' using errcode = 'P0001', hint = 'weekly';
    end if;
  end loop;
  -- Ranges of one day never overlap.
  if exists (select 1 from pg_catalog.jsonb_array_elements(v -> 'weekly') a, pg_catalog.jsonb_array_elements(v -> 'weekly') b
              where a.value ->> 'day' = b.value ->> 'day' and a.value <> b.value
                and a.value ->> 'start' < b.value ->> 'end' and b.value ->> 'start' < a.value ->> 'end') then
    raise exception 'Deux plages d''une même journée se chevauchent.' using errcode = 'P0001', hint = 'weekly';
  end if;
  v := pg_catalog.jsonb_build_object('enabled', v -> 'enabled', 'slot_minutes', v -> 'slot_minutes', 'notice_hours', v -> 'notice_hours',
                                     'horizon_days', v -> 'horizon_days', 'capacity', v -> 'capacity', 'weekly', v -> 'weekly');
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_demandes_booking_settings', true);
  insert into public.org_module_settings as s (org_id, module_key, settings, updated_by)
  values (v_org, 'demandes', pg_catalog.jsonb_build_object('booking', v), auth.uid())
  on conflict (org_id, module_key) do update
    set settings = s.settings || excluded.settings, updated_by = excluded.updated_by;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return private.demandes_booking_settings(v_org);
end;
$$;
revoke all on function public.set_demandes_booking_settings(jsonb) from public, anon, authenticated;
grant execute on function public.set_demandes_booking_settings(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- The free slots
-- -----------------------------------------------------------------------------
-- Every slot of the rule from now + notice to now + horizon (the clinic's time zone, its wall-clock
-- hours: a change of time is followed), less those already taken by `capacity` open discovery calls.
create function private.demandes_booking_slots(p_org uuid)
returns table (starts_at timestamptz)
language sql
stable
set search_path = ''
as $$
  with cfg as (
    select private.demandes_booking_settings(p_org) as v,
           (select o.timezone from public.organizations o where o.id = p_org) as tz
  ), bounds as (
    select cfg.v, cfg.tz,
           pg_catalog.now() + pg_catalog.make_interval(hours => (cfg.v ->> 'notice_hours')::int) as earliest,
           pg_catalog.now() + pg_catalog.make_interval(days => (cfg.v ->> 'horizon_days')::int) as latest,
           pg_catalog.make_interval(mins => (cfg.v ->> 'slot_minutes')::int) as slot
      from cfg
  ), days as (
    select b.*, d::date as day
      from bounds b,
           pg_catalog.generate_series((pg_catalog.now() at time zone b.tz)::date,
                                      (b.latest at time zone b.tz)::date, interval '1 day') d
  ), ranges as (
    select d.*, (r.value ->> 'start')::time as t0,
           case when r.value ->> 'end' = '24:00' then interval '24 hours' else (r.value ->> 'end')::time - time '00:00' end as t1
      from days d, pg_catalog.jsonb_array_elements(d.v -> 'weekly') r
     where (r.value ->> 'day')::int = pg_catalog.date_part('isodow', d.day)::int
  ), slots as (
    select (s at time zone r.tz) as starts_at, r.earliest, r.latest, (r.v ->> 'capacity')::int as capacity
      from ranges r,
           pg_catalog.generate_series(r.day + r.t0, r.day + r.t1 - r.slot, r.slot) s
  )
  select s.starts_at from slots s
   where s.starts_at >= s.earliest and s.starts_at <= s.latest
     and (select count(*) from public.demande_tasks t
           where t.org_id = p_org and t.kind = 'discovery_call' and t.state = 'open' and t.due_at = s.starts_at) < s.capacity
   order by s.starts_at
$$;
revoke all on function private.demandes_booking_slots(uuid) from public, anon, authenticated, service_role;

-- What the public page may show and offer: nothing while the module is disabled or reserved for its
-- testers (P3-40), or while the clinic has not switched booking on.
create function private.demandes_booking_open(p_org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.module_open_to_all_for_org(p_org, 'demandes')
     and coalesce((private.demandes_booking_settings(p_org) ->> 'enabled')::boolean, false)
$$;
revoke all on function private.demandes_booking_open(uuid) from public, anon, authenticated, service_role;

-- The public page's content: {open, clinic_name, timezone, slot_minutes, slots, referral_sources
-- [{id, name}]} (the « Comment avez-vous entendu parler de MANA ? » list, active entries). An
-- unknown clinic reads as closed: the page never says which ids exist.
create function public.demandes_booking_page_for_service(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_cfg jsonb;
begin
  select o.* into v_org from public.organizations o where o.id = p_org_id;
  if v_org.id is null or not private.demandes_booking_open(p_org_id) then
    return pg_catalog.jsonb_build_object('open', false);
  end if;
  v_cfg := private.demandes_booking_settings(p_org_id);
  return pg_catalog.jsonb_build_object(
    'open', true,
    'clinic_name', v_org.name,
    'timezone', v_org.timezone,
    'slot_minutes', (v_cfg ->> 'slot_minutes')::int,
    'slots', coalesce((select pg_catalog.jsonb_agg(s.starts_at order by s.starts_at) from private.demandes_booking_slots(p_org_id) s), '[]'),
    'referral_sources', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', r.id, 'name', r.name) order by r.sort_order, r.name)
                                    from public.referral_sources r where r.org_id = p_org_id and r.is_active), '[]'));
end;
$$;
revoke all on function public.demandes_booking_page_for_service(uuid) from public, anon, authenticated;
grant execute on function public.demandes_booking_page_for_service(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Booking
-- -----------------------------------------------------------------------------
-- p_payload: {starts_at, first_name, last_name, email, phone_e164, language (fr | en), message
-- (optional, ≤ 1000: what the person wants the counselor to know), referral_source_id, source_utm
-- {utm_*}, source_referrer, source_landing_page}. p_token_hash: the cancel link's. Returns what the
-- confirmation needs {demande_id, task_id, reference, starts_at, clinic_name, timezone, language,
-- first_name, email, link_expires_at}. Refusals in French (P0001, HINT the field or `slot`,
-- `closed`, `already_booked`).
create function public.book_discovery_call_for_service(p_org_id uuid, p_payload jsonb, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_starts timestamptz;
  v_first text := private.demandes_clean(p_payload ->> 'first_name', 100);
  v_last text := private.demandes_clean(p_payload ->> 'last_name', 100);
  v_email text := pg_catalog.lower(private.demandes_clean(p_payload ->> 'email', 254));
  v_phone text := private.demandes_clean(p_payload ->> 'phone_e164', 20);
  v_language text := coalesce(nullif(p_payload ->> 'language', ''), 'fr');
  v_message text := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'message', '')), '');
  v_source uuid;
  v_demande uuid;
  v_task uuid;
  v_link uuid;
  v_expires timestamptz;
begin
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' or p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    raise exception 'Invalid booking' using errcode = '22023';
  end if;
  select o.* into v_org from public.organizations o where o.id = p_org_id;
  if v_org.id is null or not private.demandes_booking_open(p_org_id) then
    raise exception 'La prise de rendez-vous en ligne n''est pas ouverte pour le moment. Appelez la clinique.'
      using errcode = 'P0001', hint = 'closed';
  end if;
  begin
    v_starts := (p_payload ->> 'starts_at')::timestamptz;
  exception when others then
    v_starts := null;
  end;
  if v_first is null or v_last is null then
    raise exception 'Indiquez votre prénom et votre nom.' using errcode = 'P0001', hint = 'name';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Indiquez une adresse courriel valide : la confirmation y est envoyée.' using errcode = 'P0001', hint = 'email';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Le numéro de téléphone n''est pas valide.' using errcode = 'P0001', hint = 'phone';
  end if;
  if v_phone is null then
    raise exception 'Indiquez un numéro de téléphone : la conseillère vous appelle à ce numéro.' using errcode = 'P0001', hint = 'phone';
  end if;
  if v_language not in ('fr', 'en') then
    raise exception 'Choisissez le français ou l''anglais.' using errcode = 'P0001', hint = 'language';
  end if;
  if v_message is not null and pg_catalog.length(v_message) > 1000 then
    raise exception 'Le message compte 1 000 caractères au plus.' using errcode = 'P0001', hint = 'message';
  end if;
  begin
    v_source := nullif(p_payload ->> 'referral_source_id', '')::uuid;
  exception when others then
    v_source := null;
  end;
  if v_source is not null and not exists (select 1 from public.referral_sources r where r.org_id = p_org_id and r.id = v_source and r.is_active) then
    v_source := null;  -- a stale list: the answer is dropped, never the booking
  end if;

  -- One booking at a time per clinic: a slot is never given twice.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('demandes.booking:' || p_org_id::text, 0));
  if v_starts is null or not exists (select 1 from private.demandes_booking_slots(p_org_id) s where s.starts_at = v_starts) then
    raise exception 'Cette plage n''est plus libre : choisissez-en une autre.' using errcode = 'P0001', hint = 'slot';
  end if;
  if exists (select 1 from public.demande_tasks t join public.demandes d on d.id = t.demande_id and d.org_id = t.org_id
              where t.org_id = p_org_id and t.kind = 'discovery_call' and t.state = 'open' and t.due_at > pg_catalog.now()
                and d.contact_email = v_email and d.channel = 'booking_page') then
    raise exception 'Un appel découverte est déjà prévu avec cette adresse : utilisez le lien d''annulation reçu par courriel pour le changer.'
      using errcode = 'P0001', hint = 'already_booked';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:book_discovery_call', true);
  v_demande := private.demandes_insert(p_org_id, pg_catalog.jsonb_build_object(
    'channel', 'booking_page',
    'contact_name', v_first || ' ' || v_last,
    'contact_email', v_email,
    'contact_phone_e164', v_phone,
    'language', v_language,
    'concerns', v_message,
    'referral_source_id', v_source,
    'source_utm', case when pg_catalog.jsonb_typeof(p_payload -> 'source_utm') = 'object' then p_payload -> 'source_utm' else '{}'::jsonb end,
    'source_referrer', private.demandes_clean(p_payload ->> 'source_referrer', 500)), null);
  update public.demandes d set source_landing_page = private.demandes_clean(p_payload ->> 'source_landing_page', 500)
   where d.id = v_demande and private.demandes_clean(p_payload ->> 'source_landing_page', 500) is not null;
  insert into public.demande_tasks (demande_id, org_id, kind, due_at)
  values (v_demande, p_org_id, 'discovery_call', v_starts)
  returning id into v_task;
  -- The cancel link: valid until the call.
  v_link := private.issue_secure_link(p_org_id, 'discovery_call', 'demande_task', v_task, p_token_hash, null,
                                      least(greatest(v_starts - pg_catalog.now(), interval '1 hour'), interval '30 days'), '{}');
  select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
  return pg_catalog.jsonb_build_object(
    'demande_id', v_demande, 'task_id', v_task,
    'reference', (select d.reference from public.demandes d where d.id = v_demande),
    'starts_at', v_starts, 'clinic_name', v_org.name, 'timezone', v_org.timezone,
    'language', v_language, 'first_name', v_first, 'email', v_email, 'link_expires_at', v_expires);
end;
$$;
revoke all on function public.book_discovery_call_for_service(uuid, jsonb, bytea) from public, anon, authenticated;
grant execute on function public.book_discovery_call_for_service(uuid, jsonb, bytea) to service_role;

-- -----------------------------------------------------------------------------
-- Cancelling (the confirmation's link)
-- -----------------------------------------------------------------------------
-- What resolve-link shows: the clinic and the call's time, only while it can be cancelled.
create function public.resolve_discovery_call_link(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('clinic_name', o.name, 'timezone', o.timezone, 'starts_at', t.due_at, 'language', d.language)
    from public.secure_links l
    join public.demande_tasks t on t.id = l.subject_id and t.org_id = l.org_id
    join public.demandes d on d.id = t.demande_id and d.org_id = t.org_id
    join public.organizations o on o.id = l.org_id
   where l.id = p_link_id and l.purpose = 'discovery_call' and l.subject_type = 'demande_task'
     and l.revoked_at is null and l.expires_at > pg_catalog.now() and l.use_count < l.max_uses
     and t.state = 'open' and t.kind = 'discovery_call'
$$;
revoke all on function public.resolve_discovery_call_link(uuid) from public, anon, authenticated;
grant execute on function public.resolve_discovery_call_link(uuid) to service_role;

insert into public.secure_link_purposes
  (key, module_key, default_ttl, max_ttl, max_uses, requires_session, creates_account, resolve_rpc, accept_rpc, view_permission)
values ('discovery_call', 'demandes', interval '14 days', interval '30 days', 1, false, false,
        'resolve_discovery_call_link', null, 'demandes.view')
on conflict do nothing;

-- Cancels the call by its link (one use): the task is cancelled, the link spent; a request still
-- « Nouvelle » with nothing else open is closed « La personne s'est retirée ». Returns {state:
-- cancelled | invalid}.
create function public.cancel_discovery_call_for_service(p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.secure_links;
  v_task public.demande_tasks;
  v_row public.demandes;
begin
  select l.* into v_link from public.secure_links l
   where l.token_hash = p_token_hash and l.purpose = 'discovery_call' and l.subject_type = 'demande_task'
   for update;
  if v_link.id is null or v_link.revoked_at is not null or v_link.expires_at <= pg_catalog.now() or v_link.use_count >= v_link.max_uses then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  select t.* into v_task from public.demande_tasks t where t.id = v_link.subject_id and t.org_id = v_link.org_id for update;
  if v_task.id is null or v_task.state <> 'open' then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:cancel_discovery_call', true);
  perform private.consume_secure_link(p_token_hash, 'discovery_call');
  update public.demande_tasks t set state = 'cancelled', done_at = pg_catalog.now() where t.id = v_task.id;
  select d.* into v_row from public.demandes d where d.id = v_task.demande_id and d.org_id = v_task.org_id for update;
  if v_row.state = 'new' and not exists (select 1 from public.demande_tasks t
                                           where t.demande_id = v_row.id and t.org_id = v_row.org_id and t.state = 'open') then
    update public.demandes d set state = 'closed', closed_reason = 'withdrew', closed_at = pg_catalog.now() where d.id = v_row.id;
    insert into public.demande_events (demande_id, org_id, kind, from_state, to_state)
    values (v_row.id, v_row.org_id, 'state_changed', 'new', 'closed');
  end if;
  return pg_catalog.jsonb_build_object('state', 'cancelled');
end;
$$;
revoke all on function public.cancel_discovery_call_for_service(bytea) from public, anon, authenticated;
grant execute on function public.cancel_discovery_call_for_service(bytea) to service_role;

-- -----------------------------------------------------------------------------
-- The confirmation email
-- -----------------------------------------------------------------------------
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission)
values
  ('demandes.discovery_call_booked', 'demandes',
   'Appel découverte réservé',
   'Envoyé à la personne qui vient de réserver un appel découverte sur la page de la clinique.',
   'Vous recevez ce courriel parce que vous avez réservé un appel découverte avec la clinique.',
   'Votre appel découverte — {{clinic.name}}',
   E'Bonjour {{person.first_name}},\n\n'
   'Votre appel découverte avec {{clinic.name}} est prévu le {{call.starts_at}}. Une conseillère vous appellera au numéro que vous avez indiqué.\n\n'
   'Un empêchement ? Annulez l''appel avec le bouton ci-dessous, puis réservez une autre plage.',
   'Annuler l''appel',
   '[
     {"path": "person.first_name", "label": "Prénom de la personne", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "call.starts_at", "label": "Date et heure de l''appel", "sample": "15 octobre 2026 à 14 h 30", "required": true, "kind": "datetime"}
   ]',
   'demandes.view'),
  ('demandes.discovery_call_booked_en', 'demandes',
   'Appel découverte réservé (anglais)',
   'La confirmation envoyée en anglais, quand la personne a choisi l''anglais.',
   'You receive this email because you booked a discovery call with the clinic.',
   'Your discovery call — {{clinic.name}}',
   E'Hello {{person.first_name}},\n\n'
   'Your discovery call with {{clinic.name}} is scheduled for {{call.starts_at}}. A counselor will call you at the number you gave.\n\n'
   'Something came up? Cancel the call with the button below, then book another time.',
   'Cancel the call',
   '[
     {"path": "person.first_name", "label": "Prénom de la personne", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "call.starts_at", "label": "Date et heure de l''appel", "sample": "October 15, 2026 at 2:30 PM", "required": true, "kind": "datetime"}
   ]',
   'demandes.view')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Reportable sources (D6, R-74)
-- -----------------------------------------------------------------------------
-- One row per request with where it came from (staff with demandes.view, through the requests' own
-- policy): the channel, the « Comment avez-vous entendu parler de MANA ? » answer and its name, the
-- campaign, the utm_* parameters, the referrer and the landing page.
create view public.demandes_sources with (security_invoker = true) as
select d.id, d.org_id, d.reference, d.received_at, d.channel, d.state,
       d.referral_source_id, r.name as referral_source_name,
       d.source_campaign,
       d.source_utm ->> 'utm_source' as utm_source,
       d.source_utm ->> 'utm_medium' as utm_medium,
       d.source_utm ->> 'utm_campaign' as utm_campaign,
       d.source_utm ->> 'utm_term' as utm_term,
       d.source_utm ->> 'utm_content' as utm_content,
       d.source_referrer, d.source_landing_page
  from public.demandes d
  left join public.referral_sources r on r.org_id = d.org_id and r.id = d.referral_source_id;
revoke all on public.demandes_sources from anon, authenticated;
grant select on public.demandes_sources to authenticated;
