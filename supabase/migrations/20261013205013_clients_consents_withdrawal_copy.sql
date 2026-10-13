-- =============================================================================
-- Clients: a consent withdrawn, its signed copy emailed, how long its PDF is kept (batch C5b, part 1)
-- =============================================================================
-- Plan:    docs/plans/2026-10-11-modules-coding-plan.md §6 « C5 » (C5b.1, C5b.2); decisions R-50,
--          CC-16 … CC-18 in the decisions log.
-- Needs:   *_clients_consents.sql (client_consents, the settings, required_consents_for, the
--          status view), *_clients_consents_handlers.sql (private.clients_consent_signers),
--          *_core_stored_files_retention.sql (private.set_stored_files_retention), core email.
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6; P3-40.
--
-- Key choices
-- * Withdrawal (CC-16): `withdraw_client_consent(id, note)` (clients.manage) marks the consent in
--   force « Retiré » from now: `withdrawn_at`, `withdrawn_by` and the note (3 to 500 characters,
--   no invisible characters; redacted in the audit log, removed by an anonymisation, CC-10). The row
--   and its sealed PDF stay: the history. From then on, wherever it is read, the consent is no
--   longer in force: `required_consents_for` answers `missing` (or `pending` once a new request is
--   out), so every appointment and waiting-list entry that needs it shows it missing again. Its
--   `each_time` answer no longer counts a request whose consent was withdrawn. A new signature
--   later is a new consent in force.
-- * The signed copy (CC-17): `prepare_client_consent_copy_for_service(org, actor, consent)` is
--   what `clients-consent-send` (action `copy`) asks: the people who sign for the client today
--   (R-48: the client from 14, else the authorised parents; the one who signed years ago for a
--   child is not asked again), those with an address, the client's language, and the sealed PDF's
--   object. Refused in French: the module reserved for its testers (P3-40, HINT `module_reserved`),
--   an anonymised file, no PDF (an imported GOrendezvous signature) or one no longer kept, no one
--   with an address. The function emails it (template `clients.consent_signed_copy`, or `_en`, the
--   PDF attached), then `mark_client_consent_copy_sent_for_service` records `copy_sent_at` /
--   `copy_sent_by` (audited: Historique), shown as « Copie envoyée le … ».
-- * Retention (CC-18): `client_consent_settings.signed_pdf_retention_years`, **null by default**:
--   nothing is purged until the clinic (Christine, R-50) sets a duration (1 to 50 years). Once set,
--   the sealed PDF of an ended consent — withdrawn, replaced by a newer signature, or of an
--   anonymised file — and the signed request's source PDF get `retain_until` = the end + N years,
--   through core's private.set_stored_files_retention; `storage-cleanup` then purges them like any
--   file past its date. A consent in force is never limited. Changing the duration recomputes every
--   date of the clinic; clearing it keeps everything again (dates removed). Kept up to date by
--   triggers on the consents (withdrawn, superseded) and on the clients (anonymised).
-- * Additive: nullable columns, an index, new functions and two triggers, the settings RPC, the
--   status view (columns added at its end) and required_consents_for replaced with their signatures.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_consents_withdrawal_copy', true);

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.client_consent_settings
  add column signed_pdf_retention_years int,
  add constraint client_consent_settings_retention_years_check check (signed_pdf_retention_years between 1 and 50);

alter table public.client_consents
  add column copy_sent_at timestamptz,
  add column copy_sent_by uuid,
  add constraint client_consents_copy_sent_by_fkey foreign key (copy_sent_by)
    references public.profiles (user_id) on delete set null;
create index client_consents_copy_sent_by_idx on public.client_consents (copy_sent_by) where copy_sent_by is not null;

-- -----------------------------------------------------------------------------
-- Retention of the sealed PDFs (CC-18)
-- -----------------------------------------------------------------------------
-- The purge dates of the sealed (and source) PDFs of p_org's consents, of one client or all:
-- an ended consent's = its end + the clinic's years; none without a duration or for a consent in
-- force. Returns how many files changed.
create function private.clients_consent_retention_sync(p_org uuid, p_client_id uuid default null)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_years int;
  v_count int := 0;
  r record;
