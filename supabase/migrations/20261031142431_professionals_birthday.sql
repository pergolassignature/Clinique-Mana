-- =============================================================================
-- Professionnels: the professional's birthday, in the agenda, with a morning notice (P4-564)
-- =============================================================================
-- Jonathan, « Suivi - application » of 22 October 2026, on « Étape 2 sur 12 — Profil
-- professionnel »: « Ajouter : Date anniversaire à cette section et s'assurer que la date
-- s'affiche dans le calendrier avec une notification pour l'administration ».
-- Needs:   *_professionals_core.sql, *_professionals_onboarding.sql,
--          *_professionals_approaches.sql (the latest bodies of the four questionnaire functions
--          replaced below), Phase 3 jobs and notifications.
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6, §9.
--
-- Key choices
-- * **A day of the year, not a date of birth.** `professionals.birthday` is « MM-DD » text: the
--   clinic marks the day and has no use for an age, so the year is never asked (Loi 25: collect
--   only what the purpose needs). It also keeps the field out of every date-only and timezone
--   rule (CLAUDE.md §9). A check refuses an impossible day.
-- * **Personal, so redacted from the journal** like the phone and the address.
-- * In « Profil professionnel », optional: it never holds a questionnaire back.
-- * **The agenda** reads `professional_birthdays(from, to)` (`professionals.view`; active
--   professionals; 29 February is marked on the 28th outside a leap year). Staff only: « Mon
--   agenda » does not show colleagues' birthdays.
-- * **The notice**: job `professionals.birthday_notice` (function professionals-birthday-notice),
--   07:00 clinic time, off until « Tâches planifiées » switches it on, like every business job.
--   One notice per professional and day (`professionals.manage`, normal, kept two days,
--   deduplicated: a second run the same day adds nothing).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_birthday', true);

alter table public.professionals add column birthday text;
comment on column public.professionals.birthday is
  'The day of the year, « MM-DD » (P4-564): never a year, the clinic marks the day.';
