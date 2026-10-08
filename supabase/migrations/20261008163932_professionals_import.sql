-- =============================================================================
-- Professionnels: import of the existing professionals, one row at a time, dry run by default
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.19 (P4-20, P4-120–P4-125)
-- Runbook: docs/runbooks/import-professionals.md (scripts/import-professionals.mjs calls it)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * One RPC, import_professional(row, dry_run = true). It writes through the module's own RPCs
--   (create_professional, set_professional_professions / _languages / _clienteles /
--   _specialties / _motifs, set_professional_payer_number, activate_professional) and the plain
--   column update the record's « Coordonnées » card makes, so guards, HINTs, readiness and the
--   audit trail are the app's. It is SECURITY INVOKER (P4-121): it adds no privilege, the plain
--   update goes through the column grants and RLS like the card's, and every write is checked by
--   the RPC that makes it. The audit source is `import` (« L'importation » in Historique, P4-104);
--   the actor is the person who runs it.
-- * Data errors never raise: {status: 'error', errors: [{field, message}]}, every error of the row
--   at once (P4-122). Fields are the client schemas' names (firstName, lastName, email,
--   personalPhone, city, province, postalCode, yearsExperience, ivac), professions.<i>.titleId /
--   .licenceNumber like the professions editor, the import keys for the sets (languages,
--   clienteles, approaches, motifs), activate, or null for the whole row. Keys are resolved first
--   (« Motif inconnu : anxite »); then every write step runs in its own sub-block, so a refusal
--   of one step (a licence, an IVAC number) is reported with the others. A step whose input
--   failed is skipped, and so are motifs when the titles failed (a restricted motif would only
--   repeat it). Contract errors (not an object, an unknown key, a wrong JSON type) are 22023 and
--   permissions 42501: those are the caller's bugs, not the row's data.
-- * A row is all or nothing: create, sets, IVAC number and activation run in one sub-block, which
--   ends with a caught exception (SQLSTATE IMPRB) for a dry run or when any step failed. Nothing
--   persists then; the only trace is audit_log's identity sequence, which skips the numbers the
--   rolled-back rows took (ids are only ever compared, never counted; pgTAP 048 checks that no
--   other sequence moves).
-- * Re-runs are idempotent: an email the clinic's professionals already use is `skipped`
--   (« Courriel déjà présent »), whatever the rest of the row says (P4-123). An address used only
--   by a staff profile stays an error on email (create_professional's own check, P4-34).
-- * Permissions: professionals.manage, .matching and .view (what the writes and the readiness read
--   need), and professionals.activate_override whenever the row asks for activation (P4-124, the
--   plan's rule): an import activates « Dossier complété hors application » with the override
--   reason, which activate_professional drops for a complete file.
-- * Values typed the way the forms accept them: phone (514 555-0101, 1-514-…, +1 …) → E.164,
--   postal code (h2x-1y4) → H2X 1Y4, province upper-cased, keys and codes trimmed and lower-cased.
--   Messages are the forms' (src/shared/lib/field-schemas.ts, schemas/identity.ts). An unknown
--   value is quoted unless it looks personal (an @, or 4 digits in a row: « (valeur masquée) »),
--   at most 3 per message (« … et 4 autres »), so a report never lists a wall of keys.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_import', true);

-- -----------------------------------------------------------------------------
-- Contract of a row (22023 for anything the import script would never send)
-- -----------------------------------------------------------------------------
create function private.import_professional_check(p_row jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object' then
    raise exception 'Ligne invalide : objet JSON attendu.' using errcode = '22023';
  end if;
  select k into v_key from pg_catalog.jsonb_object_keys(p_row) as k
   where k <> all (array['first_name', 'last_name', 'email', 'personal_phone', 'city', 'province', 'postal_code',
                         'years_experience', 'professions', 'languages', 'clienteles', 'approaches', 'motifs',
                         'ivac', 'activate'])
   limit 1;
  if v_key is not null then
    raise exception 'Clé inconnue : %', v_key using errcode = '22023';
  end if;
  select k into v_key from pg_catalog.unnest(array['first_name', 'last_name', 'email', 'personal_phone', 'city',
                                                   'province', 'postal_code', 'ivac']) as k
   where pg_catalog.jsonb_typeof(p_row -> k) not in ('string', 'null')
   limit 1;
  if v_key is not null then
    raise exception 'Texte attendu : %', v_key using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_row -> 'years_experience') not in ('number', 'null') then
    raise exception 'Nombre attendu : years_experience' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_row -> 'activate') not in ('boolean', 'null') then
    raise exception 'Booléen attendu : activate' using errcode = '22023';
  end if;
  -- Lists: arrays of at most 500 items (no reference list holds more).
  select k into v_key from pg_catalog.unnest(array['professions', 'languages', 'clienteles', 'approaches', 'motifs']) as k
   where pg_catalog.jsonb_typeof(p_row -> k) not in ('array', 'null')
      or (pg_catalog.jsonb_typeof(p_row -> k) = 'array' and pg_catalog.jsonb_array_length(p_row -> k) > 500)
   limit 1;
  if v_key is not null then
    raise exception 'Liste de 500 éléments au plus attendue : %', v_key using errcode = '22023';
  end if;
  -- Items: CASE keeps jsonb_object_keys away from a non-object (OR does not order its operands).
  if exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(nullif(p_row -> 'professions', 'null'), '[]')) as e(v)
              where case when pg_catalog.jsonb_typeof(e.v) <> 'object' then true
                         else exists (select 1 from pg_catalog.jsonb_object_keys(e.v) as k
                                       where k <> all (array['title_key', 'licence_number', 'is_primary']))
                              or pg_catalog.jsonb_typeof(e.v -> 'title_key') is distinct from 'string'
                              or pg_catalog.jsonb_typeof(e.v -> 'licence_number') not in ('string', 'null')
                              or pg_catalog.jsonb_typeof(e.v -> 'is_primary') not in ('boolean', 'null') end) then
    raise exception 'Titre invalide : {"title_key": texte, "licence_number": texte, "is_primary": booléen} attendu.'
      using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.unnest(array['clienteles', 'approaches']) as k,
                           pg_catalog.jsonb_array_elements(coalesce(nullif(p_row -> k, 'null'), '[]')) as e(v)
              where case when pg_catalog.jsonb_typeof(e.v) <> 'object' then true
                         else exists (select 1 from pg_catalog.jsonb_object_keys(e.v) as ok where ok <> all (array['key', 'specialized']))
                              or pg_catalog.jsonb_typeof(e.v -> 'key') is distinct from 'string'
                              or pg_catalog.jsonb_typeof(e.v -> 'specialized') not in ('boolean', 'null') end) then
    raise exception 'Élément invalide : {"key": texte, "specialized": booléen} attendu.' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.unnest(array['languages', 'motifs']) as k,
                           pg_catalog.jsonb_array_elements(coalesce(nullif(p_row -> k, 'null'), '[]')) as e(v)
              where pg_catalog.jsonb_typeof(e.v) <> 'string') then
    raise exception 'Liste de clés (textes) attendue.' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Messages about values the clinic does not know