begin
  select s.signed_pdf_retention_years into v_years from public.client_consent_settings s where s.org_id = p_org;
  for r in
    select c.signed_file_id,
           -- least() ignores nulls: the first of the withdrawal, the replacement, the anonymisation.
           least(c.withdrawn_at, c.superseded_at, k.anonymized_at) as ended_at,
           (select pg_catalog.array_agg(x.source_file_id) from public.signature_requests x
             where x.org_id = c.org_id and x.signed_file_id = c.signed_file_id and x.source_file_id is not null) as sources
      from public.client_consents c
      join public.clients k on k.org_id = c.org_id and k.id = c.client_id
     where c.org_id = p_org and c.signed_file_id is not null
       and (p_client_id is null or c.client_id = p_client_id)
  loop
    v_count := v_count + private.set_stored_files_retention(
      p_org, array['signing_signed', 'signing_source'],
      array[r.signed_file_id] || coalesce(r.sources, '{}'::uuid[]),
      case when v_years is null or r.ended_at is null then null
           else r.ended_at + pg_catalog.make_interval(years => v_years) end);
  end loop;
  return v_count;
end;
$$;
revoke all on function private.clients_consent_retention_sync(uuid, uuid) from public, anon, authenticated, service_role;

-- A consent withdrawn, replaced, moved or given its PDF: its client's dates again.
create function private.clients_consent_retention_on_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.clients_consent_retention_sync(new.org_id, new.client_id);
  return null;
end;
$$;
revoke all on function private.clients_consent_retention_on_consent() from public, anon, authenticated, service_role;

create trigger client_consents_retention
  after update of withdrawn_at, superseded_at, signed_file_id, client_id on public.client_consents
  for each row
  when (old.withdrawn_at is distinct from new.withdrawn_at or old.superseded_at is distinct from new.superseded_at
        or old.signed_file_id is distinct from new.signed_file_id or old.client_id is distinct from new.client_id)
  execute function private.clients_consent_retention_on_consent();

-- A file anonymised: its consents have ended.
create function private.clients_consent_retention_on_client()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.clients_consent_retention_sync(new.org_id, new.id);
  return null;
end;
$$;
revoke all on function private.clients_consent_retention_on_client() from public, anon, authenticated, service_role;

create trigger clients_consent_retention
  after update of anonymized_at on public.clients
  for each row
  when (old.anonymized_at is distinct from new.anonymized_at)
  execute function private.clients_consent_retention_on_client();

-- -----------------------------------------------------------------------------
-- Settings: *_clients_consents.sql's, with the retention duration
-- -----------------------------------------------------------------------------
create or replace function public.set_client_consent_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.client_consent_settings%rowtype;
  v_years int;
  v_key text;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Invalid settings' using errcode = '22023';
  end if;
  for v_key in select k from pg_catalog.jsonb_object_keys(p_patch) k loop
    if v_key not in ('due_days_before_first_appointment', 'reminder_days', 'pre_appointment_reminder_hours', 'retention_policy',
                     'signed_pdf_retention_years') then
      raise exception 'Réglage inconnu : %', v_key using errcode = '22023';
    end if;
  end loop;
  insert into public.client_consent_settings (org_id) values (v_org) on conflict do nothing;
  select s.signed_pdf_retention_years into v_years from public.client_consent_settings s where s.org_id = v_org;
  begin
    update public.client_consent_settings s
       set due_days_before_first_appointment = case when p_patch ? 'due_days_before_first_appointment'
                                                    then (p_patch ->> 'due_days_before_first_appointment')::int
                                                    else s.due_days_before_first_appointment end,
           reminder_days = case when p_patch ? 'reminder_days' then (p_patch ->> 'reminder_days')::int else s.reminder_days end,
           pre_appointment_reminder_hours = case when p_patch ? 'pre_appointment_reminder_hours'
                                                 then (p_patch ->> 'pre_appointment_reminder_hours')::int
                                                 else s.pre_appointment_reminder_hours end,
           retention_policy = case when p_patch ? 'retention_policy'
                                   then nullif(pg_catalog.btrim(coalesce(p_patch ->> 'retention_policy', '')), '')
                                   else s.retention_policy end,
           signed_pdf_retention_years = case when p_patch ? 'signed_pdf_retention_years'
                                             then (p_patch ->> 'signed_pdf_retention_years')::int
                                             else s.signed_pdf_retention_years end,
           updated_by = auth.uid()
     where s.org_id = v_org
    returning * into v_row;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Un réglage est hors des limites : rappel de 1 à 30 jours, délai de 0 à 30 jours, préavis de 12 à 168 heures, conservation de 1 à 50 ans.'
      using errcode = 'P0001', hint = 'settings';
  end;
  if v_row.signed_pdf_retention_years is distinct from v_years then
    perform private.clients_consent_retention_sync(v_org, null);
  end if;
  return pg_catalog.to_jsonb(v_row) - 'org_id';
end;
$$;

