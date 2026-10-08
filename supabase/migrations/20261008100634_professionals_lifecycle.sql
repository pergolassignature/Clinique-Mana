-- =============================================================================
-- Professionnels: readiness, activation and deactivation, list and directory, record, history
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.4, §3.8, §3.9, §5.1, §6
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4a.4 (P4-11, P4-36)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Readiness (« Profil de jumelage complet », design §3.4): a profession, a licence for every
--   regulated title, a regulated title when a restricted motif is held (P4-16: an admin may
--   restrict a motif after it was given), a language, a clientèle, a motif. One view
--   (professionals_readiness), grouped subqueries joined by professional_id: one statement for
--   one professional or for the whole list, never a query per row. `ready` is
--   `matching_complete` in 4a; 4b, 4c and 4d replace the view (same columns first, new ones
--   appended, `ready` redefined). Archived reference rows (titles, motifs, clientèles, languages)
--   do not count: matching ignores them, so a file holding only archived ones is not complete.
-- * A login address different from the professional's email (the 4a.3 sync left it, decision
--   #38) is a warning, not a gap: get_professional_readiness lists `login_email_mismatch`. Staff
--   without users.view cannot read profiles, so the comparison is one definer set function
--   (professional_login_email_mismatches), scanned once per statement. It returns ids only, and
--   only those its caller may read: every professional with professionals.view, else their own.
-- * activate_professional: from any non-active status once ready; otherwise only with
--   professionals.activate_override and a reason of 5 to 500 characters, stored. A complete
--   file stores no reason. deactivate_professional: an active reason of the clinic, a note when
--   the reason requires one (1–500). Both lock the account first, then the professional (the
--   email sync trigger takes them in that order), and return (status, account_change,
--   profile_id) so 4b.6 knows when to ban or unban without a second read.
-- * Accounts (P4-11): a reason with disables_account disables the provider's profile the way
--   set_user_status does (status, then its auth.sessions, P3-32), only when the profile was
--   active and holds the role provider, and remembers it did (deactivation_disabled_account).
--   Reactivation re-enables only an account this module disabled. Any other change of the
--   account's status (set_user_status, by hand) clears that memory (trigger
--   profiles_release_professional_account): an account an admin re-enabled, then disabled again,
--   is no longer the module's doing. The module's own changes run with the transaction-local
--   setting app.professionals_account_status = 'on', which the trigger skips.
--   Écart from set_user_status (only an admin re-enables an account): an adjointe who reactivates
--   a professional re-enables the account the module disabled with it (P4-11).
-- * Read models (security_invoker, ids rather than labels): professionals_list (the list page),
--   professionals_directory (published to Demandes, Rendez-vous, Facturation), both gated by
--   professionals.view so a provider's self policies do not leak their row into them.
--   list_professionals pages the list server-side: filters (status, profession, language,
--   clientèle, motif: any of the ids; accepting new clients), sorts `name` and `recent`, and a
--   keyset cursor held in plpgsql variables, so it is an index bound of
--   professionals_org_name_idx / professionals_org_status_changed_idx in any plan. The set
--   filters are resolved first, once, through their (org_id, <x>_id) indexes.
-- * get_professional_record: one jsonb for the fiche; every set is bounded by its set RPC
--   (≤ 500 ids, ≤ 2 professions). get_professional_public_profile: names grouped for display.
-- * History (P4-36): every child row's audit record_id starts with its professional's id, so one
--   expression index (org_id, left(record_id, 36), id desc) finds a professional's rows,
--   deleted child rows included, keyset-paged by id. Redacted fields were redacted when written
--   (audit_trigger arguments): the history returns them as stored, « [redacted] ».
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Indexes for the list's sorts and filters, and for the history
-- -----------------------------------------------------------------------------
-- Already in place (4a.3): the name sort, professionals_org_name_idx (org_id, last_name,
-- first_name), whose leading columns bound the keyset cursor (the id tiebreak is rechecked on
-- rows of one name); the status filter, professionals_org_status_idx; the set filters, the
-- junctions' (org_id, <x>_id) indexes; « accepte de nouveaux clients », a flag of the 1:1
-- matching profile read through professional_matching_profiles_org_idx (a boolean index would
-- not narrow a clinic's ≤ 500 rows further).
-- « Récents »: last status change (creation included), newest first (scanned backwards).
create index professionals_org_status_changed_idx on public.professionals (org_id, status_changed_at, id);
-- A professional's history: record ids start with the professional's id (P4-36).
create index audit_log_org_record_prefix_idx on public.audit_log (org_id, (left(record_id, 36)), id desc);

-- -----------------------------------------------------------------------------
-- Readiness
-- -----------------------------------------------------------------------------
-- Linked professionals of the caller's clinic whose email differs from their login address.
-- Definer: staff without users.view cannot read profiles. Ids only, and only of professionals the
-- caller may read (the professionals select policies): all with professionals.view, else their own.
create function private.professional_login_email_mismatches()
returns setof uuid
language sql
stable
security definer
set search_path = ''
rows 5
as $$
  select p.id
    from public.professionals p
    join public.profiles pr on pr.user_id = p.profile_id and pr.org_id = p.org_id
   where p.org_id = (select private.current_user_org_id())
     and ((select private.has_permission('professionals.view'))
          or (p.id = (select private.current_professional_id()) and (select private.has_permission('professionals.self'))))
     and p.email <> pg_catalog.lower(pr.email)
$$;
-- The invoker views below call it with the reader's privileges. Not service_role: it has no
-- clinic (current_user_org_id), and nothing service-side reads these views.
revoke all on function private.professional_login_email_mismatches() from public, anon, service_role;
grant execute on function private.professional_login_email_mismatches() to authenticated;

-- Readiness grows by phase: 4b, 4c and 4d replace this view (same columns first, new ones
-- appended; `ready` is redefined each time). Only active reference rows count (matching ignores
-- archived ones): an archived title is neither a profession nor a licence gap, an archived
-- restricted motif needs no regulated title.
create view public.professionals_readiness with (security_invoker = true) as
select r.*, r.matching_complete as ready
  from (
    select p.id as professional_id,
           p.org_id,
           (pr.n is not null)                                                  as has_profession,
           (coalesce(pr.missing_licences, 0) = 0)                              as licences_ok,
           (not coalesce(m.has_restricted, false) or coalesce(pr.regulated, 0) > 0) as restricted_motifs_ok,
           (l.professional_id is not null)                                     as has_language,
           (c.professional_id is not null)                                     as has_clientele,
           (m.professional_id is not null)                                     as has_motif,
           (pr.n is not null and coalesce(pr.missing_licences, 0) = 0
            and (not coalesce(m.has_restricted, false) or coalesce(pr.regulated, 0) > 0)
            and l.professional_id is not null and c.professional_id is not null
            and m.professional_id is not null)                                 as matching_complete,
           (em.id is null)                                                     as email_matches_login
      from public.professionals p
      left join (select x.professional_id,
                        count(*) as n,
                        count(*) filter (where t.order_id is not null and x.licence_number is null) as missing_licences,
                        count(*) filter (where t.order_id is not null) as regulated
                   from public.professional_professions x
                   join public.profession_titles t on t.org_id = x.org_id and t.id = x.profession_title_id and t.is_active
                  group by x.professional_id) pr on pr.professional_id = p.id
      left join (select distinct x.professional_id from public.professional_languages x
                   join public.languages g on g.org_id = x.org_id and g.id = x.language_id and g.is_active) l on l.professional_id = p.id
      left join (select distinct x.professional_id from public.professional_clienteles x
                   join public.clienteles k on k.org_id = x.org_id and k.id = x.clientele_id and k.is_active) c on c.professional_id = p.id
      left join (select x.professional_id, bool_or(mo.is_restricted) as has_restricted
                   from public.professional_motifs x
                   join public.motifs mo on mo.org_id = x.org_id and mo.id = x.motif_id and mo.is_active
                  group by x.professional_id) m on m.professional_id = p.id
      left join private.professional_login_email_mismatches() as em(id) on em.id = p.id
  ) r;
revoke all on public.professionals_readiness from anon, authenticated;
grant select on public.professionals_readiness to authenticated;

-- {complete, done, total, items: [{key, done, missing}], warnings}. Items of later phases are
-- appended by 4b–4d. missing ⊆ profession, licence, regulated_title, language, clientele, motif
-- (in that order); warnings ⊆ login_email_mismatch. Null when the caller cannot read the
-- professional (RLS).
create function public.get_professional_readiness(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'complete', r.ready,
           'done', r.matching_complete::int,
           'total', 1,
           'items', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
             'key', 'matching_profile',
             'done', r.matching_complete,
             'missing', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
               case when not r.has_profession then 'profession' end,
               case when not r.licences_ok then 'licence' end,
               case when not r.restricted_motifs_ok then 'regulated_title' end,
               case when not r.has_language then 'language' end,
               case when not r.has_clientele then 'clientele' end,
               case when not r.has_motif then 'motif' end], null)))),
           'warnings', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
             case when not r.email_matches_login then 'login_email_mismatch' end], null)))
    from public.professionals_readiness r
   where r.professional_id = p_id
