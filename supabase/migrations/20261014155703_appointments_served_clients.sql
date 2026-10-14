-- =============================================================================
-- Rendez-vous: who an appointment served, published for Facturation's receipts (R-87)
-- =============================================================================
-- Decision: R-87 (a session for two prints one receipt naming both people). A receipt must
-- never name someone who was not served: an absent participant is left out.
--
-- * `private.appointment_served_client_ids(org, ids[])` → per appointment, its participants
--   not marked absent (`presence <> 'absent'`), in the order of `appointment_billing_facts`
--   (the person seen first). For definer callers after their own permission check, with the
--   org they verified; granted to no role; another clinic's ids answer nothing.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_served_clients', true);

create function private.appointment_served_client_ids(p_org uuid, p_appointment_ids uuid[])
returns table (appointment_id uuid, client_ids uuid[])
language sql
stable
set search_path = ''
as $$
  select a.id,
         coalesce((select pg_catalog.array_agg(p.client_id order by p.role = 'second', p.created_at)
                     from public.appointment_participants p
                    where p.appointment_id = a.id and p.presence <> 'absent'), '{}')
    from public.appointments a
   where a.org_id = p_org and a.id = any (coalesce(p_appointment_ids, '{}'::uuid[]))
$$;
revoke all on function private.appointment_served_client_ids(uuid, uuid[]) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
