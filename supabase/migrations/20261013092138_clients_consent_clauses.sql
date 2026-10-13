-- =============================================================================
-- Clients: the « Oui / Non » clauses of each consent text, edited and versioned with it (CC-13)
-- =============================================================================
-- Decisions: CC-13 (decisions log), R-46 (the answers on our page), R-49 (who signs again)
--
-- Until now a consent's clauses lived on its type (`client_consent_types.clauses`, both languages,
-- seeded « Clause provisoire ») with no screen to change them. They now belong to each version of
-- each consent text (a template per consent and language): `client_consent_version_clauses`, one
-- row per version, [{key, kind, text}] in the version's language.
-- * A version without a row reads its template's published version's clauses, else the type's
--   (in its language): nothing changes until the clinic edits.
-- * `set_client_consent_clauses(version, clauses)` (clients.manage) writes a **draft** version's
--   clauses: add, reword, reorder, `agree` (« Accord requis ») or `yes_no`; at most 20, keys kept for
--   reworded clauses. A published or archived version's clauses never change.
-- * `publish_client_consent_version` (same signature) freezes the draft's clauses before core
--   publishes it.
-- * A request takes its version's clauses when it is made, and again when publication moves an
--   unanswered request to the new version (a trigger on the module's own requests table, so the
--   send path is unchanged); answered requests keep theirs. The request format stays
--   {key, kind, text_fr, text_en} (the text in the version's language in both).
-- Additive: one table, three functions, one trigger, one function replaced (same signature).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_consent_clauses', true);

-- A version's clauses: [{key, kind, text}], at most 20, keys unique, text 1–1000 tidy characters.
create function private.client_consent_version_clauses_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p) = 'array'
     and pg_catalog.jsonb_array_length(p) <= 20
     and not exists (
           select 1 from pg_catalog.jsonb_array_elements(p) c
            where pg_catalog.jsonb_typeof(c) <> 'object'
               or coalesce(c ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$'
               or coalesce(c ->> 'kind', '') not in ('agree', 'yes_no')
               or pg_catalog.length(pg_catalog.btrim(coalesce(c ->> 'text', ''))) not between 1 and 1000
               or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(c)) <> 3)
     and (select pg_catalog.count(distinct c ->> 'key') = pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p) c)
$$;
revoke all on function private.client_consent_version_clauses_valid(jsonb) from public, anon, authenticated, service_role;

create table public.client_consent_version_clauses (
  version_id uuid primary key,
  org_id uuid not null,
  clauses jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint client_consent_version_clauses_version_fkey foreign key (version_id, org_id)
    references public.document_template_versions (id, org_id) on delete cascade,
  constraint client_consent_version_clauses_check check (private.client_consent_version_clauses_valid(clauses))
);
create index client_consent_version_clauses_version_org_idx on public.client_consent_version_clauses (version_id, org_id);
create index client_consent_version_clauses_org_idx on public.client_consent_version_clauses (org_id);
create index client_consent_version_clauses_updated_by_idx on public.client_consent_version_clauses (updated_by);
create trigger client_consent_version_clauses_set_updated_at before update on public.client_consent_version_clauses
  for each row execute function private.set_updated_at();
create trigger client_consent_version_clauses_audit after insert or update or delete on public.client_consent_version_clauses
  for each row execute function private.audit_trigger();

alter table public.client_consent_version_clauses enable row level security;
revoke all on public.client_consent_version_clauses from anon, authenticated;
grant select on public.client_consent_version_clauses to authenticated;
create policy client_consent_version_clauses_select on public.client_consent_version_clauses
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));

-- The consent and language of a version of a client consent text, or nothing.
create function private.client_consent_version_info(p_org uuid, p_version uuid)
returns table (template_id uuid, consent_key text, language text, status text)
language sql
stable
set search_path = ''
as $$
  select t.id,
         pg_catalog.regexp_replace(t.key, '^clients\.consent_(.+)_(fr|en)$', '\1'),
         pg_catalog.right(t.key, 2),
         v.status
    from public.document_template_versions v
    join public.document_templates t on t.id = v.template_id and t.org_id = v.org_id
   where v.org_id = p_org and v.id = p_version and t.module_key = 'clients'
     and t.key ~ '^clients\.consent_[a-z0-9_]+_(fr|en)$'
$$;
revoke all on function private.client_consent_version_info(uuid, uuid) from public, anon, authenticated, service_role;

