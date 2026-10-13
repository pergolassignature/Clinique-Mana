-- =============================================================================
-- Clients: the RPCs (plan C2.2 – C2.4)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §6.3 (C2)
-- Decisions: CL-1 … CL-18 (decisions log), I-5 (duplicates), R-48, R-54, R-61
--
-- Every write of the module, definer, permission first, French P0001 with a HINT naming the field:
-- - files: create_client (refuses a HIGH duplicate, asks a confirmation for a MEDIUM one),
--   update_client, set_client_notes, archive_client, unarchive_client;
-- - relations: set_client_relation (the pair once, the three rights per direction, one main
--   contact per client), remove_client_relation;
-- - insurance, payers, tags: upsert / delete_client_insurance, save / end_client_payer,
--   set_client_tags, and the clinic's tag list (save_client_tag, set_client_tag_active);
-- - merge_clients (clients.merge): moves everything to the kept file, resolving the collisions,
--   runs the other modules' reassign handlers (client_merge_handlers), archives the merged file;
-- - Loi 25 (clients.privacy): export_client_privacy (logged read), anonymize_client.
-- Reads: search_clients (⌘K; staff, or a professional's own clients), get_client_summary (the
-- record's bundle), the view client_payers_active (Facturation). For other modules:
-- private.client_contacts_for (who receives what, on which channels) and
-- private.clients_unlink_professional.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_rpcs', true);

-- -----------------------------------------------------------------------------
-- Helpers (granted to no role)
-- -----------------------------------------------------------------------------
-- A phone typed any way → E.164 (the import's toE164 without the separate country column, and
-- Communications' sms_normalize_e164): +… as typed, 10 digits (North America) → +1…, 11 digits
-- starting with 1 → +…; null when empty; « invalid » when it cannot be read.
create function private.clients_e164(p_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw text := pg_catalog.btrim(coalesce(p_input, ''));
  v_digits text := pg_catalog.regexp_replace(v_raw, '[^0-9]', '', 'g');
begin
  if v_digits = '' then
    return null;
  end if;
  if pg_catalog.left(v_raw, 1) = '+' then
    return case when v_digits ~ '^[1-9][0-9]{7,14}$' then '+' || v_digits else 'invalid' end;
  end if;
  if pg_catalog.length(v_digits) = 10 and v_digits ~ '^[2-9]' then
    return '+1' || v_digits;
  end if;
  if pg_catalog.length(v_digits) = 11 and v_digits ~ '^1[2-9]' then
    return '+' || v_digits;
  end if;
  return 'invalid';
end;
$$;
revoke all on function private.clients_e164(text) from public, anon, authenticated, service_role;

-- Trimmed text, spaces inside collapsed; null when empty.
create function private.clients_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_value, '')), '\s+', ' ', 'g'), '')
$$;
revoke all on function private.clients_text(text) from public, anon, authenticated, service_role;

-- A client of the caller's clinic, locked for the write; « Dossier introuvable » otherwise
-- (a merged or anonymised file refuses every write but the Loi 25 export).
create function private.clients_lock(p_org uuid, p_id uuid, p_allow_closed boolean default false)
returns public.clients
language plpgsql
set search_path = ''
as $$
declare
  v_row public.clients;
begin
  select c.* into v_row from public.clients c where c.org_id = p_org and c.id = p_id for no key update;
  if v_row.id is null then
    raise exception 'Dossier client introuvable.' using errcode = 'P0001', hint = 'client_id';
  end if;
  if not p_allow_closed and v_row.merged_into_id is not null then
    raise exception 'Ce dossier a été fusionné dans un autre : modifiez le dossier conservé.' using errcode = 'P0001', hint = 'merged';
  end if;
  if not p_allow_closed and v_row.anonymized_at is not null then
    raise exception 'Ce dossier a été anonymisé : il ne se modifie plus.' using errcode = 'P0001', hint = 'anonymized';
  end if;
  return v_row;
end;
$$;
revoke all on function private.clients_lock(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- The editable fields of a file from the form's JSON (the keys of `clients`, plus the notes),
-- normalised and checked: French P0001 with the field as HINT. The row returned has no id,
-- org, number or state.
create function private.clients_from_json(p_org uuid, p jsonb)
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
  if v.time_zone is not null and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v.time_zone) then
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
  end if;
  v.postal_code := pg_catalog.upper(private.clients_text(p ->> 'postal_code'));
  if v.postal_code is not null and v.country = 'CA' then
    v_text := pg_catalog.regexp_replace(v.postal_code, '\s', '', 'g');
    if v_text !~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$' then
      raise exception 'Le code postal a la forme A1A 1A1.' using errcode = 'P0001', hint = 'postal_code';
    end if;
    v.postal_code := pg_catalog.left(v_text, 3) || ' ' || pg_catalog.right(v_text, 3);
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

