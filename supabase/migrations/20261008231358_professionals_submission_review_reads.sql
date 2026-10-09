-- =============================================================================
-- Professionnels: the submissions of a file, and « Mon profil »'s read (Task 4b.5)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4b.5 (P4-360 … P4-379)
-- Needs:   *_professionals_onboarding.sql (4b.1: professional_submissions, the review RPCs),
--          *_professionals_lifecycle.sql (4a.4: get_professional_record),
--          *_core_shared_permissions.sql (get_my_access, released: replaced here, P4-376)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * `list_professional_submissions(p_id)`: « Questionnaire et mises à jour » in the record's
--   Documents tab, newest first, at most 50 (a file gets one onboarding and a few updates a year).
--   Definer for the reviewer's name: `profiles` is readable with users.view only, and the
--   conseillère reads the record without it. Never the answers (`prefill`, `submitted_values`):
--   the review sheet reads them through get_submission_review, with professionals.review. The
--   sent-back note is staff content (the provider reads it in her own questionnaire).
--   `started_by_professional`: the submission's `requested_by` is the file's own account (she
--   started this update from « Mon profil »); otherwise the clinic asked (P4-375).
-- * `get_my_professional_record()`: « Mon profil » (professionals.self) in one request, without
--   knowing the file's id: get_professional_record of private.current_professional_id(), invoker
--   (the record's own RLS applies: the provider reads her row and its sets), null when no file is
--   linked to the account (an admin who holds professionals.self by default). The clinic's notes on
--   her row (`deactivation_note`, `activation_override_reason`) come as on the record: the
--   professional may read what is written about her on her own row (Loi 25 right of access, 4a's
--   self policy), and staff are told so under both fields (P4-373, amends P4-366). « Mon profil »
--   does not display them.
-- * `get_my_access()` adds `has_professional_file` (P4-376): the caller's account is linked to a
--   professional file of her clinic (`private.current_professional_id()`). « Mon profil » and
--   Accueil's card follow it instead of a permission rule, so an admin who practises keeps them and
--   an admin without a file never reads her (absent) questionnaire. get_my_access lives in a
--   released migration (*_core_shared_permissions.sql): replaced here with `create or replace`,
--   every other field unchanged. A core payload naming a module's notion is deliberate: the shell
--   needs it before any module code loads, and the helper returns null when the module has no row.
-- =============================================================================

-- « Questionnaire et mises à jour »: the file's submissions, newest first, without their answers.
create function public.list_professional_submissions(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', s.id, 'kind', s.kind, 'status', s.status, 'requested_sections', s.requested_sections,
             'created_at', s.created_at, 'submitted_at', s.submitted_at, 'reviewed_at', s.reviewed_at,
             'reviewed_by_name', pr.display_name, 'decision_note', s.decision_note,
             'applied_count', pg_catalog.cardinality(s.applied_fields),
             'started_by_professional', coalesce(s.requested_by = p.profile_id, false))
           order by s.created_at desc, s.id desc)
      from (select x.* from public.professional_submissions x
             where x.professional_id = p_id and x.org_id = v_org
             order by x.created_at desc, x.id desc
             limit 50) s
      join public.professionals p on p.id = s.professional_id and p.org_id = v_org
      left join public.profiles pr on pr.user_id = s.reviewed_by and pr.org_id = v_org), '[]'::jsonb);
end;
$$;

-- « Mon profil »: the caller's own record, null without a linked file.
create function public.get_my_professional_record()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission('professionals.self') then
    raise exception 'Permission refusée : professionals.self' using errcode = '42501';
  end if;
  return public.get_professional_record(private.current_professional_id());
end;
$$;

revoke all on function public.list_professional_submissions(uuid), public.get_my_professional_record()
  from public, anon, authenticated, service_role;
grant execute on function public.list_professional_submissions(uuid), public.get_my_professional_record()
  to authenticated;

-- The access payload gains `has_professional_file` (P4-376); every other field is as in
-- *_core_shared_permissions.sql. Same signature: create or replace keeps the grants.
create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id',      p.user_id,
    'org_id',       p.org_id,
    'org_name',     o.name,
    'org_timezone', o.timezone,
    'display_name', p.display_name,
    'email',        p.email,
    'status',       p.status,
    'role',         r.role,
    'permissions',  to_jsonb(private.current_permission_keys()),
    'modules', case when p.status = 'active' then coalesce((
        select jsonb_agg(om.module_key order by om.module_key)
          from public.org_modules om
         where om.org_id = p.org_id
           and om.enabled
      ), '[]'::jsonb) else '[]'::jsonb end,
    'has_professional_file', private.current_professional_id() is not null
  )
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  left join public.user_roles r on r.user_id = p.user_id
  where p.user_id = auth.uid()
$$;
