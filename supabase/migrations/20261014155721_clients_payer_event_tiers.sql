-- =============================================================================
-- Clients: an IVAC payer's event date (R-84) and a PAE agreement's tiers (R-85)
-- =============================================================================
-- Answers:   docs/research/2026-10-14-christine-answers-suite.md (19, 20, 21)
-- Decisions: R-84, R-85 (decisions log, « Christine's answers, second series »); FP-1, FP-2, FP-9
--
--   * `event_on` (R-84): the date of the event an IVAC file is about (« Date de l'évènement »), a
--     calendar date printed on IVAC's invoice. IVAC only; optional (a payer can be entered before
--     the letter arrives) but listed in « Payeurs à compléter » while missing. Never in the future.
--     Redacted in the audit log like the file number (the date of a criminal act), blanked by an
--     anonymisation.
--   * `coverage_tiers` (R-85): a PAE agreement covering its first sessions differently, e.g.
--     « 3 séances à 100 %, puis 50 % »: an ordered list of the tiers before the agreement's usual
--     coverage, each `{sessions, coverage_percent}` or `{sessions, session_amount_cents}`. The
--     usual coverage (`session_amount_cents` or `coverage_percent`, FP-1) is the open-ended last
--     tier, so an agreement without tiers (`[]`, the default) works exactly as before and
--     everything that checks « a PAE without its coverage » still holds. The tiers count the
--     sessions already covered in the agreement's year (the prior use included); the agreement's
--     maximum of sessions or dollars still caps them (FP-2, in Facturation's split). A tier pays
--     something (at least 0,01 $ or 1 %: a covered session is a share line, which is what counts),
--     and with tiers a use before the app is given in sessions too.
--   * `save_client_payer` takes both (`p_event_on`, `p_coverage_tiers`; dropped and made again:
--     two parameters with defaults); `list_client_payers_to_complete` lists an IVAC payer without
--     its event date (`missing: event_on`); `private.clients_anonymize_one` blanks the date.
--   * Published to Facturation (granted to no role, ADR 0003):
--     `private.client_payer_details_of(org, ids)` (the event date and the tiers) and the pure
--     `private.client_payer_session_coverage(tiers, amount, percent, covered_before)`: the coverage
--     of the next session once `covered_before` sessions of the year were covered.
-- Additive: two columns (an empty default), checks, functions replaced or added.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_payer_event_tiers', true);

alter table public.client_payers
  add column event_on date,
  add column coverage_tiers jsonb not null default '[]'::jsonb,
  add constraint client_payers_event_check check (event_on is null or kind = 'ivac'),
  add constraint client_payers_tiers_check check (
    case when pg_catalog.jsonb_typeof(coverage_tiers) = 'array'
         then pg_catalog.jsonb_array_length(coverage_tiers) <= 5 and (kind = 'pae' or coverage_tiers = '[]'::jsonb)
         else false end);

-- The event date is redacted like the file number (Loi 25).
drop trigger client_payers_audit on public.client_payers;
create trigger client_payers_audit after insert or update or delete on public.client_payers
  for each row execute function private.audit_trigger('file_number', 'note', 'event_on');

-- -----------------------------------------------------------------------------
-- The coverage of a session (R-85): the tier holding the next session, else the usual coverage
-- -----------------------------------------------------------------------------
create function private.client_payer_session_coverage(p_tiers jsonb, p_session_amount_cents int, p_coverage_percent int,
                                                       p_covered_before int, out session_amount_cents int, out coverage_percent int)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tier jsonb;
  v_upto int := 0;
begin
  for v_tier in select x.e from pg_catalog.jsonb_array_elements(
                  case when pg_catalog.jsonb_typeof(p_tiers) = 'array' then p_tiers else '[]'::jsonb end) with ordinality x(e, n)
                 order by x.n loop
    v_upto := v_upto + (v_tier ->> 'sessions')::int;
    if coalesce(p_covered_before, 0) < v_upto then
      session_amount_cents := (v_tier ->> 'session_amount_cents')::int;
      coverage_percent := (v_tier ->> 'coverage_percent')::int;
      return;
    end if;
  end loop;
  session_amount_cents := p_session_amount_cents;
  coverage_percent := p_coverage_percent;
end;
$$;

-- What Facturation needs besides `client_payer_facts`: the event date (IVAC's invoice) and the tiers.
create function private.client_payer_details_of(p_org uuid, p_ids uuid[])
returns table (client_payer_id uuid, event_on date, coverage_tiers jsonb)
language sql
stable
set search_path = ''
as $$
  select x.id, x.event_on, x.coverage_tiers
    from public.client_payers x
   where x.org_id = p_org and x.id = any (coalesce(p_ids, '{}'))
$$;

revoke all on function private.client_payer_session_coverage(jsonb, int, int, int), private.client_payer_details_of(uuid, uuid[])
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- save_client_payer: the event date and the tiers
-- -----------------------------------------------------------------------------
-- Latest body: 20261013205523_billing_payer_guards.sql.
drop function public.save_client_payer(uuid, uuid, text, text, text, int, int, int, date, date, text, int, int, int, int, int, date);

create function public.save_client_payer(p_client_id uuid, p_id uuid, p_kind text, p_organisation_name text, p_file_number text,
                                         p_session_amount_cents int, p_max_sessions int, p_max_amount_cents int,
                                         p_starts_on date, p_expires_on date, p_note text,
                                         p_coverage_percent int default null, p_renewal_month int default null,
                                         p_renewal_day int default null, p_prior_used_cents int default null,
                                         p_prior_used_sessions int default null, p_prior_used_on date default null,
                                         p_event_on date default null, p_coverage_tiers jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_org_name text := private.clients_text(p_organisation_name);
  v_file text := private.clients_text(p_file_number);
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_id uuid := p_id;
  v_tiers jsonb := '[]'::jsonb;
  v_tier jsonb;
  v_sessions int := 0;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_client_id);
  if p_kind is null or p_kind not in ('ivac', 'pae') then
    raise exception 'Le payeur est l''IVAC ou un PAE.' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_kind = 'pae' and v_org_name is null then
    raise exception 'Indiquez le fournisseur du PAE.' using errcode = 'P0001', hint = 'organisation_name';
  end if;
  if v_org_name is not null and (pg_catalog.length(v_org_name) > 120 or not private.is_tidy_text(v_org_name)) then
    raise exception 'Le nom de l''organisme compte 120 caractères au plus.' using errcode = 'P0001', hint = 'organisation_name';
  end if;
  if p_kind = 'ivac' and v_file is null then
    raise exception 'Indiquez le numéro de dossier IVAC.' using errcode = 'P0001', hint = 'file_number';
  end if;
  if v_file is not null and (pg_catalog.length(v_file) > 60 or not private.is_tidy_text(v_file)) then
    raise exception 'Le numéro de dossier compte 60 caractères au plus.' using errcode = 'P0001', hint = 'file_number';
  end if;
  if p_kind = 'ivac' and exists (
       select 1 from public.client_payers x
        where x.org_id = v_org and x.kind = 'ivac' and x.is_active and pg_catalog.lower(x.file_number) = pg_catalog.lower(v_file)
          and x.client_id <> p_client_id) then
    raise exception 'Ce numéro de dossier IVAC est déjà au dossier d''un autre client.' using errcode = 'P0001', hint = 'file_number';
  end if;
  -- P11 (FP-13): a provider's file number once among the active PAE payers.
  if p_kind = 'pae' and v_file is not null and exists (
       select 1 from public.client_payers x
        where x.org_id = v_org and x.kind = 'pae' and x.is_active and pg_catalog.lower(x.organisation_name) = pg_catalog.lower(v_org_name)
          and pg_catalog.lower(x.file_number) = pg_catalog.lower(v_file) and x.client_id <> p_client_id) then
    raise exception 'Ce numéro de dossier du PAE est déjà au dossier d''un autre client.' using errcode = 'P0001', hint = 'file_number';
  end if;
  -- R-84: the date of the event an IVAC file is about, never in the future.
  if p_event_on is not null and p_kind <> 'ivac' then
    raise exception 'La date de l''évènement se note pour un dossier IVAC seulement.' using errcode = 'P0001', hint = 'event_on';
  end if;
  if p_event_on is not null and (p_event_on < date '1900-01-01' or p_event_on > private.clinic_today()) then
    raise exception 'La date de l''évènement est une date passée.' using errcode = 'P0001', hint = 'event_on';
  end if;
  if p_session_amount_cents is not null and p_session_amount_cents not between 0 and 1000000 then
    raise exception 'Le montant par séance est compris entre 0 $ et 10 000 $.' using errcode = 'P0001', hint = 'session_amount_cents';
  end if;
  if p_coverage_percent is not null and p_coverage_percent not between 1 and 100 then
    raise exception 'La part couverte va de 1 %% à 100 %%.' using errcode = 'P0001', hint = 'coverage_percent';
  end if;
  if p_coverage_percent is not null and p_session_amount_cents is not null then
    raise exception 'Le PAE couvre un montant par séance ou une part de la séance, pas les deux.' using errcode = 'P0001', hint = 'coverage_percent';
  end if;
  if p_max_sessions is not null and p_max_sessions not between 1 and 999 then
    raise exception 'Le nombre maximal de séances est compris entre 1 et 999.' using errcode = 'P0001', hint = 'max_sessions';
  end if;
  if p_max_amount_cents is not null and p_max_amount_cents not between 1 and 100000000 then
    raise exception 'Le montant maximal est compris entre 0,01 $ et 1 000 000 $.' using errcode = 'P0001', hint = 'max_amount_cents';
  end if;
  -- R-85: the tiers before the usual coverage, each a number of sessions and an amount or a share.
  if p_coverage_tiers is not null and p_coverage_tiers <> '[]'::jsonb then
    if pg_catalog.jsonb_typeof(p_coverage_tiers) <> 'array' then
      raise exception 'Les paliers d''une entente sont une liste.' using errcode = 'P0001', hint = 'coverage_tiers';
    end if;
    if p_kind <> 'pae' then
      raise exception 'Les paliers sont ceux d''une entente PAE.' using errcode = 'P0001', hint = 'coverage_tiers';
    end if;
    if pg_catalog.jsonb_array_length(p_coverage_tiers) > 5 then
      raise exception 'Une entente a 5 paliers au maximum avant sa couverture habituelle.' using errcode = 'P0001', hint = 'coverage_tiers';
    end if;
    if p_session_amount_cents is null and p_coverage_percent is null then
      raise exception 'Indiquez ce que le PAE couvre après les paliers.' using errcode = 'P0001', hint = 'coverage';
    end if;
    for v_tier in select x.e from pg_catalog.jsonb_array_elements(p_coverage_tiers) with ordinality x(e, n) order by x.n loop
      if pg_catalog.jsonb_typeof(v_tier) <> 'object'
         or pg_catalog.jsonb_typeof(v_tier -> 'sessions') is distinct from 'number'
         or (v_tier ->> 'sessions') !~ '^[0-9]{1,3}$' or (v_tier ->> 'sessions')::int < 1 then
        raise exception 'Chaque palier compte de 1 à 999 séances.' using errcode = 'P0001', hint = 'coverage_tiers';
      end if;
      if ((v_tier -> 'coverage_percent') is null or v_tier -> 'coverage_percent' = 'null'::jsonb)
         = ((v_tier -> 'session_amount_cents') is null or v_tier -> 'session_amount_cents' = 'null'::jsonb)
         or (v_tier -> 'coverage_percent' <> 'null'::jsonb
             and (pg_catalog.jsonb_typeof(v_tier -> 'coverage_percent') <> 'number' or (v_tier ->> 'coverage_percent') !~ '^[0-9]{1,3}$'
                  or (v_tier ->> 'coverage_percent')::int not between 1 and 100))
         or (v_tier -> 'session_amount_cents' <> 'null'::jsonb
             and (pg_catalog.jsonb_typeof(v_tier -> 'session_amount_cents') <> 'number' or (v_tier ->> 'session_amount_cents') !~ '^[0-9]{1,7}$'
                  or (v_tier ->> 'session_amount_cents')::int not between 1 and 1000000)) then
        -- A tier pays something (at least 0,01 $ or 1 %): a session it covers is a share line, so
        -- it counts towards the tier's sessions (a 0 $ tier would never end).
        raise exception 'Un palier couvre un montant par séance (au moins 0,01 $) ou une part de la séance (1 %% à 100 %%), pas les deux.'
          using errcode = 'P0001', hint = 'coverage_tiers';
      end if;
      v_sessions := v_sessions + (v_tier ->> 'sessions')::int;
      v_tiers := v_tiers || pg_catalog.jsonb_build_array(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                   'sessions', (v_tier ->> 'sessions')::int,
                   'coverage_percent', (v_tier ->> 'coverage_percent')::int,
                   'session_amount_cents', (v_tier ->> 'session_amount_cents')::int)));
    end loop;
    if p_max_sessions is not null and v_sessions > p_max_sessions then
      raise exception 'Les paliers comptent plus de séances que le maximum de l''entente.' using errcode = 'P0001', hint = 'coverage_tiers';
    end if;
  end if;
  if p_starts_on is not null and p_expires_on is not null and p_expires_on < p_starts_on then
    raise exception 'L''échéance doit suivre le début.' using errcode = 'P0001', hint = 'expires_on';
  end if;
  if (p_renewal_month is null) <> (p_renewal_day is null)
     or (p_renewal_month is not null and (p_renewal_month not between 1 and 12 or p_renewal_day not between 1 and
         case when p_renewal_month = 2 then 28 when p_renewal_month in (4, 6, 9, 11) then 30 else 31 end)) then
    raise exception 'La date de renouvellement est un jour de l''année (par exemple le 31 mars).' using errcode = 'P0001', hint = 'renewal';
  end if;
  -- R-85: the tiers count sessions, so a use before the app is given in sessions too (in dollars
  -- only, the tiers would start over as if nothing had been used).
  if pg_catalog.jsonb_array_length(v_tiers) > 0 and p_prior_used_on is not null and p_prior_used_sessions is null then
    raise exception 'Avec des paliers, indiquez aussi le nombre de séances déjà utilisées avant l''application.' using errcode = 'P0001', hint = 'prior_used';
  end if;
  if (p_prior_used_on is null) <> (p_prior_used_cents is null and p_prior_used_sessions is null)
     or (p_prior_used_cents is not null and p_prior_used_cents not between 0 and 100000000)
     or (p_prior_used_sessions is not null and p_prior_used_sessions not between 0 and 999) then
    raise exception 'Le déjà utilisé avant l''application est un montant ou un nombre de séances, à une date.' using errcode = 'P0001', hint = 'prior_used';
  end if;
  if v_note is not null and pg_catalog.length(v_note) > 1000 then
    raise exception 'La note compte 1 000 caractères au plus.' using errcode = 'P0001', hint = 'note';
  end if;

  if v_id is null then
    -- P10 (FP-12): a new payer never replaces the active one of its kind.
    if exists (select 1 from public.client_payers x where x.client_id = p_client_id and x.kind = p_kind and x.is_active) then
      raise exception 'Ce client a déjà un payeur % actif : modifiez-le, ou terminez-le avant d''en ajouter un autre.',
        case p_kind when 'ivac' then 'IVAC' else 'PAE' end using errcode = 'P0001', hint = 'kind';
    end if;
  elsif not exists (select 1 from public.client_payers x where x.client_id = p_client_id and x.id = v_id and x.is_active) then
    raise exception 'Payeur introuvable.' using errcode = 'P0001', hint = 'id';
  elsif exists (select 1 from public.client_payers x where x.id = v_id and x.kind <> p_kind) then
    raise exception 'Le type d''un payeur ne change pas : terminez-le et ajoutez-en un autre.' using errcode = 'P0001', hint = 'kind';
  end if;
  if v_id is null then
    insert into public.client_payers (client_id, org_id, kind, organisation_name, file_number, session_amount_cents, max_sessions,
                                      max_amount_cents, starts_on, expires_on, note, coverage_percent, renewal_month, renewal_day,
                                      prior_used_cents, prior_used_sessions, prior_used_on, event_on, coverage_tiers, created_by)
    values (p_client_id, v_org, p_kind, v_org_name, v_file, p_session_amount_cents, p_max_sessions, p_max_amount_cents,
            p_starts_on, p_expires_on, v_note, p_coverage_percent, p_renewal_month, p_renewal_day,
            p_prior_used_cents, p_prior_used_sessions::smallint, p_prior_used_on, p_event_on, v_tiers, auth.uid())
    returning id into v_id;
  else
    update public.client_payers x
       set kind = p_kind, organisation_name = v_org_name, file_number = v_file, session_amount_cents = p_session_amount_cents,
           max_sessions = p_max_sessions, max_amount_cents = p_max_amount_cents, starts_on = p_starts_on,
           expires_on = p_expires_on, note = v_note, coverage_percent = p_coverage_percent,
           renewal_month = p_renewal_month, renewal_day = p_renewal_day, prior_used_cents = p_prior_used_cents,
           prior_used_sessions = p_prior_used_sessions, prior_used_on = p_prior_used_on, event_on = p_event_on,
           coverage_tiers = v_tiers, is_stub = false
     where x.id = v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_client_payer(uuid, uuid, text, text, text, int, int, int, date, date, text, int, int, int, int, int, date, date, jsonb)
  from public, anon;
grant execute on function public.save_client_payer(uuid, uuid, text, text, text, int, int, int, date, date, text, int, int, int, int, int, date, date, jsonb)
  to authenticated;

-- -----------------------------------------------------------------------------
-- « Payeurs à compléter » (FP-9): an IVAC payer without its event date too (R-84)
-- -----------------------------------------------------------------------------
-- Latest body: 20261013205523_billing_payer_guards.sql. The date is listed, never required: the
-- morning queue does not hold a session for it (`billing_payer_incomplete` is unchanged).
create or replace function public.list_client_payers_to_complete()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('clients.view') then
    raise exception 'Permission refusée : clients.view' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'client_payer_id', x.id, 'client_id', c.id, 'client_name', c.first_name || ' ' || c.last_name,
             'client_number', c.client_number, 'kind', x.kind, 'is_stub', x.is_stub,
             'missing', pg_catalog.array_remove(array[
               case when x.file_number is null then 'file_number' end,
               case when x.kind = 'pae' and x.organisation_name is null then 'organisation_name' end,
               case when x.kind = 'pae' and x.session_amount_cents is null and x.coverage_percent is null then 'coverage' end,
               case when x.kind = 'ivac' and x.event_on is null then 'event_on' end], null))
             order by c.last_name, c.first_name)
      from public.client_payers x
      join public.clients c on c.org_id = x.org_id and c.id = x.client_id
     where x.org_id = v_org and x.is_active and c.archived_at is null and c.merged_into_id is null and c.anonymized_at is null
       and (x.is_stub
            or x.file_number is null
            or (x.kind = 'ivac' and x.event_on is null)
            or (x.kind = 'pae' and (x.organisation_name is null or (x.session_amount_cents is null and x.coverage_percent is null))))),
    '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- An anonymisation blanks the event date (latest body: 20261013132214_clients_referrer.sql)
