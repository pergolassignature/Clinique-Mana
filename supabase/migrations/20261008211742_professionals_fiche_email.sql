-- =============================================================================
-- Professionnels: the fiche PDF, by email (« Fiche PDF » → « Envoyer par courriel »)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4c.5 (pulled forward; P4-58,
--          P4-200–P4-209). The download and the stamp are *_professionals_fiche.sql.
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The email goes out with the very file the person saw (P4-58): the browser renders it, uploads
--   it through the storage pipeline (purpose professional_fiche: PDF only, ≤ 10 MB, read with
--   professionals.view, staged 1 day and never attached, so storage-cleanup purges it the next
--   day: no copy is kept, P4-19), then the function professionals-fiche asks
--   get_professional_fiche_upload, with the caller's own client, whether that upload may go out:
--   the professional is of the caller's clinic and active, and the file is the caller's own ready
--   upload of that purpose, for that professional, still staged. A file's subject is the
--   uploader's claim (core_storage); here it is only ever compared with the same caller's
--   professional id, so it lets no one send what they could not already read.
-- * Template professionals.fiche (P4-50, P3-18): free recipient, attachments allowed, log rows
--   read with professionals.view (subject `professional`, so 4b's « Courriels » lists them).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:professionals_fiche_email', true);

-- -----------------------------------------------------------------------------
-- The emailed file
-- -----------------------------------------------------------------------------
insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values
  ('professional_fiche', 'professionals', 'documents', 'professionals.view', 'professionals.view', null, 10485760,
   array['application/pdf'], null, 1)
on conflict do nothing;

-- Whether the caller may email upload p_file_id as the fiche of professional p_id (see the header),
-- with what the function needs to send it. Refusals are French P0001, in this order: the
-- professional (« introuvable », then « actifs »), then the file (« Fichier introuvable. » for any
-- mismatch: another purpose, uploader, professional or clinic, not ready, or past its staging).
create function public.get_professional_fiche_upload(p_id uuid, p_file_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pro public.professionals%rowtype;
  v_file public.stored_files%rowtype;
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  select * into v_pro from public.professionals p where p.id = p_id and p.org_id = v_org;
  if not found then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  if v_pro.status <> 'active' then
    raise exception 'Seuls les professionnels actifs peuvent être proposés.' using errcode = 'P0001';
  end if;
  select * into v_file from public.stored_files f
   where f.id = p_file_id
     and f.org_id = v_org
     and f.purpose = 'professional_fiche'
     and f.status = 'ready'
     and f.uploaded_by = auth.uid()
     and f.subject_type = 'professional'
     and f.subject_id = p_id
     and f.retain_until > pg_catalog.now();
  if not found then
    raise exception 'Fichier introuvable.' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'first_name', v_pro.first_name,
    'last_name', v_pro.last_name,
    'bucket', v_file.bucket,
    'object_path', v_file.object_path,
    'size_bytes', v_file.size_bytes);
end;
$$;
revoke all on function public.get_professional_fiche_upload(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_professional_fiche_upload(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Email template
-- -----------------------------------------------------------------------------
-- {{message}} sits on the greeting's line break, not in a paragraph of its own: without a message
-- the break ends the paragraph and no empty paragraph is left.
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission,
   recipient_mode, allows_attachments)
values (
  'professionals.fiche', 'professionals',
  'Fiche d''un professionnel',
  'Envoyé quand un membre de l''équipe transmet la fiche d''un professionnel à un client, la fiche en pièce jointe.',
  'Vous recevez ce courriel parce que la clinique vous transmet la fiche d''un professionnel.',
  'Fiche de {{professional.name}}',
  E'Bonjour,\n'
  '{{message}}\n\n'
  'Voici la fiche de {{professional.name}}, en pièce jointe. Vous y trouverez sa présentation, ses langues, sa clientèle '
  'et les motifs de consultation pour lesquels vous pouvez faire appel à ses services.\n\n'
  'Pour toute question, ou pour prendre rendez-vous, répondez simplement à ce courriel.',
  null,
  '[
    {"path": "professional.name", "label": "Nom du professionnel", "sample": "Geneviève Tremblay", "required": true, "kind": "text"},
    {"path": "message", "label": "Message de la personne qui envoie", "sample": "Comme convenu lors de notre appel, voici la professionnelle que je vous propose.", "required": false, "kind": "text"}
  ]',
  'professionals.view',
  'free', true
)
on conflict do nothing;
