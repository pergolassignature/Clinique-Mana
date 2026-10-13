-- =============================================================================
-- Rendez-vous: the first appointment after a match, and the cancellations of a window
-- (published for Rapports' intake indicators)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D6: first-appointment cancellations)
-- Data:      docs/research/2026-10-08-intake-workbook.md §8.3
-- Decisions: D-44 (decisions log)
--
-- For definer callers (Rapports' `report_demandes`) after their own permission check, with the
-- org they verified; granted to no role:
--   * `private.appointments_cancelled_between(org, from, to)`: the appointments cancelled in
--     [from, to) (never a personal one), one row per client: client, professional, start,
--     cancellation, the reason's name. Rapports keeps only the pairs (client, professional) it
--     needs before asking for first appointments, so a year's report never walks every match.
--   * `private.appointments_first_after(org, client_ids[], professional_ids[], after[])`: for each
--     position of the three arrays (a client, a professional, an instant), the client's first
--     appointment with that professional starting at or after the instant, never a personal one
--     nor a slot only held by a proposal: its state, when and how late it was cancelled, the
--     reason's name. No row when there is none.
-- Additive: two functions.
-- =============================================================================

create function private.appointments_cancelled_between(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (appointment_id uuid, client_id uuid, professional_id uuid, starts_at timestamptz, cancelled_at timestamptz,
               reason_name text)
language sql
stable
set search_path = ''
as $$
  select a.id, p.client_id, a.professional_id, a.starts_at, a.cancelled_at, r.name
    from public.appointments a
    join public.appointment_participants p on p.org_id = a.org_id and p.appointment_id = a.id
    left join public.cancellation_reasons r on r.org_id = a.org_id and r.id = a.cancel_reason_id
   where a.org_id = p_org and not a.is_personal and a.state = 'cancelled'
     and a.cancelled_at >= p_from and a.cancelled_at < p_to
$$;

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

revoke all on function private.appointments_cancelled_between(uuid, timestamptz, timestamptz),
  private.appointments_first_after(uuid, uuid[], uuid[], timestamptz[])
  from public, anon, authenticated, service_role;