$$;

-- -----------------------------------------------------------------------------
-- Status: activation and deactivation
-- -----------------------------------------------------------------------------
-- Locks the professional's account (when linked), then the professional, and returns the locked
-- row. Same order as the email sync (profiles → professionals), so the two never deadlock.
-- « Professionnel introuvable. » outside the caller's clinic.
-- 4b: linking an account (setting profile_id when an invitation is accepted) must take the same
-- order, the profile, then the professional. The account is read before the professional is
-- locked, so a link or unlink committed in between would leave this call holding the wrong
-- account: the re-check below refuses it (40001, the caller retries).
create function private.lock_professional_with_account(p_id uuid)
returns public.professionals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.professionals;
  v_profile uuid;
begin
  select p.profile_id into v_profile from public.professionals p
   where p.id = p_id and p.org_id = private.current_user_org_id();
  if v_profile is not null then
    perform 1 from public.profiles pr where pr.user_id = v_profile for no key update;
  end if;
  perform private.lock_professional(p_id);
  select * into v_row from public.professionals p where p.id = p_id;
  if v_row.profile_id is distinct from v_profile then
    raise exception 'Le dossier vient de changer. Réessayez.' using errcode = '40001';
  end if;
  return v_row;
end;
$$;

-- A provider's account, as set_user_status changes it (P3-32: disabling also ends the sessions;
-- their refresh tokens cascade). Only a profile of the clinic holding the role provider, and only
-- when its status changes: returns whether it did. The update runs with
-- app.professionals_account_status = 'on' (transaction-local), so
-- profiles_release_professional_account knows it is the module's own change; the previous value
-- is put back on every path, errors included, so no later status change in the transaction is
-- taken for the module's.
create function private.set_provider_account_status(p_user_id uuid, p_org uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(pg_catalog.current_setting('app.professionals_account_status', true), '');
  v_changed boolean;
begin
  perform pg_catalog.set_config('app.professionals_account_status', 'on', true);
  begin
    update public.profiles pr set status = p_status
     where pr.user_id = p_user_id and pr.org_id = p_org and pr.status <> p_status
       and exists (select 1 from public.user_roles r where r.user_id = pr.user_id and r.role = 'provider');
    v_changed := found;
  exception when others then
    perform pg_catalog.set_config('app.professionals_account_status', v_prev, true);
    raise;
  end;
  perform pg_catalog.set_config('app.professionals_account_status', v_prev, true);
  if not v_changed then
    return false;
  end if;
  if p_status = 'disabled' then
    delete from auth.sessions s where s.user_id = p_user_id;
  end if;
  return true;
end;
$$;

-- An account status changed outside this module (set_user_status, by hand): whatever the module
-- disabled is no longer its doing, so a later reactivation must not re-enable it (P4-11). Clears
-- deactivation_disabled_account of the linked professional. Lock order profiles → professionals,
-- as the email sync. Definer: set_user_status's caller may lack professionals.manage.
create function private.professionals_release_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('app.professionals_account_status', true), '') <> 'on' then
    update public.professionals p set deactivation_disabled_account = false
     where p.profile_id = new.user_id and p.org_id = new.org_id and p.deactivation_disabled_account;
  end if;
  return null;
