-- =============================================================================
-- Professionnels: the contract card's signed-PDF downloads (P4-500)
-- =============================================================================
-- get_professional_contract (20261009030158) also returns, only to a caller holding the request's
-- view permission (`can_read`, P4-435), what core's downloads need beside `signed_file_id`: the
-- request's `title` (« Contrat de service — Prénom Nom », the files' names), its `page_count` (N,
-- the contract's own pages; 20261009124704_core_signing_signed_files.sql) and its
-- `source_file_id` (the stored PDF that was sent: the browser counts its pages when `page_count`
-- is null, a contract sent before it was recorded). The rest is unchanged.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:professionals_contract_signed_files', true);

-- {template: {id, published_version_id, published_version, published_at, draft_version_id} | null
-- (none, or retired), clinic_signer (Settings « Signataire » has a name and an address),
-- request: the latest service-contract request or null: {id, status, last_error, template_version,
-- created_at, send_started_at and last_send_at (the send claim: a draft whose claim is older than
-- STALE_SEND_MS is shown failed, not « Envoi en cours »), sent_at, viewed_at, completed_at,
-- rejected_at, cancelled_at, expired_at, expires_at, can_read (the caller holds its view
-- permission), title, signed_file_id, source_file_id, page_count and rejection_reason (only then),
-- signers: [{role, name, status, signing_order, viewed_at, signed_at, rejected_at}]}}. Null for a
-- professional the caller cannot read (another clinic's).
create or replace function public.get_professional_contract(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_perms text[] := private.current_permission_keys()::text[];
  v_request jsonb;
begin
  if not ('professionals.view' = any (v_perms)) then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
           'id', r.id, 'status', r.status, 'last_error', r.last_error, 'template_version', v.version,
           'created_at', r.created_at, 'send_started_at', r.send_started_at, 'last_send_at', r.last_send_at,
           'sent_at', r.sent_at, 'viewed_at', r.viewed_at,
           'completed_at', r.completed_at, 'rejected_at', r.rejected_at, 'cancelled_at', r.cancelled_at,
           'expired_at', r.expired_at, 'expires_at', r.expires_at,
           'can_read', r.view_permission = any (v_perms),
           'title', case when r.view_permission = any (v_perms) then r.title end,
           'signed_file_id', case when r.view_permission = any (v_perms) then r.signed_file_id end,
           'source_file_id', case when r.view_permission = any (v_perms) then r.source_file_id end,
           'page_count', case when r.view_permission = any (v_perms) then r.page_count end,
           'rejection_reason', case when r.view_permission = any (v_perms) then r.rejection_reason end,
           'signers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                         'role', s.role, 'name', s.name, 'status', s.status,
                                         'signing_order', s.signing_order, 'viewed_at', s.viewed_at,
                                         'signed_at', s.signed_at, 'rejected_at', s.rejected_at)
                                       order by s.signing_order)
                                  from public.signature_request_signers s where s.request_id = r.id), '[]'::jsonb))
    into v_request
    from public.signature_requests r
    left join public.document_template_versions v on v.id = r.template_version_id
   where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
     and r.purpose = 'professionals.service_contract'
   order by r.created_at desc, r.id desc
   limit 1;

  return pg_catalog.jsonb_build_object(
    'template', (select pg_catalog.jsonb_build_object(
                          'id', t.id, 'published_version_id', p.id, 'published_version', p.version,
                          'published_at', p.published_at, 'draft_version_id', d.id)
                   from public.document_templates t
                   left join public.document_template_versions p on p.template_id = t.id and p.status = 'published'
                   left join public.document_template_versions d on d.template_id = t.id and d.status = 'draft'
                  where t.org_id = v_org and t.key = 'professionals.service_contract' and t.is_active),
    'clinic_signer', (select nullif(pg_catalog.btrim(o.signatory_name), '') is not null
                             and nullif(pg_catalog.btrim(o.signatory_email), '') is not null
                        from public.organizations o where o.id = v_org),
    'request', v_request);
end;
$$;
