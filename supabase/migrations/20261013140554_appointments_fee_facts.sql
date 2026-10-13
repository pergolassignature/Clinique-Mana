-- =============================================================================
-- Rendez-vous for Facturation F3: the appointments a cancellation fee may apply to (R-59)
-- =============================================================================
-- `private.appointments_fee_candidates(org, from, to)` (granted to no role): the appointments of
-- the period that may carry a fee, one row each: a late cancellation (`cancelled` and
-- `cancel_late`, from Services' policy at cancelling) or an absence (ended, still booked or
-- confirmed, every client noted absent: AP-18 keeps a no-show in its state). The professional
-- decides (Facturation). Personal appointments never.
-- =============================================================================

create function private.appointments_fee_candidates(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  appointment_id uuid, starts_at timestamptz, local_date date, professional_id uuid, service_id uuid,
  client_ids uuid[], kind text
)
language sql
stable
set search_path = ''
as $$
  select a.id, a.starts_at, (a.starts_at at time zone private.appointments_tz(a.org_id))::date, a.professional_id, a.service_id,
         (select pg_catalog.array_agg(p.client_id order by p.role = 'second', p.created_at)
            from public.appointment_participants p where p.appointment_id = a.id),
         case when a.state = 'cancelled' then 'late_cancellation' else 'no_show' end
    from public.appointments a
   where a.org_id = p_org and not a.is_personal
     and a.starts_at >= p_from and a.starts_at < p_to
     and ((a.state = 'cancelled' and a.cancel_late)
          or (a.state in ('booked', 'confirmed') and a.ends_at <= pg_catalog.now()
              and exists (select 1 from public.appointment_participants p where p.appointment_id = a.id)
              and not exists (select 1 from public.appointment_participants p
                               where p.appointment_id = a.id and p.presence <> 'absent')))
   order by a.starts_at, a.id
$$;
revoke all on function private.appointments_fee_candidates(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
