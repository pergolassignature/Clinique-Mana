-- =============================================================================
-- Demandes: the pre-cutover security review (2026-10-14)
-- =============================================================================
-- 1. The public booking page never tells whether an address already has a call: a second booking
--    with the same address answers like a booking (`book_discovery_call_for_service` returns the
--    same keys), makes no request and no call, and gives the earlier call a fresh cancel link that
--    the function sends with the usual confirmation (its time, its first name, its language), to
--    that address only. `requested_starts_at` (every answer) is the slot the page shows.
-- 2. A professional stops seeing a request's files when she loses them: a participant removed,
--    the request's file changed, the request leaving « Jumelée » (unmatched or closed). Demandes'
--    `private.demandes_release_clients` keeps a file another request still matched to her holds,
--    then calls Clients' new `private.clients_unlink_professional_reason` (only a link of reason
--    `demande`, only while no appointment of hers holds the file: Rendez-vous' new
--    `private.appointments_professional_has_client`); the file's primary professional, when it is
--    her, goes with the link (a match had set it).
-- 3. The anonymisation (`private.demandes_anonymize_client`) also blanks the requests' free text,
--    insurer and source, deletes their internal note, and replaces the waiting list's reasons.
-- 4. The audit of `demandes` also redacts the insurer, « Autres disponibilités », the legal
--    context and the issues, with their yes / no answers.
-- 5. The cancel link does nothing while Demandes is off.
-- 6. « Facturer l'inscription » is refused while Demandes is reserved for its testers (P3-40).
-- 7. The booking's names: 99 characters each, name characters, no web address (French refusal).
-- 8. An offer's slots are stored rebuilt: a start and an end, nothing else.
-- 9. The « still waiting? » link names a professional's list through her published display facts
--    (no user: the directory gave nothing).
-- Same signatures and grants; three helpers granted to no role; the audit trigger recreated.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_security_fixes', true);

-- -----------------------------------------------------------------------------
-- 1, 7. The booking
-- -----------------------------------------------------------------------------
create or replace function public.book_discovery_call_for_service(p_org_id uuid, p_payload jsonb, p_token_hash bytea)
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
  v_dup record;
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
  -- A name, nothing else: it is written in emails (« Bonjour … »), so never a web address.
  if pg_catalog.char_length(v_first) > 99 or pg_catalog.char_length(v_last) > 99
     or not private.is_tidy_text(v_first) or not private.is_tidy_text(v_last)
     or (v_first || ' ' || v_last) ~ '[0-9/\\:@<>{}=?&#%|_~^$*+;"\[\]]'
     or (v_first || ' ' || v_last) ~ '\.[A-Za-z]' then
    raise exception 'Indiquez votre prénom et votre nom en lettres (99 caractères au plus chacun).' using errcode = 'P0001', hint = 'name';
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
  if v_source is not null and not exists (select 1 from public.referral_sources_catalog r where r.org_id = p_org_id and r.id = v_source) then
    v_source := null;  -- a stale list: the answer is dropped, never the booking
  end if;

  -- One booking at a time per clinic: a slot is never given twice.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('demandes.booking:' || p_org_id::text, 0));
  if v_starts is null or not exists (select 1 from private.demandes_booking_slots(p_org_id) s where s.starts_at = v_starts) then
    raise exception 'Cette plage n''est plus libre : choisissez-en une autre.' using errcode = 'P0001', hint = 'slot';
  end if;

  -- The same address already has a call: the anonymous page never learns it. The answer reads as a
  -- booking; nothing new is made; the earlier call gets a fresh cancel link that the caller sends
  -- with the usual confirmation (the call's own time, first name and language) to that address.
  select t.id, t.due_at, d.id as demande_id, d.reference, d.language, d.contact_name into v_dup
    from public.demande_tasks t join public.demandes d on d.id = t.demande_id and d.org_id = t.org_id
   where t.org_id = p_org_id and t.kind = 'discovery_call' and t.state = 'open' and t.due_at > pg_catalog.now()
     and d.contact_email = v_email and d.channel = 'booking_page'
   order by t.due_at, t.id
   limit 1
   for update of t;
  if found then
    perform pg_catalog.set_config('app.audit_source', 'rpc:book_discovery_call', true);
    v_link := private.issue_secure_link(p_org_id, 'discovery_call', 'demande_task', v_dup.id, p_token_hash, null,
                                        least(greatest(v_dup.due_at - pg_catalog.now(), interval '1 hour'), interval '30 days'), '{}');
    select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
    return pg_catalog.jsonb_build_object(
      'demande_id', v_dup.demande_id, 'task_id', v_dup.id, 'reference', v_dup.reference,
      'starts_at', v_dup.due_at, 'requested_starts_at', v_starts, 'clinic_name', v_org.name, 'timezone', v_org.timezone,
      'language', case when v_dup.language = 'en' then 'en' else 'fr' end,
      'first_name', coalesce(nullif(pg_catalog.split_part(v_dup.contact_name, ' ', 1), ''), v_first),
      'email', v_email, 'link_expires_at', v_expires);
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
    'starts_at', v_starts, 'requested_starts_at', v_starts, 'clinic_name', v_org.name, 'timezone', v_org.timezone,
    'language', v_language, 'first_name', v_first, 'email', v_email, 'link_expires_at', v_expires);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. The cancel link obeys the module
