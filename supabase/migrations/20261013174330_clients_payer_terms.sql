-- =============================================================================
-- Clients: a payer's terms for Facturation's third-party payers (batch FP, part 1)
-- =============================================================================
-- Christine (answer 12, R-62): IVAC pays a fixed amount per session (the clinic's rate, kept by
-- Facturation); a PAE agreement covers an amount per session, or a percentage of it, often up to a
-- maximum renewed every year (most often on March 31). `client_payers` keeps the client's side of
-- it (decision FP-1); Facturation keeps the payer organisations, the split and the invoices.
--   * `coverage_percent` (1–100): a PAE covering a share of each session (null: the amount per
--     session, `session_amount_cents`);
--   * `renewal_month` / `renewal_day`: the date the maximum starts over each year (null: never; the
--     agreement's own dates bound it);
--   * `prior_used_cents` / `prior_used_sessions` as of `prior_used_on`: what the agreement already
--     used before the app (GOrendezvous's sessions), counted in the year holding that day (FP-2);
--   * `is_stub`: a payer the GOrendezvous import knew only by its tag (« IVAC », « PAE externe »):
--     its file number or its provider is still to complete; Facturation never splits a session on
--     a stub, and « Payeurs à compléter » lists them (FP-9).
-- `save_client_payer` takes the three new terms (a save completes a stub); the published
-- `private.client_payer_terms(org, client, on)` gives Facturation the payer covering a day, and
-- `list_client_payers_to_complete()` the adjointe's list, `import_client_payers` the import's stubs.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_payer_terms', true);

alter table public.client_payers
  add column coverage_percent smallint,
  add column renewal_month smallint,
  add column renewal_day smallint,
  add column is_stub boolean not null default false,
  add column prior_used_cents int,
  add column prior_used_sessions smallint,
  add column prior_used_on date,
  add constraint client_payers_prior_check check (
    (prior_used_on is null) = (prior_used_cents is null and prior_used_sessions is null)
    and (prior_used_cents is null or prior_used_cents between 0 and 100000000)
    and (prior_used_sessions is null or prior_used_sessions between 0 and 999)),
  add constraint client_payers_coverage_percent_check check (coverage_percent between 1 and 100),
  add constraint client_payers_renewal_check check (
    (renewal_month is null) = (renewal_day is null)
    and (renewal_month is null or (renewal_month between 1 and 12 and renewal_day between 1 and
         case when renewal_month = 2 then 28 when renewal_month in (4, 6, 9, 11) then 30 else 31 end)));

-- A stub may lack what a real payer needs (its file number, its provider).
alter table public.client_payers
  drop constraint client_payers_ivac_file_check,
  add constraint client_payers_ivac_file_check check (kind <> 'ivac' or file_number is not null or is_stub),
  drop constraint client_payers_pae_organisation_check,
  add constraint client_payers_pae_organisation_check check (kind <> 'pae' or organisation_name is not null or is_stub);

-- -----------------------------------------------------------------------------
-- save_client_payer: the three terms (a save completes a stub)
-- -----------------------------------------------------------------------------
drop function public.save_client_payer(uuid, uuid, text, text, text, int, int, int, date, date, text);

create function public.save_client_payer(p_client_id uuid, p_id uuid, p_kind text, p_organisation_name text, p_file_number text,
                                         p_session_amount_cents int, p_max_sessions int, p_max_amount_cents int,
                                         p_starts_on date, p_expires_on date, p_note text,
                                         p_coverage_percent int default null, p_renewal_month int default null,
                                         p_renewal_day int default null, p_prior_used_cents int default null,
                                         p_prior_used_sessions int default null, p_prior_used_on date default null)
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
  if p_starts_on is not null and p_expires_on is not null and p_expires_on < p_starts_on then
    raise exception 'L''échéance doit suivre le début.' using errcode = 'P0001', hint = 'expires_on';
  end if;
  if (p_renewal_month is null) <> (p_renewal_day is null)
     or (p_renewal_month is not null and (p_renewal_month not between 1 and 12 or p_renewal_day not between 1 and
         case when p_renewal_month = 2 then 28 when p_renewal_month in (4, 6, 9, 11) then 30 else 31 end)) then
    raise exception 'La date de renouvellement est un jour de l''année (par exemple le 31 mars).' using errcode = 'P0001', hint = 'renewal';
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
    select x.id into v_id from public.client_payers x where x.client_id = p_client_id and x.kind = p_kind and x.is_active;
  elsif not exists (select 1 from public.client_payers x where x.client_id = p_client_id and x.id = v_id and x.is_active) then
    raise exception 'Payeur introuvable.' using errcode = 'P0001', hint = 'id';
  elsif exists (select 1 from public.client_payers x where x.id = v_id and x.kind <> p_kind) then
    raise exception 'Le type d''un payeur ne change pas : terminez-le et ajoutez-en un autre.' using errcode = 'P0001', hint = 'kind';
  end if;
  if v_id is null then
    insert into public.client_payers (client_id, org_id, kind, organisation_name, file_number, session_amount_cents, max_sessions,
                                      max_amount_cents, starts_on, expires_on, note, coverage_percent, renewal_month, renewal_day,
                                      prior_used_cents, prior_used_sessions, prior_used_on, created_by)
    values (p_client_id, v_org, p_kind, v_org_name, v_file, p_session_amount_cents, p_max_sessions, p_max_amount_cents,
            p_starts_on, p_expires_on, v_note, p_coverage_percent, p_renewal_month, p_renewal_day,
            p_prior_used_cents, p_prior_used_sessions::smallint, p_prior_used_on, auth.uid())
    returning id into v_id;
  else
    update public.client_payers x
       set kind = p_kind, organisation_name = v_org_name, file_number = v_file, session_amount_cents = p_session_amount_cents,
           max_sessions = p_max_sessions, max_amount_cents = p_max_amount_cents, starts_on = p_starts_on,
           expires_on = p_expires_on, note = v_note, coverage_percent = p_coverage_percent,
           renewal_month = p_renewal_month, renewal_day = p_renewal_day, prior_used_cents = p_prior_used_cents,
           prior_used_sessions = p_prior_used_sessions, prior_used_on = p_prior_used_on, is_stub = false
     where x.id = v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_client_payer(uuid, uuid, text, text, text, int, int, int, date, date, text, int, int, int, int, int, date) from public, anon;
grant execute on function public.save_client_payer(uuid, uuid, text, text, text, int, int, int, date, date, text, int, int, int, int, int, date) to authenticated;

-- -----------------------------------------------------------------------------
-- For Facturation: the payer covering a client's session day (FP-2)
-- -----------------------------------------------------------------------------
-- The client's active payers in force that day (IVAC first: one of each kind at most), stubs
-- included (`is_stub`: Facturation holds the session for completion, never splits it). For definer
-- callers after their own permission check, with the org they verified; granted to no role.
create function private.client_payer_terms(p_org uuid, p_client_id uuid, p_on date)
returns table (
  client_payer_id uuid, kind text, organisation_name text, file_number text, session_amount_cents int, coverage_percent int,
  max_sessions int, max_amount_cents int, starts_on date, expires_on date, renewal_month int, renewal_day int, is_stub boolean,
  prior_used_cents int, prior_used_sessions int, prior_used_on date
)
language sql
stable
set search_path = ''
as $$
  select x.id, x.kind, x.organisation_name, x.file_number, x.session_amount_cents, x.coverage_percent::int,
         x.max_sessions::int, x.max_amount_cents, x.starts_on, x.expires_on, x.renewal_month::int, x.renewal_day::int, x.is_stub,
         x.prior_used_cents, x.prior_used_sessions::int, x.prior_used_on
    from public.client_payers x
   where x.org_id = p_org and x.client_id = p_client_id and x.is_active
     and (x.starts_on is null or x.starts_on <= p_on)
     and (x.expires_on is null or x.expires_on >= p_on)
   order by (x.kind = 'ivac') desc
$$;

-- One payer's facts, whatever its state (Facturation's consumption, the payer invoice's file number).
create function private.client_payer_facts(p_org uuid, p_ids uuid[])
returns table (
  client_payer_id uuid, client_id uuid, kind text, organisation_name text, file_number text, session_amount_cents int,
  coverage_percent int, max_sessions int, max_amount_cents int, starts_on date, expires_on date, renewal_month int,
  renewal_day int, is_active boolean, is_stub boolean, prior_used_cents int, prior_used_sessions int, prior_used_on date
)
language sql
stable
set search_path = ''
as $$
  select x.id, x.client_id, x.kind, x.organisation_name, x.file_number, x.session_amount_cents, x.coverage_percent::int,
         x.max_sessions::int, x.max_amount_cents, x.starts_on, x.expires_on, x.renewal_month::int, x.renewal_day::int,
         x.is_active, x.is_stub, x.prior_used_cents, x.prior_used_sessions::int, x.prior_used_on
    from public.client_payers x
   where x.org_id = p_org and x.id = any (coalesce(p_ids, '{}'))
$$;

-- A client's active payers, whatever their dates (Facturation's « Expiré », « Budget bas »).
create function private.client_payers_of(p_org uuid, p_client_id uuid)
returns table (
  client_payer_id uuid, client_id uuid, kind text, organisation_name text, file_number text, session_amount_cents int,
  coverage_percent int, max_sessions int, max_amount_cents int, starts_on date, expires_on date, renewal_month int,
  renewal_day int, is_active boolean, is_stub boolean, prior_used_cents int, prior_used_sessions int, prior_used_on date
)
language sql
stable
set search_path = ''
as $$
  select f.* from private.client_payer_facts(p_org, array(
    select x.id from public.client_payers x where x.org_id = p_org and x.client_id = p_client_id and x.is_active)) f
   order by (f.kind = 'ivac') desc
$$;

revoke all on function private.client_payer_terms(uuid, uuid, date), private.client_payer_facts(uuid, uuid[]),
  private.client_payers_of(uuid, uuid)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- « Payeurs à compléter » (FP-9): the active payers still missing what a split needs
-- -----------------------------------------------------------------------------
create function public.list_client_payers_to_complete()
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
               case when x.kind = 'ivac' and x.file_number is null then 'file_number' end,
               case when x.kind = 'pae' and x.organisation_name is null then 'organisation_name' end,
               case when x.kind = 'pae' and x.session_amount_cents is null and x.coverage_percent is null then 'coverage' end], null))
             order by c.last_name, c.first_name)
      from public.client_payers x
      join public.clients c on c.org_id = x.org_id and c.id = x.client_id
     where x.org_id = v_org and x.is_active and c.archived_at is null and c.merged_into_id is null and c.anonymized_at is null
       and (x.is_stub
            or (x.kind = 'ivac' and x.file_number is null)
            or (x.kind = 'pae' and (x.organisation_name is null or (x.session_amount_cents is null and x.coverage_percent is null))))),
    '[]'::jsonb);
