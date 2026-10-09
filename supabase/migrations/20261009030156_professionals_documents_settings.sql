-- =============================================================================
-- Professionnels: « Consentements » (draft and publish a consent version), the rejection email's
-- data, and « Documents requis »'s usage counts
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4c.3 (decisions P4-450 … P4-469)
-- Needs:   *_professionals_onboarding.sql (consent_versions, professional_consents,
--          private.current_consent_version), *_professionals_documents.sql (document_types,
--          professional_documents, reject_professional_document)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * « Consentements » (P4-452): one draft at most per consent key. save_consent_draft creates it
--   (the next version number) or rewrites it; publish_consent_version stamps it (published_at,
--   published_by): from then on, signing uses it (private.current_consent_version), and every
--   signature keeps the version it signed. discard_consent_draft deletes a draft: it was never
--   signed (signing only takes the published version; the foreign key of professional_consents
--   refuses it anyway) and the audit keeps it. A published version is never edited nor removed.
-- * get_consent_versions: the versions newest first, with who published them and how many
--   signatures each holds, for « Paramètres → Consentements » (professionals.manage or
--   professionals.settings, the section's readers).
-- * The rejection email (P4-451): professionals-documents calls reject_professional_document with
--   the caller's client, then get_professional_document_rejection_for_service (service role) with
--   the actor verifyAuth verified; it answers only for a document that actor has just refused in
--   their own clinic (status rejected, reviewed_by the actor), with the professional's first name
--   and address, the clinic's name, the type's name, the reason and whether the professional sent
--   the file (only then is she emailed). Nothing else.
-- * Usage counts (P4-453): list_professionals_reference_usage (same signature) adds
--   `document_types`: the professionals holding a document of that type that was not refused.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_documents_settings', true);

-- -----------------------------------------------------------------------------
-- « Consentements »
-- -----------------------------------------------------------------------------
-- The versions of a consent in the caller's clinic, newest first: {key, current_id, versions:
-- [{id, version, title, body, published_at, published_by_name, signed_count, created_at,
-- updated_at}]}; `current_id` is the version signing uses (null before the first publication).
create function public.get_consent_versions(p_key text default 'image_rights')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not (private.has_permission('professionals.settings') or private.has_permission('professionals.manage')) then
    raise exception 'Permission refusée : professionals.settings' using errcode = '42501';
  end if;
  if p_key is null or p_key not in ('image_rights') then
    raise exception 'Consentement inconnu : %', p_key using errcode = '22023';
  end if;
  return pg_catalog.jsonb_build_object(
    'key', p_key,
    'current_id', private.current_consent_version(v_org, p_key),
    'versions', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', c.id, 'version', c.version, 'title', c.title, 'body', c.body,
               'published_at', c.published_at, 'published_by_name', pb.display_name,
               'signed_count', coalesce(k.n, 0), 'created_at', c.created_at, 'updated_at', c.updated_at)
             order by c.version desc)
        from public.consent_versions c
        left join public.profiles pb on pb.user_id = c.published_by and pb.org_id = c.org_id
        left join (select x.consent_version_id, count(*)::int as n
                     from public.professional_consents x where x.org_id = v_org
                    group by x.consent_version_id) k on k.consent_version_id = c.id
       where c.org_id = v_org and c.key = p_key), '[]'::jsonb));
end;
$$;

-- The clinic's draft of p_key, locked (null when none). The caller holds the settings lock.
create function private.consent_draft_for_update(p_org uuid, p_key text)
returns public.consent_versions
language sql
set search_path = ''
as $$
  select c.* from public.consent_versions c
   where c.org_id = p_org and c.key = p_key and c.published_at is null
   order by c.version desc
   limit 1
     for update
$$;
revoke all on function private.consent_draft_for_update(uuid, text) from public, anon, authenticated, service_role;

