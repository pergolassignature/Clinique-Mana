-- =============================================================================
-- Demandes: the proposals with their 48-h acceptance link (plan §10 D3b, second part)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D3b); roadmap §2.3
-- Decisions: D-21 … D-23 (this batch), AP-15 (Rendez-vous R1b: held appointments), P3-40
-- Needs:     D1's `demande_propositions`; Professionnels' `professional_display_facts`; Rendez-vous R1b (`private.appointments_hold`,
--            `appointments_confirm_hold`, `appointments_release_hold`); Clients' published
--            contacts; core's links, email, notices, jobs.
--
-- A counselor proposes a professional and 1 to 3 of her free slots to the person: each slot is a
-- **held** appointment (R1b: it takes its slot, it is no appointment yet), and an email carries a
-- one-use link valid 48 h to `/proposition` (D-21). The person accepts one slot (it is booked, the
-- others are freed, the request is matched) or none (all freed, a reason); 48 h without an answer
-- → expired, all freed (the job `demandes.propositions_expire`). The counselor withdraws a pending
-- proposal; closing or matching the request withdraws it too. Each outcome is a notice to the
-- counselors and the record shows it.
-- - The token is made by the function `demandes-propose` (actor model, ADR 0007):
--   `create_proposition_for_service(p_actor, …, p_token_hash)` re-checks the actor.
-- - P3-40: while Demandes is reserved for its testers, no proposal is made (French refusal).
-- Additive: columns on Demandes' own table, functions, catalogue rows, a job; `set_demande_state`
-- replaced (same signature).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_propositions', true);

-- -----------------------------------------------------------------------------
-- The proposal's slots
-- -----------------------------------------------------------------------------
-- service_id / mode: what the held appointments are; slots: [{appointment_id, starts_at, ends_at}]
-- (no foreign key: a released hold is deleted, AP-15); the slot chosen; the email's language.
alter table public.demande_propositions
  add column service_id uuid,
  add column mode text,
  add column slots jsonb not null default '[]',
  add column accepted_appointment_id uuid,
  add column accepted_starts_at timestamptz,
  add column language text;
alter table public.demande_propositions
  add constraint demande_propositions_mode_check check (mode in ('video', 'phone')),
  add constraint demande_propositions_slots_check check (pg_catalog.jsonb_typeof(slots) = 'array' and pg_catalog.jsonb_array_length(slots) <= 3),
  add constraint demande_propositions_language_check check (language in ('fr', 'en'));
create index demande_propositions_pending_idx on public.demande_propositions (org_id, expires_at) where response = 'pending';
create unique index demande_propositions_one_pending_key on public.demande_propositions (demande_id) where response = 'pending';

create trigger demande_propositions_broadcast after insert or update or delete on public.demande_propositions
  for each row execute function private.broadcast_record_change('demandes', 'demande_id', 'demandes');

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- Where the proposal goes (no user in the job or the link): Clients' published contacts of the
-- request's client (`client_contacts_for`, right `appointments`: who manages her appointments),
-- the client herself first, then the main contact, then another; the request's address only
-- without a file. A row with an address and a first name, or none.
create function private.demandes_recipient(p_org uuid, p_demande uuid)
returns table (email text, first_name text, language text)
language sql
stable
set search_path = ''
as $$
  with d as (select x.* from public.demandes x where x.id = p_demande and x.org_id = p_org),
  candidates as (
    select c.email, c.first_name, coalesce(c.language, d.language) as language,
           case when c.is_self then 0 when c.is_main_contact then 1 else 2 end as preference
      from d cross join lateral private.client_contacts_for(d.org_id, d.client_id, 'appointments') c
     where d.client_id is not null
    union all
    select d.contact_email, nullif(pg_catalog.split_part(d.contact_name, ' ', 1), ''), d.language, 3
      from d where d.client_id is null
  )
  select x.email, x.first_name, x.language from candidates x
   where x.email is not null and x.first_name is not null
   order by x.preference
   limit 1
