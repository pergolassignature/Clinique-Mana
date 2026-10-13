-- =============================================================================
-- Clients: the GOrendezvous import (plan §9, batch I1)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §9 (I1)
-- Decisions: I-1 … I-6 (the readers), I-7 … I-12 (this batch), CL-1 … CL-18, R-7
--
-- The terminal script `scripts/import-gorendezvous.mjs` signs in as the person running it (as
-- `import-professionals.mjs`: never a service key) and sends one row at a time:
-- - `import_client(row, dry_run)`: one client file, with what GOrendezvous held for it (the fields
--   C2's form checks, the archived state, the primary professional, the free tags, the main
--   insurance). The file's GOrendezvous id is `external_ref` (« gorendezvous:<ClientId> », unique per
--   clinic): a file already imported comes back `skipped`, so a run can be resumed. Unlike
--   `create_client`, a duplicate is never refused: GOrendezvous holds duplicates the clinic merges
--   afterwards (« Fusionner »), so each row is imported and its possible duplicates are returned
--   (level and file number, never a name). A dry run does everything and rolls it back.
-- - `import_client_relation(row, dry_run)`: a relation between two imported files, named by their
--   external refs, through C2's `set_client_relation`.
-- - A file anonymised after its import (Loi 25) keeps a one-way tombstone instead of its reference
--   (trigger `clients_import_tombstone`): a later run finds it and never re-creates the person.
-- Both need clients.manage and clients.merge (whoever imports also resolves the duplicates), run
-- with the audit source `import`, and answer {status: ok | skipped | error, …}; a row error is a
-- French message with the field, never a value.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_import', true);

-- -----------------------------------------------------------------------------
-- Anonymised files stay anonymised (Loi 25)
-- -----------------------------------------------------------------------------
-- C2's anonymisation blanks external_ref. Before it does, this trigger keeps a one-way tombstone in
-- its place (« anon: » and the SHA-256 of the reference, base64): no GOrendezvous id remains, and a
-- later import of the same export finds the tombstone and never re-creates the person.
create function private.clients_import_tombstone_ref(p_ref text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'anon:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_ref, 'UTF8')), 'base64')
$$;
revoke all on function private.clients_import_tombstone_ref(text) from public, anon, authenticated, service_role;

create function private.clients_import_tombstone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.anonymized_at is not null and old.anonymized_at is null and old.external_ref is not null
     and new.external_ref is null and old.external_ref !~ '^anon:' then
    new.external_ref := private.clients_import_tombstone_ref(old.external_ref);
  end if;
  return new;
end;
$$;
revoke all on function private.clients_import_tombstone() from public, anon, authenticated, service_role;
create trigger clients_import_tombstone before update of anonymized_at on public.clients
  for each row execute function private.clients_import_tombstone();

-- Checks the import's permissions (both: the one who imports merges the duplicates).
create function private.clients_import_assert()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  if not private.has_permission('clients.merge') then
    raise exception 'Permission refusée : clients.merge' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.clients_import_assert() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- One client file
-- -----------------------------------------------------------------------------
-- p_row: the fields of create_client's JSON (first_name, last_name, sex, birthday, email,
-- mobile_e164, home_e164, work_e164, work_ext, language, address_line1, address_line2, city,
-- province, postal_code, country, referred_by, primary_professional_id, rate_variant, tax_exempt,
-- is_banned, file_incomplete, special_agreement), plus external_ref (required), archived
-- (boolean), special_agreement_note, tags (≤ 5 names: the clinic's tag of that name, created when
-- missing) and insurance ({insurer, policy_number, certificate_number, holder_relation,
-- holder_name}: the main one). Returns {status, dry_run, id, client_number, duplicates: [{level,
-- client_number}], tags_created / tags_reactivated (the clinic's tags added, or archived ones put
-- back), errors: [{field, message}]}; `skipped` for a file already imported, or anonymised since.
create function public.import_client(p_row jsonb, p_dry_run boolean default true)
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
revoke all on function public.import_client(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_client(jsonb, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- One relation between two imported files
-- -----------------------------------------------------------------------------
-- p_row: {client_ref, related_ref, type (what the related person is to the client: parent, child,
-- guardian, ward, spouse, sibling, other), related_rights, client_rights} (the objects of
-- set_client_relation). Returns {status: ok | skipped | error, dry_run, errors}; `skipped` when the
-- pair is already related.
create function public.import_client_relation(p_row jsonb, p_dry_run boolean default true)
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
revoke all on function public.import_client_relation(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_client_relation(jsonb, boolean) to authenticated;
