-- =============================================================================
-- Demandes: the waiting list, part 1 (plan §10 D3; roadmap §2.3 bis)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D3); roadmap §2.3 bis
-- Decisions: D-15 … D-19 (this batch), P3-40 (module reserved for testers)
-- Needs:     D1's waitlist tables (*_demandes_module.sql), Clients' consents (C5a:
--            private.required_consents_for, client_consents_status), Services et tarifs (S1/S2:
--            services_catalog, private.service_price), core's notices, links, email, jobs.
--
-- - Registration (D-15): `register_waitlist` from a request with a client file, one entry per
--   target (a profession and / or a professional), the criteria copied from the request, a priority
--   with its reason; the request moves to « Liste d'attente ». `set_demande_state` now refuses that
--   move without an open entry, and closes the open entries when the request is matched (« Placée »)
--   or closed (the closing reason's twin).
-- - Complete (D-16): an entry is `incomplete` until the « liste d'attente » consent is in force (or
--   not required: its rule is off) and the fee paid or waived; `private.waitlist_promote` moves it to
--   `active` after every write, when the list is read, and in the daily job (a consent is signed on
--   Clients' side, which has no hook). The fee is Services et tarifs' « Inscription à la liste
--   d'attente » (key `waitlist_registration`); « Facturer l'inscription » comes with Facturation.
-- - Work on an entry (`demandes.waitlist`): `update_waitlist_entry` (priority, criteria, bridge
--   professional, next call), `set_waitlist_fee`, `log_waitlist_contact`, `add_waitlist_offer` /
--   `answer_waitlist_offer` (an offer made by phone, noted by hand), `exit_waitlist` (D-18).
-- - Reads (`demandes.view`): `list_waitlist` (rank in its list, days waited, consent, fee),
--   `waitlist_lists` (every active profession and professional with its counts and average wait,
--   D-19), `get_waitlist_entry` (contacts, offers, the fee's price).
-- - Follow-up (D-17): settings `org_module_settings` (demandes, key `waitlist`); the job
--   `demandes.waitlist_followup` (function `demandes-waitlist-followup`, 7 h clinic time) marks
--   « À rappeler » and posts one notice; optionally emails « Souhaitez-vous rester sur la liste
--   d'attente ? » (`demandes.waitlist_still_waiting` / `_en`) with a link (purpose
--   `waitlist_followup`) to `/liste-attente/reponse`, answered through `demandes-waitlist-answer`.
--   P3-40: no email while Demandes is reserved for its testers (both service RPCs check it).
-- Additive: new functions, catalogue rows, one trigger; `set_demande_state` replaced (same
-- signature).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_waitlist', true);

-- -----------------------------------------------------------------------------
-- Settings (org_module_settings, demandes, key `waitlist`)
-- -----------------------------------------------------------------------------
-- {followup_weeks (1–26: an active entry without a conversation for that long is « À rappeler »),
--  followup_email (the « still waiting? » email, off by default), answer_days (3–30: how long its
--  link lives; then « Sans réponse »)}.
create function private.demandes_waitlist_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"followup_weeks": 8, "followup_email": false, "answer_days": 14}'::jsonb
$$;
revoke all on function private.demandes_waitlist_defaults() from public, anon, authenticated, service_role;

create function private.demandes_waitlist_settings(p_org uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.demandes_waitlist_defaults()
         || coalesce((select s.settings -> 'waitlist' from public.org_module_settings s
                       where s.org_id = p_org and s.module_key = 'demandes'
                         and pg_catalog.jsonb_typeof(s.settings -> 'waitlist') = 'object'), '{}')
$$;
revoke all on function private.demandes_waitlist_settings(uuid) from public, anon, authenticated, service_role;

create function public.get_demandes_waitlist_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.demandes_require('demandes.view');
  return private.demandes_waitlist_settings(private.current_user_org_id());
end;
$$;
revoke all on function public.get_demandes_waitlist_settings() from public, anon, authenticated;
grant execute on function public.get_demandes_waitlist_settings() to authenticated;

create function public.set_demandes_waitlist_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v jsonb := private.demandes_waitlist_defaults() || coalesce(p_settings, '{}');
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform private.demandes_require('demandes.waitlist');
  if p_settings is null or pg_catalog.jsonb_typeof(p_settings) <> 'object'
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_settings) k
                 where k not in ('followup_weeks', 'followup_email', 'answer_days')) then
    raise exception 'Réglages invalides : objet JSON attendu (clés connues seulement).' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(v -> 'followup_weeks') <> 'number' or (v ->> 'followup_weeks') !~ '^[0-9]{1,2}$'
     or (v ->> 'followup_weeks')::int not between 1 and 26 then
    raise exception 'Le rappel se fait après 1 à 26 semaines sans nouvelles.' using errcode = 'P0001', hint = 'followup_weeks';
  end if;
  if pg_catalog.jsonb_typeof(v -> 'followup_email') <> 'boolean' then
    raise exception 'Le courriel de suivi : oui ou non.' using errcode = 'P0001', hint = 'followup_email';
  end if;
  if pg_catalog.jsonb_typeof(v -> 'answer_days') <> 'number' or (v ->> 'answer_days') !~ '^[0-9]{1,2}$'
     or (v ->> 'answer_days')::int not between 3 and 30 then
    raise exception 'La personne a de 3 à 30 jours pour répondre.' using errcode = 'P0001', hint = 'answer_days';
  end if;
  v := pg_catalog.jsonb_build_object('followup_weeks', v -> 'followup_weeks', 'followup_email', v -> 'followup_email',
                                     'answer_days', v -> 'answer_days');
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_demandes_waitlist_settings', true);
  insert into public.org_module_settings as s (org_id, module_key, settings, updated_by)
  values (v_org, 'demandes', pg_catalog.jsonb_build_object('waitlist', v), auth.uid())
  on conflict (org_id, module_key) do update
    set settings = s.settings || excluded.settings, updated_by = excluded.updated_by;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return private.demandes_waitlist_settings(v_org);
end;
$$;
revoke all on function public.set_demandes_waitlist_settings(jsonb) from public, anon, authenticated;
grant execute on function public.set_demandes_waitlist_settings(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- The consent and the fee (D-16)
-- -----------------------------------------------------------------------------
-- The « liste d'attente » consent for the entry's client: `signed`, `resign` (in force, a new
-- version to sign), `pending`, `missing`, or `not_required` (its rule is off: Paramètres →
-- Consentements). Clients' published `required_consents_for`, situation `waitlist`.
create function private.waitlist_consent_state(p_org uuid, p_client uuid, p_entry uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select r.state from private.required_consents_for(p_org, p_client, null, null, null, array['waitlist'],
                                                                     'waitlist_entry', p_entry) r
                    where r.consent_key = 'waitlist'), 'not_required')