end;
$$;
create trigger profiles_release_professional_account
  after update of status on public.profiles
  for each row when (old.status is distinct from new.status)
  execute function private.professionals_release_account();

revoke all on function
  private.lock_professional_with_account(uuid),
  private.set_provider_account_status(uuid, uuid, text),
  private.professionals_release_account()
from public, anon, authenticated, service_role;

-- account_change: 'enabled' when this call re-enabled the account, else null; profile_id then.
create function public.activate_professional(p_id uuid, p_override_reason text default null)
returns table (status text, account_change text, profile_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professionals;
  v_ready boolean;
  v_reason text := nullif(pg_catalog.btrim(p_override_reason, E' \t\r\n'), '');
  v_change text;
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  v_row := private.lock_professional_with_account(p_id);
  if v_row.status = 'active' then
    raise exception 'Ce professionnel est déjà actif.' using errcode = 'P0001';
  end if;

  select r.ready into v_ready from public.professionals_readiness r where r.professional_id = p_id;
  if coalesce(v_ready, false) then
    v_reason := null;                       -- a complete file needs no override
  else
    if not private.has_permission('professionals.activate_override') then
      raise exception 'Le dossier n''est pas complet. Seule l''administration peut activer un dossier incomplet.' using errcode = 'P0001';
    end if;
    if v_reason is null or pg_catalog.char_length(v_reason) < 5 then
      raise exception 'Indiquez la raison (au moins 5 caractères).' using errcode = 'P0001';
    end if;
    if pg_catalog.char_length(v_reason) > 500 then
      raise exception 'La raison compte au plus 500 caractères.' using errcode = 'P0001';
    end if;
  end if;

  update public.professionals p
     set status = 'active', deactivation_reason_id = null, deactivation_note = null,
         activation_override_reason = v_reason, deactivation_disabled_account = false,
         status_changed_at = pg_catalog.now(), status_changed_by = auth.uid()
   where p.id = p_id;

  -- Re-enable the account only if this module's deactivation disabled it (P4-11).
  if v_row.deactivation_disabled_account and private.set_provider_account_status(v_row.profile_id, v_org, 'active') then
    v_change := 'enabled';
  end if;
  return query select 'active'::text, v_change, case when v_change is not null then v_row.profile_id end;
end;
$$;

-- account_change: 'disabled' when this call disabled the account, else null; profile_id then.
create function public.deactivate_professional(p_id uuid, p_reason_id uuid, p_note text default null)
returns table (status text, account_change text, profile_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_row public.professionals;
  v_reason public.deactivation_reasons;
  v_note text := nullif(pg_catalog.btrim(p_note, E' \t\r\n'), '');
  v_change text;
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  v_row := private.lock_professional_with_account(p_id);
  if v_row.status = 'inactive' then
    raise exception 'Ce professionnel est déjà inactif.' using errcode = 'P0001';
  end if;

  select * into v_reason from public.deactivation_reasons r
   where r.org_id = v_org and r.id = p_reason_id and r.is_active;
  if not found then
    raise exception 'Raison introuvable.' using errcode = 'P0001';
  end if;
  if v_reason.requires_note and v_note is null then
    raise exception 'Précisez la raison.' using errcode = 'P0001';
  end if;
  if pg_catalog.char_length(v_note) > 500 then
    raise exception 'La note compte au plus 500 caractères.' using errcode = 'P0001';
  end if;

  -- « Fin de collaboration »: the login goes too (P4-11), unless it is already disabled (then it
  -- is not this module's doing, and reactivation must leave it alone).
  if v_reason.disables_account and private.set_provider_account_status(v_row.profile_id, v_org, 'disabled') then
    v_change := 'disabled';
  end if;

  update public.professionals p
     set status = 'inactive', deactivation_reason_id = p_reason_id, deactivation_note = v_note,
         activation_override_reason = null, deactivation_disabled_account = (v_change is not null),
         status_changed_at = pg_catalog.now(), status_changed_by = auth.uid()
   where p.id = p_id;

  return query select 'inactive'::text, v_change, case when v_change is not null then v_row.profile_id end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Read models
-- -----------------------------------------------------------------------------
-- The list page: one flat row per professional, ids rather than labels (resolved from the cached
-- catalogue). professionals.view only: a provider's self policies must not put their row here.
create view public.professionals_list with (security_invoker = true) as
select p.id, p.org_id, p.first_name, p.last_name, p.email, p.status, p.status_changed_at, p.deactivation_reason_id,
       p.profile_id is not null              as has_account,
       pp.profession_title_id                as primary_title_id,
       pp.licence_number                     as primary_licence_number,
       coalesce(l.ids, '{}')                 as language_ids,
       coalesce(c.ids, '{}')                 as clientele_ids,
       coalesce(s.ids, '{}')                 as specialty_ids,
       coalesce(m.ids, '{}')                 as motif_ids,
       mp.accepting_new_clients,
       r.matching_complete,
       r.ready,
       r.email_matches_login,
       p.created_at, p.updated_at
  from public.professionals p
  left join public.professional_professions pp on pp.professional_id = p.id and pp.is_primary
  left join public.professional_matching_profiles mp on mp.professional_id = p.id
  left join public.professionals_readiness r on r.professional_id = p.id
  left join (select x.professional_id, array_agg(x.language_id order by x.language_id) as ids
               from public.professional_languages x group by x.professional_id) l on l.professional_id = p.id
  left join (select x.professional_id, array_agg(x.clientele_id order by x.clientele_id) as ids
               from public.professional_clienteles x group by x.professional_id) c on c.professional_id = p.id
  left join (select x.professional_id, array_agg(x.specialty_id order by x.specialty_id) as ids
               from public.professional_specialties x group by x.professional_id) s on s.professional_id = p.id
  left join (select x.professional_id, array_agg(x.motif_id order by x.motif_id) as ids
               from public.professional_motifs x group by x.professional_id) m on m.professional_id = p.id
 where (select private.has_permission('professionals.view'));
revoke all on public.professionals_list from anon, authenticated;
grant select on public.professionals_list to authenticated;

-- Published contract (design §3.8): what Demandes matches on, one row per professional.
-- updated_at: the latest change of the record or its matching profile, so a stored recommendation
-- can say « profil modifié depuis ». Every set RPC that changes a set row (added, changed or
-- removed) bumps the record's updated_at, so the sets need no aggregate here. insurance_status is
-- 'unknown' until 4c.
create view public.professionals_directory with (security_invoker = true) as
select p.id, p.org_id, p.status,
       mp.accepting_new_clients,
       mp.availability_periods,
       p.first_name || ' ' || p.last_name    as display_name,
       pp.profession_title_id                as primary_title_id,
       pt.key                                as primary_title_key,
       pt.name                               as primary_title_name,
       pc.key                                as category_key,
       po.acronym                            as order_acronym,
       pp.licence_number,
       coalesce(pr.items, '[]')              as professions,
       coalesce(l.codes, '{}')               as language_codes,
       coalesce(c.items, '[]')               as clienteles,
       coalesce(s.items, '[]')               as specialties,
       coalesce(m.ids, '{}')                 as motif_ids,
       coalesce(m.keys, '{}')                as motif_keys,
       p.years_experience,
       p.gender,
       'unknown'::text                       as insurance_status,
       r.ready,
       greatest(p.updated_at, mp.updated_at) as updated_at
  from public.professionals p
  left join public.professional_matching_profiles mp on mp.professional_id = p.id
  left join public.professional_professions pp on pp.professional_id = p.id and pp.is_primary
  left join public.profession_titles pt on pt.org_id = pp.org_id and pt.id = pp.profession_title_id
  left join public.profession_categories pc on pc.org_id = pt.org_id and pc.id = pt.category_id
  left join public.professional_orders po on po.org_id = pt.org_id and po.id = pt.order_id
  left join public.professionals_readiness r on r.professional_id = p.id
  left join (select x.professional_id,
                    jsonb_agg(jsonb_build_object('id', x.id, 'title_id', t.id, 'title_key', t.key, 'title_name', t.name,
                                                 'category_key', tc.key, 'order_acronym', o.acronym,
                                                 'licence_number', x.licence_number, 'is_primary', x.is_primary)
                              order by x.is_primary desc, x.created_at, x.id) as items
               from public.professional_professions x
               join public.profession_titles t on t.org_id = x.org_id and t.id = x.profession_title_id
               join public.profession_categories tc on tc.org_id = t.org_id and tc.id = t.category_id
               left join public.professional_orders o on o.org_id = t.org_id and o.id = t.order_id
              group by x.professional_id) pr on pr.professional_id = p.id
  left join (select x.professional_id, array_agg(g.code order by g.sort_order, g.code) as codes
               from public.professional_languages x
               join public.languages g on g.org_id = x.org_id and g.id = x.language_id
              group by x.professional_id) l on l.professional_id = p.id
  left join (select x.professional_id,
                    jsonb_agg(jsonb_build_object('id', x.clientele_id, 'key', k.key, 'specialized', x.is_specialized,
                                                 'min_age', k.min_age, 'max_age', k.max_age)
                              order by k.sort_order, k.key) as items
               from public.professional_clienteles x
               join public.clienteles k on k.org_id = x.org_id and k.id = x.clientele_id
              group by x.professional_id) c on c.professional_id = p.id
  left join (select x.professional_id,
                    jsonb_agg(jsonb_build_object('id', x.specialty_id, 'key', k.key, 'specialized', x.is_specialized)
                              order by k.sort_order, k.key) as items
               from public.professional_specialties x
               join public.specialties k on k.org_id = x.org_id and k.id = x.specialty_id
              group by x.professional_id) s on s.professional_id = p.id
  left join (select x.professional_id, array_agg(x.motif_id order by k.key) as ids, array_agg(k.key order by k.key) as keys
               from public.professional_motifs x
               join public.motifs k on k.org_id = x.org_id and k.id = x.motif_id
              group by x.professional_id) m on m.professional_id = p.id
 where (select private.has_permission('professionals.view'));
revoke all on public.professionals_directory from anon, authenticated;
grant select on public.professionals_directory to authenticated;

-- The list, filtered, sorted and keyset-paged on the server. Filters are optional; a null or
-- empty array is no filter. Within a set filter any id matches; filters combine with « and ».
-- Sorts: 'name' (last name, first name, id) and 'recent' (status_changed_at desc, id desc).
-- Cursor: the last row's last_name + first_name + id ('name') or status_changed_at + id
-- ('recent'). A partial 'name' cursor: a last name alone starts after every row of that last
-- name; a full name without an id, after every row of that name. A 'recent' time without an id
-- starts strictly before it. The cursor and the org are plpgsql variables, i.e. plan
-- parameters: index bounds of professionals_org_name_idx / professionals_org_status_changed_idx
-- in any plan. The set filters are resolved first into one id array through their
-- (org_id, <x>_id) indexes.
-- Page size 1–200 (default 50).
create function public.list_professionals(
  p_statuses text[] default null,
  p_title_ids uuid[] default null,
  p_language_ids uuid[] default null,
  p_clientele_ids uuid[] default null,
  p_motif_ids uuid[] default null,
  p_accepting_new_clients boolean default null,
  p_sort text default 'name',
  p_after_last_name text default null,
  p_after_first_name text default null,
  p_after_status_changed_at timestamptz default null,
  p_after_id uuid default null,
  p_limit int default 50
)
returns setof public.professionals_list
language plpgsql
stable
set search_path = ''
-- Optional filters (« v is null or … »): plan each call with its values.
set plan_cache_mode = force_custom_plan
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_statuses text[] := nullif(p_statuses, '{}');
  v_titles uuid[] := nullif(p_title_ids, '{}');
  v_languages uuid[] := nullif(p_language_ids, '{}');
  v_clienteles uuid[] := nullif(p_clientele_ids, '{}');
  v_motifs uuid[] := nullif(p_motif_ids, '{}');
  v_filters int;
  v_ids uuid[];
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_last text := coalesce(p_after_last_name, '');
  v_first text := coalesce(p_after_first_name, '');
  v_last_only boolean := p_after_last_name is not null and p_after_first_name is null;
  v_at timestamptz := coalesce(p_after_status_changed_at, 'infinity');
  v_after_id uuid;
begin
  if p_sort is null or p_sort not in ('name', 'recent') then
    raise exception 'Tri inconnu : %', coalesce(p_sort, '(null)') using errcode = '22023';
  end if;
  if not v_statuses <@ array['draft', 'invited', 'in_review', 'active', 'inactive'] then
    raise exception 'Statut inconnu.' using errcode = '22023';
  end if;
  if greatest(pg_catalog.cardinality(v_titles), pg_catalog.cardinality(v_languages),
              pg_catalog.cardinality(v_clienteles), pg_catalog.cardinality(v_motifs)) > 500 then
    raise exception 'Filtre invalide : 500 identifiants au plus.' using errcode = '22023';
  end if;

  v_filters := (v_titles is not null)::int + (v_languages is not null)::int + (v_clienteles is not null)::int
             + (v_motifs is not null)::int + (p_accepting_new_clients is not null)::int;
  if v_filters > 0 then
    select coalesce(pg_catalog.array_agg(f.id), '{}') into v_ids
      from (select u.id
              from (select distinct 1 as k, x.professional_id as id from public.professional_professions x
                     where v_titles is not null and x.org_id = v_org and x.profession_title_id = any (v_titles)
                    union all
                    select distinct 2, x.professional_id from public.professional_languages x
                     where v_languages is not null and x.org_id = v_org and x.language_id = any (v_languages)
                    union all
                    select distinct 3, x.professional_id from public.professional_clienteles x
                     where v_clienteles is not null and x.org_id = v_org and x.clientele_id = any (v_clienteles)
                    union all
                    select distinct 4, x.professional_id from public.professional_motifs x
                     where v_motifs is not null and x.org_id = v_org and x.motif_id = any (v_motifs)
                    union all
                    select 5, x.professional_id from public.professional_matching_profiles x
                     where p_accepting_new_clients is not null and x.org_id = v_org
                       and x.accepting_new_clients = p_accepting_new_clients) u
             group by u.id
            having count(*) = v_filters) f;
  end if;

  if p_sort = 'name' then
    -- No cursor: ('', '', nil uuid), before every name. A full name without an id: the max uuid,
    -- after every row of that name. A last name alone: after every row of that last name
    -- (v_last_only; a plan constant, so only one of the two bounds remains in the plan).
    v_after_id := coalesce(p_after_id, case when p_after_last_name is null then '00000000-0000-0000-0000-000000000000'::uuid
                                            else 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid end);
    return query
      select l.* from public.professionals_list l
       where l.org_id = v_org
         and ((v_last_only and l.last_name > v_last)
              or (not v_last_only and (l.last_name, l.first_name, l.id) > (v_last, v_first, v_after_id)))
         and (v_statuses is null or l.status = any (v_statuses))
         and (v_ids is null or l.id = any (v_ids))
       order by l.last_name, l.first_name, l.id
       limit v_limit;
  else
    -- No cursor: (infinity, max uuid). A time without an id: the nil uuid, i.e. strictly older.
    v_after_id := coalesce(p_after_id, case when p_after_status_changed_at is null then 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
                                            else '00000000-0000-0000-0000-000000000000'::uuid end);
    return query
      select l.* from public.professionals_list l
       where l.org_id = v_org
         and (l.status_changed_at, l.id) < (v_at, v_after_id)
         and (v_statuses is null or l.status = any (v_statuses))
         and (v_ids is null or l.id = any (v_ids))
       order by l.status_changed_at desc, l.id desc
       limit v_limit;
  end if;
end;
$$;

-- The record page in one payload: the row and its 1:1 rows without org_id, every set as ids
-- (labels from the cached catalogue), readiness. Each set is bounded by its set RPC (≤ 500 ids,
-- ≤ 2 professions, one IVAC number). Null when the caller cannot read the professional (RLS:
-- staff with professionals.view, or the provider on their own record).
create function public.get_professional_record(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'professional', pg_catalog.to_jsonb(p) - 'org_id',
           'public_profile', (select pg_catalog.to_jsonb(x) - 'org_id' - 'professional_id'
                                from public.professional_public_profiles x where x.professional_id = p.id),
           'matching_profile', (select pg_catalog.to_jsonb(x) - 'org_id' - 'professional_id'
                                  from public.professional_matching_profiles x where x.professional_id = p.id),
           'professions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                             'id', x.id, 'profession_title_id', x.profession_title_id,
                                             'licence_number', x.licence_number, 'is_primary', x.is_primary)
                                           order by x.is_primary desc, x.created_at, x.id)
                                      from public.professional_professions x where x.professional_id = p.id), '[]'),
           'clienteles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.clientele_id, 'specialized', x.is_specialized)
                                          order by x.clientele_id)
                                     from public.professional_clienteles x where x.professional_id = p.id), '[]'),
           'specialties', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.specialty_id, 'specialized', x.is_specialized)
                                           order by x.specialty_id)
                                      from public.professional_specialties x where x.professional_id = p.id), '[]'),
           'motif_ids', coalesce((select pg_catalog.jsonb_agg(x.motif_id order by x.motif_id)
                                    from public.professional_motifs x where x.professional_id = p.id), '[]'),
           'language_ids', coalesce((select pg_catalog.jsonb_agg(x.language_id order by x.language_id)
                                       from public.professional_languages x where x.professional_id = p.id), '[]'),
           'payer_numbers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('payer_type', x.payer_type, 'number', x.number)
                                             order by x.payer_type)
                                        from public.professional_payer_numbers x where x.professional_id = p.id), '[]'),
           'readiness', public.get_professional_readiness(p.id))
    from public.professionals p
   where p.id = p_id
