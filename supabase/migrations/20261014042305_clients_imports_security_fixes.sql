-- =============================================================================
-- Clients, the GOrendezvous imports, Rapports: security review fixes (2026-10-14)
-- =============================================================================
-- Asked:   coordinator, 2026-10-14 (pre-cutover security review, lane C).
-- Needs:   *_core_imports_switch.sql (private.imports_assert_open), the migrations named above
--          each function (its latest body, copied, with the one change below).
-- Doc:     docs/modules/clients.md « Security review (2026-10-14) ».
--
-- 1. Re-running the consents import never brings back a consent the app holds:
--    `import_client_consent_fact_for_service` skips (false) when the client has a consent of that
--    kind withdrawn, signed in the app (source <> 'import'), or imported with the same or a later
--    date.
-- 2. The name match never picks one of two homonyms because the other one's file was anonymised
--    since: `private.clients_import_match` counts every file kept at the end of the merges,
--    anonymised ones included (and the « anon: » tombstones), and answers `ambiguous` when there
--    are several (the tool also requires --clients-map for the names several ClientIds hold).
-- 3. Every `import_*` RPC is refused once the admin has closed the imports (P0001 « Les imports
--    sont fermés pour cette clinique. »; `set_imports_open`, runbook « After »).
--    `import_invoice` also refuses a payment in « Note de crédit » or in an inactive mode, a
--    payment or a refund dated in the future, and more than 200 lines, payments or refunds.
-- 4. The public consent page answers `invalid` while Clients is reserved for its testers (P3-40).
-- 6. `mark_client_consent_copy_sent_for_service` checks the actor again (active, clients.manage).
-- 7. `report_demandes` reads Demandes as the caller sees it (`module_enabled`: « Réservé aux
--    testeurs » respected).
-- 9. `find_client_duplicates` reads at most 10 phones; `search_clients` and `list_clients` cut the
--    query at 200 characters (the UI sends far less).
-- Additive: `create or replace`, same signatures, grants unchanged.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_imports_security_fixes', true);

-- -----------------------------------------------------------------------------
-- clients_import_match: a homonym whose file was anonymised still counts (finding 2)
-- -----------------------------------------------------------------------------
-- Latest body: 20261013173004_clients_import_match.sql. With `ref`: the file imported with it,
-- as before. With the name: the imported files of that name (and the tombstones, whose names
-- anonymisation blanked), each followed along its merges; the files kept at the end, anonymised
-- or not, are the candidates: none → not_found; several → ambiguous; one → ok when it is not
-- anonymised, else not_found.
create or replace function private.clients_import_match(p_org uuid, p_ref text, p_name text, out status text, out client_id uuid)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ref text := nullif(pg_catalog.btrim(coalesce(p_ref, '')), '');
  v_key text := private.clients_import_name_key(p_name, null);
  v_ends uuid[];
  v_live uuid[];
begin
  if v_ref is null and v_key is null then
    status := 'not_found';
    return;
  end if;
  with recursive found as (
    select c.id from public.clients c
     where v_ref is not null and c.org_id = p_org and c.external_ref = v_ref and c.anonymized_at is null
    union
    -- Two branches, so the first one keeps clients_org_import_name_idx.
    select c.id from public.clients c
     where v_ref is null and c.org_id = p_org and c.external_ref like 'gorendezvous:%'
       and private.clients_import_name_key(c.first_name, c.last_name) = v_key
    union
    select c.id from public.clients c
     where v_ref is null and c.org_id = p_org and c.external_ref like 'anon:%'
       and private.clients_import_name_key(c.first_name, c.last_name) = v_key
  ), chain (start_id, id, merged_into_id, anonymized_at, depth) as (
    select f.id, c.id, c.merged_into_id, c.anonymized_at, 0
      from found f join public.clients c on c.id = f.id
    union all
    select ch.start_id, c.id, c.merged_into_id, c.anonymized_at, ch.depth + 1
      from chain ch join public.clients c on c.org_id = p_org and c.id = ch.merged_into_id
     where ch.depth < 20
  )
  select pg_catalog.array_agg(distinct ch.id),
         pg_catalog.array_agg(distinct ch.id) filter (where ch.anonymized_at is null)
    into v_ends, v_live
    from chain ch
   where ch.merged_into_id is null;
  if coalesce(pg_catalog.cardinality(v_ends), 0) > 1 then
    status := 'ambiguous';
  elsif coalesce(pg_catalog.cardinality(v_live), 0) = 1 then
    status := 'ok';
    client_id := v_live[1];
  else
    status := 'not_found';
  end if;
end;
$$;
revoke all on function private.clients_import_match(uuid, text, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- import_client: refused once the imports are closed
-- -----------------------------------------------------------------------------
-- Latest body: 20261013043434_clients_import.sql.
create or replace function public.import_client(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_ref text;
  v_existing record;
  v public.clients;
  v_id uuid;
  v_number int;
  v_dups jsonb := '[]';
  v_tags jsonb;
  v_tag text;
  v_tag_id uuid;
  v_tag_ids uuid[] := '{}';
  v_created text[] := '{}';
  v_reactivated text[] := '{}';
  v_ins jsonb;
  v_bad text;
  v_errors jsonb := '[]';
  v_message text;
  v_hint text;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform private.clients_import_assert();
  perform private.imports_assert_open();  -- closed after the cutover (*_core_imports_switch.sql)
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object' then
    raise exception 'Une ligne d''import est un objet JSON.' using errcode = '22023';
  end if;
  v_ref := private.clients_text(p_row ->> 'external_ref');
  if v_ref is null or pg_catalog.length(v_ref) > 64 or not private.is_tidy_text(v_ref) then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'external_ref',
        'message', 'La référence GOrendezvous est requise (64 caractères au plus).')));
  end if;
  v_tags := coalesce(p_row -> 'tags', '[]');
  if pg_catalog.jsonb_typeof(v_tags) <> 'array'
     or exists (select 1 from pg_catalog.jsonb_array_elements(v_tags) t where pg_catalog.jsonb_typeof(t.value) <> 'string') then
    raise exception 'tags : une liste de noms est attendue.' using errcode = '22023';
  end if;
  v_ins := p_row -> 'insurance';
  if v_ins is not null and pg_catalog.jsonb_typeof(v_ins) not in ('object', 'null') then
    raise exception 'insurance : un objet est attendu.' using errcode = '22023';
  end if;
  -- A yes / no field that is not a boolean is a row error (never a cast that stops the whole run).
  select k into v_bad from pg_catalog.unnest(array['archived', 'tax_exempt', 'is_banned', 'file_incomplete', 'special_agreement',
                                                   'shared_custody', 'reminders_by_sms', 'reminders_by_email']) k
   where pg_catalog.jsonb_typeof(p_row -> k) not in ('boolean', 'null')
   limit 1;
  if v_bad is not null then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', v_bad, 'message', 'Oui ou non attendu.')));
  end if;

  -- Same lock as the file number's and create_client's, taken before the reference is looked up:
  -- two runs of the same file never both create it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('clients.client_number:' || v_org::text, 0));
  -- A resumed run: the file is already there.
  select c.id, c.client_number into v_existing from public.clients c where c.org_id = v_org and c.external_ref = v_ref;
  if v_existing.id is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', v_existing.id,
                                         'client_number', v_existing.client_number, 'reason', 'Déjà importé');
  end if;
  -- An imported file anonymised since (Loi 25) is never brought back by a later run: its reference
  -- left a tombstone (private.clients_import_tombstone).
  if exists (select 1 from public.clients c where c.org_id = v_org and c.external_ref = private.clients_import_tombstone_ref(v_ref)) then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', null, 'reason', 'Dossier anonymisé');
  end if;

  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    v := private.clients_from_json(v_org, p_row - 'tags' - 'insurance' - 'archived' - 'external_ref');
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('level', x.level, 'client_number', x.client_number)
                                         order by (x.level = 'high') desc, x.client_number), '[]')
      into v_dups
      from (select d.level, c.client_number
              from private.clients_find_duplicates(v_org, v.first_name, v.last_name, v.email,
                                                   array[v.mobile_e164, v.home_e164, v.work_e164], v.birthday, null) d
              join public.clients c on c.id = d.client_id
             order by (d.level = 'high') desc, c.client_number
             limit 5) x;

    insert into public.clients (org_id, first_name, last_name, birth_first_name, pronouns, sex, birthday, email,
                                mobile_e164, home_e164, work_e164, work_ext, language, time_zone,
                                reminders_by_sms, reminders_by_email, address_line1, address_line2, city, province,
                                postal_code, country, referral_source_id, referred_by, custom_field,
                                primary_professional_id, rate_variant, tax_exempt, is_banned, file_incomplete,
                                special_agreement, shared_custody, external_ref, archived_at, archived_by, created_by)
    values (v_org, v.first_name, v.last_name, v.birth_first_name, v.pronouns, v.sex, v.birthday, v.email,
            v.mobile_e164, v.home_e164, v.work_e164, v.work_ext, v.language, v.time_zone,
            v.reminders_by_sms, v.reminders_by_email, v.address_line1, v.address_line2, v.city, v.province,
            v.postal_code, v.country, v.referral_source_id, v.referred_by, v.custom_field,
            v.primary_professional_id, v.rate_variant, v.tax_exempt, v.is_banned, v.file_incomplete,
            v.special_agreement, v.shared_custody, v_ref,
            case when coalesce((p_row ->> 'archived')::boolean, false) then pg_catalog.now() end,
            case when coalesce((p_row ->> 'archived')::boolean, false) then auth.uid() end,
            auth.uid())
    returning id, client_number into v_id, v_number;

    perform private.clients_save_notes(v_org, v_id, null, p_row ->> 'special_agreement_note');
    perform private.clients_link_professional(v_org, v_id, v.primary_professional_id, 'import');

    -- The free tags: the clinic's tag of that name (accents and case as the list's unique key), or a new one.
    if pg_catalog.jsonb_array_length(v_tags) > 5 then
      raise exception 'Un client a au plus 5 étiquettes.' using errcode = 'P0001', hint = 'tags';
    end if;
    for v_tag in select private.clients_text(t.value) from pg_catalog.jsonb_array_elements_text(v_tags) t loop
      if v_tag is null or pg_catalog.length(v_tag) > 40 or not private.is_tidy_text(v_tag) then
        raise exception 'Une étiquette compte 1 à 40 caractères.' using errcode = 'P0001', hint = 'tags';
      end if;
      select t.id into v_tag_id from public.client_tags t
       where t.org_id = v_org and pg_catalog.lower(normalize(t.name, NFKC)) = pg_catalog.lower(normalize(v_tag, NFKC));
      if v_tag_id is null then
        insert into public.client_tags (org_id, name, sort_order)
        values (v_org, v_tag, coalesce((select max(t.sort_order) from public.client_tags t where t.org_id = v_org), 0) + 10)
        returning id into v_tag_id;
        v_created := v_created || v_tag;
      elsif not exists (select 1 from public.client_tags t where t.id = v_tag_id and t.is_active) then
        -- An archived tag of the clinic comes back: said in the report, never silently.
        update public.client_tags t set is_active = true where t.id = v_tag_id;
        v_reactivated := v_reactivated || v_tag;
      end if;
      v_tag_ids := v_tag_ids || v_tag_id;
      v_tag_id := null;
    end loop;
    if pg_catalog.cardinality(v_tag_ids) > 0 then
      perform public.set_client_tags(v_id, v_tag_ids);
    end if;

    if v_ins is not null and pg_catalog.jsonb_typeof(v_ins) = 'object' then
      perform public.upsert_client_insurance(v_id, 1, v_ins ->> 'insurer', v_ins ->> 'policy_number', v_ins ->> 'certificate_number',
                                             v_ins ->> 'holder_relation', v_ins ->> 'holder_name');
    end if;

    if v_dry then
      raise exception 'import_client: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- a dry run: everything above is rolled back; v_number and v_dups keep their values
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', nullif(v_hint, ''), 'message', v_message));
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null, 'errors', v_errors);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry, 'id', case when not v_dry then v_id end,
                                       'client_number', case when not v_dry then v_number end,
                                       'duplicates', v_dups, 'tags_created', pg_catalog.to_jsonb(v_created),
                                       'tags_reactivated', pg_catalog.to_jsonb(v_reactivated));
