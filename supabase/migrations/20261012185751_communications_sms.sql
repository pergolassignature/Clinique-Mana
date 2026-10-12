-- =============================================================================
-- Communications: textos (SMS) through the clinic's Yeastar P-Series PBX — batch SM
-- =============================================================================
-- Plan:    docs/plans/2026-10-11-modules-coding-plan.md §11 (batch SM), roadmap §2.4 quater and
--          §3.4 (Jonathan, 2026-10-12: SMS before the cutover; « le même système que PS Hub »:
--          the Yeastar PBX OpenAPI, not Twilio), decisions R-52, R-54, SM-1 … SM-12.
-- Needs:   *_communications_module.sql (the module row; seeded again here, on conflict do nothing),
--          *_core_module_settings_secrets.sql (org_module_settings, org_secrets, Vault),
--          *_core_rate_limits_webhook_events.sql (webhook_events: the provider list gains yeastar),
--          *_core_scheduled_jobs.sql, *_core_notifications.sql (private.notify), *_core_tax_rates.sql
--          (private.clinic_today), *_professionals_reference_settings.sql (unaccent).
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6; docs/modules/core.md « How a
--          module plugs in » (data, never code: ADR 0003).
--
-- Key choices
-- * sms_consents (SM-2): one row per clinic and number (E.164), `opted_in` or `opted_out`, with
--   when, how (`source`: staff, sms_reply, import, form) and by whom (`updated_by`, the audit row):
--   what the LCAP asks. A person (`subject_type`, `subject_id`) is optional until Clients lands.
--   Audited, the number and the note redacted (personal data).
-- * sms_messages (SM-3): every text, in and out, keyed by the other party's number (the thread).
--   An operational log like email_log: not audited (it holds numbers and bodies; copying them
--   into audit_log forever would defeat the purge), listed in 000_invariants' exception list;
--   `private.job_sms_purge` nulls bodies after 12 months and numbers after 24 (SM-8).
-- * The queue (SM-4): a text is a row `queued` (`send_after` null: at once; else from that
--   moment), that the job communications.sms_dispatch (function sms-dispatch, every 15 minutes)
--   claims and sends; a staff reply (sms-send) is claimed at once by the function that sends it.
--   private.send_sms(...) is the plug-in Rendez-vous calls from its own definer RPCs (ADR 0003):
--   it refuses a number without a consent in force (P0001) and applies the business-hours rule
--   (SM-5, R-52: 8 h – 17 h, Monday to Friday, clinic time) to anything but an immediate send.
-- * No text ever leaves to a number whose consent is withdrawn, except the acknowledgement of
--   the withdrawal itself (kind `opt_out_ack`, what the LCAP expects) and a test to a staff
--   number (kind `test`, communications.sms_manage) (SM-6).
-- * Keywords (SM-7, private.sms_keyword): « ARRÊT », « ARRET », « STOP », « UNSUBSCRIBE »,
--   « CANCEL », « END », « QUIT » withdraw the consent at once; « OUI » / « YES » call
--   private.sms_confirmation_hook, a stub Rendez-vous replaces (create or replace) to confirm the
--   appointment; anything else is stored as an inbound text and raises a notice for the staff.
-- * The PBX session (SM-9): the OpenAPI access and refresh tokens live in Vault
--   (sms_provider_sessions holds their ids and expiries, never a value), written and read by
--   service-role RPCs only; a short lease (`lock_owner`, `locked_until`) serialises token refreshes
--   across function isolates (PS Hub's lock). The client secret and the webhook secret are org
--   secrets (`yeastar_client_secret`, `yeastar_webhook_secret`: SecretField, settings.integrations_manage).
-- * Settings (SM-10): org_module_settings, module communications, keys sms_base_url, sms_client_id,
--   sms_did, sms_consent_text, sms_opt_out_reply, each checked by private.validate_sms_setting;
--   their own RPC pair (get_sms_settings / set_sms_settings) next to the Gmail batch's.
-- * Role defaults for admin only (SM-11, CM-1): a default of a disabled module for another role
--   breaks core's role guards while the module is off; the clinic gives communications.sms to the
--   conseillères and the adjointe in « Utilisateurs et accès » once the module is on.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:communications_sms', true);

-- -----------------------------------------------------------------------------
-- Registry: the module, its SMS permissions, the admin defaults
-- -----------------------------------------------------------------------------
insert into public.modules (key, name) values ('communications', 'Communications') on conflict do nothing;

insert into public.permissions (key, module_key, description) values
  ('communications.sms', 'communications', 'Lire les textos et répondre aux clients'),
  ('communications.sms_manage', 'communications', 'Régler les textos (centrale, numéro, textes de consentement)')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'communications.sms'),
  ('admin', 'communications.sms_manage')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Webhook events: Yeastar joins the providers
-- -----------------------------------------------------------------------------
alter table public.webhook_events drop constraint webhook_events_provider_check;
alter table public.webhook_events
  add constraint webhook_events_provider_check check (provider in ('resend', 'documenso', 'yeastar'));