-- « Enregistrer le brouillon » (professionals.settings): writes the title (1–200, tidy) and the text
-- (1–20 000 characters, not blank) of the clinic's draft of p_key, created as the next version when
-- there is none. Returns the draft's id.
create function public.save_consent_draft(p_key text, p_title text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_title text;
  v_body text := pg_catalog.btrim(coalesce(p_body, ''), E' \t\r\n');
  v_draft public.consent_versions;
  v_next int;
  v_id uuid;
begin
  if p_key is null or p_key not in ('image_rights') then
    raise exception 'Consentement inconnu : %', p_key using errcode = '22023';
  end if;
  begin
    v_title := private.reference_text(p_title, 'Le titre', 200, true, true);
  exception when sqlstate 'P0001' then
    raise exception '%', sqlerrm using errcode = 'P0001', hint = 'title';
  end;
  if v_body = '' then
    raise exception 'Le texte du consentement est obligatoire.' using errcode = 'P0001', hint = 'body';
  end if;
  if pg_catalog.char_length(v_body) > 20000 then
    raise exception 'Le texte du consentement ne peut pas dépasser 20 000 caractères.' using errcode = 'P0001', hint = 'body';
  end if;

  v_draft := private.consent_draft_for_update(v_org, p_key);
  if v_draft.id is not null then
    update public.consent_versions c
       set title = v_title, body = v_body
     where c.id = v_draft.id and c.org_id = v_org
       and (c.title is distinct from v_title or c.body is distinct from v_body);
    return v_draft.id;
  end if;

  select coalesce(max(c.version), 0) + 1 into v_next from public.consent_versions c where c.org_id = v_org and c.key = p_key;
  if v_next > 1000 then
    raise exception 'Ce consentement compte déjà 1000 versions.' using errcode = 'P0001';
  end if;
  insert into public.consent_versions (org_id, key, version, title, body)
  values (v_org, p_key, v_next, v_title, v_body)
  returning id into v_id;
  return v_id;
end;
$$;

-- « Publier » (professionals.settings): the draft becomes the version every new signature uses.
-- Signatures already given keep their version; a questionnaire signed with an older one asks to
-- sign again before it is sent (4b.1's completeness rule).
create function public.publish_consent_version(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_row public.consent_versions;
begin
  select * into v_row from public.consent_versions c where c.id = p_id and c.org_id = v_org for update;
  if not found then
    raise exception 'Version introuvable.' using errcode = 'P0001', hint = 'version';
  end if;
  if v_row.published_at is not null then
    raise exception 'Cette version est déjà publiée.' using errcode = 'P0001', hint = 'version';
  end if;
  update public.consent_versions c
     set published_at = pg_catalog.now(), published_by = auth.uid()
   where c.id = p_id and c.org_id = v_org;
end;
$$;

-- « Supprimer le brouillon » (professionals.settings): a draft only (never signed; the audit keeps it).
create function public.discard_consent_draft(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.lock_for_professionals_settings();
  v_row public.consent_versions;
begin
  select * into v_row from public.consent_versions c where c.id = p_id and c.org_id = v_org for update;
  if not found then
    raise exception 'Version introuvable.' using errcode = 'P0001', hint = 'version';
  end if;
  if v_row.published_at is not null then
    raise exception 'Une version publiée ne peut pas être supprimée.' using errcode = 'P0001', hint = 'version';
  end if;
  delete from public.consent_versions c where c.id = p_id and c.org_id = v_org;
end;
$$;

-- -----------------------------------------------------------------------------
-- The rejection email's data (service role; professionals-documents)
-- -----------------------------------------------------------------------------
-- What the email « Un document est à reprendre » needs, for a document p_actor (verified by the
-- function) has refused in their own clinic: {org_id, professional_id, document_id, profile_id,
-- email, first_name, clinic_name, type_name, reason, uploaded_by_professional}. Null for anything
-- else (another clinic, an unknown id, a document not refused, or refused by someone else). The
-- email goes only for a file the professional sent (uploaded_by_professional: « Mes documents » or
-- the questionnaire), as the template says; a file staff uploaded is theirs to replace (P4-451).
create function public.get_professional_document_rejection_for_service(p_actor uuid, p_doc_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'org_id', d.org_id, 'professional_id', p.id, 'document_id', d.id, 'profile_id', p.profile_id,
           'email', p.email, 'first_name', p.first_name, 'clinic_name', o.name, 'type_name', t.name,
           'reason', d.rejection_reason,
           'uploaded_by_professional', d.uploaded_by is not null and d.uploaded_by is not distinct from p.profile_id)
    from public.professional_documents d
    join public.profiles a on a.user_id = p_actor and a.org_id = d.org_id
    join public.professionals p on p.org_id = d.org_id and p.id = d.professional_id
    join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id
    join public.organizations o on o.id = d.org_id
   where d.id = p_doc_id and d.status = 'rejected' and d.reviewed_by = p_actor
$$;

-- -----------------------------------------------------------------------------
-- « Utilisé par »: *_professionals_core.sql's counts, plus document_types
-- -----------------------------------------------------------------------------
create or replace function public.list_professionals_reference_usage()
returns table (kind text, id uuid, usage int)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
begin
  if not (private.has_permission('professionals.settings') or private.has_permission('professionals.manage')) then
    raise exception 'Permission refusée : professionals.settings' using errcode = '42501';
  end if;
  return query
    select 'motifs'::text, x.motif_id, count(*)::int
      from public.professional_motifs x where x.org_id = v_org group by x.motif_id
    union all
    select 'clienteles', x.clientele_id, count(*)::int
      from public.professional_clienteles x where x.org_id = v_org group by x.clientele_id
    union all
    select 'languages', x.language_id, count(*)::int
      from public.professional_languages x where x.org_id = v_org group by x.language_id
    union all
    select 'profession_titles', x.profession_title_id, count(*)::int
      from public.professional_professions x where x.org_id = v_org group by x.profession_title_id
    union all
    -- Professionals currently inactive for this reason.
    select 'deactivation_reasons', x.deactivation_reason_id, count(*)::int
      from public.professionals x where x.org_id = v_org and x.status = 'inactive' group by x.deactivation_reason_id
    union all
    -- Parents: their active children.
    select 'profession_categories', x.category_id, count(*)::int
      from public.profession_titles x where x.org_id = v_org and x.is_active group by x.category_id
    union all
    select 'professional_orders', x.order_id, count(*)::int
      from public.profession_titles x where x.org_id = v_org and x.is_active and x.order_id is not null group by x.order_id
    union all
    select 'motif_categories', x.category_id, count(*)::int
      from public.motifs x where x.org_id = v_org and x.is_active and x.category_id is not null group by x.category_id
    union all
    -- Professionals holding a document of the type that was not refused (P4-453).
    select 'document_types', x.document_type_id, count(distinct x.professional_id)::int
      from public.professional_documents x where x.org_id = v_org and x.status <> 'rejected' group by x.document_type_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges: the user RPCs for authenticated, the notice's data for the service role
-- -----------------------------------------------------------------------------
revoke all on function
  public.get_consent_versions(text),
  public.save_consent_draft(text, text, text),
  public.publish_consent_version(uuid),
  public.discard_consent_draft(uuid),
  public.get_professional_document_rejection_for_service(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.get_consent_versions(text),
  public.save_consent_draft(text, text, text),
  public.publish_consent_version(uuid),
  public.discard_consent_draft(uuid)
to authenticated;
grant execute on function public.get_professional_document_rejection_for_service(uuid, uuid) to service_role;

select pg_catalog.set_config('app.audit_source', '', true);
