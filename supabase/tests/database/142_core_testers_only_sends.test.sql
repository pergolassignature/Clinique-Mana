-- Core: P3-40 in the send paths (CC-14, migration *_core_testers_only_sends.sql). Covers, across
-- every email template of the catalogue: `get_email_context` says whether its module is open to
-- all; `queue_email` refuses (P0001, HINT module_reserved) to queue one of a module reserved for
-- its testers, but the test send, and queues it once the module is open; core templates are
-- always open. `private.send_sms` with `p_module`: a reserved module's automatic text is not
-- queued, a typed one is refused, the test goes; without it, unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function private.test_queue(p_org uuid, p_key text, p_subject text) returns text
language plpgsql set search_path = '' as $$
declare
  v_default public.email_template_defaults;
  v_hint text;
begin
  select d.* into v_default from public.email_template_defaults d where d.key = p_key;
  perform public.queue_email(p_org, p_key, 0, 'personne@exemple.test', null, p_subject, gen_random_uuid(),
                             v_default.view_permission, null, 0::smallint);
  return 'queued';
exception when sqlstate 'P0001' then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'refused');
end;
$$;

insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
-- Every module on, reserved for its testers.
insert into public.org_modules (org_id, module_key, enabled, testers_only)
select 'b0000000-0000-0000-0000-00000000000a', m.key, true, true from public.modules m where m.key <> 'core'
on conflict (org_id, module_key) do update set enabled = true, testers_only = true;

select is((public.get_email_context('b0000000-0000-0000-0000-00000000000a', 'appointments.video_link') ->> 'module_open')::boolean, false,
  'the context says a reserved module is not open');
select is((public.get_email_context('b0000000-0000-0000-0000-00000000000a', 'core.staff_invite') ->> 'module_open')::boolean, true,
  'core templates are always open');
select is_empty($$ select d.key from public.email_template_defaults d
                    where d.module_key not in ('core', 'professionals')
                      and private.test_queue('b0000000-0000-0000-0000-00000000000a', d.key, 'record') <> 'module_reserved' $$,
  'every template of a reserved module is refused, nothing queued');
select is((select count(*)::int from public.email_log where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, 'the log holds nothing');
select is((public.get_email_context('b0000000-0000-0000-0000-00000000000a', 'professionals.invite') ->> 'module_open')::boolean, true,
  'Professionnels is exempt');
select is_empty($$ select d.key from public.email_template_defaults d
                    where d.module_key not in ('core', 'professionals')
                      and private.test_queue('b0000000-0000-0000-0000-00000000000a', d.key, 'email_test') <> 'queued' $$,
  'the test send of every template still goes');
select is_empty($$ select d.key from public.email_template_defaults d
                    where d.module_key in ('core', 'professionals')
                      and private.test_queue('b0000000-0000-0000-0000-00000000000a', d.key, 'record') <> 'queued' $$,
  'core''s and Professionnels'' templates queue as before (P3-40''s exemption)');
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a';
select is_empty($$ select d.key from public.email_template_defaults d
                    where private.test_queue('b0000000-0000-0000-0000-00000000000a', d.key, 'record') <> 'queued' $$,
  'once open to all, every template queues');

-- Texts: Communications open, Rendez-vous reserved.
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';
select is(private.send_sms('b0000000-0000-0000-0000-00000000000a', '+15145550101', 'Rappel', 'reminder', null, null, false, null, 'appointments'),
  null, 'an automatic text of a reserved module is not queued');
select throws_ok($$ select private.send_sms('b0000000-0000-0000-0000-00000000000a', '+15145550101', 'Bonjour', 'reply', null, null, true, null, 'appointments') $$,
  'P0001', 'Les textos aux clients sont suspendus : le module est réservé aux testeurs.', 'a typed one is refused');
select throws_ok($$ select private.send_sms('b0000000-0000-0000-0000-00000000000a', '+15145550101', 'Rappel', 'reminder', null, null, false, null) $$,
  'P0001', null, 'without a module: unchanged (here, the consent rule refuses)');

select * from finish();
rollback;