$$;
revoke all on function private.demandes_recipient(uuid, uuid) from public, anon, authenticated, service_role;

-- After a proposal that did not place the person: a request still « Proposée » goes back to
-- « Liste d'attente » when it still has an open entry, else to « Acceptée » (the history says so).
create function private.demandes_after_proposition(p_org uuid, p_demande uuid, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_to text;
begin
  select d.* into v_row from public.demandes d where d.id = p_demande and d.org_id = p_org for no key update;
  if v_row.state <> 'proposed' then
    return;
  end if;
  v_to := case when exists (select 1 from public.waitlist_entries e
                             where e.demande_id = p_demande and e.org_id = p_org and e.state <> 'closed')
               then 'waitlist' else 'accepted' end;
  update public.demandes d set state = v_to where d.id = p_demande;
  insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, by_user)
  values (p_demande, p_org, 'state_changed', 'proposed', v_to, p_actor);
end;
$$;
revoke all on function private.demandes_after_proposition(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Ends a pending proposal without a placement: its held slots freed (R1b's reason), its link
-- revoked, the response noted; the request goes back (above) unless p_keep_state.
create function private.demandes_end_proposition(p_org uuid, p_id uuid, p_response text, p_hold_reason text, p_actor uuid,
                                                 p_decline_reason text default null, p_keep_state boolean default false)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v public.demande_propositions;
  s jsonb;
begin
  select x.* into v from public.demande_propositions x where x.id = p_id and x.org_id = p_org for update;
  if v.id is null or v.response <> 'pending' then
    return false;
  end if;
  for s in select y.value from pg_catalog.jsonb_array_elements(v.slots) y loop
    perform private.appointments_release_hold(p_org, (s ->> 'appointment_id')::uuid, p_hold_reason);
  end loop;
  perform private.revoke_secure_links(p_org, 'proposition', 'demande_proposition', v.id, p_actor);
  update public.demande_propositions x
     set response = p_response, responded_at = pg_catalog.now(), decline_reason = p_decline_reason
   where x.id = v.id;
  if not p_keep_state then
    perform private.demandes_after_proposition(p_org, v.demande_id, p_actor);
  end if;
  return true;
end;
$$;
revoke all on function private.demandes_end_proposition(uuid, uuid, text, text, uuid, text, boolean) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- set_demande_state, now with the proposals: matched or closed withdraws a pending proposal
-- (its slots freed: `demande_closed`); another move waits until it is withdrawn. Otherwise as D3
-- (the waiting list).
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
  if p_state not in ('matched', 'closed') and exists (
       select 1 from public.demande_propositions x where x.demande_id = v_row.id and x.org_id = v_row.org_id and x.response = 'pending') then
    raise exception 'Une proposition attend sa réponse : retirez-la d''abord (onglet Suivi).' using errcode = 'P0001';
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
    for e in select x.id from public.demande_propositions x where x.demande_id = v_row.id and x.org_id = v_row.org_id and x.response = 'pending' loop
      perform private.demandes_end_proposition(v_row.org_id, e.id, 'withdrawn', 'demande_closed', auth.uid(), null, true);
    end loop;
  end if;
  insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, closed_reason, professional_id, by_user)
  values (v_row.id, v_row.org_id, 'state_changed', v_row.state, p_state, p_closed_reason,
          case when p_state = 'matched' then p_professional_id end, auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- What a counselor proposes from
-- -----------------------------------------------------------------------------
-- The services a professional may be booked for (active, with a duration; one of her titles, or a
-- clinic service), for the proposal's form; the slots come from Rendez-vous' `get_open_slots`.
create function public.proposition_services(p_professional_id uuid)
returns table (id uuid, code int, name text, duration_minutes int, for_two boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_titles uuid[];
begin
  perform private.demandes_require('demandes.manage');
  select f.title_ids into v_titles from private.professional_booking_facts(v_org, p_professional_id) f where f.status = 'active';
  if v_titles is null then
    return;
  end if;
  return query
    select s.id, s.code, s.name, s.duration_minutes::int, s.for_two
      from public.services_catalog s
     where s.org_id = v_org and s.duration_minutes > 0
       and (s.title_ids = '{}' or s.title_ids && v_titles)
     order by s.family_sort_order, s.sort_order, s.code;
end;
$$;
revoke all on function public.proposition_services(uuid) from public, anon, authenticated;
grant execute on function public.proposition_services(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Proposing (service role: the function `demandes-propose`, the actor verified there)
-- -----------------------------------------------------------------------------
-- p_starts_at: 1 to 3 starts of the professional's free slots for the service; p_mode video or
-- phone; p_token_hash the link's. The names the person is shown are snapshotted from
-- Professionnels' `professional_display_facts` (no directory read without a user). Refusals in French (P0001, HINT the field). Returns what the email
-- needs.
create function public.create_proposition_for_service(
  p_actor uuid,
  p_demande_id uuid,
  p_professional_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz[],
  p_mode text,
  p_token_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_org uuid;
  v_to record;
  v_clients uuid[];
  v_for_two boolean;
  v_expires timestamptz;
  v_prop uuid := gen_random_uuid();
  v_start timestamptz;
  v_appt uuid;
  v_slots jsonb := '[]';
  v_link uuid;
  v_dir record;
  v_service_name text;
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    raise exception 'Invalid token hash' using errcode = '22023';
  end if;
  select d.org_id into v_org from public.demandes d where d.id = p_demande_id;
  if v_org is null
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = v_org and p.status = 'active')
     or not ('demandes.manage' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : demandes.manage' using errcode = '42501';
  end if;
  -- P3-40: nothing leaves for a client while Demandes is reserved for its testers.
  if not public.module_open_to_all_for_org(v_org, 'demandes') then
    raise exception 'Demandes est réservé aux testeurs : aucune proposition ne part vers un client pour le moment.'
      using errcode = 'P0001', hint = 'module_reserved';
  end if;
  if not public.module_enabled_for_org(v_org, 'appointments') then
    raise exception 'Activez d''abord Rendez-vous : une proposition réserve des plages dans l''agenda.' using errcode = 'P0001', hint = 'appointments';
  end if;
  select d.* into v_row from public.demandes d where d.id = p_demande_id for no key update;
  if v_row.state not in ('accepted', 'waitlist', 'proposed') then
    raise exception 'Une proposition se fait sur une demande « Acceptée » ou sur la liste d''attente : changez d''abord son état.'
      using errcode = 'P0001', hint = 'state';
  end if;
  if v_row.client_id is null then
    raise exception 'Rattachez d''abord le dossier du client (onglet Accueil).' using errcode = 'P0001', hint = 'client_id';
  end if;
  if exists (select 1 from public.demande_propositions x where x.demande_id = v_row.id and x.response = 'pending') then
    raise exception 'Une proposition attend déjà sa réponse : retirez-la d''abord.' using errcode = 'P0001';
  end if;
  if p_mode is null or p_mode not in ('video', 'phone') then
    raise exception 'Choisissez vidéo ou téléphone.' using errcode = 'P0001', hint = 'mode';
  end if;
  if p_starts_at is null or pg_catalog.cardinality(p_starts_at) not between 1 and 3
     or (select pg_catalog.count(distinct x) from pg_catalog.unnest(p_starts_at) x) <> pg_catalog.cardinality(p_starts_at) then
    raise exception 'Proposez de 1 à 3 plages différentes.' using errcode = 'P0001', hint = 'slots';
  end if;
  -- 48 h, or until the last slot starts when they all start sooner (the job then frees the request on time).
  v_expires := least(pg_catalog.now() + interval '48 hours', (select pg_catalog.max(x) from pg_catalog.unnest(p_starts_at) x));
  select r.* into v_to from private.demandes_recipient(v_org, v_row.id) r;
  if v_to.email is null then
    raise exception 'Aucune adresse courriel pour envoyer la proposition : ajoutez-la au dossier, ou proposez par téléphone.'
      using errcode = 'P0001', hint = 'email';
  end if;
  select f.for_two into v_for_two from private.service_booking_facts(v_org, p_service_id) f;
  -- The person seen, then (a couple service) the request's other participant with a file.
  v_clients := array[v_row.client_id] || coalesce((
    select array[p.client_id] from public.demande_participants p
     where v_for_two and p.demande_id = v_row.id and p.org_id = v_org and p.client_id is not null and p.client_id <> v_row.client_id
     order by p.is_primary desc, p.created_at limit 1), '{}');

  -- What the person is shown, as on the fiche (no user here: Professionnels' published facts).
  select f.display_name, f.title into v_dir from private.professional_display_facts(v_org, p_professional_id) f;
  select s.name into v_service_name from public.services_catalog s where s.id = p_service_id and s.org_id = v_org;
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  perform pg_catalog.set_config('app.audit_source', 'rpc:create_proposition', true);
  insert into public.demande_propositions
    (id, demande_id, org_id, professional_id, proposed_by, expires_at, directory_updated_at, directory_snapshot, service_id, mode, language)
  values
    (v_prop, v_row.id, v_org, p_professional_id, p_actor, v_expires, null,
     pg_catalog.jsonb_build_object('display_name', v_dir.display_name, 'title', v_dir.title, 'service_name', v_service_name),
     p_service_id, p_mode, case when v_to.language = 'en' then 'en' else 'fr' end);
  for v_start in select x from pg_catalog.unnest(p_starts_at) x order by x loop
    -- Every booking rule (R1b), in her availability; a slot starting within 48 h is held until it starts.
    v_appt := private.appointments_hold(v_org, p_professional_id, p_service_id, v_start, v_clients,
                                        least(v_expires, v_start), p_actor, v_prop, p_mode);
    v_slots := v_slots || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'appointment_id', v_appt, 'starts_at', v_start,
      'ends_at', (select a.ends_at from public.appointments a where a.id = v_appt)));
  end loop;
  v_link := private.issue_secure_link(v_org, 'proposition', 'demande_proposition', v_prop, p_token_hash, p_actor,
                                      greatest(v_expires - pg_catalog.now(), interval '1 minute'), '{}');
  perform pg_catalog.set_config('app.audit_source', 'rpc:create_proposition', true);
  update public.demande_propositions x set slots = v_slots, secure_link_id = v_link where x.id = v_prop;
  if v_row.state <> 'proposed' and private.demande_state_allowed(v_row.state, 'proposed') then
    update public.demandes d set state = 'proposed' where d.id = v_row.id;
    insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, professional_id, by_user)
    values (v_row.id, v_org, 'state_changed', v_row.state, 'proposed', p_professional_id, p_actor);
  end if;
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object(
    'proposition_id', v_prop, 'demande_id', v_row.id, 'email', v_to.email, 'first_name', v_to.first_name,
    'language', case when v_to.language = 'en' then 'en' else 'fr' end,
    'clinic_name', (select o.name from public.organizations o where o.id = v_org),
    'timezone', (select o.timezone from public.organizations o where o.id = v_org),
    'professional_name', v_dir.display_name,
    'service_name', v_service_name,
    'mode', p_mode, 'slots', v_slots, 'expires_at', v_expires);
end;
$$;
revoke all on function public.create_proposition_for_service(uuid, uuid, uuid, uuid, timestamptz[], text, bytea) from public, anon, authenticated;
grant execute on function public.create_proposition_for_service(uuid, uuid, uuid, uuid, timestamptz[], text, bytea) to service_role;

-- -----------------------------------------------------------------------------
-- The link (resolve-link, then `demandes-proposition-answer`)
-- -----------------------------------------------------------------------------
create function public.resolve_proposition_link(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'clinic_name', o.name, 'timezone', o.timezone, 'language', coalesce(x.language, 'fr'),
           'professional_name', x.directory_snapshot ->> 'display_name', 'professional_title', x.directory_snapshot ->> 'title',
           'service_name', x.directory_snapshot ->> 'service_name', 'mode', x.mode, 'expires_at', x.expires_at,
           'slots', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                       'id', y.value ->> 'appointment_id', 'starts_at', y.value ->> 'starts_at', 'ends_at', y.value ->> 'ends_at')
                                     order by y.value ->> 'starts_at'), '[]'::jsonb)
                       from pg_catalog.jsonb_array_elements(x.slots) y
                      where (y.value ->> 'starts_at')::timestamptz > pg_catalog.now()))
    from public.secure_links l
    join public.demande_propositions x on x.id = l.subject_id and x.org_id = l.org_id
    join public.organizations o on o.id = l.org_id
   where l.id = p_link_id and l.purpose = 'proposition' and l.subject_type = 'demande_proposition'
     and l.revoked_at is null and l.expires_at > pg_catalog.now() and l.use_count < l.max_uses
     and x.response = 'pending' and x.expires_at > pg_catalog.now()
     and public.module_enabled_for_org(l.org_id, 'appointments')
     -- P3-40: while Demandes is reserved for its testers, a link sent before shows nothing.
     and public.module_open_to_all_for_org(l.org_id, 'demandes')