-- A version's clauses [{key, kind, text}]: its own row, else its template's published version's,
-- else the type's in the version's language. Null for a version that is not a consent text's.
create function private.client_consent_clauses_of(p_org uuid, p_version uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select c.clauses from public.client_consent_version_clauses c where c.version_id = p_version and c.org_id = p_org),
    (select c.clauses
       from public.document_template_versions pv
       join public.client_consent_version_clauses c on c.version_id = pv.id and c.org_id = pv.org_id
      where pv.org_id = p_org and pv.template_id = i.template_id and pv.status = 'published'),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'key', e.value ->> 'key', 'kind', e.value ->> 'kind',
              'text', case when i.language = 'en' then e.value ->> 'text_en' else e.value ->> 'text_fr' end)
              order by e.ordinality), '[]')
       from public.client_consent_types ty
       cross join lateral pg_catalog.jsonb_array_elements(ty.clauses) with ordinality e
      where ty.org_id = p_org and ty.key = i.consent_key))
    from private.client_consent_version_info(p_org, p_version) i
$$;
revoke all on function private.client_consent_clauses_of(uuid, uuid) from public, anon, authenticated, service_role;

-- A version's clauses in the requests' format {key, kind, text_fr, text_en}.
create function private.client_consent_request_clauses(p_org uuid, p_version uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  -- Null only for a version that is not a consent text's; no clause at all is `[]`.
  select case when c is null then null
              else coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                      'key', e.value ->> 'key', 'kind', e.value ->> 'kind',
                                      'text_fr', e.value ->> 'text', 'text_en', e.value ->> 'text') order by e.ordinality)
                               from pg_catalog.jsonb_array_elements(c) with ordinality e), '[]') end
    from (select private.client_consent_clauses_of(p_org, p_version) as c) x
$$;
revoke all on function private.client_consent_request_clauses(uuid, uuid) from public, anon, authenticated, service_role;

-- Freezes a version's clauses as they read now (publication).
create function private.client_consent_freeze_clauses(p_org uuid, p_version uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.client_consent_version_clauses (version_id, org_id, clauses, updated_by)
  select p_version, p_org, c, auth.uid()
    from private.client_consent_clauses_of(p_org, p_version) c
   where c is not null
  on conflict (version_id) do nothing
$$;
revoke all on function private.client_consent_freeze_clauses(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Client RPCs
-- -----------------------------------------------------------------------------
-- A consent text version's clauses and whether the caller may change them (a draft, clients.manage).
create function public.get_client_consent_clauses(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_status text;
begin
  if not private.has_permission('clients.view') then
    raise exception 'Permission refusée : clients.view' using errcode = '42501';
  end if;
  select i.status into v_status from private.client_consent_version_info(v_org, p_version_id) i;
  if v_status is null then
    raise exception 'Ce texte n''est pas un consentement de client.' using errcode = 'P0001', hint = 'version';
  end if;
  return pg_catalog.jsonb_build_object(
    'clauses', private.client_consent_clauses_of(v_org, p_version_id),
    'editable', v_status = 'draft' and private.has_permission('clients.manage'));
end;
$$;
revoke all on function public.get_client_consent_clauses(uuid) from public, anon;
grant execute on function public.get_client_consent_clauses(uuid) to authenticated;

-- Writes a draft version's clauses (CC-13): [{key, kind, text}], texts trimmed; a published or
-- archived version is refused in French.
create function public.set_client_consent_clauses(p_version_id uuid, p_clauses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_status text;
  v_clauses jsonb;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  select i.status into v_status from private.client_consent_version_info(v_org, p_version_id) i;
  if v_status is null then
    raise exception 'Ce texte n''est pas un consentement de client.' using errcode = 'P0001', hint = 'version';
  end if;
  if v_status <> 'draft' then
    raise exception 'Les clauses d''une version publiée ne changent plus : créez une nouvelle version du texte.'
      using errcode = 'P0001', hint = 'version';
  end if;
  if p_clauses is null or pg_catalog.jsonb_typeof(p_clauses) <> 'array' then
    raise exception 'Invalid clauses' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_clauses) > 20 then
    raise exception 'Un consentement a au plus 20 clauses.' using errcode = 'P0001', hint = 'clauses';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'key', e.value ->> 'key', 'kind', e.value ->> 'kind',
           'text', pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(e.value ->> 'text', '')), '\s+', ' ', 'g'))
           order by e.ordinality), '[]')
    into v_clauses
    from pg_catalog.jsonb_array_elements(p_clauses) with ordinality e;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_clauses) c where c ->> 'text' = '') then
    raise exception 'Chaque clause a un texte.' using errcode = 'P0001', hint = 'clauses';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_clauses) c where pg_catalog.length(c ->> 'text') > 1000) then
    raise exception 'Une clause a au plus 1 000 caractères.' using errcode = 'P0001', hint = 'clauses';
  end if;
  if not private.client_consent_version_clauses_valid(v_clauses) then
    raise exception 'Invalid clauses' using errcode = '22023';
  end if;
  insert into public.client_consent_version_clauses as c (version_id, org_id, clauses, updated_by)
  values (p_version_id, v_org, v_clauses, auth.uid())
  on conflict (version_id) do update
    set clauses = excluded.clauses, updated_by = excluded.updated_by
    where c.clauses is distinct from excluded.clauses;
  return v_clauses;
