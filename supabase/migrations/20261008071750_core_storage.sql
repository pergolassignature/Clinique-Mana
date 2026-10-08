-- =============================================================================
-- Storage: private buckets, file registry (no client policy on objects), org logo and signature
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §7
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.24 (P3-14, P3-17, P3-20,
--          P3-30, inconsistencies #8 and #12)
-- Needs:   docs/plans/2026-10-08-professionals-module-plan.md, 4b.4 and 4c.2 (purposes with an
--          owner_permission and retain_days, attach_stored_file, soft_delete_stored_file)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Three private buckets. Clients never write an object: uploads go through a signed upload URL
--   that `storage-upload` creates for the path `create_pending_upload` returns, and system files
--   (rendered and signed PDFs) are written by the service role. There is no client policy at
--   all on `storage.objects` for these buckets (P3-33): no client can read an object or mint a
--   signed URL (`createSignedUrl`) itself. Reads go through the `storage-sign` function, which
--   selects the `stored_files` row with the user's client (so this table's RLS decides), then
--   signs a 5-minute URL with the service role.
-- * MIME type → extension is one fixed map, `private.mime_extension`, the SQL twin of FORMATS in
--   supabase/functions/_shared/storage.ts (exact strings, no alias). `_shared/storage-map.test.ts`
--   reads this function from the migrations and checks it against the TypeScript map.
-- * Paths are `{org_id}/{module_key}/{subject_id}/{file_id}.{ext}` (P3-20): canonical lower-case
--   uuids, the extension from the MIME type, never a file name (Loi 25). The database builds them
--   and stays their source of truth; a check pins the shape. A path never moves: attaching a
--   staged file re-points the row's subject, so the third segment is the subject at upload time.
-- * `stored_files` is the registry. Each row carries what it takes to read it: `view_permission`
--   (null = any active member of the org, allowed for core purposes only), or the owner branch
--   (`owner_profile_id` = the caller and `owner_permission` held, inconsistency #12: ownership is
--   in the row, never in a storage policy). The `stored_files` select policy applies this rule
--   to `ready` rows, and is the only read check: `storage-sign` relies on it (P3-33).
-- * The module gate: a module's file is uploaded and read only through permissions of that
--   module, so disabling the module (its permissions drop out of current_permission_keys) closes
--   every path to it. A module purpose's upload, view and owner permissions all belong to its
--   module (check_upload_purpose); a module file's view and owner permissions too (trigger
--   stored_files_check_module_gate, whoever writes the row: create_pending_upload,
--   register_system_file, attach_stored_file); and a module file always has a view permission.
--   Core purposes may name any permission.
-- * `subject_type` / `subject_id` of a row no module RPC has attached are what the uploader sent
--   to create_pending_upload: client-supplied and untrusted. They only build the path and group
--   staged files; no rule reads them for access. A module trusts a file's subject only after its
--   own RPC attached it (attach_stored_file sets both). Modules list their files through their
--   own tables (e.g. professional_documents.stored_file_id), never by stored_files.subject_id.
-- * Purposes are a global catalogue seeded by the owning module (like `scheduled_jobs`: not
--   audited, git is its history). A trigger keeps `max_bytes` and `mime_types` within the
--   bucket's limits (storage.buckets is the one source of those). `max_image_side` caps the width
--   and height of an image (from its header) and is enforced by `storage-confirm`; the logo and
--   signature use 4000 px (a small PNG with alpha can decode to hundreds of MB in the PDF
--   renderer, which refuses more). The logo and signature accept PNG and JPEG only: pdfmake cannot
--   embed WebP. `application/msword` is for the purposes that truly need legacy Word files only
--   (its sniffing accepts any OLE compound file).
-- * Staged uploads (P3-17): a purpose with `retain_days` stamps `retain_until`; a module RPC
--   attaching the file (`private.attach_stored_file`, or `set_org_asset` for the org assets)
--   clears it. The logo and signature are staged for one day, so an upload never set as the asset
--   is purged too. So every client-upload purpose that a module RPC must attach needs a
--   `retain_days`: without one, an upload never attached stays forever.
--   `attach_stored_file` takes the purposes the calling RPC accepts (and optionally the expected
--   uploader) and checks them itself, so a client-supplied file id of another purpose (or
--   someone else's upload) is « Fichier introuvable. » like a file of another org.
-- * Purge rules (`list_files_to_purge`): `pending` older than 24 h, `deleted` for over 30 days,
--   `deleted` but never confirmed (a rejected upload, a pending file removed) for over 24 h,
--   `ready` past its `retain_until`. The never-confirmed case is short because the 2-hour signed
--   upload token can upload to a rejected path again: its object must not linger 30 days. A listed file is never revived: `confirm_stored_file` refuses
--   a pending file older than 24 h, and `attach_stored_file` / `set_org_asset` refuse a file past
--   its `retain_until`. So `storage-cleanup` can remove the objects first, then mark the rows
--   `purged` (`mark_files_purged` re-checks the same rules). Purged rows are kept (P3-30).
--   The remove-then-mark race is benign: if the function dies between the two, the row keeps its
--   status with no object, is listed again at the next run (removing a missing object is a
--   no-op) and marked then; a row whose status changed in between (a staged file soft-deleted)
--   is not marked now and comes back under its new rule. No rule makes a listed row readable
--   again, so a removed object is never one a reader can still reach through a `ready` row.
-- * `register_system_file` registers the row `ready` before the object exists (the caller
--   uploads to the returned path next): until the upload lands, a reader allowed by the row gets
--   Storage's 404, never another file. A caller whose upload fails soft-deletes the row (its
--   module's service RPC, through `private.soft_delete_stored_file`), and a retry registers a new
--   one. Its view permission is `coalesce(p_view_permission, the purpose's)`; a null result (any
--   member of the org) is refused in the `documents` and `signed-documents` buckets.
-- * Audited, with `original_name` redacted: a file name often carries a person's name, and the
--   audit log is kept forever.
-- * Deviations from the plan:
--   - `list_files_to_purge(p_org_id, p_limit)` and `mark_files_purged(p_org_id, p_ids)` work per
--     org, so `storage-cleanup` runs like every function job (`runJob`, one org at a time;
--     `start_job_run` needs an org) and « Exécuter maintenant » cleans the caller's clinic only.
--     The plan had them database-wide, with a run logged under a null org that `start_job_run`
--     does not support.
--   - One partial index, `(org_id, created_at)` over the purge candidates, replaces the plan's
--     `(status, created_at)` and `(retain_until)` indexes: the rows it holds are exactly the ones
--     the purge reads, in its order.
--   - `upload_purposes.max_image_side` (returned by `get_pending_upload`) carries the 4000 px cap
--     to `storage-confirm` per purpose; a module's photo purpose can choose its own.
--   - `org_logo` / `org_signature` accept PNG and JPEG only (Task 3.30 note), with
--     `retain_days = 1`.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_storage', true);

-- -----------------------------------------------------------------------------
-- Buckets (all private)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('org-assets',       'org-assets',       false,  2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('documents',        'documents',        false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
                                                                 'application/msword',
                                                                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('signed-documents', 'signed-documents', false, 20971520, array['application/pdf'])
-- A bucket made by hand before this migration (same id) is brought to these settings: never left
-- public, nor with other limits.
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The object extension of an accepted MIME type, null for any other value. Must equal FORMATS in
-- supabase/functions/_shared/storage.ts (_shared/storage-map.test.ts checks it).
create function private.mime_extension(p_mime_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mime_type
    when 'application/pdf' then 'pdf'
    when 'image/png' then 'png'
    when 'image/jpeg' then 'jpg'
    when 'image/webp' then 'webp'
    when 'application/msword' then 'doc'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
  end
$$;
revoke all on function private.mime_extension(text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Upload purposes (global catalogue, seeded by the owning module)
-- -----------------------------------------------------------------------------
create table public.upload_purposes (
  key text primary key check (key ~ '^[a-z_]{1,50}$'),
  module_key text not null references public.modules(key),
  bucket text not null check (bucket in ('org-assets', 'documents', 'signed-documents')),
  -- Checked by create_pending_upload; a permission of module_key (the module gate).
  upload_permission text not null references public.permissions(key),
  -- Copied to each file. Null = any active member of the org (core purposes only, see below).
  view_permission text references public.permissions(key),
  -- When set, the uploader becomes the file's owner and reads it while holding this permission.
  owner_permission text references public.permissions(key),
  max_bytes int not null check (max_bytes > 0),
  mime_types text[] not null check (pg_catalog.cardinality(mime_types) > 0),
  -- Width and height cap in pixels for images, read from the header by storage-confirm.
  max_image_side int check (max_image_side > 0),
  -- Staged uploads (P3-17): retain_until = upload time + retain_days, until attached.
  retain_days int check (retain_days between 1 and 365),
  created_at timestamptz not null default now(),
  -- Target of the stored_files composite key (a file's module and bucket are its purpose's).
  unique (key, module_key, bucket),
  -- The module gate: a module's files are read through one of its permissions.
  check (view_permission is not null or module_key = 'core')
);
create index upload_purposes_module_key_idx on public.upload_purposes (module_key);
create index upload_purposes_upload_permission_idx on public.upload_purposes (upload_permission);
create index upload_purposes_view_permission_idx on public.upload_purposes (view_permission);
create index upload_purposes_owner_permission_idx on public.upload_purposes (owner_permission);

alter table public.upload_purposes enable row level security;
revoke all on public.upload_purposes from anon, authenticated;
grant select on public.upload_purposes to authenticated;
create policy upload_purposes_select on public.upload_purposes
  for select to authenticated using (true);

-- The module gate's test: true when p_key is null or a permission of module p_module.
create function private.permission_in_module(p_key text, p_module text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_key is null
      or exists (select 1 from public.permissions pm where pm.key = p_key and pm.module_key = p_module)
$$;
revoke all on function private.permission_in_module(text, text) from public, anon, authenticated, service_role;

-- A purpose stays within its bucket's limits (storage.buckets is their one source), and a module
-- purpose names permissions of its module only (the module gate).
create function private.check_upload_purpose()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from storage.buckets b
                  where b.id = new.bucket
                    and new.max_bytes <= b.file_size_limit
                    and new.mime_types <@ b.allowed_mime_types) then
    raise exception 'Upload purpose % exceeds the limits of bucket %', new.key, new.bucket using errcode = '23514';
  end if;
  if new.module_key <> 'core'
     and not (private.permission_in_module(new.upload_permission, new.module_key)
              and private.permission_in_module(new.view_permission, new.module_key)
              and private.permission_in_module(new.owner_permission, new.module_key)) then
    raise exception 'Upload purpose % names a permission outside module %', new.key, new.module_key
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.check_upload_purpose() from public, anon, authenticated, service_role;

create trigger upload_purposes_check_bucket
  before insert or update on public.upload_purposes
  for each row execute function private.check_upload_purpose();

-- -----------------------------------------------------------------------------
-- File registry
-- -----------------------------------------------------------------------------
create table public.stored_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  bucket text not null,
  object_path text not null unique,
  module_key text not null,
  purpose text not null,
  -- The record the file belongs to (`organization`, `professional`, a submission…).
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  subject_id uuid not null,
  owner_profile_id uuid,
  owner_permission text references public.permissions(key),
  view_permission text references public.permissions(key),
  -- Shown and offered as the download name; never part of a path or URL. No slash, backslash,
  -- control character or bidirectional control (U+200E-U+200F, U+202A-U+202E, U+2066-U+2069:
  -- they can disguise a file's extension).
  original_name text not null check (
    pg_catalog.length(original_name) between 1 and 200
    and pg_catalog.btrim(original_name) <> ''
    and original_name !~ '[/\\[:cntrl:]\u200e\u200f\u202a-\u202e\u2066-\u2069]'),
  mime_type text not null,
  ext text not null check (ext ~ '^[a-z0-9]{1,5}$'),
  size_bytes int not null check (size_bytes > 0),
  -- 64 lower-case hex characters (_shared/storage.ts sha256Hex / inspectStream).
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'ready', 'deleted', 'purged')),
  retain_until timestamptz,
  uploaded_by uuid references public.profiles(user_id) on delete set null,
  deleted_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  deleted_at timestamptz,
  foreign key (purpose, module_key, bucket) references public.upload_purposes (key, module_key, bucket),
  -- The owner is a member of the file's org.
  foreign key (owner_profile_id, org_id) references public.profiles (user_id, org_id) on delete set null (owner_profile_id),
  -- {org_id}/{module_key}/{subject uuid at upload}/{file_id}.{ext}: no file name in a path.
  check (object_path = org_id::text || '/' || module_key || '/' || pg_catalog.split_part(object_path, '/', 3)
                       || '/' || id::text || '.' || ext
         and pg_catalog.split_part(object_path, '/', 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  check (view_permission is not null or module_key = 'core'),
  check (status <> 'ready' or (sha256 is not null and confirmed_at is not null)),
  check (status <> 'deleted' or deleted_at is not null)
);
-- A subject's files; also the org FK and the RLS org predicate.
create index stored_files_subject_idx on public.stored_files (org_id, module_key, subject_type, subject_id);
-- The purge candidates of an org, oldest first (list_files_to_purge, mark_files_purged).
create index stored_files_purge_idx on public.stored_files (org_id, created_at)
  where status in ('pending', 'deleted') or (status = 'ready' and retain_until is not null);
create index stored_files_purpose_idx on public.stored_files (purpose, module_key, bucket);
create index stored_files_owner_profile_id_idx on public.stored_files (owner_profile_id) where owner_profile_id is not null;
create index stored_files_owner_permission_idx on public.stored_files (owner_permission) where owner_permission is not null;
create index stored_files_view_permission_idx on public.stored_files (view_permission) where view_permission is not null;
create index stored_files_uploaded_by_idx on public.stored_files (uploaded_by) where uploaded_by is not null;
create index stored_files_deleted_by_idx on public.stored_files (deleted_by) where deleted_by is not null;

alter table public.stored_files enable row level security;
revoke all on public.stored_files from anon, authenticated;
grant select on public.stored_files to authenticated;
-- No client write: rows are written by the RPCs below.
create policy stored_files_select on public.stored_files
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and status = 'ready'
    and (view_permission is null
         or view_permission = any ((select private.current_permission_keys())::text[])
         or (owner_profile_id = (select auth.uid())
             and owner_permission = any ((select private.current_permission_keys())::text[])))
  );

-- The module gate on the row, whoever writes it: a module file's view and owner permissions are
-- permissions of its module (the not-null view permission is the table check above).
create function private.check_stored_file_module_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.module_key <> 'core'
     and not (private.permission_in_module(new.view_permission, new.module_key)
              and private.permission_in_module(new.owner_permission, new.module_key)) then
    raise exception 'A % file can only name permissions of its module', new.module_key using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.check_stored_file_module_gate() from public, anon, authenticated, service_role;

create trigger stored_files_check_module_gate
  before insert or update of module_key, view_permission, owner_permission on public.stored_files
  for each row execute function private.check_stored_file_module_gate();
create trigger stored_files_set_updated_at
  before update on public.stored_files
  for each row execute function private.set_updated_at();
create trigger stored_files_audit
  after insert or update or delete on public.stored_files
  for each row execute function private.audit_trigger('original_name');

-- -----------------------------------------------------------------------------
-- Organization assets and signatory email (Phase 2 deferrals)
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column logo_file_id uuid references public.stored_files(id) on delete set null,
  add column signature_file_id uuid references public.stored_files(id) on delete set null,
  add column signatory_email text,
  add constraint organizations_signatory_email_check check (signatory_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
create index organizations_logo_file_id_idx on public.organizations (logo_file_id) where logo_file_id is not null;
create index organizations_signature_file_id_idx on public.organizations (signature_file_id) where signature_file_id is not null;
-- Written with settings.manage through organizations_update, like the other signatory columns.
-- The asset columns change only through set_org_asset.
grant update (signatory_email) on public.organizations to authenticated;

-- -----------------------------------------------------------------------------
-- Uploads (storage-upload / storage-confirm, Task 3.26)
-- -----------------------------------------------------------------------------
-- The core permission check of an upload: the purpose's upload_permission, its size and types.
-- Inserts a `pending` row and returns where storage-upload signs the upload. The extension comes
-- from the MIME type, never from the name. The subject is the client's, untrusted (header).
create function public.create_pending_upload(
  p_purpose text,
  p_subject_type text,
  p_subject_id uuid,
  p_original_name text,
  p_mime_type text,
  p_size_bytes int
)
returns table (file_id uuid, bucket text, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_purpose public.upload_purposes%rowtype;
  v_id uuid := pg_catalog.gen_random_uuid();
  v_ext text;
  v_path text;
begin
  select * into v_purpose from public.upload_purposes u where u.key = p_purpose;
  if not found then
    raise exception 'Usage de fichier inconnu : %', p_purpose using errcode = '22023';
  end if;
  if not private.has_permission(v_purpose.upload_permission) then
    raise exception 'Permission refusée : %', v_purpose.upload_permission using errcode = '42501';
  end if;
  if p_subject_type is null or p_subject_id is null or p_original_name is null
     or p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'Invalid subject, name or size' using errcode = '22023';
  end if;
  if p_size_bytes > v_purpose.max_bytes then
    raise exception 'Ce fichier dépasse la taille permise (% Mo).',
      pg_catalog.replace(pg_catalog.trim_scale(pg_catalog.round(v_purpose.max_bytes / 1048576.0, 1))::text, '.', ',')
      using errcode = 'P0001';
  end if;
  if p_mime_type is null or not (p_mime_type = any (v_purpose.mime_types)) then
    raise exception 'Ce type de fichier n''est pas accepté.' using errcode = 'P0001';
  end if;

  v_ext := private.mime_extension(p_mime_type);
  v_path := v_org::text || '/' || v_purpose.module_key || '/' || p_subject_id::text || '/' || v_id::text || '.' || v_ext;
  insert into public.stored_files (
    id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
    owner_profile_id, owner_permission, view_permission, original_name, mime_type, ext, size_bytes,
    retain_until, uploaded_by)
  values (
    v_id, v_org, v_purpose.bucket, v_path, v_purpose.module_key, v_purpose.key, p_subject_type, p_subject_id,
    case when v_purpose.owner_permission is not null then auth.uid() end, v_purpose.owner_permission,
    v_purpose.view_permission, p_original_name, p_mime_type, v_ext, p_size_bytes,
    pg_catalog.now() + pg_catalog.make_interval(days => v_purpose.retain_days), auth.uid());

  return query select v_id, v_purpose.bucket, v_path;
end;
$$;

-- The caller's own pending upload (less than 24 h old, upload permission still held), with the
-- purpose's caps for storage-confirm; no row otherwise.
create function public.get_pending_upload(p_file_id uuid)
returns table (bucket text, object_path text, mime_type text, size_bytes int, max_bytes int, max_image_side int)
language sql
stable
security definer
set search_path = ''
as $$
  select f.bucket, f.object_path, f.mime_type, f.size_bytes, u.max_bytes, u.max_image_side
    from public.stored_files f
    join public.upload_purposes u on u.key = f.purpose
   where f.id = p_file_id
     and f.status = 'pending'
     and f.uploaded_by = auth.uid()
     and f.org_id = private.current_user_org_id()
     and f.created_at > pg_catalog.now() - interval '24 hours'
     and private.has_permission(u.upload_permission)
$$;

revoke all on function
  public.create_pending_upload(text, text, uuid, text, text, int),
  public.get_pending_upload(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.create_pending_upload(text, text, uuid, text, text, int),
  public.get_pending_upload(uuid)
to authenticated;

-- Service role (storage-confirm): the content matched; records the hash and real size.
create function public.confirm_stored_file(p_file_id uuid, p_sha256 text, p_size_bytes int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'Invalid hash or size' using errcode = '22023';
  end if;
  update public.stored_files f
     set status = 'ready', sha256 = p_sha256, size_bytes = p_size_bytes, confirmed_at = pg_catalog.now()
    from public.upload_purposes u
   where f.id = p_file_id
     and u.key = f.purpose
     and f.status = 'pending'
     and f.created_at > pg_catalog.now() - interval '24 hours'
     and p_size_bytes <= u.max_bytes;
  if not found then
    raise exception 'Unknown, expired or not pending file, or over the size limit' using errcode = '22023';
  end if;
end;
$$;

-- Service role (storage-confirm): the content did not match; the object is already removed.
create function public.reject_stored_file(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.stored_files f
     set status = 'deleted', deleted_at = pg_catalog.now()
   where f.id = p_file_id and f.status = 'pending';
  if not found then
    raise exception 'Unknown or not pending file' using errcode = '22023';
  end if;
end;
$$;

-- Service role: a file the function writes itself (unsigned and signed PDFs), registered `ready`;
-- the caller then uploads to the returned path, and soft-deletes the row if that upload fails
-- (header). Bucket and module must be the purpose's. The view permission is the caller's, else
-- the purpose's; none at all (any member of the org) only in org-assets.
create function public.register_system_file(
  p_org_id uuid,
  p_bucket text,
  p_module_key text,
  p_purpose text,
  p_subject_type text,
  p_subject_id uuid,
  p_mime_type text,
  p_size_bytes int,
  p_sha256 text,
  p_view_permission text,
  p_original_name text
)
returns table (file_id uuid, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_purpose public.upload_purposes%rowtype;
  v_id uuid := pg_catalog.gen_random_uuid();
  v_view text;
  v_ext text;
  v_path text;
begin
  select * into v_purpose from public.upload_purposes u
   where u.key = p_purpose and u.bucket = p_bucket and u.module_key = p_module_key;
  if not found
     or p_subject_type is null or p_subject_id is null or p_original_name is null
     or p_mime_type is null or not (p_mime_type = any (v_purpose.mime_types))
     or p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > v_purpose.max_bytes
     or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid purpose, bucket, module, subject, name, type, size or hash' using errcode = '22023';
  end if;
  -- A null argument never widens the purpose's rule; null overall (any member) in org-assets only.
  v_view := coalesce(p_view_permission, v_purpose.view_permission);
  if v_view is null and p_bucket in ('documents', 'signed-documents') then
    raise exception 'A view permission is required in bucket %', p_bucket using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, p_module_key) then
    raise exception 'Module disabled for the organization' using errcode = '22023';
  end if;

  v_ext := private.mime_extension(p_mime_type);
  v_path := p_org_id::text || '/' || p_module_key || '/' || p_subject_id::text || '/' || v_id::text || '.' || v_ext;
  insert into public.stored_files (
    id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
    original_name, mime_type, ext, size_bytes, sha256, status, retain_until, confirmed_at)
  values (
    v_id, p_org_id, p_bucket, v_path, p_module_key, p_purpose, p_subject_type, p_subject_id, v_view,
    p_original_name, p_mime_type, v_ext, p_size_bytes, p_sha256, 'ready',
    pg_catalog.now() + pg_catalog.make_interval(days => v_purpose.retain_days), pg_catalog.now());

  return query select v_id, v_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cleanup (storage-cleanup, one org at a time)
-- -----------------------------------------------------------------------------
-- The org's files whose object can be removed (rules in the header), oldest first.
create function public.list_files_to_purge(p_org_id uuid, p_limit int default 500)
returns table (id uuid, bucket text, object_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.bucket, f.object_path
    from public.stored_files f
   where f.org_id = p_org_id
     and (f.status in ('pending', 'deleted') or (f.status = 'ready' and f.retain_until is not null))
     and ((f.status = 'pending' and f.created_at < pg_catalog.now() - interval '24 hours')
          or (f.status = 'deleted' and f.deleted_at < pg_catalog.now() - interval '30 days')
          or (f.status = 'deleted' and f.confirmed_at is null and f.deleted_at < pg_catalog.now() - interval '24 hours')
          or (f.status = 'ready' and f.retain_until < pg_catalog.now()))
   order by f.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 500)
$$;

-- Marks as purged the listed files whose objects were removed; re-checks the rules, so a file that
-- is not purgeable (or of another org) is left as is. Returns how many were marked.
create function public.mark_files_purged(p_org_id uuid, p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_ids is null or pg_catalog.cardinality(p_ids) > 500 then
    raise exception 'Between 0 and 500 ids' using errcode = '22023';
  end if;
  update public.stored_files f
     set status = 'purged'
   where f.org_id = p_org_id
     and f.id = any (p_ids)
     and ((f.status = 'pending' and f.created_at < pg_catalog.now() - interval '24 hours')
          or (f.status = 'deleted' and f.deleted_at < pg_catalog.now() - interval '30 days')
          or (f.status = 'deleted' and f.confirmed_at is null and f.deleted_at < pg_catalog.now() - interval '24 hours')
          or (f.status = 'ready' and f.retain_until < pg_catalog.now()));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function
  public.confirm_stored_file(uuid, text, int),
  public.reject_stored_file(uuid),
  public.register_system_file(uuid, text, text, text, text, uuid, text, int, text, text, text),
  public.list_files_to_purge(uuid, int),
  public.mark_files_purged(uuid, uuid[])
from public, anon, authenticated;
grant execute on function
  public.confirm_stored_file(uuid, text, int),
  public.reject_stored_file(uuid),
  public.register_system_file(uuid, text, text, text, text, uuid, text, int, text, text, text),
  public.list_files_to_purge(uuid, int),
  public.mark_files_purged(uuid, uuid[])
to service_role;

-- -----------------------------------------------------------------------------
-- Module RPC helpers (P3-17; called by security definer RPCs, no role may call them)
-- -----------------------------------------------------------------------------
-- Re-points a ready file of the caller's org to its final subject and access rule, and clears its
-- deadline (a staged upload becomes permanent). The object never moves. The file id may come from
-- a client, so this checks everything about the file itself:
--   * of the caller's org, `ready`, not past its retain_until;
--   * its purpose is one of p_purposes (the purposes the calling RPC accepts);
--   * when p_uploaded_by is given, that user uploaded it (e.g. a provider attaching her own file).
-- « Fichier introuvable. » (P0001) when any of these fails, so a file id of another org, purpose
-- or uploader reveals nothing. 22023 for invalid arguments: no purpose list, no subject, an owner
-- without an owner permission, or permissions outside the file's module (the module gate; a
-- module file needs a view permission).
create function private.attach_stored_file(
  p_file_id uuid,
  p_purposes text[],
  p_subject_type text,
  p_subject_id uuid,
  p_view_permission text,
  p_owner_profile_id uuid,
  p_owner_permission text,
  p_uploaded_by uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_module text;
begin
  if p_purposes is null or pg_catalog.cardinality(p_purposes) = 0
     or p_subject_type is null or p_subject_id is null
     or (p_owner_profile_id is null) <> (p_owner_permission is null) then
    raise exception 'Invalid purposes or subject, or an owner without an owner permission' using errcode = '22023';
  end if;
  select f.module_key into v_module
    from public.stored_files f
   where f.id = p_file_id
     and f.org_id = private.current_user_org_id()
     and f.status = 'ready'
     and (f.retain_until is null or f.retain_until > pg_catalog.now())
     and f.purpose = any (p_purposes)
     and (p_uploaded_by is null or f.uploaded_by = p_uploaded_by)
     for no key update;
  if not found then
    raise exception 'Fichier introuvable.' using errcode = 'P0001';
  end if;
  if v_module <> 'core'
     and (p_view_permission is null
          or not private.permission_in_module(p_view_permission, v_module)
          or not private.permission_in_module(p_owner_permission, v_module)) then
    raise exception 'A % file can only name permissions of its module', v_module using errcode = '22023';
  end if;

  update public.stored_files f
     set subject_type = p_subject_type,
         subject_id = p_subject_id,
         view_permission = p_view_permission,
         owner_profile_id = p_owner_profile_id,
         owner_permission = p_owner_permission,
         retain_until = null
   where f.id = p_file_id;
end;
$$;

-- Soft-deletes a pending or ready file (its object is removed 30 days later); a deleted or purged
-- file is left as is. `p_by` (null for a system action) must be a member of the file's org. The
-- file id comes from the caller's own row, which the caller has already scoped to its org.
create function private.soft_delete_stored_file(p_file_id uuid, p_by uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
begin
  select f.org_id, f.status into v_org, v_status
    from public.stored_files f where f.id = p_file_id
     for no key update;
  if not found
     or (p_by is not null
         and not exists (select 1 from public.profiles p where p.user_id = p_by and p.org_id = v_org)) then
    raise exception 'Unknown file, or an actor outside its org' using errcode = '22023';
  end if;
  if v_status in ('pending', 'ready') then
    update public.stored_files f
       set status = 'deleted', deleted_at = pg_catalog.now(), deleted_by = p_by
     where f.id = p_file_id;
  end if;
end;
$$;

revoke all on function
  private.attach_stored_file(uuid, text[], text, uuid, text, uuid, text, uuid),
  private.soft_delete_stored_file(uuid, uuid)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Organization logo and signature image
-- -----------------------------------------------------------------------------
-- Sets (or, with a null file, removes: « Retirer ») the org's logo or signature image. The file
-- must be ready, of the caller's org and of the matching purpose; it stops being staged. The
-- previous asset is soft-deleted.
create function public.set_org_asset(p_kind text, p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_old uuid;
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('logo', 'signature') then
    raise exception 'Unknown asset kind: %', p_kind using errcode = '22023';
  end if;

  select case p_kind when 'logo' then o.logo_file_id else o.signature_file_id end into v_old
    from public.organizations o where o.id = v_org
     for no key update;
  if p_file_id is not distinct from v_old then
    return;
  end if;

  if p_file_id is not null then
    update public.stored_files f
       set retain_until = null
     where f.id = p_file_id
       and f.org_id = v_org
       and f.status = 'ready'
       and f.purpose = 'org_' || p_kind
       and (f.retain_until is null or f.retain_until > pg_catalog.now());
    if not found then
      raise exception 'Fichier introuvable.' using errcode = 'P0001';
    end if;
  end if;

  if p_kind = 'logo' then
    update public.organizations o set logo_file_id = p_file_id where o.id = v_org;
  else
    update public.organizations o set signature_file_id = p_file_id where o.id = v_org;
  end if;
  if v_old is not null then
    perform private.soft_delete_stored_file(v_old, auth.uid());
  end if;
end;
$$;
revoke all on function public.set_org_asset(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_org_asset(text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Core purposes
-- -----------------------------------------------------------------------------
insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values
  ('org_logo', 'core', 'org-assets', 'settings.manage', null, null, 2097152,
   array['image/png', 'image/jpeg'], 4000, 1),
  ('org_signature', 'core', 'org-assets', 'settings.manage', 'settings.manage', null, 2097152,
   array['image/png', 'image/jpeg'], 4000, 1)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Job: core.storage_cleanup (function storage-cleanup, Task 3.26)
-- -----------------------------------------------------------------------------
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, cron_job_name, is_maintenance)
values
  ('core.storage_cleanup', 'core', 'Nettoyage des fichiers',
   'Supprime les fichiers dont le téléversement n''a pas abouti après 24 heures, les fichiers retirés après 30 jours et les fichiers déposés jamais rattachés à leur échéance.',
   'function', 'storage-cleanup', 'core.storage_cleanup', true)
on conflict do nothing;

select cron.schedule('core.storage_cleanup', '40 8 * * *',
  $$select private.invoke_job_function('core.storage_cleanup')$$);
