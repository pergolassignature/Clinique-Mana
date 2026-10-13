-- =============================================================================
-- Signing: a second client-side signer role, `client_2` (Clients C5a)
-- =============================================================================
-- Plan:    docs/plans/2026-10-11-modules-coding-plan.md §6 C5 (« both parents when shared custody
--          is recorded (two signers) »), decision R-48.
-- Needs:   *_core_signing.sql, *_core_signing_drop_document_columns.sql (the latest
--          create_signature_request).
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Signer roles are a closed list shared by the renderer (`SIGNER_ROLES` in
--   supabase/functions/_shared/pdf/model.ts), a version's `signers`, the request's signers and
--   `signature_request_signers.role`. A client consent may need two signatures on the client's side:
--   a child's two parents under shared custody (R-48). `client` stays the person who signs for the
--   client (the client from 14, else a parent or guardian); `client_2` is the second one. Each role
--   keeps its own boxes on the signature page; the template labels them.
-- * Additive: the role list gains `client_2`; a document still has at most three signers (the
--   signature page holds three boxes: `SIGNER` in _shared/pdf/render.ts). `create_signature_request`
--   is replaced with its latest body (20261009210934), the role list widened, nothing else (same
--   arguments, result, security and grants).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_signing_second_client_signer', true);

-- A version's `signers`: at most three objects `{role, label, order, required}`, one per role.
create or replace function private.signing_signers_valid(p_signers jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_signers) is distinct from 'array' then false
    when pg_catalog.jsonb_array_length(p_signers) > 3 then false
    else not exists (
           select 1 from pg_catalog.jsonb_array_elements(p_signers) s
            where case when pg_catalog.jsonb_typeof(s) <> 'object' then true
                       else (s ->> 'role') is null
                         or (s ->> 'role') not in ('professional', 'clinic', 'client', 'client_2')
                         or pg_catalog.jsonb_typeof(s -> 'label') is distinct from 'string'
                         or pg_catalog.length(pg_catalog.btrim(s ->> 'label')) not between 1 and 120
                         or pg_catalog.jsonb_typeof(s -> 'order') is distinct from 'number'
                         or (s ->> 'order') !~ '^[1-9]$'
                         or pg_catalog.jsonb_typeof(s -> 'required') is distinct from 'boolean'
                  end)
         and (select pg_catalog.count(distinct s ->> 'role') = pg_catalog.count(*)
                from pg_catalog.jsonb_array_elements(p_signers) s)
  end
$$;
revoke all on function private.signing_signers_valid(jsonb) from public, anon, authenticated, service_role;

alter table public.signature_request_signers drop constraint signature_request_signers_role_check;
alter table public.signature_request_signers
  add constraint signature_request_signers_role_check check (role in ('professional', 'clinic', 'client', 'client_2'));

