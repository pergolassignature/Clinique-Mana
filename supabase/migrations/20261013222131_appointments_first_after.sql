-- =============================================================================
-- Rendez-vous: the first appointment after a match (published for Rapports' intake indicators)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D6: first-appointment cancellations)
-- Data:      docs/research/2026-10-08-intake-workbook.md §8.3
-- Decisions: D-44 (decisions log)
--
-- `private.appointments_first_after(org, client_ids[], professional_ids[], after[])`: for each
-- position of the three arrays (a client, a professional, an instant), the client's first
-- appointment with that professional starting at or after the instant, never a personal one nor a
-- slot only held by a proposal: its state, when and how late it was cancelled, the reason's name.
-- No row when there is none. For definer callers (Rapports' `report_demandes`) after their own
-- permission check, with the org they verified. Granted to no role.
-- Additive: one function.
-- =============================================================================

create function private.appointments_first_after(p_org uuid, p_client_ids uuid[], p_professional_ids uuid[], p_after timestamptz[])
returns table (ord int, appointment_id uuid, starts_at timestamptz, state text, cancelled_at timestamptz,
               cancel_late boolean, reason_name text)
language sql
stable
set search_path = ''
as $$
  select x.ord::int, f.id, f.starts_at, f.state, f.cancelled_at, coalesce(f.cancel_late, false), f.reason_name
    from rows from (pg_catalog.unnest(p_client_ids), pg_catalog.unnest(p_professional_ids), pg_catalog.unnest(p_after))
         with ordinality as x(client_id, professional_id, after_at, ord)
   cross join lateral (
     select a.id, a.starts_at, a.state, a.cancelled_at, a.cancel_late, r.name as reason_name
       from public.appointment_participants p
       join public.appointments a on a.id = p.appointment_id
       left join public.cancellation_reasons r on r.org_id = a.org_id and r.id = a.cancel_reason_id
      where p.org_id = p_org and p.client_id = x.client_id
        and a.professional_id = x.professional_id and not a.is_personal
        and a.state in ('booked', 'confirmed', 'completed', 'cancelled')
        and a.starts_at >= x.after_at
      order by a.starts_at, a.id
      limit 1) f
$$;
revoke all on function private.appointments_first_after(uuid, uuid[], uuid[], timestamptz[])
  from public, anon, authenticated, service_role;
