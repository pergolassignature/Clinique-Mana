-- =============================================================================
-- Rendez-vous: the facts Rapports reads for « Annulations et absences » and « Clients à relancer »
-- (RP1), published as private helpers
-- =============================================================================
-- Rapports (plan §12, R-27) lists the cancellations by reason and the absences, and the clients
-- to call back (a cancellation or an absence with nothing booked after it), like GOrendezvous's
-- « Annulations » and « Clients à relancer », without reading this module's tables (CLAUDE.md
-- §5). For definer callers after their own permission check (`reports.view`), with the org they
-- verified; granted to no role. Signatures stable.
--
-- * `appointment_absence_facts(org, from, to)`: one row per client of the appointments starting
--   in [from, to) that were cancelled (`kind` `cancelled`, with the reason, late or not, kept on
--   the schedule or not) or where the client was absent (`kind` `absent`: an appointment not
--   cancelled whose presence is « Absent »). Never a personal appointment nor a held one (a
--   proposal never accepted is not an appointment, AP-15). `later_starts_at`: the client's next
--   appointment after this one that is booked, confirmed or completed (null: none, to call back).
--   Never the cancellation's details (free text).
-- * `cancellation_reason_names(org)`: the clinic's reasons (the filter).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_report_facts', true);

create function private.appointment_absence_facts(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  appointment_id uuid, starts_at timestamptz, professional_id uuid, service_id uuid, client_id uuid, role text,
  kind text, reason_id uuid, reason_name text, cancel_late boolean, cancelled_at timestamptz, kept_on_schedule boolean,
  later_starts_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select a.id, a.starts_at, a.professional_id, a.service_id, p.client_id, p.role,
         case when a.state = 'cancelled' then 'cancelled' else 'absent' end,
         case when a.state = 'cancelled' then a.cancel_reason_id end,
         case when a.state = 'cancelled' then r.name end,
         case when a.state = 'cancelled' then coalesce(a.cancel_late, false) else false end,
         a.cancelled_at,
         a.kept_on_schedule,
         (select pg_catalog.min(b.starts_at)
            from public.appointment_participants q
            join public.appointments b on b.id = q.appointment_id
           where q.org_id = p_org and q.client_id = p.client_id and b.id <> a.id
             and b.starts_at > a.starts_at and b.state in ('booked', 'confirmed', 'completed'))
    from public.appointments a
    join public.appointment_participants p on p.appointment_id = a.id
    left join public.cancellation_reasons r on r.org_id = a.org_id and r.id = a.cancel_reason_id
   where a.org_id = p_org and not a.is_personal
     and a.starts_at >= p_from and a.starts_at < p_to
     and (a.state = 'cancelled' or (a.state in ('booked', 'confirmed', 'completed') and p.presence = 'absent'))
   order by a.starts_at, a.id, p.role
$$;

create function private.cancellation_reason_names(p_org uuid)
returns table (reason_id uuid, name text, sort_order int)
language sql
stable
set search_path = ''
as $$
  select r.id, r.name, r.sort_order::int
    from public.cancellation_reasons r
   where r.org_id = p_org
   order by r.sort_order, r.name
$$;

revoke all on function private.appointment_absence_facts(uuid, timestamptz, timestamptz), private.cancellation_reason_names(uuid)
  from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
