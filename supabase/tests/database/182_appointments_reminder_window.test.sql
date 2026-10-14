-- Rendez-vous, the reminders' window at the cutover (migration *_appointments_reminder_window.sql;
-- decision I-19). With the default settings (Monday to Friday, reminder at 8 h, business hours
-- until 17 h, one business day ahead), GOrendezvous's rule (« 1 jour avant », no weekend sends,
-- Monday's on Friday) is the app's: Friday reminds Saturday to Monday; nothing on a weekend;
-- Monday reminds Tuesday only, never Monday's own appointments (no catch-up), so enabling the job
-- on Monday Nov 30 does not re-remind what GOrendezvous reminded on Friday Nov 27.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select function_privs_are('private', 'appointments_reminder_window', array['uuid', 'timestamp with time zone'], 'authenticated', array[]::text[],
  'appointments_reminder_window: no role');

insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');


select results_eq($$ select from_date, to_date from private.appointments_reminder_window('b0000000-0000-0000-0000-00000000000a', '2026-11-26 10:00 America/Toronto') $$,
  $$ values (date '2026-11-27', date '2026-11-27') $$, 'Thursday Nov 26: Friday''s appointments');
select results_eq($$ select from_date, to_date from private.appointments_reminder_window('b0000000-0000-0000-0000-00000000000a', '2026-11-27 10:00 America/Toronto') $$,
  $$ values (date '2026-11-28', date '2026-11-30') $$, 'Friday Nov 27: Saturday''s, Sunday''s and Monday''s (as GOrendezvous)');
select is_empty($$ select from_date, to_date from private.appointments_reminder_window('b0000000-0000-0000-0000-00000000000a', '2026-11-27 07:59 America/Toronto') $$,
  'Friday before the reminder hour: nothing yet');
select is_empty($$ select from_date, to_date from private.appointments_reminder_window('b0000000-0000-0000-0000-00000000000a', '2026-11-27 17:00 America/Toronto') $$,
  'Friday after the business hours: nothing');
select is_empty($$ select from_date, to_date from private.appointments_reminder_window('b0000000-0000-0000-0000-00000000000a', '2026-11-28 10:00 America/Toronto') $$,
  'Saturday: nothing (no weekend sends)');
select is_empty($$ select from_date, to_date from private.appointments_reminder_window('b0000000-0000-0000-0000-00000000000a', '2026-11-29 10:00 America/Toronto') $$,
  'Sunday: nothing');
select is_empty($$ select from_date, to_date from private.appointments_reminder_window('b0000000-0000-0000-0000-00000000000a', '2026-11-30 07:30 America/Toronto') $$,
  'Monday Nov 30, enabled before the reminder hour: nothing yet');
select results_eq($$ select from_date, to_date from private.appointments_reminder_window('b0000000-0000-0000-0000-00000000000a', '2026-11-30 08:00 America/Toronto') $$,
  $$ values (date '2026-12-01', date '2026-12-01') $$, 'Monday Nov 30 from 8 h: Tuesday Dec 1 only, never Monday''s own (no catch-up)');
select results_eq($$ select from_date, to_date from private.appointments_reminder_window('b0000000-0000-0000-0000-00000000000a', '2026-11-30 16:59 America/Toronto') $$,
  $$ values (date '2026-12-01', date '2026-12-01') $$, 'Monday enabled late in the day: still Tuesday only');

select * from finish();
rollback;