end;
$$;

-- -----------------------------------------------------------------------------
-- import_client_relation: refused once the imports are closed
-- -----------------------------------------------------------------------------
-- Latest body: 20261013043434_clients_import.sql.
create or replace function public.import_client_relation(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_client uuid;
  v_related uuid;
  v_errors jsonb := '[]';
  v_message text;
  v_hint text;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform private.clients_import_assert();
  perform private.imports_assert_open();  -- closed after the cutover (*_core_imports_switch.sql)
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object' then
    raise exception 'Une ligne d''import est un objet JSON.' using errcode = '22023';
  end if;
  -- A file merged since its import stands for the file it was merged into.
  select coalesce(c.merged_into_id, c.id) into v_client from public.clients c where c.org_id = v_org and c.external_ref = private.clients_text(p_row ->> 'client_ref');
  select coalesce(c.merged_into_id, c.id) into v_related from public.clients c where c.org_id = v_org and c.external_ref = private.clients_text(p_row ->> 'related_ref');
  if v_client is null or v_related is null then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', case when v_client is null then 'client_ref' else 'related_ref' end,
        'message', 'Ce client n''est pas encore importé : importez les clients d''abord.')));
  end if;
  if exists (select 1 from public.client_relations r
              where r.org_id = v_org and r.client_a_id = least(v_client, v_related) and r.client_b_id = greatest(v_client, v_related)) then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'reason', 'Déjà liés');
  end if;

  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    perform public.set_client_relation(v_client, v_related, p_row ->> 'type',
                                       coalesce(p_row -> 'related_rights', '{}'), coalesce(p_row -> 'client_rights', '{}'));
    if v_dry then
      raise exception 'import_client_relation: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', nullif(v_hint, ''), 'message', v_message));
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'errors', v_errors);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry);
end;
$$;

-- -----------------------------------------------------------------------------
-- import_client_payers: refused once the imports are closed
-- -----------------------------------------------------------------------------
-- Latest body: 20261013184129_clients_payer_terms.sql.
create or replace function public.import_client_payers(p_row jsonb, p_dry_run boolean default true)
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
  perform private.imports_assert_open();  -- closed after the cutover (*_core_imports_switch.sql)
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

-- -----------------------------------------------------------------------------
-- import_appointment: refused once the imports are closed
-- -----------------------------------------------------------------------------
-- Latest body: 20261014003837_appointments_import.sql.
create or replace function public.import_appointment(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_ref text;
  v_pro uuid;
  v_code int;
  v_service uuid;
  v_facts record;
  v_starts timestamptz;
  v_ends timestamptz;
  v_blocks timestamptz;
  v_state text;
  v_mode text;
  v_past boolean;
  v_reason uuid;
  v_reason_text text;
  v_cancelled timestamptz;
  v_url text;
  v_clients jsonb;
  v_client jsonb;
  v_match record;
  v_ids uuid[] := '{}';
  v_absent boolean[] := '{}';
  v_cid uuid;
  v_id uuid;
  v_notes jsonb := '[]';
  v_errors jsonb := '[]';
  v_status text := 'ok';
  v_message text;
  v_hint text;
  v_i int := 0;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if not private.has_permission('appointments.manage') then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  perform private.clients_import_assert();  -- clients.manage and clients.merge: whoever imports, as I1
  perform private.imports_assert_open();  -- closed after the cutover (*_core_imports_switch.sql)
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object'
     or pg_catalog.jsonb_typeof(coalesce(p_row -> 'clients', '[]')) <> 'array' then
    raise exception 'Une ligne d''import est un objet JSON (clients : une liste).' using errcode = '22023';
  end if;
  v_ref := pg_catalog.btrim(coalesce(p_row ->> 'external_ref', ''));
  if v_ref !~ '^gorendezvous:[A-Za-z0-9:_-]{1,60}$' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'external_ref',
        'message', 'La référence GOrendezvous du rendez-vous est requise.')));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('appointments.import:' || v_org::text || ':' || v_ref, 0));
  select a.id into v_id from public.appointments a where a.org_id = v_org and a.external_ref = v_ref;
  if v_id is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', v_id, 'reason', 'Déjà importé');
  end if;

  -- The clients first: one not found or with homonyms is listed, never an error.
  v_clients := coalesce(p_row -> 'clients', '[]');
  if pg_catalog.jsonb_array_length(v_clients) not between 1 and 2 then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'clients',
        'message', 'Un rendez-vous compte un ou deux clients.')));
  end if;
  for v_client in select x.value from pg_catalog.jsonb_array_elements(v_clients) x loop
    v_i := v_i + 1;
    select m.* into v_match from private.clients_import_match(v_org, v_client ->> 'client_ref', v_client ->> 'client_name') m;
    if v_match.status <> 'ok' then
      return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null, 'client', v_i,
                                           'reason', case v_match.status when 'ambiguous' then 'client_ambiguous' else 'client_not_found' end);
    end if;
    if v_match.client_id = any (v_ids) then
      return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
        'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'clients',
          'message', 'Le même client est nommé deux fois.')));
    end if;
    v_ids := v_ids || v_match.client_id;
    -- Absent: per client (`clients[].absent`), else the row's (`absent`); « true » only.
    v_absent := v_absent || (pg_catalog.lower(coalesce(v_client ->> 'absent', p_row ->> 'absent', '')) in ('true', 't', '1'));
  end loop;

  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    begin
      v_pro := nullif(p_row ->> 'professional_id', '')::uuid;
      v_code := nullif(p_row ->> 'service_code', '')::int;
      v_starts := (p_row ->> 'starts_at')::timestamptz;
      v_ends := nullif(p_row ->> 'ends_at', '')::timestamptz;
      v_cancelled := nullif(p_row ->> 'cancelled_at', '')::timestamptz;
    exception when others then
      raise exception 'Un professionnel, un code, une date ou une heure est illisible.' using errcode = 'P0001', hint = 'starts_at';
    end;
    if v_pro is null or not exists (select 1 from private.professional_booking_facts(v_org, v_pro) f where f.status is not null) then
      raise exception 'Le professionnel du rendez-vous est introuvable.' using errcode = 'P0001', hint = 'professional_id';
    end if;
    v_service := private.service_id_by_code(v_org, v_code);
    if v_service is null then
      raise exception 'Le code de service est inconnu du catalogue.' using errcode = 'P0001', hint = 'service_code';
    end if;
    select f.* into v_facts from private.service_booking_facts(v_org, v_service) f;
    if v_starts is null then
      raise exception 'La date et l''heure du rendez-vous sont requises.' using errcode = 'P0001', hint = 'starts_at';
    end if;
    v_ends := coalesce(v_ends, v_starts + pg_catalog.make_interval(mins => greatest(coalesce(v_facts.duration_minutes, 0), 5)));
    if v_ends <= v_starts or v_ends - v_starts > interval '12 hours' then
      raise exception 'La fin du rendez-vous vient après son début, le même jour.' using errcode = 'P0001', hint = 'ends_at';
    end if;
    v_past := v_starts <= pg_catalog.now();
    v_state := coalesce(nullif(p_row ->> 'state', ''), case when v_past then 'completed' else 'booked' end);
    if (v_past and v_state not in ('completed', 'cancelled')) or (not v_past and v_state not in ('booked', 'confirmed', 'cancelled')) then
      raise exception 'L''état ne convient pas : un rendez-vous passé est terminé ou annulé, un rendez-vous à venir réservé, confirmé ou annulé.'
        using errcode = 'P0001', hint = 'state';
    end if;
    v_mode := coalesce(nullif(p_row ->> 'mode', ''), 'video');
    if v_mode not in ('video', 'phone') then
      raise exception 'Le mode est vidéo ou téléphone.' using errcode = 'P0001', hint = 'mode';
    end if;
    v_blocks := case when v_past then v_ends else v_ends + pg_catalog.make_interval(mins => coalesce(v_facts.buffer_after_minutes, 0)) end;
    if v_blocks - v_starts > interval '12 hours' then
      v_blocks := v_ends;
    end if;
    if v_state = 'cancelled' then
      v_reason_text := nullif(pg_catalog.btrim(coalesce(p_row ->> 'cancel_reason', '')), '');
      select r.id into v_reason from public.cancellation_reasons r
       where r.org_id = v_org and v_reason_text is not null
         and (r.key = v_reason_text or private.clients_fold(r.name) = private.clients_fold(v_reason_text))
       order by r.key = v_reason_text desc limit 1;
      if v_reason is null then
        select r.id into v_reason from public.cancellation_reasons r where r.org_id = v_org and r.key = 'not_specified';
        if v_reason_text is not null then
          v_notes := v_notes || pg_catalog.jsonb_build_array('reason_unknown');
        end if;
      end if;
      v_cancelled := coalesce(v_cancelled, least(v_starts, pg_catalog.now()));
    end if;
    v_url := nullif(pg_catalog.btrim(coalesce(p_row ->> 'video_url', '')), '');
    if v_url is not null and (v_past or v_mode <> 'video' or v_state = 'cancelled') then
      v_url := null;
    end if;
    if v_url is not null and (v_url !~ '^https://\S+$' or char_length(v_url) > 500) then
      v_url := null;
      v_notes := v_notes || pg_catalog.jsonb_build_array('video_url_invalid');
    end if;

    begin
      insert into public.appointments (org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode, state,
                                       confirmed_at, completed_at, cancelled_at, cancel_reason_id, cancel_late,
                                       video_url, video_status, external_ref, created_by)
      values (v_org, v_pro, v_service, v_starts, v_ends, v_blocks, v_mode, v_state,
              case when v_state = 'confirmed' then pg_catalog.now() end,
              case when v_state = 'completed' then v_ends end,
              case when v_state = 'cancelled' then v_cancelled end,
              v_reason, null,
              v_url, case when v_url is not null then 'ready' end, v_ref, auth.uid())
      returning id into v_id;
    exception when exclusion_violation then
      v_status := 'conflict';
    end;
    if v_status = 'ok' then
      v_i := 0;
      foreach v_cid in array v_ids loop
        v_i := v_i + 1;
        insert into public.appointment_participants (appointment_id, client_id, org_id, role, presence)
        values (v_id, v_cid, v_org, case when v_i = 1 then 'client' else 'second' end,
                case when v_state = 'completed' then case when v_absent[v_i] then 'absent' else 'present' end else 'expected' end);
        perform private.clients_link_professional(v_org, v_cid, v_pro, 'import');
      end loop;
    end if;

    if v_dry then
      raise exception 'import_appointment: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- a dry run: everything above is rolled back
    when check_violation then
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', null,
        'message', 'Une valeur de la ligne ne respecte pas les règles de son champ (longueur, caractères).'));
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', nullif(v_hint, ''), 'message', v_message));
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null, 'errors', v_errors);
  end if;
  if v_status = 'conflict' then
    return pg_catalog.jsonb_build_object('status', 'conflict', 'dry_run', v_dry, 'id', null, 'future', not v_past,
                                         'reason', 'Ce professionnel a déjà un rendez-vous sur ce créneau.');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry, 'id', case when not v_dry then v_id end,
                                       'future', not v_past, 'notes', v_notes);
