-- Rendez-vous: « Annuler » / « Demander un changement » links in the client's emails (migration
-- *_appointments_manage_links.sql, L16, AP-50).
-- Covers: the switch off by default (no link) and its RPC (appointments.settings); the link issued
-- with the confirmation link while on, never for a cancellation; what the page shows (late or not,
-- nothing about the client); a cancellation on time and a late one (cancel_late from the policy,
-- audited under the link, the client's cancellation email, the staff and the professional told);
-- a change request (marked, notified, the appointment kept); one use; revoked by a move and by a
-- failed email; the switch turned off, the module reserved for testers (P3-40) or turned off; the
-- six default templates; the privileges.
-- The deferred messages trigger fires at commit; here `set constraints all immediate` fires it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

-- =============================================================================
-- Fixtures: clinic A (admin, conseillère, provider P1), client Léa
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active');
insert into public.clients (id, org_id, first_name, last_name, email, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@a.test', 'fr');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
insert into public.appointment_settings (org_id, business_days, business_start, business_end, reminder_business_days, reminder_local_hour)
values ('b0000000-0000-0000-0000-00000000000a', '{1,2,3,4,5,6,7}', '00:00', '23:59', 1, 0)
on conflict (org_id) do update set business_days = excluded.business_days, business_start = excluded.business_start,
  business_end = excluded.business_end;

-- Six appointments with Léa (by phone): five days ahead (far, req, mv, fail, off) and one in three hours (near).
select set_config('test.base', (((now() at time zone 'America/Toronto')::date + 5 + time '08:00') at time zone 'America/Toronto')::text, true);
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode)
select x.id::uuid, 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
       x.at, x.at + interval '50 minutes', x.at + interval '60 minutes', 'phone'
  from (values
    ('e0000000-0000-0000-0000-000000000001', current_setting('test.base')::timestamptz),
    ('e0000000-0000-0000-0000-000000000002', current_setting('test.base')::timestamptz + interval '2 hours'),
    ('e0000000-0000-0000-0000-000000000003', current_setting('test.base')::timestamptz + interval '4 hours'),
    ('e0000000-0000-0000-0000-000000000004', current_setting('test.base')::timestamptz + interval '6 hours'),
    ('e0000000-0000-0000-0000-000000000005', current_setting('test.base')::timestamptz + interval '8 hours'),
    ('e0000000-0000-0000-0000-000000000006', date_trunc('minute', now()) + interval '3 hours')
  ) as x(id, at);
insert into public.appointment_participants (appointment_id, client_id, org_id)
select a.id, 'd0000000-0000-0000-0000-000000000001', a.org_id
  from public.appointments a where a.org_id = 'b0000000-0000-0000-0000-00000000000a';
set constraints all immediate;
set constraints all deferred;

-- Each appointment's confirmation email.
select set_config('test.m' || right(a.id::text, 1), m.id::text, true)
  from public.appointments a
  join public.appointment_messages m on m.appointment_id = a.id and m.kind = 'confirmation' and m.channel = 'email'
 where a.org_id = 'b0000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from public.appointment_messages where org_id = 'b0000000-0000-0000-0000-00000000000a'
            and kind = 'confirmation' and channel = 'email'), 6, 'six confirmation emails queued');
select ok(exists (select 1 from private.billing_policy_for('b0000000-0000-0000-0000-00000000000a', current_date)),
  'the clinic has a cancellation policy (Services'' seed)');

-- =============================================================================
-- 1. The switch: off by default, appointments.settings to change it
-- =============================================================================
select is((select client_manage_links from public.appointment_settings where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  false, 'the links are off by default (AP-20 stays the default)');
set local role service_role;
select results_eq($$ select (r ->> 'with_link')::boolean, (r ->> 'with_manage')::boolean
                       from public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m5')::uuid,
                              extensions.digest('c-off', 'sha256'), extensions.digest('g-off', 'sha256')) r $$,
  $$ values (true, false) $$, 'off: the email carries its confirmation link only');