$$;

-- The public profile (Demandes' profile dialog, the fiche): names, not ids. Motifs grouped by
-- active category in category order; a motif without a category or whose category is archived
-- goes under « Autres » (key 'autres', no icon), last.
create function public.get_professional_public_profile(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'first_name', p.first_name,
           'last_name', p.last_name,
           'bio', pp.bio,
           'approach', pp.approach,
           'public_email', pp.public_email,
           'public_phone', pp.public_phone,
           'primary_title_name', t.name,
           'order_acronym', o.acronym,
           'licence_number', pr.licence_number,
           'motif_groups', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'category_key', g.category_key, 'category_name', g.category_name, 'icon', g.icon, 'motifs', g.motifs)
                    order by g.sort_order is null, g.sort_order, g.category_key)
               from (select case when mc.is_active then mc.key else 'autres' end as category_key,
                            case when mc.is_active then mc.name else 'Autres' end as category_name,
                            case when mc.is_active then mc.icon end as icon,
                            case when mc.is_active then mc.sort_order end as sort_order,
                            pg_catalog.jsonb_agg(m.name order by m.sort_order, m.name) as motifs
                       from public.professional_motifs x
                       join public.motifs m on m.org_id = x.org_id and m.id = x.motif_id
                       left join public.motif_categories mc on mc.org_id = m.org_id and mc.id = m.category_id
                      where x.professional_id = p.id
                      group by 1, 2, 3, 4) g), '[]'),
           'clienteles', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'name', k.name, 'min_age', k.min_age, 'max_age', k.max_age, 'specialized', x.is_specialized)
                    order by k.sort_order, k.name)
               from public.professional_clienteles x
               join public.clienteles k on k.org_id = x.org_id and k.id = x.clientele_id
              where x.professional_id = p.id), '[]'),
           'approaches', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', k.name, 'specialized', x.is_specialized)
                    order by k.sort_order, k.name)
               from public.professional_specialties x
               join public.specialties k on k.org_id = x.org_id and k.id = x.specialty_id
              where x.professional_id = p.id), '[]'))
    from public.professionals p
    left join public.professional_public_profiles pp on pp.professional_id = p.id
    left join public.professional_professions pr on pr.professional_id = p.id and pr.is_primary
    left join public.profession_titles t on t.org_id = pr.org_id and t.id = pr.profession_title_id
    left join public.professional_orders o on o.org_id = t.org_id and o.id = t.order_id
   where p.id = p_id