end;
$$;

-- -----------------------------------------------------------------------------
-- import_waitlist_entry: refused once the imports are closed
-- -----------------------------------------------------------------------------
-- Latest body: 20261014004319_demandes_waitlist_import.sql.
create or replace function public.import_waitlist_entry(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_ref text;
  v_dref text;
  v_match record;
  v_demande public.demandes;
  v_title uuid;
  v_pro uuid;
  v_key text;
  v_registered timestamptz;
  v_priority text;
  v_reason text;
  v_fee text;
  v_id uuid;
  v_created boolean := false;
  v_errors jsonb := '[]';
  v_skip text;
  v_message text;
  v_hint text;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform private.demandes_require('demandes.manage');
  perform private.demandes_require('demandes.waitlist');
  perform private.clients_import_assert();  -- clients.manage and clients.merge: whoever imports, as I1
  perform private.imports_assert_open();  -- closed after the cutover (*_core_imports_switch.sql)
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object' then
    raise exception 'Une ligne d''import est un objet JSON.' using errcode = '22023';
  end if;
  v_ref := pg_catalog.btrim(coalesce(p_row ->> 'external_ref', ''));
  if v_ref !~ '^gorendezvous:[A-Za-z0-9:_-]{1,50}$' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'external_ref',
        'message', 'La référence GOrendezvous de l''inscription est requise.')));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('demandes.waitlist_import:' || v_org::text, 0));
  select e.id into v_id from public.waitlist_entries e where e.org_id = v_org and e.external_ref = v_ref;
  if v_id is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', v_id, 'reason', 'Déjà importée');
  end if;
  select m.* into v_match from private.clients_import_match(v_org, p_row ->> 'client_ref', p_row ->> 'client_name') m;
  if v_match.status <> 'ok' then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null,
                                         'reason', case v_match.status when 'ambiguous' then 'client_ambiguous' else 'client_not_found' end);
  end if;
  v_dref := 'gorendezvous:waitlist:' || v_match.client_id::text;

  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    begin
      v_registered := coalesce(nullif(p_row ->> 'registered_at', '')::timestamptz, pg_catalog.now());
      v_pro := nullif(p_row ->> 'professional_id', '')::uuid;
    exception when others then
      raise exception 'Une date d''inscription ou un professionnel est illisible.' using errcode = 'P0001', hint = 'registered_at';
    end;
    if v_registered > pg_catalog.now() + interval '5 minutes' then
      raise exception 'La date d''inscription ne peut pas être dans le futur.' using errcode = 'P0001', hint = 'registered_at';
    end if;
    v_key := nullif(pg_catalog.btrim(coalesce(p_row ->> 'profession_key', '')), '');
    if num_nonnulls(v_key, v_pro) <> 1 then
      raise exception 'Une liste : une profession ou un professionnel (un seul des deux).' using errcode = 'P0001', hint = 'target';
    end if;
    if v_key is not null then
      select t.id into v_title from public.profession_titles_catalog t where t.org_id = v_org and t.key = v_key;
      if v_title is null then
        raise exception 'Cette profession n''est pas au catalogue de la clinique.' using errcode = 'P0001', hint = 'profession_key';
      end if;
    elsif not exists (select 1 from public.professionals_directory p where p.id = v_pro and p.org_id = v_org and p.status = 'active') then
      raise exception 'Le professionnel de la liste est introuvable ou inactif.' using errcode = 'P0001', hint = 'professional_id';
    end if;
    v_reason := nullif(pg_catalog.btrim(coalesce(p_row ->> 'priority_reason', '')), '');
    v_priority := case when v_reason is not null then 'priority' else 'normal' end;
    if v_reason is not null and char_length(v_reason) > 300 then
      v_reason := pg_catalog.left(v_reason, 300);
    end if;
    v_fee := case when pg_catalog.lower(coalesce(p_row ->> 'fee_paid', '')) in ('true', 't', '1') then 'paid' else 'to_invoice' end;

    -- The client's request for her imported entries (the first one creates it).
    select d.* into v_demande from public.demandes d where d.org_id = v_org and d.external_ref = v_dref for update;
    if v_demande.id is null then
      v_id := private.demandes_insert(v_org,
                pg_catalog.jsonb_build_object('client_id', v_match.client_id::text, 'channel', 'other',
                                              'received_at', v_registered::text),
                auth.uid());
      update public.demandes d set external_ref = v_dref, state = 'waitlist' where d.id = v_id returning d.* into v_demande;
      insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, by_user)
      values (v_id, v_org, 'state_changed', 'new', 'waitlist', auth.uid());
      v_created := true;
    elsif v_demande.state in ('matched', 'closed') then
      v_skip := 'Demande jumelée ou fermée depuis';
    end if;
    if v_skip is null and exists (select 1 from public.waitlist_entries e
                                   where e.demande_id = v_demande.id and e.state <> 'closed'
                                     and (e.target_profession_title_id = v_title or e.target_professional_id = v_pro)) then
      v_skip := 'Déjà sur cette liste';
    end if;
    if v_skip is null then
      if v_demande.state <> 'waitlist' then
        update public.demandes d set state = 'waitlist' where d.id = v_demande.id;
        insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, by_user)
        values (v_demande.id, v_org, 'state_changed', v_demande.state, 'waitlist', auth.uid());
      end if;
      insert into public.waitlist_entries
        (org_id, demande_id, client_id, target_profession_title_id, target_professional_id, priority, priority_reason,
         registered_at, registered_by, availability_periods, availability_days, modality, language, preferred_pro_gender,
         clientele_id, payer_kind, fee_status, external_ref)
      values
        (v_org, v_demande.id, v_match.client_id, v_title, v_pro, v_priority, v_reason,
         v_registered, auth.uid(), v_demande.availability_periods, v_demande.availability_days, v_demande.modality,
         v_demande.language, v_demande.preferred_pro_gender, v_demande.clientele_id, v_demande.payer_kind, v_fee, v_ref)
      returning id into v_id;
      perform private.waitlist_promote(v_org, v_id);
    end if;

    if v_dry then
      raise exception 'import_waitlist_entry: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- a dry run: everything above is rolled back
    when check_violation then
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', null,
        'message', 'Une valeur de la ligne ne respecte pas les règles de son champ (longueur, caractères).'));
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', nullif(v_hint, ''), 'message', v_message));
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null, 'errors', v_errors);
  end if;
  if v_skip is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', null,
                                         'demande_id', case when not v_dry then v_demande.id end, 'reason', v_skip);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry,
                                       'id', case when not v_dry then v_id end,
                                       'demande_id', case when not v_dry then v_demande.id end,
                                       'new_demande', v_created);
end;
$$;

-- -----------------------------------------------------------------------------
-- import_default_payer: refused once the imports are closed
-- -----------------------------------------------------------------------------
-- Latest body: 20261014004322_billing_payer_import.sql.
create or replace function public.import_default_payer(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_dry boolean := coalesce(p_dry_run, true);
  v_client record;
  v_payer record;
  v_from date;
  v_id uuid;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform private.imports_assert_open();  -- closed after the cutover (*_core_imports_switch.sql)
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object' then
    raise exception 'Une ligne d''import est un objet JSON.' using errcode = '22023';
  end if;
  begin
    v_from := coalesce(nullif(p_row ->> 'effective_from', '')::date, private.billing_today(v_org));
  exception when others then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'effective_from',
        'message', 'La date est illisible (AAAA-MM-JJ).')));
  end;
  select m.* into v_client from private.clients_import_match(v_org, p_row ->> 'client_ref', p_row ->> 'client_name') m;
  if v_client.status <> 'ok' then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null,
                                         'reason', case v_client.status when 'ambiguous' then 'client_ambiguous' else 'client_not_found' end);
  end if;
  select m.* into v_payer from private.clients_import_match(v_org, p_row ->> 'payer_ref', p_row ->> 'payer_name') m;
  if v_payer.status <> 'ok' then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null,
                                         'reason', case v_payer.status when 'ambiguous' then 'payer_ambiguous' else 'payer_not_found' end);
  end if;
  if v_payer.client_id = v_client.client_id then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', null, 'reason', 'Le client paie lui-même');
  end if;
  if private.billing_default_payer(v_org, v_client.client_id, v_from) = v_payer.client_id then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', null, 'reason', 'Déjà le payeur par défaut');
  end if;
  if not private.billing_payer_allowed(v_org, v_client.client_id, v_payer.client_id) then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null, 'reason', 'payer_not_allowed');
  end if;
  if v_dry then
    return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', true, 'id', null);
  end if;
  perform pg_catalog.set_config('app.audit_source', 'import', true);
  insert into public.billing_payer_defaults (org_id, client_id, payer_client_id, effective_from, created_by)
  values (v_org, v_client.client_id, v_payer.client_id, v_from, auth.uid())
  on conflict (org_id, client_id, effective_from) do update
    set payer_client_id = excluded.payer_client_id, created_by = excluded.created_by
  returning id into v_id;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', false, 'id', v_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- import_professional: refused once the imports are closed