reset role;
select is((select count(*)::int from public.secure_links where purpose = 'appointment_manage'), 0, '… and no manage link exists');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_appointment_client_links(true) $$, '42501', null, 'a conseillère cannot turn them on');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_appointment_client_links(null) $$, 'P0001', 'Choisissez si les courriels portent les liens.', 'a null switch is refused');
select lives_ok($$ select public.set_appointment_client_links(true) $$, 'the admin turns them on (appointments.settings)');
select is((select client_manage_links from public.appointment_settings), true, '… and the clinic''s row says so');
reset role;
select is((select business_days from public.appointment_settings where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  '{1,2,3,4,5,6,7}'::smallint[], '… the hours untouched');

-- =============================================================================
-- 2. The link, with the confirmation link; what the page shows
-- =============================================================================
set local role service_role;
select results_eq($$ select (r ->> 'with_link')::boolean, (r ->> 'with_manage')::boolean
                       from public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m1')::uuid,
                              extensions.digest('c-far', 'sha256'), extensions.digest('g-far', 'sha256')) r $$,
  $$ values (true, true) $$, 'on: the email carries both links');
select results_eq($$ select (r ->> 'with_link')::boolean, (r ->> 'with_manage')::boolean
                       from public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m4')::uuid,
                              extensions.digest('c-fail', 'sha256')) r $$,
  $$ values (true, false) $$, 'a caller without the manage hash (the job before its deploy) still sends, without it');
reset role;
select results_eq($$ select max_uses, expires_at <= (select starts_at from public.appointments where id = 'e0000000-0000-0000-0000-000000000001')
                       from public.secure_links where token_hash = extensions.digest('g-far', 'sha256') $$,
  $$ values (1, true) $$, 'the manage link: one use, until the appointment at most');
select set_config('test.l_far', (select id::text from public.secure_links where token_hash = extensions.digest('g-far', 'sha256')), true);
select results_eq($$ select r ->> 'clinic_name', r ->> 'language', r ->> 'mode', (r ->> 'late')::boolean, (r ->> 'notice_hours')::int,
                            (r ->> 'business_hours')::boolean, r ->> 'professional_name' is not null, r ->> 'when' is not null
                       from public.resolve_appointment_manage_link(current_setting('test.l_far')::uuid) r $$,
  $$ values ('Org A', 'fr', 'phone', false, 24, true, true, true) $$, 'the page: the clinic, the moment, not late (5 days ahead)');
select is((select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(public.resolve_appointment_manage_link(current_setting('test.l_far')::uuid)) k),
  array['business_hours', 'clinic_name', 'language', 'late', 'mode', 'notice_hours', 'professional_name', 'when'],
  '… and nothing about the client');

-- =============================================================================
-- 3. « Annuler », on time
-- =============================================================================
set local role service_role;
select throws_ok($$ select public.manage_appointment_by_link_for_service(extensions.digest('g-far', 'sha256'), 'move') $$,
  '22023', null, 'an unknown action is refused');
select is(public.manage_appointment_by_link_for_service(extensions.digest('nothing', 'sha256'), 'cancel') ->> 'state', 'invalid',
  'an unknown link does nothing');
select is(public.manage_appointment_by_link_for_service(extensions.digest('c-far', 'sha256'), 'cancel') ->> 'state', 'invalid',
  'a confirmation link cancels nothing');
select results_eq($$ select r ->> 'state', (r ->> 'late')::boolean
                       from public.manage_appointment_by_link_for_service(extensions.digest('g-far', 'sha256'), 'cancel') r $$,
  $$ values ('cancelled', false) $$, 'the client cancels, on time');
reset role;
select results_eq($$ select a.state, a.cancel_late, a.cancelled_by is null, r.key, a.cancel_details, a.kept_on_schedule
                       from public.appointments a join public.cancellation_reasons r on r.id = a.cancel_reason_id
                      where a.id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('cancelled', false, true, 'not_specified', 'Annulé par le client avec le lien du courriel.', false) $$,
  '… cancelled as the staff cancel, not late, by no one');
select ok(exists (select 1 from public.audit_log where table_name = 'appointments' and action = 'update'
                   and record_id = 'e0000000-0000-0000-0000-000000000001' and source = 'link:appointment_manage'
                   and changed_fields ? 'state'), '… audited under the link');
select ok((select used_at is not null and use_count = 1 from public.secure_links where token_hash = extensions.digest('g-far', 'sha256')),
  '… the link used');
set local role service_role;
select is(public.manage_appointment_by_link_for_service(extensions.digest('g-far', 'sha256'), 'cancel') ->> 'state', 'invalid',
  '… once only');
