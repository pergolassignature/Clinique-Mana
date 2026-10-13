-- =============================================================================
-- Clients consents (C5a): their part of a client merge and of an anonymisation, and who signs read
-- through `private.client_contacts_for` (Clients C2, CL-12 … CL-18)
-- =============================================================================
-- C2's merge and anonymisation run the handlers named in client_merge_handlers and
-- client_anonymize_handlers (data, ADR 0003). The consents' rows name the person in
-- client_consent_requests.client_id, client_consent_request_signers.signer_client_id and
-- client_consents.client_id.
-- - Merge: every row follows the kept file. One request open per client and consent: when both
--   files have one, the one whose signature has started stays and the other is cancelled (its links
--   revoked); both started → a French refusal. One consent in force per client and consent: the
--   latest signed stays in force, the other is superseded (never deleted: both signed facts and
--   their sealed PDFs stay). A pending request whose two signers became the same person is
--   cancelled (the clinic sends it again).
-- - Anonymisation: the requests still open for her, or signed by her, are cancelled and their links
--   revoked; the signers' names copied into client_consents.signed_by are removed (the role stays),
--   and the withdrawal note goes. The sealed PDF stays as the legal proof (the clinic's retention
--   policy); core's own copy of a signer's name and address (signature_request_signers) is core's.
-- - Who signs: `private.clients_consent_signers` now reads the people who manage the client's
--   appointments and forms through `private.client_contacts_for(org, client, 'appointments')`.
-- Additive: two new private functions, one replaced (same signature), two catalogue rows.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_consents_handlers', true);

-- -----------------------------------------------------------------------------
-- Who signs (R-48), through client_contacts_for
-- -----------------------------------------------------------------------------
create or replace function private.clients_consent_signers(p_org uuid, p_client_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_age int;
  v_people jsonb;
  v_needed int;
begin
  select * into v_client from public.clients c where c.org_id = p_org and c.id = p_client_id;
  if v_client.id is null then
    raise exception 'Client introuvable.' using errcode = 'P0001', hint = 'client';
  end if;
  v_age := private.clients_age_on(v_client.birthday, private.clients_org_today(p_org));
  if v_age is null or v_age >= 14 then
    return pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role', 'client', 'signer_client_id', v_client.id, 'relation_id', null));
  end if;
  -- The people who manage this client's appointments and forms, as parent or guardian, with a
  -- file still active; the main contact first.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signer_client_id', k.client_id, 'relation_id', r.id)
                                       order by k.is_main_contact desc, r.created_at, k.client_id), '[]')
    into v_people
    from private.client_contacts_for(p_org, p_client_id, 'appointments') k
    join public.clients o on o.org_id = p_org and o.id = k.client_id and o.archived_at is null
    left join public.client_relations r
      on r.org_id = p_org
     and ((r.client_a_id = p_client_id and r.client_b_id = k.client_id) or (r.client_b_id = p_client_id and r.client_a_id = k.client_id))
   where not k.is_self and k.relation_type in ('parent', 'guardian');
  v_needed := case when v_client.shared_custody then 2 else 1 end;
  if pg_catalog.jsonb_array_length(v_people) < v_needed then
    raise exception '%', case when v_client.shared_custody
      then 'Ce client a moins de 14 ans et sa garde est partagée : ses deux parents doivent signer. Ajoutez-les dans ses proches avec le droit « Gérer les rendez-vous et formulaires ».'
      else 'Ce client a moins de 14 ans : un parent ou un tuteur doit signer. Ajoutez-le dans ses proches avec le droit « Gérer les rendez-vous et formulaires ».' end
      using errcode = 'P0001', hint = 'signer_required';
  end if;
  return (select pg_catalog.jsonb_agg(p.value || pg_catalog.jsonb_build_object('role', case when p.ordinality = 1 then 'client' else 'client_2' end)
                                      order by p.ordinality)
            from pg_catalog.jsonb_array_elements(v_people) with ordinality p
           where p.ordinality <= v_needed);
end;
$$;
revoke all on function private.clients_consent_signers(uuid, uuid) from public, anon, authenticated, service_role;

