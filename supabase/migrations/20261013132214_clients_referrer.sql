-- =============================================================================
-- Clients: « Référé par » names an existing file, or keeps a typed name (decision CL-30)
-- =============================================================================
-- Jonathan, 2026-10-13: « Référé par » searches the clinic's files and links one when found, else
-- keeps the free text.
-- - clients.referred_by_client_id (null; a file of the same clinic, never the file itself), next to
--   the typed `referred_by`: one or the other, never both (a CHECK, and a trigger that keeps the file
--   when a merge fills the kept file's empty name). Indexed (the merge moves the links).
-- - create_client / update_client accept `referred_by_client_id` (clients_from_json): a file of the
--   clinic; when it changes, private.clients_check_referrer refuses a merged or anonymised file and
--   the file itself. Choosing a file clears the typed name, typing a name clears the file
--   (clients_apply_fields). import_client is unchanged: GOrendezvous only had the typed name.
-- - The merge (Clients' own part, through its handler): a link to the merged file moves to the kept
--   one (the kept file never names itself); the kept file with no « Référé par » takes the merged
--   file's link, as C2 fills its other empty fields. The merge's « take » of `referred_by` takes
--   both columns.
-- - The anonymisation: a link TO the anonymised file stays, and the record reads « Dossier
--   anonymisé » (no name); the anonymised file's own link goes, with its typed name.
-- - Reads: get_client_summary's bundle (staff, clients.view) adds `referrer` (id, number, name,
--   anonymised, archived). A professional never sees who referred a client: my_clients and her
--   branch of get_client_summary are unchanged.
-- Additive: one column, two constraints, one index, one trigger, two new private functions, six
-- replaced with the same signatures (from their newest definitions on main), one catalogue row
-- updated (Clients' merge handler).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_referrer', true);

-- -----------------------------------------------------------------------------
-- The column
-- -----------------------------------------------------------------------------
alter table public.clients add column referred_by_client_id uuid;
alter table public.clients
  add constraint clients_referred_by_client_fkey foreign key (org_id, referred_by_client_id) references public.clients (org_id, id),
  add constraint clients_referred_by_not_self_check check (referred_by_client_id is null or referred_by_client_id <> id),
  add constraint clients_referred_by_one_check check (referred_by is null or referred_by_client_id is null);
create index clients_org_referred_by_client_idx on public.clients (org_id, referred_by_client_id);
comment on column public.clients.referred_by_client_id is
  '« Référé par » a file of the clinic (CL-30); the typed name stays in referred_by. One or the other.';

-- C2's merge fills the kept file's empty `referred_by` from the merged one: when the kept file
-- names a file, it keeps that file (the kept file's values first) and the typed name is dropped.
create function private.clients_referrer_one()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.referred_by_client_id is not null and new.referred_by is not null then
    new.referred_by := null;
  end if;
  return new;
end;
$$;
revoke all on function private.clients_referrer_one() from public, anon, authenticated, service_role;
create trigger clients_referrer_one before insert or update of referred_by, referred_by_client_id on public.clients
  for each row execute function private.clients_referrer_one();

-- Whether a file may be chosen as « Référé par » for p_client_id (null: a new file): not the file
-- itself, not merged (its kept file is the one to choose), not anonymised.
create function private.clients_check_referrer(p_org uuid, p_client_id uuid, p_referrer uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_referrer public.clients;
begin
  if p_referrer is null then
    return;
  end if;
  if p_referrer = p_client_id then
    raise exception 'Un client ne peut pas être référé par son propre dossier.' using errcode = 'P0001', hint = 'referred_by_client_id';
  end if;
  select c.* into v_referrer from public.clients c where c.org_id = p_org and c.id = p_referrer;
  if v_referrer.id is null then
    raise exception 'Choisissez un dossier de la clinique.' using errcode = 'P0001', hint = 'referred_by_client_id';
  end if;
  if v_referrer.merged_into_id is not null then
    raise exception 'Ce dossier a été fusionné dans un autre : choisissez le dossier conservé.' using errcode = 'P0001', hint = 'referred_by_client_id';
  end if;
  if v_referrer.anonymized_at is not null then
    raise exception 'Ce dossier a été anonymisé : il ne peut plus être choisi.' using errcode = 'P0001', hint = 'referred_by_client_id';
  end if;
end;
$$;
revoke all on function private.clients_check_referrer(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The form (from 20261013022641_clients_rpcs.sql)
-- -----------------------------------------------------------------------------

create or replace function private.clients_from_json(p_org uuid, p jsonb)
returns public.clients
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.clients;
  v_text text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Les informations du client sont requises.' using errcode = '22023';
  end if;
  v.first_name := private.clients_text(p ->> 'first_name');
  v.last_name := private.clients_text(p ->> 'last_name');
  if v.first_name is null or pg_catalog.length(v.first_name) > 100 or not private.is_tidy_text(v.first_name) then
    raise exception 'Indiquez le prénom (100 caractères au plus).' using errcode = 'P0001', hint = 'first_name';
  end if;
  if v.last_name is null or pg_catalog.length(v.last_name) > 100 or not private.is_tidy_text(v.last_name) then
    raise exception 'Indiquez le nom (100 caractères au plus).' using errcode = 'P0001', hint = 'last_name';
  end if;
  v.birth_first_name := private.clients_text(p ->> 'birth_first_name');
  if v.birth_first_name is not null and (pg_catalog.length(v.birth_first_name) > 100 or not private.is_tidy_text(v.birth_first_name)) then
    raise exception 'Le prénom à la naissance compte 100 caractères au plus.' using errcode = 'P0001', hint = 'birth_first_name';
  end if;
  v.pronouns := private.clients_text(p ->> 'pronouns');
  if v.pronouns is not null and (pg_catalog.length(v.pronouns) > 40 or not private.is_tidy_text(v.pronouns)) then
    raise exception 'Les pronoms comptent 40 caractères au plus.' using errcode = 'P0001', hint = 'pronouns';
  end if;
  v.sex := nullif(p ->> 'sex', '');
  if v.sex is not null and v.sex not in ('female', 'male', 'other') then
    raise exception 'Le sexe est Femme, Homme ou Autre.' using errcode = 'P0001', hint = 'sex';
  end if;
  begin
    v.birthday := nullif(p ->> 'birthday', '')::date;
  exception when others then
    raise exception 'La date de naissance n''est pas une date.' using errcode = 'P0001', hint = 'birthday';
  end;
  if v.birthday is not null and (v.birthday < date '1900-01-01' or v.birthday > private.clinic_today()) then
    raise exception 'La date de naissance doit être passée (et après 1900).' using errcode = 'P0001', hint = 'birthday';
  end if;
  v.email := pg_catalog.lower(private.clients_text(p ->> 'email'));
  if v.email is not null and (pg_catalog.length(v.email) > 254 or v.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Le courriel n''est pas une adresse valide.' using errcode = 'P0001', hint = 'email';
  end if;
  v.mobile_e164 := private.clients_e164(p ->> 'mobile_e164');
  v.home_e164 := private.clients_e164(p ->> 'home_e164');
  v.work_e164 := private.clients_e164(p ->> 'work_e164');
  if v.mobile_e164 = 'invalid' then
    raise exception 'Le cellulaire n''est pas un numéro valide (10 chiffres, ou + et l''indicatif du pays).' using errcode = 'P0001', hint = 'mobile_e164';
  end if;
  if v.home_e164 = 'invalid' then
    raise exception 'Le téléphone (maison) n''est pas un numéro valide (10 chiffres, ou + et l''indicatif du pays).' using errcode = 'P0001', hint = 'home_e164';
  end if;
  if v.work_e164 = 'invalid' then
    raise exception 'Le téléphone (travail) n''est pas un numéro valide (10 chiffres, ou + et l''indicatif du pays).' using errcode = 'P0001', hint = 'work_e164';
  end if;
  v.work_ext := pg_catalog.regexp_replace(coalesce(p ->> 'work_ext', ''), '[^0-9]', '', 'g');
  v.work_ext := nullif(v.work_ext, '');
  if v.work_ext is not null and pg_catalog.length(v.work_ext) > 10 then
    raise exception 'Le poste compte 10 chiffres au plus.' using errcode = 'P0001', hint = 'work_ext';
  end if;
  v.language := coalesce(nullif(p ->> 'language', ''), 'fr');
  if v.language not in ('fr', 'en') then
    raise exception 'La langue est le français ou l''anglais.' using errcode = 'P0001', hint = 'language';
  end if;
  v.time_zone := private.clients_text(p ->> 'time_zone');
  if v.time_zone is not null and (v.time_zone !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$' or pg_catalog.length(v.time_zone) > 64
                                  or v.time_zone ~ '^posix/' or v.time_zone ~ '^right/'
                                  or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v.time_zone)) then
    raise exception 'Fuseau horaire inconnu.' using errcode = 'P0001', hint = 'time_zone';
  end if;
  v.reminders_by_sms := coalesce((p ->> 'reminders_by_sms')::boolean, true);
  v.reminders_by_email := coalesce((p ->> 'reminders_by_email')::boolean, true);
  v.country := pg_catalog.upper(coalesce(private.clients_text(p ->> 'country'), 'CA'));
  if v.country !~ '^[A-Z]{2}$' then
    raise exception 'Le pays est un code de deux lettres (CA).' using errcode = 'P0001', hint = 'country';
  end if;
  v.address_line1 := private.clients_text(p ->> 'address_line1');
  v.address_line2 := private.clients_text(p ->> 'address_line2');
  v.city := private.clients_text(p ->> 'city');
  if v.address_line1 is not null and (pg_catalog.length(v.address_line1) > 200 or not private.is_tidy_text(v.address_line1)) then
    raise exception 'L''adresse compte 200 caractères au plus.' using errcode = 'P0001', hint = 'address_line1';
  end if;
  if v.address_line2 is not null and (pg_catalog.length(v.address_line2) > 200 or not private.is_tidy_text(v.address_line2)) then
    raise exception 'Le complément d''adresse compte 200 caractères au plus.' using errcode = 'P0001', hint = 'address_line2';
  end if;
  if v.city is not null and (pg_catalog.length(v.city) > 100 or not private.is_tidy_text(v.city)) then
    raise exception 'La ville compte 100 caractères au plus.' using errcode = 'P0001', hint = 'city';
  end if;
  v.province := private.clients_text(p ->> 'province');
  if v.province is not null and v.country = 'CA' then
    v.province := pg_catalog.upper(v.province);
    if v.province not in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT') then
      raise exception 'Choisissez la province.' using errcode = 'P0001', hint = 'province';
    end if;
  elsif v.province is not null and (pg_catalog.length(v.province) > 100 or not private.is_tidy_text(v.province)) then
    raise exception 'La province ou l''État compte 100 caractères au plus.' using errcode = 'P0001', hint = 'province';
  end if;
  v.postal_code := pg_catalog.upper(private.clients_text(p ->> 'postal_code'));
  if v.postal_code is not null and v.country = 'CA' then
    v_text := pg_catalog.regexp_replace(v.postal_code, '\s', '', 'g');
    if v_text !~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$' then
      raise exception 'Le code postal a la forme A1A 1A1.' using errcode = 'P0001', hint = 'postal_code';
    end if;
    v.postal_code := pg_catalog.left(v_text, 3) || ' ' || pg_catalog.right(v_text, 3);
  elsif v.postal_code is not null and (pg_catalog.length(v.postal_code) > 20 or not private.is_tidy_text(v.postal_code)) then
    raise exception 'Le code postal compte 20 caractères au plus.' using errcode = 'P0001', hint = 'postal_code';
  end if;
  v.referral_source_id := nullif(p ->> 'referral_source_id', '')::uuid;
  if v.referral_source_id is not null and not exists (
       select 1 from public.referral_sources s where s.org_id = p_org and s.id = v.referral_source_id) then
    raise exception 'Choisissez une provenance de la liste.' using errcode = 'P0001', hint = 'referral_source_id';
  end if;
  v.referred_by := private.clients_text(p ->> 'referred_by');
  if v.referred_by is not null and (pg_catalog.length(v.referred_by) > 200 or not private.is_tidy_text(v.referred_by)) then
    raise exception '« Référé par » compte 200 caractères au plus.' using errcode = 'P0001', hint = 'referred_by';
  end if;
  -- « Référé par » a file of the clinic, or a typed name: never both (clients_apply_fields clears
  -- the other one when a card sends one). Whether the file may still be chosen (not merged, not
  -- anonymised, not the file itself) is checked when it changes (clients_check_referrer).
  begin
    v.referred_by_client_id := nullif(p ->> 'referred_by_client_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Choisissez un dossier de la clinique.' using errcode = 'P0001', hint = 'referred_by_client_id';
  end;
  if v.referred_by_client_id is not null and not exists (
       select 1 from public.clients r where r.org_id = p_org and r.id = v.referred_by_client_id) then
    raise exception 'Choisissez un dossier de la clinique.' using errcode = 'P0001', hint = 'referred_by_client_id';
  end if;
  if v.referred_by_client_id is not null and v.referred_by is not null then
    raise exception '« Référé par » est un dossier ou un nom écrit, pas les deux.' using errcode = 'P0001', hint = 'referred_by';
  end if;
  v.custom_field := private.clients_text(p ->> 'custom_field');
  if v.custom_field is not null and (pg_catalog.length(v.custom_field) > 200 or not private.is_tidy_text(v.custom_field)) then
    raise exception 'Le champ personnalisé compte 200 caractères au plus.' using errcode = 'P0001', hint = 'custom_field';
  end if;
  v.primary_professional_id := nullif(p ->> 'primary_professional_id', '')::uuid;
  if v.primary_professional_id is not null and not exists (
       select 1 from public.professionals pr where pr.org_id = p_org and pr.id = v.primary_professional_id) then
    raise exception 'Choisissez un professionnel de la clinique.' using errcode = 'P0001', hint = 'primary_professional_id';
  end if;
  v.rate_variant := nullif(p ->> 'rate_variant', '');
  if v.rate_variant is not null and v.rate_variant not in ('student', 'reduced') then
    raise exception 'Le tarif est étudiant ou réduit.' using errcode = 'P0001', hint = 'rate_variant';
  end if;
  v.tax_exempt := coalesce((p ->> 'tax_exempt')::boolean, false);
  v.is_banned := coalesce((p ->> 'is_banned')::boolean, false);
  v.file_incomplete := coalesce((p ->> 'file_incomplete')::boolean, false);
  v.special_agreement := coalesce((p ->> 'special_agreement')::boolean, false);
  v.shared_custody := coalesce((p ->> 'shared_custody')::boolean, false);
  return v;
end;
$$;

revoke all on function private.clients_from_json(uuid, jsonb) from public, anon, authenticated, service_role;

create or replace function public.create_client(p_client jsonb, p_confirm_medium boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v public.clients;
  v_dup record;
  v_id uuid;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  v := private.clients_from_json(v_org, p_client);
  perform private.clients_check_referrer(v_org, null, v.referred_by_client_id);
  -- The same transaction lock as the file number's: two creations of one person never both pass.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('clients.client_number:' || v_org::text, 0));

  select d.level, c.client_number into v_dup
    from private.clients_find_duplicates(v_org, v.first_name, v.last_name, v.email,
                                         array[v.mobile_e164, v.home_e164, v.work_e164], v.birthday, null) d
    join public.clients c on c.id = d.client_id
   order by (d.level = 'high') desc, c.client_number
   limit 1;
  if v_dup.level = 'high' then
    raise exception 'Ce client a déjà un dossier : n° %. Ouvrez le dossier existant.', v_dup.client_number
      using errcode = 'P0001', hint = 'duplicate';
  end if;
  if v_dup.level = 'medium' and not coalesce(p_confirm_medium, false) then
    raise exception 'Un dossier semblable existe (n° %). Vérifiez-le, puis confirmez qu''il s''agit d''une autre personne.', v_dup.client_number
      using errcode = 'P0001', hint = 'duplicate_medium';
  end if;

  insert into public.clients (org_id, first_name, last_name, birth_first_name, pronouns, sex, birthday, email,
                              mobile_e164, home_e164, work_e164, work_ext, language, time_zone,
                              reminders_by_sms, reminders_by_email, address_line1, address_line2, city, province,
                              postal_code, country, referral_source_id, referred_by, referred_by_client_id, custom_field,
                              primary_professional_id, rate_variant, tax_exempt, is_banned, file_incomplete,
                              special_agreement, shared_custody, created_by)
  values (v_org, v.first_name, v.last_name, v.birth_first_name, v.pronouns, v.sex, v.birthday, v.email,
          v.mobile_e164, v.home_e164, v.work_e164, v.work_ext, v.language, v.time_zone,
          v.reminders_by_sms, v.reminders_by_email, v.address_line1, v.address_line2, v.city, v.province,
          v.postal_code, v.country, v.referral_source_id, v.referred_by, v.referred_by_client_id, v.custom_field,
          v.primary_professional_id, v.rate_variant, v.tax_exempt, v.is_banned, v.file_incomplete,
          v.special_agreement, v.shared_custody, auth.uid())
  returning id into v_id;

  perform private.clients_save_notes(v_org, v_id, p_client ->> 'admin_notes', p_client ->> 'special_agreement_note');
  perform private.clients_link_professional(v_org, v_id, v.primary_professional_id, 'primary');
  return v_id;
end;
$$;

revoke all on function public.create_client(jsonb, boolean) from public, anon;
grant execute on function public.create_client(jsonb, boolean) to authenticated;


-- From 20261013052242_clients_merge_privacy_history.sql (update_client and the merge's take go through it).

create or replace function private.clients_apply_fields(p_org uuid, p_id uuid, p_fields jsonb)
returns public.clients
language plpgsql
set search_path = ''
as $$
declare
  v_stored jsonb;
  v_fields jsonb := p_fields;
  v public.clients;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Les informations du client sont requises.' using errcode = '22023';
  end if;
  -- « Référé par »: choosing a file clears the typed name, typing a name clears the file.
  if nullif(v_fields ->> 'referred_by_client_id', '') is not null then
    v_fields := v_fields || '{"referred_by": null}'::jsonb;
  elsif private.clients_text(v_fields ->> 'referred_by') is not null then
    v_fields := v_fields || '{"referred_by_client_id": null}'::jsonb;
  end if;
  select to_jsonb(c) into v_stored from public.clients c where c.org_id = p_org and c.id = p_id;
  v := private.clients_from_json(p_org, v_stored || v_fields);
  if v.referred_by_client_id is distinct from nullif(v_stored ->> 'referred_by_client_id', '')::uuid then
    perform private.clients_check_referrer(p_org, p_id, v.referred_by_client_id);
  end if;
  update public.clients c
     set first_name = v.first_name, last_name = v.last_name, birth_first_name = v.birth_first_name,
         pronouns = v.pronouns, sex = v.sex, birthday = v.birthday, email = v.email,
         mobile_e164 = v.mobile_e164, home_e164 = v.home_e164, work_e164 = v.work_e164, work_ext = v.work_ext,
         language = v.language, time_zone = v.time_zone,
         reminders_by_sms = v.reminders_by_sms, reminders_by_email = v.reminders_by_email,
         address_line1 = v.address_line1, address_line2 = v.address_line2, city = v.city, province = v.province,
         postal_code = v.postal_code, country = v.country, referral_source_id = v.referral_source_id,
         referred_by = v.referred_by, referred_by_client_id = v.referred_by_client_id, custom_field = v.custom_field,
         primary_professional_id = v.primary_professional_id, rate_variant = v.rate_variant,
         tax_exempt = v.tax_exempt, is_banned = v.is_banned, file_incomplete = v.file_incomplete,
         special_agreement = v.special_agreement, shared_custody = v.shared_custody
   where c.org_id = p_org and c.id = p_id;
  perform private.clients_link_professional(p_org, p_id, v.primary_professional_id, 'primary');
  return v;
end;
$$;

revoke all on function private.clients_apply_fields(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

create or replace function private.clients_merge_take_columns(p_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'first_name' then array['first_name']
    when 'last_name' then array['last_name']
    when 'birth_first_name' then array['birth_first_name']
    when 'pronouns' then array['pronouns']
    when 'sex' then array['sex']
    when 'birthday' then array['birthday']
    when 'language' then array['language']
    when 'email' then array['email']
    when 'mobile' then array['mobile_e164']
    when 'home' then array['home_e164']
    when 'work' then array['work_e164', 'work_ext']
    when 'address' then array['address_line1', 'address_line2', 'city', 'province', 'postal_code', 'country']
    when 'referral_source_id' then array['referral_source_id']
    when 'referred_by' then array['referred_by', 'referred_by_client_id']
    when 'primary_professional_id' then array['primary_professional_id']
    when 'rate_variant' then array['rate_variant']
  end
$$;

revoke all on function private.clients_merge_take_columns(text) from public, anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- The merge: Clients' handler (consents, then « Référé par »)
-- -----------------------------------------------------------------------------
-- C5a's handler for the consents stays as it is; Clients' row in client_merge_handlers now names
-- this one, which runs it, then moves the « Référé par » links.
create function private.clients_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
  v_links int;
begin
  v_count := coalesce(private.clients_consents_reassign_client(p_old, p_new), 0);
  -- The kept file never names itself; the files the merged one referred now name the kept one.
  update public.clients c set referred_by_client_id = null where c.id = p_new and c.referred_by_client_id = p_old;
  update public.clients c set referred_by_client_id = p_new where c.referred_by_client_id = p_old and c.id <> p_new;
  get diagnostics v_links = row_count;
  -- The kept file with no « Référé par » takes the merged file's link (C2 fills its other empty
  -- fields, the typed name among them, after the handlers).
  update public.clients k
     set referred_by_client_id = m.referred_by_client_id
    from public.clients m
   where k.id = p_new and m.id = p_old and m.org_id = k.org_id
     and k.referred_by is null and k.referred_by_client_id is null
     and m.referred_by_client_id is not null and m.referred_by_client_id <> p_new;
  return v_count + v_links;
end;
$$;
revoke all on function private.clients_reassign_client(uuid, uuid) from public, anon, authenticated, service_role;

update public.client_merge_handlers
   set function_name = 'private.clients_reassign_client'
 where module_key = 'clients' and function_name = 'private.clients_consents_reassign_client';


-- -----------------------------------------------------------------------------
-- The anonymisation and the record's bundle (from 20261013022641_clients_rpcs.sql)
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
     set file_number = case when x.kind = 'ivac' then 'anonymisé' end, note = null, is_active = false
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

create or replace function private.clients_summary(p_org uuid, p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_client public.clients;
begin
  select c.* into v_client from public.clients c where c.org_id = p_org and c.id = p_id;
  if v_client.id is null then
    raise exception 'Dossier client introuvable.' using errcode = 'P0001', hint = 'client_id';
  end if;
  return jsonb_build_object(
    'client', pg_catalog.to_jsonb(v_client),
    'referrer', (select jsonb_build_object('id', r.id, 'client_number', r.client_number,
                                           'display_name', case when r.anonymized_at is null then r.first_name || ' ' || r.last_name end,
                                           'anonymized', r.anonymized_at is not null,
                                           'archived', r.archived_at is not null)
                   from public.clients r where r.org_id = p_org and r.id = v_client.referred_by_client_id),
    'notes', (select jsonb_build_object('admin_notes', n.admin_notes, 'special_agreement_note', n.special_agreement_note,
                                        'updated_at', n.updated_at)
                from public.client_notes n where n.client_id = p_id),
    'relations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'related_id', x.other_id, 'related_number', o.client_number,
               'related_name', o.first_name || ' ' || o.last_name, 'related_archived', o.archived_at is not null,
               'type', x.type_to_client,
               'related_rights', jsonb_build_object('main_contact', x.o_main, 'manages_appointments', x.o_manage,
                                                    'receives_communications', x.o_comm, 'receives_invoices', x.o_inv),
               'client_rights', jsonb_build_object('main_contact', x.c_main, 'manages_appointments', x.c_manage,
                                                   'receives_communications', x.c_comm, 'receives_invoices', x.c_inv))
             order by o.last_name, o.first_name)
        from (select r.id, r.client_a_id as other_id, r.type_a_to_b as type_to_client,
                     r.a_main_contact as o_main, r.a_manages_appointments as o_manage, r.a_receives_communications as o_comm, r.a_receives_invoices as o_inv,
                     r.b_main_contact as c_main, r.b_manages_appointments as c_manage, r.b_receives_communications as c_comm, r.b_receives_invoices as c_inv
                from public.client_relations r where r.client_b_id = p_id
              union all
              select r.id, r.client_b_id, r.type_b_to_a,
                     r.b_main_contact, r.b_manages_appointments, r.b_receives_communications, r.b_receives_invoices,
                     r.a_main_contact, r.a_manages_appointments, r.a_receives_communications, r.a_receives_invoices
                from public.client_relations r where r.client_a_id = p_id) x
        join public.clients o on o.id = x.other_id), '[]'::jsonb),
    'insurances', coalesce((select jsonb_agg(pg_catalog.to_jsonb(i) - 'org_id' order by i.rank)
                              from public.client_insurances i where i.client_id = p_id), '[]'::jsonb),
    'payers', coalesce((select jsonb_agg(pg_catalog.to_jsonb(x) - 'org_id' order by x.is_active desc, x.created_at desc)
                          from public.client_payers x where x.client_id = p_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.sort_order, t.name)
                        from public.client_tag_links l join public.client_tags t on t.id = l.tag_id
                       where l.client_id = p_id), '[]'::jsonb),
    'professionals', coalesce((select jsonb_agg(jsonb_build_object('professional_id', l.professional_id, 'reason', l.reason,
                                                                   'first_linked_at', l.first_linked_at, 'last_linked_at', l.last_linked_at)
                                                order by l.first_linked_at)
                                 from public.client_professional_links l where l.client_id = p_id), '[]'::jsonb),
    'merges', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kept_client_id', m.kept_client_id,
                                                            'merged_client_id', m.merged_client_id, 'merged_at', m.merged_at,
                                                            'moved', m.moved) order by m.merged_at)
                          from public.client_merges m where m.kept_client_id = p_id or m.merged_client_id = p_id), '[]'::jsonb));
end;
$$;

revoke all on function private.clients_summary(uuid, uuid) from public, anon, authenticated, service_role;