-- -----------------------------------------------------------------------------
-- « Motif inconnu : anxite », « Motifs inconnus : a, b et c », « Motifs inconnus : a, b, c et
-- 4 autres ». Distinct values in order of appearance; one that looks personal (an @, 4 digits in a
-- row: an address or a number typed in the wrong column) reads « (valeur masquée) ».
create function private.import_unknown_message(p_one text, p_many text, p_values text[])
returns text
language sql
immutable
set search_path = ''
as $$
  with v as (
    select case when pg_catalog.btrim(x.value) = '' then '(vide)'
                when x.value ~ '@' or x.value ~ '[0-9]{4}' then '(valeur masquée)'
                else pg_catalog.left(x.value, 60) end as label,
           pg_catalog.row_number() over (order by x.first_ord) as n,
           count(*) over () as total
      from (select u.value, min(u.ord) as first_ord
              from pg_catalog.unnest(p_values) with ordinality as u(value, ord)
             group by u.value) x
  )
  select case
           when max(v.total) = 1 then p_one || ' : ' || max(v.label)
           when max(v.total) <= 3 then p_many || ' : ' || pg_catalog.string_agg(v.label, ', ' order by v.n) filter (where v.n < v.total)
                                       || ' et ' || max(v.label) filter (where v.n = v.total)
           else p_many || ' : ' || pg_catalog.string_agg(v.label, ', ' order by v.n) filter (where v.n <= 3)
                || ' et ' || (max(v.total) - 3) || ' autres'
         end
    from v
