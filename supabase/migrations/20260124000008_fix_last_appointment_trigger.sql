-- Migration: fix_last_appointment_trigger
-- Module: clients
-- Fix: Include 'created' status appointments in last_appointment_at calculation
--
-- Previously only 'confirmed' and 'completed' appointments were counted.
-- Now also includes 'created' status (booked but not yet confirmed by client).

-- =============================================================================
-- UPDATE FUNCTION: Include 'created' status
-- =============================================================================

create or replace function public.update_client_last_appointment()
returns trigger
language plpgsql
security definer
as $$
declare
  v_client_id uuid;
  v_latest_appointment timestamptz;
begin
  -- Get the client_id from the appointment_clients table
  -- For INSERT/UPDATE on appointment_clients
  if TG_TABLE_NAME = 'appointment_clients' then
    v_client_id := coalesce(NEW.client_id, OLD.client_id);
  end if;

  -- For UPDATE on appointments (status change)
  if TG_TABLE_NAME = 'appointments' then
    -- Get all clients associated with this appointment
    for v_client_id in
      select client_id from public.appointment_clients
      where appointment_id = coalesce(NEW.id, OLD.id)
    loop
      -- Find the latest non-cancelled appointment for this client
      -- Now includes: created, confirmed, completed (excludes: cancelled)
      select max(a.start_time) into v_latest_appointment
      from public.appointments a
      join public.appointment_clients ac on a.id = ac.appointment_id
      where ac.client_id = v_client_id
        and a.status in ('created', 'confirmed', 'completed')
        and a.start_time <= now();

      -- Update the client record
      update public.clients
      set last_appointment_at = v_latest_appointment
      where id = v_client_id;
    end loop;

    return coalesce(NEW, OLD);
  end if;

  -- For appointment_clients changes, recalculate for the specific client
  if v_client_id is not null then
    -- Find the latest non-cancelled appointment for this client
    -- Now includes: created, confirmed, completed (excludes: cancelled)
    select max(a.start_time) into v_latest_appointment
    from public.appointments a
    join public.appointment_clients ac on a.id = ac.appointment_id
    where ac.client_id = v_client_id
      and a.status in ('created', 'confirmed', 'completed')
      and a.start_time <= now();

    -- Update the client record
    update public.clients
    set last_appointment_at = v_latest_appointment
    where id = v_client_id;
  end if;

  return coalesce(NEW, OLD);
end;
$$;

-- =============================================================================
-- BACKFILL: Update all existing clients with corrected logic
-- =============================================================================

update public.clients c
set last_appointment_at = (
  select max(a.start_time)
  from public.appointments a
  join public.appointment_clients ac on a.id = ac.appointment_id
  where ac.client_id = c.id
    and a.status in ('created', 'confirmed', 'completed')
    and a.start_time <= now()
);

comment on function public.update_client_last_appointment() is
  'Trigger function to keep client.last_appointment_at in sync with appointments. Includes created, confirmed, and completed status (excludes cancelled).';
