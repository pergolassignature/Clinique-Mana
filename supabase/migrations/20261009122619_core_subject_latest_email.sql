-- Core: the latest email about a record, for module read models (P4-490).
--
-- A module that must say whether an email about one of its records left (Professionnels: the
-- invitation's « envoyée » / « pas parti ») reads it through this helper, never `email_log`
-- itself: core owns the log and its columns. Called from the module's definer RPCs, which check
-- their own permission first; no role may execute it.
--
-- The newest row (created_at, then id) of the given templates about (p_subject_type,
-- p_subject_id) created at or after p_since; no row when there is none. Its status and error code
-- as stored (`failed` + `provider_unavailable` means « Résultat inconnu »: `emailStatusLabel`).
-- Served by email_log_subject_idx (org_id, subject_type, subject_id, created_at desc, id desc).

create function private.latest_subject_email(
  p_org uuid, p_subject_type text, p_subject_id uuid, p_template_keys text[], p_since timestamptz
)
returns table (id uuid, status text, error_code text, created_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select e.id, e.status, e.error_code, e.created_at
    from public.email_log e
   where e.org_id = p_org and e.subject_type = p_subject_type and e.subject_id = p_subject_id
     and e.template_key = any (p_template_keys) and e.created_at >= p_since
   order by e.created_at desc, e.id desc
   limit 1
$$;
revoke all on function private.latest_subject_email(uuid, text, uuid, text[], timestamptz)
  from public, anon, authenticated, service_role;
