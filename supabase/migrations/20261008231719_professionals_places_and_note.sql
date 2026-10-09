-- =============================================================================
-- Professionnels: « Places offertes » and « Bon à savoir » on the matching profile
-- =============================================================================
-- Plan:     docs/plans/2026-10-08-professionals-module-plan.md, « Places offertes and Bon à savoir »
--           (P4-382 … P4-387)
-- Research: docs/research/2026-10-08-intake-workbook.md §3.1, §3.2, §3.4, §7.1
-- Rules:    docs/standards/database-conventions.md
--
-- Key choices
-- * Places offertes (P4-382): professional_matching_profiles.new_client_places (smallint 0–99,
--   null = not tracked, the workbook's « lui écrire si demande ») and new_client_places_set_at,
--   stamped by a trigger whenever the number changes (null with it), never written by a client.
--   It replaces the workbook's « Date d'inscription ». Staff edit it in Jumelage through the column
--   grant, as the other matching fields (professionals.matching). This module stores the declared
--   number only: the places left (declared − first appointments confirmed since set_at + places a
--   cancellation gives back) are Demandes' to compute (docs/modules/professionals.md). Not in the
--   provider's questionnaire (P4-383).
-- * Bon à savoir (P4-384): a staff-only free text, ≤ 1000 characters, in its own 1:1 table,
--   professional_matching_notes, not a column of the matching profile: a provider reads their own
--   matching profile (select_self policy, and get_professional_record as the provider), and a
--   column there would reach them. The note table has a staff select policy only
--   (professionals.view) and no client write grant; set_professional_matching_note
--   (professionals.matching) writes it, an empty note deletes the row. Neither the public profile,
--   the fiche nor the questionnaire read it.
-- * Audit (P4-385): the note's text is redacted (audit_trigger('note')): the history says « a
--   modifié la note Bon à savoir » and never prints it, nor does the Journal d'audit.
-- * Read models: professionals_directory appends new_client_places, new_client_places_set_at and
--   matching_note (staff read model: the view needs professionals.view); get_professional_record
--   adds matching_note ({note, updated_at}, null without one or for the provider). The history
--   lists the note table. set_professional_matching_note bumps professionals.updated_at when it
--   changed something, so the directory's updated_at follows (as the set RPCs, 4a.4).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_places_and_note', true);

-- -----------------------------------------------------------------------------
-- Places offertes (P4-382)
-- -----------------------------------------------------------------------------
alter table public.professional_matching_profiles
  add column new_client_places smallint,
  add column new_client_places_set_at timestamptz,
  add constraint professional_matching_profiles_new_client_places_check check (new_client_places between 0 and 99),
  add constraint professional_matching_profiles_new_client_places_set_at_check
    check ((new_client_places is null) = (new_client_places_set_at is null));

grant update (new_client_places) on public.professional_matching_profiles to authenticated;

-- Stamps the day the number was (re)declared: whenever it changes, now(); null with it. A client
-- cannot write the stamp (no grant), and a writer that sets it is overruled.
create function private.stamp_new_client_places()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.new_client_places is not distinct from old.new_client_places then
    new.new_client_places_set_at := old.new_client_places_set_at;
  else
    new.new_client_places_set_at := case when new.new_client_places is not null then pg_catalog.now() end;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_new_client_places() from public, anon, authenticated, service_role;

create trigger professional_matching_profiles_stamp_places
  before insert or update on public.professional_matching_profiles
  for each row execute function private.stamp_new_client_places();

-- -----------------------------------------------------------------------------
-- Bon à savoir (P4-384, P4-385)
-- -----------------------------------------------------------------------------
create table public.professional_matching_notes (
  professional_id uuid primary key,
  org_id uuid not null,
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_matching_notes_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_matching_notes_note_check
    check (char_length(note) <= 1000 and note = btrim(note, E' \t\r\n') and note <> '')
);
create index professional_matching_notes_org_idx on public.professional_matching_notes (org_id);

revoke all on public.professional_matching_notes from anon, authenticated;
grant select on public.professional_matching_notes to authenticated;
alter table public.professional_matching_notes enable row level security;

-- Staff only: no self policy, so a provider never reads it, whatever they query.
create policy professional_matching_notes_select_staff on public.professional_matching_notes
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));

create trigger professional_matching_notes_set_updated_at before update on public.professional_matching_notes
  for each row execute function private.set_updated_at();
create trigger professional_matching_notes_audit after insert or update or delete on public.professional_matching_notes
  for each row execute function private.audit_trigger('note');

-- « Bon à savoir »: the note, trimmed (spaces, tabs, line breaks at both ends); empty or null
-- deletes it. Returns {note, updated_at}, or null once there is none. Writes only what changes:
-- saving the same text again leaves no audit row.
create function public.set_professional_matching_note(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_note text := nullif(pg_catalog.btrim(p_note, E' \t\r\n'), '');
  v_row public.professional_matching_notes;
  v_changed boolean;
begin
  if not private.has_permission('professionals.matching') then
    raise exception 'Permission refusée : professionals.matching' using errcode = '42501';
  end if;
  if pg_catalog.char_length(v_note) > 1000 then
    raise exception 'La note compte au plus 1000 caractères.' using errcode = 'P0001', hint = 'note';
  end if;
  perform private.lock_professional(p_id);

  if v_note is null then
    delete from public.professional_matching_notes n where n.professional_id = p_id and n.org_id = v_org;
    v_changed := found;
  else
    insert into public.professional_matching_notes as n (org_id, professional_id, note)
    values (v_org, p_id, v_note)
    on conflict on constraint professional_matching_notes_pkey do update
      set note = excluded.note
    where n.note <> excluded.note;
    v_changed := found;
  end if;
  if v_changed then
    update public.professionals p set updated_at = pg_catalog.now() where p.id = p_id;
  end if;

  select * into v_row from public.professional_matching_notes n where n.professional_id = p_id and n.org_id = v_org;
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object('note', v_row.note, 'updated_at', v_row.updated_at);
end;
$$;
revoke all on function public.set_professional_matching_note(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_professional_matching_note(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- History: the note table (its text is redacted, P4-385)
-- -----------------------------------------------------------------------------
-- Same body as *_professionals_onboarding.sql, plus professional_matching_notes.
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
               'professional_client_agreements', 'professional_submissions', 'professional_consents']
$$;

-- -----------------------------------------------------------------------------
-- The record: matching_note (null without one, and for the provider: RLS)
-- -----------------------------------------------------------------------------
-- Same signature, grants and keys as *_professionals_lifecycle.sql, plus matching_note.
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
           'readiness', public.get_professional_readiness(p.id))
    from public.professionals p
   where p.id = p_id
$$;

-- -----------------------------------------------------------------------------
-- The directory (published to Demandes): three columns appended
-- -----------------------------------------------------------------------------
-- Same columns, joins and filter as *_professionals_lifecycle.sql, then new_client_places,
-- new_client_places_set_at (places offertes and the day they were declared, P4-382) and
-- matching_note (« Bon à savoir », staff only, P4-384). The places left are Demandes' to compute.
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
       'unknown'::text                       as insurance_status,
       r.ready,
       greatest(p.updated_at, mp.updated_at) as updated_at,
       mp.new_client_places,
       mp.new_client_places_set_at,
       n.note                                as matching_note
  from public.professionals p
  left join public.professional_matching_profiles mp on mp.professional_id = p.id
  left join public.professional_matching_notes n on n.professional_id = p.id
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

select pg_catalog.set_config('app.audit_source', '', true);