-- The staff notes from the form's JSON (null keys: no change).
create function private.clients_save_notes(p_org uuid, p_client_id uuid, p_admin_notes text, p_special_agreement_note text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_admin text := nullif(pg_catalog.btrim(coalesce(p_admin_notes, '')), '');
  v_special text := nullif(pg_catalog.btrim(coalesce(p_special_agreement_note, '')), '');
begin
  if v_admin is not null and pg_catalog.length(v_admin) > 5000 then
    raise exception 'Les notes administratives comptent 5 000 caractères au plus.' using errcode = 'P0001', hint = 'admin_notes';
  end if;
  if v_special is not null and pg_catalog.length(v_special) > 1000 then
    raise exception 'La note de l''entente particulière compte 1 000 caractères au plus.' using errcode = 'P0001', hint = 'special_agreement_note';
  end if;
  if v_admin is null and v_special is null then
    delete from public.client_notes n where n.client_id = p_client_id;
    return;
  end if;
  insert into public.client_notes (client_id, org_id, admin_notes, special_agreement_note, updated_by)
  values (p_client_id, p_org, v_admin, v_special, auth.uid())
  on conflict (client_id) do update
    set admin_notes = excluded.admin_notes, special_agreement_note = excluded.special_agreement_note, updated_by = excluded.updated_by
    where client_notes.admin_notes is distinct from excluded.admin_notes
       or client_notes.special_agreement_note is distinct from excluded.special_agreement_note;
end;
$$;
revoke all on function private.clients_save_notes(uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Files (clients.manage)
-- -----------------------------------------------------------------------------
-- Creates a file. A HIGH duplicate is refused (HINT duplicate, the number of the file to open);
-- a MEDIUM one needs p_confirm_medium (HINT duplicate_medium). The primary professional is linked.
create function public.create_client(p_client jsonb, p_confirm_medium boolean default false)
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
                              postal_code, country, referral_source_id, referred_by, custom_field,
                              primary_professional_id, rate_variant, tax_exempt, is_banned, file_incomplete,
                              special_agreement, shared_custody, created_by)
  values (v_org, v.first_name, v.last_name, v.birth_first_name, v.pronouns, v.sex, v.birthday, v.email,
          v.mobile_e164, v.home_e164, v.work_e164, v.work_ext, v.language, v.time_zone,
          v.reminders_by_sms, v.reminders_by_email, v.address_line1, v.address_line2, v.city, v.province,
          v.postal_code, v.country, v.referral_source_id, v.referred_by, v.custom_field,
          v.primary_professional_id, v.rate_variant, v.tax_exempt, v.is_banned, v.file_incomplete,
          v.special_agreement, v.shared_custody, auth.uid())
  returning id into v_id;

  perform private.clients_save_notes(v_org, v_id, p_client ->> 'admin_notes', p_client ->> 'special_agreement_note');
  perform private.clients_link_professional(v_org, v_id, v.primary_professional_id, 'primary');
  return v_id;
end;
$$;

-- Saves the editable fields of a file (the form sends them all; duplicates are not re-checked:
-- the record shows them). A new primary professional is linked.
create function public.update_client(p_id uuid, p_client jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v public.clients;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_id);
  v := private.clients_from_json(v_org, p_client);
  update public.clients c
     set first_name = v.first_name, last_name = v.last_name, birth_first_name = v.birth_first_name,
         pronouns = v.pronouns, sex = v.sex, birthday = v.birthday, email = v.email,
         mobile_e164 = v.mobile_e164, home_e164 = v.home_e164, work_e164 = v.work_e164, work_ext = v.work_ext,
         language = v.language, time_zone = v.time_zone,
         reminders_by_sms = v.reminders_by_sms, reminders_by_email = v.reminders_by_email,
         address_line1 = v.address_line1, address_line2 = v.address_line2, city = v.city, province = v.province,
         postal_code = v.postal_code, country = v.country, referral_source_id = v.referral_source_id,
         referred_by = v.referred_by, custom_field = v.custom_field,
         primary_professional_id = v.primary_professional_id, rate_variant = v.rate_variant,
         tax_exempt = v.tax_exempt, is_banned = v.is_banned, file_incomplete = v.file_incomplete,
         special_agreement = v.special_agreement, shared_custody = v.shared_custody
   where c.id = p_id;
  if p_client ? 'admin_notes' or p_client ? 'special_agreement_note' then
    perform private.clients_save_notes(v_org, p_id, p_client ->> 'admin_notes', p_client ->> 'special_agreement_note');
  end if;
  perform private.clients_link_professional(v_org, p_id, v.primary_professional_id, 'primary');
end;
$$;

-- The staff notes alone (the record's « Notes administratives » card).
create function public.set_client_notes(p_id uuid, p_admin_notes text, p_special_agreement_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_id);
  perform private.clients_save_notes(v_org, p_id, p_admin_notes, p_special_agreement_note);
end;
$$;

create function public.archive_client(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_id);
  update public.clients c set archived_at = now(), archived_by = auth.uid() where c.id = p_id and c.archived_at is null;
end;
$$;

create function public.unarchive_client(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_id);
  update public.clients c set archived_at = null, archived_by = null where c.id = p_id and c.archived_at is not null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Relations (clients.manage)
-- -----------------------------------------------------------------------------
-- What a relation type is seen from the other side.
create function private.clients_inverse_relation(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type when 'parent' then 'child' when 'child' then 'parent'
                     when 'guardian' then 'ward' when 'ward' then 'guardian'
                     when 'spouse' then 'spouse' when 'sibling' then 'sibling' when 'other' then 'other' end
$$;
revoke all on function private.clients_inverse_relation(text) from public, anon, authenticated, service_role;

-- Sets the relation of p_related to p_client: p_type is what the related person is to the client
-- (« parent »); p_related_rights what she may do for the client, p_client_rights the reverse:
-- objects {main_contact, manages_appointments, receives_communications, receives_invoices}.
-- The pair is stored once; making someone a client's main contact clears the client's other one.
create function public.set_client_relation(p_client_id uuid, p_related_id uuid, p_type text,
                                           p_related_rights jsonb default '{}', p_client_rights jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_inverse text := private.clients_inverse_relation(p_type);
  v_existing uuid;
  r_main boolean := coalesce((p_related_rights ->> 'main_contact')::boolean, false);
  r_manage boolean := coalesce((p_related_rights ->> 'manages_appointments')::boolean, false);
  r_comm boolean := coalesce((p_related_rights ->> 'receives_communications')::boolean, false);
  r_inv boolean := coalesce((p_related_rights ->> 'receives_invoices')::boolean, false);
  c_main boolean := coalesce((p_client_rights ->> 'main_contact')::boolean, false);
  c_manage boolean := coalesce((p_client_rights ->> 'manages_appointments')::boolean, false);
  c_comm boolean := coalesce((p_client_rights ->> 'receives_communications')::boolean, false);
  c_inv boolean := coalesce((p_client_rights ->> 'receives_invoices')::boolean, false);
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  if v_inverse is null then
    raise exception 'Choisissez le lien (parent, enfant, tuteur, conjoint, fratrie, autre).' using errcode = 'P0001', hint = 'type';
  end if;
  if p_client_id = p_related_id then
    raise exception 'Un client ne peut pas être lié à lui-même.' using errcode = 'P0001', hint = 'related_client_id';
  end if;
  -- Both files locked in id order (no deadlock between two writers of the same pair).
  perform private.clients_lock(v_org, least(p_client_id, p_related_id));
  perform private.clients_lock(v_org, greatest(p_client_id, p_related_id));

  -- One main contact per client: the related person's « main contact » flag toward this client
  -- clears the client's other main contact (and the reverse).
  if r_main then
    update public.client_relations r set a_main_contact = false
     where r.org_id = v_org and r.client_b_id = p_client_id and r.client_a_id <> p_related_id and r.a_main_contact;
    update public.client_relations r set b_main_contact = false
     where r.org_id = v_org and r.client_a_id = p_client_id and r.client_b_id <> p_related_id and r.b_main_contact;
  end if;
  if c_main then
    update public.client_relations r set a_main_contact = false
     where r.org_id = v_org and r.client_b_id = p_related_id and r.client_a_id <> p_client_id and r.a_main_contact;
    update public.client_relations r set b_main_contact = false
     where r.org_id = v_org and r.client_a_id = p_related_id and r.client_b_id <> p_client_id and r.b_main_contact;
  end if;

  select r.id into v_existing from public.client_relations r
   where r.org_id = v_org and r.client_a_id = least(p_client_id, p_related_id) and r.client_b_id = greatest(p_client_id, p_related_id);
  -- Written as « a = the related person, b = the client »; the trigger sorts the pair.
  if v_existing is null then
    insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a,
                                         a_main_contact, a_manages_appointments, a_receives_communications, a_receives_invoices,
                                         b_main_contact, b_manages_appointments, b_receives_communications, b_receives_invoices, created_by)
    values (v_org, p_related_id, p_client_id, p_type, v_inverse, r_main, r_manage, r_comm, r_inv, c_main, c_manage, c_comm, c_inv, auth.uid());
  else
    update public.client_relations r
       set client_a_id = p_related_id, client_b_id = p_client_id, type_a_to_b = p_type, type_b_to_a = v_inverse,
           a_main_contact = r_main, a_manages_appointments = r_manage, a_receives_communications = r_comm, a_receives_invoices = r_inv,
           b_main_contact = c_main, b_manages_appointments = c_manage, b_receives_communications = c_comm, b_receives_invoices = c_inv
     where r.id = v_existing;
  end if;
end;
$$;

create function public.remove_client_relation(p_client_id uuid, p_related_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  delete from public.client_relations r
   where r.org_id = v_org and r.client_a_id = least(p_client_id, p_related_id) and r.client_b_id = greatest(p_client_id, p_related_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Insurance, payers, tags (clients.manage)
-- -----------------------------------------------------------------------------
create function public.upsert_client_insurance(p_client_id uuid, p_rank int, p_insurer text, p_policy_number text,
                                               p_certificate_number text, p_holder_relation text, p_holder_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_insurer text := private.clients_text(p_insurer);
  v_policy text := private.clients_text(p_policy_number);
  v_certificate text := private.clients_text(p_certificate_number);
  v_holder text := private.clients_text(p_holder_name);
  v_relation text := coalesce(nullif(p_holder_relation, ''), 'self');
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_client_id);
  if p_rank is null or p_rank not in (1, 2) then
    raise exception 'L''assurance est principale ou secondaire.' using errcode = 'P0001', hint = 'rank';
  end if;
  if v_insurer is null or pg_catalog.length(v_insurer) > 120 or not private.is_tidy_text(v_insurer) then
    raise exception 'Indiquez l''assureur (120 caractères au plus).' using errcode = 'P0001', hint = 'insurer';
  end if;
  if v_policy is not null and (pg_catalog.length(v_policy) > 60 or not private.is_tidy_text(v_policy)) then
    raise exception 'Le numéro de police compte 60 caractères au plus.' using errcode = 'P0001', hint = 'policy_number';
  end if;
  if v_certificate is not null and (pg_catalog.length(v_certificate) > 60 or not private.is_tidy_text(v_certificate)) then
    raise exception 'Le numéro de certificat compte 60 caractères au plus.' using errcode = 'P0001', hint = 'certificate_number';
  end if;
  if v_relation not in ('self', 'spouse', 'parent', 'other') then
    raise exception 'Choisissez le lien avec l''assuré.' using errcode = 'P0001', hint = 'holder_relation';
  end if;
  if v_holder is not null and (pg_catalog.length(v_holder) > 200 or not private.is_tidy_text(v_holder)) then
    raise exception 'Le nom de l''assuré compte 200 caractères au plus.' using errcode = 'P0001', hint = 'holder_name';
  end if;
  insert into public.client_insurances (client_id, rank, org_id, insurer, policy_number, certificate_number, holder_relation, holder_name)
  values (p_client_id, p_rank, v_org, v_insurer, v_policy, v_certificate, v_relation, v_holder)
  on conflict (client_id, rank) do update
    set insurer = excluded.insurer, policy_number = excluded.policy_number, certificate_number = excluded.certificate_number,
        holder_relation = excluded.holder_relation, holder_name = excluded.holder_name;
end;
$$;

create function public.delete_client_insurance(p_client_id uuid, p_rank int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_client_id);
  delete from public.client_insurances i where i.client_id = p_client_id and i.rank = p_rank;
  -- The secondary becomes the main one.
  if p_rank = 1 then
    update public.client_insurances i set rank = 1 where i.client_id = p_client_id and i.rank = 2;
  end if;
end;
$$;

-- Creates (p_id null) or updates an active payer: one active per kind and client (an existing
-- one is updated), an active IVAC file number once in the clinic.
create function public.save_client_payer(p_client_id uuid, p_id uuid, p_kind text, p_organisation_name text, p_file_number text,
                                         p_session_amount_cents int, p_max_sessions int, p_max_amount_cents int,
                                         p_starts_on date, p_expires_on date, p_note text)
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
  if p_max_sessions is not null and p_max_sessions not between 1 and 999 then
    raise exception 'Le nombre maximal de séances est compris entre 1 et 999.' using errcode = 'P0001', hint = 'max_sessions';
  end if;
  if p_max_amount_cents is not null and p_max_amount_cents not between 1 and 100000000 then
    raise exception 'Le montant maximal est compris entre 0,01 $ et 1 000 000 $.' using errcode = 'P0001', hint = 'max_amount_cents';
  end if;
  if p_starts_on is not null and p_expires_on is not null and p_expires_on < p_starts_on then
    raise exception 'L''échéance doit suivre le début.' using errcode = 'P0001', hint = 'expires_on';
  end if;
  if v_note is not null and pg_catalog.length(v_note) > 1000 then
    raise exception 'La note compte 1 000 caractères au plus.' using errcode = 'P0001', hint = 'note';
  end if;

  if v_id is null then
    select x.id into v_id from public.client_payers x where x.client_id = p_client_id and x.kind = p_kind and x.is_active;
  elsif not exists (select 1 from public.client_payers x where x.client_id = p_client_id and x.id = v_id and x.is_active) then
    raise exception 'Payeur introuvable.' using errcode = 'P0001', hint = 'id';
  end if;
  if v_id is null then
    insert into public.client_payers (client_id, org_id, kind, organisation_name, file_number, session_amount_cents, max_sessions,
                                      max_amount_cents, starts_on, expires_on, note, created_by)
    values (p_client_id, v_org, p_kind, v_org_name, v_file, p_session_amount_cents, p_max_sessions, p_max_amount_cents,
            p_starts_on, p_expires_on, v_note, auth.uid())
    returning id into v_id;
  else
    update public.client_payers x
       set kind = p_kind, organisation_name = v_org_name, file_number = v_file, session_amount_cents = p_session_amount_cents,
           max_sessions = p_max_sessions, max_amount_cents = p_max_amount_cents, starts_on = p_starts_on,
           expires_on = p_expires_on, note = v_note
     where x.id = v_id;
  end if;
  return v_id;
end;
$$;

-- Ends a payer (kept, inactive: past invoices name it).
create function public.end_client_payer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_client uuid;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  select x.client_id into v_client from public.client_payers x where x.org_id = v_org and x.id = p_id;
  if v_client is null then
    raise exception 'Payeur introuvable.' using errcode = 'P0001', hint = 'id';
  end if;
  perform private.clients_lock(v_org, v_client);
  update public.client_payers x set is_active = false where x.id = p_id and x.is_active;
end;
$$;

-- Replaces a client's tags: at most 5 active tags of the clinic. Unchanged links are kept.
create function public.set_client_tags(p_client_id uuid, p_tag_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[] := array(select distinct x from pg_catalog.unnest(coalesce(p_tag_ids, '{}'::uuid[])) x where x is not null);
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_client_id);
  if pg_catalog.cardinality(v_ids) > 5 then
    raise exception 'Un client a au plus 5 étiquettes.' using errcode = 'P0001', hint = 'tag_ids';
  end if;
  if exists (select 1 from pg_catalog.unnest(v_ids) x
              where not exists (select 1 from public.client_tags t where t.org_id = v_org and t.id = x and t.is_active)) then
    raise exception 'Une des étiquettes choisies n''existe pas ou est archivée.' using errcode = 'P0001', hint = 'tag_ids';
  end if;
  delete from public.client_tag_links l where l.client_id = p_client_id and not (l.tag_id = any (v_ids));
  insert into public.client_tag_links (client_id, tag_id, org_id)
  select p_client_id, x, v_org from pg_catalog.unnest(v_ids) x
  on conflict do nothing;
end;
$$;

-- The clinic's tag list: creates (p_id null) or renames a tag.
create function public.save_client_tag(p_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_name text := private.clients_text(p_name);
  v_id uuid := p_id;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  if v_name is null or pg_catalog.length(v_name) > 40 or not private.is_tidy_text(v_name) then
    raise exception 'Indiquez le nom de l''étiquette (40 caractères au plus).' using errcode = 'P0001', hint = 'name';
  end if;
  if exists (select 1 from public.client_tags t where t.org_id = v_org and lower(normalize(t.name, NFKC)) = lower(normalize(v_name, NFKC))
               and (v_id is null or t.id <> v_id)) then
    raise exception 'Cette étiquette existe déjà.' using errcode = 'P0001', hint = 'name';
  end if;
  if v_id is null then
    insert into public.client_tags (org_id, name, sort_order)
    values (v_org, v_name, coalesce((select max(t.sort_order) from public.client_tags t where t.org_id = v_org), 0) + 10)
    returning id into v_id;
  else
    update public.client_tags t set name = v_name where t.org_id = v_org and t.id = v_id;
    if not found then
      raise exception 'Étiquette introuvable.' using errcode = 'P0001', hint = 'id';
    end if;
  end if;
  return v_id;
end;
$$;

create function public.set_client_tag_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  update public.client_tags t set is_active = coalesce(p_active, true)
   where t.org_id = private.current_user_org_id() and t.id = p_id;
  if not found then
    raise exception 'Étiquette introuvable.' using errcode = 'P0001', hint = 'id';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Links (for other modules)
-- -----------------------------------------------------------------------------
-- Ends a professional's sight of a client (Demandes' reassignment): the link goes, unless she is
-- still the client's primary professional. For definer callers, after their permission check.
create function private.clients_unlink_professional(p_org uuid, p_client_id uuid, p_professional_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.client_professional_links l
   where l.org_id = p_org and l.client_id = p_client_id and l.professional_id = p_professional_id
     and not exists (select 1 from public.clients c where c.id = p_client_id and c.primary_professional_id = p_professional_id);
end;
$$;
revoke all on function private.clients_unlink_professional(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Who receives what for a client (Communications' reminders, Facturation's receipts, C5a's signers):
-- the client herself (is_self) and every relation holding the right, with their own channels.
-- p_right: 'communications' (receives_communications), 'invoices' (receives_invoices),
-- 'appointments' (manages_appointments: may book and sign forms for her). The callers decide what
-- the client's age means (the 14-year consent rule is C5a's).
create function private.client_contacts_for(p_client_id uuid, p_right text)
returns table (client_id uuid, is_self boolean, relation_type text, first_name text, last_name text, language text,
               email text, mobile_e164 text, reminders_by_sms boolean, reminders_by_email boolean, is_main_contact boolean)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_right is null or p_right not in ('communications', 'invoices', 'appointments') then
    raise exception 'Droit inconnu : %', p_right using errcode = '22023';
  end if;
  return query
    select c.id, true, null::text, c.first_name, c.last_name, c.language, c.email, c.mobile_e164,
           c.reminders_by_sms, c.reminders_by_email, false
      from public.clients c
     where c.id = p_client_id and c.merged_into_id is null and c.anonymized_at is null
    union all
    select o.id, false, x.type_to_client, o.first_name, o.last_name, o.language, o.email, o.mobile_e164,
           o.reminders_by_sms, o.reminders_by_email, x.main_contact
      from (select r.client_a_id as other_id, r.type_a_to_b as type_to_client, r.a_main_contact as main_contact,
                   case p_right when 'communications' then r.a_receives_communications
                                when 'invoices' then r.a_receives_invoices
                                else r.a_manages_appointments end as has_right
              from public.client_relations r where r.client_b_id = p_client_id
            union all
            select r.client_b_id, r.type_b_to_a, r.b_main_contact,
                   case p_right when 'communications' then r.b_receives_communications
                                when 'invoices' then r.b_receives_invoices
                                else r.b_manages_appointments end
              from public.client_relations r where r.client_a_id = p_client_id) x
      join public.clients o on o.id = x.other_id
     where x.has_right and o.merged_into_id is null and o.anonymized_at is null;
end;
$$;
revoke all on function private.client_contacts_for(uuid, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Merge (clients.merge)
-- -----------------------------------------------------------------------------
-- The other modules' part of a merge, named here by data (ADR 0003): each row names a
-- `private.<module>_reassign_client(old uuid, new uuid)` function that moves the module's rows
-- from the merged file to the kept one. Professionnels' is seeded below; Rendez-vous, Facturation
-- and Demandes add theirs.
create table public.client_merge_handlers (
  module_key text primary key references public.modules(key),
  function_name text not null,
  constraint client_merge_handlers_function_name_check check (function_name ~ '^private\.[a-z][a-z0-9_]{2,62}_reassign_client$')
);
revoke all on public.client_merge_handlers from anon, authenticated;
alter table public.client_merge_handlers enable row level security;

-- Professionnels: an « Entente particulière » follows the kept file (CL-11).
create function private.professionals_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.professional_client_agreements a set client_id = p_new where a.client_id = p_old;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.professionals_reassign_client(uuid, uuid) from public, anon, authenticated, service_role;
insert into public.client_merge_handlers (module_key, function_name)
values ('professionals', 'private.professionals_reassign_client')
on conflict do nothing;

-- Merges p_merge into p_keep: the relations (a relation between the two goes; a person related to
-- both keeps one row with the rights of both), insurance (the kept file's first; a free rank is
-- filled), payers (an active one of a kind the kept file already has is ended), tags (up to 5),
-- the professionals' links, the notes (appended), the other modules' rows (handlers); the empty
-- fields of the kept file are filled from the merged one; the merged file is archived with
-- merged_into_id; client_merges keeps the counts. Returns the merge's id.
create function public.merge_clients(p_keep uuid, p_merge uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_keep public.clients;
  v_merge public.clients;
  r record;
  v_kept_rel public.client_relations;
  v_relations int := 0;
  v_insurances int := 0;
  v_payers int := 0;
  v_tags int := 0;
  v_links int := 0;
  v_handlers jsonb := '{}';
  v_count int;
  v_id uuid;
begin
  if not private.has_permission('clients.merge') then
    raise exception 'Permission refusée : clients.merge' using errcode = '42501';
  end if;
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Choisissez deux dossiers différents.' using errcode = 'P0001', hint = 'merge';
  end if;
  -- Both files locked in id order (no deadlock with a concurrent merge or relation write).
  perform private.clients_lock(v_org, least(p_keep, p_merge));
  perform private.clients_lock(v_org, greatest(p_keep, p_merge));
  select c.* into v_keep from public.clients c where c.id = p_keep;
  select c.* into v_merge from public.clients c where c.id = p_merge;

  -- Relations: the one between the two goes; then each relation of the merged file.
  delete from public.client_relations x
   where x.org_id = v_org and x.client_a_id = least(p_keep, p_merge) and x.client_b_id = greatest(p_keep, p_merge);
  for r in
    select x.*, case when x.client_a_id = p_merge then x.client_b_id else x.client_a_id end as other_id
      from public.client_relations x where x.org_id = v_org and (x.client_a_id = p_merge or x.client_b_id = p_merge)
  loop
    select k.* into v_kept_rel from public.client_relations k
     where k.org_id = v_org and k.client_a_id = least(p_keep, r.other_id) and k.client_b_id = greatest(p_keep, r.other_id);
    if v_kept_rel.id is null then
      -- Moved: the merged side replaced by the kept file (the trigger re-sorts the pair whole).
      if r.client_a_id = p_merge then
        update public.client_relations x set client_a_id = p_keep where x.id = r.id;
      else
        update public.client_relations x set client_b_id = p_keep where x.id = r.id;
      end if;
    else
      -- Both related to the same person: the kept row takes the rights of both, the other goes.
      -- Rights of « other » toward the client and of the client toward « other », side-aware.
      update public.client_relations k
         set a_main_contact = k.a_main_contact or (case when k.client_a_id = r.other_id
                                                        then (case when r.client_a_id = r.other_id then r.a_main_contact else r.b_main_contact end)
                                                        else (case when r.client_a_id = p_merge then r.a_main_contact else r.b_main_contact end) end),
             a_manages_appointments = k.a_manages_appointments or (case when k.client_a_id = r.other_id
                                                        then (case when r.client_a_id = r.other_id then r.a_manages_appointments else r.b_manages_appointments end)
                                                        else (case when r.client_a_id = p_merge then r.a_manages_appointments else r.b_manages_appointments end) end),
             a_receives_communications = k.a_receives_communications or (case when k.client_a_id = r.other_id
                                                        then (case when r.client_a_id = r.other_id then r.a_receives_communications else r.b_receives_communications end)
                                                        else (case when r.client_a_id = p_merge then r.a_receives_communications else r.b_receives_communications end) end),
             a_receives_invoices = k.a_receives_invoices or (case when k.client_a_id = r.other_id
                                                        then (case when r.client_a_id = r.other_id then r.a_receives_invoices else r.b_receives_invoices end)
                                                        else (case when r.client_a_id = p_merge then r.a_receives_invoices else r.b_receives_invoices end) end),
             b_main_contact = k.b_main_contact or (case when k.client_b_id = r.other_id
                                                        then (case when r.client_a_id = r.other_id then r.a_main_contact else r.b_main_contact end)
                                                        else (case when r.client_a_id = p_merge then r.a_main_contact else r.b_main_contact end) end),
             b_manages_appointments = k.b_manages_appointments or (case when k.client_b_id = r.other_id
                                                        then (case when r.client_a_id = r.other_id then r.a_manages_appointments else r.b_manages_appointments end)
                                                        else (case when r.client_a_id = p_merge then r.a_manages_appointments else r.b_manages_appointments end) end),
             b_receives_communications = k.b_receives_communications or (case when k.client_b_id = r.other_id
                                                        then (case when r.client_a_id = r.other_id then r.a_receives_communications else r.b_receives_communications end)
                                                        else (case when r.client_a_id = p_merge then r.a_receives_communications else r.b_receives_communications end) end),
             b_receives_invoices = k.b_receives_invoices or (case when k.client_b_id = r.other_id
                                                        then (case when r.client_a_id = r.other_id then r.a_receives_invoices else r.b_receives_invoices end)
                                                        else (case when r.client_a_id = p_merge then r.a_receives_invoices else r.b_receives_invoices end) end)
       where k.id = v_kept_rel.id;
      delete from public.client_relations x where x.id = r.id;
    end if;
    v_relations := v_relations + 1;
  end loop;

  -- Insurance: the kept file's ranks first; the merged file's fill the free ones.
  for r in select i.* from public.client_insurances i where i.client_id = p_merge order by i.rank loop
    if not exists (select 1 from public.client_insurances k where k.client_id = p_keep and k.rank = 1) then
      update public.client_insurances i set client_id = p_keep, rank = 1 where i.client_id = p_merge and i.rank = r.rank;
      v_insurances := v_insurances + 1;
    elsif not exists (select 1 from public.client_insurances k where k.client_id = p_keep and k.rank = 2) then
      update public.client_insurances i set client_id = p_keep, rank = 2 where i.client_id = p_merge and i.rank = r.rank;
      v_insurances := v_insurances + 1;
    else
      delete from public.client_insurances i where i.client_id = p_merge and i.rank = r.rank;
    end if;
  end loop;

  -- Payers: all move; an active one of a kind the kept file already has is ended first.
  update public.client_payers x set is_active = false
   where x.client_id = p_merge and x.is_active
     and exists (select 1 from public.client_payers k where k.client_id = p_keep and k.kind = x.kind and k.is_active);
  update public.client_payers x set client_id = p_keep where x.client_id = p_merge;
  get diagnostics v_payers = row_count;

  -- Tags: the merged file's that the kept one lacks, while it has fewer than 5.
  for r in select l.tag_id from public.client_tag_links l where l.client_id = p_merge order by l.created_at loop
    if not exists (select 1 from public.client_tag_links k where k.client_id = p_keep and k.tag_id = r.tag_id)
       and (select count(*) from public.client_tag_links k where k.client_id = p_keep) < 5 then
      update public.client_tag_links l set client_id = p_keep where l.client_id = p_merge and l.tag_id = r.tag_id;
      v_tags := v_tags + 1;
    end if;
  end loop;
  delete from public.client_tag_links l where l.client_id = p_merge;

  -- The professionals' links: the earliest first link, the latest last one.
  for r in select l.* from public.client_professional_links l where l.client_id = p_merge loop
    insert into public.client_professional_links (client_id, professional_id, org_id, reason, first_linked_at, last_linked_at)
    values (p_keep, r.professional_id, v_org, r.reason, r.first_linked_at, r.last_linked_at)
    on conflict (client_id, professional_id) do update
      set first_linked_at = least(client_professional_links.first_linked_at, excluded.first_linked_at),
          last_linked_at = greatest(client_professional_links.last_linked_at, excluded.last_linked_at);
    v_links := v_links + 1;
  end loop;
  delete from public.client_professional_links l where l.client_id = p_merge;

  -- Notes: the merged file's appended under the kept one's.
  insert into public.client_notes (client_id, org_id, admin_notes, special_agreement_note, updated_by)
  select p_keep, v_org, n.admin_notes, n.special_agreement_note, auth.uid()
    from public.client_notes n where n.client_id = p_merge
  on conflict (client_id) do update
    set admin_notes = nullif(pg_catalog.left(concat_ws(E'\n\n', client_notes.admin_notes, excluded.admin_notes), 5000), ''),
        special_agreement_note = nullif(pg_catalog.left(concat_ws(E'\n\n', client_notes.special_agreement_note, excluded.special_agreement_note), 1000), ''),
        updated_by = excluded.updated_by;
  delete from public.client_notes n where n.client_id = p_merge;

  -- The other modules' rows.
  for r in select h.module_key, h.function_name from public.client_merge_handlers h order by h.module_key loop
    execute pg_catalog.format('select %s($1, $2)', r.function_name) into v_count using p_merge, p_keep;
    v_handlers := v_handlers || jsonb_build_object(r.module_key, coalesce(v_count, 0));
  end loop;

  -- The kept file's empty fields from the merged one; the merged file archived.
  update public.clients c
     set birth_first_name = coalesce(c.birth_first_name, v_merge.birth_first_name),
         pronouns = coalesce(c.pronouns, v_merge.pronouns),
         sex = coalesce(c.sex, v_merge.sex),
         birthday = coalesce(c.birthday, v_merge.birthday),
         email = coalesce(c.email, v_merge.email),
         mobile_e164 = coalesce(c.mobile_e164, v_merge.mobile_e164),
         home_e164 = coalesce(c.home_e164, v_merge.home_e164),
         work_e164 = coalesce(c.work_e164, v_merge.work_e164),
         work_ext = case when c.work_e164 is null then coalesce(c.work_ext, v_merge.work_ext) else c.work_ext end,
         time_zone = coalesce(c.time_zone, v_merge.time_zone),
         address_line1 = case when c.address_line1 is null then v_merge.address_line1 else c.address_line1 end,
         address_line2 = case when c.address_line1 is null then v_merge.address_line2 else c.address_line2 end,
         city = case when c.address_line1 is null then v_merge.city else c.city end,
         province = case when c.address_line1 is null then v_merge.province else c.province end,
         postal_code = case when c.address_line1 is null then v_merge.postal_code else c.postal_code end,
         country = case when c.address_line1 is null then v_merge.country else c.country end,
         referral_source_id = coalesce(c.referral_source_id, v_merge.referral_source_id),
         referred_by = coalesce(c.referred_by, v_merge.referred_by),
         custom_field = coalesce(c.custom_field, v_merge.custom_field),
         primary_professional_id = coalesce(c.primary_professional_id, v_merge.primary_professional_id),
         rate_variant = coalesce(c.rate_variant, v_merge.rate_variant),
         tax_exempt = c.tax_exempt or v_merge.tax_exempt,
         is_banned = c.is_banned or v_merge.is_banned,
         special_agreement = c.special_agreement or v_merge.special_agreement,
         shared_custody = c.shared_custody or v_merge.shared_custody
   where c.id = p_keep;
  update public.clients c
     set merged_into_id = p_keep, archived_at = coalesce(c.archived_at, now()), archived_by = coalesce(c.archived_by, auth.uid())
   where c.id = p_merge;

  insert into public.client_merges (org_id, kept_client_id, merged_client_id, moved, merged_by)
  values (v_org, p_keep, p_merge,
          jsonb_build_object('relations', v_relations, 'insurances', v_insurances, 'payers', v_payers,
                             'tags', v_tags, 'links', v_links, 'modules', v_handlers),
          auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reads
-- -----------------------------------------------------------------------------
-- ⌘K: every word must match the first or last name (accents and case ignored), the email, the
-- file number or a phone's digits. Staff (clients.view): the clinic's files, archived ones last;
-- a professional (clients.self): her linked clients only. Never merged or anonymised files.
create function public.search_clients(p_query text, p_limit int default 8)
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
  v_words := array(select w from pg_catalog.regexp_split_to_table(private.clients_name_form(p_query), ' ') w where w <> '');
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
          where not (private.clients_name_form(c.first_name || ' ' || c.last_name) like '%' || w || '%'
                     or coalesce(c.email, '') like '%' || w || '%'
                     or c.client_number::text = w
                     or (w ~ '^[0-9]{3,}$' and pg_catalog.regexp_replace(concat_ws(' ', c.mobile_e164, c.home_e164, c.work_e164), '[^0-9 ]', '', 'g') like '%' || w || '%')))
     order by (c.archived_at is not null), c.last_name, c.first_name, c.client_number
     limit least(greatest(coalesce(p_limit, 8), 1), 50);
end;
$$;

-- The record's bundle (staff, clients.view): the file, its notes, relations (with the other
-- person's name and both directions' rights), insurance, payers, tags, the professionals who see
-- it, the merges. A professional (clients.self, linked) gets the published columns only.
create function public.get_client_summary(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pro uuid := private.current_professional_id();
  v_client public.clients;
begin
  select c.* into v_client from public.clients c where c.org_id = v_org and c.id = p_id;
  if private.has_permission('clients.view') then
    if v_client.id is null then
      raise exception 'Dossier client introuvable.' using errcode = 'P0001', hint = 'client_id';
    end if;
    return jsonb_build_object(
      'client', pg_catalog.to_jsonb(v_client),
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
  end if;
  if private.has_permission('clients.self') and v_pro is not null and v_client.id is not null
     and v_client.anonymized_at is null and private.client_visible_to_professional(p_id, v_pro) then
    return jsonb_build_object('client', (select pg_catalog.to_jsonb(m) from public.my_clients m where m.id = p_id));
  end if;
  raise exception 'Permission refusée : clients.view' using errcode = '42501';
end;
$$;

-- Active payers (Facturation reads them through this view, never the table).
create view public.client_payers_active with (security_invoker = true) as
select x.id, x.org_id, x.client_id, x.kind, x.organisation_name, x.file_number, x.session_amount_cents,
       x.max_sessions, x.max_amount_cents, x.starts_on, x.expires_on
  from public.client_payers x
 where x.is_active
   and (x.expires_on is null or x.expires_on >= private.clinic_today())
   and (select private.has_permission('clients.view'));
revoke all on public.client_payers_active from anon, authenticated;
grant select on public.client_payers_active to authenticated;

-- -----------------------------------------------------------------------------
-- Loi 25 (clients.privacy)
-- -----------------------------------------------------------------------------
-- Everything the clinic holds on a person (the access request's export, rendered as a PDF by the
-- browser). The read is logged in audit_log (action read, the sections, never the values).
create function public.export_client_privacy(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_summary jsonb;
begin
  if not private.has_permission('clients.privacy') then
    raise exception 'Permission refusée : clients.privacy' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_id, true);
  v_summary := public.get_client_summary(p_id);
  insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, source)
  values (v_org, 'clients', p_id::text, 'read',
          jsonb_build_object('fields', jsonb_build_array('client', 'notes', 'relations', 'insurances', 'payers', 'tags', 'professionals', 'merges')),
          auth.uid(), 'rpc:export_client_privacy');
  return v_summary || jsonb_build_object('exported_at', now());
end;
$$;

-- Blanks a person's identity for good (the right to be forgotten, where the law allows): the
-- relations, tags, insurance and payers go, the notes go, the file keeps its id, number and
-- links (invoices and appointments stay counted). Archived; never undone (trigger).
create function public.anonymize_client(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_client public.clients;
begin
  if not private.has_permission('clients.privacy') then
    raise exception 'Permission refusée : clients.privacy' using errcode = '42501';
  end if;
  v_client := private.clients_lock(v_org, p_id, true);
  if v_client.anonymized_at is not null then
    return;
  end if;
  delete from public.client_relations r where r.org_id = v_org and (r.client_a_id = p_id or r.client_b_id = p_id);
  delete from public.client_tag_links l where l.client_id = p_id;
  delete from public.client_insurances i where i.client_id = p_id;
  delete from public.client_payers x where x.client_id = p_id;
  delete from public.client_notes n where n.client_id = p_id;
  update public.clients c
     set first_name = 'Client', last_name = 'anonymisé n° ' || c.client_number,
         birth_first_name = null, pronouns = null, sex = null, birthday = null, email = null,
         mobile_e164 = null, home_e164 = null, work_e164 = null, work_ext = null, time_zone = null,
         address_line1 = null, address_line2 = null, city = null, province = null, postal_code = null,
         referral_source_id = null, referred_by = null, custom_field = null, rate_variant = null,
         tax_exempt = false, is_banned = false, file_incomplete = false, special_agreement = false,
         shared_custody = false, external_ref = null,
         archived_at = coalesce(c.archived_at, now()), archived_by = coalesce(c.archived_by, auth.uid()),
         anonymized_at = now(), anonymized_by = auth.uid()
   where c.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  public.create_client(jsonb, boolean), public.update_client(uuid, jsonb), public.set_client_notes(uuid, text, text),
  public.archive_client(uuid), public.unarchive_client(uuid),
  public.set_client_relation(uuid, uuid, text, jsonb, jsonb), public.remove_client_relation(uuid, uuid),
  public.upsert_client_insurance(uuid, int, text, text, text, text, text), public.delete_client_insurance(uuid, int),
  public.save_client_payer(uuid, uuid, text, text, text, int, int, int, date, date, text), public.end_client_payer(uuid),
  public.set_client_tags(uuid, uuid[]), public.save_client_tag(uuid, text), public.set_client_tag_active(uuid, boolean),
  public.merge_clients(uuid, uuid), public.search_clients(text, int), public.get_client_summary(uuid),
  public.export_client_privacy(uuid), public.anonymize_client(uuid)
from public, anon, authenticated;
grant execute on function
  public.create_client(jsonb, boolean), public.update_client(uuid, jsonb), public.set_client_notes(uuid, text, text),
  public.archive_client(uuid), public.unarchive_client(uuid),
  public.set_client_relation(uuid, uuid, text, jsonb, jsonb), public.remove_client_relation(uuid, uuid),
  public.upsert_client_insurance(uuid, int, text, text, text, text, text), public.delete_client_insurance(uuid, int),
  public.save_client_payer(uuid, uuid, text, text, text, int, int, int, date, date, text), public.end_client_payer(uuid),
  public.set_client_tags(uuid, uuid[]), public.save_client_tag(uuid, text), public.set_client_tag_active(uuid, boolean),
  public.merge_clients(uuid, uuid), public.search_clients(text, int), public.get_client_summary(uuid),
  public.export_client_privacy(uuid), public.anonymize_client(uuid)
to authenticated;
