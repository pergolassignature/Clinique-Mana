-- =============================================================================
-- Clients: duplicate detection (plan C2.1)
-- =============================================================================
-- Decisions: I-5 (the import's duplicate rules), R-10, CL-12 (decisions log)
-- Mirror:    scripts/import-gorendezvous/duplicates.mjs and normalize.mjs (lane C): the app and
--            the import must never disagree on what a duplicate is.
--
-- The rules (I-5), between a person being created or edited and the clinic's files:
-- - HIGH (blocks a creation): a shared contact (the same email, or the same last 10 digits on any
--   of the person's phones) AND the same or a similar name AND no conflicting birth date;
-- - MEDIUM (asks for a confirmation): a shared contact with the same or similar name but another
--   birth date; a shared contact with another name (« shared_contact »: a parent's email or phone
--   on a teen's file, Christine, answer 3: two clients, never a merge); the same name and birth date
--   without a shared contact; the same or a similar name with a partial contact (the email's local
--   part of 6+ characters on another domain, or the last 7 digits of a phone);
-- - a name alone never makes a duplicate.
-- Names are compared folded (accents and case removed, hyphens, apostrophes and periods as
-- spaces); « similar » is the legacy similarity above 0.8 on both the first and the last name. An
-- email or phone already on 6 or more files is a placeholder (the clinic's own number, « aucun@… »)
-- and never pairs anyone (the import's « crowded »). Merged and anonymised files are never
-- candidates; archived ones are, flagged.
-- =============================================================================

-- A name's comparison form (the import's nameForm): unaccented, lower case, - ' ’ . as spaces.
create function private.clients_name_form(p_value text)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(
             pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_value, ''))),
             '[-''’.]', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;
revoke all on function private.clients_name_form(text) from public, anon, authenticated, service_role;

-- The legacy similarity (the import's `similarity`): equal → 1; one inside the other →
-- max(0.7, short / long); else the common prefix / long; 0 when either is empty.
create function private.clients_name_similarity(p_a text, p_b text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_short text;
  v_long text;
  v_prefix int := 0;
begin
  if coalesce(p_a, '') = '' or coalesce(p_b, '') = '' then
    return 0;
  end if;
  if p_a = p_b then
    return 1;
  end if;
  if pg_catalog.length(p_a) <= pg_catalog.length(p_b) then
    v_short := p_a; v_long := p_b;
  else
    v_short := p_b; v_long := p_a;
  end if;
  if pg_catalog.strpos(v_long, v_short) > 0 then
    return greatest(0.7, pg_catalog.length(v_short)::numeric / pg_catalog.length(v_long));
  end if;
  while v_prefix < pg_catalog.length(v_short)
        and pg_catalog.substr(v_short, v_prefix + 1, 1) = pg_catalog.substr(v_long, v_prefix + 1, 1) loop
    v_prefix := v_prefix + 1;
  end loop;
  return v_prefix::numeric / pg_catalog.length(v_long);
end;
$$;
revoke all on function private.clients_name_similarity(text, text) from public, anon, authenticated, service_role;

-- A phone's duplicate key (the import's phoneKey): its last 10 digits, null under 10 digits.
create function private.clients_phone_key(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when pg_catalog.length(pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) >= 10
              then pg_catalog.right(pg_catalog.regexp_replace(p_phone, '[^0-9]', '', 'g'), 10) end
$$;
revoke all on function private.clients_phone_key(text) from public, anon, authenticated, service_role;

-- The duplicates of a person among a clinic's files, HIGH first then by file number. For the
-- definer RPCs of the module (create_client) and the import, after their own permission check.
create function private.clients_find_duplicates(
  p_org uuid,
  p_first text,
  p_last text,
  p_email text,
  p_phones text[],
  p_birthday date,
  p_exclude uuid
)
returns table (client_id uuid, level text, reasons text[])
language plpgsql
stable
set search_path = ''
as $$
declare
  c_crowded constant int := 6;
  c_similar constant numeric := 0.8;
  v_first text := private.clients_name_form(p_first);
  v_last text := private.clients_name_form(p_last);
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, ''))), '');
  v_local text;
  v_phones text[];
  v_phones7 text[];
  r record;
  v_same_email boolean;
  v_same_phone boolean;
  v_contact boolean;
  v_same_name boolean;
  v_similar_name boolean;
  v_birthday_conflict boolean;
  v_same_birthday boolean;
  v_partial_email boolean;
  v_partial_phone boolean;
  v_reasons text[];
