-- Migration: client_last_appointment_trigger
-- Updates client.last_appointment_at automatically when appointments are created/updated
-- Created: 2026-01-23

-- =============================================================================
-- FUNCTION: Update client's last_appointment_at
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
      -- Find the latest completed/confirmed appointment for this client
      select max(a.start_time) into v_latest_appointment
      from public.appointments a
      join public.appointment_clients ac on a.id = ac.appointment_id
      where ac.client_id = v_client_id
        and a.status in ('confirmed', 'completed')
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
    -- Find the latest completed/confirmed appointment for this client
    select max(a.start_time) into v_latest_appointment
    from public.appointments a
    join public.appointment_clients ac on a.id = ac.appointment_id
    where ac.client_id = v_client_id
      and a.status in ('confirmed', 'completed')
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
-- TRIGGERS
-- =============================================================================

-- Trigger on appointment_clients (when client is added/removed from appointment)
drop trigger if exists update_client_last_appointment_on_ac on public.appointment_clients;
create trigger update_client_last_appointment_on_ac
  after insert or update or delete on public.appointment_clients
  for each row
  execute function public.update_client_last_appointment();

-- Trigger on appointments (when status changes)
drop trigger if exists update_client_last_appointment_on_apt on public.appointments;
create trigger update_client_last_appointment_on_apt
  after update of status on public.appointments
  for each row
  execute function public.update_client_last_appointment();

-- =============================================================================
-- BACKFILL: Update existing clients with their last appointment
-- =============================================================================

update public.clients c
set last_appointment_at = (
  select max(a.start_time)
  from public.appointments a
  join public.appointment_clients ac on a.id = ac.appointment_id
  where ac.client_id = c.id
    and a.status in ('confirmed', 'completed')
    and a.start_time <= now()
);

comment on function public.update_client_last_appointment() is 'Trigger function to keep client.last_appointment_at in sync with appointments';
