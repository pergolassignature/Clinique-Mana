-- =============================================================================
-- Clients: the files a new request may belong to (Demandes' « Nouvelle demande », D-55)
-- =============================================================================
-- While a counselor types who is calling (first name, last name, phone, email), Demandes shows
-- « Dossiers existants (N) ». The rule is Clients' own, so the two never disagree:
-- * a shared or partial contact, through `private.clients_find_duplicates` (I-5, CL-12: the same
--   email, the same last 10 digits of a phone, a partial one with the same or a similar name;
--   placeholders on 6+ files never pair; merged and anonymised files never), HIGH first;
-- * then the same or a similar name alone (`clients_name_form`, `clients_name_similarity` > 0.8 on
--   both the first and the last name, as the duplicate rule compares names). A name alone never
--   makes a duplicate (the creation is not refused for it), but it is worth showing here: the
--   counselor decides.
-- What a row carries is the least the panel needs (Loi 25): the number, the name, the birth year,
-- what matched, and a hint of the file's matching contact (the last 4 digits of the phone, the
-- email's first 2 characters and domain), never the file's full contact.
-- Granted to no role: for Demandes' definer RPC `find_demande_matches`, after its checks
-- (demandes.manage and clients.view), with the org it verified.
-- =============================================================================

create function private.clients_intake_matches(
  p_org uuid,
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_limit int default 5
)
returns table (client_id uuid, client_number int, display_name text, birth_year int, is_archived boolean,
               matched_on text[], phone_hint text, email_hint text)
language plpgsql
stable
set search_path = ''
as $$
declare
  c_similar constant numeric := 0.8;
  v_first text := nullif(pg_catalog.btrim(pg_catalog.left(coalesce(p_first, ''), 100)), '');
  v_last text := nullif(pg_catalog.btrim(pg_catalog.left(coalesce(p_last, ''), 100)), '');
  v_email text := pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.left(coalesce(p_email, ''), 254)), ''));
  v_key text := private.clients_phone_key(pg_catalog.left(p_phone, 30));
  v_ff text;
  v_lf text;
  v_limit int := least(greatest(coalesce(p_limit, 5), 1), 10);
begin
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    v_email := null;
  end if;
  v_ff := private.clients_name_form(v_first);
  v_lf := private.clients_name_form(v_last);
  -- Nothing meaningful: a valid email, a phone of 10 digits, or a first and a last name.
  if v_email is null and v_key is null and (v_ff = '' or v_lf = '') then
    return;
  end if;

  return query
  with dup as (
    select d.client_id, d.level, d.reasons
      from private.clients_find_duplicates(p_org, v_first, v_last, v_email,
                                           case when v_key is not null then array[p_phone] else '{}'::text[] end, null, null) d
  ),
  named as (
    -- A name alone: the same or a similar first and last name (cheap length filter first: a
    -- similarity above 0.8 needs the shorter name to be over 0.8 of the longer).
    select c.id as client_id
      from public.clients c
     where v_ff <> '' and v_lf <> ''
       and c.org_id = p_org and c.merged_into_id is null and c.anonymized_at is null
       and not exists (select 1 from dup where dup.client_id = c.id)
       and pg_catalog.length(private.clients_name_form(c.last_name)) * 5 > pg_catalog.length(v_lf) * 4
       and pg_catalog.length(v_lf) * 5 > pg_catalog.length(private.clients_name_form(c.last_name)) * 4
       and private.clients_name_similarity(v_ff, private.clients_name_form(c.first_name)) > c_similar
       and private.clients_name_similarity(v_lf, private.clients_name_form(c.last_name)) > c_similar
  ),
  found as (
    select dup.client_id, case when dup.level = 'high' then 0 else 1 end as tier, dup.reasons from dup
    union all
    select named.client_id, 2, array['same_name']::text[] from named
  )
  select c.id, c.client_number, c.first_name || ' ' || c.last_name,
         pg_catalog.date_part('year', c.birthday)::int,
         c.archived_at is not null,
         array_remove(array[
           case when 'phone' = any (f.reasons) then 'phone' when 'partial_phone' = any (f.reasons) then 'partial_phone' end,
           case when 'email' = any (f.reasons) then 'email' when 'partial_email' = any (f.reasons) then 'partial_email' end,
           case when f.reasons && array['same_name', 'similar_name'] then 'name' end], null),
         -- The file's phone that matched: its last 4 digits.
         case when f.reasons && array['phone', 'partial_phone'] then
           (select pg_catalog.right(k, 4)
              from pg_catalog.unnest(array[private.clients_phone_key(c.mobile_e164), private.clients_phone_key(c.home_e164),
                                           private.clients_phone_key(c.work_e164)]) with ordinality as p(k, n)
             where k is not null and pg_catalog.right(k, 7) = pg_catalog.right(v_key, 7)
             order by (k = v_key) desc, n
             limit 1)
         end,
         -- The file's email: its first 2 characters and its domain.
         case when f.reasons && array['email', 'partial_email'] and c.email is not null then
           pg_catalog.left(pg_catalog.split_part(c.email, '@', 1), 2) || '•••@' || pg_catalog.split_part(c.email, '@', 2)
         end
    from found f
    join public.clients c on c.id = f.client_id and c.org_id = p_org
   order by f.tier, (c.archived_at is not null), c.client_number
   limit v_limit;
end;
$$;
revoke all on function private.clients_intake_matches(uuid, text, text, text, text, int) from public, anon, authenticated, service_role;