end;
$$;

revoke all on function public.list_client_payers_to_complete() from public, anon;
grant execute on function public.list_client_payers_to_complete() to authenticated;

-- -----------------------------------------------------------------------------
-- For the GOrendezvous import: a payer known only by its tag (FP-9)
-- -----------------------------------------------------------------------------
-- p_row: {client_ref (« gorendezvous:<ClientId> », the imported file), payers: ['ivac' | 'pae']}.
-- Once per client and kind: an active payer of that kind already there is left as it is. A PAE
-- stub renews on March 31 (Christine, answer 12). The import's own permissions (clients.manage and
-- clients.merge); a dry run writes nothing. Returns {status: ok | error, dry_run, created}.
create function public.import_client_payers(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_client uuid;
  v_kind text;
  v_created int := 0;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform private.clients_import_assert();
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object' or pg_catalog.jsonb_typeof(p_row -> 'payers') <> 'array' then
    raise exception 'Une ligne d''import est un objet JSON avec ses payeurs.' using errcode = '22023';
  end if;
  select c.id into v_client from public.clients c
   where c.org_id = v_org and c.external_ref = private.clients_text(p_row ->> 'client_ref') and c.anonymized_at is null;
  if v_client is null then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'created', 0,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'client_ref',
        'message', 'Ce client n''est pas encore importé.')));
  end if;
  perform pg_catalog.set_config('app.audit_source', 'import', true);
  for v_kind in select distinct x from pg_catalog.jsonb_array_elements_text(p_row -> 'payers') x loop
    if v_kind not in ('ivac', 'pae') then
      continue;
    end if;
    if not exists (select 1 from public.client_payers x
                    where x.org_id = v_org and x.client_id = v_client and x.kind = v_kind and x.is_active) then
      v_created := v_created + 1;
      if not v_dry then
        insert into public.client_payers (client_id, org_id, kind, is_stub, renewal_month, renewal_day, created_by)
        values (v_client, v_org, v_kind, true,
                case when v_kind = 'pae' then 3 end, case when v_kind = 'pae' then 31 end, auth.uid());
      end if;
    end if;
  end loop;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry, 'created', v_created);
end;
$$;

revoke all on function public.import_client_payers(jsonb, boolean) from public, anon;
grant execute on function public.import_client_payers(jsonb, boolean) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