$$;

-- -----------------------------------------------------------------------------
-- The record's plain fields, as the « Coordonnées » and « Expérience » cards check them
-- -----------------------------------------------------------------------------
-- {"values": {personal_phone, city, province, postal_code, years_experience}, "errors": [...]}.
-- Absent or blank → null (province: null keeps the column default, QC). The bracket classes
-- below hold a hyphen, an en dash (U+2013) and an em dash (U+2014), as the forms accept them.
create function private.import_professional_contact(p_row jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_errors jsonb := '[]';
  v_phone text := nullif(pg_catalog.btrim(p_row ->> 'personal_phone', E' \t\r\n'), '');
  v_digits text;
  v_city text := nullif(pg_catalog.btrim(p_row ->> 'city', E' \t\r\n'), '');
  v_province text := nullif(pg_catalog.upper(pg_catalog.btrim(p_row ->> 'province', E' \t\r\n')), '');
  v_postal text := nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_row ->> 'postal_code', ''), '[[:space:]–—-]', '', 'g')), '');
  v_years numeric := (p_row ->> 'years_experience')::numeric;
  v_years_int int;
begin
  -- parsePhone (src/shared/lib/format.ts): digits and the usual separators; 10 digits, or 11 led
  -- by 1; with a leading +, exactly +1 and 10 digits.
  if v_phone is not null then
    v_digits := pg_catalog.regexp_replace(v_phone, '[^0-9]', '', 'g');
    if v_phone !~ '^\+?[0-9[:space:]().–—-]+$' then
      v_phone := null;
    elsif pg_catalog.left(v_phone, 1) = '+' then
      v_phone := case when pg_catalog.length(v_digits) = 11 and pg_catalog.left(v_digits, 1) = '1' then '+' || v_digits end;
    elsif pg_catalog.length(v_digits) = 10 then
      v_phone := '+1' || v_digits;
    elsif pg_catalog.length(v_digits) = 11 and pg_catalog.left(v_digits, 1) = '1' then
      v_phone := '+' || v_digits;
    else
      v_phone := null;
    end if;
    if v_phone is null then
      v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'personalPhone', 'message', 'Numéro à 10 chiffres.');
    end if;
  end if;
  if pg_catalog.char_length(v_city) > 100 then
    v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'city', 'message', '100 caractères maximum.');
  end if;
  if v_province is not null and v_province <> all (array['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']) then
    v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'province', 'message', 'Province invalide.');
  end if;
  if v_postal is not null then
    v_postal := case when pg_catalog.length(v_postal) = 6 then pg_catalog.left(v_postal, 3) || ' ' || pg_catalog.right(v_postal, 3) else v_postal end;
    if v_postal !~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$' then
      v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'postalCode', 'message', 'Code postal invalide (ex. : H2X 1Y4).');
    end if;
  end if;
  if v_years is not null and (v_years <> pg_catalog.trunc(v_years) or v_years not between 0 and 60) then
    v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'yearsExperience', 'message', 'Entre 0 et 60 ans.');
  else
    v_years_int := v_years;   -- 12.0 → 12
  end if;
  return pg_catalog.jsonb_build_object(
    'values', pg_catalog.jsonb_build_object('personal_phone', v_phone, 'city', v_city, 'province', v_province,
                                            'postal_code', v_postal, 'years_experience', v_years_int),
    'errors', v_errors);
end;
$$;

