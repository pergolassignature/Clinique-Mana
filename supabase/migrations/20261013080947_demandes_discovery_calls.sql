-- =============================================================================
-- Demandes: the discovery calls (plan §10 D3b, first part)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D3b); roadmap §2.3 (« Remplace des
--            contournements »: the discovery calls leave the fake « conseillère » appointments)
-- Decisions: D-20 (this batch)
--
-- A discovery call is a dated task of its request (D1, kind `discovery_call`), made by the public
-- booking page (D3c) or by a counselor (« Ajouter une tâche »). This batch gives the counselors
-- their day of calls instead of the shared « conseillère » agenda:
-- - `list_discovery_calls(p_from, p_to, p_overdue)` (`demandes.view`): the calls of a period, and the
--   open ones already due, with the person, the number to call, how it was booked, who calls.
-- - `reschedule_demande_task(p_demande_id, p_task_id, p_due_at)` and
--   `assign_demande_task(p_demande_id, p_task_id, p_assigned_to)` (`demandes.manage`): an open task
--   moved, or given to someone (or to nobody: whoever is free).
-- Nothing is sent to anyone (P3-40: no client-facing path here). Additive: three functions.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_discovery_calls', true);

-- The calls due in [p_from, p_to) — and, with p_overdue, the open ones due before p_from — in time
-- order: the request, the person (the file's name, else the contact), the number to call (the
-- file's mobile, else the request's), whether it was booked on the page, who calls, done or not.
create function public.list_discovery_calls(p_from timestamptz, p_to timestamptz, p_overdue boolean default false)
returns table (
  task_id uuid, demande_id uuid, reference text, person_name text, phone_e164 text, language text,
  booked_online boolean, is_urgent boolean, demande_state text, due_at timestamptz, state text, outcome text,
  assigned_to uuid, assigned_name text, done_at timestamptz, done_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  perform private.demandes_require('demandes.view');
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '32 days' then
    raise exception 'Invalid period' using errcode = '22023';
  end if;
  return query
    select t.id, d.id, d.reference,
           coalesce(c.display_name, d.contact_name),
           coalesce(c.mobile_e164, d.contact_phone_e164),
           d.language, d.channel = 'booking_page', d.is_urgent, d.state,
           t.due_at, t.state, t.outcome, t.assigned_to, a.display_name, t.done_at, b.display_name
      from public.demande_tasks t
      join public.demandes d on d.id = t.demande_id and d.org_id = t.org_id
      left join public.clients_directory c on c.id = d.client_id and c.org_id = d.org_id
      left join public.profiles a on a.user_id = t.assigned_to and a.org_id = t.org_id
      left join public.profiles b on b.user_id = t.done_by and b.org_id = t.org_id
     where t.org_id = v_org and t.kind = 'discovery_call' and t.state <> 'cancelled'
       and ((t.due_at >= p_from and t.due_at < p_to)
            or (coalesce(p_overdue, false) and t.state = 'open' and t.due_at < p_from))
     order by t.due_at, d.reference
     limit 500;
end;
$$;
revoke all on function public.list_discovery_calls(timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.list_discovery_calls(timestamptz, timestamptz, boolean) to authenticated;

-- An open task moved (not into the past). A call booked on the page keeps its cancel link, which
-- expires at the time first booked.
create function public.reschedule_demande_task(p_demande_id uuid, p_task_id uuid, p_due_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_demande_id);
  if v_row.state = 'closed' then
    raise exception 'Cette demande est fermée : rouvrez-la pour changer ses tâches.' using errcode = 'P0001';
  end if;
  if p_due_at is null or p_due_at <= pg_catalog.now() - interval '5 minutes' then
    raise exception 'Choisissez un moment à venir.' using errcode = 'P0001', hint = 'due_at';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:reschedule_demande_task', true);
  update public.demande_tasks t set due_at = p_due_at
   where t.demande_id = v_row.id and t.org_id = v_row.org_id and t.id = p_task_id and t.state = 'open';
  if not found then
    raise exception 'Cette tâche n''est plus ouverte.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.reschedule_demande_task(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reschedule_demande_task(uuid, uuid, timestamptz) to authenticated;

-- Who does an open task: someone who works the requests, or nobody (whoever is free).
create function public.assign_demande_task(p_demande_id uuid, p_task_id uuid, p_assigned_to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_demande_id);
  perform private.demandes_assert_worker(v_row.org_id, p_assigned_to);
  perform pg_catalog.set_config('app.audit_source', 'rpc:assign_demande_task', true);
  update public.demande_tasks t set assigned_to = p_assigned_to
   where t.demande_id = v_row.id and t.org_id = v_row.org_id and t.id = p_task_id and t.state = 'open';
  if not found then
    raise exception 'Cette tâche n''est plus ouverte.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.assign_demande_task(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_demande_task(uuid, uuid, uuid) to authenticated;