-- -----------------------------------------------------------------------------
-- Latest body: 20261008170703_professionals_compensation_private.sql.
create or replace function public.import_professional(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_activate boolean;
  v_existing uuid;
  v_contact jsonb;
  v_sets jsonb;
  v_result record;
  v_errors jsonb;
  v_deferred boolean := false;
  v_message text;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_pct numeric;
  v_sessions numeric;
  v_comp_errors jsonb := '[]';
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  perform private.imports_assert_open();  -- closed after the cutover (*_core_imports_switch.sql)
  if pg_catalog.jsonb_typeof(p_row) = 'object' then
    if pg_catalog.jsonb_typeof(p_row -> 'retention_pct') not in ('number', 'null') then
      raise exception 'Nombre attendu : retention_pct' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(p_row -> 'cumulative_sessions') not in ('number', 'null') then
      raise exception 'Nombre attendu : cumulative_sessions' using errcode = '22023';
    end if;
    v_pct := (p_row ->> 'retention_pct')::numeric;
    v_sessions := (p_row ->> 'cumulative_sessions')::numeric;
  end if;
  perform private.import_professional_check(case when pg_catalog.jsonb_typeof(p_row) = 'object'
                                                 then p_row - 'retention_pct' - 'cumulative_sessions' else p_row end);
  v_activate := coalesce((p_row ->> 'activate')::boolean, false);
  if v_activate and not private.has_permission('professionals.activate_override') then
    raise exception 'Permission refusée : professionals.activate_override' using errcode = '42501';
  end if;
  if (v_pct is not null or v_sessions is not null) and not private.has_permission('professionals.compensation') then
    raise exception 'Permission refusée : professionals.compensation' using errcode = '42501';
  end if;

  -- Idempotent re-runs: the clinic already has this professional (email as private.professional_email stores it).
  select p.id into v_existing from public.professionals p
   where p.org_id = v_org and p.email = pg_catalog.lower(pg_catalog.btrim(coalesce(p_row ->> 'email', ''), E' \t\r\n'));
  if v_existing is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', v_existing, 'reason', 'Courriel déjà présent');
  end if;

  v_contact := private.import_professional_contact(p_row);
  v_sets := private.import_professional_sets(v_org, p_row);
  -- The two compensation values, checked as the record's dialogs check them.
  if v_pct is not null and (v_pct < 0 or v_pct > 100 or v_pct <> round(v_pct, 2)) then
    v_comp_errors := v_comp_errors || pg_catalog.jsonb_build_object('field', 'retentionPct',
      'message', 'Le taux de retenue est un pourcentage entre 0 et 100, à deux décimales au plus.');
  end if;
  if v_sessions is not null and (v_sessions < 0 or v_sessions > 100000 or v_sessions * 2 <> pg_catalog.trunc(v_sessions * 2)) then
    v_comp_errors := v_comp_errors || pg_catalog.jsonb_build_object('field', 'cumulativeSessions',
      'message', 'Le nombre de séances cumulées est compris entre 0 et 100 000, par demi-séance.');
  end if;

  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    select * into v_result from private.import_professional_apply(p_row, v_contact, v_sets, v_activate);
    v_errors := (v_contact -> 'errors') || (v_sets -> 'errors') || v_comp_errors || v_result.errors;
    if v_result.id is not null and v_errors = '[]' then
      if v_sessions is not null and v_sessions > 0 then
        begin
          perform public.record_monthly_sessions(
            (pg_catalog.date_trunc('month', private.clinic_today()) - interval '1 month')::date,
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'professional_id', v_result.id, 'sessions_50_60', 0, 'sessions_30', 0,
              'adjustment', v_sessions, 'note', 'Solde importé', 'expected_updated_at', null)));
        exception when sqlstate 'P0001' then
          get stacked diagnostics v_message = message_text;
          v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'cumulativeSessions', 'message', v_message);
        end;
      end if;
      if v_pct is not null then
        begin
          perform public.decide_retention(v_result.id, 'initial', v_pct,
                                          pg_catalog.date_trunc('month', private.clinic_today())::date, null,
                                          pg_catalog.date_trunc('month', private.clinic_today())::date, null);
        exception when sqlstate 'P0001' then
          get stacked diagnostics v_message = message_text;
          v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'retentionPct', 'message', v_message);
        end;
      end if;
    end if;
    -- A dry run checks the deferred constraints now (the one-primary-title check), as the commit of
    -- a real run would. Set at this block's level, so its rollback puts the deferred mode back.
    if v_dry and v_errors = '[]' then
      v_deferred := true;
      set constraints all immediate;
      v_deferred := false;
    end if;
    if v_dry or v_errors <> '[]' then
      raise exception 'import_professional: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- everything the block wrote is rolled back; v_result and v_errors keep their values
    when sqlstate 'P0001' then
      -- Only a deferred check refused by set constraints is a row error; anything else propagates.
      if not v_deferred then
        raise;
      end if;
      get stacked diagnostics v_message = message_text;
      v_errors := v_errors || pg_catalog.jsonb_build_object('field', null, 'message', v_message);
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null, 'errors', v_errors);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry, 'id', case when not v_dry then v_result.id end,
                                       'activated', v_result.activated, 'complete', v_result.complete,
                                       'missing', v_result.missing);
end;
$$;

-- -----------------------------------------------------------------------------
-- import_client_consent: refused once the imports are closed; the skip reason
-- -----------------------------------------------------------------------------
-- Latest body: 20261014004325_clients_consent_import.sql.
create or replace function public.import_client_consent(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_match record;
  v_signed timestamptz;
  v_key text;
  v_added boolean;
  v_errors jsonb := '[]';
  v_message text;
  v_hint text;
begin
  perform private.clients_import_assert();
  perform private.imports_assert_open();  -- closed after the cutover (*_core_imports_switch.sql)
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object' then
    raise exception 'Une ligne d''import est un objet JSON.' using errcode = '22023';
  end if;
  begin
    v_signed := (p_row ->> 'signed_at')::timestamptz;
  exception when others then
    v_signed := null;
  end;
  if v_signed is null or v_signed > pg_catalog.now() + interval '5 minutes' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'signed_at',
        'message', 'La date de signature est requise et ne peut pas être dans le futur.')));
  end if;
  v_key := pg_catalog.btrim(coalesce(p_row ->> 'consent_key', ''));
  select m.* into v_match from private.clients_import_match(v_org, p_row ->> 'client_ref', p_row ->> 'client_name') m;
  if v_match.status <> 'ok' then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry,
                                         'reason', case v_match.status when 'ambiguous' then 'client_ambiguous' else 'client_not_found' end);
  end if;

  begin
    v_added := public.import_client_consent_fact_for_service(v_org, v_match.client_id, v_key,
                 pg_catalog.left(p_row ->> 'version_label', 60), v_signed, pg_catalog.left(p_row ->> 'signer_name', 200));
    if v_dry then
      raise exception 'import_client_consent: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- a dry run: rolled back
    when check_violation then
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', null,
        'message', 'Une valeur de la ligne ne respecte pas les règles de son champ (longueur, caractères).'));
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', nullif(v_hint, ''), 'message', v_message));
  end;
  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'errors', v_errors);
  end if;
  if not v_added then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'reason', 'Déjà en vigueur, retiré ou plus récent dans l''app');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry);
end;
$$;

-- -----------------------------------------------------------------------------
-- import_client_consent_fact_for_service: never resurrects a withdrawn consent (finding 1)
-- -----------------------------------------------------------------------------
-- Skipped (false) also when the client has a consent of this kind withdrawn, signed in the app,
-- or imported with the same or a later date; refused once the imports are closed.
-- Latest body: 20261013020447_clients_consents.sql.
create or replace function public.import_client_consent_fact_for_service(
  p_org_id uuid,
  p_client_id uuid,
  p_consent_key text,
  p_version_label text,
  p_signed_at timestamptz,
  p_signer_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lang text;
  v_count int;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if p_org_id is null or p_client_id is null or p_signed_at is null then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  if not coalesce((select o.imports_open from public.organizations o where o.id = p_org_id), false) then
    raise exception 'Les imports sont fermés pour cette clinique.' using errcode = 'P0001';
  end if;
  select c.language into v_lang from public.clients c where c.org_id = p_org_id and c.id = p_client_id;
  if v_lang is null then
    raise exception 'Client introuvable.' using errcode = 'P0001', hint = 'client';
  end if;
  if not exists (select 1 from public.client_consent_types t where t.org_id = p_org_id and t.key = p_consent_key) then
    raise exception 'Ce consentement n''existe pas.' using errcode = 'P0001', hint = 'consent_key';
  end if;
  -- The app's word stands (security review, 2026-10-14): a consent of this kind withdrawn, signed in
  -- the app, or imported with a later or the same date is never followed by this import (a re-run
  -- would otherwise bring a withdrawn consent back in force).
  if exists (select 1 from public.client_consents x
              where x.org_id = p_org_id and x.client_id = p_client_id and x.consent_key = p_consent_key
                and (x.withdrawn_at is not null or x.source <> 'import' or x.signed_at >= p_signed_at)) then
    return false;
  end if;
  perform pg_catalog.set_config('app.audit_source', 'import:gorendezvous', true);
  insert into public.client_consents (org_id, client_id, consent_key, language, version_label, signed_at, signed_by, source)
  values (p_org_id, p_client_id, p_consent_key, v_lang, coalesce(nullif(pg_catalog.btrim(p_version_label), ''), 'GOrendezvous'),
          p_signed_at,
          case when nullif(pg_catalog.btrim(coalesce(p_signer_name, '')), '') is null then '[]'::jsonb
               else pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('name', pg_catalog.btrim(p_signer_name))) end,
          'import')
  on conflict do nothing;
  get diagnostics v_count = row_count;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return v_count > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- import_invoice: refused once the imports are closed; payments as record_payment; at most 200 of each