-- -----------------------------------------------------------------------------
-- Keys → the clinic's ids, ready for the set RPCs
-- -----------------------------------------------------------------------------
-- {"professions": [{title_id, licence_number, is_primary}] | null, "language_ids": [...] | null,
--  "clienteles": [{id, specialized}] | null, "specialties": [...] | null, "motif_ids": [...] | null,
--  "errors": [...]}. A list that is absent or empty is null (nothing to set: French stays, from
-- create_professional); a list with an unknown key is null too, with its error. Archived rows are
-- resolved: the set RPCs refuse them with their own message. Blank keys are ignored. Security
-- invoker: the caller's RLS reads the lists (any professionals key may read them).
create function private.import_professional_sets(p_org uuid, p_row jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_errors jsonb := '[]';
  v_out jsonb := '{}';
  v_list jsonb;
  v_unknown text[];
  v_index bigint;
begin
  -- Titles: one error per unknown title, under its row (titre_1, titre_2).
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('title_id', t.id, 'licence_number', e.v ->> 'licence_number',
                                                             'is_primary', e.v -> 'is_primary') order by e.ord),
         min(e.ord) filter (where t.id is null)
    into v_list, v_index
    from pg_catalog.jsonb_array_elements(coalesce(nullif(p_row -> 'professions', 'null'), '[]')) with ordinality as e(v, ord)
    left join public.profession_titles t
      on t.org_id = p_org and t.key = pg_catalog.lower(pg_catalog.btrim(e.v ->> 'title_key', E' \t\r\n'));
  if v_index is not null then
    select v_errors || pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'field', 'professions.' || (e.ord - 1) || '.titleId',
             'message', private.import_unknown_message('Titre inconnu', 'Titres inconnus', array[e.v ->> 'title_key'])) order by e.ord)
      into v_errors
      from pg_catalog.jsonb_array_elements(p_row -> 'professions') with ordinality as e(v, ord)
     where not exists (select 1 from public.profession_titles t
                        where t.org_id = p_org and t.key = pg_catalog.lower(pg_catalog.btrim(e.v ->> 'title_key', E' \t\r\n')));
  elsif v_list is not null then
    v_out := v_out || pg_catalog.jsonb_build_object('professions', v_list);
  end if;

  -- Languages (ISO codes).
  select pg_catalog.jsonb_agg(l.id order by e.ord) filter (where l.id is not null),
         pg_catalog.array_agg(e.k order by e.ord) filter (where l.id is null)
    into v_list, v_unknown
    from pg_catalog.jsonb_array_elements_text(coalesce(nullif(p_row -> 'languages', 'null'), '[]')) with ordinality as e(k, ord)
    left join public.languages l on l.org_id = p_org and l.code = pg_catalog.lower(pg_catalog.btrim(e.k, E' \t\r\n'))
   where pg_catalog.btrim(e.k, E' \t\r\n') <> '';
  if v_unknown is not null then
    v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'languages',
      'message', private.import_unknown_message('Langue inconnue', 'Langues inconnues', v_unknown));
  elsif v_list is not null then
    v_out := v_out || pg_catalog.jsonb_build_object('language_ids', v_list);
  end if;

  -- Clientèles, with their « spécialisé » star.
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'specialized', coalesce((e.v ->> 'specialized')::boolean, false))
                              order by e.ord) filter (where c.id is not null),
         pg_catalog.array_agg(e.v ->> 'key' order by e.ord) filter (where c.id is null)
    into v_list, v_unknown
    from pg_catalog.jsonb_array_elements(coalesce(nullif(p_row -> 'clienteles', 'null'), '[]')) with ordinality as e(v, ord)
    left join public.clienteles c on c.org_id = p_org and c.key = pg_catalog.lower(pg_catalog.btrim(e.v ->> 'key', E' \t\r\n'))
   where pg_catalog.btrim(e.v ->> 'key', E' \t\r\n') <> '';
  if v_unknown is not null then
    v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'clienteles',
      'message', private.import_unknown_message('Clientèle inconnue', 'Clientèles inconnues', v_unknown));
  elsif v_list is not null then
    v_out := v_out || pg_catalog.jsonb_build_object('clienteles', v_list);
  end if;

  -- Approaches (the specialties table), with their star.
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'specialized', coalesce((e.v ->> 'specialized')::boolean, false))
                              order by e.ord) filter (where s.id is not null),
         pg_catalog.array_agg(e.v ->> 'key' order by e.ord) filter (where s.id is null)
    into v_list, v_unknown
    from pg_catalog.jsonb_array_elements(coalesce(nullif(p_row -> 'approaches', 'null'), '[]')) with ordinality as e(v, ord)
    left join public.specialties s on s.org_id = p_org and s.key = pg_catalog.lower(pg_catalog.btrim(e.v ->> 'key', E' \t\r\n'))
   where pg_catalog.btrim(e.v ->> 'key', E' \t\r\n') <> '';
  if v_unknown is not null then
    v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'approaches',
      'message', private.import_unknown_message('Approche inconnue', 'Approches inconnues', v_unknown));
  elsif v_list is not null then
    v_out := v_out || pg_catalog.jsonb_build_object('specialties', v_list);
  end if;

  -- Motifs.
  select pg_catalog.jsonb_agg(m.id order by e.ord) filter (where m.id is not null),
         pg_catalog.array_agg(e.k order by e.ord) filter (where m.id is null)
    into v_list, v_unknown
    from pg_catalog.jsonb_array_elements_text(coalesce(nullif(p_row -> 'motifs', 'null'), '[]')) with ordinality as e(k, ord)
    left join public.motifs m on m.org_id = p_org and m.key = pg_catalog.lower(pg_catalog.btrim(e.k, E' \t\r\n'))
   where pg_catalog.btrim(e.k, E' \t\r\n') <> '';
  if v_unknown is not null then
    v_errors := v_errors || pg_catalog.jsonb_build_object('field', 'motifs',
      'message', private.import_unknown_message('Motif inconnu', 'Motifs inconnus', v_unknown));
  elsif v_list is not null then
    v_out := v_out || pg_catalog.jsonb_build_object('motif_ids', v_list);
  end if;

  return v_out || pg_catalog.jsonb_build_object('errors', v_errors);
