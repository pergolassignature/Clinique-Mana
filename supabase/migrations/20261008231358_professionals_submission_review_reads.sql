-- =============================================================================
-- Professionnels: the submissions of a file, and « Mon profil »'s read (Task 4b.5)
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4b.5 (P4-360 … P4-372)
-- Needs:   *_professionals_onboarding.sql (4b.1: professional_submissions, the review RPCs),
--          *_professionals_lifecycle.sql (4a.4: get_professional_record)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * `list_professional_submissions(p_id)`: « Questionnaire et mises à jour » in the record's
--   Documents tab, newest first, at most 50 (a file gets one onboarding and a few updates a year).
--   Definer for the reviewer's name: `profiles` is readable with users.view only, and the
--   conseillère reads the record without it. Never the answers (`prefill`, `submitted_values`):
--   the review sheet reads them through get_submission_review, with professionals.review. The
--   sent-back note is staff content (the provider reads it in her own questionnaire).
-- * `get_my_professional_record()`: « Mon profil » (professionals.self) in one request, without
--   knowing the file's id: get_professional_record of private.current_professional_id(), invoker
--   (the record's own RLS applies: the provider reads her row and its sets), null when no file is
--   linked to the account (an admin who holds professionals.self by default). The staff's notes on
--   the file (`deactivation_note`, `activation_override_reason`) are blanked: they are written for
--   the clinic, not for the professional (P4-366).
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
             'applied_count', pg_catalog.cardinality(s.applied_fields))
           order by s.created_at desc, s.id desc)
      from (select x.* from public.professional_submissions x
             where x.professional_id = p_id and x.org_id = v_org
             order by x.created_at desc, x.id desc
             limit 50) s
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
declare
  v_record jsonb;
begin
  if not private.has_permission('professionals.self') then
    raise exception 'Permission refusée : professionals.self' using errcode = '42501';
  end if;
  v_record := public.get_professional_record(private.current_professional_id());
  if v_record is null then
    return null;
  end if;
  return pg_catalog.jsonb_set(v_record, '{professional}',
    (v_record -> 'professional') || '{"deactivation_note": null, "activation_override_reason": null}'::jsonb);
end;
$$;

revoke all on function public.list_professional_submissions(uuid), public.get_my_professional_record()
  from public, anon, authenticated, service_role;
grant execute on function public.list_professional_submissions(uuid), public.get_my_professional_record()
  to authenticated;
