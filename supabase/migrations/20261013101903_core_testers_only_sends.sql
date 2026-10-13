-- =============================================================================
-- Core: P3-40 enforced in the send paths themselves (CC-14, defense in depth)
-- =============================================================================
-- P3-40: while a module is « Réservé aux testeurs », nothing of it reaches a client. Each module
-- keeps its own guard (Demandes' booking page, Rendez-vous' messages, AP-26); the core send paths
-- now refuse too, so a missed guard can never let an email or a text out:
-- * `get_email_context` says whether the template's module is open to all (`module_open`);
--   `sendTemplatedEmail` refuses a typed send (`module_reserved`) and skips an automatic one
--   (logged, nothing queued), the template's test send excepted.
-- * `queue_email` refuses (P0001, HINT `module_reserved`) to queue an email of a reserved module,
--   but a test send (`subject_type = 'email_test'`).
-- * `private.send_sms` gains `p_module` (default null: unchanged for its callers): with it, a text
--   of a reserved module is refused when typed and not queued when automatic, as Communications'
--   own rule already does.
-- Core's and Professionnels' templates are never held (`private.module_sends_held`: P3-40's exemption). Same signatures but `send_sms` (one optional
-- argument added; its grants unchanged: none).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:core_testers_only_sends', true);

-- Whether a module's sends are held back (P3-40): it is reserved for its testers. Core and
-- Professionnels never are (core's emails go to the clinic's own people; Professionnels is live and
-- writes to its professionals, not to clients: P3-40's exemption).
create function private.module_sends_held(p_org uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_module is not null and p_module not in ('core', 'professionals')
     and not public.module_open_to_all_for_org(p_org, p_module)
$$;
revoke all on function private.module_sends_held(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.get_email_context(p_org_id uuid, p_template_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
begin
  select pg_catalog.jsonb_build_object(
           'module_key', d.module_key,
           'module_enabled', public.module_enabled_for_org(o.id, d.module_key),
           'module_open', not private.module_sends_held(o.id, d.module_key),
           'timezone', o.timezone,
           'template', pg_catalog.jsonb_build_object(
             'key', d.key,
             'version', coalesce(t.version, 0),
             'subject', coalesce(t.subject, d.subject),
             'body', coalesce(t.body, d.body),
             'button_label', case when t.org_id is null then d.button_label else t.button_label end,
             'why_line', d.why_line,
             'variables', d.variables,
             'view_permission', d.view_permission,
             'recipient_mode', d.recipient_mode,
             'allows_attachments', d.allows_attachments),
           'sender', pg_catalog.jsonb_build_object(
             'from_name', s.from_name,
             'from_address', s.from_address,
             'reply_to', coalesce(s.reply_to, case when private.is_mailbox(o.email) then o.email end)),
           'clinic', pg_catalog.jsonb_build_object(
             'name', o.name,
             'address_line1', o.address_line1,
             'address_line2', o.address_line2,
             'city', o.city,
             'province', o.province,
             'postal_code', o.postal_code,
             'phone', o.phone,
             'website', o.website,
             'privacy_officer_name', o.privacy_officer_name,
             'privacy_officer_email', o.privacy_officer_email))
    into v_context
    from public.email_template_defaults d
   cross join public.organizations o
    join public.email_settings s on s.org_id = o.id
    left join public.email_templates t on t.org_id = o.id and t.key = d.key
   where d.key = p_template_key and o.id = p_org_id;
  if v_context is null then
    raise exception 'Organisation ou modèle de courriel inconnu' using errcode = '22023';
  end if;
  return v_context;
end;
$$;

create or replace function public.queue_email(
  p_org_id uuid,
  p_template_key text,
  p_template_version int,
  p_to_email text,
  p_to_profile_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_view_permission text,
  p_sent_by uuid,
  p_attachment_count smallint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_default public.email_template_defaults%rowtype;
  v_version int;
  v_id uuid;
begin
  select * into v_default from public.email_template_defaults d where d.key = p_template_key;
  if not found then
    raise exception 'Modèle de courriel inconnu' using errcode = '22023';
  end if;
  if p_to_email is null then
    raise exception 'Adresse du destinataire manquante' using errcode = '22023';
  end if;
  if p_view_permission is distinct from v_default.view_permission then
    raise exception 'Permission de consultation différente de celle du modèle' using errcode = '22023';
  end if;
  select coalesce((select t.version from public.email_templates t
                    where t.org_id = p_org_id and t.key = p_template_key), 0)
    into v_version;
  if p_template_version is distinct from v_version then
    raise exception 'Version du modèle différente de la version en vigueur' using errcode = '22023';
  end if;
  if (p_to_profile_id is not null
      and not exists (select 1 from public.profiles p where p.user_id = p_to_profile_id and p.org_id = p_org_id))
     or (p_sent_by is not null
         and not exists (select 1 from public.profiles p where p.user_id = p_sent_by and p.org_id = p_org_id)) then
    raise exception 'Destinataire ou expéditeur hors de l''organisation' using errcode = '22023';
  end if;

  -- P3-40, enforced here too (CC-14): nothing of a module reserved for its testers is queued, but
  -- the template's own test send (« M'envoyer un test »).
  if p_subject_type is distinct from 'email_test'
     and private.module_sends_held(p_org_id, v_default.module_key) then
    raise exception 'Les courriels de ce module sont suspendus : il est réservé aux testeurs.'
      using errcode = 'P0001', hint = 'module_reserved';
  end if;

  insert into public.email_log
    (org_id, module_key, template_key, template_version, to_email, to_profile_id,
     subject_type, subject_id, view_permission, sent_by, attachment_count)
  values
    (p_org_id, v_default.module_key, p_template_key, p_template_version, p_to_email, p_to_profile_id,
     p_subject_type, p_subject_id, p_view_permission, p_sent_by, p_attachment_count)
  returning id into v_id;
  return v_id;
end;
$$;

drop function private.send_sms(uuid, text, text, text, text, uuid, boolean, uuid);
create function private.send_sms(
  p_org uuid,
  p_to text,
  p_body text,
  p_kind text,
  p_subject_type text default null,
  p_subject_id uuid default null,
  p_at_once boolean default false,
  p_actor uuid default null,
  p_module text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_to text := private.sms_normalize_e164(p_to);
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_consent text;
  v_id uuid;
begin
  if p_kind not in ('opt_out_ack', 'test')
     and (not public.module_open_to_all_for_org(p_org, 'communications')
          or private.module_sends_held(p_org, p_module)) then
    if p_kind in ('reply', 'other') then
      if not public.module_open_to_all_for_org(p_org, 'communications') then
        raise exception 'Les textos aux clients sont suspendus : le module Communications est réservé aux testeurs.'
          using errcode = 'P0001', hint = 'module_reserved';
      end if;
      raise exception 'Les textos aux clients sont suspendus : le module est réservé aux testeurs.'
        using errcode = 'P0001', hint = 'module_reserved';
    end if;
    return null;
  end if;
  if v_to is null then
    raise exception 'Le numéro de téléphone n''est pas valide : indiquez un numéro à 10 chiffres.' using errcode = 'P0001';
  end if;
  if v_body = '' or pg_catalog.length(v_body) > 1600 then
    raise exception 'Le texto doit compter de 1 à 1600 caractères.' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('reply', 'reminder', 'confirmation', 'changed', 'consent_notice', 'opt_out_ack', 'test', 'other') then
    raise exception 'Invalid kind' using errcode = '22023';
  end if;
  if p_kind not in ('opt_out_ack', 'test') then
    v_consent := private.sms_consent_status(p_org, v_to);
    if v_consent is distinct from 'opted_in' then
      raise exception 'Aucun texto ne peut être envoyé à ce numéro : la personne n''a pas donné son consentement, ou l''a retiré.'
        using errcode = 'P0001', hint = coalesce(v_consent, 'no_consent');
    end if;
  end if;
  insert into public.sms_messages (org_id, direction, peer_e164, kind, body, status, subject_type, subject_id, send_after, sent_by)
  values (p_org, 'out', v_to, p_kind, v_body, 'queued', p_subject_type, p_subject_id,
          case when p_at_once then null else private.sms_business_send_after(p_org, pg_catalog.now()) end,
          p_actor)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.send_sms(uuid, text, text, text, text, uuid, boolean, uuid, text) from public, anon, authenticated, service_role;
