-- =============================================================================
-- Professionnels: the clinic rewords the questionnaire's steps itself (P4-562)
-- =============================================================================
-- Jonathan, « Suivi - application » of 22 October 2026, his question: « Si je veux changer les
-- consignes qui sont écrites dans les sections, est-ce que je peux le faire facilement ou je dois
-- te contacter pour le faire ? », pointing at « Les langues dans lesquelles vous pouvez offrir vos
-- rencontres. » on « Étape 4 sur 12 ». Until now the answer was « you must ask us »: every step's
-- title and description is a key of `fr-CA.json`, so rewording one meant a deploy.
-- Needs:   *_professionals_reference_data.sql (the permissions and
--          `private.can_read_professionals_reference`), *_professionals_onboarding.sql
--          (`private.submission_sections`).
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6.
--
-- Key choices
-- * **An override, never a copy.** A row holds only what the clinic rewrote; the app's own text
--   stays the default and keeps being translated and improved. Clearing a field (null, or blank)
--   gives the app's text back, so « Réinitialiser » needs no second concept.
-- * **Title and description**, for the eleven sections and « Révision » — Jonathan pointed at a
--   description, but a clinic that rewords « Portrait » will want its heading too.
-- * **Read by everyone who reads the module's lists** (`can_read_professionals_reference`, which
--   `professionals.self` holds): the professional filling her questionnaire must see them, and she
--   holds nothing else. Written with `professionals.settings`, like the lists themselves.
-- * Plain text only, no markup: these are one heading and one sentence, printed as they are.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_questionnaire_texts', true);

create table public.questionnaire_section_texts (
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- A section of `private.submission_sections()`, or `review` (« Révision et envoi »). Checked by
  -- the writer rather than by a constraint, so adding a section later cannot strand a row.
  section text not null,
  -- null (or blank, which the writer stores as null): the app's own text.
  title text,
  description text,
  updated_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questionnaire_section_texts_pkey primary key (org_id, section),
  constraint questionnaire_section_texts_section_check check (section ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint questionnaire_section_texts_title_check check (
    title is null or (pg_catalog.char_length(title) between 1 and 80 and private.is_tidy_text(title))),
  constraint questionnaire_section_texts_description_check check (
    description is null or (pg_catalog.char_length(description) between 1 and 300 and private.is_tidy_text(description))),
  -- A row that overrides nothing is deleted instead.
  constraint questionnaire_section_texts_something_check check (title is not null or description is not null)
);
create index questionnaire_section_texts_updated_by_idx on public.questionnaire_section_texts (updated_by);

create trigger questionnaire_section_texts_set_updated_at before update on public.questionnaire_section_texts
  for each row execute function private.set_updated_at();
create trigger questionnaire_section_texts_audit after insert or update or delete on public.questionnaire_section_texts
  for each row execute function private.audit_trigger();

alter table public.questionnaire_section_texts enable row level security;
revoke all on public.questionnaire_section_texts from anon, authenticated;
grant select on public.questionnaire_section_texts to authenticated;
-- The professional filling her questionnaire reads these, and she holds `professionals.self` only.
create policy questionnaire_section_texts_select on public.questionnaire_section_texts
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.can_read_professionals_reference()));

-- -----------------------------------------------------------------------------
-- Rewording a step (Paramètres → Professionnels)
-- -----------------------------------------------------------------------------
-- Stores what the clinic rewrote for one step. A blank title or description is stored as null
-- (the app's own text comes back); both blank deletes the row. Returns the row as it now stands,
-- or null once nothing is overridden.
-- Refusals (P0001, French, HINT): `section`.
create function public.set_questionnaire_section_text(p_section text, p_title text, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_title text := nullif(pg_catalog.btrim(coalesce(p_title, '')), '');
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
  v_row public.questionnaire_section_texts%rowtype;
begin
  if v_org is null or not private.has_permission('professionals.settings') then
    raise exception 'Permission refusée : professionals.settings' using errcode = '42501';
  end if;
  if p_section is null or not (p_section = any (private.submission_sections() || array['review'])) then
    raise exception 'Cette étape du questionnaire n''existe pas.' using errcode = 'P0001', hint = 'section';
  end if;
  if v_title is null and v_description is null then
    delete from public.questionnaire_section_texts x where x.org_id = v_org and x.section = p_section;
    return null;
  end if;
  insert into public.questionnaire_section_texts (org_id, section, title, description, updated_by)
  values (v_org, p_section, v_title, v_description, auth.uid())
  on conflict (org_id, section) do update
    set title = excluded.title, description = excluded.description, updated_by = excluded.updated_by
  returning * into v_row;
  return pg_catalog.jsonb_build_object(
    'section', v_row.section, 'title', v_row.title, 'description', v_row.description,
    'updated_at', v_row.updated_at);
end;
$$;
revoke all on function public.set_questionnaire_section_text(text, text, text) from public, anon;
grant execute on function public.set_questionnaire_section_text(text, text, text) to authenticated;

-- What the clinic reworded, for the questionnaire and for the settings screen. Everyone who reads
-- the module's lists reads it — `professionals.self` included, since the professional filling her
-- questionnaire needs the text and holds nothing else. `{ "<section>": {title, description} }`.
create function public.get_questionnaire_section_texts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if v_org is null or not private.can_read_professionals_reference() then
    raise exception 'Permission refusée : professionals' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_object_agg(x.section, pg_catalog.jsonb_build_object(
             'title', x.title, 'description', x.description))
      from public.questionnaire_section_texts x where x.org_id = v_org), '{}'::jsonb);
end;
$$;
revoke all on function public.get_questionnaire_section_texts() from public, anon;
grant execute on function public.get_questionnaire_section_texts() to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
