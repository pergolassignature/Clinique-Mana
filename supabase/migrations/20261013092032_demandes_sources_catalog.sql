-- =============================================================================
-- Demandes: the booking page and the sources read Clients' published catalogue (D3c follow-up)
-- =============================================================================
-- D3c read `referral_sources` (Clients' table) in the booking page's list, in the booking's check
-- and in the reportable view `demandes_sources`. C4 published `referral_sources_catalog` (the
-- active sources, readable with clients.view or demandes.view): Demandes now reads it only
-- (CLAUDE.md §5). Same signatures, grants and results for every active source; a source retired
-- since a request was made shows in `demandes_sources` without its name (its id stays).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_sources_catalog', true);

create or replace function public.demandes_booking_page_for_service(p_org_id uuid)
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
                                    from public.referral_sources_catalog r where r.org_id = p_org_id), '[]'));
end;
$$;

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
  if v_source is not null and not exists (select 1 from public.referral_sources_catalog r where r.org_id = p_org_id and r.id = v_source) then
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

create or replace view public.demandes_sources with (security_invoker = true) as
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
  left join public.referral_sources_catalog r on r.org_id = d.org_id and r.id = d.referral_source_id;
