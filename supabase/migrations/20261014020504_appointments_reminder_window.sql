-- =============================================================================
-- Rendez-vous: the reminders' window, as a function of the instant (I-19, the cutover)
-- =============================================================================
-- Asked:   coordinator, 2026-10-13: check that the app's reminders match GOrendezvous's (one day
--          before, nothing on a weekend, Monday's sent on Friday) and that enabling the messages
--          job on the cutover Monday (Nov 30) does not re-remind Monday's appointments.
-- Needs:   *_appointments_messages.sql (appointments_queue_reminders).
--
-- The rule is unchanged; it is only taken out of `appointments_queue_reminders` so it can be
-- checked at any instant (pgTAP `182_appointments_reminder_window`, the cutover's dates).
-- `private.appointments_reminder_window(org, at)` → (from_date, to_date), the local dates whose
-- appointments are reminded at that instant, or no row: not a business day, before the reminder
-- hour or after the business hours. From is always the day after today: an appointment of today is
-- never reminded (no catch-up), so Monday's appointments, reminded by GOrendezvous on Friday, are
-- not reminded again when the job is enabled on Monday.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_reminder_window', true);

create function private.appointments_reminder_window(p_org uuid, p_at timestamptz)
returns table (from_date date, to_date date)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text := private.appointments_tz(p_org);
  v_days smallint[] := '{1,2,3,4,5}';
  v_end time := '17:00';
  v_lead smallint := 1;
  v_hour smallint := 8;
  v_local timestamp := p_at at time zone v_tz;
  v_today date := v_local::date;
  v_last date := v_local::date;
  v_n int := 0;
begin
  select s.business_days, s.business_end, s.reminder_business_days, s.reminder_local_hour
    into v_days, v_end, v_lead, v_hour
    from public.appointment_settings s where s.org_id = p_org;
  v_days := coalesce(v_days, '{1,2,3,4,5}');
  if not (extract(isodow from v_today)::smallint = any (v_days))
     or v_local::time < pg_catalog.make_time(coalesce(v_hour, 8), 0, 0) or v_local::time >= coalesce(v_end, '17:00') then
    return;
  end if;
  for i in 1..30 loop
    v_last := v_last + 1;
    if extract(isodow from v_last)::smallint = any (v_days) then
      v_n := v_n + 1;
      exit when v_n >= coalesce(v_lead, 1);
    end if;
  end loop;
  from_date := v_today + 1;
  to_date := v_last;
  return next;
end;
$$;
revoke all on function private.appointments_reminder_window(uuid, timestamptz) from public, anon, authenticated, service_role;

-- *_appointments_messages.sql's, through the window (same rule, same rows).
create or replace function private.appointments_queue_reminders(p_org uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_tz text := private.appointments_tz(p_org);
  v_count int := 0;
  w record;
  a record;
begin
  select x.from_date, x.to_date into w from private.appointments_reminder_window(p_org, pg_catalog.now()) x;
  if w.from_date is null then
    return 0;
  end if;
  for a in select x.id from public.appointments x
            where x.org_id = p_org and x.state in ('booked', 'confirmed') and not x.is_personal
              and x.starts_at > pg_catalog.now()
              and (x.starts_at at time zone v_tz)::date between w.from_date and w.to_date loop
    v_count := v_count + private.appointments_queue_message(p_org, a.id, 'reminder');
  end loop;
  return v_count;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
