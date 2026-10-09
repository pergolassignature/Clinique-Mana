-- Core: a template's versions through an RPC, so a module never reads a core table directly.
--
-- « Paramètres → Contrats et formulaires » (module Professionnels) listed a template's versions
-- with `.from('document_template_versions')`, a read of core's raw table from a module (CLAUDE.md
-- §5: a module reads another's data through published views or RPCs only). Core now publishes
-- `list_document_template_versions(p_template_id)`:
-- * security definer, the template looked up in the caller's clinic first (another clinic's id
--   and an unknown id answer the same 22023, no existence oracle), then the template's
--   view_permission (42501, as the edit RPCs of *_core_signing.sql test edit_permission). The
--   permission keys are those of enabled modules only, so a disabled module's template is refused.
-- * Only the columns the editor reads: no org id, no actor ids. Newest first.
-- * Additive: the table's select grant and policy stay (core's own reads, signing functions).

create function public.list_document_template_versions(p_template_id uuid)
returns table (
  id uuid,
  version int,
  status text,
  body jsonb,
  variables jsonb,
  signers jsonb,
  email_subject text,
  email_message text,
  created_at timestamptz,
  updated_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_view text;
begin
  select t.view_permission into v_view
    from public.document_templates t
   where t.id = p_template_id and t.org_id = private.current_user_org_id();
  if not found then
    raise exception 'Unknown template' using errcode = '22023';
  end if;
  if not private.has_permission(v_view) then
    raise exception 'Permission refusée : %', v_view using errcode = '42501';
  end if;

  return query
    select v.id, v.version, v.status, v.body, v.variables, v.signers, v.email_subject, v.email_message,
           v.created_at, v.updated_at, v.published_at, v.archived_at
      from public.document_template_versions v
     where v.template_id = p_template_id
     order by v.version desc;
end;
$$;

revoke all on function public.list_document_template_versions(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_document_template_versions(uuid) to authenticated;