begin
  v_local := case when v_email is not null and pg_catalog.length(pg_catalog.split_part(v_email, '@', 1)) >= 6
                  then pg_catalog.split_part(v_email, '@', 1) end;
  select coalesce(array_agg(distinct k), '{}') into v_phones
    from (select private.clients_phone_key(x) as k from pg_catalog.unnest(coalesce(p_phones, '{}'::text[])) x) s
   where k is not null;

  -- Placeholders: a contact already on c_crowded files never pairs anyone.
  if v_email is not null and (select count(*) from public.clients c
                               where c.org_id = p_org and c.email = v_email
                                 and c.merged_into_id is null and c.anonymized_at is null
                                 and (p_exclude is null or c.id <> p_exclude)) >= c_crowded then
    v_email := null;
  end if;
  select coalesce(array_agg(p), '{}') into v_phones
    from pg_catalog.unnest(v_phones) p
   where (select count(*) from public.clients c
           where c.org_id = p_org and c.merged_into_id is null and c.anonymized_at is null
             and (p_exclude is null or c.id <> p_exclude)
             and p in (private.clients_phone_key(c.mobile_e164), private.clients_phone_key(c.home_e164), private.clients_phone_key(c.work_e164))) < c_crowded;
  select coalesce(array_agg(distinct pg_catalog.right(p, 7)), '{}') into v_phones7 from pg_catalog.unnest(v_phones) p;

  for r in
    select c.id, c.client_number, c.email,
           private.clients_name_form(c.first_name) as first,
           private.clients_name_form(c.last_name) as last,
           c.birthday,
           array_remove(array[private.clients_phone_key(c.mobile_e164), private.clients_phone_key(c.home_e164), private.clients_phone_key(c.work_e164)], null) as phones
      from public.clients c
     where c.org_id = p_org
       and c.merged_into_id is null
       and c.anonymized_at is null
       and (p_exclude is null or c.id <> p_exclude)
       and (
         (v_email is not null and c.email = v_email)
         or (v_local is not null and pg_catalog.split_part(c.email, '@', 1) = v_local)
         or private.clients_phone_key(c.mobile_e164) = any (v_phones)
         or private.clients_phone_key(c.home_e164) = any (v_phones)
         or private.clients_phone_key(c.work_e164) = any (v_phones)
         or pg_catalog.right(private.clients_phone_key(c.mobile_e164), 7) = any (v_phones7)
         or pg_catalog.right(private.clients_phone_key(c.home_e164), 7) = any (v_phones7)
         or pg_catalog.right(private.clients_phone_key(c.work_e164), 7) = any (v_phones7)
         or (p_birthday is not null and c.birthday = p_birthday)
       )
  loop
    v_same_email := v_email is not null and r.email = v_email;
    v_same_phone := r.phones && v_phones;
    v_contact := v_same_email or v_same_phone;
    v_same_name := v_first <> '' and v_first = r.first and v_last <> '' and v_last = r.last;
    v_similar_name := not v_same_name
                      and private.clients_name_similarity(v_first, r.first) > c_similar
                      and private.clients_name_similarity(v_last, r.last) > c_similar;
    v_birthday_conflict := p_birthday is not null and r.birthday is not null and p_birthday <> r.birthday;
    v_same_birthday := p_birthday is not null and r.birthday = p_birthday;
    v_reasons := array_remove(array[
      case when v_same_email then 'email' end,
      case when v_same_phone then 'phone' end,
      case when v_same_name then 'same_name' end,
      case when v_similar_name then 'similar_name' end,
      case when v_same_birthday then 'birthday' end,
      case when v_birthday_conflict then 'birthday_differs' end], null);

    if v_contact and (v_same_name or v_similar_name) and not v_birthday_conflict then
      client_id := r.id; level := 'high'; reasons := v_reasons; return next;
    elsif v_contact and (v_same_name or v_similar_name) then
      client_id := r.id; level := 'medium'; reasons := v_reasons; return next;
    elsif v_contact then
      client_id := r.id; level := 'medium'; reasons := v_reasons || 'shared_contact'::text; return next;
    elsif v_same_name and v_same_birthday then
      client_id := r.id; level := 'medium'; reasons := v_reasons; return next;
    else
      v_partial_email := v_local is not null and pg_catalog.split_part(r.email, '@', 1) = v_local;
      v_partial_phone := exists (select 1 from pg_catalog.unnest(r.phones) p where pg_catalog.right(p, 7) = any (v_phones7));
      if (v_same_name or v_similar_name) and (v_partial_email or v_partial_phone) and not v_birthday_conflict then
        client_id := r.id; level := 'medium';
        reasons := v_reasons || (case when v_partial_email then 'partial_email' else 'partial_phone' end)::text;
        return next;
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function private.clients_find_duplicates(uuid, text, text, text, text[], date, uuid) from public, anon, authenticated, service_role;

-- For the creation form's live panel and the record's « Doublons possibles » (clients.view): the
-- duplicates with what the panel shows, HIGH first, at most 10.
create function public.find_client_duplicates(
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
      from private.clients_find_duplicates(v_org, p_first, p_last, p_email, p_phones, p_birthday, p_exclude) d
      join public.clients c on c.id = d.client_id
     order by (d.level = 'high') desc, c.client_number
     limit 10;
end;
$$;
revoke all on function public.find_client_duplicates(text, text, text, text[], date, uuid) from public, anon, authenticated;
grant execute on function public.find_client_duplicates(text, text, text, text[], date, uuid) to authenticated;