-- -----------------------------------------------------------------------------
-- Latest body: 20261013173039_billing_import.sql.
create or replace function public.import_invoice(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_dry boolean := coalesce(p_dry_run, true);
  v_gor text;
  v_ref text;
  v_year int;
  v_seq int;
  v_number text;
  v_issued date;
  v_match record;
  v_tz text;
  v_id uuid;
  v_line jsonb;
  v_pos int := 0;
  v_code int;
  v_pro uuid;
  v_qty numeric;
  v_unit int;
  v_sub int;
  v_gst int;
  v_qst int;
  v_total int;
  v_lines_total int := 0;
  v_pay jsonb;
  v_n int := 0;
  v_payment uuid;
  v_amount int;
  v_errors jsonb := '[]';
  v_message text;
  v_hint text;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object'
     or pg_catalog.jsonb_typeof(coalesce(p_row -> 'lines', '[]')) <> 'array'
     or pg_catalog.jsonb_typeof(coalesce(p_row -> 'payments', '[]')) <> 'array'
     or pg_catalog.jsonb_typeof(coalesce(p_row -> 'refunds', '[]')) <> 'array' then
    raise exception 'Une ligne d''import est un objet JSON (lines, payments, refunds : des listes).' using errcode = '22023';
  end if;
  perform private.imports_assert_open();  -- closed after the cutover (*_core_imports_switch.sql)
  v_gor := pg_catalog.btrim(coalesce(p_row ->> 'gorendezvous_number', ''));
  if v_gor !~ '^[0-9]{4}-[0-9]{1,9}$' or pg_catalog.substr(v_gor, 6)::bigint = 0 then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'gorendezvous_number',
        'message', 'Le numéro GOrendezvous est requis (AAAA-N).')));
  end if;
  v_ref := 'gorendezvous:' || v_gor;
  v_year := pg_catalog.substr(v_gor, 1, 4)::int;
  v_seq := pg_catalog.substr(v_gor, 6)::int;
  v_number := v_year || '-' || v_seq;

  -- One run at a time per invoice: two runs of the same file never both create it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('billing.import:' || v_org::text || ':' || v_ref, 0));
  select i.id, i.number into v_match from public.invoices i where i.org_id = v_org and i.external_ref = v_ref;
  if v_match.id is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', v_match.id, 'number', v_match.number, 'reason', 'Déjà importée');
  end if;

  select m.* into v_match from private.clients_import_match(v_org, p_row ->> 'client_ref', p_row ->> 'client_name') m;
  if v_match.status <> 'ok' then
    return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null, 'number', v_number,
                                         'reason', case v_match.status when 'ambiguous' then 'client_ambiguous' else 'client_not_found' end);
  end if;

  v_tz := coalesce((select o.timezone from public.organizations o where o.id = v_org), 'America/Toronto');
  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    if pg_catalog.jsonb_array_length(coalesce(p_row -> 'lines', '[]')) > 200
       or pg_catalog.jsonb_array_length(coalesce(p_row -> 'payments', '[]')) > 200
       or pg_catalog.jsonb_array_length(coalesce(p_row -> 'refunds', '[]')) > 200 then
      raise exception 'Une facture importée a au plus 200 lignes, 200 paiements et 200 remboursements.' using errcode = 'P0001', hint = 'lines';
    end if;
    begin
      v_issued := (p_row ->> 'issued_on')::date;
      v_sub := (p_row ->> 'subtotal_cents')::int;
      v_gst := coalesce((p_row ->> 'gst_cents')::int, 0);
      v_qst := coalesce((p_row ->> 'qst_cents')::int, 0);
      v_total := (p_row ->> 'total_cents')::int;
    exception when others then
      raise exception 'Une date ou un montant de la facture est illisible.' using errcode = 'P0001', hint = 'total_cents';
    end;
    if v_issued is null or v_total is null then
      raise exception 'La date et le total de la facture sont requis.' using errcode = 'P0001', hint = 'issued_on';
    end if;
    if extract(year from v_issued)::int <> v_year then
      raise exception 'L''année du numéro n''est pas celle de la date de la facture.' using errcode = 'P0001', hint = 'issued_on';
    end if;
    v_sub := coalesce(v_sub, v_total - v_gst - v_qst);
    if v_sub + v_gst + v_qst <> v_total or v_total < 0 then
      raise exception 'Le sous-total et les taxes ne font pas le total de la facture.' using errcode = 'P0001', hint = 'total_cents';
    end if;
    if pg_catalog.jsonb_array_length(coalesce(p_row -> 'lines', '[]')) = 0 then
      raise exception 'Une facture importée a au moins une ligne.' using errcode = 'P0001', hint = 'lines';
    end if;
    if exists (select 1 from public.invoices i where i.org_id = v_org and i.number = v_number) then
      raise exception 'Le numéro % existe déjà dans Facturation.', v_number using errcode = 'P0001', hint = 'gorendezvous_number';
    end if;
    perform private.billing_check_client(v_org, v_match.client_id);

    insert into public.invoices (org_id, number, year, seq, status, client_id, payer_kind, payer_client_id, issued_on, due_on,
                                 gst_rate, qst_rate, subtotal_cents, gst_cents, qst_cents, total_cents,
                                 source_type, external_ref, created_by, finalized_at, finalized_by)
    values (v_org, v_number, v_year, v_seq, 'issued', v_match.client_id, 'client', v_match.client_id, v_issued, v_issued,
            case when v_gst > 0 then private.billing_tax_rate(v_org, 'gst', v_issued) else 0 end,
            case when v_qst > 0 then private.billing_tax_rate(v_org, 'qst', v_issued) else 0 end,
            v_sub, v_gst, v_qst, v_total, 'import', v_ref, auth.uid(),
            (v_issued::timestamp at time zone v_tz), auth.uid())
    returning id into v_id;

    for v_line in select x.value from pg_catalog.jsonb_array_elements(p_row -> 'lines') x loop
      v_pos := v_pos + 1;
      begin
        v_code := nullif(v_line ->> 'service_code', '')::int;
        v_pro := nullif(v_line ->> 'professional_id', '')::uuid;
        v_qty := coalesce((v_line ->> 'quantity')::numeric, 1);
        v_unit := (v_line ->> 'unit_price_cents')::int;
        v_gst := coalesce((v_line ->> 'gst_cents')::int, 0);
        v_qst := coalesce((v_line ->> 'qst_cents')::int, 0);
        v_total := (v_line ->> 'total_cents')::int;
      exception when others then
        raise exception 'Ligne % : un code ou un montant est illisible.', v_pos using errcode = 'P0001', hint = 'lines';
      end;
      if v_total is null then
        raise exception 'Ligne % : le total est requis.', v_pos using errcode = 'P0001', hint = 'lines';
      end if;
      begin
        insert into public.invoice_lines (org_id, invoice_id, position, line_type, professional_id, service_id, service_code,
                                          description, quantity, unit_price_cents, price_source, tax_rule,
                                          subtotal_cents, gst_cents, qst_cents, total_cents)
        values (v_org, v_id, v_pos,
                case when private.service_id_by_code(v_org, v_code) is null then 'adjustment' else 'service' end,
                v_pro, private.service_id_by_code(v_org, v_code), v_code,
                coalesce(nullif(pg_catalog.left(pg_catalog.btrim(coalesce(v_line ->> 'description', '')), 300), ''), 'Service GOrendezvous'),
                v_qty, v_unit, 'import',
                case when v_gst + v_qst > 0 then 'taxable' else 'exempt' end,
                v_total - v_gst - v_qst, v_gst, v_qst, v_total);
      exception when check_violation or foreign_key_violation or numeric_value_out_of_range then
        raise exception 'Ligne % : une quantité, un prix ou un professionnel est hors limites.', v_pos using errcode = 'P0001', hint = 'lines';
      end;
      v_lines_total := v_lines_total + v_total;
    end loop;
    if v_lines_total <> (p_row ->> 'total_cents')::int then
      raise exception 'Les lignes ne font pas le total de la facture.' using errcode = 'P0001', hint = 'lines';
    end if;

    for v_pay in select x.value from pg_catalog.jsonb_array_elements(coalesce(p_row -> 'payments', '[]')) x loop
      v_n := v_n + 1;
      -- As record_payment: an active mode, never « Note de crédit » (a credit note is a document,
      -- not money received).
      if v_pay ->> 'mode_code' = 'credit_note' then
        raise exception 'Paiement % : une note de crédit ne s''importe pas comme un paiement.', v_n using errcode = 'P0001', hint = 'payments';
      end if;
      if not exists (select 1 from public.payment_modes m where m.org_id = v_org and m.code = v_pay ->> 'mode_code' and m.is_active) then
        raise exception 'Paiement % : mode de paiement inconnu ou inactif.', v_n using errcode = 'P0001', hint = 'payments';
      end if;
      begin
        if (v_pay ->> 'paid_on')::date > private.billing_today(v_org) then
          raise exception 'Paiement % : la date de paiement est dans le futur.', v_n using errcode = 'P0001', hint = 'payments';
        end if;
        insert into public.payments (org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on, external_ref, created_by)
        values (v_org, v_id, v_match.client_id, v_pay ->> 'mode_code', (v_pay ->> 'amount_cents')::int, (v_pay ->> 'paid_on')::date,
                v_ref || ':' || v_n, auth.uid());
      exception when check_violation or invalid_text_representation or invalid_datetime_format or not_null_violation
                     or numeric_value_out_of_range or datetime_field_overflow then
        raise exception 'Paiement % : la date ou le montant est illisible.', v_n using errcode = 'P0001', hint = 'payments';
      end;
    end loop;

    v_n := 0;
    for v_pay in select x.value from pg_catalog.jsonb_array_elements(coalesce(p_row -> 'refunds', '[]')) x loop
      v_n := v_n + 1;
      v_amount := (v_pay ->> 'amount_cents')::int;
      select p.id into v_payment from public.payments p
       where p.invoice_id = v_id and p.amount_cents >= coalesce(v_amount, 0)
       order by p.paid_on desc, p.external_ref desc limit 1;
      if v_payment is null then
        raise exception 'Remboursement % : aucun paiement de la facture ne le couvre.', v_n using errcode = 'P0001', hint = 'refunds';
      end if;
      begin
        if (v_pay ->> 'paid_on')::date > private.billing_today(v_org) then
          raise exception 'Remboursement % : la date est dans le futur.', v_n using errcode = 'P0001', hint = 'refunds';
        end if;
        insert into public.refunds (org_id, payment_id, invoice_id, amount_cents, reason, status, created_by, processed_at)
        values (v_org, v_payment, v_id, v_amount, 'Remboursement importé de GOrendezvous', 'recorded', auth.uid(),
                ((v_pay ->> 'paid_on')::date::timestamp at time zone v_tz));
      exception when check_violation or invalid_text_representation or invalid_datetime_format or not_null_violation then
        raise exception 'Remboursement % : la date ou le montant est illisible.', v_n using errcode = 'P0001', hint = 'refunds';
      end;
      v_payment := null;
    end loop;

    if coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = v_id), 0)
       - coalesce((select sum(r.amount_cents) from public.refunds r where r.invoice_id = v_id), 0)
       > (select i.total_cents from public.invoices i where i.id = v_id) then
      raise exception 'Les paiements dépassent le total de la facture.' using errcode = 'P0001', hint = 'payments';
    end if;
    if coalesce((select sum(r.amount_cents) from public.refunds r where r.invoice_id = v_id), 0)
       > coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = v_id), 0) then
      raise exception 'Les remboursements dépassent les paiements de la facture.' using errcode = 'P0001', hint = 'refunds';
    end if;
    perform private.billing_apply_payments(v_id);
    -- The year's numbering goes on after the imported numbers.
    insert into public.invoice_sequences as s (org_id, kind, year, last_number)
    values (v_org, 'invoice', v_year, v_seq)
    on conflict (org_id, kind, year) do update set last_number = greatest(s.last_number, excluded.last_number);

    if v_dry then
      raise exception 'import_invoice: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- a dry run: everything above is rolled back
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', nullif(v_hint, ''), 'message', v_message));
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null, 'number', v_number, 'errors', v_errors);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry, 'id', case when not v_dry then v_id end, 'number', v_number);
end;
$$;

