-- =============================================================================
-- Rendez-vous: an appointment's « Historique » (the parity audit, part 2)
-- =============================================================================
-- Asked:   coordinator, 2026-10-13 (lane A's agenda batch, extras); decision AP-33.
-- Needs:   *_appointments_module.sql (the audited tables), *_appointments_video.sql (its meeting),
--          *_core_audit.sql and *_professionals_lifecycle.sql (audit_log and its prefix index).
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6.
--
-- * list_appointment_history(id, before, limit): the audit rows of the appointment, its
--   participants and its video meeting (record ids under the appointment's id: the prefix index),
--   newest first, 50 a page (200 at most), with the author's name. As Clients' list_client_history:
--   values the audit redacts arrive redacted (the notes, the message, the label, the video link).
--   Who: `appointments.view` for a clinic appointment, or its professional (her own, personal ones
--   included); anyone else is « Rendez-vous introuvable. » (an id says nothing).
-- * Additive: one new RPC.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_history', true);

create function public.list_appointment_history(p_id uuid, p_before_id bigint default null, p_limit int default 50)
returns table (
  id bigint, created_at timestamptz, table_name text, record_id text, action text,
  changed_fields jsonb, actor_id uuid, actor_name text, actor_role text, source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_before bigint := coalesce(p_before_id, 9223372036854775807);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not (private.has_permission('appointments.view') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_id;
  if v_appt.id is null
     or not ((private.has_permission('appointments.view') and not v_appt.is_personal)
             or (v_appt.professional_id = private.current_professional_id() and private.has_permission('appointments.self'))) then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action, a.changed_fields,
           a.actor_id, pr.display_name, a.actor_role, a.source
      from public.audit_log a
      left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
     where a.org_id = v_org
       and left(a.record_id, 36) = p_id::text
       and a.table_name in ('appointments', 'appointment_participants', 'appointment_video_meetings')
       and a.id < v_before
     order by a.id desc
     limit v_limit;
end;
$$;
revoke all on function public.list_appointment_history(uuid, bigint, int) from public, anon, authenticated, service_role;
grant execute on function public.list_appointment_history(uuid, bigint, int) to authenticated;