reset role;
select results_eq($$ select importance, recipient_permission, recipient_user_id, link_path like '/agenda?date=%&rendez-vous=e0000000-0000-0000-0000-000000000001'
                       from public.notifications where kind = 'appointments.client_cancelled' and subject_id = 'e0000000-0000-0000-0000-000000000001'
                      order by recipient_permission $$,
  $$ values ('normal', 'appointments.manage', null::uuid, true), ('normal', 'appointments.self', 'a0000000-0000-0000-0000-000000000003'::uuid, false) $$,
  '… the staff and the professional told');
select ok((select body not like '%Léa%' and body not like '%Essai%' from public.notifications
            where kind = 'appointments.client_cancelled' and recipient_permission = 'appointments.manage'
              and subject_id = 'e0000000-0000-0000-0000-000000000001'), '… without the client''s name');
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::int from public.appointment_messages where appointment_id = 'e0000000-0000-0000-0000-000000000001'
            and kind = 'cancelled' and channel = 'email' and status = 'pending'), 1, '… and the client''s cancellation email queued');
set local role service_role;
select results_eq($$ select (r ->> 'with_link')::boolean, (r ->> 'with_manage')::boolean
                       from public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a',
                              (select id from public.appointment_messages where appointment_id = 'e0000000-0000-0000-0000-000000000001'
                                  and kind = 'cancelled' and channel = 'email'),
                              extensions.digest('c-cx', 'sha256'), extensions.digest('g-cx', 'sha256')) r $$,
  $$ values (false, false) $$, 'a cancellation email carries no link');
reset role;

-- =============================================================================
-- 4. « Annuler », late (three hours ahead, 24 business hours of notice)
-- =============================================================================
set local role service_role;
select ok(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m6')::uuid,
  extensions.digest('c-near', 'sha256'), extensions.digest('g-near', 'sha256')) ->> 'with_manage' = 'true', 'the near appointment''s email carries the link');
reset role;
select is((public.resolve_appointment_manage_link((select id from public.secure_links where token_hash = extensions.digest('g-near', 'sha256'))) ->> 'late')::boolean,
  true, 'the page says a cancellation now is late');
set local role service_role;
select results_eq($$ select r ->> 'state', (r ->> 'late')::boolean
                       from public.manage_appointment_by_link_for_service(extensions.digest('g-near', 'sha256'), 'cancel') r $$,
  $$ values ('cancelled', true) $$, 'the client cancels late');
reset role;
select is((select cancel_late from public.appointments where id = 'e0000000-0000-0000-0000-000000000006'), true,
  '… cancel_late set, for Facturation''s fee');
select results_eq($$ select importance, body like '%Annulation tardive%' from public.notifications
                      where kind = 'appointments.client_cancelled' and subject_id = 'e0000000-0000-0000-0000-000000000006'
                        and recipient_permission = 'appointments.manage' $$,
  $$ values ('important', true) $$, '… the staff told it is late');

-- =============================================================================
-- 5. « Demander un changement »
-- =============================================================================
set local role service_role;
select ok(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m2')::uuid,
  extensions.digest('c-req', 'sha256'), extensions.digest('g-req', 'sha256')) ->> 'with_manage' = 'true', 'another email with the link');
select is(public.manage_appointment_by_link_for_service(extensions.digest('g-req', 'sha256'), 'change_request') ->> 'state', 'requested',
  'the client asks for a change');
reset role;
select results_eq($$ select state, change_requested_at is not null from public.appointments where id = 'e0000000-0000-0000-0000-000000000002' $$,
  $$ values ('booked', true) $$, '… the appointment kept, the request marked');
select ok(exists (select 1 from public.audit_log where table_name = 'appointments' and record_id = 'e0000000-0000-0000-0000-000000000002'
                   and source = 'link:appointment_manage' and changed_fields ? 'change_requested_at'), '… audited under the link');
select results_eq($$ select importance, recipient_permission from public.notifications
                      where kind = 'appointments.change_request' and subject_id = 'e0000000-0000-0000-0000-000000000002'
                      order by recipient_permission $$,
  $$ values ('important', 'appointments.manage'), ('important', 'appointments.self') $$, '… the staff and the professional told');
set local role service_role;
select is(public.manage_appointment_by_link_for_service(extensions.digest('g-req', 'sha256'), 'cancel') ->> 'state', 'invalid',
  '… the link used: it cancels nothing after');
