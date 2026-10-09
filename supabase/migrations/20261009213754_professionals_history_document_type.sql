-- Professionnels: every document row of the history names its type (gap audit, 4c follow-up).
--
-- The history page named a document's type from the rows it had loaded: an update (verified,
-- refused, a new end date) whose upload row was on an older page read « un document ». Each
-- professional_documents row now carries its type in changed_fields: `document_type_id` (the key
-- the page already reads; an insert keeps its own) and `document_type_name`. The type comes from
-- the live document, else, for a deleted one, from its audited insert or delete (they hold the
-- whole row). Additive: same signature, grants, checks and paging as
-- *_professionals_image_consent.sql; nothing else changes.

create or replace function public.list_professional_history(p_id uuid, p_before_id bigint default null, p_limit int default 50)
returns table (
  id bigint, created_at timestamptz, table_name text, record_id text, action text,
  changed_fields jsonb, actor_id uuid, actor_name text, actor_role text, source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_before bigint := coalesce(p_before_id, 9223372036854775807);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_prefix text := p_id::text;
  v_tables text[] := private.professional_history_tables();
  v_signing_ids text[];
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not private.has_permission('professionals.compensation') then
    v_tables := array(select t from pg_catalog.unnest(v_tables) t
                       where t <> all (private.professional_compensation_history_tables()));
  end if;
  select coalesce(pg_catalog.array_agg(x.id), '{}') into v_signing_ids
    from (select r.id::text as id
            from public.signature_requests r
           where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
             and r.purpose in ('professionals.service_contract', 'professionals.image_consent')
          union all
          select s.id::text
            from public.signature_requests r
            join public.signature_request_signers s on s.request_id = r.id
           where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
             and r.purpose in ('professionals.service_contract', 'professionals.image_consent')) x;

  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action,
           case
             -- A signer's row names its role (« par le professionnel », « par la clinique ») and the form.
             when a.table_name = 'signature_request_signers' and sr.role is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('role', sr.role, 'purpose', sr.purpose)
             when a.table_name = 'signature_requests' and rq.purpose is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('purpose', rq.purpose)
             when a.table_name = 'professional_submissions' and a.action <> 'insert' and sk.kind is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('kind', sk.kind)
             -- A document's row names its type (its upload row may be on an older page, or gone).
             when a.table_name = 'professional_documents' and dt.type_id is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields
                    || pg_catalog.jsonb_build_object('document_type_name', dt.type_name)
                    || case when a.changed_fields ? 'document_type_id' then '{}'::jsonb
                            else pg_catalog.jsonb_build_object('document_type_id', dt.type_id) end
             when a.table_name <> 'professional_private' then a.changed_fields
             when a.action = 'read' and pg_catalog.jsonb_typeof(a.changed_fields -> 'fields') = 'array'
               then pg_catalog.jsonb_build_object('fields', (
                      select coalesce(pg_catalog.jsonb_agg(f.value order by f.ord), '[]'::jsonb)
                        from pg_catalog.jsonb_array_elements(a.changed_fields -> 'fields') with ordinality as f(value, ord)
                       where f.value in ('"sin"'::jsonb, '"bank_account"'::jsonb)))
           end,
           a.actor_id, pr.display_name, a.actor_role, a.source
      -- Two branches, so neither scans the clinic's whole log (P4-475): the file's own rows through
      -- audit_log_org_record_prefix_idx with the cursor, and the signature requests and signers
      -- through audit_log_record_idx. They never share a row, so union all is the OR it replaces.
      from ((select x.* from public.audit_log x
              where x.org_id = v_org
                and left(x.record_id, 36) = v_prefix
                and x.id < v_before
                and x.table_name = any (v_tables)
                and not (x.table_name = 'professional_submissions' and x.action = 'update'
                         and pg_catalog.jsonb_typeof(x.changed_fields) = 'object'
                         and not exists (select 1 from pg_catalog.jsonb_object_keys(x.changed_fields) k(key)
                                          where k.key not in ('submitted_values', 'secure_link_id')))
              order by x.id desc
              limit v_limit)
            union all
            (select x.* from public.audit_log x
              where x.org_id = v_org
                and x.table_name in ('signature_requests', 'signature_request_signers')
                and x.record_id = any (v_signing_ids)
                and x.id < v_before
                and x.action = 'update'
                and pg_catalog.jsonb_typeof(x.changed_fields) = 'object'
                and x.changed_fields ? 'status'
              order by x.id desc
              limit v_limit)) a
      left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
      -- record_id is '<professional_id>:<submission id>' (the primary key's columns).
      left join lateral (select s.kind from public.professional_submissions s
                          where a.table_name = 'professional_submissions'
                            and s.professional_id = p_id and s.org_id = v_org
                            and s.id::text = pg_catalog.substr(a.record_id, 38)) sk on true
      left join lateral (select s.role, r.purpose from public.signature_request_signers s
                           join public.signature_requests r on r.id = s.request_id
                          where a.table_name = 'signature_request_signers' and s.org_id = v_org
                            and s.id::text = a.record_id) sr on true
      left join lateral (select r.purpose from public.signature_requests r
                          where a.table_name = 'signature_requests' and r.org_id = v_org
                            and r.id::text = a.record_id) rq on true
      -- record_id is '<professional_id>:<document id>'. The live row first; a deleted document's
      -- type from its audited insert or delete (the whole row, never redacted).
      left join lateral (select t.id as type_id, t.name as type_name
                           from public.document_types t
                          where a.table_name = 'professional_documents' and t.org_id = v_org
                            and t.id::text = coalesce(
                                  (select d.document_type_id::text from public.professional_documents d
                                    where d.org_id = v_org and d.professional_id = p_id
                                      and d.id::text = pg_catalog.substr(a.record_id, 38)),
                                  (select x.changed_fields ->> 'document_type_id' from public.audit_log x
                                    where x.table_name = 'professional_documents' and x.record_id = a.record_id
                                      and x.org_id = v_org and x.action in ('insert', 'delete')
                                    order by x.id desc
                                    limit 1))) dt on true
     order by a.id desc
     limit v_limit;
end;
$$;
