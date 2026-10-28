-- =============================================================================
-- Professionnels: « Approches » back, as checkboxes, counted but off the fiche (P4-510)
-- =============================================================================
-- Asked by Jonathan, « Suivi - application » of 22 October 2026: « Ajouter case à cocher pour
-- sélectionner les approches, je veux les comptabiliser mais je ne veux pas les ajouter sur la
-- fiche professionnelle », with the seventeen he wants offered.
-- Needs:   *_professionals_reference_data.sql (the catalogues and their seed),
--          *_professionals_core.sql (professionals, the per-professional sets),
--          *_professionals_onboarding.sql (the questionnaire's sections and fields),
--          *_professionals_core_helpers_wording.sql (the latest `apply_professional_submission`).
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6.
--
-- **Revives what P4-240 and P4-276 removed** — both Jonathan's own decisions, and he is the one
-- asking for them back, so the reversal is his (P4-510, decisions log).
--
-- Key choices
-- * A catalogue (`approaches`) and a per-professional set (`professional_approaches`), as the
--   clientèles and the motifs: the clinic can reword, reorder or archive one without a migration.
-- * **In the `portrait` section, not a twelfth one.** The questionnaire keeps its eleven sections
--   and twelve steps: `approach_ids` joins `bio`, `approach`, `public_email` and `public_phone`,
--   which is where « comment vous travaillez » already lives. A new section would have renumbered
--   every step, the nav and `submission_gaps` for one optional field.
-- * **Optional, and never a gap**: `submission_gaps` still asks only for `bio` in the portrait, so
--   a professional who picks none can still finish her questionnaire.
-- * **Off the fiche.** Nothing is added to `professional_public_profiles`, to the record's tabs or
--   to the matching: the set is written by the questionnaire and read for counting
--   (`count_professional_approaches`, `professionals.view`). The portrait's free-text
--   « Approche » (P4-276) stays as it is — that is the prose the fiche shows.
-- * « Autre — précisez » is a catalogue row like the others (key `other`); what the professional
--   types goes in `professional_approaches.other_text`, kept beside the row it explains.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_approaches', true);

-- -----------------------------------------------------------------------------
-- The catalogue
-- -----------------------------------------------------------------------------
create table public.approaches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  -- `other` and the sixteen named ones are the clinic's own list: none is matched on by key, so
  -- none is `is_system`; every one may be archived.
  requires_text boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approaches_key_check check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint approaches_name_check check (char_length(name) between 1 and 120 and private.is_tidy_text(name)),
  constraint approaches_org_id_key_key unique (org_id, key),
  constraint approaches_org_id_id_key unique (org_id, id)
);
create unique index approaches_org_name_key on public.approaches (org_id, lower(normalize(name, NFKC)));
create index approaches_org_sort_idx on public.approaches (org_id, sort_order);

create trigger approaches_set_updated_at before update on public.approaches
  for each row execute function private.set_updated_at();
create trigger approaches_audit after insert or update or delete on public.approaches
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- What each professional selected
-- -----------------------------------------------------------------------------
create table public.professional_approaches (
  org_id uuid not null,
  professional_id uuid not null,
  approach_id uuid not null,
  -- « Autre — précisez »: only the row that asks for it may carry a text (checked on write).
  other_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_approaches_pkey primary key (professional_id, approach_id),
  constraint professional_approaches_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_approaches_approach_fkey foreign key (org_id, approach_id)
    references public.approaches (org_id, id),
  constraint professional_approaches_other_text_check check (
    other_text is null or (char_length(other_text) between 1 and 200 and private.is_tidy_text(other_text)))
);
create index professional_approaches_org_approach_idx
  on public.professional_approaches (org_id, approach_id) include (professional_id);

create trigger professional_approaches_set_updated_at before update on public.professional_approaches
  for each row execute function private.set_updated_at();
-- The free text is the professional's own words about how she works: redacted from the journal.
create trigger professional_approaches_audit after insert or update or delete on public.professional_approaches
  for each row execute function private.audit_trigger('other_text');

