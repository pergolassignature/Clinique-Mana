-- =============================================================================
-- Rendez-vous: each client's last appointment, published (A-2, parity audit L17)
-- =============================================================================
-- Asked:   coordinator, 2026-10-13 (post-cutover audit A-2: the last appointment as a published
--          fact, a column, a filter and a sort of the Clients list).
-- Needs:   *_appointments_module.sql.
--
-- `private.appointments_last_visits(org)` → (client_id, last_at): per client, the start of her
-- latest appointment that has begun (booked, confirmed or completed, not personal; legacy's
-- `last_appointment_at` rule: a no-show still counts, a cancellation never). Imported history
-- (I2) counts like any other. Computed when read (never a stored copy that goes stale when an
-- appointment's start passes). For definer callers after their own check (Clients' list asks
-- only when the user holds `appointments.view`, which a disabled Rendez-vous takes away);
-- granted to no role.
-- =============================================================================

create function private.appointments_last_visits(p_org uuid)
returns table (client_id uuid, last_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select p.client_id, max(a.starts_at)
    from public.appointment_participants p
    join public.appointments a on a.id = p.appointment_id
   where p.org_id = p_org and a.org_id = p_org
     and a.state in ('booked', 'confirmed', 'completed') and not a.is_personal
     and a.starts_at <= pg_catalog.now()
   group by p.client_id
$$;
revoke all on function private.appointments_last_visits(uuid) from public, anon, authenticated, service_role;