$$;
revoke all on function public.resolve_proposition_link(uuid) from public, anon, authenticated;
grant execute on function public.resolve_proposition_link(uuid) to service_role;

insert into public.secure_link_purposes
  (key, module_key, default_ttl, max_ttl, max_uses, requires_session, creates_account, resolve_rpc, accept_rpc, view_permission)
values ('proposition', 'demandes', interval '48 hours', interval '48 hours', 1, false, false,
        'resolve_proposition_link', null, 'demandes.view')
on conflict do nothing;

-- The person's answer (once): p_appointment_id one of the slots → booked (R1b re-checks every
-- rule), the others freed, the request matched with the professional (its waiting-list entries
-- « Placée »); a slot no longer possible answers {state: unavailable, reason: the HINT} and the link
-- stays usable for another. p_appointment_id null → declined (p_decline_reason: schedule, fee,
-- professional, changed_mind, other, or none), all freed. Demandes switched off or reserved for its
-- testers (P3-40), Rendez-vous off, a used, expired or revoked link → {state: invalid}.
create function public.answer_proposition_for_service(p_token_hash bytea, p_appointment_id uuid, p_decline_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.secure_links;
  v public.demande_propositions;
  v_state text;
  v_hint text;
  s jsonb;
begin
  if p_decline_reason is not null and p_decline_reason not in ('schedule', 'fee', 'professional', 'changed_mind', 'other') then
    raise exception 'Unknown reason' using errcode = '22023';
  end if;
  -- The link read first without a lock; then the request, the proposal and the link locked in the
  -- order every other writer takes (set_demande_state, withdraw, the job), and checked again.
  select l.* into v_link from public.secure_links l
   where l.token_hash = p_token_hash and l.purpose = 'proposition' and l.subject_type = 'demande_proposition';
  -- P3-40: while Demandes is reserved for its testers, nothing is booked for a client through a link.
  if v_link.id is null or not public.module_open_to_all_for_org(v_link.org_id, 'demandes')
     or not public.module_enabled_for_org(v_link.org_id, 'appointments') then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  select x.* into v from public.demande_propositions x where x.id = v_link.subject_id and x.org_id = v_link.org_id;
  if v.id is null then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  select d.state into v_state from public.demandes d where d.id = v.demande_id and d.org_id = v.org_id for no key update;
  select x.* into v from public.demande_propositions x where x.id = v.id for update;
  select l.* into v_link from public.secure_links l where l.id = v_link.id for update;
  if v_link.revoked_at is not null or v_link.expires_at <= pg_catalog.now() or v_link.use_count >= v_link.max_uses
     or v.response <> 'pending' or v.expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  perform pg_catalog.set_config('app.audit_source', 'link:proposition', true);

  if p_appointment_id is null then
    perform private.consume_secure_link(p_token_hash, 'proposition');
    perform private.demandes_end_proposition(v.org_id, v.id, 'declined', 'declined', null, p_decline_reason);
    perform private.notify(v.org_id, 'demandes', 'demandes.proposition_declined', 'normal',
      'Proposition refusée', 'La personne n''a choisi aucune des plages proposées.',
      '/demandes/' || v.demande_id || '/suivi', 'demande_proposition', v.id, 'demandes.manage', null,
      'declined:' || v.id::text, pg_catalog.now() + interval '30 days');
    return pg_catalog.jsonb_build_object('state', 'declined');
  end if;

  if not exists (select 1 from pg_catalog.jsonb_array_elements(v.slots) y where (y.value ->> 'appointment_id')::uuid = p_appointment_id) then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  begin
    perform private.appointments_confirm_hold(v.org_id, p_appointment_id, null);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_hint = pg_exception_hint;
    return pg_catalog.jsonb_build_object('state', 'unavailable', 'reason', coalesce(nullif(v_hint, ''), 'unavailable'));
  end;
  perform private.consume_secure_link(p_token_hash, 'proposition');
  for s in select y.value from pg_catalog.jsonb_array_elements(v.slots) y where (y.value ->> 'appointment_id')::uuid <> p_appointment_id loop
    perform private.appointments_release_hold(v.org_id, (s ->> 'appointment_id')::uuid, 'other_accepted');
  end loop;
  perform pg_catalog.set_config('app.audit_source', 'link:proposition', true);
  update public.demande_propositions x
     set response = 'accepted', responded_at = pg_catalog.now(), accepted_appointment_id = p_appointment_id,
         accepted_starts_at = (select a.starts_at from public.appointments a where a.id = p_appointment_id)
   where x.id = v.id;
  if v_state = 'matched' or private.demande_state_allowed(v_state, 'matched') then
    perform private.waitlist_place(v.org_id, v.demande_id, v.professional_id, null);
  end if;
  perform private.notify(v.org_id, 'demandes', 'demandes.proposition_accepted', 'normal',
    'Proposition acceptée', 'La personne a choisi une plage : le premier rendez-vous est réservé.',
    '/demandes/' || v.demande_id || '/suivi', 'demande_proposition', v.id, 'demandes.manage', null,
    'accepted:' || v.id::text, pg_catalog.now() + interval '30 days');
  return pg_catalog.jsonb_build_object('state', 'accepted',
    'starts_at', (select a.starts_at from public.appointments a where a.id = p_appointment_id));
end;
$$;
revoke all on function public.answer_proposition_for_service(bytea, uuid, text) from public, anon, authenticated;
grant execute on function public.answer_proposition_for_service(bytea, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- The counselor: withdraw, read
-- -----------------------------------------------------------------------------
create function public.withdraw_proposition(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_demande uuid;
begin
  perform private.demandes_require('demandes.manage');
  select x.demande_id into v_demande from public.demande_propositions x
   where x.id = p_id and x.org_id = private.current_user_org_id();
  if v_demande is null then
    raise exception 'Cette proposition n''existe pas.' using errcode = 'P0001';
  end if;
  perform private.demandes_lock(v_demande);
  perform pg_catalog.set_config('app.audit_source', 'rpc:withdraw_proposition', true);
  if not private.demandes_end_proposition(private.current_user_org_id(), p_id, 'withdrawn', 'withdrawn', auth.uid()) then
    raise exception 'Cette proposition a déjà sa réponse.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.withdraw_proposition(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_proposition(uuid) to authenticated;

-- A request's proposals, most recent first: the professional (as proposed), the service, the
-- slots, the answer and when, the slot chosen, who proposed.
create function public.list_demande_propositions(p_demande_id uuid)
returns table (
  id uuid, professional_id uuid, professional_name text, service_name text, mode text, slots jsonb,
  proposed_at timestamptz, proposed_by_name text, expires_at timestamptz, response text, responded_at timestamptz,
  decline_reason text, accepted_starts_at timestamptz
)
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
    select x.id, x.professional_id, coalesce(x.directory_snapshot ->> 'display_name', p.display_name), s.name, x.mode, x.slots,
           x.proposed_at, pr.display_name, x.expires_at, x.response, x.responded_at, x.decline_reason, x.accepted_starts_at
      from public.demande_propositions x
      left join public.professionals_directory p on p.id = x.professional_id and p.org_id = x.org_id
      left join public.services_catalog s on s.id = x.service_id and s.org_id = x.org_id
      left join public.profiles pr on pr.user_id = x.proposed_by and pr.org_id = x.org_id
     where x.org_id = v_org and x.demande_id = p_demande_id
     order by x.proposed_at desc;
end;
$$;
revoke all on function public.list_demande_propositions(uuid) from public, anon, authenticated;
grant execute on function public.list_demande_propositions(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 48 h without an answer (the job `demandes.propositions_expire`, every 10 minutes)
-- -----------------------------------------------------------------------------
create function private.job_demandes_propositions_expire()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v record;
  v_count int := 0;
begin
  perform pg_catalog.set_config('app.audit_source', 'job:demandes.propositions_expire', true);
  for v in select x.id, x.org_id, x.demande_id from public.demande_propositions x
            where x.response = 'pending' and x.expires_at <= pg_catalog.now()
            order by x.expires_at limit 500 loop
    perform 1 from public.demandes d where d.id = v.demande_id for no key update;
    if private.demandes_end_proposition(v.org_id, v.id, 'expired', 'expired', null) then
      v_count := v_count + 1;
      perform private.notify(v.org_id, 'demandes', 'demandes.proposition_expired', 'normal',
        'Proposition sans réponse', 'La personne n''a pas répondu en 48 h : les plages sont libérées. Rappelez-la.',
        '/demandes/' || v.demande_id || '/suivi', 'demande_proposition', v.id, 'demandes.manage', null,
        'expired:' || v.id::text, pg_catalog.now() + interval '30 days');
    end if;
  end loop;
  return 'expired=' || v_count;
end;
$$;
revoke all on function private.job_demandes_propositions_expire() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('demandes.propositions_expire', 'demandes', 'Propositions sans réponse',
   'Après 48 h sans réponse, libère les plages d''une proposition et l''annonce aux conseillères.',
   'sql', 'private.job_demandes_propositions_expire', 'demandes.propositions_expire', true)
on conflict do nothing;

select cron.schedule('demandes.propositions_expire', '*/10 * * * *',
  $$select private.run_sql_job('demandes.propositions_expire')$$);

-- -----------------------------------------------------------------------------
-- The email
-- -----------------------------------------------------------------------------
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission)
values
  ('demandes.proposition', 'demandes',
   'Proposition d''un professionnel',
   'Envoyé à la personne quand une conseillère lui propose un professionnel et des plages pour un premier rendez-vous.',
   'Vous recevez ce courriel parce que vous avez fait une demande de service à la clinique.',
   'Votre premier rendez-vous avec {{professional.name}} — {{clinic.name}}',
   E'Bonjour {{person.first_name}},\n\n'
   'Comme convenu avec votre conseillère, nous vous proposons un premier rendez-vous avec {{professional.name}} ({{proposal.service}}). Les plages suivantes vous sont réservées jusqu''au {{proposal.expires_at}} :\n\n'
   '{{proposal.slots}}\n\n'
   'Choisissez votre plage avec le bouton ci-dessous. Si aucune ne vous convient, dites-le-nous au même endroit.',
   'Choisir ma plage',
   '[
     {"path": "person.first_name", "label": "Prénom de la personne", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "professional.name", "label": "Nom du professionnel", "sample": "Marie Tremblay", "required": true, "kind": "text"},
     {"path": "proposal.service", "label": "Service", "sample": "Consultation individuelle 50 min", "required": true, "kind": "text"},
     {"path": "proposal.slots", "label": "Plages proposées", "sample": "mardi 14 octobre à 10 h 00", "required": true, "kind": "text"},
     {"path": "proposal.expires_at", "label": "Réservées jusqu''au", "sample": "16 octobre 2026 à 9 h 00", "required": true, "kind": "datetime"}
   ]',
   'demandes.view'),
  ('demandes.proposition_en', 'demandes',
   'Proposition d''un professionnel (anglais)',
   'La même proposition en anglais, quand la personne parle anglais.',
   'You receive this email because you asked the clinic for a service.',
   'Your first appointment with {{professional.name}} — {{clinic.name}}',
   E'Hello {{person.first_name}},\n\n'
   'As discussed with your counselor, we propose a first appointment with {{professional.name}} ({{proposal.service}}). These times are held for you until {{proposal.expires_at}}:\n\n'
   '{{proposal.slots}}\n\n'
   'Choose your time with the button below. If none suits you, tell us there.',
   'Choose my time',
   '[
     {"path": "person.first_name", "label": "Prénom de la personne", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "professional.name", "label": "Nom du professionnel", "sample": "Marie Tremblay", "required": true, "kind": "text"},
     {"path": "proposal.service", "label": "Service", "sample": "Individual consultation 50 min", "required": true, "kind": "text"},
     {"path": "proposal.slots", "label": "Plages proposées", "sample": "Tuesday, October 14 at 10:00 AM", "required": true, "kind": "text"},
     {"path": "proposal.expires_at", "label": "Réservées jusqu''au", "sample": "Friday, October 16 at 9:00 AM", "required": true, "kind": "text"}
   ]',
   'demandes.view')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- No user (a link's answer, a job): Professionnels' published facts, never its directory
-- (`professionals_directory` needs professionals.view, so it reads nothing without a user)
-- -----------------------------------------------------------------------------
-- Placing through a proposal's link: « active » from `professional_display_facts`.
create or replace function private.waitlist_place(p_org uuid, p_demande uuid, p_professional uuid, p_actor uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row public.demandes;
  e record;
begin
  -- Professionnels' published facts: no user is needed (the person's answer through a link).
  if p_professional is null or not exists (
       select 1 from private.professional_display_facts(p_org, p_professional) f where f.status = 'active') then
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
  -- Matched: a proposal still pending is withdrawn (its slots freed); the one being accepted is not pending any more.
  for e in select x.id from public.demande_propositions x where x.demande_id = p_demande and x.org_id = p_org and x.response = 'pending' loop
    perform private.demandes_end_proposition(p_org, e.id, 'withdrawn', 'demande_closed', p_actor, null, true);
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

-- The waiting list's « still waiting? » email (the job): a professional's list named as on her fiche.
create or replace function public.prepare_waitlist_followup_for_service(p_org_id uuid, p_entry_id uuid, p_token_hash bytea)
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
    -- The job has no user: a professional's list is named as on her fiche (Professionnels'
    -- published display facts), never through the directory, which needs professionals.view.
    'list_name', (select coalesce(t.name, f.display_name)
                    from public.waitlist_entries x
                    left join public.profession_titles_catalog t on t.id = x.target_profession_title_id and t.org_id = x.org_id
                    left join lateral private.professional_display_facts(x.org_id, x.target_professional_id) f on x.target_professional_id is not null
                   where x.id = v.id),
    'link_expires_at', v_expires);
end;
$$;
