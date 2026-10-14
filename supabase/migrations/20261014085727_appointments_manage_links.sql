-- =============================================================================
-- Rendez-vous: « Annuler » and « Demander un changement » links in the client's emails (L16, AP-50)
-- =============================================================================
-- GOrendezvous's « Modifier / Annuler » links, behind a Paramètres → Agenda switch **off by
-- default**: AP-20 (the client calls the clinic to cancel or change) stays the default.
--
-- * appointment_settings.client_manage_links (false), changed by set_appointment_client_links
--   (appointments.settings), its own card: the hours' RPC is unchanged.
-- * A core secure link, purpose `appointment_manage` (one use, the appointment's start at most,
--   30 days; hashed; ADR 0003: a catalogue row and the private helpers): issued with the
--   confirmation link of each confirmation, reminder and change email while the switch is on and
--   the module open to all (P3-40). prepare_appointment_message_for_service takes its hash (a 4th,
--   defaulted argument: dropped and made again) and says `with_manage`; the email's
--   `{{appointment.change_line}}` (a new optional variable of the six templates) carries
--   `/rendez-vous/gerer#t=…`, or the « appelez la clinique » sentence when off.
-- * resolve_appointment_manage_link (resolve-link): what the page shows, nothing about the client,
--   with whether cancelling now is late (Services' policy for that day, the notice counted as
--   cancel_appointment counts it: private.appointments_cancel_late, AP-31 / I-19's business days).
-- * manage_appointment_by_link_for_service(hash, action) (the function `appointments-manage`, per-IP
--   limit before the lookup): one use, the link's org and module (enabled and open to all), the
--   switch still on, the appointment still booked or confirmed, to come, at the start its email
--   announced. `cancel`: cancelled as cancel_appointment cancels (reason `not_specified`, the
--   details « Annulé par le client avec le lien du courriel. », cancel_late from the policy; the
--   client's cancellation email follows through the messages' trigger); `change_request`: the
--   appointment's change_requested_at. Both audited under `link:appointment_manage`, and both
--   notify the staff (appointments.manage) and the professional (appointments.self), the late
--   cancellation as important.
-- * « Modifier » is a request, not a self-rescheduling (AP-50, révisable): booking again runs
--   every staff rule (availability, holds, consents, balance, video) that a public page would have
--   to repeat; the staff call the client back.
-- * The messages' trigger and finish_appointment_message_for_service revoke the manage links with
--   the confirmation links (a move, a cancellation, a restore; a failed or held email).
-- * Additive: two columns, a purpose, three new functions, three replaced (one with a new
--   defaulted argument), the six default templates' closing sentence when no one changed it.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_manage_links', true);

-- -----------------------------------------------------------------------------
-- The switch and the request's mark
-- -----------------------------------------------------------------------------
alter table public.appointment_settings
  add column client_manage_links boolean not null default false;
alter table public.appointments
  add column change_requested_at timestamptz;

create function public.set_appointment_client_links(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('appointments.settings') then
    raise exception 'Permission refusée : appointments.settings' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Choisissez si les courriels portent les liens.' using errcode = 'P0001', hint = 'client_manage_links';
  end if;
  insert into public.appointment_settings (org_id, client_manage_links, updated_by)
  values (v_org, p_enabled, auth.uid())
  on conflict (org_id) do update
     set client_manage_links = excluded.client_manage_links, updated_by = excluded.updated_by;
end;
$$;

-- Whether the clinic's emails carry the links (off without a row).
create function private.appointments_manage_links_on(p_org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.client_manage_links from public.appointment_settings s where s.org_id = p_org), false)
$$;

-- -----------------------------------------------------------------------------
-- The purpose
-- -----------------------------------------------------------------------------
insert into public.secure_link_purposes
  (key, module_key, default_ttl, max_ttl, max_uses, requires_session, creates_account, resolve_rpc, accept_rpc, view_permission)
values ('appointment_manage', 'appointments', interval '7 days', interval '30 days', 1, false, false,
        'resolve_appointment_manage_link', null, 'appointments.view')
on conflict do nothing;

-- Whether cancelling now is late, and the notice it counts: Services' policy for the appointment's
-- clinic day, counted as cancel_appointment counts it (late null: no policy).
create function private.appointments_late_now(p_org uuid, p_starts_at timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'late', private.appointments_cancel_late(p_org, p_starts_at, b.late_notice_hours, pg_catalog.now()),
           'notice_hours', b.late_notice_hours,
           'business_hours', coalesce((select s.late_notice_business_hours from public.appointment_settings s where s.org_id = p_org), true))
    from (select 1) one
    left join lateral (
      select x.late_notice_hours
        from private.billing_policy_for(p_org, (p_starts_at at time zone private.appointments_tz(p_org))::date) x
       limit 1) b on true
