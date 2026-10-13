-- =============================================================================
-- Rendez-vous: the facts Facturation needs to invoice appointments (F1), published as helpers
-- =============================================================================
-- For definer callers after their own permission check, with the org they verified; granted to
-- no role. Facturation never reads `appointments` itself (CLAUDE.md §5).
--   private.appointment_billing_facts(org, ids[]) → per appointment: the professional, the
--     service, the start and its clinic date, the state, personal or not, and its clients in
--     order (the person seen first).
--   private.client_billable_appointments(org, client, since) → the client's appointments that
--     may be invoiced: booked, confirmed or completed, not personal, since a date, newest first
--     (200 at most). Facturation leaves out those already invoiced.
-- =============================================================================

create function private.appointment_billing_facts(p_org uuid, p_appointment_ids uuid[])
returns table (
  appointment_id uuid, professional_id uuid, service_id uuid, starts_at timestamptz, ends_at timestamptz, local_date date,
  state text, is_personal boolean, client_ids uuid[]
)
language sql
stable
set search_path = ''
as $$
  select a.id, a.professional_id, a.service_id, a.starts_at, a.ends_at,
         (a.starts_at at time zone private.appointments_tz(a.org_id))::date,
         a.state, a.is_personal,
         coalesce((select pg_catalog.array_agg(p.client_id order by p.role = 'second', p.created_at)
                     from public.appointment_participants p where p.appointment_id = a.id), '{}')
    from public.appointments a
   where a.org_id = p_org and a.id = any (coalesce(p_appointment_ids, '{}'::uuid[]))
$$;

create function private.client_billable_appointments(p_org uuid, p_client_id uuid, p_since date)
returns table (
  appointment_id uuid, professional_id uuid, service_id uuid, starts_at timestamptz, local_date date, state text, client_ids uuid[]
)
language sql
stable
set search_path = ''
as $$
  select f.appointment_id, f.professional_id, f.service_id, f.starts_at, f.local_date, f.state, f.client_ids
    from private.appointment_billing_facts(
           p_org,
           (select coalesce(pg_catalog.array_agg(p.appointment_id), '{}')
              from public.appointment_participants p
              join public.appointments a on a.id = p.appointment_id
             where p.org_id = p_org and p.client_id = p_client_id
               and a.state in ('booked', 'confirmed', 'completed') and not a.is_personal
               and (p_since is null or a.starts_at >= (p_since::timestamp at time zone private.appointments_tz(p_org))))) f
   order by f.starts_at desc
   limit 200
$$;

revoke all on function private.appointment_billing_facts(uuid, uuid[]), private.client_billable_appointments(uuid, uuid, date)
  from public, anon, authenticated, service_role;