alter table public.professionals add constraint professionals_birthday_check check (
  birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' and birthday !~ '^(02-3[01]|(04|06|09|11)-31)$');

-- Redacted in the journal like the other personal columns.
drop trigger professionals_audit on public.professionals;
create trigger professionals_audit after insert or update or delete on public.professionals
  for each row execute function private.audit_trigger('personal_phone', 'address_line1', 'address_line2', 'city',
                                                      'postal_code', 'gender', 'birthday');

-- -----------------------------------------------------------------------------
-- The questionnaire: one more field in « Profil professionnel »
-- -----------------------------------------------------------------------------
-- Latest body: *_professionals_approaches.sql. `birthday` follows `years_experience`; the ords
-- after it move up by one (nothing stores an ord).
create or replace function private.submission_fields()
returns table (section text, field text, kind text, ord int)
language sql
immutable
set search_path = ''
as $$
  select x.section, x.field, x.kind, x.ord::int from (values
    ('personal', 'personal_phone', 'plain', 1),
    ('personal', 'address_line1', 'plain', 2),
    ('personal', 'address_line2', 'plain', 3),
    ('personal', 'city', 'plain', 4),
    ('personal', 'province', 'plain', 5),
    ('personal', 'postal_code', 'plain', 6),
    ('professional', 'professions', 'set', 7),
    ('professional', 'years_experience', 'plain', 8),
    ('professional', 'birthday', 'plain', 9),
    ('portrait', 'bio', 'plain', 10),
    ('portrait', 'approach', 'plain', 11),
    ('portrait', 'approach_ids', 'set', 12),
    ('portrait', 'approach_other', 'plain', 13),
    ('portrait', 'public_email', 'plain', 14),
    ('portrait', 'public_phone', 'plain', 15),
    ('languages', 'language_ids', 'set', 16),
    ('clienteles', 'clienteles', 'set', 17),
    ('clienteles', 'min_client_age', 'plain', 18),
    ('clienteles', 'women_only', 'plain', 19),
    ('motifs', 'motif_ids', 'set', 20),
    ('availability', 'accepting_new_clients', 'plain', 21),
    ('availability', 'availability_periods', 'plain', 22),
    ('availability', 'availability_note', 'plain', 23),
    ('photo', 'photo', 'file', 24),
    ('insurance', 'insurance', 'file', 25),
    ('tax_bank', 'business_number', 'private', 26),
    ('tax_bank', 'gst_number', 'private', 27),
    ('tax_bank', 'qst_number', 'private', 28),
    ('tax_bank', 'bank_institution', 'private', 29),
    ('tax_bank', 'bank_transit', 'private', 30),
    ('tax_bank', 'bank_account', 'private', 31),
    ('tax_bank', 'sin', 'private', 32),
    ('consent', 'consent', 'consent', 33)
  ) as x(section, field, kind, ord)
$$;

alter table public.professional_submissions
  drop constraint professional_submissions_applied_fields_check;
alter table public.professional_submissions
  add constraint professional_submissions_applied_fields_check check (
    applied_fields <@ array['personal_phone', 'address_line1', 'address_line2', 'city', 'province', 'postal_code',
                            'professions', 'years_experience', 'birthday', 'bio', 'approach', 'approach_ids', 'approach_other',
                            'public_email', 'public_phone', 'language_ids', 'clienteles', 'min_client_age', 'women_only',
                            'motif_ids', 'accepting_new_clients', 'availability_periods', 'availability_note', 'photo',
                            'insurance', 'business_number', 'gst_number', 'qst_number', 'bank_institution',
                            'bank_transit', 'bank_account', 'sin', 'consent']);

-- Latest body: *_professionals_approaches.sql. Only the professional branch changes.
create or replace function private.normalize_submission_section(p_section text, p_values jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_keys text[];
  v jsonb := p_values;
  v_out jsonb;
  v_text text;
  v_num numeric;
  v_items record;
  v_ids uuid[];
  v_flags boolean[];
  v_file uuid;
  v_date date;
begin
  if p_values is null or pg_catalog.jsonb_typeof(p_values) <> 'object' then
    raise exception 'Valeurs invalides : objet JSON attendu.' using errcode = '22023';
  end if;
  v_keys := case p_section
    when 'photo' then array['file_id']
    when 'insurance' then array['file_id', 'expires_on']
    else array(select f.field from private.submission_fields() f where f.section = p_section and f.kind in ('plain', 'set'))
  end;
  if p_section in ('tax_bank', 'consent') or pg_catalog.cardinality(v_keys) = 0 then
    raise exception 'Section invalide pour cet enregistrement.' using errcode = '22023';
  end if;
  -- Unknown keys (private ones included: a SIN or an account never enters the draft, P4-38).
  if exists (select 1 from pg_catalog.jsonb_object_keys(v) k where not (k = any (v_keys))) then
    raise exception 'Champ inconnu pour cette section.' using errcode = '22023';
  end if;

  case p_section
  when 'personal' then
    v_text := pg_catalog.upper(pg_catalog.regexp_replace(coalesce(private.submission_string(v, 'postal_code'), ''), '\s', '', 'g'));
    if v_text <> '' and v_text !~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$' then
      raise exception 'Code postal invalide : format A1A 1A1 attendu.' using errcode = 'P0001', hint = 'postal_code';
    end if;
    v_out := pg_catalog.jsonb_build_object(
      'personal_phone', case when nullif(pg_catalog.btrim(private.submission_string(v, 'personal_phone')), '') is not null
                             then private.submission_phone(private.submission_string(v, 'personal_phone'), 'personal_phone') end,
      'address_line1', private.submission_label(private.submission_string(v, 'address_line1'), 'L''adresse', 200, 'address_line1'),
      'address_line2', private.submission_label(private.submission_string(v, 'address_line2'), 'Le complément d''adresse', 200, 'address_line2'),
      'city', private.submission_label(private.submission_string(v, 'city'), 'La ville', 100, 'city'),
      'province', nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(private.submission_string(v, 'province'), ''))), ''),
      'postal_code', case when v_text <> '' then pg_catalog.left(v_text, 3) || ' ' || pg_catalog.right(v_text, 3) end);
    if (v_out ->> 'province') not in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT') then
      raise exception 'Province inconnue.' using errcode = 'P0001', hint = 'province';
    end if;

  when 'professional' then
    select * into v_items from private.parse_profession_items(coalesce(v -> 'professions', '[]'));
    if coalesce(pg_catalog.jsonb_typeof(v -> 'years_experience'), 'null') not in ('number', 'null') then
      raise exception 'Valeur invalide : nombre attendu.' using errcode = '22023', hint = 'years_experience';
    end if;
    v_num := (v ->> 'years_experience')::numeric;
    if v_num is not null and (v_num not between 0 and 60 or v_num <> pg_catalog.trunc(v_num)) then
      raise exception 'Les années d''expérience vont de 0 à 60.' using errcode = 'P0001', hint = 'years_experience';
    end if;
    -- P4-564: a birthday is a day of the year, « MM-DD », never a year (the clinic marks the
    -- day; it has no use for an age). An impossible day (31 avril, 30 février) is refused.
    v_text := nullif(pg_catalog.btrim(coalesce(private.submission_string(v, 'birthday'), '')), '');
    if v_text is not null and (v_text !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                               or v_text ~ '^(02-3[01]|(04|06|09|11)-31)$') then
      raise exception 'Date d''anniversaire invalide : choisissez un jour qui existe dans ce mois.'
        using errcode = 'P0001', hint = 'birthday';
    end if;
    v_out := pg_catalog.jsonb_build_object(
      'birthday', v_text,
      'professions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                        'title_id', x.tid,
                                        'licence_number', nullif(pg_catalog.btrim(x.licence, E' \t\r\n'), ''),
                                        'is_primary', x.primary_flag) order by x.ord)
                                 from unnest(v_items.titles, v_items.licences, v_items.primary_flags)
                                      with ordinality as x(tid, licence, primary_flag, ord)), '[]'),
      'years_experience', v_num::int);

  when 'portrait' then
    v_text := pg_catalog.lower(nullif(pg_catalog.btrim(coalesce(private.submission_string(v, 'public_email'), ''), E' \t\r\n'), ''));
    if v_text is not null and (pg_catalog.char_length(v_text) > 254 or v_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      raise exception 'Courriel invalide.' using errcode = 'P0001', hint = 'public_email';
    end if;
    v_out := pg_catalog.jsonb_build_object(
      'bio', private.submission_long_text(private.submission_string(v, 'bio'), 'La présentation', 4000, 'bio'),
      'approach', private.submission_long_text(private.submission_string(v, 'approach'), 'L''approche', 4000, 'approach'),
      -- P4-561: the approaches she checked, sorted as stored (checked against the catalogue when
      -- applied), and what « Autre — précisez » means.
      'approach_ids', pg_catalog.to_jsonb(coalesce((select pg_catalog.array_agg(x order by x)
                                       from pg_catalog.unnest(private.submission_uuid_array(v -> 'approach_ids', 'approach_ids')) as x), '{}'::uuid[])),
      'approach_other', private.submission_label(private.submission_string(v, 'approach_other'), 'La précision', 200, 'approach_other'),
      'public_email', v_text,
      'public_phone', case when nullif(pg_catalog.btrim(private.submission_string(v, 'public_phone')), '') is not null
                           then private.submission_phone(private.submission_string(v, 'public_phone'), 'public_phone') end);

  when 'languages' then
    v_out := pg_catalog.jsonb_build_object('language_ids',
      pg_catalog.to_jsonb(coalesce((select pg_catalog.array_agg(x order by x)
                                      from pg_catalog.unnest(private.submission_uuid_array(v -> 'language_ids', 'language_ids')) as x), '{}'::uuid[])));

  when 'motifs' then
    v_out := pg_catalog.jsonb_build_object('motif_ids',
      pg_catalog.to_jsonb(coalesce((select pg_catalog.array_agg(x order by x)
                                      from pg_catalog.unnest(private.submission_uuid_array(v -> 'motif_ids', 'motif_ids')) as x), '{}'::uuid[])));

  when 'clienteles' then
    select x.ids, x.flags into v_ids, v_flags from private.parse_specialized_items(coalesce(v -> p_section, '[]')) x;
    -- The client limits (P4-245): the youngest client age (null: none) and « Femmes seulement ».
    if coalesce(pg_catalog.jsonb_typeof(v -> 'min_client_age'), 'null') not in ('number', 'null') then
      raise exception 'Valeur invalide : nombre attendu.' using errcode = '22023', hint = 'min_client_age';
    end if;
    v_num := (v ->> 'min_client_age')::numeric;
    if v_num is not null and (v_num not between 0 and 120 or v_num <> pg_catalog.trunc(v_num)) then
      raise exception 'Les âges vont de 0 à 120 ans.' using errcode = 'P0001', hint = 'min_client_age';
    end if;
    if coalesce(pg_catalog.jsonb_typeof(v -> 'women_only'), 'null') not in ('boolean', 'null') then
      raise exception 'Valeur invalide : booléen attendu.' using errcode = '22023', hint = 'women_only';
    end if;
    v_out := pg_catalog.jsonb_build_object(p_section,
      coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.id, 'specialized', x.flag) order by x.id)
                  from unnest(v_ids, v_flags) as x(id, flag)), '[]'),
      'min_client_age', v_num::int,
      'women_only', coalesce(v -> 'women_only', 'null'::jsonb));

  when 'availability' then
    if coalesce(pg_catalog.jsonb_typeof(v -> 'accepting_new_clients'), 'null') not in ('boolean', 'null') then
      raise exception 'Valeur invalide : booléen attendu.' using errcode = '22023', hint = 'accepting_new_clients';
    end if;
    if coalesce(pg_catalog.jsonb_typeof(v -> 'availability_periods'), 'null') not in ('array', 'null')
       or exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(v -> 'availability_periods', '[]')) as e(x)
                   where coalesce(e.x #>> '{}', '') not in ('am', 'pm', 'end_of_day', 'evening', 'weekend')
                      or pg_catalog.jsonb_typeof(e.x) <> 'string') then
      raise exception 'Périodes invalides : am, pm, end_of_day, evening, weekend attendues.' using errcode = '22023', hint = 'availability_periods';
    end if;
    v_out := pg_catalog.jsonb_build_object(
      'accepting_new_clients', coalesce(v -> 'accepting_new_clients', 'null'::jsonb),
      'availability_periods', coalesce((select pg_catalog.jsonb_agg(d.x order by pg_catalog.array_position(array['am', 'pm', 'end_of_day', 'evening', 'weekend'], d.x))
                                          from (select distinct e.x #>> '{}' as x
                                                  from pg_catalog.jsonb_array_elements(coalesce(v -> 'availability_periods', '[]')) as e(x)) d), '[]'),
      'availability_note', private.submission_long_text(private.submission_string(v, 'availability_note'), 'La note', 500, 'availability_note'));

  when 'photo' then
    v_out := pg_catalog.jsonb_build_object('file_id', private.submission_uuid(v -> 'file_id', 'photo'));

  when 'insurance' then
    v_file := private.submission_uuid(v -> 'file_id', 'insurance');
    v_text := private.submission_string(v, 'expires_on');
    if v_text is not null then
      if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Date invalide.' using errcode = 'P0001', hint = 'expires_on';
      end if;
      begin
        v_date := v_text::date;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Date invalide.' using errcode = 'P0001', hint = 'expires_on';
      end;
      -- Date-only (P4-2): a proof already expired is refused; no absurd year (4a.17 lesson).
      if v_date < private.clinic_today() then
        raise exception 'Cette assurance est déjà expirée : joignez une preuve en vigueur.' using errcode = 'P0001', hint = 'expires_on';
      end if;
      if v_date > date '2100-12-31' then
        raise exception 'La date doit être au plus tard le 31 décembre 2100.' using errcode = 'P0001', hint = 'expires_on';
      end if;
    end if;
    v_out := pg_catalog.jsonb_build_object('file_id', v_file, 'expires_on', v_date);
  end case;
  -- Only the keys given: a field left out keeps whatever the section already holds (P4-176).
  return coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value) from pg_catalog.jsonb_each(v_out) e
                    where p_values ? e.key), '{}'::jsonb);
