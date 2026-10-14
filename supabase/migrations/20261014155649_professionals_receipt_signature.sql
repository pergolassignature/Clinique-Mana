-- =============================================================================
-- Professionnels: the professional's signature image, for her receipts (R-86)
-- =============================================================================
-- Decision: R-86 (Christine, answer 22 of the second series: insurance receipts carry the
-- professional's signature, uploaded to her profile; the images exist in GOrendezvous).
--
-- * `professionals.signature_file_id`: the image (a stored file of purpose
--   `professional_signature`, PNG or JPEG, 2 Mo — the PDF renderer's asset cap —, ≤ 2000 px).
--   Uploaded and read with `professionals.manage` (a signature image is sensitive: the staff who
--   manage the file only); the professional does not upload it herself in « Mon profil »
--   (read-only there; the clinic carries the GOrendezvous images over) — default, révisable.
-- * `set_professional_signature(professional, file)` (professionals.manage): attaches a ready,
--   staged file of the purpose to the professional (`private.attach_stored_file`), never another
--   professional's signature; null removes it (« Retirer »); the previous file is soft-deleted.
-- * Published for Facturation (granted to no role; definer callers after their own check):
--   `private.professional_signature_files(org, ids[])`: each professional's ready signature with
--   the bucket and path the receipt's renderer downloads. An intern's receipt prints her own
--   signature (R-60 prints her supervisor's name and licence beside it).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_receipt_signature', true);

alter table public.professionals
  add column signature_file_id uuid references public.stored_files (id) on delete set null;
create index professionals_signature_file_idx on public.professionals (signature_file_id);

insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values
  ('professional_signature', 'professionals', 'documents', 'professionals.manage', 'professionals.manage', null, 2097152,
   array['image/png', 'image/jpeg'], 2000, 1)
on conflict do nothing;

-- Sets (or, with a null file, removes) a professional's signature image. professionals.manage.
create function public.set_professional_signature(p_professional_id uuid, p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_old uuid;
begin
  if not private.has_permission('professionals.manage') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  select p.signature_file_id into v_old from public.professionals p
   where p.org_id = v_org and p.id = p_professional_id
     for update;
  if not found then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001', hint = 'professional_id';
  end if;
  if p_file_id is not distinct from v_old then
    return;
  end if;
  if p_file_id is not null then
    if exists (select 1 from public.professionals p where p.org_id = v_org and p.signature_file_id = p_file_id) then
      raise exception 'Fichier introuvable.' using errcode = 'P0001';
    end if;
    perform private.attach_stored_file(p_file_id, array['professional_signature'], 'professional', p_professional_id,
                                       'professionals.manage', null, null);
  end if;
  update public.professionals p set signature_file_id = p_file_id
   where p.org_id = v_org and p.id = p_professional_id;
  if v_old is not null then
    perform private.soft_delete_stored_file(v_old, auth.uid());
  end if;
end;
$$;
revoke all on function public.set_professional_signature(uuid, uuid) from public, anon;
grant execute on function public.set_professional_signature(uuid, uuid) to authenticated;

-- Each professional's ready signature image (none: no row), for a receipt's renderer.
create function private.professional_signature_files(p_org uuid, p_ids uuid[])
returns table (professional_id uuid, file_id uuid, bucket text, object_path text)
language sql
stable
set search_path = ''
as $$
  select p.id, f.id, f.bucket, f.object_path
    from public.professionals p
    join public.stored_files f on f.id = p.signature_file_id and f.org_id = p.org_id and f.status = 'ready'
   where p.org_id = p_org and p.id = any (coalesce(p_ids, '{}'))
$$;
revoke all on function private.professional_signature_files(uuid, uuid[]) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