-- The same body as *_core_rate_limits_webhook_events.sql, with 'yeastar' allowed.
create or replace function public.claim_webhook_event(
  p_provider text,
  p_event_id text,
  p_org_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_lease_seconds int default 300
)
returns table (status text, id uuid, claim_token uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_token uuid;
  v_org uuid;
  v_status text;
begin
  if p_provider is null or p_provider not in ('resend', 'documenso', 'yeastar')
     or p_event_id is null or pg_catalog.length(p_event_id) not between 1 and 200
     or p_org_id is null
     or p_event_type is null or pg_catalog.length(p_event_type) not between 1 and 100
     or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 65536
     or p_lease_seconds is null or p_lease_seconds not between 1 and 3600 then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;

  -- 1. A new event.
  insert into public.webhook_events as w
    (provider, event_id, org_id, event_type, payload, claim_token, claimed_at, lease_expires_at)
  values
    (p_provider, p_event_id, p_org_id, p_event_type, p_payload, gen_random_uuid(), pg_catalog.now(),
     pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds))
  on conflict (provider, event_id) do nothing
  returning w.id, w.claim_token into v_id, v_token;
  if v_id is not null then
    return query select 'claimed'::text, v_id, v_token;
    return;
  end if;

  -- 2. A failed event, or one whose lease lapsed, of the same org. A concurrent takeover
  --    re-checks this condition after the row lock, so only one wins.
  update public.webhook_events as w
     set status = 'processing',
         event_type = p_event_type,
         payload = p_payload,
         claim_token = gen_random_uuid(),
         claimed_at = pg_catalog.now(),
         lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
         attempts = w.attempts + 1
   where w.provider = p_provider
     and w.event_id = p_event_id
     and w.org_id = p_org_id
     and (w.status = 'failed' or (w.status = 'processing' and w.lease_expires_at < pg_catalog.now()))
  returning w.id, w.claim_token into v_id, v_token;
  if v_id is not null then
    return query select 'claimed'::text, v_id, v_token;
    return;
  end if;

  -- 3. Otherwise: refused for another org, a duplicate, or held by a live lease.
  select w.org_id, w.status into v_org, v_status
    from public.webhook_events w
   where w.provider = p_provider and w.event_id = p_event_id;
  if found and v_org <> p_org_id then
    raise exception 'Fournisseur ou événement invalide.' using errcode = '22023';
  end if;
  return query select case when v_status = 'completed' then 'duplicate' else 'in_progress' end, null::uuid, null::uuid;
end;
$$;

-- -----------------------------------------------------------------------------
-- Helpers: numbers, keywords, business hours
-- -----------------------------------------------------------------------------
-- A typed or received number as E.164, or null: 10 digits → +1 (North America), 11 digits led
-- by 1 → +1…, a leading « + » with 8 to 15 digits kept as is. Letters, spaces and punctuation
-- are ignored (« (514) 555-1234 »).
create function private.sms_normalize_e164(p_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw text := pg_catalog.btrim(coalesce(p_input, ''));
  v_digits text := pg_catalog.regexp_replace(v_raw, '[^0-9]', '', 'g');
begin
  if v_digits = '' then
    return null;
  end if;
  if pg_catalog.left(v_raw, 1) = '+' then
    return case when v_digits ~ '^[1-9][0-9]{7,14}$' then '+' || v_digits end;
  end if;
  if pg_catalog.length(v_digits) = 10 and v_digits ~ '^[2-9]' then
    return '+1' || v_digits;
  end if;
  if pg_catalog.length(v_digits) = 11 and pg_catalog.left(v_digits, 1) = '1' then
    return '+' || v_digits;
  end if;
  return null;
end;
$$;

-- The keyword an inbound text is, if it is one (SM-7): 'stop' for « ARRÊT » / « ARRET » / « STOP »
-- / « UNSUBSCRIBE » / « CANCEL » / « END » / « QUIT », 'yes' for « OUI » / « YES », null otherwise.
-- Case and accents do not matter, nor spaces or punctuation around the word; the whole text must
-- be the keyword (« Stop. » is one; « stop l'envoi » is not).
create function private.sms_keyword(p_body text)
returns text
language sql
stable
set search_path = ''
as $$
  with w as (
    select pg_catalog.btrim(
             pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_body, ''))),
             E' \t\r\n.!,;:')
           as word
  )
  select case
           when w.word in ('stop', 'arret', 'unsubscribe', 'cancel', 'end', 'quit') then 'stop'
           when w.word in ('oui', 'yes') then 'yes'
         end
    from w
$$;

-- The first instant at or after p_at inside the clinic's business hours (SM-5, R-52): Monday to
-- Friday, 8 h to 17 h, clinic time. Inside them, p_at itself.
create function private.sms_business_send_after(p_org uuid, p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  v_local timestamp;
  v_day date;
  v_dow int;
  i int;
begin
  select o.timezone into v_tz from public.organizations o where o.id = p_org;
  if v_tz is null then
    raise exception 'Clinique inconnue.' using errcode = '22023';
  end if;
  v_local := p_at at time zone v_tz;
  v_day := v_local::date;
  for i in 0..8 loop
    v_dow := extract(isodow from v_day)::int;
    if v_dow <= 5 then
      if i = 0 and v_local::time >= time '08:00' and v_local::time < time '17:00' then
        return p_at;
      end if;
      if i > 0 or v_local::time < time '08:00' then
        return (v_day + time '08:00') at time zone v_tz;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return (v_day + time '08:00') at time zone v_tz;
end;
$$;

revoke all on function
  private.sms_normalize_e164(text),
  private.sms_keyword(text),
  private.sms_business_send_after(uuid, timestamptz)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Settings (org_module_settings, module communications; the SMS keys)
-- -----------------------------------------------------------------------------
create function private.sms_settings_defaults()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'sms_base_url', null,
    'sms_client_id', null,
    'sms_did', null,
    'sms_consent_text',
      'Vous acceptez de recevoir des textos de la clinique (rappels de rendez-vous et confirmations). Répondez ARRÊT pour ne plus en recevoir. Des frais de messagerie texte peuvent s''appliquer.',
    'sms_opt_out_reply',
      'Vous ne recevrez plus de textos de la clinique. Pour les recevoir de nouveau, communiquez avec nous.'
  )
$$;

-- The clinic's effective SMS settings: each known key, stored value else default.
create function private.sms_settings(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_object_agg(d.key, coalesce(s.settings -> d.key, d.value)), '{}'::jsonb)
    from pg_catalog.jsonb_each(private.sms_settings_defaults()) d
    left join public.org_module_settings s on s.org_id = p_org and s.module_key = 'communications'
$$;

