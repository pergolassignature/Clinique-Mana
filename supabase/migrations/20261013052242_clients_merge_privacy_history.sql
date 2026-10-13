-- Clients, batch C4 (plan C4.1, C4.2, C3.4's « Historique »):
--   1. merge_clients(keep, merge, take): the merge screen lets the person take some of the merged
--      file's values (« side by side »): `take` names them (a closed list of keys), the database
--      copies them from the merged row it has locked, over the kept file, in the same transaction;
--      then C2's merge runs as before (the kept file's empty fields filled from the other,
--      everything moved). The caller never sends a value, so a merge can only move what the
--      merged file holds. C2's function becomes private.clients_merge_core (renamed: its body is
--      unchanged); the two-argument call still works (take defaults to null).
--   2. private.clients_apply_fields(org, id, fields): the partial update shared by update_client
--      and the merge (the stored file, the sent keys over it, checked again).
--   3. export_client_privacy also returns the consents (Loi 25: every consent signed, its
--      version, signers, answers and state), and logs that section too.
--   4. list_client_history(id, before, limit): the record's « Historique » (clients.view): the
--      audit rows of the file and of its notes, relations (either side), insurance, payers, tags,
--      professionals, merges and consents, newest first, keyset-paged on the audit id.
--   5. referral_sources_catalog (Demandes' intake, lane B): the active referral sources, readable
--      with clients.view or demandes.view.

-- -----------------------------------------------------------------------------
-- 2. The partial update
-- -----------------------------------------------------------------------------
create function private.clients_apply_fields(p_org uuid, p_id uuid, p_fields jsonb)
returns public.clients
language plpgsql
set search_path = ''
as $$
declare
  v_stored jsonb;
  v public.clients;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Les informations du client sont requises.' using errcode = '22023';
  end if;
  select to_jsonb(c) into v_stored from public.clients c where c.org_id = p_org and c.id = p_id;
  v := private.clients_from_json(p_org, v_stored || p_fields);
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
   where c.org_id = p_org and c.id = p_id;
  perform private.clients_link_professional(p_org, p_id, v.primary_professional_id, 'primary');
  return v;
end;
$$;
revoke all on function private.clients_apply_fields(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

create or replace function public.update_client(p_id uuid, p_client jsonb)
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
  perform private.clients_apply_fields(v_org, p_id, p_client);
  if p_client ? 'admin_notes' or p_client ? 'special_agreement_note' then
    perform private.clients_save_notes(v_org, p_id, p_client ->> 'admin_notes', p_client ->> 'special_agreement_note');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. The merge with chosen values
-- -----------------------------------------------------------------------------
alter function public.merge_clients(uuid, uuid) rename to clients_merge_core;
alter function public.clients_merge_core(uuid, uuid) set schema private;
revoke all on function private.clients_merge_core(uuid, uuid) from public, anon, authenticated, service_role;

-- The values a merge may take from the merged file, by key: the identity, the contacts, the
-- address as one block, the provenance, the primary professional and the rate. Never the notes,
-- the flags (banned, tax exemption…) or the reminders: those are merged by C2's rules.
create function private.clients_merge_take_columns(p_key text)
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
    when 'referred_by' then array['referred_by']
    when 'primary_professional_id' then array['primary_professional_id']
    when 'rate_variant' then array['rate_variant']
  end
$$;
revoke all on function private.clients_merge_take_columns(text) from public, anon, authenticated, service_role;

create function public.merge_clients(p_keep uuid, p_merge uuid, p_take text[] default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_merged jsonb;
  v_fields jsonb := '{}'::jsonb;
  v_key text;
  v_columns text[];
begin
  if not private.has_permission('clients.merge') then
    raise exception 'Permission refusée : clients.merge' using errcode = '42501';
  end if;
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Choisissez deux dossiers différents.' using errcode = 'P0001', hint = 'merge';
  end if;
  -- Both files locked in id order first (as the merge does), so a value is taken from, and lands
  -- on, files nobody else is changing.
  perform private.clients_lock(v_org, least(p_keep, p_merge));
  perform private.clients_lock(v_org, greatest(p_keep, p_merge));
  if coalesce(pg_catalog.cardinality(p_take), 0) > 0 then
    select to_jsonb(c) into v_merged from public.clients c where c.org_id = v_org and c.id = p_merge;
    foreach v_key in array p_take loop
      v_columns := private.clients_merge_take_columns(v_key);
      if v_columns is null then
        raise exception 'Cette valeur ne peut pas être reprise de l''autre dossier.' using errcode = 'P0001', hint = 'merge';
      end if;
      select v_fields || coalesce(pg_catalog.jsonb_object_agg(col, v_merged -> col), '{}'::jsonb)
        into v_fields from pg_catalog.unnest(v_columns) col;
    end loop;
    perform private.clients_apply_fields(v_org, p_keep, v_fields);
  end if;
  return private.clients_merge_core(p_keep, p_merge);
end;
$$;
revoke all on function public.merge_clients(uuid, uuid, text[]) from public, anon;
grant execute on function public.merge_clients(uuid, uuid, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. The Loi 25 export, with the consents
-- -----------------------------------------------------------------------------
create or replace function public.export_client_privacy(p_id uuid)
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
  v_summary := private.clients_summary(v_org, p_id)
               || jsonb_build_object('merged_files', coalesce((
                    select jsonb_agg(private.clients_summary(v_org, c.id) order by c.client_number)
                      from public.clients c where c.org_id = v_org and c.merged_into_id = p_id), '[]'::jsonb))
               || jsonb_build_object('consents', coalesce((
                    select jsonb_agg(jsonb_build_object(
                             'consent_key', x.consent_key, 'name', ty.name_fr, 'version_label', x.version_label,
                             'language', x.language, 'signed_at', x.signed_at, 'signed_by', x.signed_by,
                             'answers', x.answers, 'source', x.source, 'superseded_at', x.superseded_at,
                             'withdrawn_at', x.withdrawn_at, 'withdrawal_note', x.withdrawal_note)
                           order by x.signed_at)
                      from public.client_consents x
                      join public.client_consent_types ty on ty.org_id = x.org_id and ty.key = x.consent_key
                     where x.org_id = v_org and x.client_id = p_id), '[]'::jsonb));
  insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, actor_role, source)
  values (v_org, 'clients', p_id::text, 'read',
          jsonb_build_object('fields', jsonb_build_array('client', 'notes', 'relations', 'insurances', 'payers', 'tags',
                                                         'professionals', 'merges', 'merged_files', 'consents')),
          auth.uid(), private.current_user_role(), 'rpc:export_client_privacy');
  return v_summary || jsonb_build_object('exported_at', now());
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. The record's history
-- -----------------------------------------------------------------------------
-- record_id is the primary key's columns joined by ':': '<client_id>' or '<client_id>:…' for the
-- file and its child tables (the prefix index serves them); a relation is '<client_a_id>:<id>',
-- so the relations where the file is the other side, and the consents, requests and merges (their
-- own id), are found by the record ids of the live rows (CL-27: a relation already removed while
-- this file was its second side shows in the other file's history only).
create function public.list_client_history(p_id uuid, p_before_id bigint default null, p_limit int default 50)
returns table (
  id bigint, created_at timestamptz, table_name text, record_id text, action text,
  changed_fields jsonb, actor_id uuid, actor_name text, actor_role text, source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_before bigint := coalesce(p_before_id, 9223372036854775807);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_prefix text := p_id::text;
  v_own text[] := array['clients', 'client_notes', 'client_relations', 'client_insurances', 'client_payers',
                        'client_tag_links', 'client_professional_links'];
  v_others text[];
begin
  if not private.has_permission('clients.view') then
    raise exception 'Permission refusée : clients.view' using errcode = '42501';
  end if;
  -- The rows that are not under the file's prefix, from the live tables (indexed): its relations
  -- (either side, under their current record id), consents, consent requests and merges.
  select coalesce(pg_catalog.array_agg(x.rid), '{}') into v_others
    from (select r.client_a_id::text || ':' || r.id::text as rid
            from public.client_relations r
           where r.org_id = v_org and (r.client_a_id = p_id or r.client_b_id = p_id)
          union all
          select x.id::text from public.client_consents x where x.org_id = v_org and x.client_id = p_id
          union all
          select x.id::text from public.client_consent_requests x where x.org_id = v_org and x.client_id = p_id
          union all
          select m.id::text from public.client_merges m
           where m.org_id = v_org and (m.kept_client_id = p_id or m.merged_client_id = p_id)) x;

  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action, a.changed_fields,
           a.actor_id, pr.display_name, a.actor_role, a.source
      from ((select x.* from public.audit_log x
              where x.org_id = v_org
                and left(x.record_id, 36) = v_prefix
                and x.id < v_before
                and x.table_name = any (v_own)
              order by x.id desc
              limit v_limit)
            union all
            (select x.* from public.audit_log x
              where x.org_id = v_org
                and x.table_name in ('client_relations', 'client_consents', 'client_consent_requests', 'client_merges')
                and x.record_id = any (v_others)
                -- A relation where the file is A is already under its prefix.
                and not (x.table_name = 'client_relations' and left(x.record_id, 36) = v_prefix)
                and x.id < v_before
              order by x.id desc
              limit v_limit)) a
      left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
     order by a.id desc
     limit v_limit;
end;
$$;
revoke all on function public.list_client_history(uuid, bigint, int) from public, anon;
grant execute on function public.list_client_history(uuid, bigint, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. The referral sources for other modules (Demandes' intake, lane B)
-- -----------------------------------------------------------------------------
-- Demandes depends on Clients, so a clinic with Demandes on has Clients on. The policy lets
-- demandes.view read the table's rows (a reference list: names and order, nothing personal);
-- Demandes' code reads them through this view, active rows only, never the table (§5).
create policy referral_sources_select_demandes on public.referral_sources
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('demandes.view')));

create view public.referral_sources_catalog with (security_invoker = true) as
select s.id, s.org_id, s.name, s.sort_order
  from public.referral_sources s
 where s.is_active;
revoke all on public.referral_sources_catalog from anon, authenticated;
grant select on public.referral_sources_catalog to authenticated;
