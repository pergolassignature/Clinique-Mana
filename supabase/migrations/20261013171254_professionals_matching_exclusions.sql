-- =============================================================================
-- Professionnels: refused motifs and the matching priority (for Demandes D4)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D4); research
--            docs/research/2026-10-08-intake-workbook.md §3.1, §3.4, §8.5
-- Decisions: P4-551 (refused motifs), P4-552 (matching priority), R-66 (Christine, answer 21),
--            Christine's answer 19 (the workbook's colours guide the counselors' priorities)
--
-- * Refused motifs (P4-551): what a professional would rather not take (« pas de … », ~17 of the
--   workbook's « Bon à savoir »), as motifs. Demandes shows a refused motif present in a request
--   as a **warning**, never a filter (R-66: « ça dépend »). Staff only, like « Bon à savoir »:
--   the provider never reads them. `set_professional_refused_motifs(id, motif_ids[])`
--   (`professionals.matching`): an archived motif may stay, never be added; a motif both held and
--   refused is refused (P0001). Audited.
-- * The matching priority (P4-552): the workbook's name colours were the counselors' priority
--   hint, never written down. Here it is a plain « À prioriser » with its reason (a new
--   professional to fill, a programme…), shown as a badge in Demandes' panel; it never changes the
--   order. Staff only; `set_professional_matching_priority(id, reason)` (`.matching`; an empty
--   reason removes it). Audited.
-- * Published for Demandes' definer code and jobs (no user): `private.professional_matching_facts
--   (org, ids[] default null)` → the directory's matching facts with active reference rows only
--   (rule 7), granted to no role; another clinic's ids answer nothing.
-- Additive: two tables, three functions, the directory and the record bundle widened (columns /
-- keys appended).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_matching_exclusions', true);

create table public.professional_refused_motifs (
  org_id uuid not null,
  professional_id uuid not null,
  motif_id uuid not null,
  created_at timestamptz not null default now(),
  constraint professional_refused_motifs_pkey primary key (professional_id, motif_id),
  constraint professional_refused_motifs_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_refused_motifs_motif_fkey foreign key (org_id, motif_id) references public.motifs (org_id, id)
);
create index professional_refused_motifs_org_professional_idx on public.professional_refused_motifs (org_id, professional_id);
create index professional_refused_motifs_org_motif_idx on public.professional_refused_motifs (org_id, motif_id);

create table public.professional_matching_priorities (
  professional_id uuid primary key,
  org_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_matching_priorities_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_matching_priorities_reason_check check (char_length(reason) between 1 and 200 and private.is_tidy_text(reason))
);
create index professional_matching_priorities_org_idx on public.professional_matching_priorities (org_id, professional_id);
create trigger professional_matching_priorities_set_updated_at before update on public.professional_matching_priorities
  for each row execute function private.set_updated_at();

alter table public.professional_refused_motifs enable row level security;
alter table public.professional_matching_priorities enable row level security;
revoke all on public.professional_refused_motifs, public.professional_matching_priorities from anon, authenticated;
grant select on public.professional_refused_motifs, public.professional_matching_priorities to authenticated;
create policy professional_refused_motifs_select_staff on public.professional_refused_motifs
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_matching_priorities_select_staff on public.professional_matching_priorities
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));

create trigger professional_refused_motifs_audit after insert or update or delete on public.professional_refused_motifs
  for each row execute function private.audit_trigger();
create trigger professional_matching_priorities_audit after insert or update or delete on public.professional_matching_priorities
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- RPCs (professionals.matching)
-- -----------------------------------------------------------------------------
-- The motifs the professional would rather not take (a warning in Demandes, R-66). Same rules as
-- set_professional_motifs: [] clears, null refuses, ≤ 500 ids, an archived motif may stay but is
-- never added; never a motif she holds. Returns the set.
create function public.set_professional_refused_motifs(p_id uuid, p_motif_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_ids uuid[];
  v_bad text;
  v_rows int;
  v_n int;
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  v_ids := private.distinct_ids(p_motif_ids);
  perform private.lock_professional(p_id);

  if exists (select 1 from pg_catalog.unnest(v_ids) as x
              where not exists (select 1 from public.motifs m where m.org_id = v_org and m.id = x)) then
    raise exception 'Motif inconnu.' using errcode = '22023';
  end if;
  select m.name into v_bad
    from pg_catalog.unnest(v_ids) as x
    join public.motifs m on m.org_id = v_org and m.id = x
   where not m.is_active
     and not exists (select 1 from public.professional_refused_motifs r where r.professional_id = p_id and r.motif_id = x)
   order by m.sort_order, m.name
   limit 1;
  if v_bad is not null then
    raise exception 'Le motif « % » est archivé.', v_bad using errcode = 'P0001';
  end if;
  select m.name into v_bad
    from pg_catalog.unnest(v_ids) as x
    join public.motifs m on m.org_id = v_org and m.id = x
   where exists (select 1 from public.professional_motifs pm where pm.professional_id = p_id and pm.motif_id = x)
   order by m.sort_order, m.name
   limit 1;
  if v_bad is not null then
    raise exception 'Le motif « % » fait partie de ses motifs : retirez-le d''abord de ses motifs.', v_bad
      using errcode = 'P0001', hint = 'held';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:set_professional_refused_motifs', true);
  delete from public.professional_refused_motifs r where r.professional_id = p_id and r.motif_id <> all (v_ids);
  get diagnostics v_rows = row_count;
  insert into public.professional_refused_motifs (org_id, professional_id, motif_id)
  select v_org, p_id, x from pg_catalog.unnest(v_ids) as x
  on conflict do nothing;
  get diagnostics v_n = row_count;
  v_rows := v_rows + v_n;
  if v_rows > 0 then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  end if;

  return query select r.motif_id from public.professional_refused_motifs r where r.professional_id = p_id order by r.motif_id;
end;
$$;
revoke all on function public.set_professional_refused_motifs(uuid, uuid[]) from public, anon;
grant execute on function public.set_professional_refused_motifs(uuid, uuid[]) to authenticated;

-- « À prioriser » with its reason, or none (an empty reason). Returns {reason, updated_at} or null.
create function public.set_professional_matching_priority(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, ''), E' \t\r\n'), '');
  v public.professional_matching_priorities;
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  perform private.lock_professional(p_id);
  if v_reason is not null and (pg_catalog.char_length(v_reason) > 200 or not private.is_tidy_text(v_reason)) then
    raise exception 'La raison compte 200 caractères au plus, sur une ligne.' using errcode = 'P0001', hint = 'reason';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_professional_matching_priority', true);
  if v_reason is null then
    delete from public.professional_matching_priorities x where x.professional_id = p_id;
    if found then
      update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
    end if;
    return null;
  end if;
  insert into public.professional_matching_priorities as x (professional_id, org_id, reason)
  values (p_id, v_org, v_reason)
  on conflict (professional_id) do update set reason = excluded.reason
    where x.reason is distinct from excluded.reason
  returning * into v;
  if v.professional_id is not null then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  else
    select x.* into v from public.professional_matching_priorities x where x.professional_id = p_id;
  end if;
  return pg_catalog.jsonb_build_object('reason', v.reason, 'updated_at', v.updated_at);
end;
$$;
revoke all on function public.set_professional_matching_priority(uuid, text) from public, anon;
grant execute on function public.set_professional_matching_priority(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- The directory gains both (columns appended; the rest unchanged)
-- -----------------------------------------------------------------------------
create or replace view public.professionals_directory with (security_invoker = true) as
select p.id, p.org_id, p.status,
       mp.accepting_new_clients,
       mp.availability_periods,
       mp.min_client_age,
       mp.women_only,
       p.first_name || ' ' || p.last_name    as display_name,
       pp.profession_title_id                as primary_title_id,
       pt.key                                as primary_title_key,
       pt.name                               as primary_title_name,
       private.profession_title_label(pt.name, pt.name_feminine, pt.name_masculine, p.gender)
                                             as primary_title_label,
       pc.key                                as category_key,
       po.acronym                            as order_acronym,
       pp.licence_number,
       coalesce(pr.items, '[]')              as professions,
       coalesce(l.codes, '{}')               as language_codes,
       coalesce(c.items, '[]')               as clienteles,
       coalesce(m.ids, '{}')                 as motif_ids,
       coalesce(m.keys, '{}')                as motif_keys,
       p.years_experience,
       p.gender,
       coalesce(r.insurance_status, 'missing') as insurance_status,
       r.ready,
       greatest(p.updated_at, mp.updated_at) as updated_at,
       mp.new_client_places,
       mp.new_client_places_set_at,
       n.note                                as matching_note,
       coalesce(rm.ids, '{}')                as refused_motif_ids,
       mpr.reason                            as matching_priority_reason
  from public.professionals p
  left join public.professional_matching_profiles mp on mp.professional_id = p.id
  left join public.professional_matching_notes n on n.professional_id = p.id
  left join public.professional_matching_priorities mpr on mpr.professional_id = p.id
  left join (select x.professional_id, array_agg(x.motif_id order by k.key) as ids
               from public.professional_refused_motifs x
               join public.motifs k on k.org_id = x.org_id and k.id = x.motif_id
              group by x.professional_id) rm on rm.professional_id = p.id
  left join public.professional_professions pp on pp.professional_id = p.id and pp.is_primary
  left join public.profession_titles pt on pt.org_id = pp.org_id and pt.id = pp.profession_title_id
  left join public.profession_categories pc on pc.org_id = pt.org_id and pc.id = pt.category_id
  left join public.professional_orders po on po.org_id = pt.org_id and po.id = pt.order_id
  left join public.professionals_readiness r on r.professional_id = p.id
  left join (select x.professional_id,
                    jsonb_agg(jsonb_build_object('id', x.id, 'title_id', t.id, 'title_key', t.key, 'title_name', t.name,
                                                 'title_label', private.profession_title_label(t.name, t.name_feminine, t.name_masculine, xp.gender),
                                                 'category_key', tc.key, 'order_acronym', o.acronym,
                                                 'licence_number', x.licence_number, 'is_primary', x.is_primary)
                              order by x.is_primary desc, x.created_at, x.id) as items
               from public.professional_professions x
               join public.professionals xp on xp.id = x.professional_id
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
  left join (select x.professional_id, array_agg(x.motif_id order by k.key) as ids, array_agg(k.key order by k.key) as keys
               from public.professional_motifs x
               join public.motifs k on k.org_id = x.org_id and k.id = x.motif_id
              group by x.professional_id) m on m.professional_id = p.id
 where (select private.has_permission('professionals.view'));

-- -----------------------------------------------------------------------------
-- The record bundle gains both (staff only through RLS)
-- -----------------------------------------------------------------------------
create or replace function public.get_professional_record(p_id uuid)
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
           'matching_note', (select pg_catalog.jsonb_build_object('note', x.note, 'updated_at', x.updated_at)
                               from public.professional_matching_notes x where x.professional_id = p.id),
           -- Staff only (RLS): an empty list and null for the provider.
           'refused_motif_ids', coalesce((select pg_catalog.jsonb_agg(x.motif_id order by x.motif_id)
                                            from public.professional_refused_motifs x where x.professional_id = p.id), '[]'),
           'matching_priority', (select pg_catalog.jsonb_build_object('reason', x.reason, 'updated_at', x.updated_at)
                                   from public.professional_matching_priorities x where x.professional_id = p.id),
           'professions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                             'id', x.id, 'profession_title_id', x.profession_title_id,
                                             'licence_number', x.licence_number, 'is_primary', x.is_primary)
                                           order by x.is_primary desc, x.created_at, x.id)
                                      from public.professional_professions x where x.professional_id = p.id), '[]'),
           'clienteles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.clientele_id, 'specialized', x.is_specialized)
                                          order by x.clientele_id)
                                     from public.professional_clienteles x where x.professional_id = p.id), '[]'),
           'motif_ids', coalesce((select pg_catalog.jsonb_agg(x.motif_id order by x.motif_id)
                                    from public.professional_motifs x where x.professional_id = p.id), '[]'),
           'language_ids', coalesce((select pg_catalog.jsonb_agg(x.language_id order by x.language_id)
                                       from public.professional_languages x where x.professional_id = p.id), '[]'),
           'payer_numbers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('payer_type', x.payer_type, 'number', x.number)
                                             order by x.payer_type)
                                        from public.professional_payer_numbers x where x.professional_id = p.id), '[]'),
           'photo_file_id', (select d.stored_file_id
                               from public.professional_public_profiles x
                               join public.professional_documents d
                                 on d.professional_id = x.professional_id and d.id = x.photo_document_id
                              where x.professional_id = p.id and d.status = 'verified'),
           'readiness', public.get_professional_readiness(p.id))
    from public.professionals p
   where p.id = p_id
$$;
-- -----------------------------------------------------------------------------
-- Published for Demandes' definer code and jobs (granted to no role)
-- -----------------------------------------------------------------------------
-- The matching facts of the clinic's professionals (all of them, or the ids given), with active
-- reference rows only (rule 7: archived titles, languages, clientèles and motifs never match).
-- No permission check: the caller (Demandes' definer RPC after its own checks, or its job) names
-- the org it verified. « Bon à savoir », the refused motifs and the priority are staff facts: a
-- caller shows them to staff only.
create function private.professional_matching_facts(p_org uuid, p_ids uuid[] default null)
returns table (
  professional_id uuid,
  status text,
  ready boolean,
  accepting_new_clients boolean,
  availability_periods text[],
  min_client_age smallint,
  women_only boolean,
  gender text,
  display_name text,
  primary_title_label text,
  title_ids uuid[],
  language_codes text[],
  clienteles jsonb,
  motif_ids uuid[],
  refused_motif_ids uuid[],
  insurance_status text,
  new_client_places smallint,
  new_client_places_set_at timestamptz,
  matching_note text,
  matching_priority_reason text,
  updated_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.status, coalesce(r.ready, false),
         coalesce(mp.accepting_new_clients, false), coalesce(mp.availability_periods, '{}'),
         mp.min_client_age, coalesce(mp.women_only, false), p.gender,
         p.first_name || ' ' || p.last_name,
         private.profession_title_label(pt.name, pt.name_feminine, pt.name_masculine, p.gender),
         coalesce((select pg_catalog.array_agg(x.profession_title_id order by x.is_primary desc, x.profession_title_id)
                     from public.professional_professions x
                     join public.profession_titles t on t.org_id = x.org_id and t.id = x.profession_title_id and t.is_active
                    where x.professional_id = p.id), '{}'),
         coalesce((select pg_catalog.array_agg(g.code order by g.code)
                     from public.professional_languages x
                     join public.languages g on g.org_id = x.org_id and g.id = x.language_id and g.is_active
                    where x.professional_id = p.id), '{}'),
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.clientele_id, 'key', k.key, 'name', k.name,
                                                   'specialized', x.is_specialized, 'min_age', k.min_age, 'max_age', k.max_age)
                                                 order by k.key)
                     from public.professional_clienteles x
                     join public.clienteles k on k.org_id = x.org_id and k.id = x.clientele_id and k.is_active
                    where x.professional_id = p.id), '[]'),
         coalesce((select pg_catalog.array_agg(x.motif_id order by x.motif_id)
                     from public.professional_motifs x
                     join public.motifs k on k.org_id = x.org_id and k.id = x.motif_id and k.is_active
                    where x.professional_id = p.id), '{}'),
         coalesce((select pg_catalog.array_agg(x.motif_id order by x.motif_id)
                     from public.professional_refused_motifs x
                     join public.motifs k on k.org_id = x.org_id and k.id = x.motif_id and k.is_active
                    where x.professional_id = p.id), '{}'),
         coalesce(r.insurance_status, 'missing'),
         mp.new_client_places, mp.new_client_places_set_at,
         n.note, mpr.reason,
         greatest(p.updated_at, mp.updated_at)
    from public.professionals p
    left join public.professional_matching_profiles mp on mp.professional_id = p.id
    left join public.professional_matching_notes n on n.professional_id = p.id
    left join public.professional_matching_priorities mpr on mpr.professional_id = p.id
    left join public.professional_professions pp on pp.professional_id = p.id and pp.is_primary
    left join public.profession_titles pt on pt.org_id = pp.org_id and pt.id = pp.profession_title_id
    left join public.professionals_readiness r on r.professional_id = p.id
   where p.org_id = p_org and (p_ids is null or p.id = any (p_ids))
$$;
revoke all on function private.professional_matching_facts(uuid, uuid[]) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Historique shows both (the history's tables, widened)
-- -----------------------------------------------------------------------------
create or replace function private.professional_history_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['professionals', 'professional_public_profiles', 'professional_matching_profiles',
               'professional_matching_notes',
               'professional_professions', 'professional_clienteles',
               'professional_motifs', 'professional_languages', 'professional_payer_numbers',
               'professional_private', 'professional_retention', 'professional_session_counts',
               'professional_client_agreements', 'professional_submissions', 'professional_consents',
               'professional_documents', 'professional_invitation_deliveries', 'professional_paper_contracts',
               'professional_contract_snapshots',
               'professional_refused_motifs', 'professional_matching_priorities']
$$;

select pg_catalog.set_config('app.audit_source', '', true);