-- -----------------------------------------------------------------------------
-- Closed by default, read where the other catalogues are read
-- -----------------------------------------------------------------------------
alter table public.approaches enable row level security;
alter table public.professional_approaches enable row level security;

revoke all on public.approaches, public.professional_approaches from anon, authenticated;
grant select on public.approaches, public.professional_approaches to authenticated;

create policy approaches_select on public.approaches
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));
create policy professional_approaches_select_staff on public.professional_approaches
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.view')));
create policy professional_approaches_select_self on public.professional_approaches
  for select to authenticated
  using (professional_id = (select private.current_professional_id()) and (select private.has_permission('professionals.self')));

-- -----------------------------------------------------------------------------
-- The seventeen Jonathan listed, in his order
-- -----------------------------------------------------------------------------
create function private.seed_professional_approaches(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professional_approaches', true);
  insert into public.approaches (org_id, key, name, requires_text, sort_order) values
    (p_org, 'cbt', 'Approche cognitive et comportementale (TCC)', false, 10),
    (p_org, 'humanistic', 'Approche humaniste et existentielle', false, 20),
    (p_org, 'psychodynamic', 'Approche psychodynamique et analytique', false, 30),
    (p_org, 'systemic', 'Approche systémique et interactionnelle', false, 40),
    (p_org, 'integrative', 'Approche intégrative', false, 50),
    (p_org, 'solution_focused', 'Approche orientée vers les solutions', false, 60),
    (p_org, 'strengths_based', 'Approche centrée sur les forces', false, 70),
    (p_org, 'attachment', 'Approche fondée sur l''attachement', false, 80),
    (p_org, 'narrative', 'Approche narrative', false, 90),
    (p_org, 'motivational', 'Entretien motivationnel', false, 100),
    (p_org, 'act', 'Thérapie d''acceptation et d''engagement (ACT)', false, 110),
    (p_org, 'dbt', 'Thérapie comportementale dialectique (TCD/DBT)', false, 120),
    (p_org, 'schema', 'Thérapie des schémas', false, 130),
    (p_org, 'emotion_focused', 'Thérapie centrée sur les émotions', false, 140),
    (p_org, 'mindfulness', 'Interventions basées sur la pleine conscience', false, 150),
    (p_org, 'emdr', 'EMDR — Désensibilisation et retraitement par les mouvements oculaires', false, 160),
    (p_org, 'other', 'Autre — précisez', true, 170)
  on conflict do nothing;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;
revoke all on function private.seed_professional_approaches(uuid) from public, anon, authenticated, service_role;

-- Every clinic that exists today.
do $do$
declare
  v_org uuid;
begin
  for v_org in select o.id from public.organizations o loop
    perform private.seed_professional_approaches(v_org);
  end loop;
end
$do$;

-- …and every clinic created later: the reference seed's trigger seeds these too. Replaced rather
-- than `seed_professionals_reference` itself, which is long and otherwise unchanged.
create or replace function private.seed_professionals_reference_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_professionals_reference(new.id);
  perform private.seed_professional_approaches(new.id);
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- The questionnaire: one more field in « Portrait »
-- -----------------------------------------------------------------------------
-- Latest body: 20261008191219_professionals_onboarding.sql. `approach_ids` sits with the portrait's
-- other fields and the ords after it move up by one (nothing stores an ord: it only orders the
-- field lists the review and the answer build).
create or replace function private.submission_fields()
returns table (section text, field text, kind text, ord int)
language sql
immutable
set search_path = ''
as $$
  select x.section, x.field, x.kind, x.ord::int from (values
    ('personal', 'personal_phone', 'plain', 1), ('personal', 'address_line1', 'plain', 2),
    ('personal', 'address_line2', 'plain', 3), ('personal', 'city', 'plain', 4),
    ('personal', 'province', 'plain', 5), ('personal', 'postal_code', 'plain', 6),
    ('professional', 'professions', 'set', 7), ('professional', 'years_experience', 'plain', 8),
    ('portrait', 'bio', 'plain', 9), ('portrait', 'approach', 'plain', 10),
    ('portrait', 'approach_ids', 'set', 11),
    ('portrait', 'public_email', 'plain', 12), ('portrait', 'public_phone', 'plain', 13),
    ('languages', 'language_ids', 'set', 14),
    ('clienteles', 'clienteles', 'set', 15), ('clienteles', 'min_client_age', 'plain', 16),
    ('clienteles', 'women_only', 'plain', 17),
    ('motifs', 'motif_ids', 'set', 18),
    ('availability', 'accepting_new_clients', 'plain', 19), ('availability', 'availability_periods', 'plain', 20),
    ('availability', 'availability_note', 'plain', 21),
    ('photo', 'photo', 'file', 22),
    ('insurance', 'insurance', 'file', 23),
    ('tax_bank', 'business_number', 'private', 24), ('tax_bank', 'gst_number', 'private', 25),
    ('tax_bank', 'qst_number', 'private', 26), ('tax_bank', 'bank_institution', 'private', 27),
    ('tax_bank', 'bank_transit', 'private', 28), ('tax_bank', 'bank_account', 'private', 29),
    ('tax_bank', 'sin', 'private', 30),
    ('consent', 'consent', 'consent', 31)
  ) as x(section, field, kind, ord)
$$;

-- A field may be applied on approval.
alter table public.professional_submissions
  drop constraint professional_submissions_applied_fields_check;
alter table public.professional_submissions
  add constraint professional_submissions_applied_fields_check check (
    applied_fields <@ array['personal_phone', 'address_line1', 'address_line2', 'city', 'province', 'postal_code',
                            'professions', 'years_experience', 'bio', 'approach', 'approach_ids', 'public_email', 'public_phone',
                            'language_ids', 'clienteles', 'min_client_age', 'women_only', 'motif_ids', 'accepting_new_clients',
                            'availability_periods', 'availability_note', 'photo', 'insurance', 'business_number',
                            'gst_number', 'qst_number', 'bank_institution', 'bank_transit', 'bank_account', 'sin',
                            'consent']);

-- -----------------------------------------------------------------------------
-- Writing the set (the staff write path the approval goes through)
-- -----------------------------------------------------------------------------
-- Replaces the professional's approaches with p_ids, keeping the text of « Autre — précisez ».
-- Refuses an id that is not this clinic's, or an archived one that she does not already hold.
create function private.apply_professional_approaches(p_org uuid, p_id uuid, p_ids uuid[], p_other text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_other uuid;
begin
  if pg_catalog.cardinality(coalesce(p_ids, '{}')) > 0
     and exists (select 1 from pg_catalog.unnest(p_ids) x
                  where not exists (select 1 from public.approaches a
                                     where a.org_id = p_org and a.id = x
                                       and (a.is_active
                                            or exists (select 1 from public.professional_approaches pa
                                                        where pa.org_id = p_org and pa.professional_id = p_id
                                                          and pa.approach_id = x)))) then
    raise exception 'Approche inconnue ou archivée.' using errcode = 'P0001', hint = 'approach_ids';
  end if;
  select a.id into v_other from public.approaches a
   where a.org_id = p_org and a.requires_text and a.id = any (coalesce(p_ids, '{}'));
  delete from public.professional_approaches pa
   where pa.org_id = p_org and pa.professional_id = p_id
     and not (pa.approach_id = any (coalesce(p_ids, '{}')));
  insert into public.professional_approaches (org_id, professional_id, approach_id, other_text)
  select p_org, p_id, x, case when x = v_other then nullif(pg_catalog.btrim(coalesce(p_other, '')), '') end
    from pg_catalog.unnest(coalesce(p_ids, '{}')) x
  on conflict (professional_id, approach_id) do update
    set other_text = excluded.other_text, updated_at = pg_catalog.now();
end;
$$;
revoke all on function private.apply_professional_approaches(uuid, uuid, uuid[], text)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The snapshot the questionnaire prefills from, and « Actuel » in the review
-- -----------------------------------------------------------------------------
-- Latest body: 20261008191219_professionals_onboarding.sql. Only the portrait changes.
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
      'years_experience', p.years_experience),
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

-- -----------------------------------------------------------------------------
-- Counting them (what Jonathan asked for): how many professionals hold each
-- -----------------------------------------------------------------------------
-- Active professionals only, every approach of the clinic, the most held first; `professionals.view`.
create function public.count_professional_approaches()
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
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', a.id, 'key', a.key, 'name', a.name, 'is_active', a.is_active,
             'professionals', (select pg_catalog.count(*)
                                 from public.professional_approaches pa
                                 join public.professionals p on p.org_id = pa.org_id and p.id = pa.professional_id
                                where pa.org_id = v_org and pa.approach_id = a.id and p.status = 'active'))
           order by a.sort_order, a.name)
      from public.approaches a where a.org_id = v_org), '[]'::jsonb);