-- -----------------------------------------------------------------------------
-- Withdrawal (CC-16)
-- -----------------------------------------------------------------------------
-- « Retirer le consentement »: the consent in force p_id is withdrawn from now, with the note.
-- Returns its withdrawn_at. P0001: unknown (HINT consent), no longer in force (state), an
-- anonymised file (client), the note (note).
create function public.withdraw_client_consent(p_id uuid, p_note text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.client_consents%rowtype;
  v_note text := pg_catalog.btrim(coalesce(p_note, ''), E' \t\r\n');
  v_at timestamptz := pg_catalog.now();
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  select * into v_row from public.client_consents c where c.id = p_id and c.org_id = v_org for update;
  if v_row.id is null then
    raise exception 'Consentement introuvable.' using errcode = 'P0001', hint = 'consent';
  end if;
  if v_row.withdrawn_at is not null or v_row.superseded_at is not null then
    raise exception 'Ce consentement n''est plus en vigueur.' using errcode = 'P0001', hint = 'state';
  end if;
  if exists (select 1 from public.clients k where k.org_id = v_org and k.id = v_row.client_id and k.anonymized_at is not null) then
    raise exception 'Ce dossier client est anonymisé.' using errcode = 'P0001', hint = 'client';
  end if;
  if pg_catalog.char_length(v_note) < 3 or pg_catalog.char_length(v_note) > 500
     or v_note ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    raise exception 'Notez la raison du retrait et comment il a été reçu (3 à 500 caractères).'
      using errcode = 'P0001', hint = 'note';
  end if;
  update public.client_consents c
     set withdrawn_at = v_at, withdrawn_by = auth.uid(), withdrawal_note = v_note
   where c.id = v_row.id;
  return v_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- What a situation needs: *_clients_consents.sql's, a withdrawn consent's request no longer counts
-- -----------------------------------------------------------------------------
create or replace function private.required_consents_for(
  p_org uuid,
  p_client_id uuid,
  p_service_code text default null,
  p_payer_kind text default null,
  p_professional_status text default null,
  p_situations text[] default '{}',
  p_context_type text default null,
  p_context_id uuid default null
)
returns table (consent_key text, frequency text, state text)
language sql
stable
set search_path = ''
as $$
  with applicable as (
    select r.consent_key, case when pg_catalog.bool_or(r.frequency = 'each_time') then 'each_time' else 'once' end as frequency
      from public.client_consent_rules r
      join public.client_consent_types t on t.org_id = r.org_id and t.key = r.consent_key and t.is_active
     where r.org_id = p_org and r.is_active
       and (r.trigger_kind = 'general'
            or (r.trigger_kind = 'service' and r.target = p_service_code)
            or (r.trigger_kind = 'payer_kind' and r.target = p_payer_kind)
            or (r.trigger_kind = 'professional_status' and r.target = p_professional_status)
            or (r.trigger_kind = 'situation' and r.target = any (coalesce(p_situations, '{}'))))
     group by r.consent_key
  )
  select a.consent_key, a.frequency,
         case
           when a.frequency = 'each_time' then
             case when exists (select 1 from public.client_consent_requests q
                                where q.org_id = p_org and q.client_id = p_client_id and q.consent_key = a.consent_key
                                  and q.state = 'signed' and q.context_type = p_context_type and q.context_id = p_context_id
                                  and not exists (select 1 from public.client_consents w
                                                   where w.org_id = q.org_id and w.request_id = q.id and w.withdrawn_at is not null))
                  then 'signed'
                  when exists (select 1 from public.client_consent_requests q
                                where q.org_id = p_org and q.client_id = p_client_id and q.consent_key = a.consent_key
                                  and q.state = 'pending')
                  then 'pending'
                  else 'missing' end
           when exists (select 1 from public.client_consents c
                         where c.org_id = p_org and c.client_id = p_client_id and c.consent_key = a.consent_key
                           and c.superseded_at is null and c.withdrawn_at is null and c.resign_requested_at is null)
             then 'signed'
           when exists (select 1 from public.client_consent_requests q
                         where q.org_id = p_org and q.client_id = p_client_id and q.consent_key = a.consent_key
                           and q.state = 'pending')
             then 'pending'
           when exists (select 1 from public.client_consents c
                         where c.org_id = p_org and c.client_id = p_client_id and c.consent_key = a.consent_key
                           and c.superseded_at is null and c.withdrawn_at is null)
             then 'resign'
           else 'missing'
         end
    from applicable a
$$;

-- -----------------------------------------------------------------------------
-- The status view: *_clients_consents.sql's, with the consent's id, withdrawal, PDF and copy
-- -----------------------------------------------------------------------------
create or replace view public.client_consents_status with (security_invoker = true) as
select coalesce(c.org_id, q.org_id) as org_id,
       coalesce(c.client_id, q.client_id) as client_id,
       coalesce(c.consent_key, q.consent_key) as consent_key,
       case when q.id is not null then case when q.due_at < pg_catalog.now() then 'overdue' else 'pending' end
            when c.withdrawn_at is not null then 'withdrawn'
            when c.resign_requested_at is not null then 'resign'
            else 'signed' end as state,
       c.version_label, c.signed_at, q.id as request_id, q.due_at, q.last_sent_at,
       c.id as consent_id, c.withdrawn_at, c.signed_file_id, c.source, c.copy_sent_at,
       -- Whether the consent shown is in force (a pending request may be out for a new signature).
       (c.id is not null and c.withdrawn_at is null) as in_force
  from (select distinct on (k.org_id, k.client_id, k.consent_key) k.*
          from public.client_consents k
         where k.superseded_at is null
         order by k.org_id, k.client_id, k.consent_key, k.withdrawn_at nulls first, k.signed_at desc) c
  full join (select r.* from public.client_consent_requests r where r.state = 'pending') q
    on q.org_id = c.org_id and q.client_id = c.client_id and q.consent_key = c.consent_key;

-- -----------------------------------------------------------------------------
-- The signed copy (CC-17; service role: clients-consent-send, action `copy`)
-- -----------------------------------------------------------------------------
-- Who receives the sealed PDF of consent p_consent_id, in which language, and where the PDF is.
-- { consent_id, language, consent_name, client_first_name, clinic_name, signed_on (the clinic's
--   date), file: { bucket, object_path }, recipients: [{ role, first_name, email }] }
create function public.prepare_client_consent_copy_for_service(p_org_id uuid, p_actor uuid, p_consent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.client_consents%rowtype;
  v_client public.clients%rowtype;
  v_file public.stored_files%rowtype;
  v_signers jsonb;
  v_out jsonb := '[]';
  v_signer jsonb;
  v_person public.clients%rowtype;
  v_tz text;
begin
  if p_org_id is null or p_actor is null or p_consent_id is null then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'clients') then
    raise exception 'Module disabled' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active')
     or not ('clients.manage' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  -- P3-40: nothing leaves for a client while the module is reserved for its testers.
  if not public.module_open_to_all_for_org(p_org_id, 'clients') then
    raise exception 'Le module Clients est réservé aux testeurs : aucune copie ne part aux clients avant son ouverture à tous.'
      using errcode = 'P0001', hint = 'module_reserved';
  end if;
  select * into v_row from public.client_consents c where c.org_id = p_org_id and c.id = p_consent_id;
  if v_row.id is null then
    raise exception 'Consentement introuvable.' using errcode = 'P0001', hint = 'consent';
  end if;
  select * into v_client from public.clients c where c.org_id = p_org_id and c.id = v_row.client_id;
  if v_client.anonymized_at is not null then
    raise exception 'Ce dossier client est anonymisé.' using errcode = 'P0001', hint = 'client';
  end if;
  if v_row.signed_file_id is null then
    raise exception 'Ce consentement n''a pas de PDF signé à envoyer : sa signature vient de GOrendezvous.'
      using errcode = 'P0001', hint = 'file';
  end if;
  select * into v_file from public.stored_files f where f.org_id = p_org_id and f.id = v_row.signed_file_id;
  if v_file.id is null or v_file.status <> 'ready'
     or (v_file.retain_until is not null and v_file.retain_until <= pg_catalog.now()) then
    raise exception 'Le PDF signé de ce consentement n''est plus conservé.' using errcode = 'P0001', hint = 'file';
  end if;
  -- Who signs for the client today (R-48), each with an address and an active file.
  v_signers := private.clients_consent_signers(p_org_id, v_client.id);
  for v_signer in select s from pg_catalog.jsonb_array_elements(v_signers) s loop
    select * into v_person from public.clients c where c.org_id = p_org_id and c.id = (v_signer ->> 'signer_client_id')::uuid;
    if v_person.email is not null and v_person.anonymized_at is null then
      v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'role', v_signer ->> 'role', 'first_name', v_person.first_name, 'email', v_person.email));
    end if;
  end loop;
  if pg_catalog.jsonb_array_length(v_out) = 0 then
    raise exception 'Personne ne peut recevoir la copie : ajoutez une adresse courriel au dossier de la personne qui signe.'
      using errcode = 'P0001', hint = 'signer_email';
  end if;
  select o.timezone into v_tz from public.organizations o where o.id = p_org_id;
  return pg_catalog.jsonb_build_object(
    'consent_id', v_row.id,
    'language', v_client.language,
    'consent_name', (select case when v_client.language = 'en' then t.name_en else t.name_fr end
                       from public.client_consent_types t where t.org_id = p_org_id and t.key = v_row.consent_key),
    'client_first_name', v_client.first_name,
    'clinic_name', (select o.name from public.organizations o where o.id = p_org_id),
    'signed_on', ((v_row.signed_at at time zone coalesce(v_tz, 'America/Toronto'))::date)::text,
    'file', pg_catalog.jsonb_build_object('bucket', v_file.bucket, 'object_path', v_file.object_path),
    'recipients', v_out);