-- -----------------------------------------------------------------------------
create or replace function private.clients_anonymize_one(p_org uuid, p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  delete from public.client_relations x where x.org_id = p_org and (x.client_a_id = p_id or x.client_b_id = p_id);
  delete from public.client_tag_links l where l.client_id = p_id;
  delete from public.client_insurances i where i.client_id = p_id;
  update public.client_payers x
     set file_number = case when x.kind = 'ivac' then 'anonymisé' end, note = null, event_on = null, is_active = false
   where x.client_id = p_id;
  delete from public.client_notes n where n.client_id = p_id;
  update public.clients c
     set first_name = 'Client', last_name = 'anonymisé n° ' || c.client_number,
         birth_first_name = null, pronouns = null, sex = null, birthday = null, email = null,
         mobile_e164 = null, home_e164 = null, work_e164 = null, work_ext = null, time_zone = null,
         address_line1 = null, address_line2 = null, city = null, province = null, postal_code = null,
         referral_source_id = null, referred_by = null, referred_by_client_id = null, custom_field = null, rate_variant = null,
         tax_exempt = false, is_banned = false, file_incomplete = false, special_agreement = false,
         shared_custody = false, external_ref = null,
         archived_at = coalesce(c.archived_at, now()), archived_by = coalesce(c.archived_by, auth.uid()),
         anonymized_at = now(), anonymized_by = auth.uid()
   where c.id = p_id and c.anonymized_at is null;
  for r in select h.function_name from public.client_anonymize_handlers h order by h.module_key loop
    execute pg_catalog.format('select %s($1)', r.function_name) using p_id;
  end loop;
end;
$$;

revoke all on function private.clients_anonymize_one(uuid, uuid) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
