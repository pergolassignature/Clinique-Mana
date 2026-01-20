-- Migration: availability_audit_triggers
-- Module: availability
-- Gate: 3 - Audit Logging
-- Created: 2026-01-21

-- =============================================================================
-- AUDIT TRIGGER: AVAILABILITY_BLOCKS
-- Logs availability block creation, updates, deletions
-- =============================================================================

create or replace function public.audit_availability_block_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_action text;
  v_professional_name text;
begin
  -- Determine actor (current user's profile id, if exists)
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  -- Get professional name for context
  select p.display_name into v_professional_name
  from public.professionals pr
  join public.profiles p on pr.profile_id = p.id
  where pr.id = coalesce(new.professional_id, old.professional_id);

  if tg_op = 'INSERT' then
    insert into public.appointment_audit_log
      (entity_type, entity_id, professional_id, actor_id, action, old_value, new_value, context)
    values (
      'availability_block',
      new.id,
      new.professional_id,
      v_actor_id,
      'availability_created',
      null,
      jsonb_build_object(
        'type', new.type,
        'label', new.label,
        'start_time', new.start_time,
        'end_time', new.end_time,
        'visible_to_clients', new.visible_to_clients,
        'allowed_service_ids', new.allowed_service_ids
      ),
      jsonb_build_object('professional_name', v_professional_name)
    );
    return new;

  elsif tg_op = 'UPDATE' then
    -- Determine specific action based on what changed
    if old.type is distinct from new.type then
      v_action := 'availability_type_changed';
    else
      v_action := 'availability_updated';
    end if;

    insert into public.appointment_audit_log
      (entity_type, entity_id, professional_id, actor_id, action, old_value, new_value, context)
    values (
      'availability_block',
      new.id,
      new.professional_id,
      v_actor_id,
      v_action,
      jsonb_build_object(
        'type', old.type,
        'label', old.label,
        'start_time', old.start_time,
        'end_time', old.end_time,
        'visible_to_clients', old.visible_to_clients,
        'allowed_service_ids', old.allowed_service_ids
      ),
      jsonb_build_object(
        'type', new.type,
        'label', new.label,
        'start_time', new.start_time,
        'end_time', new.end_time,
        'visible_to_clients', new.visible_to_clients,
        'allowed_service_ids', new.allowed_service_ids
      ),
      jsonb_build_object(
        'professional_name', v_professional_name,
        'changes', case
          when old.type is distinct from new.type then 'type'
          when old.start_time is distinct from new.start_time or old.end_time is distinct from new.end_time then 'time'
          else 'other'
        end
      )
    );
    return new;

  elsif tg_op = 'DELETE' then
    insert into public.appointment_audit_log
      (entity_type, entity_id, professional_id, actor_id, action, old_value, new_value, context)
    values (
      'availability_block',
      old.id,
      old.professional_id,
      v_actor_id,
      'availability_deleted',
      jsonb_build_object(
        'type', old.type,
        'label', old.label,
        'start_time', old.start_time,
        'end_time', old.end_time,
        'visible_to_clients', old.visible_to_clients
      ),
      null,
      jsonb_build_object('professional_name', v_professional_name)
    );
    return old;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger availability_blocks_audit_trigger
  after insert or update or delete on public.availability_blocks
  for each row
  execute function public.audit_availability_block_changes();

-- =============================================================================
-- AUDIT TRIGGER: APPOINTMENTS
-- Logs appointment lifecycle events: create, confirm, reschedule, cancel, etc.
-- =============================================================================

create or replace function public.audit_appointment_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_action text;
  v_context jsonb;
  v_service_name text;
  v_professional_name text;
begin
  -- Determine actor (current user's profile id, if exists)
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  -- Get service name
  select name_fr into v_service_name
  from public.services
  where id = coalesce(new.service_id, old.service_id);

  -- Get professional name
  select p.display_name into v_professional_name
  from public.professionals pr
  join public.profiles p on pr.profile_id = p.id
  where pr.id = coalesce(new.professional_id, old.professional_id);

  -- Build base context
  v_context := jsonb_build_object(
    'service_name', v_service_name,
    'professional_name', v_professional_name,
    'time_slot', to_char(coalesce(new.start_time, old.start_time), 'YYYY-MM-DD HH24:MI')
  );

  if tg_op = 'INSERT' then
    insert into public.appointment_audit_log
      (entity_type, entity_id, professional_id, actor_id, action, old_value, new_value, context)
    values (
      'appointment',
      new.id,
      new.professional_id,
      v_actor_id,
      'appointment_created',
      null,
      jsonb_build_object(
        'status', new.status,
        'service_id', new.service_id,
        'start_time', new.start_time,
        'duration_minutes', new.duration_minutes,
        'mode', new.mode
      ),
      v_context
    );
    return new;

  elsif tg_op = 'UPDATE' then
    -- Determine specific action based on what changed
    if old.status is distinct from new.status then
      v_action := case new.status
        when 'confirmed' then 'appointment_confirmed'
        when 'cancelled' then 'appointment_cancelled'
        when 'completed' then 'appointment_completed'
        when 'no_show' then 'appointment_no_show'
        when 'draft' then
          case when old.status = 'cancelled' then 'appointment_restored'
          else 'appointment_updated'
          end
        else 'appointment_updated'
      end;
    elsif old.start_time is distinct from new.start_time then
      v_action := 'appointment_rescheduled';
    elsif old.notes_internal is distinct from new.notes_internal then
      v_action := 'appointment_notes_updated';
    else
      v_action := 'appointment_updated';
    end if;

    -- For cancellations, include reason in context
    if new.status = 'cancelled' then
      v_context := v_context || jsonb_build_object(
        'cancellation_reason', new.cancellation_reason,
        'cancellation_fee_applied', new.cancellation_fee_applied,
        'cancellation_fee_percent', new.cancellation_fee_percent
      );
    end if;

    -- For reschedules, include old time
    if v_action = 'appointment_rescheduled' then
      v_context := v_context || jsonb_build_object(
        'old_time_slot', to_char(old.start_time, 'YYYY-MM-DD HH24:MI'),
        'new_time_slot', to_char(new.start_time, 'YYYY-MM-DD HH24:MI')
      );
    end if;

    insert into public.appointment_audit_log
      (entity_type, entity_id, professional_id, actor_id, action, old_value, new_value, context)
    values (
      'appointment',
      new.id,
      new.professional_id,
      v_actor_id,
      v_action,
      jsonb_build_object(
        'status', old.status,
        'start_time', old.start_time,
        'duration_minutes', old.duration_minutes,
        'mode', old.mode,
        'notes_internal', old.notes_internal,
        'cancelled_at', old.cancelled_at
      ),
      jsonb_build_object(
        'status', new.status,
        'start_time', new.start_time,
        'duration_minutes', new.duration_minutes,
        'mode', new.mode,
        'notes_internal', new.notes_internal,
        'cancelled_at', new.cancelled_at,
        'cancellation_reason', new.cancellation_reason,
        'completed_at', new.completed_at
      ),
      v_context
    );
    return new;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger appointments_audit_trigger
  after insert or update on public.appointments
  for each row
  execute function public.audit_appointment_changes();

-- =============================================================================
-- AUDIT TRIGGER: APPOINTMENT_CLIENTS
-- Logs client additions and removals from appointments
-- =============================================================================

create or replace function public.audit_appointment_client_changes()
returns trigger
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_professional_id uuid;
  v_context jsonb;
  v_service_name text;
  v_appointment_time timestamptz;
begin
  -- Determine actor (current user's profile id, if exists)
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  -- Get appointment details
  select a.professional_id, a.start_time, s.name_fr
  into v_professional_id, v_appointment_time, v_service_name
  from public.appointments a
  join public.services s on a.service_id = s.id
  where a.id = coalesce(new.appointment_id, old.appointment_id);

  -- Build context
  v_context := jsonb_build_object(
    'service_name', v_service_name,
    'time_slot', to_char(v_appointment_time, 'YYYY-MM-DD HH24:MI')
  );

  if tg_op = 'INSERT' then
    insert into public.appointment_audit_log
      (entity_type, entity_id, professional_id, actor_id, action, old_value, new_value, context)
    values (
      'appointment',
      new.appointment_id,
      v_professional_id,
      v_actor_id,
      'appointment_client_added',
      null,
      jsonb_build_object(
        'client_id', new.client_id,
        'role', new.role
      ),
      v_context || jsonb_build_object('client_id', new.client_id, 'role', new.role)
    );
    return new;

  elsif tg_op = 'DELETE' then
    insert into public.appointment_audit_log
      (entity_type, entity_id, professional_id, actor_id, action, old_value, new_value, context)
    values (
      'appointment',
      old.appointment_id,
      v_professional_id,
      v_actor_id,
      'appointment_client_removed',
      jsonb_build_object(
        'client_id', old.client_id,
        'role', old.role
      ),
      null,
      v_context || jsonb_build_object('client_id', old.client_id, 'role', old.role)
    );
    return old;

  elsif tg_op = 'UPDATE' then
    -- Track attendance updates
    if old.attended is distinct from new.attended then
      insert into public.appointment_audit_log
        (entity_type, entity_id, professional_id, actor_id, action, old_value, new_value, context)
      values (
        'appointment',
        new.appointment_id,
        v_professional_id,
        v_actor_id,
        'appointment_attendance_updated',
        jsonb_build_object('client_id', old.client_id, 'attended', old.attended),
        jsonb_build_object('client_id', new.client_id, 'attended', new.attended),
        v_context || jsonb_build_object('client_id', new.client_id)
      );
    end if;
    return new;
  end if;

  return null;
end;
$$ language plpgsql;

create trigger appointment_clients_audit_trigger
  after insert or update or delete on public.appointment_clients
  for each row
  execute function public.audit_appointment_client_changes();

-- =============================================================================
-- HELPER FUNCTION: Log custom appointment audit events
-- For use in application code when triggers aren't sufficient
-- =============================================================================

create or replace function public.log_appointment_audit(
  p_entity_type text,
  p_entity_id uuid,
  p_professional_id uuid,
  p_action text,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_context jsonb default null
)
returns uuid
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_audit_id uuid;
begin
  -- Determine actor
  select id into v_actor_id
  from public.profiles
  where user_id = auth.uid();

  insert into public.appointment_audit_log
    (entity_type, entity_id, professional_id, actor_id, action, old_value, new_value, context)
  values
    (p_entity_type, p_entity_id, p_professional_id, v_actor_id, p_action, p_old_value, p_new_value, p_context)
  returning id into v_audit_id;

  return v_audit_id;
end;
$$ language plpgsql;

comment on function public.log_appointment_audit is 'Manually log an appointment/availability audit event from application code';

-- Grant execute to authenticated users
grant execute on function public.log_appointment_audit to authenticated;