end;
$$;

-- -----------------------------------------------------------------------------
-- The writes: the app's RPCs, one sub-block per step
-- -----------------------------------------------------------------------------
-- Runs inside import_professional's sub-block, which rolls everything back for a dry run or when
-- `errors` is not empty. Each step's P0001 (the messages users read) becomes an error on the
-- field its HINT names; any other error is a bug and propagates. Returns the new id (null when
-- creation failed), the errors of the steps, the readiness (complete, missing: the keys of
-- every missing item, as get_professional_readiness lists them) and whether it activated.
create function private.import_professional_apply(
  p_row jsonb, p_contact jsonb, p_sets jsonb, p_activate boolean,
  out id uuid, out errors jsonb, out complete boolean, out missing jsonb, out activated boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_message text;
  v_hint text;
  v_detail text;
  v_titles_failed boolean := false;
  v_readiness jsonb;
begin
  errors := '[]';
  activated := false;
  begin
    id := public.create_professional(p_row ->> 'first_name', p_row ->> 'last_name', p_row ->> 'email');
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
    errors := errors || pg_catalog.jsonb_build_object('field',
      case v_hint when 'first_name' then 'firstName' when 'last_name' then 'lastName' when 'email' then 'email' end,
      'message', v_message);
    return;
  end;

  -- The plain fields, as the cards write them (column grants, RLS), once they are all valid.
  if p_contact -> 'errors' = '[]' and exists (select 1 from pg_catalog.jsonb_each(p_contact -> 'values') as v where v.value <> 'null') then
    update public.professionals p
       set personal_phone = p_contact -> 'values' ->> 'personal_phone',
           city = p_contact -> 'values' ->> 'city',
           province = coalesce(p_contact -> 'values' ->> 'province', p.province),
           postal_code = p_contact -> 'values' ->> 'postal_code',
           years_experience = (p_contact -> 'values' ->> 'years_experience')::smallint
     where p.id = import_professional_apply.id;
  end if;

  if p_sets ? 'professions' then
    begin
      perform public.set_professional_professions(id, p_sets -> 'professions');
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      v_titles_failed := true;
      -- HINT title / licence with DETAIL = the title id: under that title's row (the last one
      -- holding it, like the editor), else about the titles as a whole.
      errors := errors || pg_catalog.jsonb_build_object('field', coalesce(
        (select 'professions.' || (max(e.ord) - 1) || case v_hint when 'title' then '.titleId' else '.licenceNumber' end
           from pg_catalog.jsonb_array_elements(p_sets -> 'professions') with ordinality as e(v, ord)
          where v_hint in ('title', 'licence') and e.v ->> 'title_id' = v_detail
         having max(e.ord) is not null),
        'professions'), 'message', v_message);
    end;
  end if;

  if p_sets ? 'language_ids' then
    begin
      perform public.set_professional_languages(id, array(select pg_catalog.jsonb_array_elements_text(p_sets -> 'language_ids')::uuid));
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      errors := errors || pg_catalog.jsonb_build_object('field', 'languages', 'message', v_message);
    end;
  end if;

  if p_sets ? 'clienteles' then
    begin
      perform public.set_professional_clienteles(id, p_sets -> 'clienteles');
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      errors := errors || pg_catalog.jsonb_build_object('field', 'clienteles', 'message', v_message);
    end;
  end if;

  if p_sets ? 'specialties' then
    begin
      perform public.set_professional_specialties(id, p_sets -> 'specialties');
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      errors := errors || pg_catalog.jsonb_build_object('field', 'approaches', 'message', v_message);
    end;
  end if;

  -- Restricted motifs depend on the titles: after a refused title they would only repeat it.
  if p_sets ? 'motif_ids' and not v_titles_failed then
    begin
      perform public.set_professional_motifs(id, array(select pg_catalog.jsonb_array_elements_text(p_sets -> 'motif_ids')::uuid));
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      errors := errors || pg_catalog.jsonb_build_object('field', 'motifs', 'message', v_message);
    end;
  end if;

  if nullif(pg_catalog.btrim(p_row ->> 'ivac', E' \t\r\n'), '') is not null then
    begin
      perform public.set_professional_payer_number(id, 'ivac', p_row ->> 'ivac');
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      errors := errors || pg_catalog.jsonb_build_object('field', 'ivac', 'message', v_message);
    end;
  end if;

  v_readiness := public.get_professional_readiness(id);
  complete := coalesce((v_readiness ->> 'complete')::boolean, false);
  missing := coalesce(pg_catalog.jsonb_path_query_array(v_readiness, '$.items[*].missing[*]'), '[]');

  if p_activate and errors = '[]' then
    begin
      perform public.activate_professional(id, 'Dossier complété hors application');
      activated := true;
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      errors := errors || pg_catalog.jsonb_build_object('field', 'activate', 'message', v_message);
    end;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- import_professional