-- -----------------------------------------------------------------------------
-- open_client_consent_for_service: invalid while Clients is reserved for its testers (P3-40)
-- -----------------------------------------------------------------------------
-- Latest body: 20261013020447_clients_consents.sql.
create or replace function public.open_client_consent_for_service(p_token_hash bytea, p_first_name text, p_birth_year int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link record;
  v_req public.client_consent_requests%rowtype;
  v_signer_first text;
  v_status text;
begin
  select * into v_link from private.clients_consent_link(p_token_hash);
  if v_link.link_id is null then
    return '{"state": "invalid"}'::jsonb;
  end if;
  if not public.module_open_to_all_for_org(v_link.org_id, 'clients') then
    return '{"state": "invalid"}'::jsonb;
  end if;
  if not private.clients_consent_identity_ok(v_link.org_id, v_link.request_id, p_first_name, p_birth_year) then
    return private.clients_consent_identity_failed(v_link.org_id, v_link.signer_id);
  end if;
  select * into v_req from public.client_consent_requests r where r.id = v_link.request_id;
  update public.client_consent_request_signers s set opened_at = coalesce(s.opened_at, pg_catalog.now()), identity_failures = 0
   where s.id = v_link.signer_id;
  select c.first_name into v_signer_first
    from public.client_consent_request_signers s join public.clients c on c.id = s.signer_client_id
   where s.id = v_link.signer_id;
  select s.status into v_status from public.signature_requests s
   where s.org_id = v_req.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
     and s.subject_id = v_req.id
   order by s.created_at desc limit 1;
  return pg_catalog.jsonb_build_object(
    'state', 'ready',
    'org_id', v_req.org_id,
    'request_id', v_req.id,
    'role', v_link.role,
    'language', v_req.language,
    'clinic_name', (select o.name from public.organizations o where o.id = v_req.org_id),
    'consent_name', (select case when v_req.language = 'en' then t.name_en else t.name_fr end
                       from public.client_consent_types t where t.org_id = v_req.org_id and t.key = v_req.consent_key),
    'client_first_name', (select c.first_name from public.clients c where c.id = v_req.client_id),
    'signer_first_name', v_signer_first,
    'clauses', v_req.clauses,
    'answers', v_req.answers,
    'can_answer', v_req.answers is null,
    'signing', v_status);
end;
$$;

-- -----------------------------------------------------------------------------
-- start_client_consent_signing_for_service: invalid while Clients is reserved for its testers (P3-40)
-- -----------------------------------------------------------------------------
-- Latest body: 20261013020447_clients_consents.sql.
create or replace function public.start_client_consent_signing_for_service(
  p_token_hash bytea,
  p_first_name text,
  p_birth_year int,
  p_answers jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link record;
  v_req public.client_consent_requests%rowtype;
  v_client public.clients%rowtype;
  v_clause jsonb;
  v_answer text;
  v_sig record;
  v_signers jsonb;
  v_tz text;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  select * into v_link from private.clients_consent_link(p_token_hash);
  if v_link.link_id is null or not public.module_open_to_all_for_org(v_link.org_id, 'clients') then
    return '{"state": "invalid"}'::jsonb;
  end if;
  if not private.clients_consent_identity_ok(v_link.org_id, v_link.request_id, p_first_name, p_birth_year) then
    return private.clients_consent_identity_failed(v_link.org_id, v_link.signer_id);
  end if;
  select * into v_req from public.client_consent_requests r where r.id = v_link.request_id for update;

  if v_req.answers is null then
    if p_answers is null or pg_catalog.jsonb_typeof(p_answers) <> 'object' then
      raise exception 'Répondez à chaque question avant de signer.' using errcode = 'P0001', hint = 'answers';
    end if;
    for v_clause in select c from pg_catalog.jsonb_array_elements(v_req.clauses) c loop
      v_answer := p_answers ->> (v_clause ->> 'key');
      if v_answer is null or v_answer not in ('yes', 'no') then
        raise exception 'Répondez à chaque question avant de signer.' using errcode = 'P0001', hint = 'answers';
      end if;
      if v_clause ->> 'kind' = 'agree' and v_answer <> 'yes' then
        raise exception 'Pour signer ce consentement, vous devez accepter chaque clause marquée « Accord requis ».'
          using errcode = 'P0001', hint = 'answers';
      end if;
    end loop;
    if exists (select 1 from pg_catalog.jsonb_object_keys(p_answers) k
                where not exists (select 1 from pg_catalog.jsonb_array_elements(v_req.clauses) c where c ->> 'key' = k)) then
      raise exception 'Invalid answers' using errcode = '22023';
    end if;
    update public.client_consent_requests r set answers = p_answers, answered_at = pg_catalog.now()
     where r.id = v_req.id returning * into v_req;
  end if;

  -- An envelope already out: this signer resumes it.
  if not exists (select 1 from public.signature_requests s
                  where s.org_id = v_req.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
                    and s.subject_id = v_req.id and s.status in ('draft', 'sent', 'viewed')) then
    -- Before any envelope: the signers must still be the ones the rules name (R-48), else the
    -- links are revoked and the clinic sends again; the text is the one published now.
    begin
      v_signers := private.clients_consent_signers(v_req.org_id, v_req.client_id);
    exception when others then
      v_signers := '[]'::jsonb;
    end;
    if pg_catalog.jsonb_array_length(v_signers)
         <> (select pg_catalog.count(*) from public.client_consent_request_signers x where x.request_id = v_req.id)
       or exists (select 1 from public.client_consent_request_signers x
                   where x.request_id = v_req.id
                     and not exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                                      where s ->> 'role' = x.role and (s ->> 'signer_client_id')::uuid = x.signer_client_id)) then
      perform private.clients_consent_close_links(v_req.org_id, v_req.id, null);
      return '{"state": "invalid"}'::jsonb;
    end if;
    update public.client_consent_requests r
       set template_version_id = v.id
      from public.document_templates t
      join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
     where r.id = v_req.id and t.org_id = r.org_id
       and t.key = 'clients.consent_' || r.consent_key || '_' || r.language
       and r.template_version_id <> v.id
    returning r.* into v_req;
    if v_req.id is null then
      select * into v_req from public.client_consent_requests r where r.id = v_link.request_id;
    end if;
  end if;
  select s.id, s.envelope_id, x.documenso_recipient_id into v_sig
    from public.signature_requests s
    join public.signature_request_signers x on x.request_id = s.id and x.role = v_link.role
   where s.org_id = v_req.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
     and s.subject_id = v_req.id and s.status in ('sent', 'viewed')
   order by s.created_at desc limit 1;
  if v_sig.id is not null and v_sig.envelope_id is not null and v_sig.documenso_recipient_id is not null then
    return pg_catalog.jsonb_build_object('state', 'resume', 'org_id', v_req.org_id, 'request_id', v_sig.id,
                                         'envelope_id', v_sig.envelope_id, 'recipient_id', v_sig.documenso_recipient_id);
  end if;

  select * into v_client from public.clients c where c.id = v_req.client_id;
  select o.timezone into v_tz from public.organizations o where o.id = v_req.org_id;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'role', s.role, 'name', c.first_name || ' ' || c.last_name, 'email', c.email,
           'order', case when s.role = 'client' then 1 else 2 end) order by s.role)
    into v_signers
    from public.client_consent_request_signers s
    join public.clients c on c.id = s.signer_client_id and c.org_id = s.org_id
   where s.request_id = v_req.id;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s where s ->> 'email' is null) then
    raise exception 'La personne qui doit signer n''a pas d''adresse courriel : communiquez avec la clinique.'
      using errcode = 'P0001', hint = 'signer_email';
  end if;
  return pg_catalog.jsonb_build_object(
    'state', 'prepared',
    'org_id', v_req.org_id,
    'consent_request_id', v_req.id,
    'role', v_link.role,
    'template_version_id', v_req.template_version_id,
    'title', (select case when v_req.language = 'en' then t.name_en else t.name_fr end
                from public.client_consent_types t where t.org_id = v_req.org_id and t.key = v_req.consent_key)
             || ' — ' || v_client.first_name || ' ' || v_client.last_name,
    'values', pg_catalog.jsonb_build_object(
      'client', pg_catalog.jsonb_build_object('full_name', v_client.first_name || ' ' || v_client.last_name,
                                              'first_name', v_client.first_name),
      'signer', pg_catalog.jsonb_build_object('full_name', (select s ->> 'name' from pg_catalog.jsonb_array_elements(v_signers) s where s ->> 'role' = 'client')),
      'signer_2', pg_catalog.jsonb_build_object('full_name', (select s ->> 'name' from pg_catalog.jsonb_array_elements(v_signers) s where s ->> 'role' = 'client_2')),
      'today', (pg_catalog.now() at time zone v_tz)::date),
    'signers', v_signers,
    'clauses', v_req.clauses,
    'answers', v_req.answers,
    'language', v_req.language,
    'sent_by', v_req.requested_by,
    'idempotency_key', 'client-consent:' || v_req.id::text || ':' || p_idempotency_key);
end;
$$;

