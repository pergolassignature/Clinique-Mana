-- =============================================================================
-- Demandes: its part of a client merge and of an anonymisation (Clients C2, CL-16, CL-17)
-- =============================================================================
-- Clients' merge and anonymisation run the handlers other modules name in client_merge_handlers
-- and client_anonymize_handlers (data, ADR 0003). Demandes holds the person's file in
-- demandes.client_id, demande_participants.client_id and waitlist_entries.client_id; a merge
-- moves them to the kept file. An anonymisation blanks Demandes' own copies of the person: the
-- contact typed before the file existed (contact_name / _email / _phone_e164) on her requests, and a
-- participant's display_name and birthday. No unique key on these client_id columns, so nothing
-- can collide in a merge.
-- =============================================================================

create function private.demandes_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
begin
  update public.demandes d set client_id = p_new where d.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.demande_participants p set client_id = p_new where p.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.waitlist_entries w set client_id = p_new where w.client_id = p_old;
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  return v_total;
end;
$$;
revoke all on function private.demandes_reassign_client(uuid, uuid) from public, anon, authenticated, service_role;

create function private.demandes_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_total int := 0;
  v_count int;
begin
  update public.demandes d set contact_name = null, contact_email = null, contact_phone_e164 = null
   where d.client_id = p_id and (d.contact_name is not null or d.contact_email is not null or d.contact_phone_e164 is not null);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  update public.demande_participants p set display_name = null, birthday = null
   where p.client_id = p_id and (p.display_name is not null or p.birthday is not null);
  get diagnostics v_count = row_count; v_total := v_total + v_count;
  return v_total;
end;
$$;
revoke all on function private.demandes_anonymize_client(uuid) from public, anon, authenticated, service_role;

insert into public.client_merge_handlers (module_key, function_name)
values ('demandes', 'private.demandes_reassign_client')
on conflict do nothing;
insert into public.client_anonymize_handlers (module_key, function_name)
values ('demandes', 'private.demandes_anonymize_client')
on conflict do nothing;