$$;

-- -----------------------------------------------------------------------------
-- History
-- -----------------------------------------------------------------------------
-- Tables shown in a professional's history; later batches replace this function with theirs
-- (4a.17 adds the private data, shown without values).
create function private.professional_history_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['professionals', 'professional_public_profiles', 'professional_matching_profiles',
               'professional_professions', 'professional_clienteles', 'professional_specialties',
               'professional_motifs', 'professional_languages', 'professional_payer_numbers']
$$;
revoke all on function private.professional_history_tables() from public, anon, authenticated, service_role;

-- A professional's audit rows (the record, its 1:1 rows and child rows, deleted ones included),
-- newest first, keyset-paged by id: pass the last row's id. The org, the prefix and the cursor
-- are bounds of audit_log_org_record_prefix_idx. Definer: actor names come from profiles of the
-- same org (as list_audit_entries) and audit_log needs audit.view otherwise. Values are as the
-- audit trigger wrote them, redacted fields included (« [redacted] »). Page size 1–200.
create function public.list_professional_history(p_id uuid, p_before_id bigint default null, p_limit int default 50)
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
  v_tables text[] := private.professional_history_tables();
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action, a.changed_fields,
           a.actor_id, pr.display_name, a.actor_role, a.source
      from public.audit_log a
      left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
     where a.org_id = v_org
       and left(a.record_id, 36) = v_prefix
       and a.id < v_before
       and a.table_name = any (v_tables)
     order by a.id desc
     limit v_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges (service_role: none; 4b.6 calls the status RPCs with the user's client)
-- -----------------------------------------------------------------------------
revoke all on function
  public.get_professional_readiness(uuid),
  public.activate_professional(uuid, text),
  public.deactivate_professional(uuid, uuid, text),
  public.list_professionals(text[], uuid[], uuid[], uuid[], uuid[], boolean, text, text, text, timestamptz, uuid, int),
  public.get_professional_record(uuid),
  public.get_professional_public_profile(uuid),
  public.list_professional_history(uuid, bigint, int)
from public, anon, authenticated, service_role;
grant execute on function
  public.get_professional_readiness(uuid),
  public.activate_professional(uuid, text),
  public.deactivate_professional(uuid, uuid, text),
  public.list_professionals(text[], uuid[], uuid[], uuid[], uuid[], boolean, text, text, text, timestamptz, uuid, int),
  public.get_professional_record(uuid),
  public.get_professional_public_profile(uuid),
  public.list_professional_history(uuid, bigint, int)
to authenticated;