-- -----------------------------------------------------------------------------
create or replace function public.cancel_discovery_call_for_service(p_token_hash bytea)
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
  if not public.module_enabled_for_org(v_link.org_id, 'demandes') then
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

-- -----------------------------------------------------------------------------
-- 2. A professional's sight of a request's files
-- -----------------------------------------------------------------------------
-- Rendez-vous, published for Clients: whether a professional has an appointment with a client
-- (held, booked, confirmed or completed; cancelled late, which may be billed). For definer callers
-- after their own check; granted to no role.
create function private.appointments_professional_has_client(p_org uuid, p_client_id uuid, p_professional_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.appointment_participants p
                   join public.appointments a on a.id = p.appointment_id and a.org_id = p.org_id
                  where p.org_id = p_org and p.client_id = p_client_id and a.professional_id = p_professional_id
                    and not a.is_personal and (a.state <> 'cancelled' or a.cancel_late is true))
$$;
revoke all on function private.appointments_professional_has_client(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Clients, published for Demandes: ends a professional's sight of a client given for p_reason
-- (Demandes: `demande`), never a link of another first reason, never while an appointment of hers
-- holds the client. The file's primary professional, when it is her, goes with it (the match had
-- set it). Returns whether the link went. For definer callers after their permission check, with
-- the org they verified; granted to no role.
create function private.clients_unlink_professional_reason(p_org uuid, p_client_id uuid, p_professional_id uuid, p_reason text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_org is null or p_client_id is null or p_professional_id is null or p_reason is null then
    return false;
  end if;
  if private.appointments_professional_has_client(p_org, p_client_id, p_professional_id) then
    return false;
  end if;
  delete from public.client_professional_links l
   where l.org_id = p_org and l.client_id = p_client_id and l.professional_id = p_professional_id and l.reason = p_reason;
  if not found then
    return false;
  end if;
  update public.clients c set primary_professional_id = null
   where c.org_id = p_org and c.id = p_client_id and c.primary_professional_id = p_professional_id;
  return true;
end;
$$;
revoke all on function private.clients_unlink_professional_reason(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;

-- Demandes: the professional lost these files (a participant removed, the file changed, the
-- request no longer matched to her). A file another request still matched to her holds (its file
-- or a participant's) stays; the others go through Clients' helper above.
create function private.demandes_release_clients(p_org uuid, p_professional_id uuid, p_client_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_client uuid;
begin
  if p_professional_id is null then
    return;
  end if;
  foreach v_client in array coalesce(p_client_ids, '{}'::uuid[]) loop
    continue when v_client is null;
    continue when exists (
      select 1 from public.demandes d
       where d.org_id = p_org and d.state = 'matched' and d.matched_professional_id = p_professional_id
         and (d.client_id = v_client
              or exists (select 1 from public.demande_participants x
                          where x.demande_id = d.id and x.org_id = d.org_id and x.client_id = v_client)));
    perform private.clients_unlink_professional_reason(p_org, v_client, p_professional_id, 'demande');
  end loop;
end;
$$;
revoke all on function private.demandes_release_clients(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;

-- set_demande_state: leaving « Jumelée » releases the professional's files (otherwise as before).
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
  if v_row.state = 'matched' then
    perform private.demandes_release_clients(v_row.org_id, v_row.matched_professional_id, array(
      select v_row.client_id
      union
      select x.client_id from public.demande_participants x where x.demande_id = v_row.id and x.org_id = v_row.org_id));
  end if;
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

-- update_demande: a matched request's file changed releases the old file (otherwise as before).
create or replace function public.update_demande(p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_urgent boolean;
  v_client uuid;
  v_constraint text;
begin
  perform private.demandes_require('demandes.manage');
  perform private.demandes_check_intake(p_patch, array[]::text[]);
  v_row := private.demandes_lock(p_id);
  if v_row.state = 'closed' then
    raise exception 'Cette demande est fermée : rouvrez-la pour la modifier.' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:update_demande', true);
  begin
  update public.demandes d set
    client_id = case when p_patch ? 'client_id' then private.demandes_text(p_patch, 'client_id')::uuid else d.client_id end,
    contact_name = case when p_patch ? 'contact_name' then private.demandes_text(p_patch, 'contact_name') else d.contact_name end,
    contact_email = case when p_patch ? 'contact_email' then pg_catalog.lower(private.demandes_text(p_patch, 'contact_email')) else d.contact_email end,
    contact_phone_e164 = case when p_patch ? 'contact_phone_e164' then private.demandes_text(p_patch, 'contact_phone_e164') else d.contact_phone_e164 end,
    beneficiary = case when p_patch ? 'beneficiary' then private.demandes_text(p_patch, 'beneficiary') else d.beneficiary end,
    previous_therapy = case when p_patch ? 'previous_therapy' then (p_patch->>'previous_therapy')::boolean else d.previous_therapy end,
    language = case when p_patch ? 'language' then coalesce(private.demandes_text(p_patch, 'language'), 'fr') else d.language end,
    modality = case when p_patch ? 'modality' then coalesce(private.demandes_text(p_patch, 'modality'), 'any') else d.modality end,
    availability_periods = case when p_patch ? 'availability_periods'
      then coalesce((select array_agg(x) from jsonb_array_elements_text(private.demandes_array(p_patch, 'availability_periods')) x), '{}')
      else d.availability_periods end,
    availability_days = case when p_patch ? 'availability_days'
      then coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(private.demandes_array(p_patch, 'availability_days')) x), '{}')
      else d.availability_days end,
    preferred_pro_gender = case when p_patch ? 'preferred_pro_gender' then coalesce(private.demandes_text(p_patch, 'preferred_pro_gender'), 'any') else d.preferred_pro_gender end,
    profession_title_id = case when p_patch ? 'profession_title_id' then private.demandes_text(p_patch, 'profession_title_id')::uuid else d.profession_title_id end,
    clientele_id = case when p_patch ? 'clientele_id' then private.demandes_text(p_patch, 'clientele_id')::uuid else d.clientele_id end,
    concerns = case when p_patch ? 'concerns' then private.demandes_text(p_patch, 'concerns') else d.concerns end,
    payer_kind = case when p_patch ? 'payer_kind' then coalesce(private.demandes_text(p_patch, 'payer_kind'), 'unknown') else d.payer_kind end,
    insurer = case when p_patch ? 'insurer' then private.demandes_text(p_patch, 'insurer') else d.insurer end,
    is_urgent = case when p_patch ? 'is_urgent' then coalesce((p_patch->>'is_urgent')::boolean, false) else d.is_urgent end,
    has_issues = case when p_patch ? 'has_issues' then (p_patch->>'has_issues')::boolean else d.has_issues end,
    issues = case when p_patch ? 'issues' then private.demandes_codes(p_patch, 'issues') else d.issues end,
    issues_comment = case when p_patch ? 'issues_comment' then private.demandes_text(p_patch, 'issues_comment') else d.issues_comment end,
    previous_professionals = case when p_patch ? 'previous_professionals' then private.demandes_codes(p_patch, 'previous_professionals')
                                  else d.previous_professionals end,
    previous_comment = case when p_patch ? 'previous_comment' then private.demandes_text(p_patch, 'previous_comment') else d.previous_comment end,
    has_legal_context = case when p_patch ? 'has_legal_context' then (p_patch->>'has_legal_context')::boolean else d.has_legal_context end,
    legal_context = case when p_patch ? 'legal_context' then private.demandes_codes(p_patch, 'legal_context') else d.legal_context end,
    legal_detail = case when p_patch ? 'legal_detail' then private.demandes_text(p_patch, 'legal_detail') else d.legal_detail end,
    motif_other = case when p_patch ? 'motif_other' then private.demandes_text(p_patch, 'motif_other') else d.motif_other end,
    availability_other = case when p_patch ? 'availability_other' then private.demandes_text(p_patch, 'availability_other') else d.availability_other end
   where d.id = v_row.id
  returning d.is_urgent, d.client_id into v_urgent, v_client;
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'demandes_contact_check' then
      raise exception 'Gardez un moyen de joindre la personne : un dossier, un nom, un courriel ou un téléphone.' using errcode = 'P0001';
    end if;
    raise;
  end;

  if p_patch ? 'motif_ids' then
    perform private.demandes_set_motifs(v_row.org_id, v_row.id, private.demandes_array(p_patch, 'motif_ids'));
  end if;
  if v_client is distinct from v_row.client_id then
    if v_row.state = 'matched' and v_row.client_id is not null then
      perform private.demandes_release_clients(v_row.org_id, v_row.matched_professional_id, array[v_row.client_id]);
    end if;
    perform private.demandes_link_clients(v_row.org_id, v_row.id);
  end if;
  if v_urgent is distinct from v_row.is_urgent then
    insert into public.demande_events (demande_id, org_id, kind, by_user)
    values (v_row.id, v_row.org_id, case when v_urgent then 'urgent_set' else 'urgent_cleared' end, auth.uid());
  end if;
end;
$$;

-- set_demande_participants: a matched request's participants removed (or their file changed)
-- release their files (otherwise as before).
create or replace function public.set_demande_participants(p_id uuid, p_participants jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_before uuid[];
begin
  perform private.demandes_require('demandes.manage');
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' or jsonb_array_length(p_participants) > 10 then
    raise exception 'Participants must be an array of at most 10' using errcode = '22023';
  end if;
  if jsonb_array_length(p_participants) > 0
     and (select count(*) from jsonb_array_elements(p_participants) e where coalesce((e->>'is_primary')::boolean, false)) <> 1 then
    raise exception 'Une seule personne est la personne principale.' using errcode = 'P0001';
  end if;
  if (select count(e->>'id') <> count(distinct e->>'id') from jsonb_array_elements(p_participants) e) then
    raise exception 'Chaque personne n''apparaît qu''une fois.' using errcode = 'P0001';
  end if;
  v_row := private.demandes_lock(p_id);
  if v_row.state = 'closed' then
    raise exception 'Cette demande est fermée : rouvrez-la pour la modifier.' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_demande_participants', true);
  v_before := array(select p.client_id from public.demande_participants p
                     where p.demande_id = v_row.id and p.org_id = v_row.org_id and p.client_id is not null);

  create temp table if not exists tmp_demande_participants (
    id uuid, client_id uuid, display_name text, relationship text, birthday date, is_primary boolean
  ) on commit drop;
  truncate pg_temp.tmp_demande_participants;
  insert into pg_temp.tmp_demande_participants
  -- An id that is not one of this request's participants is a new row.
  select case when x.id in (select p.id from public.demande_participants p where p.demande_id = v_row.id) then x.id
              else gen_random_uuid() end,
         x.client_id, nullif(pg_catalog.btrim(x.display_name), ''),
         coalesce(x.relationship, 'self'), x.birthday, coalesce(x.is_primary, false)
    from jsonb_to_recordset(p_participants) as x(id uuid, client_id uuid, display_name text, relationship text,
                                                   birthday date, is_primary boolean);

  delete from public.demande_participants p
   where p.demande_id = v_row.id and p.id not in (select t.id from pg_temp.tmp_demande_participants t);
  -- The main person first loses the flag, so the one-primary index never sees two.
  update public.demande_participants p set is_primary = false
   where p.demande_id = v_row.id and p.is_primary
     and p.id in (select t.id from pg_temp.tmp_demande_participants t where not t.is_primary);
  insert into public.demande_participants as p (id, demande_id, org_id, client_id, display_name, relationship, birthday, is_primary)
  select t.id, v_row.id, v_row.org_id, t.client_id, t.display_name, t.relationship, t.birthday, t.is_primary
    from pg_temp.tmp_demande_participants t
  on conflict (demande_id, id) do update set
    client_id = excluded.client_id, display_name = excluded.display_name, relationship = excluded.relationship,
    birthday = excluded.birthday, is_primary = excluded.is_primary;
  if v_row.state = 'matched' then
    perform private.demandes_release_clients(v_row.org_id, v_row.matched_professional_id, v_before);
  end if;
  perform private.demandes_link_clients(v_row.org_id, v_row.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. The anonymisation
-- -----------------------------------------------------------------------------
-- Blanks Demandes' own copies of the person: on her requests (her file), the contact, the free
-- text, the insurer and the source; their internal note is deleted; the waiting list's reasons
-- (her entries, her requests' entries) are replaced (the priority and the waiver stay: the checks
-- keep a reason with them). A participant's name and birthday, as before.
create or replace function private.demandes_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
begin
  update public.demandes d
     set contact_name = null, contact_email = null, contact_phone_e164 = null,
         concerns = null, issues_comment = null, previous_comment = null, legal_detail = null, legal_context = '{}',
         motif_other = null, availability_other = null, insurer = null,
         source_referrer = null, source_landing_page = null, source_utm = '{}'
   where d.client_id = p_id
     and (d.contact_name is not null or d.contact_email is not null or d.contact_phone_e164 is not null
          or d.concerns is not null or d.issues_comment is not null or d.previous_comment is not null or d.legal_detail is not null
          or d.legal_context <> '{}' or d.motif_other is not null or d.availability_other is not null or d.insurer is not null
          or d.source_referrer is not null or d.source_landing_page is not null or d.source_utm <> '{}');
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  delete from public.demande_notes n
   where n.demande_id in (select d.id from public.demandes d where d.client_id = p_id and d.org_id = n.org_id);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.waitlist_entries w
     set priority_reason = case when w.priority_reason is not null then 'Anonymisé' end,
         fee_waived_reason = case when w.fee_waived_reason is not null then 'Anonymisé' end
   where (w.client_id = p_id or w.demande_id in (select d.id from public.demandes d where d.client_id = p_id and d.org_id = w.org_id))
     and (w.priority_reason is distinct from 'Anonymisé' and w.priority_reason is not null
          or w.fee_waived_reason is distinct from 'Anonymisé' and w.fee_waived_reason is not null);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.demande_participants p set display_name = null, birthday = null
   where p.client_id = p_id and (p.display_name is not null or p.birthday is not null);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. The audit of demandes: the remaining personal columns redacted
-- -----------------------------------------------------------------------------
drop trigger demandes_audit on public.demandes;
create trigger demandes_audit after insert or update or delete on public.demandes
  for each row execute function private.audit_trigger(
    'contact_name', 'contact_email', 'contact_phone_e164', 'concerns', 'source_referrer', 'source_utm', 'source_landing_page',
    'issues_comment', 'previous_comment', 'legal_detail', 'motif_other',
    'availability_other', 'insurer', 'legal_context', 'issues', 'has_legal_context', 'has_issues');

-- -----------------------------------------------------------------------------
-- 6. « Facturer l'inscription » and P3-40
-- -----------------------------------------------------------------------------
create or replace function public.invoice_waitlist_fee(p_entry_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.waitlist_entries;
  r record;
begin
  perform private.demandes_require('demandes.waitlist');
  -- P3-40: nothing leaves for a client while Demandes is reserved for its testers.
  if private.module_sends_held(private.current_user_org_id(), 'demandes') then
    raise exception 'Demandes est réservé aux testeurs : aucune facture d''inscription ne part vers un client pour le moment.'
      using errcode = 'P0001', hint = 'module_reserved';
  end if;
  if not public.module_enabled_for_org(private.current_user_org_id(), 'billing') then
    raise exception 'La Facturation n''est pas activée : notez les frais à la main (payés ou exonérés).' using errcode = 'P0001', hint = 'billing';
  end if;
  v := private.waitlist_lock(p_entry_id);
  if v.client_id is null then
    raise exception 'Liez d''abord l''inscription au dossier du client.' using errcode = 'P0001', hint = 'client_id';
  end if;
  if v.fee_status <> 'to_invoice' then
    raise exception 'Les frais de cette inscription ne sont pas « À facturer ».' using errcode = 'P0001', hint = 'fee_status';
  end if;
  select x.* into r from private.billing_create_waitlist_fee_invoice(v.org_id, v.client_id, v.id, auth.uid()) x;
  perform pg_catalog.set_config('app.audit_source', 'rpc:invoice_waitlist_fee', true);
  update public.waitlist_entries e set fee_status = 'invoiced', fee_invoice_id = r.invoice_id, fee_waived_reason = null
   where e.id = v.id;
  return r.number;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. An offer's slots, rebuilt
-- -----------------------------------------------------------------------------
create or replace function public.add_waitlist_offer(p_id uuid, p_professional_id uuid, p_slots jsonb default '[]')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.waitlist_entries;
  v_slot jsonb;
  v_offer uuid;
  v_slots jsonb;
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
  -- Stored rebuilt: a start and an end, nothing else the caller sent.
  v_slots := coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'starts_at', (x.value ->> 'starts_at')::timestamptz,
                                 'ends_at', (x.value ->> 'ends_at')::timestamptz) order by x.ordinality)
                         from pg_catalog.jsonb_array_elements(p_slots) with ordinality x), '[]'::jsonb);
  perform pg_catalog.set_config('app.audit_source', 'rpc:add_waitlist_offer', true);
  insert into public.waitlist_offers (entry_id, org_id, professional_id, slots, channel, offered_by)
  values (v.id, v.org_id, p_professional_id, v_slots, 'phone', auth.uid())
  returning id into v_offer;
  update public.waitlist_entries e set state = 'offered' where e.id = v.id;
  return v_offer;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. The « still waiting? » link names a professional's list
-- -----------------------------------------------------------------------------
-- The service role has no user: a professional's list is named as on her fiche (Professionnels'
-- published display facts), never through the directory, which needs professionals.view.
create or replace function public.resolve_waitlist_followup_link(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('clinic_name', o.name, 'list_name', coalesce(f.display_name, t.name),
                                       'language', coalesce(d.language, 'fr'))
    from public.secure_links l
    join public.waitlist_entries e on e.id = l.subject_id and e.org_id = l.org_id
    join public.organizations o on o.id = l.org_id
    left join public.demandes d on d.id = e.demande_id and d.org_id = e.org_id
    left join lateral private.professional_display_facts(e.org_id, e.target_professional_id) f on e.target_professional_id is not null
    left join public.profession_titles_catalog t on t.id = e.target_profession_title_id and t.org_id = e.org_id
   where l.id = p_link_id and l.purpose = 'waitlist_followup' and l.subject_type = 'waitlist_entry'
     and l.revoked_at is null and l.expires_at > pg_catalog.now() and l.use_count < l.max_uses
     and e.state <> 'closed'
$$;

select pg_catalog.set_config('app.audit_source', '', true);