end;
$$;
revoke all on function public.count_professional_approaches() from public, anon;
grant execute on function public.count_professional_approaches() to authenticated;

-- -----------------------------------------------------------------------------
-- Applying an approved submission: one more set
-- -----------------------------------------------------------------------------
-- Latest body: 20261011162525_professionals_core_helpers_wording.sql. Only the approaches branch
-- is new; everything else is that body unchanged.
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
  if v_fields && array['personal_phone', 'address_line1', 'address_line2', 'city', 'province', 'postal_code', 'years_experience'] then
    update public.professionals p
       set personal_phone = case when 'personal_phone' = any (v_fields) then v_values #>> '{personal,personal_phone}' else p.personal_phone end,
           address_line1 = case when 'address_line1' = any (v_fields) then v_values #>> '{personal,address_line1}' else p.address_line1 end,
           address_line2 = case when 'address_line2' = any (v_fields) then v_values #>> '{personal,address_line2}' else p.address_line2 end,
           city = case when 'city' = any (v_fields) then v_values #>> '{personal,city}' else p.city end,
           province = case when 'province' = any (v_fields) then coalesce(v_values #>> '{personal,province}', p.province) else p.province end,
           postal_code = case when 'postal_code' = any (v_fields) then v_values #>> '{personal,postal_code}' else p.postal_code end,
           years_experience = case when 'years_experience' = any (v_fields)
                                   then (v_values #>> '{professional,years_experience}')::smallint else p.years_experience end
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
  -- P4-510: the approaches she checked, and the text of « Autre — précisez ».
  if 'approach_ids' = any (v_fields) then
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
-- The catalogue the app reads (one RPC for every list)
-- -----------------------------------------------------------------------------
-- Latest body: 20261009000253_professionals_documents.sql. One more list; nothing else changes.
create or replace function public.get_professionals_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (
    -- The policies' predicate, evaluated once for the ten lists.
    select private.current_user_org_id() as org_id
     where private.can_read_professionals_reference()
  )
  select pg_catalog.jsonb_build_object(
    'orders', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.professional_orders x join me on x.org_id = me.org_id), '[]'::jsonb),
    'categories', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.profession_categories x join me on x.org_id = me.org_id), '[]'::jsonb),
    'titles', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.profession_titles x join me on x.org_id = me.org_id), '[]'::jsonb),
    'clienteles', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.clienteles x join me on x.org_id = me.org_id), '[]'::jsonb),
    'motif_categories', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.motif_categories x join me on x.org_id = me.org_id), '[]'::jsonb),
    'motifs', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.motifs x join me on x.org_id = me.org_id), '[]'::jsonb),
    'languages', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.languages x join me on x.org_id = me.org_id), '[]'::jsonb),
    'approaches', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.approaches x join me on x.org_id = me.org_id), '[]'::jsonb),
    'deactivation_reasons', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.deactivation_reasons x join me on x.org_id = me.org_id), '[]'::jsonb),
    'document_types', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - '{org_id,created_at,updated_at}'::text[] order by x.sort_order, x.name)
        from public.document_types x join me on x.org_id = me.org_id), '[]'::jsonb)
  )
$$;

select pg_catalog.set_config('app.audit_source', '', true);
