-- =============================================================================
-- Signing: the deprecated Documenso document columns are dropped
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-documenso-envelope-api-plan.md (E-2: « A later cleanup migration
--          drops both columns and those outputs »)
-- ADR:     docs/adr/0005-documenso-replaces-docuseal.md (amended)
-- Follows: 20261008133453_core_signing_envelope.sql (step 1: deprecated, never written since)
-- Rules:   docs/standards/database-conventions.md §1 (two steps: this is the second)
--
-- Key choices
-- * Step 2 of conventions §1. Step 1 (20261008133453) made `signature_requests.documenso_document_id`
--   and `superseded_document_ids` nullable, wrote them no more (the envelope id is the one Documenso
--   reference) and kept them, always null, in four outputs so no return type changed. Nothing reads
--   them since: no function body, view, policy or trigger (080_core_signing_drop_document_columns checks the catalog), no edge function
--   (the RPC schemas never listed them; their fakes and the regenerated types follow here), no app
--   code.
-- * The guard refuses to run (P0001) if a row holds either value, as step 1's did: dropping data is
--   checked, not assumed.
-- * Outputs: `create_signature_request`, `get_signature_request` and
--   `list_signature_requests_to_reconcile` return a table, whose columns `create or replace` cannot
--   change: each is dropped and re-created from its latest definition (20261008073909,
--   20261008073909, 20261008151625) without the column, with the same arguments, defaults, volatility,
--   security and grants. `get_signing_request` (jsonb, 20261009124704) is replaced without the key.
--   The deployed edge functions read these outputs through Zod objects that never named the column
--   (extra keys are ignored, missing ones were never required), so the window between this migration
--   and the functions' deploy is safe either way.
-- * Dropping the columns drops what hangs on them: the unique (org_id, documenso_document_id) and
--   the two column checks. `private.signing_superseded` stays (superseded_envelope_ids uses it).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_signing_drop_document_columns', true);

do $$
begin
  if exists (select 1 from public.signature_requests r
              where r.documenso_document_id is not null
                 or pg_catalog.cardinality(r.superseded_document_ids) > 0) then
    raise exception 'core_signing_drop_document_columns: a request still holds a Documenso document id'
      using errcode = 'P0001';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- The outputs, without the column
-- -----------------------------------------------------------------------------
drop function public.create_signature_request(jsonb);
drop function public.get_signature_request(uuid);
drop function public.list_signature_requests_to_reconcile(uuid, int);

create function public.create_signature_request(p jsonb)
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
                              or (s ->> 'role') not in ('professional', 'clinic', 'client')
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

create function public.get_signature_request(p_id uuid)
returns table (
  id uuid,
  org_id uuid,
  module_key text,
  purpose text,
  subject_type text,
  subject_id uuid,
  title text,
  status text,
  envelope_id text,
  expires_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  last_error text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.org_id, r.module_key, r.purpose, r.subject_type, r.subject_id, r.title, r.status,
         r.envelope_id, r.expires_at, r.sent_at, r.completed_at, r.last_error
    from public.signature_requests r
   where r.id = p_id
$$;

create or replace function public.get_signing_request(p_org_id uuid, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'id', r.id,
           'module_key', r.module_key,
           'purpose', r.purpose,
           'title', r.title,
           'status', r.status,
           'view_permission', r.view_permission,
           'envelope_id', r.envelope_id,
           'expires_at', r.expires_at,
           'completed_event_at', r.completed_event_at,
           'last_error', r.last_error,
           'staged_source_file_id',
             case when r.status = 'draft' then
               (select f.id
                  from public.stored_files f
                 where f.org_id = r.org_id
                   and f.module_key = 'core'
                   and f.subject_type = 'signature_request'
                   and f.subject_id = r.id
                   and f.purpose = 'signing_source'
                   and f.status = 'ready'
                   and f.uploaded_by is null
                   and f.view_permission = r.view_permission
                   and f.retain_until > pg_catalog.now()
                 order by f.created_at desc, f.id desc
                 limit 1)
             end,
           'signers',
             coalesce((select pg_catalog.jsonb_agg(
                                pg_catalog.jsonb_build_object('role', s.role, 'order', s.signing_order,
                                                              'recipient_id', s.documenso_recipient_id)
                                order by s.signing_order)
                         from public.signature_request_signers s
                        where s.request_id = r.id), '[]'::jsonb))
    from public.signature_requests r
   where r.id = p_id and r.org_id = p_org_id
$$;

create function public.list_signature_requests_to_reconcile(p_org_id uuid, p_limit int default 100)
returns table (
  id uuid,
  module_key text,
  status text,
  envelope_id text,
  expires_at timestamptz,
  action text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.module_key, r.status, r.envelope_id, r.expires_at, a.action
    from public.signature_requests r
    left join public.signature_request_syncs s on s.request_id = r.id
    cross join lateral (
      select case when r.status = 'draft' then case when r.envelope_id is null then 'abandon' else 'sync' end
                  when r.completed_event_at is not null then 'sync'
                  when r.expires_at < pg_catalog.now() then 'expire'
                  else 'sync' end as action) a
   where r.org_id = p_org_id
     and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'))
     and (r.status <> 'draft'
          or coalesce(r.last_send_at, r.created_at)
             < pg_catalog.now() - case when r.envelope_id is null then interval '1 day'
                                       else interval '1 hour' end)
     and public.module_enabled_for_org(r.org_id, r.module_key)
   order by (r.status <> 'draft' and r.completed_event_at is not null) desc,
            s.attempted_at nulls first,
            a.action in ('expire', 'abandon') desc, r.expires_at nulls last, r.created_at, r.id
   limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

revoke all on function public.get_signature_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_signature_request(uuid) to authenticated;

revoke all on function
  public.create_signature_request(jsonb),
  public.list_signature_requests_to_reconcile(uuid, int)
from public, anon, authenticated;
grant execute on function
  public.create_signature_request(jsonb),
  public.list_signature_requests_to_reconcile(uuid, int)
to service_role;

-- -----------------------------------------------------------------------------
-- The columns
-- -----------------------------------------------------------------------------
alter table public.signature_requests
  drop column documenso_document_id,
  drop column superseded_document_ids;