$$;

-- What the page shows (resolve-link): the clinic, the moment in words, the professional, the mode,
-- whether cancelling now is late. Nothing about the client.
create function public.resolve_appointment_manage_link(p_link_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.secure_links;
  m public.appointment_messages;
  v public.appointments;
begin
  select x.* into l from public.secure_links x
   where x.id = p_link_id and x.purpose = 'appointment_manage' and x.subject_type = 'appointment_message'
     and x.revoked_at is null and x.expires_at > pg_catalog.now() and x.use_count < x.max_uses;
  if l.id is null or not public.module_open_to_all_for_org(l.org_id, 'appointments')
     or not private.appointments_manage_links_on(l.org_id) then
    return null;
  end if;
  select x.* into m from public.appointment_messages x where x.id = l.subject_id and x.org_id = l.org_id;
  select a.* into v from public.appointments a where a.id = m.appointment_id and a.org_id = l.org_id;
  if v.id is null or v.state not in ('booked', 'confirmed') or v.starts_at <= pg_catalog.now() or v.starts_at <> m.starts_at then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'clinic_name', (select o.name from public.organizations o where o.id = l.org_id),
    'language', m.language,
    'when', private.appointments_when(v.starts_at, private.appointments_tz(l.org_id), m.language),
    'professional_name', coalesce((select n.display_name from private.professional_display_names(l.org_id, array[v.professional_id]) n), ''),
    'mode', v.mode)
    || private.appointments_late_now(l.org_id, v.starts_at);
end;
$$;