-- -----------------------------------------------------------------------------
-- mark_client_consent_copy_sent_for_service: the actor is an active member with clients.manage
-- -----------------------------------------------------------------------------
-- Latest body: 20261013205013_clients_consents_withdrawal_copy.sql.
create or replace function public.mark_client_consent_copy_sent_for_service(p_org_id uuid, p_consent_id uuid, p_actor uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := pg_catalog.now();
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_org_id is null or p_consent_id is null or p_actor is null then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  -- As prepare_client_consent_copy_for_service: the verified caller, still allowed.
  if not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active')
     or not ('clients.manage' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  update public.client_consents c
     set copy_sent_at = v_at,
         copy_sent_by = case when exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id)
                             then p_actor end
   where c.org_id = p_org_id and c.id = p_consent_id;
  if not found then
    raise exception 'Consentement introuvable.' using errcode = 'P0001', hint = 'consent';
  end if;
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- report_demandes: Demandes as the caller sees it (« Réservé aux testeurs »)
-- -----------------------------------------------------------------------------
-- Latest body: 20261013233851_reports_demandes.sql.
create or replace function public.report_demandes(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.reports_require('reports.view');
  v_bounds record;
  v_tz text;
  v_top constant int := 50;
  v_result jsonb;
begin
  perform private.reports_check_period(p_from, p_to);
  if not public.module_enabled('demandes') then
    raise exception 'Activez d''abord Demandes : ce rapport lit ses demandes.' using errcode = 'P0001', hint = 'module';
  end if;
  select * into v_bounds from private.reports_period_bounds(v_org, p_from, p_to);
  v_tz := coalesce((select o.timezone from public.organizations o where o.id = v_org), 'America/Toronto');

  with r_all as (
    select * from private.demandes_report_requests(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), r as (
    -- A duplicate is not a request received (the workbook's « new only »).
    select * from r_all where r_all.closed_reason is distinct from 'duplicate'
  ), m as (
    select * from private.demandes_report_matches(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), cx as (
    select * from private.appointments_cancelled_between(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), cand as (
    -- Only the matches whose client and professional have an appointment cancelled in the period.
    select x.*, pg_catalog.row_number() over (order by x.matched_at, x.event_id)::int as ord
      from private.demandes_report_matches(v_org, '-infinity'::timestamptz, v_bounds.ends_at) x
     where x.client_id is not null and x.professional_id is not null
       and exists (select 1 from cx where cx.client_id = x.client_id and cx.professional_id = x.professional_id)
  ), fa as (
    select c.*, f.appointment_id, f.starts_at as appt_starts_at
      from cand c
      join private.appointments_first_after(v_org, array(select y.client_id from cand y order by y.ord),
                                            array(select y.professional_id from cand y order by y.ord),
                                            array(select y.matched_at from cand y order by y.ord)) f on f.ord = c.ord
  ), fc as (
    -- Each first appointment once (two matches of the same pair reach the same one): the latest match.
    select distinct on (fa.appointment_id) fa.*, cx.cancelled_at, cx.reason_name
      from fa join cx on cx.appointment_id = fa.appointment_id and cx.client_id = fa.client_id
     order by fa.appointment_id, fa.matched_at desc
  ), w as (
    select * from private.demandes_report_waitlist(v_org, v_bounds.starts_at, v_bounds.ends_at)
  ), cap as (
    select * from private.demandes_report_capacity(v_org, p_from, p_to)
  ), last_day as (
    select pg_catalog.max(cap.snapshot_on) as d from cap
  ), pros as (
    select n.professional_id, n.display_name
      from private.professional_display_names(v_org, array(
             select m.professional_id from m where m.professional_id is not null
             union select fc.professional_id from fc
             union select cap.professional_id from cap
             union select w.target_id from w where w.target_kind = 'professional')) n
  ), titles as (
    select n.title_id, n.name from private.profession_title_names(v_org, array(select w.target_id from w where w.target_kind = 'title')) n
  ), clienteles as (
    select n.clientele_id, n.name from private.clientele_names(v_org, array(select m.clientele_id from m where m.clientele_id is not null)) n
  ), weeks as (
    select distinct pg_catalog.date_trunc('week', g)::date as week_start
      from pg_catalog.generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ), months as (
    select distinct pg_catalog.date_trunc('month', g)::date as month_start
      from pg_catalog.generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ), rw as (
    select pg_catalog.date_trunc('week', r.received_at at time zone v_tz)::date as wk, pg_catalog.count(*) as n from r group by 1
  ), mw as (
    select pg_catalog.date_trunc('week', m.matched_at at time zone v_tz)::date as wk, pg_catalog.count(*) as n from m group by 1
  ), fw as (
    select pg_catalog.date_trunc('week', fc.cancelled_at at time zone v_tz)::date as wk, pg_catalog.count(*) as n from fc group by 1
  ), rmo as (
    select pg_catalog.date_trunc('month', r.received_at at time zone v_tz)::date as mo, pg_catalog.count(*) as n from r group by 1
  ), mmo as (
    select pg_catalog.date_trunc('month', m.matched_at at time zone v_tz)::date as mo, pg_catalog.count(*) as n from m group by 1
  ), fmo as (
    select pg_catalog.date_trunc('month', fc.cancelled_at at time zone v_tz)::date as mo, pg_catalog.count(*) as n from fc group by 1
  ), campaigns as (
    select g.name, g.n, g.matched, pg_catalog.row_number() over (order by g.n desc, g.name) as rk
      from (select r.source_campaign as name, pg_catalog.count(*) as n, pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
              from r where r.source_campaign is not null group by r.source_campaign) g
  ), utms as (
    select g.utm_source, g.utm_medium, g.n, g.matched,
           pg_catalog.row_number() over (order by g.n desc, g.utm_source nulls last, g.utm_medium nulls last) as rk
      from (select r.utm_source, r.utm_medium, pg_catalog.count(*) as n, pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
              from r where r.utm_source is not null or r.utm_medium is not null group by r.utm_source, r.utm_medium) g
  ), referrers as (
    select g.host, g.n, g.matched, pg_catalog.row_number() over (order by g.n desc, g.host) as rk
      from (select r.referrer_host as host, pg_catalog.count(*) as n, pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
              from r where r.referrer_host is not null group by r.referrer_host) g
  )
  select pg_catalog.jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (
      select pg_catalog.jsonb_build_object(
        'received', pg_catalog.count(*),
        'duplicates', (select pg_catalog.count(*) from r_all where r_all.closed_reason = 'duplicate'),
        'matched_activity', (select pg_catalog.count(*) from m),
        'activity_rate', case when pg_catalog.count(*) > 0
                              then pg_catalog.round(100.0 * (select pg_catalog.count(*) from m) / pg_catalog.count(*), 1) end,
        'matched_cohort', pg_catalog.count(*) filter (where r.first_matched_at is not null),
        'cohort_rate', case when pg_catalog.count(*) > 0
                            then pg_catalog.round(100.0 * pg_catalog.count(*) filter (where r.first_matched_at is not null) / pg_catalog.count(*), 1) end,
        'contacted_on_time', pg_catalog.count(*) filter (where r.contact_status = 'on_time'),
        'contacted_late', pg_catalog.count(*) filter (where r.contact_status = 'late'),
        'pending', pg_catalog.count(*) filter (where r.contact_status = 'pending'),
        'overdue', pg_catalog.count(*) filter (where r.contact_status = 'overdue'),
        'no_attempt', pg_catalog.count(*) filter (where r.contact_status = 'no_attempt'),
        'waitlisted', pg_catalog.count(*) filter (where r.ever_waitlisted))
        from r),
    'weeks', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'week_start', wk.week_start, 'received', coalesce(rw.n, 0), 'matched', coalesce(mw.n, 0),
               'first_cancelled', coalesce(fw.n, 0)) order by wk.week_start)
        from weeks wk
        left join rw on rw.wk = wk.week_start
        left join mw on mw.wk = wk.week_start
        left join fw on fw.wk = wk.week_start), '[]'),
    'months', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'month_start', mo.month_start, 'received', coalesce(rmo.n, 0), 'matched', coalesce(mmo.n, 0),
               'first_cancelled', coalesce(fmo.n, 0)) order by mo.month_start)
        from months mo
        left join rmo on rmo.mo = mo.month_start
        left join mmo on mmo.mo = mo.month_start
        left join fmo on fmo.mo = mo.month_start), '[]'),
    'by_channel', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('channel', g.channel, 'received', g.n, 'matched', g.matched) order by g.n desc, g.channel)
        from (select r.channel, pg_catalog.count(*) as n, pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
                from r group by r.channel) g), '[]'),
    'by_counselor', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.received_by, 'name', g.name, 'received', g.n)
                                  order by g.n desc, g.name nulls last, g.received_by)
        from (select r.received_by, pg_catalog.max(r.received_by_name) as name, pg_catalog.count(*) as n from r group by r.received_by) g), '[]'),
    'outcomes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('state', g.state, 'closed_reason', g.closed_reason, 'count', g.n)
                                  order by g.n desc, g.state, g.closed_reason)
        from (select r_all.state, r_all.closed_reason, pg_catalog.count(*) as n from r_all group by r_all.state, r_all.closed_reason) g), '[]'),
    'by_professional', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.professional_id, 'name', p.display_name, 'matched', g.n)
                                  order by g.n desc, p.display_name nulls last, g.professional_id)
        from (select m.professional_id, pg_catalog.count(*) as n from m group by m.professional_id) g
        left join pros p on p.professional_id = g.professional_id), '[]'),
    'by_professional_week', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('week_start', g.wk, 'id', g.professional_id, 'name', p.display_name, 'matched', g.n)
                                  order by g.wk, g.n desc, p.display_name nulls last, g.professional_id)
        from (select pg_catalog.date_trunc('week', m.matched_at at time zone v_tz)::date as wk, m.professional_id, pg_catalog.count(*) as n
                from m group by 1, 2) g
        left join pros p on p.professional_id = g.professional_id), '[]'),
    'by_clientele', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.clientele_id, 'name', c.name, 'matched', g.n)
                                  order by g.n desc, c.name nulls last, g.clientele_id)
        from (select m.clientele_id, pg_catalog.count(*) as n from m group by m.clientele_id) g
        left join clienteles c on c.clientele_id = g.clientele_id), '[]'),
    'by_source', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.referral_source_id, 'name', g.name, 'received', g.n, 'matched', g.matched)
                                  order by g.n desc, g.name nulls last)
        from (select r.referral_source_id, pg_catalog.max(r.referral_source_name) as name, pg_catalog.count(*) as n,
                     pg_catalog.count(*) filter (where r.first_matched_at is not null) as matched
                from r group by r.referral_source_id) g), '[]'),
    'by_campaign', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'received', g.n, 'matched', g.matched, 'other', g.other)
                                  order by g.other, g.n desc, g.name)
        from (select case when c.rk <= v_top then c.name end as name, c.rk > v_top as other,
                     pg_catalog.sum(c.n)::int as n, pg_catalog.sum(c.matched)::int as matched
                from campaigns c group by 1, 2) g), '[]'),
    'by_utm', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('source', g.utm_source, 'medium', g.utm_medium, 'received', g.n,
                                                                'matched', g.matched, 'other', g.other)
                                  order by g.other, g.n desc, g.utm_source nulls last, g.utm_medium nulls last)
        from (select case when u.rk <= v_top then u.utm_source end as utm_source, case when u.rk <= v_top then u.utm_medium end as utm_medium,
                     u.rk > v_top as other, pg_catalog.sum(u.n)::int as n, pg_catalog.sum(u.matched)::int as matched
                from utms u group by 1, 2, 3) g), '[]'),
    'by_referrer', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('host', g.host, 'received', g.n, 'matched', g.matched, 'other', g.other)
                                  order by g.other, g.n desc, g.host)
        from (select case when x.rk <= v_top then x.host end as host, x.rk > v_top as other,
                     pg_catalog.sum(x.n)::int as n, pg_catalog.sum(x.matched)::int as matched
                from referrers x group by 1, 2) g), '[]'),
    'delays', (
      select pg_catalog.jsonb_build_object(
        'first_contact_hours', pg_catalog.jsonb_build_object(
          'count', pg_catalog.count(r.first_contact_hours),
          'median', pg_catalog.round((pg_catalog.percentile_cont(0.5) within group (order by r.first_contact_hours))::numeric, 1),
          'average', pg_catalog.round(pg_catalog.avg(r.first_contact_hours), 1)),
        'proposal_days', pg_catalog.jsonb_build_object(
          'count', pg_catalog.count(r.first_proposed_at),
          'median', pg_catalog.round((pg_catalog.percentile_cont(0.5) within group (
                      order by extract(epoch from r.first_proposed_at - r.received_at) / 86400))::numeric, 1),
          'average', pg_catalog.round(pg_catalog.avg(extract(epoch from r.first_proposed_at - r.received_at) / 86400)::numeric, 1)),
        'match_days', pg_catalog.jsonb_build_object(
          'count', pg_catalog.count(r.first_matched_at),
          'median', pg_catalog.round((pg_catalog.percentile_cont(0.5) within group (
                      order by extract(epoch from r.first_matched_at - r.received_at) / 86400))::numeric, 1),
          'average', pg_catalog.round(pg_catalog.avg(extract(epoch from r.first_matched_at - r.received_at) / 86400)::numeric, 1)))
        from r),
    'first_appointments', pg_catalog.jsonb_build_object(
      'matched', (select pg_catalog.count(*) from m),
      'cancelled', (select pg_catalog.count(*) from fc),
      'rate', case when (select pg_catalog.count(*) from m) > 0
                   then pg_catalog.round(100.0 * (select pg_catalog.count(*) from fc) / (select pg_catalog.count(*) from m), 1) end,
      'notice_hours', (select pg_catalog.jsonb_build_object(
                         'average', pg_catalog.round(pg_catalog.avg(extract(epoch from fc.appt_starts_at - fc.cancelled_at) / 3600)::numeric, 1),
                         'min', pg_catalog.round(pg_catalog.min(extract(epoch from fc.appt_starts_at - fc.cancelled_at) / 3600)::numeric, 1),
                         'max', pg_catalog.round(pg_catalog.max(extract(epoch from fc.appt_starts_at - fc.cancelled_at) / 3600)::numeric, 1))
                         from fc),
      'lead_days', (select pg_catalog.jsonb_build_object(
                      'average', pg_catalog.round(pg_catalog.avg(extract(epoch from fc.appt_starts_at - fc.matched_at) / 86400)::numeric, 1),
                      'min', pg_catalog.round(pg_catalog.min(extract(epoch from fc.appt_starts_at - fc.matched_at) / 86400)::numeric, 1),
                      'max', pg_catalog.round(pg_catalog.max(extract(epoch from fc.appt_starts_at - fc.matched_at) / 86400)::numeric, 1))
                      from fc),
      'by_reason', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', g.name, 'count', g.n) order by g.n desc, g.name nulls last)
          from (select fc.reason_name as name, pg_catalog.count(*) as n from fc group by fc.reason_name) g), '[]'),
      'by_professional', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', g.professional_id, 'name', p.display_name, 'count', g.n)
                                    order by g.n desc, p.display_name nulls last, g.professional_id)
          from (select fc.professional_id, pg_catalog.count(*) as n from fc group by fc.professional_id) g
          left join pros p on p.professional_id = g.professional_id), '[]')),
    'waitlist', pg_catalog.jsonb_build_object(
      'open', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('target_kind', g.target_kind, 'id', g.target_id,
                                                                  'name', coalesce(p.display_name, t.name),
                                                                  'waiting', g.waiting, 'incomplete', g.incomplete, 'priority', g.priority)
                                    order by g.target_kind desc, g.waiting desc, coalesce(p.display_name, t.name) nulls last, g.target_id)
          from (select w.target_kind, w.target_id,
                       pg_catalog.count(distinct w.demande_id) filter (where w.state <> 'incomplete') as waiting,
                       pg_catalog.count(distinct w.demande_id) filter (where w.state = 'incomplete') as incomplete,
                       pg_catalog.count(distinct w.demande_id) filter (where w.priority = 'priority') as priority
                  from w where w.state <> 'closed' group by w.target_kind, w.target_id) g
          left join pros p on g.target_kind = 'professional' and p.professional_id = g.target_id
          left join titles t on g.target_kind = 'title' and t.title_id = g.target_id), '[]'),
      'waiting_total', (select pg_catalog.count(distinct w.demande_id) from w where w.state not in ('closed', 'incomplete')),
      'incomplete_total', (select pg_catalog.count(distinct w.demande_id) from w where w.state = 'incomplete'
                              and not exists (select 1 from w y where y.demande_id = w.demande_id and y.state not in ('closed', 'incomplete'))),
      'registered', (select pg_catalog.count(distinct w.demande_id) from w where w.registered_at >= v_bounds.starts_at and w.registered_at < v_bounds.ends_at),
      'exits', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reason', g.exit_reason, 'count', g.n) order by g.n desc, g.exit_reason)
          from (select w.exit_reason, pg_catalog.count(distinct w.demande_id) as n from w
                 where w.exited_at >= v_bounds.starts_at and w.exited_at < v_bounds.ends_at group by w.exit_reason) g), '[]'),
      'wait_days', (
        select pg_catalog.jsonb_build_object(
          'count', pg_catalog.count(*),
          'average', pg_catalog.round(pg_catalog.avg(extract(epoch from x.exited_at - x.registered_at) / 86400)::numeric, 1),
          'median', pg_catalog.round((pg_catalog.percentile_cont(0.5) within group (
                      order by extract(epoch from x.exited_at - x.registered_at) / 86400))::numeric, 1))
          -- One per request placed (its first registration, its placement).
          from (select w.demande_id, pg_catalog.min(w.registered_at) as registered_at, pg_catalog.max(w.exited_at) as exited_at
                  from w where w.exit_reason = 'placed' and w.exited_at >= v_bounds.starts_at and w.exited_at < v_bounds.ends_at
                 group by w.demande_id) x)),
    'places', pg_catalog.jsonb_build_object(
      'snapshot_on', (select last_day.d from last_day),
      'total_left', (select coalesce(pg_catalog.sum(cap.places_left), 0) from cap, last_day
                      where cap.snapshot_on = last_day.d and cap.places_declared is not null and cap.accepting_new_clients),
      'tracked', (select pg_catalog.count(*) from cap, last_day where cap.snapshot_on = last_day.d and cap.places_declared is not null),
      'by_professional', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', cap.professional_id, 'name', p.display_name, 'declared', cap.places_declared,
                                                                  'left', cap.places_left, 'accepting', cap.accepting_new_clients)
                                    order by p.display_name nulls last, cap.professional_id)
          from cap join last_day on cap.snapshot_on = last_day.d
          left join pros p on p.professional_id = cap.professional_id
         where cap.places_declared is not null), '[]'),
      'weeks', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('week_start', g.week_start, 'snapshot_on', g.d, 'total_left', g.total)
                                    order by g.week_start)
          from (select pg_catalog.date_trunc('week', f.d)::date as week_start, f.d,
                       (select coalesce(pg_catalog.sum(c2.places_left), 0) from cap c2
                         where c2.snapshot_on = f.d and c2.places_declared is not null and c2.accepting_new_clients) as total
                  from (select pg_catalog.min(cap.snapshot_on) as d from cap group by pg_catalog.date_trunc('week', cap.snapshot_on)) f) g), '[]'))
  ) into v_result;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- find_client_duplicates: at most 10 phones