end;
$$;
revoke all on function public.set_client_consent_clauses(uuid, jsonb) from public, anon;
grant execute on function public.set_client_consent_clauses(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Requests take their version's clauses (made, or moved unanswered to a new version)
-- -----------------------------------------------------------------------------
create function private.client_consent_requests_clauses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clauses jsonb;
begin
  if tg_op = 'UPDATE' and (new.template_version_id is not distinct from old.template_version_id or new.answers is not null) then
    return new;
  end if;
  v_clauses := private.client_consent_request_clauses(new.org_id, new.template_version_id);
  if v_clauses is not null then
    new.clauses := v_clauses;
  end if;
  return new;
end;
$$;
revoke all on function private.client_consent_requests_clauses() from public, anon, authenticated, service_role;
create trigger client_consent_requests_clauses
  before insert or update of template_version_id on public.client_consent_requests
  for each row execute function private.client_consent_requests_clauses();

-- The published versions' clauses frozen now, as they read today (the types').
insert into public.client_consent_version_clauses (version_id, org_id, clauses)
select v.id, v.org_id, private.client_consent_clauses_of(v.org_id, v.id)
  from public.document_template_versions v
  join public.document_templates t on t.id = v.template_id
 where t.module_key = 'clients' and t.key ~ '^clients\.consent_[a-z0-9_]+_(fr|en)$' and v.status = 'published'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Publication freezes the clauses (same signature as *_clients_consents.sql)
-- -----------------------------------------------------------------------------
create or replace function public.publish_client_consent_version(p_version_id uuid, p_population text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_key text;
  v_consent text;
  v_lang text;
  v_count int := 0;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  if p_population is null or p_population not in ('new_clients', 'all_active') then
    raise exception 'Invalid population' using errcode = '22023';
  end if;
  select t.key into v_key
    from public.document_template_versions v
    join public.document_templates t on t.id = v.template_id
   where v.id = p_version_id and v.org_id = v_org and t.module_key = 'clients';
  if v_key is null or v_key !~ '^clients\.consent_[a-z0-9_]+_(fr|en)$' then
    raise exception 'Ce texte n''est pas un consentement de client.' using errcode = 'P0001', hint = 'template';
  end if;
  v_lang := pg_catalog.right(v_key, 2);
  v_consent := pg_catalog.regexp_replace(v_key, '^clients\.consent_(.+)_(fr|en)$', '\1');
  -- Its clauses are frozen with it (CC-13): a published version's clauses never change.
  perform private.client_consent_freeze_clauses(v_org, p_version_id);
  perform public.publish_template_version(p_version_id);
  -- The requests out on the previous version and not yet in signing now print this one (the
  -- previous version is archived: no signature request could be made from it).
  update public.client_consent_requests r
     set template_version_id = p_version_id
   where r.org_id = v_org and r.consent_key = v_consent and r.language = v_lang and r.state = 'pending'
     and r.template_version_id <> p_version_id
     and not exists (select 1 from public.signature_requests s
                      where s.org_id = r.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
                        and s.subject_id = r.id and s.status in ('draft', 'sent', 'viewed'));
  if p_population = 'all_active' then
    update public.client_consents c
       set resign_requested_at = pg_catalog.now()
     where c.org_id = v_org and c.consent_key = v_consent and c.language = v_lang
       and c.superseded_at is null and c.withdrawn_at is null
       and c.template_version_id is distinct from p_version_id;
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;