end;
$$;

-- The copy left for at least one person: recorded on the consent (audited). Returns copy_sent_at.
create function public.mark_client_consent_copy_sent_for_service(p_org_id uuid, p_consent_id uuid, p_actor uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := pg_catalog.now();
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_org_id is null or p_consent_id is null or p_actor is null then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  update public.client_consents c
     set copy_sent_at = v_at,
         copy_sent_by = case when exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id)
                             then p_actor end
   where c.org_id = p_org_id and c.id = p_consent_id;
  if not found then
    raise exception 'Consentement introuvable.' using errcode = 'P0001', hint = 'consent';
  end if;
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- Email templates: the signed copy, French and English (the PDF attached)
-- -----------------------------------------------------------------------------
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission,
   recipient_mode, allows_attachments)
values
  ('clients.consent_signed_copy', 'clients',
   'Copie d''un consentement signé',
   'Envoyé à la demande du client (ou de son parent ou tuteur) avec le PDF signé de son consentement en pièce jointe.',
   'Vous recevez ce courriel parce que vous avez demandé une copie d''un consentement signé à la clinique.',
   'Copie signée : {{consent.name}} — {{clinic.name}}',
   E'Bonjour {{recipient.first_name}},\n\n'
   'Comme demandé, voici la copie signée du formulaire « {{consent.name}} » de {{client.first_name}}, signé le {{consent.signed_on}}. '
   'Le PDF est joint à ce courriel.\n\n'
   'Pour toute question, communiquez avec la clinique.',
   null,
   '[
     {"path": "recipient.first_name", "label": "Prénom de la personne qui reçoit la copie", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "client.first_name", "label": "Prénom du client", "sample": "Léa", "required": true, "kind": "text"},
     {"path": "consent.name", "label": "Nom du consentement", "sample": "Consentement général", "required": true, "kind": "text"},
     {"path": "consent.signed_on", "label": "Date de la signature", "sample": "2026-10-13", "required": true, "kind": "date"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"}
   ]',
   'clients.view', 'subject', true),
  ('clients.consent_signed_copy_en', 'clients',
   'Copie d''un consentement signé (anglais)',
   'La copie d''un consentement signé, envoyée en anglais quand la langue du client est l''anglais.',
   'You receive this email because you asked the clinic for a copy of a signed consent form.',
   'Signed copy: {{consent.name}} — {{clinic.name}}',
   E'Hello {{recipient.first_name}},\n\n'
   'As requested, here is the signed copy of the form "{{consent.name}}" for {{client.first_name}}, signed on {{consent.signed_on}}. '
   'The PDF is attached to this email.\n\n'
   'If you have any question, please contact the clinic.',
   null,
   '[
     {"path": "recipient.first_name", "label": "Prénom de la personne qui reçoit la copie", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "client.first_name", "label": "Prénom du client", "sample": "Léa", "required": true, "kind": "text"},
     {"path": "consent.name", "label": "Nom du consentement", "sample": "General consent", "required": true, "kind": "text"},
     {"path": "consent.signed_on", "label": "Date de la signature", "sample": "2026-10-13", "required": true, "kind": "date"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"}
   ]',
   'clients.view', 'subject', true)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  public.withdraw_client_consent(uuid, text),
  public.prepare_client_consent_copy_for_service(uuid, uuid, uuid),
  public.mark_client_consent_copy_sent_for_service(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.withdraw_client_consent(uuid, text) to authenticated;
revoke execute on function public.withdraw_client_consent(uuid, text) from service_role;
grant execute on function
  public.prepare_client_consent_copy_for_service(uuid, uuid, uuid),
  public.mark_client_consent_copy_sent_for_service(uuid, uuid, uuid)
to service_role;