-- -----------------------------------------------------------------------------
-- Latest body: 20261013022637_clients_duplicates.sql.
create or replace function public.find_client_duplicates(
  p_first text,
  p_last text,
  p_email text,
  p_phones text[],
  p_birthday date,
  p_exclude uuid default null
)
returns table (client_id uuid, level text, reasons text[], client_number int, display_name text,
               birthday date, email text, mobile_e164 text, is_archived boolean)
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
  return query
    select d.client_id, d.level, d.reasons, c.client_number, c.first_name || ' ' || c.last_name,
           c.birthday, c.email, c.mobile_e164, c.archived_at is not null
      from private.clients_find_duplicates(v_org, p_first, p_last, p_email, p_phones[1:10], p_birthday, p_exclude) d
      join public.clients c on c.id = d.client_id
     order by (d.level = 'high') desc, c.client_number
     limit 10;
end;
$$;

-- -----------------------------------------------------------------------------
-- search_clients: the query cut at 200 characters
-- -----------------------------------------------------------------------------
-- Latest body: 20261013022641_clients_rpcs.sql.
create or replace function public.search_clients(p_query text, p_limit int default 8)
returns table (id uuid, client_number int, first_name text, last_name text, birthday date, email text,
               mobile_e164 text, is_archived boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_staff boolean := private.has_permission('clients.view');
  v_self boolean := private.has_permission('clients.self');
  v_pro uuid := private.current_professional_id();
  v_words text[];
begin
  if not v_staff and not (v_self and v_pro is not null) then
    raise exception 'Permission refusée : clients.view' using errcode = '42501';
  end if;
  v_words := array(select w from pg_catalog.regexp_split_to_table(private.clients_name_form(pg_catalog.left(p_query, 200)), ' ') w where w <> '');
  if pg_catalog.cardinality(v_words) = 0 then
    return;
  end if;
  return query
    select c.id, c.client_number, c.first_name, c.last_name, c.birthday, c.email, c.mobile_e164, c.archived_at is not null
      from public.clients c
     where c.org_id = v_org
       and c.merged_into_id is null and c.anonymized_at is null
       and (v_staff or exists (select 1 from public.client_professional_links l where l.client_id = c.id and l.professional_id = v_pro))
       and not exists (
         select 1 from pg_catalog.unnest(v_words) w
          where not (pg_catalog.strpos(private.clients_name_form(c.first_name || ' ' || c.last_name), w) > 0
                     or pg_catalog.strpos(coalesce(c.email, ''), w) > 0
                     or c.client_number::text = w
                     or (pg_catalog.regexp_replace(w, '[^0-9]', '', 'g') ~ '^[0-9]{3,}$'
                         and pg_catalog.strpos(pg_catalog.regexp_replace(concat_ws(' ', c.mobile_e164, c.home_e164, c.work_e164), '[^0-9 ]', '', 'g'),
                                               pg_catalog.regexp_replace(w, '[^0-9]', '', 'g')) > 0)))
     order by (c.archived_at is not null), c.last_name, c.first_name, c.client_number
     limit least(greatest(coalesce(p_limit, 8), 1), 50);
end;
$$;

-- -----------------------------------------------------------------------------
-- list_clients: the query cut at 200 characters
-- -----------------------------------------------------------------------------
-- Latest body: 20261014021940_clients_list_last_visit.sql.
create or replace function public.list_clients(
  p_query text default null,
  p_status text default 'active',
  p_professional_id uuid default null,
  p_tag_id uuid default null,
  p_after_last text default null,
  p_after_first text default null,
  p_after_id uuid default null,
  p_limit int default 50,
  p_sort text default 'name',
  p_last_visit text default null,
  p_after_visit timestamptz default null
)
returns table (id uuid, client_number int, first_name text, last_name text, birthday date, email text,
               mobile_e164 text, primary_professional_id uuid, is_archived boolean, tag_ids uuid[],
               rate_variant text, tax_exempt boolean, is_banned boolean, file_incomplete boolean,
               special_agreement boolean, sort_last text, sort_first text, last_visit_at timestamptz,
               sort_visit timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_words text[];
  v_visits boolean := private.has_permission('appointments.view');
  v_sort text := coalesce(p_sort, 'name');
  v_tz text;
  v_today date;
begin
  if not private.has_permission('clients.view') then
    raise exception 'Permission refusée : clients.view' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'archived', 'all') then
    raise exception 'État inconnu : %', p_status using errcode = '22023';
  end if;
  if v_sort not in ('name', 'visit_recent', 'visit_oldest') then
    raise exception 'Tri inconnu : %', p_sort using errcode = '22023';
  end if;
  if p_last_visit is not null and p_last_visit not in ('within_30', 'within_90', 'over_90', 'over_180', 'over_365', 'never') then
    raise exception 'Filtre inconnu : %', p_last_visit using errcode = '22023';
  end if;
  if not v_visits and (v_sort <> 'name' or p_last_visit is not null) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  select o.timezone into v_tz from public.organizations o where o.id = v_org;
  v_tz := coalesce(v_tz, 'America/Toronto');
  v_today := (pg_catalog.now() at time zone v_tz)::date;
  v_words := array(select w from pg_catalog.regexp_split_to_table(private.clients_name_form(pg_catalog.left(p_query, 200)), ' ') w where w <> '');
  return query
    with visits as (
      select v.client_id, v.last_at from private.appointments_last_visits(v_org) v where v_visits
    ), page as (
      select c.*, private.clients_name_form(c.last_name) as s_last, private.clients_name_form(c.first_name) as s_first,
             vi.last_at,
             case v_sort when 'visit_recent' then coalesce(vi.last_at, '-infinity'::timestamptz)
                         when 'visit_oldest' then coalesce(vi.last_at, 'infinity'::timestamptz) end as s_visit
        from public.clients c
        left join visits vi on vi.client_id = c.id
       where c.org_id = v_org
         and c.merged_into_id is null and c.anonymized_at is null
         and (p_status = 'all' or (p_status = 'active') = (c.archived_at is null))
         and (p_professional_id is null or c.primary_professional_id = p_professional_id)
         and (p_tag_id is null or exists (select 1 from public.client_tag_links l where l.client_id = c.id and l.tag_id = p_tag_id))
         and (p_last_visit is null
              or (p_last_visit = 'never' and vi.last_at is null)
              or (p_last_visit = 'within_30' and vi.last_at >= ((v_today - 30)::timestamp at time zone v_tz))
              or (p_last_visit = 'within_90' and vi.last_at >= ((v_today - 90)::timestamp at time zone v_tz))
              or (p_last_visit = 'over_90' and vi.last_at < ((v_today - 90)::timestamp at time zone v_tz))
              or (p_last_visit = 'over_180' and vi.last_at < ((v_today - 180)::timestamp at time zone v_tz))
              or (p_last_visit = 'over_365' and vi.last_at < ((v_today - 365)::timestamp at time zone v_tz)))
         and not exists (
           select 1 from pg_catalog.unnest(v_words) w
            where not (pg_catalog.strpos(private.clients_name_form(c.first_name || ' ' || c.last_name), w) > 0
                       or pg_catalog.strpos(coalesce(c.email, ''), w) > 0
                       or c.client_number::text = w
                       or (pg_catalog.regexp_replace(w, '[^0-9]', '', 'g') ~ '^[0-9]{3,}$'
                           and pg_catalog.strpos(pg_catalog.regexp_replace(concat_ws(' ', c.mobile_e164, c.home_e164, c.work_e164), '[^0-9 ]', '', 'g'),
                                                 pg_catalog.regexp_replace(w, '[^0-9]', '', 'g')) > 0)))
    )
    select p.id, p.client_number, p.first_name, p.last_name, p.birthday, p.email, p.mobile_e164,
           p.primary_professional_id, p.archived_at is not null,
           coalesce((select array_agg(l.tag_id order by l.created_at) from public.client_tag_links l where l.client_id = p.id), '{}'),
           p.rate_variant, p.tax_exempt, p.is_banned, p.file_incomplete, p.special_agreement, p.s_last, p.s_first,
           p.last_at, p.s_visit
      from page p
     where p_after_id is null
        or (v_sort = 'name' and (p.s_last, p.s_first, p.id) > (coalesce(p_after_last, ''), coalesce(p_after_first, ''), p_after_id))
        or (v_sort = 'visit_recent' and (p.s_visit < p_after_visit
              or (p.s_visit = p_after_visit and (p.s_last, p.s_first, p.id) > (coalesce(p_after_last, ''), coalesce(p_after_first, ''), p_after_id))))
        or (v_sort = 'visit_oldest' and (p.s_visit > p_after_visit
              or (p.s_visit = p_after_visit and (p.s_last, p.s_first, p.id) > (coalesce(p_after_last, ''), coalesce(p_after_first, ''), p_after_id))))
     order by case when v_sort = 'visit_recent' then p.s_visit end desc,
              case when v_sort = 'visit_oldest' then p.s_visit end asc,
              p.s_last, p.s_first, p.id
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
