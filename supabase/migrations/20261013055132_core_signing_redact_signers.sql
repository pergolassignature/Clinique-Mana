-- =============================================================================
-- Core signing: redact a person from a signature request (CC-10), used by Clients' anonymisation
-- =============================================================================
-- Decisions: CC-10 (the follow-up it names), ADR 0003 (modules plug into core with data and the
-- private helpers their definer functions call), ADR 0005 (the signed PDF is ours to keep)
--
-- Core keeps its own copy of who signs (`signature_request_signers.name` / `email`) and of the
-- request's title (« Consentement général — Prénom Nom »), which also names the stored PDFs
-- (`stored_files.original_name`). When a module erases a person (Loi 25), it calls
-- `private.signing_redact(org, request, roles, title)`:
-- - the signers of those roles get a neutral name (« Personne anonymisée ») and an address that can
--   receive nothing (`anonymise+<id>@redacted.invalid`); `redacted_at` says when;
-- - with a title, the request's title and its stored files' names are replaced (the files
--   themselves are the legal proof and stay);
-- - the journal records the change under the caller's source, with these columns redacted, as
--   they already are (audit_trigger arguments of the three tables).
-- Documenso keeps its own copy of the envelope (names and addresses): erasing it there is asked of
-- the clinic's Documenso administrator (docs/modules/core.md, « Signing »).
-- Clients' anonymisation handler now calls it for the consent requests of the person (title and her
-- own signer rows) and for those she signed for another client (her rows only).
-- Additive: one column, one private function, one module function replaced (same signature).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:core_signing_redact_signers', true);

alter table public.signature_request_signers add column redacted_at timestamptz;
grant select (redacted_at) on public.signature_request_signers to authenticated;

-- Redacts the signers of `p_roles` on one request of the org (and, with `p_title`, the request's
-- title and its stored files' names). Returns the number of rows changed. Never fails on a request
-- that is not there (another org, already purged): 0.
create function private.signing_redact(p_org uuid, p_request_id uuid, p_roles text[], p_title text default null)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
  v_title text := nullif(pg_catalog.btrim(coalesce(p_title, '')), '');
begin
  if v_title is not null and (pg_catalog.length(v_title) > 200 or v_title ~ '[[:cntrl:]]') then
    raise exception 'Invalid title' using errcode = '22023';
  end if;
  update public.signature_request_signers s
     set name = 'Personne anonymisée',
         email = 'anonymise+' || pg_catalog.left(pg_catalog.replace(s.id::text, '-', ''), 12) || '@redacted.invalid',
         redacted_at = pg_catalog.now()
   where s.org_id = p_org and s.request_id = p_request_id and s.role = any (coalesce(p_roles, '{}'))
     and s.redacted_at is null;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  if v_title is not null then
    update public.signature_requests r set title = v_title
     where r.org_id = p_org and r.id = p_request_id and r.title is distinct from v_title;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
    update public.stored_files f
       set original_name = pg_catalog.left(v_title, 180) || case when f.purpose = 'signing_signed' then ' — signé' else '' end || '.pdf'
     where f.org_id = p_org and f.subject_type = 'signature_request' and f.subject_id = p_request_id;
    get diagnostics v_count = row_count; v_total := v_total + v_count;
  end if;
  return v_total;
end;
$$;
revoke all on function private.signing_redact(uuid, uuid, text[], text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Clients: the anonymisation handler (C5a, CC-10) also redacts core's copies
-- -----------------------------------------------------------------------------
create or replace function private.clients_consents_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_total int := 0;
  v_count int;
  v_request uuid;
  r record;
begin
  select c.org_id into v_org from public.clients c where c.id = p_id;

  -- Nothing more is asked of her, nor in her name.
  for v_request in select q.id from public.client_consent_requests q
                    where q.org_id = v_org and q.state = 'pending'
                      and (q.client_id = p_id
                           or exists (select 1 from public.client_consent_request_signers s
                                       where s.request_id = q.id and s.signer_client_id = p_id)) loop
    perform private.clients_consent_cancel(v_org, v_request);
    v_total := v_total + 1;
  end loop;

  -- Her consents: the signers' names and the withdrawal note go; the roles, dates and PDF stay.
  update public.client_consents c
     set signed_by = coalesce((select pg_catalog.jsonb_agg(e.value - 'name' order by e.ordinality)
                                 from pg_catalog.jsonb_array_elements(c.signed_by) with ordinality e), '[]'),
         withdrawal_note = null
   where c.org_id = v_org and c.client_id = p_id
     and (c.withdrawal_note is not null or pg_catalog.jsonb_path_exists(c.signed_by, '$[*].name'));
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  -- Another client's consents she signed (as parent or guardian): her name only.
  update public.client_consents c
     set signed_by = (select pg_catalog.jsonb_agg(case when e.value ->> 'role' = s.role then e.value - 'name' else e.value end
                                                  order by e.ordinality)
                        from pg_catalog.jsonb_array_elements(c.signed_by) with ordinality e)
    from public.client_consent_request_signers s
   where c.org_id = v_org and c.client_id <> p_id and s.org_id = v_org
     and s.request_id = c.request_id and s.signer_client_id = p_id
     and pg_catalog.jsonb_array_length(c.signed_by) > 0;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  -- Core's copies (CC-10): her consent requests lose the title that names her; her own signer rows,
  -- on her requests and on those she signed for another client, lose her name and address.
  for r in
    select sr.id as signature_request_id,
           q.client_id = p_id as is_hers,
           (select coalesce(pg_catalog.array_agg(s.role), '{}') from public.client_consent_request_signers s
             where s.request_id = q.id and s.signer_client_id = p_id) as roles
      from public.client_consent_requests q
      join public.signature_requests sr
        on sr.org_id = q.org_id and sr.subject_type = 'client_consent_request' and sr.subject_id = q.id
     where q.org_id = v_org
       and (q.client_id = p_id
            or exists (select 1 from public.client_consent_request_signers s where s.request_id = q.id and s.signer_client_id = p_id))
  loop
    v_total := v_total + private.signing_redact(v_org, r.signature_request_id, r.roles,
                                                case when r.is_hers then 'Consentement — client anonymisé' end);
  end loop;
  return v_total;
end;
$$;
revoke all on function private.clients_consents_anonymize_client(uuid) from public, anon, authenticated, service_role;