$$;
revoke all on function private.waitlist_consent_state(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- The fee service (Services et tarifs, key `waitlist_registration`) and its price for the client
-- today (her rate variant and tax exemption): one row, or none when the clinic has no such service.
create function private.waitlist_fee(p_org uuid, p_client uuid)
returns table (service_id uuid, code int, name text, price_cents int, tax_rule text)
language sql
stable
set search_path = ''
as $$
  select s.id, s.code, s.name, p.price_cents, p.tax_rule
    from public.services_catalog s
    join public.organizations o on o.id = s.org_id
    left join public.clients_directory c on c.org_id = s.org_id and c.id = p_client
   cross join lateral private.service_price(s.org_id, s.id, null, c.rate_variant,
                                             (pg_catalog.now() at time zone o.timezone)::date, coalesce(c.tax_exempt, false)) p
   where s.org_id = p_org and s.key = 'waitlist_registration'
   limit 1
$$;
revoke all on function private.waitlist_fee(uuid, uuid) from public, anon, authenticated, service_role;

-- Moves the clinic's `incomplete` entries (or one) whose consent is in force or not required and
-- whose fee is paid or waived to `active`, with the consent's date. Returns how many moved.
create function private.waitlist_promote(p_org uuid, p_entry uuid default null)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  with ready as (
    select e.id, e.client_id
      from public.waitlist_entries e
     where e.org_id = p_org and e.state = 'incomplete' and (p_entry is null or e.id = p_entry)
       and e.fee_status in ('paid', 'waived') and e.client_id is not null
       and private.waitlist_consent_state(p_org, e.client_id, e.id) in ('signed', 'resign', 'not_required')
  )
  update public.waitlist_entries e
     set state = 'active',
         consent_signed_at = (select s.signed_at from public.client_consents_status s
                               where s.org_id = p_org and s.client_id = r.client_id and s.consent_key = 'waitlist'
                                 and s.signed_at is not null
                               order by s.signed_at desc limit 1)
    from ready r
   where e.id = r.id and e.state = 'incomplete' and e.fee_status in ('paid', 'waived');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.waitlist_promote(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Leaving the list (D-18)
-- -----------------------------------------------------------------------------
-- Closes one entry with its reason (pending offers withdrawn).
create function private.waitlist_close(p_entry uuid, p_reason text, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.waitlist_entries e
     set state = 'closed', exit_reason = p_reason, exited_at = pg_catalog.now(), exited_by = p_actor, next_contact_at = null
   where e.id = p_entry and e.state <> 'closed';
  update public.waitlist_offers o
     set response = 'withdrawn', responded_at = pg_catalog.now()
   where o.entry_id = p_entry and o.response = 'pending';
end;
$$;
revoke all on function private.waitlist_close(uuid, text, uuid) from public, anon, authenticated, service_role;

-- The request's closing reason for an exit reason, and back.
create function private.waitlist_closed_reason(p_exit text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_exit when 'referred_elsewhere' then 'referred_out' when 'withdrew' then 'withdrew'
                     when 'no_answer' then 'no_answer' else 'other' end
$$;
revoke all on function private.waitlist_closed_reason(text) from public, anon, authenticated, service_role;

create function private.waitlist_exit_reason(p_closed text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_closed when 'referred_out' then 'referred_elsewhere' when 'withdrew' then 'withdrew'
                       when 'no_answer' then 'no_answer' else 'other' end
$$;
revoke all on function private.waitlist_exit_reason(text) from public, anon, authenticated, service_role;

-- After an exit: a request still « Liste d'attente » with no open entry left is closed with the
-- exit's reason (the history says so).
create function private.waitlist_after_exit(p_org uuid, p_demande uuid, p_exit text, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row public.demandes;
begin
  select d.* into v_row from public.demandes d where d.id = p_demande and d.org_id = p_org for no key update;
  if v_row.state <> 'waitlist'
     or exists (select 1 from public.waitlist_entries e where e.demande_id = p_demande and e.org_id = p_org and e.state <> 'closed') then
    return;
  end if;
  update public.demandes d
     set state = 'closed', closed_reason = private.waitlist_closed_reason(p_exit), closed_at = pg_catalog.now(), next_contact_at = null
   where d.id = p_demande;
  insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, closed_reason, by_user)
  values (p_demande, p_org, 'state_changed', 'waitlist', 'closed', private.waitlist_closed_reason(p_exit), p_actor);
end;
$$;
revoke all on function private.waitlist_after_exit(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

-- Placed with p_professional: every open entry of the request closes « Placée » and the request
-- is matched with her (as `set_demande_state`: her link to the clients, the history). A request
-- that cannot move to « Jumelée » (« Nouvelle », « En évaluation ») is refused before anything closes.
create function private.waitlist_place(p_org uuid, p_demande uuid, p_professional uuid, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row public.demandes;
  e record;
begin
  if p_professional is null or not exists (
       select 1 from public.professionals_directory p where p.id = p_professional and p.org_id = p_org and p.status = 'active') then
    raise exception 'Choisissez un professionnel actif de la clinique.' using errcode = 'P0001';
  end if;
  select d.* into v_row from public.demandes d where d.id = p_demande and d.org_id = p_org for no key update;
  if v_row.state <> 'matched' and not private.demande_state_allowed(v_row.state, 'matched') then
    raise exception 'Cette demande ne peut pas être jumelée depuis « % » : changez d''abord son état.',
      private.demande_state_label(v_row.state) using errcode = 'P0001';
  end if;
  for e in select x.id from public.waitlist_entries x where x.demande_id = p_demande and x.org_id = p_org and x.state <> 'closed' loop
    perform private.waitlist_close(e.id, 'placed', p_actor);
  end loop;
  if v_row.state = 'matched' then
    return;
  end if;
  update public.demandes d
     set state = 'matched', closed_reason = null, closed_at = null,
         matched_professional_id = p_professional, matched_at = pg_catalog.now()
   where d.id = p_demande;
  perform private.demandes_link_clients(p_org, p_demande);
  insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, professional_id, by_user)
  values (p_demande, p_org, 'state_changed', v_row.state, 'matched', p_professional, p_actor);
end;
$$;
revoke all on function private.waitlist_place(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- set_demande_state, now with the list (D-15): same rules as D1, plus
-- * to « Liste d'attente » only with an open entry (registration is `register_waitlist`);
-- * matched or closed: the open entries close (« Placée », or the closing reason's twin).
-- -----------------------------------------------------------------------------
create or replace function public.set_demande_state(p_id uuid, p_state text, p_closed_reason text default null, p_professional_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  e record;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_id);
  if p_state is null or p_state = v_row.state or not private.demande_state_allowed(v_row.state, p_state) then
    raise exception 'Cette demande ne peut pas passer de « % » à « % ».',
      private.demande_state_label(v_row.state), coalesce(private.demande_state_label(p_state), p_state)
      using errcode = 'P0001';
  end if;
  if p_state = 'waitlist' and not exists (
       select 1 from public.waitlist_entries x where x.demande_id = v_row.id and x.org_id = v_row.org_id and x.state <> 'closed') then
    raise exception 'Pour la liste d''attente, inscrivez la demande : « Inscrire sur la liste d''attente ».' using errcode = 'P0001';
  end if;
  if p_state = 'closed' and p_closed_reason is null then
    raise exception 'Indiquez pourquoi la demande est fermée.' using errcode = 'P0001';
  end if;
  if p_state <> 'closed' and p_closed_reason is not null then
    raise exception 'A closing reason is only for a closed request' using errcode = '22023';
  end if;
  if p_state = 'matched' then
    if p_professional_id is null or not exists (
         select 1 from public.professionals_directory p
          where p.id = p_professional_id and p.org_id = v_row.org_id and p.status = 'active') then
      raise exception 'Choisissez un professionnel actif de la clinique.' using errcode = 'P0001';
    end if;
  elsif p_professional_id is not null then
    raise exception 'A professional is only for a matched request' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:set_demande_state', true);
  update public.demandes d set
    state = p_state,
    closed_reason = case when p_state = 'closed' then p_closed_reason end,
    closed_at = case when p_state = 'closed' then pg_catalog.now() end,
    matched_professional_id = case when p_state = 'matched' then p_professional_id
                                   when p_state = 'closed' then d.matched_professional_id end,
    matched_at = case when p_state = 'matched' then pg_catalog.now()
                      when p_state = 'closed' then d.matched_at end,
    next_contact_at = case when p_state = 'closed' then null else d.next_contact_at end
   where d.id = v_row.id;
  if p_state = 'matched' then
    perform private.demandes_link_clients(v_row.org_id, v_row.id);
  end if;
  if p_state in ('matched', 'closed') then
    for e in select x.id from public.waitlist_entries x where x.demande_id = v_row.id and x.org_id = v_row.org_id and x.state <> 'closed' loop
      perform private.waitlist_close(e.id, case when p_state = 'matched' then 'placed' else private.waitlist_exit_reason(p_closed_reason) end,
                                     auth.uid());
    end loop;
  end if;
  insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, closed_reason, professional_id, by_user)
  values (v_row.id, v_row.org_id, 'state_changed', v_row.state, p_state, p_closed_reason,
          case when p_state = 'matched' then p_professional_id end, auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- Registration (D-15)
-- -----------------------------------------------------------------------------
-- The entry p_id of the caller's clinic, locked (its request first); P0001 when there is none, or
-- when it is closed and p_open.
create function private.waitlist_lock(p_id uuid, p_open boolean default true)
returns public.waitlist_entries
language plpgsql
set search_path = ''
as $$
declare
  v public.waitlist_entries;
  v_demande uuid;
begin
  -- The request first, then the entry: the order `set_demande_state` locks them in.
  select e.demande_id into v_demande from public.waitlist_entries e
   where e.id = p_id and e.org_id = private.current_user_org_id();
  perform 1 from public.demandes d where d.id = v_demande for no key update;
  select * into v from public.waitlist_entries e
   where e.id = p_id and e.org_id = private.current_user_org_id()
   for update;
  if v.id is null then
    raise exception 'Cette inscription n''existe pas.' using errcode = 'P0001';
  end if;
  if p_open and v.state = 'closed' then
    raise exception 'Cette personne n''est plus sur la liste d''attente.' using errcode = 'P0001';
  end if;
  return v;
end;
$$;
revoke all on function private.waitlist_lock(uuid, boolean) from public, anon, authenticated, service_role;

-- A priority's reason: required for « Prioritaire », none for « Normale ».
create function private.waitlist_check_priority(p_priority text, p_reason text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_priority is null or p_priority not in ('normal', 'priority') then
    raise exception 'Unknown priority' using errcode = '22023';
  end if;
  if p_priority = 'priority' and p_reason is null then
    raise exception 'Indiquez pourquoi l''inscription est prioritaire.' using errcode = 'P0001', hint = 'priority_reason';
  end if;
  if p_reason is not null and pg_catalog.char_length(p_reason) > 300 then
    raise exception 'La raison compte 300 caractères au plus.' using errcode = 'P0001', hint = 'priority_reason';
  end if;
end;
$$;
revoke all on function private.waitlist_check_priority(text, text) from public, anon, authenticated, service_role;

-- p_targets: 1 or 2 of {"title_id": …} (an active profession) and {"professional_id": …} (an
-- active professional), at most one of each. The request needs a client file and must be open (not
-- matched, not closed); it moves to « Liste d'attente ». Returns the entries' ids.
create function public.register_waitlist(p_demande_id uuid, p_targets jsonb, p_priority text default 'normal', p_priority_reason text default null)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_reason text := private.demandes_clean(p_priority_reason, 1000);
  v_target jsonb;
  v_title uuid;
  v_pro uuid;
  v_titles int := 0;
  v_pros int := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_motifs uuid[];
begin
  perform private.demandes_require('demandes.waitlist');
  v_row := private.demandes_lock(p_demande_id);
  if v_row.state in ('matched', 'closed') then
    raise exception 'Une demande jumelée ou fermée ne s''inscrit pas sur la liste d''attente.' using errcode = 'P0001';
  end if;
  if v_row.client_id is null then
    raise exception 'Rattachez d''abord le dossier du client (onglet Accueil).' using errcode = 'P0001', hint = 'client_id';
  end if;
  if p_priority = 'normal' then
    v_reason := null;
  end if;
  perform private.waitlist_check_priority(p_priority, v_reason);
  if p_targets is null or pg_catalog.jsonb_typeof(p_targets) <> 'array' or pg_catalog.jsonb_array_length(p_targets) not between 1 and 2 then
    raise exception 'Choisissez une profession, un professionnel, ou les deux.' using errcode = 'P0001', hint = 'targets';
  end if;

  select coalesce(array_agg(m.motif_id order by m.motif_id), '{}') into v_motifs
    from public.demande_motifs m where m.demande_id = v_row.id and m.org_id = v_row.org_id;
  perform pg_catalog.set_config('app.audit_source', 'rpc:register_waitlist', true);
  for v_target in select x.value from pg_catalog.jsonb_array_elements(p_targets) x loop
    v_title := null;
    v_pro := null;
    begin
      v_title := nullif(v_target ->> 'title_id', '')::uuid;
      v_pro := nullif(v_target ->> 'professional_id', '')::uuid;
    exception when others then
      raise exception 'Invalid target' using errcode = '22023';
    end;
    if pg_catalog.jsonb_typeof(v_target) <> 'object' or num_nonnulls(v_title, v_pro) <> 1 then
      raise exception 'Invalid target' using errcode = '22023';
    end if;
    if v_title is not null then
      v_titles := v_titles + 1;
      if not exists (select 1 from public.profession_titles_catalog t where t.id = v_title and t.org_id = v_row.org_id) then
        raise exception 'Choisissez une profession de la clinique.' using errcode = 'P0001', hint = 'targets';
      end if;
    else
      v_pros := v_pros + 1;
      if not exists (select 1 from public.professionals_directory p where p.id = v_pro and p.org_id = v_row.org_id and p.status = 'active') then
        raise exception 'Choisissez un professionnel actif de la clinique.' using errcode = 'P0001', hint = 'targets';
      end if;
    end if;
    if v_titles > 1 or v_pros > 1 then
      raise exception 'Une profession et un professionnel au plus.' using errcode = 'P0001', hint = 'targets';
    end if;
    if exists (select 1 from public.waitlist_entries e
                where e.demande_id = v_row.id and e.state <> 'closed'
                  and (e.target_profession_title_id = v_title or e.target_professional_id = v_pro)) then
      raise exception 'Cette demande est déjà sur cette liste d''attente.' using errcode = 'P0001', hint = 'targets';
    end if;
    insert into public.waitlist_entries
      (org_id, demande_id, client_id, target_profession_title_id, target_professional_id, priority, priority_reason,
       registered_by, availability_periods, availability_days, modality, language, preferred_pro_gender, clientele_id,
       payer_kind, motif_ids)
    values
      (v_row.org_id, v_row.id, v_row.client_id, v_title, v_pro, p_priority, v_reason,
       auth.uid(), v_row.availability_periods, v_row.availability_days, v_row.modality, v_row.language,
       v_row.preferred_pro_gender, v_row.clientele_id, v_row.payer_kind, v_motifs)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  if v_row.state <> 'waitlist' then
    update public.demandes d set state = 'waitlist' where d.id = v_row.id;
    insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, by_user)
    values (v_row.id, v_row.org_id, 'state_changed', v_row.state, 'waitlist', auth.uid());
  end if;
  perform private.waitlist_promote(v_row.org_id, x) from pg_catalog.unnest(v_ids) x;
  return v_ids;
end;
$$;
revoke all on function public.register_waitlist(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.register_waitlist(uuid, jsonb, text, text) to authenticated;

-- p_patch: any of priority + priority_reason, availability_periods, availability_days, modality,
-- language, preferred_pro_gender, clientele_id, payer_kind, motif_ids (catalogue ids),
-- bridge_professional_id (an active professional, or null), next_contact_at (or null).
create function public.update_waitlist_entry(p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.waitlist_entries;
  v_priority text;
  v_reason text;
  v_motifs uuid[];
  v_bridge uuid;
begin
  perform private.demandes_require('demandes.waitlist');
  v := private.waitlist_lock(p_id);
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object'
     or exists (select 1 from pg_catalog.jsonb_object_keys(p_patch) k
                 where k not in ('priority', 'priority_reason', 'availability_periods', 'availability_days', 'modality', 'language',
                                 'preferred_pro_gender', 'clientele_id', 'payer_kind', 'motif_ids', 'bridge_professional_id',
                                 'next_contact_at')) then
    raise exception 'Invalid patch' using errcode = '22023';
  end if;
  v_priority := coalesce(p_patch ->> 'priority', v.priority);
  v_reason := case when p_patch ? 'priority_reason' then private.demandes_clean(p_patch ->> 'priority_reason', 1000) else v.priority_reason end;
  if v_priority = 'normal' then
    v_reason := null;
  end if;
  perform private.waitlist_check_priority(v_priority, v_reason);
  if p_patch ? 'motif_ids' then
    begin
      select coalesce(array_agg(x::uuid), '{}') into v_motifs
        from pg_catalog.jsonb_array_elements_text(private.demandes_array(p_patch, 'motif_ids')) x;
    exception when invalid_text_representation then
      raise exception 'Un motif n''est pas dans le catalogue de la clinique.' using errcode = 'P0001', hint = 'motif_ids';
    end;
    if pg_catalog.cardinality(v_motifs) > 50 then
      raise exception '50 motifs au plus.' using errcode = 'P0001', hint = 'motif_ids';
    end if;
    if exists (select 1 from pg_catalog.unnest(v_motifs) m
                where not exists (select 1 from public.motifs_catalog c where c.id = m and c.org_id = v.org_id)) then
      raise exception 'Un motif n''est pas dans le catalogue de la clinique.' using errcode = 'P0001', hint = 'motif_ids';
    end if;
  end if;
  if p_patch ? 'bridge_professional_id' then
    v_bridge := nullif(p_patch ->> 'bridge_professional_id', '')::uuid;
    if v_bridge is not null and not exists (
         select 1 from public.professionals_directory p where p.id = v_bridge and p.org_id = v.org_id and p.status = 'active') then
      raise exception 'Choisissez un professionnel actif de la clinique.' using errcode = 'P0001', hint = 'bridge_professional_id';
    end if;
  end if;
  if p_patch ? 'clientele_id' and nullif(p_patch ->> 'clientele_id', '') is not null and not exists (
       select 1 from public.clienteles_catalog c where c.id = (p_patch ->> 'clientele_id')::uuid and c.org_id = v.org_id) then
    raise exception 'Choisissez une clientèle du catalogue.' using errcode = 'P0001', hint = 'clientele_id';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:update_waitlist_entry', true);
  update public.waitlist_entries e set
    priority = v_priority,
    priority_reason = v_reason,
    availability_periods = case when p_patch ? 'availability_periods'
                                then coalesce((select array_agg(x) from pg_catalog.jsonb_array_elements_text(private.demandes_array(p_patch, 'availability_periods')) x), '{}')
                                else e.availability_periods end,
    availability_days = case when p_patch ? 'availability_days'
                             then coalesce((select array_agg(x::smallint) from pg_catalog.jsonb_array_elements_text(private.demandes_array(p_patch, 'availability_days')) x), '{}')
                             else e.availability_days end,
    modality = coalesce(p_patch ->> 'modality', e.modality),
    language = coalesce(p_patch ->> 'language', e.language),
    preferred_pro_gender = coalesce(p_patch ->> 'preferred_pro_gender', e.preferred_pro_gender),
    clientele_id = case when p_patch ? 'clientele_id' then nullif(p_patch ->> 'clientele_id', '')::uuid else e.clientele_id end,
    payer_kind = coalesce(p_patch ->> 'payer_kind', e.payer_kind),
    motif_ids = case when p_patch ? 'motif_ids' then v_motifs else e.motif_ids end,
    bridge_professional_id = case when p_patch ? 'bridge_professional_id' then v_bridge else e.bridge_professional_id end,
    next_contact_at = case when p_patch ? 'next_contact_at' then nullif(p_patch ->> 'next_contact_at', '')::timestamptz
                           else e.next_contact_at end
   where e.id = v.id;
end;
$$;
revoke all on function public.update_waitlist_entry(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_waitlist_entry(uuid, jsonb) to authenticated;

-- The fee: `to_invoice` (« À facturer »), `paid` (« Payés »), `waived` (« Exonérés », with a reason:
-- PAE, IVAC, an agreement). `invoiced` is Facturation's (F1). Back to « À facturer », an active
-- entry is incomplete again.
create function public.set_waitlist_fee(p_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.waitlist_entries;
  v_reason text := private.demandes_clean(p_reason, 1000);
begin
  perform private.demandes_require('demandes.waitlist');
  v := private.waitlist_lock(p_id);
  if p_status is null or p_status not in ('to_invoice', 'paid', 'waived') then
    raise exception 'Unknown fee status' using errcode = '22023';
  end if;
  if v.fee_status = 'invoiced' then
    raise exception 'Les frais sont facturés : leur suivi se fait dans Facturation.' using errcode = 'P0001';
  end if;
  if p_status = 'waived' and v_reason is null then
    raise exception 'Indiquez pourquoi les frais sont exonérés.' using errcode = 'P0001', hint = 'reason';
  end if;
  if v_reason is not null and pg_catalog.char_length(v_reason) > 300 then
    raise exception 'La raison compte 300 caractères au plus.' using errcode = 'P0001', hint = 'reason';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_waitlist_fee', true);
  update public.waitlist_entries e
     set fee_status = p_status,
         fee_waived_reason = case when p_status = 'waived' then v_reason end,
         state = case when p_status = 'to_invoice' and e.state = 'active' then 'incomplete' else e.state end
   where e.id = v.id;
  perform private.waitlist_promote(v.org_id, v.id);
end;
$$;
revoke all on function public.set_waitlist_fee(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_waitlist_fee(uuid, text, text) to authenticated;

-- A follow-up by a counselor: a call, an email or a text, with its outcome. Reaching the person is
-- the « contact » the follow-up counts from (D-17): « À rappeler » becomes « Active » again. An
-- optional next call (« Rappeler le … ») is due like the follow-up; without one, a planned call
-- stays, unless the person was reached.
create function public.log_waitlist_contact(p_id uuid, p_kind text, p_outcome text, p_next_contact_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.waitlist_entries;
begin
  perform private.demandes_require('demandes.waitlist');
  v := private.waitlist_lock(p_id);
  if p_kind is null or p_kind not in ('call', 'email', 'sms') then
    raise exception 'Unknown contact kind' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('reached', 'voicemail', 'no_answer', 'message_sent') then
    raise exception 'Unknown contact outcome' using errcode = '22023';
  end if;
  if p_next_contact_at is not null and p_next_contact_at <= pg_catalog.now() then
    raise exception 'Le prochain appel est dans le futur.' using errcode = 'P0001', hint = 'next_contact_at';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:log_waitlist_contact', true);
  insert into public.waitlist_contacts (entry_id, org_id, kind, outcome, by_user)
  values (v.id, v.org_id, p_kind, p_outcome, auth.uid());
  update public.waitlist_entries e
     set last_contact_at = case when p_outcome = 'reached' then pg_catalog.now() else e.last_contact_at end,
         state = case when p_outcome = 'reached' and e.state = 'to_call' then 'active' else e.state end,
         next_contact_at = case when p_next_contact_at is not null then p_next_contact_at
                                when p_outcome = 'reached' then null
                                else e.next_contact_at end
   where e.id = v.id;
end;
$$;
revoke all on function public.log_waitlist_contact(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.log_waitlist_contact(uuid, text, text, timestamptz) to authenticated;

-- An offer made by phone (part 1), noted by hand: the professional and 0 to 3 slots
-- ({starts_at, ends_at}); the entry is « Offerte » until the answer. A complete entry only; one
-- pending offer at a time.
create function public.add_waitlist_offer(p_id uuid, p_professional_id uuid, p_slots jsonb default '[]')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.waitlist_entries;
  v_slot jsonb;
  v_offer uuid;
begin
  perform private.demandes_require('demandes.waitlist');
  v := private.waitlist_lock(p_id);
  if v.state = 'incomplete' then
    raise exception 'L''inscription est incomplète : consentement et frais d''abord.' using errcode = 'P0001';
  end if;
  if v.state = 'offered' or exists (select 1 from public.waitlist_offers o where o.entry_id = v.id and o.response = 'pending') then
    raise exception 'Une offre attend déjà sa réponse.' using errcode = 'P0001';
  end if;
  if p_professional_id is null or not exists (
       select 1 from public.professionals_directory p where p.id = p_professional_id and p.org_id = v.org_id and p.status = 'active') then
    raise exception 'Choisissez un professionnel actif de la clinique.' using errcode = 'P0001', hint = 'professional_id';
  end if;
  if p_slots is null or pg_catalog.jsonb_typeof(p_slots) <> 'array' or pg_catalog.jsonb_array_length(p_slots) > 3 then
    raise exception 'Trois plages au plus.' using errcode = 'P0001', hint = 'slots';
  end if;
  for v_slot in select x.value from pg_catalog.jsonb_array_elements(p_slots) x loop
    begin
      if pg_catalog.jsonb_typeof(v_slot) <> 'object' or (v_slot ->> 'starts_at')::timestamptz is null
         or (v_slot ->> 'ends_at')::timestamptz <= (v_slot ->> 'starts_at')::timestamptz then
        raise exception 'bad slot';
      end if;
    exception when others then
      raise exception 'Chaque plage a un début et une fin plus tardive.' using errcode = 'P0001', hint = 'slots';
    end;
  end loop;
  perform pg_catalog.set_config('app.audit_source', 'rpc:add_waitlist_offer', true);
  insert into public.waitlist_offers (entry_id, org_id, professional_id, slots, channel, offered_by)
  values (v.id, v.org_id, p_professional_id, p_slots, 'phone', auth.uid())
  returning id into v_offer;
  update public.waitlist_entries e set state = 'offered' where e.id = v.id;
  return v_offer;
end;
$$;
revoke all on function public.add_waitlist_offer(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.add_waitlist_offer(uuid, uuid, jsonb) to authenticated;

-- The answer to a pending offer: `accepted` places the person with the offer's professional (every
-- open entry of the request closes « Placée », the request is matched); `declined` or `withdrawn`
-- puts the entry back « Active ».
create function public.answer_waitlist_offer(p_id uuid, p_offer_id uuid, p_response text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.waitlist_entries;
  v_offer public.waitlist_offers;
begin
  perform private.demandes_require('demandes.waitlist');
  v := private.waitlist_lock(p_id);
  if p_response is null or p_response not in ('accepted', 'declined', 'withdrawn') then
    raise exception 'Unknown response' using errcode = '22023';
  end if;
  select o.* into v_offer from public.waitlist_offers o where o.entry_id = v.id and o.id = p_offer_id for update;
  if v_offer.id is null or v_offer.response <> 'pending' then
    raise exception 'Cette offre a déjà sa réponse.' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:answer_waitlist_offer', true);
  update public.waitlist_offers o set response = p_response, responded_at = pg_catalog.now() where o.id = v_offer.id;
  if p_response = 'accepted' then
    perform private.waitlist_place(v.org_id, v.demande_id, v_offer.professional_id, auth.uid());
  else
    update public.waitlist_entries e set state = 'active' where e.id = v.id and e.state = 'offered';
  end if;
end;
$$;
revoke all on function public.answer_waitlist_offer(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.answer_waitlist_offer(uuid, uuid, text) to authenticated;

-- Leaving the list with a reason (D-18): `placed` needs the professional (the request is matched,
-- its other entries close too); otherwise the entry closes, and a request left with no open entry
-- closes with the twin reason.
create function public.exit_waitlist(p_id uuid, p_reason text, p_professional_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.waitlist_entries;
begin
  perform private.demandes_require('demandes.waitlist');
  v := private.waitlist_lock(p_id);
  if p_reason is null or p_reason not in ('placed', 'referred_elsewhere', 'withdrew', 'no_answer', 'other') then
    raise exception 'Indiquez pourquoi la personne quitte la liste.' using errcode = 'P0001', hint = 'reason';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:exit_waitlist', true);
  if p_reason = 'placed' then
    perform private.waitlist_place(v.org_id, v.demande_id, p_professional_id, auth.uid());
  else
    if p_professional_id is not null then
      raise exception 'A professional is only for a placement' using errcode = '22023';
    end if;
    perform private.waitlist_close(v.id, p_reason, auth.uid());
    perform private.waitlist_after_exit(v.org_id, v.demande_id, p_reason, auth.uid());
  end if;
end;
$$;
revoke all on function public.exit_waitlist(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.exit_waitlist(uuid, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Reads (demandes.view)
-- -----------------------------------------------------------------------------
-- The entries of p_org (or of one request, one entry, one list) with their rank in their list
-- (open ones: priority, then the oldest; computed over the whole list), the size of that list, the
-- person, the target's name, the consent and the days waited.
create function private.waitlist_rows(
  p_org uuid,
  p_demande uuid default null,
  p_entry uuid default null,
  p_title uuid default null,
  p_professional uuid default null
)
returns table (
  id uuid, demande_id uuid, reference text, client_id uuid, client_number int, person_name text,
  target_kind text, target_id uuid, target_name text, priority text, priority_reason text,
  registered_at timestamptz, waited_days int, state text, fee_status text, fee_waived_reason text,
  consent_state text, last_contact_at timestamptz, next_contact_at timestamptz,
  bridge_professional_id uuid, bridge_name text, exit_reason text, exited_at timestamptz,
  rank bigint, list_size bigint, pending_offer boolean, followup_unanswered boolean
)
language sql
stable
set search_path = ''
as $$
  with o as (select x.timezone from public.organizations x where x.id = p_org),
  e as (
    select x.*,
           case when x.state <> 'closed' then
             pg_catalog.row_number() over (partition by x.target_profession_title_id, x.target_professional_id, x.state = 'closed'
                                           order by x.priority desc, x.registered_at, x.id) end as rank,
           case when x.state <> 'closed' then
             pg_catalog.count(*) over (partition by x.target_profession_title_id, x.target_professional_id, x.state = 'closed') end as list_size
      from public.waitlist_entries x
     where x.org_id = p_org
  )
  select e.id, e.demande_id, d.reference, e.client_id, c.client_number, c.display_name,
         case when e.target_professional_id is not null then 'professional' else 'title' end,
         coalesce(e.target_professional_id, e.target_profession_title_id),
         coalesce(p.display_name, t.name),
         e.priority, e.priority_reason, e.registered_at,
         ((coalesce(e.exited_at, pg_catalog.now()) at time zone o.timezone)::date - (e.registered_at at time zone o.timezone)::date)::int,
         e.state, e.fee_status, e.fee_waived_reason,
         case when e.state = 'closed' or e.client_id is null then null
              else private.waitlist_consent_state(p_org, e.client_id, e.id) end,
         e.last_contact_at, e.next_contact_at, e.bridge_professional_id, b.display_name, e.exit_reason, e.exited_at,
         e.rank, e.list_size,
         exists (select 1 from public.waitlist_offers w where w.entry_id = e.id and w.response = 'pending'),
         -- The « still waiting? » email went out and nobody answered in time.
         coalesce((select k.kind = 'followup_email' and k.outcome = 'no_answer'
                     from public.waitlist_contacts k where k.entry_id = e.id and k.org_id = p_org
                    order by k.at desc limit 1), false)
    from e
   cross join o
    join public.demandes d on d.id = e.demande_id and d.org_id = p_org
    left join public.clients_directory c on c.id = e.client_id and c.org_id = p_org
    left join public.professionals_directory p on p.id = e.target_professional_id and p.org_id = p_org
    left join public.profession_titles_catalog t on t.id = e.target_profession_title_id and t.org_id = p_org
    left join public.professionals_directory b on b.id = e.bridge_professional_id and b.org_id = p_org
   where (p_demande is null or e.demande_id = p_demande)
     and (p_entry is null or e.id = p_entry)
     and (p_title is null or e.target_profession_title_id = p_title)
     and (p_professional is null or e.target_professional_id = p_professional)
$$;
revoke all on function private.waitlist_rows(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- One list (a profession or a professional), a request's entries, or every open entry; p_states
-- narrows (incomplete, active, to_call, offered, closed). Open entries in their list's order;
-- closed ones (p_states with `closed`) most recent first; 500 rows at most. Incomplete entries
-- whose consent and fee are now settled become active first (D-16).
create function public.list_waitlist(
  p_title_id uuid default null,
  p_professional_id uuid default null,
  p_states text[] default null,
  p_demande_id uuid default null
)
returns table (
  id uuid, demande_id uuid, reference text, client_id uuid, client_number int, person_name text,
  target_kind text, target_id uuid, target_name text, priority text, priority_reason text,
  registered_at timestamptz, waited_days int, state text, fee_status text, fee_waived_reason text,
  consent_state text, last_contact_at timestamptz, next_contact_at timestamptz,
  bridge_professional_id uuid, bridge_name text, exit_reason text, exited_at timestamptz,
  rank bigint, list_size bigint, pending_offer boolean, followup_unanswered boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  perform private.demandes_require('demandes.view');
  if num_nonnulls(p_title_id, p_professional_id) > 1 then
    raise exception 'One list at a time' using errcode = '22023';
  end if;
  if exists (select 1 from public.waitlist_entries x where x.org_id = v_org and x.state = 'incomplete') then
    perform pg_catalog.set_config('app.audit_source', 'rpc:list_waitlist', true);
    perform private.waitlist_promote(v_org);
  end if;
  return query
    select r.* from private.waitlist_rows(v_org, p_demande_id, null, p_title_id, p_professional_id) r
     where (case when p_states is null then r.state <> 'closed' or p_demande_id is not null else r.state = any (p_states) end)
     order by r.state = 'closed', r.exited_at desc nulls last, r.target_kind, r.target_name, r.rank
     limit 500;
end;
$$;
revoke all on function public.list_waitlist(uuid, uuid, text[], uuid) from public, anon, authenticated;
grant execute on function public.list_waitlist(uuid, uuid, text[], uuid) to authenticated;

-- Every active profession and professional of the clinic with its open entries (by state) and its
-- average wait: registration → « Placée » over the last 12 months (D-19, an estimate for the
-- counselor, never promised). Professions first, then professionals; the busiest first.
create function public.waitlist_lists()
returns table (target_kind text, target_id uuid, name text, open_count int, incomplete_count int, to_call_count int,
               offered_count int, average_wait_days int)
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
    with targets as (
      select 'title'::text as kind, t.id, t.name, t.sort_order as sort
        from public.profession_titles_catalog t where t.org_id = v_org
      union all
      select 'professional', p.id, p.display_name, 0
        from public.professionals_directory p where p.org_id = v_org and p.status = 'active'
    ),
    entries as (
      select coalesce(e.target_professional_id, e.target_profession_title_id) as target, e.state, e.exit_reason,
             e.registered_at, e.exited_at
        from public.waitlist_entries e where e.org_id = v_org
    )
    select g.kind, g.id, g.name,
           (select pg_catalog.count(*) from entries x where x.target = g.id and x.state <> 'closed')::int,
           (select pg_catalog.count(*) from entries x where x.target = g.id and x.state = 'incomplete')::int,
           (select pg_catalog.count(*) from entries x where x.target = g.id and x.state = 'to_call')::int,
           (select pg_catalog.count(*) from entries x where x.target = g.id and x.state = 'offered')::int,
           (select pg_catalog.round(pg_catalog.avg(extract(epoch from x.exited_at - x.registered_at) / 86400))::int
              from entries x where x.target = g.id and x.exit_reason = 'placed'
               and x.exited_at > pg_catalog.now() - interval '12 months')
      from targets g
     order by g.kind = 'professional', 4 desc, g.sort, g.name;
end;
$$;
revoke all on function public.waitlist_lists() from public, anon, authenticated;
grant execute on function public.waitlist_lists() to authenticated;

-- One entry with its follow-ups, its offers and the fee's price (the side sheet).
create function public.get_waitlist_entry(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_entry jsonb;
  v_raw public.waitlist_entries;
begin
  perform private.demandes_require('demandes.view');
  select x.* into v_raw from public.waitlist_entries x where x.id = p_id and x.org_id = v_org;
  if v_raw.id is null then
    return null;
  end if;
  select pg_catalog.to_jsonb(r) into v_entry from private.waitlist_rows(v_org, null, p_id) r;
  return pg_catalog.jsonb_build_object(
    'entry', v_entry || pg_catalog.jsonb_build_object(
      'availability_periods', v_raw.availability_periods, 'availability_days', v_raw.availability_days,
      'modality', v_raw.modality, 'language', v_raw.language, 'preferred_pro_gender', v_raw.preferred_pro_gender,
      'clientele_id', v_raw.clientele_id, 'payer_kind', v_raw.payer_kind, 'motif_ids', v_raw.motif_ids,
      'consent_signed_at', v_raw.consent_signed_at),
    'contacts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'id', k.id, 'kind', k.kind, 'outcome', k.outcome, 'at', k.at, 'by_name', pr.display_name)
                            order by k.at desc)
                            from public.waitlist_contacts k
                            left join public.profiles pr on pr.user_id = k.by_user and pr.org_id = v_org
                           where k.entry_id = p_id and k.org_id = v_org), '[]'::jsonb),
    'offers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                          'id', w.id, 'professional_id', w.professional_id, 'professional_name', p.display_name,
                          'slots', w.slots, 'channel', w.channel, 'offered_at', w.offered_at, 'response', w.response,
                          'responded_at', w.responded_at, 'by_name', pr.display_name)
                          order by w.offered_at desc)
                          from public.waitlist_offers w
                          left join public.professionals_directory p on p.id = w.professional_id and p.org_id = v_org
                          left join public.profiles pr on pr.user_id = w.offered_by and pr.org_id = v_org
                         where w.entry_id = p_id and w.org_id = v_org), '[]'::jsonb),
    'fee', (select pg_catalog.jsonb_build_object('code', f.code, 'name', f.name, 'price_cents', f.price_cents, 'tax_rule', f.tax_rule)
              from private.waitlist_fee(v_org, v_raw.client_id) f),
    'can', pg_catalog.jsonb_build_object('manage', private.has_permission('demandes.waitlist'))
  );
end;
$$;
revoke all on function public.get_waitlist_entry(uuid) from public, anon, authenticated;
grant execute on function public.get_waitlist_entry(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The follow-up (D-17): the job `demandes.waitlist_followup` and the « still waiting? » link
-- -----------------------------------------------------------------------------
-- Where the email goes (no user: the job): Clients' published contacts of the entry's client
-- (`client_contacts_for`, right `communications`: never a merged or anonymised file) — the client
-- herself first, then the main contact, then another related person who receives her
-- communications; the request's address only when there is no file. A row with an address and a
-- first name, or none.
create function private.waitlist_email_of(p_entry uuid)
returns table (email text, first_name text, language text)
language sql
stable
set search_path = ''
as $$
  with e as (select x.* from public.waitlist_entries x where x.id = p_entry),
  candidates as (
    select c.email, c.first_name, coalesce(c.language, e.language) as language,
           case when c.is_self then 0 when c.is_main_contact then 1 else 2 end as preference
      from e cross join lateral private.client_contacts_for(e.org_id, e.client_id, 'communications') c
     where e.client_id is not null
    union all
    select d.contact_email, nullif(pg_catalog.split_part(d.contact_name, ' ', 1), ''), e.language, 3
      from e join public.demandes d on d.id = e.demande_id and d.org_id = e.org_id
     where e.client_id is null
  )
  select x.email, x.first_name, x.language from candidates x
   where x.email is not null and x.first_name is not null
   order by x.preference
   limit 1
$$;
revoke all on function private.waitlist_email_of(uuid) from public, anon, authenticated, service_role;

-- A « still waiting? » email went to this request during the last p_weeks (any of its entries).
create function private.waitlist_emailed_recently(p_org uuid, p_demande uuid, p_weeks int)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.waitlist_contacts k
                   join public.waitlist_entries e on e.id = k.entry_id and e.org_id = k.org_id
                  where e.org_id = p_org and e.demande_id = p_demande and k.kind = 'followup_email'
                    and k.at > pg_catalog.now() - pg_catalog.make_interval(weeks => p_weeks))
$$;
revoke all on function private.waitlist_emailed_recently(uuid, uuid, int) from public, anon, authenticated, service_role;

-- One clinic's pass (service role, the job): incomplete entries settled → active; active entries
-- without a conversation for `followup_weeks` (or whose next call is due) → « À rappeler », with one
-- notice for the counselors; an emailed entry with no answer after `answer_days` → « Sans réponse »;
-- and, when the email is on and Demandes is open to everyone (P3-40), one « À rappeler » entry per
-- request with an address, the request not emailed during the last `followup_weeks`, at most
-- p_limit. Returns {promoted, to_call, no_answer, email: [entry ids]}.
create function public.waitlist_followup_for_service(p_org_id uuid, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := private.demandes_waitlist_settings(p_org_id);
  v_weeks int := (v_settings ->> 'followup_weeks')::int;
  v_days int := (v_settings ->> 'answer_days')::int;
  v_promoted int;
  v_to_call int;
  v_no_answer int;
  v_email uuid[] := '{}';
begin
  if not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'Unknown organization' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'job:demandes.waitlist_followup', true);
  v_promoted := private.waitlist_promote(p_org_id);

  update public.waitlist_entries e
     set state = 'to_call', next_contact_at = null
   where e.org_id = p_org_id and e.state = 'active'
     and ((e.next_contact_at is null
           and coalesce(e.last_contact_at, e.registered_at) <= pg_catalog.now() - pg_catalog.make_interval(weeks => v_weeks))
          or e.next_contact_at <= pg_catalog.now());
  get diagnostics v_to_call = row_count;
  if v_to_call > 0 then
    perform private.notify(
      p_org_id, 'demandes', 'demandes.waitlist_to_call', 'normal',
      case when v_to_call = 1 then 'Liste d''attente : 1 personne à rappeler'
           else 'Liste d''attente : ' || v_to_call || ' personnes à rappeler' end,
      'Sans nouvelles depuis ' || v_weeks || ' semaines, ou un rappel prévu est arrivé.',
      '/liste-attente?etat=a-rappeler', null, null, 'demandes.waitlist', null,
      'to_call:' || (select (pg_catalog.now() at time zone o.timezone)::date::text from public.organizations o where o.id = p_org_id),
      pg_catalog.now() + interval '7 days');
  end if;

  -- The « still waiting? » emails nobody answered.
  with unanswered as (
    select e.id, e.org_id
      from public.waitlist_entries e
     where e.org_id = p_org_id and e.state <> 'closed'
       and (select k.kind = 'followup_email' and k.outcome = 'message_sent' and k.at <= pg_catalog.now() - pg_catalog.make_interval(days => v_days)
              from public.waitlist_contacts k where k.entry_id = e.id order by k.at desc limit 1)
  )
  insert into public.waitlist_contacts (entry_id, org_id, kind, outcome)
  select u.id, u.org_id, 'followup_email', 'no_answer' from unanswered u;
  get diagnostics v_no_answer = row_count;

  if (v_settings ->> 'followup_email')::boolean and public.module_open_to_all_for_org(p_org_id, 'demandes') then
    -- One email per request (its oldest « À rappeler » entry): the answer covers all its entries.
    select coalesce(array_agg(x.id order by x.registered_at), '{}') into v_email
      from (select y.id, y.registered_at
              from (select distinct on (e.demande_id) e.id, e.demande_id, e.org_id, e.registered_at
                      from public.waitlist_entries e
                     where e.org_id = p_org_id and e.state = 'to_call'
                     order by e.demande_id, e.registered_at) y
             where not private.waitlist_emailed_recently(y.org_id, y.demande_id, v_weeks)
               and exists (select 1 from private.waitlist_email_of(y.id))
             order by y.registered_at
             limit greatest(coalesce(p_limit, 50), 0)) x;
  end if;
  return pg_catalog.jsonb_build_object('promoted', v_promoted, 'to_call', v_to_call, 'no_answer', v_no_answer, 'email', pg_catalog.to_jsonb(v_email));
end;
$$;
revoke all on function public.waitlist_followup_for_service(uuid, int) from public, anon, authenticated;
grant execute on function public.waitlist_followup_for_service(uuid, int) to service_role;

-- Prepares one « still waiting? » email (service role, the job): checks again that it may go (the
-- email on, Demandes open to everyone: P3-40; the entry « À rappeler » with an address, its request
-- not emailed during the last `followup_weeks`) and issues the link (purpose `waitlist_followup`,
-- valid `answer_days`, the hash made by the function); `mark_waitlist_followup_sent_for_service`
-- notes the email once it left. Null when it may not go. Returns what the email needs.
create function public.prepare_waitlist_followup_for_service(p_org_id uuid, p_entry_id uuid, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := private.demandes_waitlist_settings(p_org_id);
  v public.waitlist_entries;
  v_to record;
  v_link uuid;
  v_expires timestamptz;
begin
  if p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    raise exception 'Invalid token hash' using errcode = '22023';
  end if;
  if not (v_settings ->> 'followup_email')::boolean or not public.module_open_to_all_for_org(p_org_id, 'demandes') then
    return null;
  end if;
  select e.* into v from public.waitlist_entries e where e.id = p_entry_id and e.org_id = p_org_id for update;
  if v.id is null or v.state <> 'to_call' then
    return null;
  end if;
  select m.* into v_to from private.waitlist_email_of(v.id) m;
  if v_to.email is null or private.waitlist_emailed_recently(p_org_id, v.demande_id, (v_settings ->> 'followup_weeks')::int) then
    return null;
  end if;
  perform pg_catalog.set_config('app.audit_source', 'job:demandes.waitlist_followup', true);
  v_link := private.issue_secure_link(p_org_id, 'waitlist_followup', 'waitlist_entry', v.id, p_token_hash, null,
                                      pg_catalog.make_interval(days => (v_settings ->> 'answer_days')::int), '{}');
  select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
  return pg_catalog.jsonb_build_object(
    'demande_id', v.demande_id, 'email', v_to.email, 'first_name', v_to.first_name,
    'language', case when v_to.language = 'en' then 'en' else 'fr' end,
    'clinic_name', (select o.name from public.organizations o where o.id = p_org_id),
    'list_name', (select coalesce(p.display_name, t.name)
                    from public.waitlist_entries x
                    left join public.professionals_directory p on p.id = x.target_professional_id and p.org_id = x.org_id
                    left join public.profession_titles_catalog t on t.id = x.target_profession_title_id and t.org_id = x.org_id
                   where x.id = v.id),
    'link_expires_at', v_expires);
end;
$$;
revoke all on function public.prepare_waitlist_followup_for_service(uuid, uuid, bytea) from public, anon, authenticated;
grant execute on function public.prepare_waitlist_followup_for_service(uuid, uuid, bytea) to service_role;

-- After the send (service role, the job): sent → noted in the follow-ups (the answer's clock
-- starts); not sent → its link revoked, nothing noted (the next pass tries again).
create function public.mark_waitlist_followup_sent_for_service(p_org_id uuid, p_entry_id uuid, p_sent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_sent is null or not exists (select 1 from public.waitlist_entries e where e.id = p_entry_id and e.org_id = p_org_id) then
    raise exception 'Unknown entry' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'job:demandes.waitlist_followup', true);
  if p_sent then
    insert into public.waitlist_contacts (entry_id, org_id, kind, outcome)
    values (p_entry_id, p_org_id, 'followup_email', 'message_sent');
  else
    perform private.revoke_secure_links(p_org_id, 'waitlist_followup', 'waitlist_entry', p_entry_id, null);
  end if;
end;
$$;
revoke all on function public.mark_waitlist_followup_sent_for_service(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.mark_waitlist_followup_sent_for_service(uuid, uuid, boolean) to service_role;

-- What the page shows (resolve-link): the clinic and the list, while the entry is open.
create function public.resolve_waitlist_followup_link(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('clinic_name', o.name, 'list_name', coalesce(p.display_name, t.name))
    from public.secure_links l
    join public.waitlist_entries e on e.id = l.subject_id and e.org_id = l.org_id
    join public.organizations o on o.id = l.org_id
    left join public.professionals_directory p on p.id = e.target_professional_id and p.org_id = e.org_id
    left join public.profession_titles_catalog t on t.id = e.target_profession_title_id and t.org_id = e.org_id
   where l.id = p_link_id and l.purpose = 'waitlist_followup' and l.subject_type = 'waitlist_entry'
     and l.revoked_at is null and l.expires_at > pg_catalog.now() and l.use_count < l.max_uses
     and e.state <> 'closed'
$$;
revoke all on function public.resolve_waitlist_followup_link(uuid) from public, anon, authenticated;
grant execute on function public.resolve_waitlist_followup_link(uuid) to service_role;

insert into public.secure_link_purposes
  (key, module_key, default_ttl, max_ttl, max_uses, requires_session, creates_account, resolve_rpc, accept_rpc, view_permission)
values ('waitlist_followup', 'demandes', interval '14 days', interval '30 days', 1, false, false,
        'resolve_waitlist_followup_link', null, 'demandes.view')
on conflict do nothing;

-- The person's answer through the link (once), for her whole request: `stay` notes it and its
-- « À rappeler » entries are « Active » again (the counselors need not call); `leave` takes her off
-- every list (« Ne souhaite plus »; the request, left with no open entry, closes) and tells the
-- counselors. Demandes switched off: the link reads as invalid. Returns {state: stay | leave | invalid}.
create function public.answer_waitlist_followup_for_service(p_token_hash bytea, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.secure_links;
  v public.waitlist_entries;
  e record;
begin
  if p_answer is null or p_answer not in ('stay', 'leave') then
    raise exception 'Unknown answer' using errcode = '22023';
  end if;
  select l.* into v_link from public.secure_links l
   where l.token_hash = p_token_hash and l.purpose = 'waitlist_followup' and l.subject_type = 'waitlist_entry'
   for update;
  if v_link.id is null or v_link.revoked_at is not null or v_link.expires_at <= pg_catalog.now() or v_link.use_count >= v_link.max_uses
     or not public.module_enabled_for_org(v_link.org_id, 'demandes') then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  select x.* into v from public.waitlist_entries x where x.id = v_link.subject_id and x.org_id = v_link.org_id;
  if v.id is null then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  -- The request, then its entries (the order of set_demande_state).
  perform 1 from public.demandes d where d.id = v.demande_id and d.org_id = v.org_id for no key update;
  select x.* into v from public.waitlist_entries x where x.id = v.id for update;
  if v.state = 'closed' then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  perform pg_catalog.set_config('app.audit_source', 'link:waitlist_followup', true);
  perform private.consume_secure_link(p_token_hash, 'waitlist_followup');
  insert into public.waitlist_contacts (entry_id, org_id, kind, outcome)
  values (v.id, v.org_id, 'followup_email', case when p_answer = 'stay' then 'wants_to_stay' else 'wants_to_leave' end);
  if p_answer = 'stay' then
    update public.waitlist_entries x
       set last_contact_at = pg_catalog.now(), state = case when x.state = 'to_call' then 'active' else x.state end
     where x.demande_id = v.demande_id and x.org_id = v.org_id and x.state <> 'closed';
  else
    for e in select x.id from public.waitlist_entries x
              where x.demande_id = v.demande_id and x.org_id = v.org_id and x.state <> 'closed' loop
      perform private.waitlist_close(e.id, 'withdrew', null);
    end loop;
    perform private.waitlist_after_exit(v.org_id, v.demande_id, 'withdrew', null);
    perform private.notify(
      v.org_id, 'demandes', 'demandes.waitlist_left', 'normal',
      'Liste d''attente : une personne ne souhaite plus attendre',
      'Elle a répondu « Non » au courriel de suivi ; elle est retirée de la liste.',
      '/demandes/' || v.demande_id || '/suivi', 'waitlist_entry', v.id, 'demandes.waitlist', null,
      'left:' || v.id::text, pg_catalog.now() + interval '30 days');
  end if;
  return pg_catalog.jsonb_build_object('state', p_answer);
end;
$$;
revoke all on function public.answer_waitlist_followup_for_service(bytea, text) from public, anon, authenticated;
grant execute on function public.answer_waitlist_followup_for_service(bytea, text) to service_role;

-- The email
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission)
values
  ('demandes.waitlist_still_waiting', 'demandes',
   'Toujours sur la liste d''attente ?',
   'Envoyé par le suivi de la liste d''attente (s''il est activé) à une personne inscrite depuis longtemps sans nouvelles.',
   'Vous recevez ce courriel parce que vous êtes inscrit ou inscrite sur la liste d''attente de la clinique.',
   'Souhaitez-vous rester sur notre liste d''attente ? — {{clinic.name}}',
   E'Bonjour {{person.first_name}},\n\n'
   'Votre inscription sur la liste d''attente de {{clinic.name}} ({{waitlist.name}}) est toujours active : nous ne vous avons pas oubliée ni oublié.\n\n'
   'Souhaitez-vous y rester ? Répondez en un clic avec le bouton ci-dessous. Sans réponse, une conseillère vous appellera.',
   'Répondre',
   '[
     {"path": "person.first_name", "label": "Prénom de la personne", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "waitlist.name", "label": "Liste d''attente (profession ou professionnel)", "sample": "Psychologie", "required": true, "kind": "text"}
   ]',
   'demandes.view'),
  ('demandes.waitlist_still_waiting_en', 'demandes',
   'Toujours sur la liste d''attente ? (anglais)',
   'Le même courriel en anglais, quand la personne parle anglais.',
   'You receive this email because you are on the clinic''s waiting list.',
   'Would you like to stay on our waiting list? — {{clinic.name}}',
   E'Hello {{person.first_name}},\n\n'
   'You are still on the waiting list of {{clinic.name}} ({{waitlist.name}}): we have not forgotten you.\n\n'
   'Would you like to stay on it? Answer in one click with the button below. Without an answer, a counselor will call you.',
   'Answer',
   '[
     {"path": "person.first_name", "label": "Prénom de la personne", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "waitlist.name", "label": "Liste d''attente (profession ou professionnel)", "sample": "Psychology", "required": true, "kind": "text"}
   ]',
   'demandes.view')
on conflict do nothing;

-- The job: hourly, due once 7 h has passed in the clinic's time zone; off until the clinic switches
-- it on (« Tâches planifiées »).
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('demandes.waitlist_followup', 'demandes', 'Suivi de la liste d''attente',
   'Marque « À rappeler » les inscriptions sans nouvelles depuis le délai réglé et l''annonce aux conseillères ; envoie le courriel « Souhaitez-vous rester sur la liste d''attente ? » s''il est activé.',
   'function', 'demandes-waitlist-followup', null, 'demandes.waitlist_followup', 7, false)
on conflict do nothing;

select cron.schedule('demandes.waitlist_followup', '15 * * * *',
  $$select private.invoke_job_function('demandes.waitlist_followup')$$);

-- -----------------------------------------------------------------------------
-- Realtime: an entry announces its request (ids only), so the record and the list follow
-- -----------------------------------------------------------------------------
create trigger waitlist_entries_broadcast after insert or update or delete on public.waitlist_entries
  for each row execute function private.broadcast_record_change('demandes', 'demande_id', 'demandes');