end;
$$;

-- Latest body: *_professionals_approaches.sql. Only the professional object changes.
create or replace function private.professional_submission_snapshot(p_org uuid, p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'personal', pg_catalog.jsonb_build_object(
      'personal_phone', p.personal_phone, 'address_line1', p.address_line1, 'address_line2', p.address_line2,
      'city', p.city, 'province', p.province, 'postal_code', p.postal_code),
    'professional', pg_catalog.jsonb_build_object(
      'professions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                        'title_id', x.profession_title_id, 'licence_number', x.licence_number,
                                        'is_primary', x.is_primary)
                                      order by x.is_primary desc, x.created_at, x.id)
                                 from public.professional_professions x
                                where x.professional_id = p.id and x.org_id = p.org_id), '[]'),
      'years_experience', p.years_experience, 'birthday', p.birthday),
    'portrait', pg_catalog.jsonb_build_object(
      'bio', pp.bio, 'approach', pp.approach, 'public_email', pp.public_email, 'public_phone', pp.public_phone,
      'approach_ids', coalesce((select pg_catalog.jsonb_agg(x.approach_id order by x.approach_id)
                                  from public.professional_approaches x
                                 where x.professional_id = p.id and x.org_id = p.org_id), '[]'),
      'approach_other', (select x.other_text from public.professional_approaches x
                          where x.professional_id = p.id and x.org_id = p.org_id and x.other_text is not null
                          limit 1)),
    'languages', pg_catalog.jsonb_build_object(
      'language_ids', coalesce((select pg_catalog.jsonb_agg(x.language_id order by x.language_id)
                                  from public.professional_languages x
                                 where x.professional_id = p.id and x.org_id = p.org_id), '[]')),
    'clienteles', pg_catalog.jsonb_build_object(
      'clienteles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.clientele_id, 'specialized', x.is_specialized)
                                     order by x.clientele_id)
                                from public.professional_clienteles x
                               where x.professional_id = p.id and x.org_id = p.org_id), '[]'),
      'min_client_age', mp.min_client_age, 'women_only', mp.women_only),
    'motifs', pg_catalog.jsonb_build_object(
      'motif_ids', coalesce((select pg_catalog.jsonb_agg(x.motif_id order by x.motif_id)
                               from public.professional_motifs x
                              where x.professional_id = p.id and x.org_id = p.org_id), '[]')),
    'availability', pg_catalog.jsonb_build_object(
      'accepting_new_clients', mp.accepting_new_clients,
      'availability_periods', coalesce((select pg_catalog.jsonb_agg(x order by pg_catalog.array_position(array['am', 'pm', 'end_of_day', 'evening', 'weekend'], x))
                                          from pg_catalog.unnest(mp.availability_periods) as x), '[]'),
      'availability_note', mp.availability_note))
    from public.professionals p
    left join public.professional_public_profiles pp on pp.professional_id = p.id and pp.org_id = p.org_id
    left join public.professional_matching_profiles mp on mp.professional_id = p.id and mp.org_id = p.org_id
   where p.id = p_id and p.org_id = p_org