-- The rule of each SMS key (22023 for a developer error, P0001 for what the form should have
-- caught: the page validates first, the database checks again).
create function private.validate_sms_setting(p_key text, p_value jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v jsonb := coalesce(p_value, 'null'::jsonb);
  v_text text;
begin
  case p_key
    when 'sms_base_url' then   -- https://… to a host, no query, or null
      if pg_catalog.jsonb_typeof(v) = 'null' then return; end if;
      v_text := pg_catalog.rtrim(pg_catalog.btrim(v #>> '{}'), '/');
      if pg_catalog.jsonb_typeof(v) <> 'string' or v_text !~ '^https://[a-z0-9.-]+(:[0-9]{2,5})?$' then
        raise exception 'L''adresse de la centrale doit commencer par https:// et ne contenir que son nom d''hôte (par exemple https://pbx.exemple.com).' using errcode = 'P0001';
      end if;
    when 'sms_client_id' then  -- the OpenAPI client id, or null
      if pg_catalog.jsonb_typeof(v) = 'null' then return; end if;
      if pg_catalog.jsonb_typeof(v) <> 'string' or pg_catalog.length(pg_catalog.btrim(v #>> '{}')) not between 1 and 200 then
        raise exception 'L''identifiant de l''application doit compter de 1 à 200 caractères.' using errcode = 'P0001';
      end if;
    when 'sms_did' then        -- the clinic's SMS number, E.164, or null
      if pg_catalog.jsonb_typeof(v) = 'null' then return; end if;
      if pg_catalog.jsonb_typeof(v) <> 'string' or private.sms_normalize_e164(v #>> '{}') is null then
        raise exception 'Le numéro de la clinique doit être un numéro à 10 chiffres (par exemple 418 555-0199).' using errcode = 'P0001';
      end if;
    when 'sms_consent_text', 'sms_opt_out_reply' then  -- French text, 20 to 480 characters
      if pg_catalog.jsonb_typeof(v) <> 'string' or pg_catalog.length(pg_catalog.btrim(v #>> '{}')) not between 20 and 480 then
        raise exception 'Le texte doit compter de 20 à 480 caractères.' using errcode = 'P0001';
      end if;
      if p_key = 'sms_consent_text'
         and pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, v #>> '{}')) !~ '\marret\M' then
        raise exception 'Le texte de consentement doit dire comment se désabonner : il doit contenir le mot ARRÊT.' using errcode = 'P0001';
      end if;
    else
      raise exception 'Réglage inconnu : %', coalesce(p_key, '(null)') using errcode = '22023';
  end case;
end;
$$;

revoke all on function
  private.sms_settings_defaults(),
  private.sms_settings(uuid),
  private.validate_sms_setting(text, jsonb)
from public, anon, authenticated, service_role;

create function public.get_sms_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('communications.sms') then
    raise exception 'Permission refusée : communications.sms' using errcode = '42501';
  end if;
  return private.sms_settings(private.current_user_org_id());
end;
$$;

-- Merges a patch of known keys (communications.sms_manage); returns the effective settings. The
-- number is stored as E.164 whatever was typed.
create function public.set_sms_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_patch jsonb := p_patch;
  r record;
begin
  if not private.has_permission('communications.sms_manage') then
    raise exception 'Permission refusée : communications.sms_manage' using errcode = '42501';
  end if;
  if v_patch is null or pg_catalog.jsonb_typeof(v_patch) <> 'object' then
    raise exception 'Réglages invalides : objet JSON attendu' using errcode = '22023';
  end if;
  for r in select e.key, e.value from pg_catalog.jsonb_each(v_patch) e loop
    perform private.validate_sms_setting(r.key, r.value);
  end loop;
  if v_patch ? 'sms_did' and pg_catalog.jsonb_typeof(v_patch -> 'sms_did') = 'string' then
    v_patch := v_patch || pg_catalog.jsonb_build_object('sms_did', private.sms_normalize_e164(v_patch ->> 'sms_did'));
  end if;
  if v_patch ? 'sms_base_url' and pg_catalog.jsonb_typeof(v_patch -> 'sms_base_url') = 'string' then
    v_patch := v_patch || pg_catalog.jsonb_build_object('sms_base_url', pg_catalog.rtrim(pg_catalog.btrim(v_patch ->> 'sms_base_url'), '/'));
  end if;

  if v_patch <> '{}'::jsonb then
    perform pg_catalog.set_config('app.audit_source', 'rpc:set_sms_settings', true);
    insert into public.org_module_settings as s (org_id, module_key, settings, updated_by)
    values (v_org, 'communications', v_patch, auth.uid())
    on conflict (org_id, module_key) do update
      set settings = s.settings || excluded.settings,
          updated_by = excluded.updated_by;
    perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  end if;
  return private.sms_settings(v_org);
end;
$$;

-- -----------------------------------------------------------------------------
-- sms_consents (SM-2)
-- -----------------------------------------------------------------------------
create table public.sms_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null check (status in ('opted_in', 'opted_out')),
  -- How the consent (or its withdrawal) was obtained: by the staff (phone, in person), by the
  -- person's own text (« ARRÊT », or a later keyword), an import, a form.
  source text not null check (source in ('staff', 'sms_reply', 'import', 'form')),
  -- The person, once Clients exists ('client', 'relation'); free until then.
  subject_type text check (subject_type is null or subject_type ~ '^[a-z_]{2,40}$'),
  subject_id uuid,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  note text check (note is null or pg_catalog.length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  unique (org_id, phone_e164),
  -- In force: granted, not withdrawn. Withdrawn: the withdrawal's time, the grant's kept (history).
  check (case when status = 'opted_in' then granted_at is not null and withdrawn_at is null
              else withdrawn_at is not null end),
  check ((subject_type is null) = (subject_id is null))
);
create index sms_consents_updated_by_idx on public.sms_consents (updated_by);
create index sms_consents_subject_idx on public.sms_consents (org_id, subject_type, subject_id) where subject_id is not null;

create trigger sms_consents_set_updated_at
  before update on public.sms_consents
  for each row execute function private.set_updated_at();
-- Loi 25: the number and the note never reach the append-only log.
create trigger sms_consents_audit
  after insert or update or delete on public.sms_consents
  for each row execute function private.audit_trigger('phone_e164', 'note');

alter table public.sms_consents enable row level security;
revoke all on public.sms_consents from anon, authenticated;
grant select on public.sms_consents to authenticated;

create policy sms_consents_select on public.sms_consents
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('communications.sms'))
  );

-- The consent in force for a number: 'opted_in', 'opted_out', or null when nothing is recorded.
create function private.sms_consent_status(p_org uuid, p_phone_e164 text)
returns text
language sql
stable
set search_path = ''
as $$
  select c.status from public.sms_consents c where c.org_id = p_org and c.phone_e164 = p_phone_e164
$$;

-- Records a withdrawal (the person texted a stop word, or the staff on her behalf). Idempotent.
create function private.sms_record_opt_out(p_org uuid, p_phone_e164 text, p_source text, p_actor uuid default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.sms_consents as c (org_id, phone_e164, status, source, granted_at, withdrawn_at, updated_by)
  values (p_org, p_phone_e164, 'opted_out', p_source, null, pg_catalog.now(), p_actor)
  on conflict (org_id, phone_e164) do update
     set status = 'opted_out',
         source = excluded.source,
         withdrawn_at = pg_catalog.now(),
         updated_by = excluded.updated_by
   where c.status <> 'opted_out';
end;
$$;

revoke all on function
  private.sms_consent_status(uuid, text),
  private.sms_record_opt_out(uuid, text, text, uuid)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- sms_messages (SM-3) and the thread view
-- -----------------------------------------------------------------------------
create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  -- The other party's number (the thread key); nulled after 24 months (SM-8).
  peer_e164 text check (peer_e164 is null or peer_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- The clinic's number the text went through, as the PBX knows it.
  did_e164 text check (did_e164 is null or did_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- Why it was sent: a staff reply, a reminder (Rendez-vous), the consent notice, the
  -- acknowledgement of a withdrawal, a test; inbound texts are 'inbound'.
  kind text not null check (kind in ('inbound', 'reply', 'reminder', 'confirmation', 'changed', 'consent_notice', 'opt_out_ack', 'test', 'other')),
  body text check (body is null or pg_catalog.length(body) <= 1600),
  body_purged_at timestamptz,
  -- Inbound MMS attachments: name, type and size only (never downloaded, SM-12).
  media jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(media) = 'array'),
  status text not null check (status in ('queued', 'sending', 'sent', 'failed', 'received')),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  provider text not null default 'yeastar' check (provider in ('yeastar')),
  provider_msg_id bigint,
  provider_session_id bigint,
  -- Our idempotency key for the PBX (`request_id`, at most 127 characters there).
  request_id text check (request_id is null or request_id ~ '^[a-z0-9-]{1,64}$'),
  -- What the text is about (an appointment, later): `subject_type` names the record kind.
  subject_type text check (subject_type is null or subject_type ~ '^[a-z_]{2,40}$'),
  subject_id uuid,
  -- Null: at once; else not before this instant (the business-hours rule).
  send_after timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  sent_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  check ((direction = 'in') = (kind = 'inbound')),
  check ((direction = 'in') = (status = 'received')),
  check ((subject_type is null) = (subject_id is null))
);
create index sms_messages_thread_idx on public.sms_messages (org_id, peer_e164, created_at desc);
create index sms_messages_dispatch_idx on public.sms_messages (org_id, status, send_after) where status in ('queued', 'sending');
create index sms_messages_created_idx on public.sms_messages (created_at);
create index sms_messages_sent_by_idx on public.sms_messages (sent_by);
create index sms_messages_subject_idx on public.sms_messages (org_id, subject_type, subject_id) where subject_id is not null;
-- A PBX message id is recorded once (a webhook retry is a no-op).
create unique index sms_messages_provider_msg_idx on public.sms_messages (org_id, provider, provider_msg_id) where provider_msg_id is not null;

create trigger sms_messages_set_updated_at
  before update on public.sms_messages
  for each row execute function private.set_updated_at();

alter table public.sms_messages enable row level security;
revoke all on public.sms_messages from anon, authenticated;
grant select on public.sms_messages to authenticated;

create policy sms_messages_select on public.sms_messages
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and (select private.has_permission('communications.sms'))
  );

-- One row per number the clinic texted with: the latest text (preview), counts, the consent in
-- force. The tables' RLS scopes the rows (security_invoker).
create view public.sms_threads with (security_invoker = true) as
with latest as (
  select distinct on (m.org_id, m.peer_e164)
         m.org_id, m.peer_e164, m.created_at, m.direction, m.status, m.body, m.body_purged_at, m.media
    from public.sms_messages m
   where m.peer_e164 is not null
   order by m.org_id, m.peer_e164, m.created_at desc
),
counts as (
  select m.org_id, m.peer_e164,
         count(*)::int as message_count,
         max(m.created_at) filter (where m.direction = 'in') as last_inbound_at
    from public.sms_messages m
   where m.peer_e164 is not null
   group by m.org_id, m.peer_e164
)
select l.org_id,
       l.peer_e164,
       l.created_at as last_message_at,
       l.direction as last_direction,
       l.status as last_status,
       l.body as last_body,
       l.body_purged_at is not null as last_body_purged,
       pg_catalog.jsonb_array_length(l.media) > 0 as last_has_media,
       c.message_count,
       c.last_inbound_at,
       k.status as consent_status,
       k.subject_type,
       k.subject_id
  from latest l
  join counts c on c.org_id = l.org_id and c.peer_e164 = l.peer_e164
  left join public.sms_consents k on k.org_id = l.org_id and k.phone_e164 = l.peer_e164;

revoke all on public.sms_threads from anon, authenticated;
grant select on public.sms_threads to authenticated;

-- -----------------------------------------------------------------------------
-- The queue: private.send_sms, the plug-in (SM-4, SM-6)
-- -----------------------------------------------------------------------------
-- Queues a text for p_to (any typed form; stored as E.164) from a module's definer RPC, after
-- its own permission check. Refuses (P0001, French) a number that cannot be read, or one without
-- a consent in force, unless p_kind is 'opt_out_ack' (the acknowledgement of a withdrawal) or
-- 'test'. p_at_once: sent at the next dispatch (a reply, a confirmation); otherwise from the next
-- business hours (reminders). Returns the message id.
create function private.send_sms(
  p_org uuid,
  p_to text,
  p_body text,
  p_kind text,
  p_subject_type text default null,
  p_subject_id uuid default null,
  p_at_once boolean default false,
  p_actor uuid default null
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
revoke all on function private.send_sms(uuid, text, text, text, text, uuid, boolean, uuid) from public, anon, authenticated, service_role;

-- « OUI » / « YES » from a number (SM-7): Rendez-vous replaces this stub (create or replace, the
-- same signature) to confirm the person's next appointment; until then nothing is confirmed.
-- Returns true when something was confirmed.
create function private.sms_confirmation_hook(p_org uuid, p_phone_e164 text, p_message_id uuid)
returns boolean
language sql
set search_path = ''
as $$
  select false
$$;
revoke all on function private.sms_confirmation_hook(uuid, text, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The staff's consent entry (communications.sms)
-- -----------------------------------------------------------------------------
-- Records the consent a person gave (by phone, in person: p_note says how) or withdrew, for a
-- number; `opted_in` also queues the consent notice (the text with « ARRÊT »), sent at once, so
-- the person knows how to withdraw. Returns the consent row.
create function public.set_sms_consent(
  p_phone text,
  p_status text,
  p_subject_type text default null,
  p_subject_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_phone text := private.sms_normalize_e164(p_phone);
  v_note text := pg_catalog.nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_row public.sms_consents%rowtype;
begin
  if not private.has_permission('communications.sms') then
    raise exception 'Permission refusée : communications.sms' using errcode = '42501';
  end if;
  if v_phone is null then
    raise exception 'Le numéro de téléphone n''est pas valide : indiquez un numéro à 10 chiffres.' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('opted_in', 'opted_out') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if pg_catalog.length(v_note) > 500 then
    raise exception 'La note doit compter au plus 500 caractères.' using errcode = 'P0001';
  end if;
  if (p_subject_type is null) <> (p_subject_id is null) then
    raise exception 'Invalid subject' using errcode = '22023';
  end if;

  if p_status = 'opted_in' then
    insert into public.sms_consents as c (org_id, phone_e164, status, source, subject_type, subject_id, granted_at, withdrawn_at, note, updated_by)
    values (v_org, v_phone, 'opted_in', 'staff', p_subject_type, p_subject_id, pg_catalog.now(), null, v_note, auth.uid())
    on conflict (org_id, phone_e164) do update
       set status = 'opted_in',
           source = 'staff',
           subject_type = coalesce(excluded.subject_type, c.subject_type),
           subject_id = coalesce(excluded.subject_id, c.subject_id),
           granted_at = case when c.status = 'opted_in' then c.granted_at else pg_catalog.now() end,
           withdrawn_at = null,
           note = coalesce(excluded.note, c.note),
           updated_by = excluded.updated_by
    returning * into v_row;
    if v_row.granted_at = pg_catalog.now() then
      -- A new consent: the notice with the withdrawal word, at once.
      perform private.send_sms(v_org, v_phone, private.sms_settings(v_org) ->> 'sms_consent_text', 'consent_notice',
                               null, null, true, auth.uid());
    end if;
  else
    perform private.sms_record_opt_out(v_org, v_phone, 'staff', auth.uid());
    update public.sms_consents c
       set note = coalesce(v_note, c.note),
           subject_type = coalesce(p_subject_type, c.subject_type),
           subject_id = coalesce(p_subject_id, c.subject_id)
     where c.org_id = v_org and c.phone_e164 = v_phone
    returning * into v_row;
  end if;
  return pg_catalog.to_jsonb(v_row);
end;
$$;

-- -----------------------------------------------------------------------------
-- Service-role RPCs: the send path (sms-send, sms-dispatch)
-- -----------------------------------------------------------------------------
-- A staff reply or a test (sms-send): checks the actor (an active member of p_org holding
-- communications.sms, or .sms_manage for a test), queues the text and claims it at once for the
-- caller to send (status `sending`). A reply needs the consent (private.send_sms). Returns
-- { id, to_e164, body, request_id }.
create function public.queue_sms_for_service(
  p_org_id uuid,
  p_actor uuid,
  p_to text,
  p_body text,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[];
  v_id uuid;
  v_row public.sms_messages%rowtype;
begin
  if p_org_id is null or p_actor is null or p_kind is null or p_kind not in ('reply', 'test') then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active') then
    raise exception 'Permission refusée : communications.sms' using errcode = '42501';
  end if;
  v_keys := private.permission_keys_for(p_actor);
  if not (case when p_kind = 'test' then 'communications.sms_manage' else 'communications.sms' end = any (v_keys)) then
    raise exception 'Permission refusée : %', case when p_kind = 'test' then 'communications.sms_manage' else 'communications.sms' end
      using errcode = '42501';
  end if;
  v_id := private.send_sms(p_org_id, p_to, p_body, p_kind, null, null, true, p_actor);
  update public.sms_messages m
     set status = 'sending', claimed_at = pg_catalog.now(), attempts = 1,
         request_id = 'mana-' || v_id::text
   where m.id = v_id
  returning * into v_row;
  return pg_catalog.jsonb_build_object('id', v_row.id, 'to_e164', v_row.peer_e164, 'body', v_row.body, 'request_id', v_row.request_id);
end;
$$;

-- The dispatch (sms-dispatch, job communications.sms_dispatch): first fails as
-- `provider_unavailable` the rows left `sending` for over 15 minutes (a send cut between the
-- claim and its outcome; the outcome is unknown, a later delivery event may still move it);
-- then claims up to p_limit due rows (`queued`, `send_after` passed), oldest first, skipping
-- rows another run holds. A due row whose consent is no longer in force fails `consent_withdrawn`
-- instead (SM-6). Returns the claimed rows.
create function public.claim_sms_batch_for_service(p_org_id uuid, p_limit int default 20)
returns table (id uuid, to_e164 text, body text, kind text, request_id text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_org_id is null or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  update public.sms_messages m
     set status = 'failed', error_code = 'provider_unavailable'
   where m.org_id = p_org_id and m.status = 'sending' and m.claimed_at < pg_catalog.now() - interval '15 minutes';

  update public.sms_messages m
     set status = 'failed', error_code = 'consent_withdrawn'
   where m.org_id = p_org_id and m.status = 'queued'
     and m.kind not in ('opt_out_ack', 'test')
     and private.sms_consent_status(p_org_id, m.peer_e164) is distinct from 'opted_in';

  return query
    with due as (
      select m.id
        from public.sms_messages m
       where m.org_id = p_org_id and m.status = 'queued'
         and (m.send_after is null or m.send_after <= pg_catalog.now())
       order by m.created_at
       limit p_limit
         for update skip locked
    )
    update public.sms_messages m
       set status = 'sending', claimed_at = pg_catalog.now(), attempts = m.attempts + 1,
           request_id = coalesce(m.request_id, 'mana-' || m.id::text)
      from due
     where m.id = due.id
    returning m.id, m.peer_e164, m.body, m.kind, m.request_id;
end;
$$;

-- The PBX accepted the text: `sent`, with its ids (the delivery report moves it on).
create function public.mark_sms_sent(p_org_id uuid, p_id uuid, p_provider_msg_id bigint, p_provider_session_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sms_messages m
     set status = 'sent', sent_at = pg_catalog.now(), error_code = null,
         provider_msg_id = p_provider_msg_id, provider_session_id = p_provider_session_id
   where m.org_id = p_org_id and m.id = p_id and m.status = 'sending';
  if not found then
    raise exception 'Texto inconnu ou déjà réglé.' using errcode = '22023';
  end if;
end;
$$;

-- The send failed, with a code (`not_configured`, `provider_error`, `provider_rejected`,
-- `provider_unreachable`, …).
create function public.mark_sms_failed(p_org_id uuid, p_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  update public.sms_messages m
     set status = 'failed', error_code = p_error_code
   where m.org_id = p_org_id and m.id = p_id and m.status = 'sending';
  if not found then
    raise exception 'Texto inconnu ou déjà réglé.' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Service-role RPCs: the webhook (inbound texts, delivery reports)
-- -----------------------------------------------------------------------------
-- An inbound text (event 30031 from an external number). Records it (a PBX message id seen
-- before answers `duplicate`), reads the keyword (SM-7): 'stop' withdraws the consent and queues
-- the acknowledgement, claimed at once for the webhook to send; 'yes' calls the confirmation
-- hook; otherwise a notice tells the staff a text arrived (never its content or number). The
-- module must be enabled (`ignored` otherwise, nothing stored).
-- Returns { outcome, message_id, keyword, opted_out, confirmed, ack: { id, to_e164, body, request_id } | null }.
create function public.record_inbound_sms(
  p_org_id uuid,
  p_from text,
  p_did text,
  p_body text,
  p_media jsonb,
  p_provider_msg_id bigint,
  p_provider_session_id bigint,
  p_received_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text := private.sms_normalize_e164(p_from);
  v_did text := private.sms_normalize_e164(p_did);
  v_body text := pg_catalog.left(coalesce(p_body, ''), 1600);
  v_media jsonb := case when pg_catalog.jsonb_typeof(p_media) = 'array' then p_media else '[]'::jsonb end;
  v_id uuid;
  v_keyword text;
  v_ack public.sms_messages%rowtype;
  v_confirmed boolean := false;
  v_was_opted_in boolean;
begin
  if p_org_id is null or p_provider_msg_id is null then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'communications') then
    return pg_catalog.jsonb_build_object('outcome', 'ignored');
  end if;
  if v_from is null then
    return pg_catalog.jsonb_build_object('outcome', 'unreadable_number');
  end if;

  insert into public.sms_messages (org_id, direction, peer_e164, did_e164, kind, body, media, status,
                                   provider_msg_id, provider_session_id, created_at, sent_at)
  values (p_org_id, 'in', v_from, v_did, 'inbound', pg_catalog.nullif(v_body, ''), v_media, 'received',
          p_provider_msg_id, p_provider_session_id, coalesce(p_received_at, pg_catalog.now()), coalesce(p_received_at, pg_catalog.now()))
  on conflict (org_id, provider, provider_msg_id) where provider_msg_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'duplicate');
  end if;

  v_keyword := private.sms_keyword(v_body);
  if v_keyword = 'stop' then
    v_was_opted_in := private.sms_consent_status(p_org_id, v_from) = 'opted_in';
    perform private.sms_record_opt_out(p_org_id, v_from, 'sms_reply');
    -- The acknowledgement, claimed for the webhook to send now (best effort: a failure shows in
    -- the thread as « Échec », the withdrawal itself stands).
    insert into public.sms_messages (org_id, direction, peer_e164, did_e164, kind, body, status, claimed_at, attempts)
    values (p_org_id, 'out', v_from, v_did, 'opt_out_ack', private.sms_settings(p_org_id) ->> 'sms_opt_out_reply', 'sending', pg_catalog.now(), 1)
    returning * into v_ack;
    update public.sms_messages m set request_id = 'mana-' || v_ack.id::text where m.id = v_ack.id returning * into v_ack;
    perform private.notify(
      p_org_id, 'communications', 'communications.sms_opted_out', 'normal', 'Retrait du consentement aux textos',
      'Une personne a répondu ARRÊT : plus aucun texto ne lui sera envoyé.',
      '/textos?message=' || v_id::text, 'sms_message', v_id,
      'communications.sms', null, 'sms_opted_out:' || v_id::text, pg_catalog.now() + interval '30 days');
  else
    if v_keyword = 'yes' then
      v_confirmed := private.sms_confirmation_hook(p_org_id, v_from, v_id);
    end if;
    perform private.notify(
      p_org_id, 'communications', 'communications.sms_received', 'normal', 'Nouveau texto reçu',
      case when v_confirmed then 'Une personne a confirmé par texto.' else 'Une personne a écrit au numéro de la clinique.' end,
      '/textos?message=' || v_id::text, 'sms_message', v_id,
      'communications.sms', null, 'sms_received:' || v_id::text, pg_catalog.now() + interval '30 days');
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', 'recorded',
    'message_id', v_id,
    'keyword', v_keyword,
    'opted_out', v_keyword = 'stop',
    'confirmed', v_confirmed,
    'ack', case when v_ack.id is null then null
                else pg_catalog.jsonb_build_object('id', v_ack.id, 'to_e164', v_ack.peer_e164, 'body', v_ack.body, 'request_id', v_ack.request_id) end);
end;
$$;

-- A delivery report (event 30032) for a text we sent: `sent` (delivered by the PBX's account) or
-- `failed` with the PBX's error code. 'applied', 'not_found' (no row with that message id), or
-- 'ignored' (the module is off, or the row is final the other way).
create function public.apply_sms_delivery_event(p_org_id uuid, p_provider_msg_id bigint, p_status text, p_error_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.sms_messages%rowtype;
begin
  if p_org_id is null or p_provider_msg_id is null or p_status is null or p_status not in ('sent', 'failed')
     or (p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,64}$') then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'communications') then
    return 'ignored';
  end if;
  select * into v_row from public.sms_messages m
   where m.org_id = p_org_id and m.provider = 'yeastar' and m.provider_msg_id = p_provider_msg_id and m.direction = 'out'
   for update;
  if not found then
    return 'not_found';
  end if;
  if v_row.status not in ('sending', 'sent', 'failed') then
    return 'ignored';
  end if;
  update public.sms_messages m
     set status = p_status,
         error_code = case when p_status = 'failed' then coalesce(p_error_code, 'provider_failed') else null end,
         sent_at = coalesce(m.sent_at, pg_catalog.now())
   where m.id = v_row.id;
  return 'applied';
end;
$$;

-- -----------------------------------------------------------------------------
-- The PBX session (SM-9): tokens in Vault, a lease for refreshes
-- -----------------------------------------------------------------------------
create table public.sms_provider_sessions (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  base_url text,
  access_secret_id uuid,
  refresh_secret_id uuid,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  -- The SMS channel of the clinic's number, as the PBX names it (read once, kept 10 minutes).
  channel_name text check (channel_name is null or pg_catalog.length(channel_name) <= 100),
  channel_cached_at timestamptz,
  lock_owner uuid,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create trigger sms_provider_sessions_set_updated_at
  before update on public.sms_provider_sessions
  for each row execute function private.set_updated_at();

-- The Vault entries never outlive the row (an organization deleted, a session cleared).
create function private.sms_provider_sessions_delete_vault()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets vs where vs.id in (old.access_secret_id, old.refresh_secret_id);
  return null;
end;
$$;
revoke all on function private.sms_provider_sessions_delete_vault() from public, anon, authenticated, service_role;

create trigger sms_provider_sessions_delete_vault
  after delete on public.sms_provider_sessions
  for each row execute function private.sms_provider_sessions_delete_vault();

alter table public.sms_provider_sessions enable row level security;
revoke all on public.sms_provider_sessions from anon, authenticated;

-- Everything a function needs to reach the PBX for p_org, in one read: the module gate, the
-- settings, the client secret, the session (tokens decrypted from Vault, for the function only),
-- the cached channel, the clinic's texts. Service role only; nothing of it reaches a client.
create function public.get_sms_provider_context(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := private.sms_settings(p_org_id);
  v_session public.sms_provider_sessions%rowtype;
  v_access text;
  v_refresh text;
  v_client_secret text;
  v_name text;
begin
  if p_org_id is null then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  select o.name into v_name from public.organizations o where o.id = p_org_id;
  if v_name is null then
    raise exception 'Clinique inconnue.' using errcode = '22023';
  end if;
  select ds.decrypted_secret into v_client_secret
    from public.org_secrets s join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
   where s.org_id = p_org_id and s.key = 'yeastar_client_secret';
  select * into v_session from public.sms_provider_sessions s where s.org_id = p_org_id;
  if v_session.access_secret_id is not null then
    select ds.decrypted_secret into v_access from vault.decrypted_secrets ds where ds.id = v_session.access_secret_id;
  end if;
  if v_session.refresh_secret_id is not null then
    select ds.decrypted_secret into v_refresh from vault.decrypted_secrets ds where ds.id = v_session.refresh_secret_id;
  end if;
  return pg_catalog.jsonb_build_object(
    'module_enabled', public.module_enabled_for_org(p_org_id, 'communications'),
    'clinic_name', v_name,
    'base_url', v_settings ->> 'sms_base_url',
    'client_id', v_settings ->> 'sms_client_id',
    'client_secret', v_client_secret,
    'did', v_settings ->> 'sms_did',
    'consent_text', v_settings ->> 'sms_consent_text',
    'opt_out_reply', v_settings ->> 'sms_opt_out_reply',
    'session', case when v_session.org_id is null or v_access is null then null
                    else pg_catalog.jsonb_build_object(
                      'base_url', v_session.base_url,
                      'access_token', v_access,
                      'refresh_token', v_refresh,
                      'access_expires_at', v_session.access_expires_at,
                      'refresh_expires_at', v_session.refresh_expires_at) end,
    'channel', case when v_session.channel_name is null or v_session.channel_cached_at < pg_catalog.now() - interval '10 minutes' then null
                    else v_session.channel_name end);
end;
$$;

-- Takes the refresh lease for p_org (p_ttl_seconds, 5 to 180): true when p_owner now holds it
-- (a free lease, a lapsed one, or its own). PS Hub's acquire_yeastar_openapi_token_lock.
create function public.acquire_sms_provider_lock(p_org_id uuid, p_owner uuid, p_ttl_seconds int default 120)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl int := greatest(5, least(coalesce(p_ttl_seconds, 120), 180));
  v_taken boolean;
begin
  if p_org_id is null or p_owner is null then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sms_provider_lock:' || p_org_id::text, 0));
  insert into public.sms_provider_sessions as s (org_id, lock_owner, locked_until)
  values (p_org_id, p_owner, pg_catalog.now() + pg_catalog.make_interval(secs => v_ttl))
  on conflict (org_id) do update
     set lock_owner = excluded.lock_owner, locked_until = excluded.locked_until
   where s.locked_until is null or s.locked_until <= pg_catalog.now() or s.lock_owner = p_owner;
  v_taken := found;
  return v_taken;
end;
$$;

-- Releases p_owner's lease (a no-op for anyone else).
create function public.release_sms_provider_lock(p_org_id uuid, p_owner uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sms_provider_sessions s
     set lock_owner = null, locked_until = null
   where s.org_id = p_org_id and s.lock_owner = p_owner
$$;

-- Stores a fresh session: the tokens go to Vault (created once, then updated in place), the row
-- keeps their ids and expiries. A null refresh token removes the stored one.
create function public.store_sms_provider_session(
  p_org_id uuid,
  p_base_url text,
  p_access_token text,
  p_refresh_token text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.sms_provider_sessions%rowtype;
  v_access_id uuid;
  v_refresh_id uuid;
begin
  if p_org_id is null or coalesce(pg_catalog.length(p_access_token), 0) = 0 or coalesce(pg_catalog.length(p_base_url), 0) = 0
     or p_access_expires_at is null then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  insert into public.sms_provider_sessions (org_id) values (p_org_id) on conflict (org_id) do nothing;
  select * into v_row from public.sms_provider_sessions s where s.org_id = p_org_id for update;

  if v_row.access_secret_id is null then
    v_access_id := vault.create_secret(p_access_token, format('sms_session:%s:access', p_org_id));
  else
    perform vault.update_secret(v_row.access_secret_id, p_access_token);
    v_access_id := v_row.access_secret_id;
  end if;

  if p_refresh_token is null then
    if v_row.refresh_secret_id is not null then
      delete from vault.secrets vs where vs.id = v_row.refresh_secret_id;
    end if;
    v_refresh_id := null;
  elsif v_row.refresh_secret_id is null then
    v_refresh_id := vault.create_secret(p_refresh_token, format('sms_session:%s:refresh', p_org_id));
  else
    perform vault.update_secret(v_row.refresh_secret_id, p_refresh_token);
    v_refresh_id := v_row.refresh_secret_id;
  end if;

  update public.sms_provider_sessions s
     set base_url = p_base_url,
         access_secret_id = v_access_id,
         refresh_secret_id = v_refresh_id,
         access_expires_at = p_access_expires_at,
         refresh_expires_at = p_refresh_expires_at
   where s.org_id = p_org_id;
end;
$$;

-- Remembers the SMS channel's name for the clinic's number (10 minutes, get_sms_provider_context).
create function public.set_sms_provider_channel(p_org_id uuid, p_channel_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or coalesce(pg_catalog.length(p_channel_name), 0) not between 1 and 100 then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  insert into public.sms_provider_sessions as s (org_id, channel_name, channel_cached_at)
  values (p_org_id, p_channel_name, pg_catalog.now())
  on conflict (org_id) do update
     set channel_name = excluded.channel_name, channel_cached_at = excluded.channel_cached_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- Jobs: the dispatch (function) and the purge (SQL, SM-8)
-- -----------------------------------------------------------------------------
-- Bodies (and attachment names) after 12 months, numbers after 24; rows stay (counts). Batches
-- of 5 000 keep each statement bounded.
create function private.job_sms_purge()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_batch bigint;
  v_bodies bigint := 0;
  v_numbers bigint := 0;
begin
  loop
    update public.sms_messages m set body = null, media = '[]'::jsonb, body_purged_at = pg_catalog.now()
     where m.id in (select x.id from public.sms_messages x
                     where x.body_purged_at is null
                       and x.created_at < pg_catalog.now() - interval '12 months'
                     limit 5000);
    get diagnostics v_batch = row_count;
    v_bodies := v_bodies + v_batch;
    exit when v_batch < 5000;
  end loop;
  loop
    update public.sms_messages m set peer_e164 = null, did_e164 = null
     where m.id in (select x.id from public.sms_messages x
                     where x.peer_e164 is not null
                       and x.created_at < pg_catalog.now() - interval '24 months'
                     limit 5000);
    get diagnostics v_batch = row_count;
    v_numbers := v_numbers + v_batch;
    exit when v_batch < 5000;
  end loop;
  return 'bodies_purged=' || v_bodies || ' numbers_purged=' || v_numbers;
end;
$$;
revoke all on function private.job_sms_purge() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('communications.sms_dispatch', 'communications', 'Envoi des textos',
   'Envoie les textos en attente (rappels aux heures ouvrables, réponses et confirmations sans délai) par la centrale téléphonique.',
   'function', 'sms-dispatch', null, 'communications.sms_dispatch', null, false),
  ('communications.sms_purge', 'communications', 'Effacement des textos',
   'Efface le contenu des textos après 12 mois et les numéros après 24 mois. Les envois restent comptés.',
   'sql', null, 'private.job_sms_purge', 'communications.sms_purge', null, true)
on conflict do nothing;

select cron.schedule('communications.sms_dispatch', '*/15 * * * *',
  $$select private.invoke_job_function('communications.sms_dispatch')$$);
select cron.schedule('communications.sms_purge', '35 8 * * *',
  $$select private.run_sql_job('communications.sms_purge')$$);

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  public.get_sms_settings(),
  public.set_sms_settings(jsonb),
  public.set_sms_consent(text, text, text, uuid, text),
  public.queue_sms_for_service(uuid, uuid, text, text, text),
  public.claim_sms_batch_for_service(uuid, int),
  public.mark_sms_sent(uuid, uuid, bigint, bigint),
  public.mark_sms_failed(uuid, uuid, text),
  public.record_inbound_sms(uuid, text, text, text, jsonb, bigint, bigint, timestamptz),
  public.apply_sms_delivery_event(uuid, bigint, text, text),
  public.get_sms_provider_context(uuid),
  public.acquire_sms_provider_lock(uuid, uuid, int),
  public.release_sms_provider_lock(uuid, uuid),
  public.store_sms_provider_session(uuid, text, text, text, timestamptz, timestamptz),
  public.set_sms_provider_channel(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.get_sms_settings(),
  public.set_sms_settings(jsonb),
  public.set_sms_consent(text, text, text, uuid, text)
to authenticated;

grant execute on function
  public.queue_sms_for_service(uuid, uuid, text, text, text),
  public.claim_sms_batch_for_service(uuid, int),
  public.mark_sms_sent(uuid, uuid, bigint, bigint),
  public.mark_sms_failed(uuid, uuid, text),
  public.record_inbound_sms(uuid, text, text, text, jsonb, bigint, bigint, timestamptz),
  public.apply_sms_delivery_event(uuid, bigint, text, text),
  public.get_sms_provider_context(uuid),
  public.acquire_sms_provider_lock(uuid, uuid, int),
  public.release_sms_provider_lock(uuid, uuid),
  public.store_sms_provider_session(uuid, text, text, text, timestamptz, timestamptz),
  public.set_sms_provider_channel(uuid, text)
to service_role;
