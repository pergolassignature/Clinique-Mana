-- Clients (C3 review and lane B's Gmail linking, CM-12):
--   1. update_client changes only the keys it is sent (a card of « Informations » sends its own
--      fields): the stored file is read under the row lock and the sent keys laid over it, then
--      the whole is checked as before. Two people saving different cards no longer undo each other.
--   2. private.clients_match_email(org, emails[]): which files an email address belongs to, the
--      person herself (« client ») or a person she is related to (« relation »), for Communications'
--      thread linking (CM2b). Same normalisation as the duplicate rules (I-5): trimmed, lower case;
--      an address on 6 or more files is a placeholder and matches nothing. Merged and anonymised
--      files never match; archived ones do (an old client may write). For definer callers after
--      their own permission check; granted to no role.

create or replace function public.update_client(p_id uuid, p_client jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_stored jsonb;
  v public.clients;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  perform private.clients_lock(v_org, p_id);
  if p_client is null or jsonb_typeof(p_client) <> 'object' then
    raise exception 'Les informations du client sont requises.' using errcode = '22023';
  end if;
  select to_jsonb(c) into v_stored from public.clients c where c.id = p_id;
  -- The stored values first, the sent keys over them; clients_from_json reads only the editable keys.
  v := private.clients_from_json(v_org, v_stored || p_client);
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
revoke all on function public.update_client(uuid, jsonb) from public, anon;
grant execute on function public.update_client(uuid, jsonb) to authenticated;

create function private.clients_match_email(p_org uuid, p_emails text[])
returns table (email text, client_id uuid, match_kind text)
language sql
stable
set search_path = ''
as $$
  with wanted as (
    select distinct pg_catalog.lower(pg_catalog.btrim(e)) as email
      from pg_catalog.unnest(coalesce(p_emails, '{}'::text[])) e
     where nullif(pg_catalog.btrim(e), '') is not null
  ),
  holders as (
    select w.email, c.id, c.client_number
      from wanted w
      join public.clients c on c.org_id = p_org and c.email = w.email
     where c.merged_into_id is null and c.anonymized_at is null
  ),
  usable as (
    select h.* from holders h
     where (select count(*) from holders x where x.email = h.email) < 6
  ),
  matches as (
    select u.email, u.id as client_id, 'client'::text as match_kind, u.client_number
      from usable u
    union
    select u.email, o.id, 'relation'::text, o.client_number
      from usable u
      join public.client_relations r on r.org_id = p_org and u.id in (r.client_a_id, r.client_b_id)
      join public.clients o on o.org_id = p_org
                           and o.id = case when r.client_a_id = u.id then r.client_b_id else r.client_a_id end
     where o.merged_into_id is null and o.anonymized_at is null
  )
  -- A file the address is her own is never also listed as a relation's.
  select m.email, m.client_id, m.match_kind
    from matches m
   where m.match_kind = 'client'
      or not exists (select 1 from matches x where x.email = m.email and x.client_id = m.client_id and x.match_kind = 'client')
   order by m.email, m.match_kind, m.client_number;
$$;
revoke all on function private.clients_match_email(uuid, text[]) from public, anon, authenticated, service_role;