-- -----------------------------------------------------------------------------
-- p_row: {first_name, last_name, email, personal_phone?, city?, province?, postal_code?,
-- years_experience?, professions?: [{title_key, licence_number?, is_primary?}], languages?: [code],
-- clienteles?: [{key, specialized?}], approaches?: [{key, specialized?}], motifs?: [key], ivac?,
-- activate?}. Returns {status: ok | skipped | error, dry_run, id, …}: ok adds activated, complete
-- and missing (what the real run does or did), skipped adds reason, error adds errors.
create function public.import_professional(p_row jsonb, p_dry_run boolean default true)
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
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
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
  perform private.import_professional_check(p_row);
  v_activate := coalesce((p_row ->> 'activate')::boolean, false);
  if v_activate and not private.has_permission('professionals.activate_override') then
    raise exception 'Permission refusée : professionals.activate_override' using errcode = '42501';
  end if;

  -- Idempotent re-runs: the clinic already has this professional (email as private.professional_email stores it).
  select p.id into v_existing from public.professionals p
   where p.org_id = v_org and p.email = pg_catalog.lower(pg_catalog.btrim(coalesce(p_row ->> 'email', ''), E' \t\r\n'));
  if v_existing is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', v_existing, 'reason', 'Courriel déjà présent');
  end if;

  v_contact := private.import_professional_contact(p_row);
  v_sets := private.import_professional_sets(v_org, p_row);

  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    select * into v_result from private.import_professional_apply(p_row, v_contact, v_sets, v_activate);
    v_errors := (v_contact -> 'errors') || (v_sets -> 'errors') || v_result.errors;
    if v_dry or v_errors <> '[]' then
      raise exception 'import_professional: rollback' using errcode = 'IMPRB';
    end if;
  exception when sqlstate 'IMPRB' then
    null;  -- everything the block wrote is rolled back; v_result and v_errors keep their values
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
-- Privileges. The function is SECURITY INVOKER: its helpers run as the caller, so the caller may
-- execute them (they are in private, which the API does not expose). service_role: none.
-- -----------------------------------------------------------------------------
revoke all on function
  private.import_professional_check(jsonb),
  private.import_unknown_message(text, text, text[]),
  private.import_professional_contact(jsonb),
  private.import_professional_sets(uuid, jsonb),
  private.import_professional_apply(jsonb, jsonb, jsonb, boolean),
  public.import_professional(jsonb, boolean)
from public, anon, authenticated, service_role;
grant execute on function
  private.import_professional_check(jsonb),
  private.import_unknown_message(text, text, text[]),
  private.import_professional_contact(jsonb),
  private.import_professional_sets(uuid, jsonb),
  private.import_professional_apply(jsonb, jsonb, jsonb, boolean),
  public.import_professional(jsonb, boolean)
to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