-- The staff (appointments.manage) and the professional (appointments.self, her active profile) are told.
create function private.appointments_notify_client_action(p_org uuid, p_appt public.appointments, p_kind text, p_late boolean, p_dedupe text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tz text := private.appointments_tz(p_org);
  v_day text := pg_catalog.to_char(p_appt.starts_at at time zone v_tz, 'YYYY-MM-DD');
  v_when text := private.appointments_when(p_appt.starts_at, v_tz, 'fr');
  v_pro text := coalesce((select n.display_name from private.professional_display_names(p_org, array[p_appt.professional_id]) n), '');
  v_profile uuid := private.professional_profile_id(p_org, p_appt.professional_id);
  v_title text;
  v_body text;
  v_importance text;
begin
  if p_kind = 'appointments.client_cancelled' then
    v_title := 'Un client a annulé son rendez-vous';
    v_body := 'Le rendez-vous du ' || v_when || ' avec ' || v_pro || ' a été annulé par le client avec le lien du courriel.'
              || case when p_late then ' Annulation tardive : des frais peuvent s''appliquer selon la politique de la clinique.' else '' end;
    v_importance := case when p_late then 'important' else 'normal' end;
  else
    v_title := 'Un client demande à changer son rendez-vous';
    v_body := 'Le client demande de changer le rendez-vous du ' || v_when || ' avec ' || v_pro
              || ' (lien du courriel). Appelez-le pour convenir d''un autre moment ; le rendez-vous reste réservé d''ici là.';
    v_importance := 'important';
  end if;
  perform private.notify(p_org, 'appointments', p_kind, v_importance, v_title, pg_catalog.left(v_body, 500),
    '/agenda?date=' || v_day || '&vue=jour&professionnel=' || p_appt.professional_id || '&rendez-vous=' || p_appt.id,
    'appointment', p_appt.id, 'appointments.manage', null, p_dedupe || ':staff');
  if v_profile is not null and exists (select 1 from public.profiles p where p.user_id = v_profile and p.org_id = p_org and p.status = 'active') then
    perform private.notify(p_org, 'appointments', p_kind, v_importance, v_title, pg_catalog.left(v_body, 500),
      '/mon-agenda?date=' || v_day || '&vue=jour&rendez-vous=' || p_appt.id,
      'appointment', p_appt.id, 'appointments.self', v_profile, p_dedupe || ':self');
  end if;
end;
$$;

-- « Annuler » / « Demander un changement » (the function appointments-manage): one use; see the header.
create function public.manage_appointment_by_link_for_service(p_token_hash bytea, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.secure_links;
  m public.appointment_messages;
  v public.appointments;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_reason uuid;
  v_late boolean;
begin
  if p_action is null or p_action not in ('cancel', 'change_request') then
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  select x.* into l from public.secure_links x
   where x.token_hash = p_token_hash and x.purpose = 'appointment_manage' and x.subject_type = 'appointment_message'
   for update;
  if l.id is null or l.revoked_at is not null or l.expires_at <= pg_catalog.now() or l.use_count >= l.max_uses
     or not public.module_open_to_all_for_org(l.org_id, 'appointments')
     or not private.appointments_manage_links_on(l.org_id) then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  select x.* into m from public.appointment_messages x where x.id = l.subject_id and x.org_id = l.org_id;
  select a.* into v from public.appointments a where a.id = m.appointment_id and a.org_id = l.org_id for update;
  if v.id is null or v.state not in ('booked', 'confirmed') or v.starts_at <= pg_catalog.now() or v.starts_at <> m.starts_at
     or v.is_personal then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  if p_action = 'cancel' then
    select r.id into v_reason from public.cancellation_reasons r
     where r.org_id = l.org_id and r.key = 'not_specified';
    if v_reason is null then
      return pg_catalog.jsonb_build_object('state', 'invalid');
    end if;
  end if;

  perform pg_catalog.set_config('app.audit_source', 'link:appointment_manage', true);
  perform private.consume_secure_link(p_token_hash, 'appointment_manage');
  if p_action = 'cancel' then
    v_late := (private.appointments_late_now(l.org_id, v.starts_at) ->> 'late')::boolean;
    update public.appointments a
       set state = 'cancelled', cancelled_at = pg_catalog.now(), cancelled_by = null, cancel_reason_id = v_reason,
           cancel_details = 'Annulé par le client avec le lien du courriel.', kept_on_schedule = false, cancel_late = v_late
     where a.id = v.id;
    perform private.appointments_notify_client_action(l.org_id, v, 'appointments.client_cancelled', coalesce(v_late, false),
                                                      'client_cancelled:' || v.id);
  else
    update public.appointments a set change_requested_at = pg_catalog.now() where a.id = v.id;
    perform private.appointments_notify_client_action(l.org_id, v, 'appointments.change_request', false,
                                                      'change_request:' || l.id);
  end if;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return pg_catalog.jsonb_build_object('state', case when p_action = 'cancel' then 'cancelled' else 'requested' end,
                                       'late', coalesce(v_late, false));
end;
$$;

-- -----------------------------------------------------------------------------
-- The emails: the link issued with the confirmation link
-- -----------------------------------------------------------------------------
-- *_appointments_messages_reserved.sql's, with the manage link (a 4th, defaulted argument).
drop function public.prepare_appointment_message_for_service(uuid, uuid, bytea);
create function public.prepare_appointment_message_for_service(p_org_id uuid, p_message_id uuid, p_token_hash bytea,
                                                               p_manage_token_hash bytea default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.appointment_messages;
  v public.appointments;
  c record;
  v_client_first text;
  v_link uuid;
  v_manage uuid;
  v_pro text;
  v_ttl interval;
begin
  select x.* into m from public.appointment_messages x
   where x.org_id = p_org_id and x.id = p_message_id and x.channel = 'email' for update;
  if m.id is null or m.status <> 'pending' then
    return null;
  end if;
  if not public.module_open_to_all_for_org(p_org_id, 'appointments') then
    update public.appointment_messages x set status = 'skipped', skip_reason = 'reserved' where x.id = m.id;
    return null;
  end if;
  select a.* into v from public.appointments a where a.id = m.appointment_id;
  select x.* into c from private.client_contacts_for(p_org_id, m.client_id, 'appointments') x
   where x.client_id = m.recipient_client_id and x.email is not null and x.reminders_by_email;
  if c.client_id is null then
    update public.appointment_messages x set status = 'skipped', skip_reason = 'unreachable' where x.id = m.id;
    return null;
  end if;
  select x.first_name into v_client_first from private.client_contacts_for(p_org_id, m.client_id, 'appointments') x where x.is_self;
  select n.display_name into v_pro from private.professional_display_names(p_org_id, array[v.professional_id]) n;
  if m.kind <> 'cancelled' then
    v_ttl := least(v.starts_at - pg_catalog.now(), interval '30 days');
    perform private.revoke_secure_links(p_org_id, 'appointment_confirm', 'appointment_message', m.id, null);
    v_link := private.issue_secure_link(p_org_id, 'appointment_confirm', 'appointment_message', m.id, p_token_hash, null, v_ttl);
    perform private.revoke_secure_links(p_org_id, 'appointment_manage', 'appointment_message', m.id, null);
    if p_manage_token_hash is not null and private.appointments_manage_links_on(p_org_id) then
      v_manage := private.issue_secure_link(p_org_id, 'appointment_manage', 'appointment_message', m.id, p_manage_token_hash, null, v_ttl);
    end if;
  end if;
  update public.appointment_messages x set attempts = x.attempts + 1, link_id = v_link where x.id = m.id;
  return pg_catalog.jsonb_build_object(
    'message_id', m.id,
    'appointment_id', v.id,
    'kind', m.kind,
    'language', m.language,
    'email', c.email,
    'recipient_first_name', c.first_name,
    'client_first_name', coalesce(v_client_first, c.first_name),
    'starts_at', v.starts_at,
    'professional_name', coalesce(v_pro, ''),
    'access', private.appointments_access(p_org_id, v.id, v.mode, m.language),
    'clinic_name', (select o.name from public.organizations o where o.id = p_org_id),
    'with_link', v_link is not null,
    'with_manage', v_manage is not null);
end;
$$;

-- *_appointments_messages_core_held.sql's, revoking the manage link with the confirmation link.
create or replace function public.finish_appointment_message_for_service(p_org_id uuid, p_message_id uuid, p_sent boolean,
                                                                         p_skip_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.appointment_messages;
begin
  select x.* into m from public.appointment_messages x where x.org_id = p_org_id and x.id = p_message_id for update;
  if m.id is null or m.status <> 'pending' then
    return;
  end if;
  if p_skip_reason is not null and p_skip_reason not in ('reserved') then
    raise exception 'Unknown skip reason' using errcode = '22023';
  end if;
  if coalesce(p_sent, false) then
    update public.appointment_messages x set status = 'sent', sent_at = pg_catalog.now() where x.id = m.id;
  elsif p_skip_reason is not null then
    -- Core held the email (its template's module reserved, CC-14): set aside, never tried again.
    if m.link_id is not null then
      perform private.revoke_secure_links(p_org_id, 'appointment_confirm', 'appointment_message', m.id, null);
      perform private.revoke_secure_links(p_org_id, 'appointment_manage', 'appointment_message', m.id, null);
    end if;
    update public.appointment_messages x set status = 'skipped', skip_reason = p_skip_reason where x.id = m.id;
  else
    if m.link_id is not null then
      perform private.revoke_secure_links(p_org_id, 'appointment_confirm', 'appointment_message', m.id, null);
      perform private.revoke_secure_links(p_org_id, 'appointment_manage', 'appointment_message', m.id, null);
    end if;
    update public.appointment_messages x
       set status = case when x.attempts >= 3 then 'failed' else 'pending' end
     where x.id = m.id;
  end if;
end;
$$;

-- *_appointments_security_fixes.sql's, revoking the manage links with the confirmation links.
create or replace function private.appointments_messages_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.appointments;
  v_kind text;
begin
  select a.* into v from public.appointments a where a.id = new.id;
  if v.id is null or v.is_personal or (tg_op = 'INSERT' and v.external_ref is not null) or v.starts_at <= pg_catalog.now() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if v.state in ('booked', 'confirmed') then
      v_kind := 'confirmation';
    end if;
  elsif v.state = 'cancelled' and old.state in ('booked', 'confirmed') then
    v_kind := 'cancelled';
    update public.appointment_messages m set status = 'skipped', skip_reason = 'cancelled'
     where m.appointment_id = v.id and m.status = 'pending' and m.kind <> 'cancelled';
  elsif v.state = 'booked' and old.state = 'held' then
    v_kind := 'confirmation';
  elsif v.state in ('booked', 'confirmed') and old.state = 'cancelled' then
    -- Restored (AP-29): its cancellation, if not gone yet, never leaves.
    v_kind := 'changed';
    update public.appointment_messages m set status = 'skipped', skip_reason = 'superseded'
     where m.appointment_id = v.id and m.status = 'pending' and m.kind = 'cancelled';
  elsif v.state in ('booked', 'confirmed') and old.state in ('booked', 'confirmed')
        and (old.starts_at is distinct from new.starts_at or old.professional_id is distinct from new.professional_id
             or old.service_id is distinct from new.service_id or old.ends_at is distinct from new.ends_at) then
    v_kind := 'changed';
    update public.appointment_messages m set status = 'skipped', skip_reason = 'superseded'
     where m.appointment_id = v.id and m.status = 'pending' and m.starts_at <> v.starts_at;
  end if;
  if v_kind is null then
    return null;
  end if;
  -- Moved, cancelled or restored: the links already sent confirm, cancel or ask nothing any more.
  if v_kind <> 'confirmation' then
    perform private.revoke_secure_links(v.org_id, 'appointment_confirm', 'appointment_message', m.id, null),
            private.revoke_secure_links(v.org_id, 'appointment_manage', 'appointment_message', m.id, null)
       from public.appointment_messages m
      where m.appointment_id = v.id and m.link_id is not null;
  end if;
  -- A series: one confirmation (its first date) and one cancellation (the first cancelled now).
  if v.series_id is not null and v_kind = 'confirmation' and exists (
       select 1 from public.appointments s where s.series_id = v.series_id and s.id <> v.id
          and s.state in ('booked', 'confirmed') and s.starts_at < v.starts_at) then
    return null;
  end if;
  if v.series_id is not null and v_kind = 'cancelled' and exists (
       select 1 from public.appointments s where s.series_id = v.series_id and s.id <> v.id
          and s.state = 'cancelled' and s.cancelled_at = v.cancelled_at and s.starts_at < v.starts_at) then
    return null;
  end if;
  perform private.appointments_queue_message(v.org_id, v.id, v_kind);
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- The default templates: the closing sentence is `{{appointment.change_line}}`
-- -----------------------------------------------------------------------------
-- The job fills it: the link when the switch is on, else the sentence the defaults said. A
-- template a clinic changed keeps its text (and so no link) until it adds the variable.
update public.email_template_defaults d
   set variables = d.variables || case when d.key like '%\_en' then
         '[{"path": "appointment.change_line", "label": "Annuler ou changer (le lien, ou « appelez la clinique »)", "sample": "To cancel or change this appointment, please call the clinic.", "required": false, "kind": "text"}]'::jsonb
       else
         '[{"path": "appointment.change_line", "label": "Annuler ou changer (le lien, ou « appelez la clinique »)", "sample": "Pour annuler ou changer ce rendez-vous, appelez la clinique.", "required": false, "kind": "text"}]'::jsonb
       end
 where d.key in ('appointments.confirmation', 'appointments.confirmation_en', 'appointments.reminder', 'appointments.reminder_en',
                 'appointments.changed', 'appointments.changed_en')
   and not d.variables @> '[{"path": "appointment.change_line"}]'::jsonb;
update public.email_template_defaults d
   set body = pg_catalog.replace(d.body, 'Pour annuler ou changer ce rendez-vous, appelez la clinique.', '{{appointment.change_line}}')
 where d.key in ('appointments.confirmation', 'appointments.reminder');
update public.email_template_defaults d
   set body = pg_catalog.replace(d.body, 'To cancel or change this appointment, please call the clinic.', '{{appointment.change_line}}')
 where d.key in ('appointments.confirmation_en', 'appointments.reminder_en');
update public.email_template_defaults d
   set body = pg_catalog.replace(d.body, 'Pour toute question, appelez la clinique.', '{{appointment.change_line}}')
 where d.key = 'appointments.changed';
update public.email_template_defaults d
   set body = pg_catalog.replace(d.body, 'If you have any question, please call the clinic.', '{{appointment.change_line}}')
 where d.key = 'appointments.changed_en';

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  private.appointments_manage_links_on(uuid),
  private.appointments_late_now(uuid, timestamptz),
  private.appointments_notify_client_action(uuid, public.appointments, text, boolean, text)
from public, anon, authenticated, service_role;
revoke all on function public.set_appointment_client_links(boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_appointment_client_links(boolean) to authenticated;
revoke all on function
  public.prepare_appointment_message_for_service(uuid, uuid, bytea, bytea),
  public.resolve_appointment_manage_link(uuid),
  public.manage_appointment_by_link_for_service(bytea, text)
from public, anon, authenticated;
grant execute on function
  public.prepare_appointment_message_for_service(uuid, uuid, bytea, bytea),
  public.resolve_appointment_manage_link(uuid),
  public.manage_appointment_by_link_for_service(bytea, text)
to service_role;

select pg_catalog.set_config('app.audit_source', '', true);