$$;

-- Latest body: *_professionals_approaches.sql. Only the plain-field update changes.
create or replace function public.apply_professional_submission(p_submission_id uuid, p_fields text[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pid uuid;
  v_sub public.professional_submissions;
  v_row public.professionals;
  v_available text[];
  v_fields text[];
  v_values jsonb;
  v_items record;
  v_ids uuid[];
  v_flags boolean[];
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if not private.has_permission('professionals.review') then
    raise exception 'Permission refusée : professionals.review' using errcode = '42501';
  end if;
  if p_fields is not null and (pg_catalog.cardinality(p_fields) > 50
     or exists (select 1 from pg_catalog.unnest(p_fields) x
                 where x is null or not exists (select 1 from private.submission_fields() f where f.field = x))) then
    raise exception 'Champ inconnu.' using errcode = '22023';
  end if;

  -- The professional first, then its submission (the module's lock order).
  select s.professional_id into v_pid from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org;
  if not found then
    raise exception 'Ce profil envoyé n''existe plus.' using errcode = 'P0001';
  end if;
  v_row := private.lock_active_professional(v_pid, false);
  if v_row.profile_id = auth.uid() then
    raise exception 'Vous ne pouvez pas réviser votre propre profil.' using errcode = 'P0001', hint = 'submission';
  end if;
  select * into v_sub from public.professional_submissions s
   where s.id = p_submission_id and s.org_id = v_org and s.professional_id = v_pid
     for update;
  if v_sub.status <> 'submitted' then
    raise exception 'Ce profil n''attend pas de révision.' using errcode = 'P0001', hint = 'status';
  end if;

  if 'sin' = any (coalesce(p_fields, '{}'))
     and not coalesce((private.professionals_setting(v_org, 'collect_sin'))::boolean, false) then
    raise exception 'La collecte du NAS n''est pas activée.' using errcode = 'P0001', hint = 'sin';
  end if;
  v_available := private.submission_available_fields(v_sub);
  if p_fields is not null and not (p_fields <@ v_available) then
    raise exception 'Champ non soumis.' using errcode = '22023';
  end if;
  v_fields := coalesce((select pg_catalog.array_agg(f.field order by f.ord)
                          from private.submission_fields() f
                         where f.field = any (coalesce(p_fields, v_available))), '{}');
  v_values := v_sub.submitted_values;

  -- What may have changed since the provider sent it (P4-305).
  if 'insurance' = any (v_fields) and (v_values #>> '{insurance,expires_on}')::date < private.clinic_today() then
    raise exception 'Cette assurance a expiré depuis l''envoi du profil.'
      using errcode = 'P0001', hint = 'Renvoyez le profil au professionnel : il joindra une preuve en vigueur.';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:apply_professional_submission', true);

  -- Plain fields (values normalised when saved; the tables' checks are a backstop).
  if v_fields && array['personal_phone', 'address_line1', 'address_line2', 'city', 'province', 'postal_code', 'years_experience', 'birthday'] then
    update public.professionals p
       set personal_phone = case when 'personal_phone' = any (v_fields) then v_values #>> '{personal,personal_phone}' else p.personal_phone end,
           address_line1 = case when 'address_line1' = any (v_fields) then v_values #>> '{personal,address_line1}' else p.address_line1 end,
           address_line2 = case when 'address_line2' = any (v_fields) then v_values #>> '{personal,address_line2}' else p.address_line2 end,
           city = case when 'city' = any (v_fields) then v_values #>> '{personal,city}' else p.city end,
           province = case when 'province' = any (v_fields) then coalesce(v_values #>> '{personal,province}', p.province) else p.province end,
           postal_code = case when 'postal_code' = any (v_fields) then v_values #>> '{personal,postal_code}' else p.postal_code end,
           years_experience = case when 'years_experience' = any (v_fields)
                                   then (v_values #>> '{professional,years_experience}')::smallint else p.years_experience end,
           birthday = case when 'birthday' = any (v_fields) then v_values #>> '{professional,birthday}' else p.birthday end
     where p.id = v_pid and p.org_id = v_org;
  end if;
  if v_fields && array['bio', 'approach', 'public_email', 'public_phone'] then
    update public.professional_public_profiles x
       set bio = case when 'bio' = any (v_fields) then v_values #>> '{portrait,bio}' else x.bio end,
           approach = case when 'approach' = any (v_fields) then v_values #>> '{portrait,approach}' else x.approach end,
           public_email = case when 'public_email' = any (v_fields) then v_values #>> '{portrait,public_email}' else x.public_email end,
           public_phone = case when 'public_phone' = any (v_fields) then v_values #>> '{portrait,public_phone}' else x.public_phone end
     where x.professional_id = v_pid and x.org_id = v_org;
  end if;
  if v_fields && array['min_client_age', 'women_only', 'accepting_new_clients', 'availability_periods', 'availability_note'] then
    update public.professional_matching_profiles x
       set min_client_age = case when 'min_client_age' = any (v_fields)
                                 then (v_values #>> '{clienteles,min_client_age}')::smallint else x.min_client_age end,
           women_only = case when 'women_only' = any (v_fields)
                             then coalesce((v_values #>> '{clienteles,women_only}')::boolean, x.women_only)
                             else x.women_only end,
           accepting_new_clients = case when 'accepting_new_clients' = any (v_fields)
                                        then coalesce((v_values #>> '{availability,accepting_new_clients}')::boolean, x.accepting_new_clients)
                                        else x.accepting_new_clients end,
           availability_periods = case when 'availability_periods' = any (v_fields)
                                       then array(select pg_catalog.jsonb_array_elements_text(coalesce(v_values #> '{availability,availability_periods}', '[]')))
                                       else x.availability_periods end,
           availability_note = case when 'availability_note' = any (v_fields) then v_values #>> '{availability,availability_note}' else x.availability_note end
     where x.professional_id = v_pid and x.org_id = v_org;
  end if;

  -- Sets, through the staff write paths.
  if 'professions' = any (v_fields) then
    select * into v_items from private.parse_profession_items(coalesce(v_values #> '{professional,professions}', '[]'));
    perform private.apply_professional_professions(v_org, v_pid, v_items.titles, v_items.licences, v_items.primary_flags, false);
  end if;
  if 'language_ids' = any (v_fields) then
    perform private.apply_professional_languages(v_org, v_pid, private.submission_uuid_array(v_values #> '{languages,language_ids}', 'language_ids'));
  end if;
  if 'clienteles' = any (v_fields) then
    select x.ids, x.flags into v_ids, v_flags from private.parse_specialized_items(coalesce(v_values #> '{clienteles,clienteles}', '[]')) x;
    perform private.apply_professional_clienteles(v_org, v_pid, v_ids, v_flags);
  end if;
  if 'motif_ids' = any (v_fields) then
    perform private.apply_professional_motifs(v_org, v_pid, private.submission_uuid_array(v_values #> '{motifs,motif_ids}', 'motif_ids'), false);
  end if;
  -- P4-561: the approaches she checked, and the text of « Autre — précisez ».
  if v_fields && array['approach_ids', 'approach_other'] then
    perform private.apply_professional_approaches(v_org, v_pid,
      private.submission_uuid_array(v_values #> '{portrait,approach_ids}', 'approach_ids'),
      v_values #>> '{portrait,approach_other}');
  end if;
  if v_fields && array['professions', 'motif_ids'] then
    perform private.assert_restricted_motifs_ok(v_org, v_pid);
  end if;

  -- Staged files: attached to the professional (retain_until cleared), readable by the record's
  -- readers and by the provider (owner branch). attach_stored_file re-checks purpose and uploader.
  if 'photo' = any (v_fields) then
    perform private.attach_stored_file((v_values #>> '{photo,file_id}')::uuid, array['professional_submission_file'],
      'professional', v_pid, 'professionals.view', v_row.profile_id,
      case when v_row.profile_id is not null then 'professionals.self' end, v_row.profile_id);
  end if;
  if 'insurance' = any (v_fields) then
    perform private.attach_stored_file((v_values #>> '{insurance,file_id}')::uuid, array['professional_submission_file'],
      'professional', v_pid, 'professionals.view', v_row.profile_id,
      case when v_row.profile_id is not null then 'professionals.self' end, v_row.profile_id);
  end if;


  perform private.apply_submission_private(v_org, v_pid, v_sub.id, v_fields);

  update public.professional_submissions s
     set status = 'approved', reviewed_at = pg_catalog.now(), reviewed_by = auth.uid(), applied_fields = v_fields
   where s.id = v_sub.id and s.org_id = v_org;
  -- Loi 25: no second copy of a SIN or an account once the review is done.
  delete from public.professional_submission_private sp where sp.submission_id = v_sub.id and sp.org_id = v_org;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

-- -----------------------------------------------------------------------------
-- The agenda: the birthdays of a period
-- -----------------------------------------------------------------------------
-- Every day of [p_from, p_to] (62 days at most: the month view shows 42) with the active
-- professionals whose birthday falls on it; 29 February is marked on the 28th outside a leap
-- year. `[{professional_id, name, day}]`, by day then name. `professionals.view`.
create function public.professional_birthdays(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if v_org is null or not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Invalid period' using errcode = '22023';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'professional_id', p.id, 'name', p.first_name || ' ' || p.last_name, 'day', g.day)
           order by g.day, p.last_name, p.first_name)
      from (select x::date as day
              from pg_catalog.generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as x) g
      join public.professionals p
        on p.org_id = v_org and p.status = 'active' and p.birthday is not null
       and (p.birthday = pg_catalog.to_char(g.day, 'MM-DD')
            or (p.birthday = '02-29' and pg_catalog.to_char(g.day, 'MM-DD') = '02-28'
                and pg_catalog.date_part('day', pg_catalog.make_date(pg_catalog.date_part('year', g.day)::int, 3, 1) - 1) = 28))
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.professional_birthdays(date, date) from public, anon;
grant execute on function public.professional_birthdays(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- The morning notice (service role, the job function)
-- -----------------------------------------------------------------------------
-- One notice per active professional whose birthday is the clinic's today, to
-- `professionals.manage`, normal, kept two days, deduplicated per professional and day: a second
-- run the same day adds nothing. Returns how many birthdays today.
create function public.run_professionals_birthday_notices_for_service(p_org_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_md text;
  v_leap_gap boolean;
  v_row record;
  v_count int := 0;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if p_org_id is null then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'professionals') then
    raise exception 'Module disabled' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'job:professionals.birthday_notice', true);
  v_today := private.clinic_today_for_org(p_org_id);
  v_md := pg_catalog.to_char(v_today, 'MM-DD');
  -- 29 February is marked on the 28th outside a leap year.
  v_leap_gap := v_md = '02-28'
    and pg_catalog.date_part('day', pg_catalog.make_date(pg_catalog.date_part('year', v_today)::int, 3, 1) - 1) = 28;
  for v_row in
    select p.id, p.first_name || ' ' || p.last_name as name
      from public.professionals p
     where p.org_id = p_org_id and p.status = 'active'
       and (p.birthday = v_md or (v_leap_gap and p.birthday = '02-29'))
  loop
    perform private.notify(
      p_org_id, 'professionals', 'professionals.birthday', 'normal',
      'Anniversaire : ' || v_row.name,
      v_row.name || ' fête son anniversaire aujourd''hui.',
      '/professionnels/' || v_row.id || '/apercu', 'professional', v_row.id,
      'professionals.manage', null,
      'birthday:' || v_row.id || ':' || v_today::text,
      pg_catalog.now() + interval '2 days');
    v_count := v_count + 1;
  end loop;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return v_count;
end;
$$;
revoke all on function public.run_professionals_birthday_notices_for_service(uuid) from public, anon, authenticated;
grant execute on function public.run_professionals_birthday_notices_for_service(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- The job: 07:00 clinic time, off until « Tâches planifiées » switches it on
-- -----------------------------------------------------------------------------
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, cron_job_name, local_hour, is_maintenance)
values
  ('professionals.birthday_notice', 'professionals', 'Anniversaires des professionnels',
   'Avertit l''équipe, le matin, de l''anniversaire d''un professionnel actif.',
   'function', 'professionals-birthday-notice', 'professionals.birthday_notice', 7, false)
on conflict do nothing;

select cron.schedule('professionals.birthday_notice', '25 * * * *',
  $cron$select private.invoke_job_function('professionals.birthday_notice')$cron$);

select pg_catalog.set_config('app.audit_source', '', true);