-- Whether a consent request's signature has started (an envelope out, not finished).
create function private.clients_consent_in_signing(p_org uuid, p_request_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.signature_requests s
                  where s.org_id = p_org and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
                    and s.subject_id = p_request_id and s.status in ('sent', 'viewed'))
$$;
revoke all on function private.clients_consent_in_signing(uuid, uuid) from public, anon, authenticated, service_role;

-- Cancels an open request and revokes its links (merge, anonymisation).
create function private.clients_consent_cancel(p_org uuid, p_request_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.client_consent_requests r
     set state = 'cancelled', cancelled_at = pg_catalog.now(), cancelled_by = auth.uid()
   where r.org_id = p_org and r.id = p_request_id and r.state = 'pending';
  perform private.clients_consent_close_links(p_org, p_request_id, auth.uid());
end;
$$;
revoke all on function private.clients_consent_cancel(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Merge: p_old (merged) → p_new (kept)
-- -----------------------------------------------------------------------------
create function private.clients_consents_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_total int := 0;
  v_count int;
  r record;
begin
  select c.org_id into v_org from public.clients c where c.id = p_new;

  -- One open request per client and consent.
  for r in select o.id as old_id, n.id as new_id, t.name_fr,
                  private.clients_consent_in_signing(v_org, o.id) as old_signing,
                  private.clients_consent_in_signing(v_org, n.id) as new_signing
             from public.client_consent_requests o
             join public.client_consent_requests n
               on n.org_id = o.org_id and n.client_id = p_new and n.consent_key = o.consent_key and n.state = 'pending'
             join public.client_consent_types t on t.org_id = o.org_id and t.key = o.consent_key
            where o.org_id = v_org and o.client_id = p_old and o.state = 'pending' loop
    if r.old_signing and r.new_signing then
      raise exception 'Les deux dossiers ont une demande « % » en cours de signature : attendez qu''une soit signée, puis fusionnez.', r.name_fr
        using errcode = 'P0001', hint = 'consents';
    end if;
    perform private.clients_consent_cancel(v_org, case when r.old_signing then r.new_id else r.old_id end);
  end loop;

  -- One consent in force per client and consent: the latest signed stays in force.
  update public.client_consents x
     set superseded_at = pg_catalog.now()
    from public.client_consents y
   where x.org_id = v_org and y.org_id = v_org and x.consent_key = y.consent_key
     and x.client_id in (p_old, p_new) and y.client_id in (p_old, p_new) and x.client_id <> y.client_id
     and x.superseded_at is null and x.withdrawn_at is null and y.superseded_at is null and y.withdrawn_at is null
     and (x.signed_at, x.id) < (y.signed_at, y.id);

  update public.client_consents c set client_id = p_new where c.org_id = v_org and c.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.client_consent_requests q set client_id = p_new where q.org_id = v_org and q.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.client_consent_request_signers s set signer_client_id = p_new where s.org_id = v_org and s.signer_client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;

  -- A pending request whose two signers are now the same person: sent again by the clinic.
  for r in select s.request_id from public.client_consent_request_signers s
             join public.client_consent_requests q on q.id = s.request_id and q.state = 'pending'
            where s.org_id = v_org and s.signer_client_id = p_new
            group by s.request_id having count(*) > 1 loop
    perform private.clients_consent_cancel(v_org, r.request_id);
  end loop;
  return v_total;
end;
$$;
revoke all on function private.clients_consents_reassign_client(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Anonymisation
-- -----------------------------------------------------------------------------
create function private.clients_consents_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_total int := 0;
  v_count int;
  v_request uuid;
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
  return v_total;
end;
$$;
revoke all on function private.clients_consents_anonymize_client(uuid) from public, anon, authenticated, service_role;

insert into public.client_merge_handlers (module_key, function_name)
values ('clients', 'private.clients_consents_reassign_client')
on conflict do nothing;
insert into public.client_anonymize_handlers (module_key, function_name)
values ('clients', 'private.clients_consents_anonymize_client')
on conflict do nothing;