create or replace function public.create_signature_request(p jsonb)
returns table (id uuid, existing boolean, status text, signers jsonb, last_error text, created_at timestamptz,
               envelope_id text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_module text := p ->> 'module_key';
  v_purpose text := p ->> 'purpose';
  v_version uuid := (p ->> 'template_version_id')::uuid;
  v_view text := p ->> 'view_permission';
  v_key text := p ->> 'idempotency_key';
  v_sent_by uuid := (p ->> 'sent_by')::uuid;
  v_subject_type text := p ->> 'subject_type';
  v_subject_id uuid := (p ->> 'subject_id')::uuid;
  v_signers jsonb := p -> 'signers';
  v_roles jsonb;
  v_id uuid;
  v_new boolean := false;
begin
  if v_org is null or v_module is null or v_key is null
     or not exists (select 1 from public.organizations o where o.id = v_org) then
    raise exception 'Unknown organization, or no module or idempotency key' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(v_org, v_module) then
    raise exception 'Module disabled for the organization' using errcode = '22023';
  end if;
  if v_purpose is null or pg_catalog.split_part(v_purpose, '.', 1) <> v_module
     or not exists (select 1 from public.permissions pm where pm.key = v_view and pm.module_key = v_module) then
    raise exception 'The purpose and the view permission must belong to module %', v_module using errcode = '22023';
  end if;
  if v_version is null then
    if v_purpose <> 'core.signing_test' then
      raise exception 'Only the built-in test document has no template version' using errcode = '22023';
    end if;
  else
    select v.signers into v_roles
      from public.document_template_versions v
      join public.document_templates t on t.id = v.template_id
     where v.id = v_version and v.org_id = v_org and v.status = 'published' and t.is_active and t.module_key = v_module;
    if not found then
      raise exception 'No published template version % of module % in the organization', v_version, v_module
        using errcode = '22023';
    end if;
  end if;
  if v_sent_by is not null
     and not exists (select 1 from public.profiles pr where pr.user_id = v_sent_by and pr.org_id = v_org) then
    raise exception 'The sender is not a member of the organization' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(v_signers) is distinct from 'array'
     or pg_catalog.jsonb_array_length(v_signers) not between 1 and 3
     or exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                 where case when pg_catalog.jsonb_typeof(s) <> 'object' then true
                            else (s ->> 'role') is null
                              or (s ->> 'role') not in ('professional', 'clinic', 'client', 'client_2')
                              or coalesce(pg_catalog.length(pg_catalog.btrim(s ->> 'name')), 0) not between 1 and 200
                              or (s ->> 'name') ~ '[[:cntrl:]]'
                              or not coalesce(private.is_mailbox(pg_catalog.btrim(s ->> 'email')), false)
                              or pg_catalog.jsonb_typeof(s -> 'order') is distinct from 'number'
                              or (s ->> 'order') !~ '^[1-9]$'
                       end)
     or (select pg_catalog.count(distinct s ->> 'role') <> pg_catalog.count(*)
                or pg_catalog.count(distinct s ->> 'order') <> pg_catalog.count(*)
           from pg_catalog.jsonb_array_elements(v_signers) s) then
    raise exception 'Invalid signers' using errcode = '22023';
  end if;
  if v_roles is not null
     and (exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                   where not exists (select 1 from pg_catalog.jsonb_array_elements(v_roles) r
                                      where r ->> 'role' = s ->> 'role'))
          or exists (select 1 from pg_catalog.jsonb_array_elements(v_roles) r
                      where (r ->> 'required')::boolean
                        and not exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                                         where s ->> 'role' = r ->> 'role'))) then
    raise exception 'The signers must match the roles of the template version' using errcode = '22023';
  end if;
  if (select pg_catalog.count(distinct pg_catalog.lower(pg_catalog.btrim(s ->> 'email')))
        from pg_catalog.jsonb_array_elements(v_signers) s) <> pg_catalog.jsonb_array_length(v_signers) then
    raise exception 'Chaque signataire doit avoir sa propre adresse courriel.' using errcode = 'P0001';
  end if;

  -- The idempotency key first: the same key always returns its own row (header).
  select r.id into v_id from public.signature_requests r where r.org_id = v_org and r.idempotency_key = v_key;
  if v_id is null then
    if v_purpose <> 'core.signing_test'
       and exists (select 1 from public.signature_requests r
                    where r.org_id = v_org and r.subject_type = v_subject_type and r.subject_id = v_subject_id
                      and r.purpose = v_purpose
                      and (r.status in ('sent', 'viewed')
                           or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'))) then
      raise exception 'Une demande de signature est déjà en cours pour ce dossier.' using errcode = 'P0001';
    end if;
    begin
      insert into public.signature_requests as r
        (org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, idempotency_key,
         view_permission, sent_by)
      values
        (v_org, v_module, v_purpose, v_version, v_subject_type, v_subject_id,
         pg_catalog.btrim(p ->> 'title', E' \t\r\n'), v_key, v_view, v_sent_by)
      on conflict (org_id, idempotency_key) do nothing
      returning r.id into v_id;
    exception when unique_violation then
      -- A concurrent request with another key for the same record and purpose won the race.
      raise exception 'Une demande de signature est déjà en cours pour ce dossier.' using errcode = 'P0001';
    end;
    if v_id is null then
      -- The same key, inserted concurrently.
      select r.id into v_id from public.signature_requests r where r.org_id = v_org and r.idempotency_key = v_key;
    else
      insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order)
      select v_id, v_org, s ->> 'role', pg_catalog.btrim(s ->> 'name'), pg_catalog.btrim(s ->> 'email'),
             (s ->> 'order')::smallint
        from pg_catalog.jsonb_array_elements(v_signers) s;
      v_new := true;
    end if;
  end if;

  -- The same key with other signers is not the same action (header).
  if not v_new
     and (exists (select s ->> 'role', (s ->> 'order')::smallint, pg_catalog.btrim(s ->> 'name'),
                         pg_catalog.lower(pg_catalog.btrim(s ->> 'email'))
                    from pg_catalog.jsonb_array_elements(v_signers) s
                  except
                  select x.role, x.signing_order, x.name, pg_catalog.lower(x.email)
                    from public.signature_request_signers x where x.request_id = v_id)
          or exists (select x.role, x.signing_order, x.name, pg_catalog.lower(x.email)
                       from public.signature_request_signers x where x.request_id = v_id
                     except
                     select s ->> 'role', (s ->> 'order')::smallint, pg_catalog.btrim(s ->> 'name'),
                            pg_catalog.lower(pg_catalog.btrim(s ->> 'email'))
                       from pg_catalog.jsonb_array_elements(v_signers) s)) then
    raise exception 'Les signataires ne correspondent pas à la demande existante.' using errcode = 'P0001';
  end if;

  return query
    select r.id, not v_new, r.status,
           coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role', s.role, 'signer_id', s.id)
                                                 order by s.signing_order)
                       from public.signature_request_signers s where s.request_id = r.id), '[]'),
           r.last_error, r.created_at, r.envelope_id
      from public.signature_requests r
     where r.id = v_id;
end;
$$;