reset role;

-- =============================================================================
-- 6. Revoked by a move and by a failed email
-- =============================================================================
set local role service_role;
select ok(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m3')::uuid,
  extensions.digest('c-mv', 'sha256'), extensions.digest('g-mv', 'sha256')) ->> 'with_manage' = 'true', 'an email with the link');
reset role;
update public.appointments set starts_at = starts_at + interval '30 minutes', ends_at = ends_at + interval '30 minutes',
       blocks_until = blocks_until + interval '30 minutes'
 where id = 'e0000000-0000-0000-0000-000000000003';
set constraints all immediate;
set constraints all deferred;
select ok((select revoked_at is not null from public.secure_links where token_hash = extensions.digest('g-mv', 'sha256')),
  'a move revokes the manage link');
set local role service_role;
select is(public.manage_appointment_by_link_for_service(extensions.digest('g-mv', 'sha256'), 'cancel') ->> 'state', 'invalid',
  '… which cancels nothing');
select ok(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m4')::uuid,
  extensions.digest('c-fail2', 'sha256'), extensions.digest('g-fail', 'sha256')) ->> 'with_manage' = 'true', 'an email tried again, with the link');
select lives_ok($$ select public.finish_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m4')::uuid, false) $$,
  '… which fails');
reset role;
select ok((select revoked_at is not null from public.secure_links where token_hash = extensions.digest('g-fail', 'sha256')),
  '… its manage link revoked with its confirmation link');

-- =============================================================================
-- 7. The switch turned off, the module reserved (P3-40) or off
-- =============================================================================
set local role service_role;
select ok(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m5')::uuid,
  extensions.digest('c-off2', 'sha256'), extensions.digest('g-off2', 'sha256')) ->> 'with_manage' = 'true', 'an email with the link');
reset role;
select set_config('test.l_off', (select id::text from public.secure_links where token_hash = extensions.digest('g-off2', 'sha256')), true);
update public.appointment_settings set client_manage_links = false where org_id = 'b0000000-0000-0000-0000-00000000000a';
select is(public.resolve_appointment_manage_link(current_setting('test.l_off')::uuid), null, 'the switch off: the page shows nothing');
set local role service_role;
select is(public.manage_appointment_by_link_for_service(extensions.digest('g-off2', 'sha256'), 'cancel') ->> 'state', 'invalid',
  '… and the link does nothing');
reset role;
update public.appointment_settings set client_manage_links = true where org_id = 'b0000000-0000-0000-0000-00000000000a';
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';
select is(public.resolve_appointment_manage_link(current_setting('test.l_off')::uuid), null, 'reserved for testers: the page shows nothing (P3-40)');
set local role service_role;
select is(public.manage_appointment_by_link_for_service(extensions.digest('g-off2', 'sha256'), 'cancel') ->> 'state', 'invalid',
  '… and the link does nothing');
reset role;
update public.org_modules set testers_only = false, enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';
set local role service_role;
select is(public.manage_appointment_by_link_for_service(extensions.digest('g-off2', 'sha256'), 'cancel') ->> 'state', 'invalid',
  'the module off: the link does nothing');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';
select is((select state from public.appointments where id = 'e0000000-0000-0000-0000-000000000005'), 'booked', '… the appointment untouched');

-- =============================================================================
-- 8. The default templates; the privileges
-- =============================================================================
select is((select count(*)::int from public.email_template_defaults
            where key in ('appointments.confirmation', 'appointments.confirmation_en', 'appointments.reminder', 'appointments.reminder_en',
                          'appointments.changed', 'appointments.changed_en')
              and body like '%{{appointment.change_line}}%' and body not like '%call the clinic%' and body not like '%appelez la clinique%'
              and variables @> '[{"path": "appointment.change_line", "required": false}]'::jsonb), 6,
  'the six templates close with {{appointment.change_line}} (optional)');
select ok(not has_function_privilege('authenticated', 'public.manage_appointment_by_link_for_service(bytea, text)', 'execute')
          and not has_function_privilege('anon', 'public.manage_appointment_by_link_for_service(bytea, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.resolve_appointment_manage_link(uuid)', 'execute'),
  'the link''s functions: the service role only');
select ok(not has_function_privilege('anon', 'public.set_appointment_client_links(boolean)', 'execute'), 'the switch: never anon');

select * from finish();
rollback;
