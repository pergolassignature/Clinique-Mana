-- Migration: appointment_status_simplification
-- Module: availability
-- Gate: Simplifies appointment statuses to: created, confirmed, completed, cancelled
-- Created: 2026-01-22
--
-- Changes:
-- 1. Rename 'draft' status to 'created'
-- 2. Remove 'no_show' status (no_show becomes cancelled)
-- 3. Update CHECK constraint
-- 4. Update audit trigger

-- =============================================================================
-- STEP 1: Drop old constraint FIRST to allow data migration
-- =============================================================================

-- Drop the old constraint
alter table public.appointments
drop constraint if exists appointments_status_check;

-- =============================================================================
-- STEP 2: Update existing data
-- =============================================================================

-- Convert 'draft' to 'created'
update public.appointments
set status = 'created'
where status = 'draft';

-- Convert 'no_show' to 'cancelled' (with a note in cancellation_reason if not already set)
update public.appointments
set
  status = 'cancelled',
  cancellation_reason = coalesce(cancellation_reason, 'Client absent'),
  cancelled_at = coalesce(cancelled_at, now())
where status = 'no_show';

-- =============================================================================
-- STEP 3: Add new constraint with simplified statuses
-- =============================================================================

alter table public.appointments
add constraint appointments_status_check
check (status in ('created', 'confirmed', 'completed', 'cancelled'));

-- =============================================================================
-- STEP 4: Update default value
-- =============================================================================

alter table public.appointments
alter column status set default 'created';

-- =============================================================================
-- STEP 5: Update partial index for active appointments
-- =============================================================================

-- Drop old index if exists
drop index if exists idx_appointments_active_status;

-- Create new index with updated statuses
create index idx_appointments_active_status
on public.appointments (professional_id, start_time)
where status in ('created', 'confirmed');

-- =============================================================================
-- STEP 6: Update audit trigger function
-- =============================================================================

create or replace function public.appointment_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_context jsonb;
  v_new_value jsonb;
  v_actor_id uuid;
begin
  -- Get actor from auth context
  v_actor_id := auth.uid();

  if TG_OP = 'INSERT' then
    v_action := 'appointment_created';
    v_context := jsonb_build_object(
      'service_id', NEW.service_id,
      'professional_id', NEW.professional_id,
      'start_time', NEW.start_time
    );
    v_new_value := to_jsonb(NEW);

    insert into public.calendar_audit_log (
      entity_type, entity_id, action, context, new_value, actor_id
    ) values (
      'appointment', NEW.id, v_action, v_context, v_new_value, v_actor_id
    );

  elsif TG_OP = 'UPDATE' then
    -- Determine action based on what changed
    if OLD.status != NEW.status then
      v_action := case NEW.status
        when 'confirmed' then 'appointment_confirmed'
        when 'completed' then 'appointment_completed'
        when 'cancelled' then 'appointment_cancelled'
        when 'created' then
          case OLD.status
            when 'cancelled' then 'appointment_restored'
            else 'appointment_updated'
          end
        else 'appointment_updated'
      end;

      v_context := jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      );

      -- Add cancellation details if cancelled
      if NEW.status = 'cancelled' then
        v_context := v_context || jsonb_build_object(
          'cancellation_reason', NEW.cancellation_reason,
          'cancellation_fee_applied', NEW.cancellation_fee_applied,
          'cancellation_fee_percent', NEW.cancellation_fee_percent
        );
      end if;

    elsif OLD.start_time != NEW.start_time or OLD.duration_minutes != NEW.duration_minutes then
      v_action := 'appointment_rescheduled';
      v_context := jsonb_build_object(
        'old_start_time', OLD.start_time,
        'new_start_time', NEW.start_time,
        'old_duration', OLD.duration_minutes,
        'new_duration', NEW.duration_minutes
      );

    elsif OLD.notes_internal is distinct from NEW.notes_internal then
      v_action := 'appointment_notes_updated';
      v_context := jsonb_build_object(
        'notes_changed', true
      );

    else
      v_action := 'appointment_updated';
      v_context := jsonb_build_object(
        'fields_changed', true
      );
    end if;

    v_new_value := to_jsonb(NEW);

    insert into public.calendar_audit_log (
      entity_type, entity_id, action, context, new_value, actor_id
    ) values (
      'appointment', NEW.id, v_action, v_context, v_new_value, v_actor_id
    );
  end if;

  return coalesce(NEW, OLD);
end;
$$;

comment on function public.appointment_audit_trigger() is
  'Audit trigger for appointments. Tracks status changes (created→confirmed→completed/cancelled), rescheduling, and note updates.';

-- =============================================================================
-- STEP 7: Update column comment
-- =============================================================================

comment on column public.appointments.status is
  'Appointment lifecycle: created (new) -> confirmed (client confirmed) -> completed (time passed) / cancelled';
