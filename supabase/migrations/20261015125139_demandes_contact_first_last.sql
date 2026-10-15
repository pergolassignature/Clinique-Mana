-- =============================================================================
-- Demandes: the contact's « Prénom » and « Nom » (Jonathan, 2026-10-15, D-56, révisable)
-- =============================================================================
-- A request typed before its file existed had one `contact_name`. Client files have a first and a
-- last name, and « Nouveau client » from a request had to guess where one ends; the lookup of
-- existing files (D-55) compares first and last names the way Clients' duplicate rule does. So:
-- * `contact_first_name` and `contact_last_name` (1–100 characters each, tidy, like Clients'
--   names). A last name needs a first name (on the phone people sometimes give only a first name).
-- * **`contact_name` is kept, maintained** (`first || ' ' || last`) by the BEFORE trigger
--   `demandes_contact_names`, so every reader (the inbox's person and search, the discovery calls,
--   the waiting list, the offers, the volume script) keeps working unchanged. A writer that still
--   sends `contact_name` alone (none in the app after this migration; an old tab mid-deploy, the
--   anonymisation's blanking) has it split the backfill's way. When the parts are written, they
--   win. It is not dropped in this release (conventions §1: additive).
-- * Backfill: the first word of `contact_name` → first name, the rest → last name (null when one
--   word). Done before the trigger exists, so `contact_name` itself never changes.
-- * The rule stays: someone to call back (a file, a name, an email or a phone:
--   `demandes_contact_check`, true through `contact_name`). The counselor's forms also require the
--   first name without a file; the database does not, so the website's form, an email or an
--   import with an address alone are still taken (révisable).
-- * Writers: `create_demande` / `update_demande` accept `contact_first_name` / `contact_last_name`
--   (`private.demandes_intake_keys`, `demandes_insert`, `update_demande`); the booking page writes
--   the two names it asks; the emails' « Bonjour <prénom> » read `contact_first_name`
--   (`demandes_recipient`, `waitlist_email_of`, the booking's duplicate answer).
-- * Both columns are redacted in the journal, as `contact_name` is.
-- * A request with a file keeps its typed contact (D-57): « Changer de dossier » or a file removed
--   brings it back; the anonymisation of the file blanks it as before.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_contact_first_last', true);

-- -----------------------------------------------------------------------------
-- Columns, checks, backfill
-- -----------------------------------------------------------------------------
alter table public.demandes
  add column contact_first_name text,
  add column contact_last_name text;

-- The backfill: first word / the rest, before any check or trigger (contact_name is untouched).
update public.demandes d
   set contact_first_name = nullif(pg_catalog.btrim(pg_catalog.left(s.parts[1], 100)), ''),
       contact_last_name = nullif(pg_catalog.btrim(pg_catalog.left(s.parts[2], 100)), '')
  from (select x.id, pg_catalog.regexp_match(pg_catalog.btrim(x.contact_name), '^(\S+)\s*(.*)$') as parts
          from public.demandes x where x.contact_name is not null) s
 where d.id = s.id;

alter table public.demandes
  add constraint demandes_contact_first_name_check
    check (char_length(contact_first_name) between 1 and 100 and private.is_tidy_text(contact_first_name)),
  add constraint demandes_contact_last_name_check
    check (char_length(contact_last_name) between 1 and 100 and private.is_tidy_text(contact_last_name)),
  add constraint demandes_contact_last_needs_first_check
    check (contact_last_name is null or contact_first_name is not null);
-- 100 + 1 + 100: the maintained full name may be one character longer than before.
alter table public.demandes drop constraint demandes_contact_name_check;
alter table public.demandes
  add constraint demandes_contact_name_check
    check (char_length(contact_name) between 1 and 201 and private.is_tidy_text(contact_name));

-- -----------------------------------------------------------------------------
-- contact_name, maintained
-- -----------------------------------------------------------------------------
-- The two parts trimmed (empty → null). Only contact_name written (an insert without parts, an
-- update that changes it and not them) → split (first word / the rest). Then contact_name =
-- « Prénom Nom ».
create function private.demandes_contact_names()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parts text[];
begin
  new.contact_first_name := nullif(pg_catalog.btrim(new.contact_first_name), '');
  new.contact_last_name := nullif(pg_catalog.btrim(new.contact_last_name), '');
  if (tg_op = 'INSERT' and new.contact_first_name is null and new.contact_last_name is null)
     or (tg_op = 'UPDATE' and new.contact_first_name is not distinct from old.contact_first_name
                          and new.contact_last_name is not distinct from old.contact_last_name
                          and new.contact_name is distinct from old.contact_name) then
    v_parts := pg_catalog.regexp_match(pg_catalog.btrim(coalesce(new.contact_name, '')), '^(\S+)\s*(.*)$');
    new.contact_first_name := nullif(v_parts[1], '');
    new.contact_last_name := nullif(v_parts[2], '');
  end if;
  new.contact_name := nullif(pg_catalog.concat_ws(' ', new.contact_first_name, new.contact_last_name), '');
  return new;
end;
$$;
revoke all on function private.demandes_contact_names() from public, anon, authenticated, service_role;

create trigger demandes_contact_names before insert or update of contact_name, contact_first_name, contact_last_name
  on public.demandes for each row execute function private.demandes_contact_names();

-- The journal: the two parts redacted too (otherwise as 20261014054618 §4).
drop trigger demandes_audit on public.demandes;
create trigger demandes_audit after insert or update or delete on public.demandes
  for each row execute function private.audit_trigger(
    'contact_name', 'contact_first_name', 'contact_last_name', 'contact_email', 'contact_phone_e164', 'concerns',
    'source_referrer', 'source_utm', 'source_landing_page',
    'issues_comment', 'previous_comment', 'legal_detail', 'motif_other',
    'availability_other', 'insurer', 'legal_context', 'issues', 'has_legal_context', 'has_issues');

-- -----------------------------------------------------------------------------
-- The writers
-- -----------------------------------------------------------------------------
-- The intake keys, now with the two parts (otherwise as 20261013210953).
create or replace function private.demandes_intake_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['client_id', 'contact_name', 'contact_first_name', 'contact_last_name', 'contact_email', 'contact_phone_e164',
               'beneficiary', 'previous_therapy',
               'language', 'modality', 'availability_periods', 'availability_days', 'preferred_pro_gender',
               'profession_title_id', 'clientele_id', 'concerns', 'payer_kind', 'insurer', 'is_urgent', 'motif_ids',
               'has_issues', 'issues', 'issues_comment', 'previous_professionals', 'previous_comment',
               'has_legal_context', 'legal_context', 'legal_detail', 'motif_other', 'availability_other']
$$;

-- private.demandes_insert: the two parts (otherwise as 20261013210953).
create or replace function private.demandes_insert(p_org uuid, p_data jsonb, p_actor uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_note text := private.demandes_text(p_data, 'internal_note');
  v_assignee uuid := private.demandes_text(p_data, 'assigned_to')::uuid;
  v_received timestamptz := coalesce(private.demandes_text(p_data, 'received_at')::timestamptz, pg_catalog.now());
  v_utm jsonb;
  v_constraint text;
begin
  perform private.demandes_check_intake(p_data, array['received_at', 'channel', 'referral_source_id', 'source_campaign',
    'source_utm', 'source_referrer', 'assigned_to', 'internal_note']);
  perform private.demandes_assert_worker(p_org, v_assignee);
  if v_received > pg_catalog.now() + interval '5 minutes' then
    raise exception 'La date de réception ne peut pas être dans le futur.' using errcode = 'P0001';
  end if;
  v_utm := coalesce((select jsonb_object_agg(k, private.demandes_clean(v #>> '{}', 200))
                       from jsonb_each(case when jsonb_typeof(p_data->'source_utm') = 'object' then p_data->'source_utm' else '{}' end) as e(k, v)
                      where k in ('utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id')
                        and jsonb_typeof(v) = 'string' and private.demandes_clean(v #>> '{}', 200) is not null), '{}');

  begin
    insert into public.demandes (
      org_id, received_at, received_by, channel, referral_source_id, source_campaign, source_utm, source_referrer,
      client_id, contact_name, contact_first_name, contact_last_name, contact_email, contact_phone_e164, beneficiary, previous_therapy, language, modality,
      availability_periods, availability_days, preferred_pro_gender, profession_title_id, clientele_id, concerns,
      payer_kind, insurer, is_urgent, assigned_to, assigned_at, created_by,
      has_issues, issues, issues_comment, previous_professionals, previous_comment,
      has_legal_context, legal_context, legal_detail, motif_other, availability_other)
    values (
      p_org,
      v_received,
      p_actor,
      coalesce(private.demandes_text(p_data, 'channel'), 'phone'),
      private.demandes_text(p_data, 'referral_source_id')::uuid,
      coalesce(private.demandes_clean(p_data->>'source_campaign', 200), v_utm->>'utm_campaign'),
      v_utm,
      private.demandes_clean(p_data->>'source_referrer', 500),
      private.demandes_text(p_data, 'client_id')::uuid,
      private.demandes_text(p_data, 'contact_name'),
      private.demandes_text(p_data, 'contact_first_name'),
      private.demandes_text(p_data, 'contact_last_name'),
      pg_catalog.lower(private.demandes_text(p_data, 'contact_email')),
      private.demandes_text(p_data, 'contact_phone_e164'),
      private.demandes_text(p_data, 'beneficiary'),
      (p_data->>'previous_therapy')::boolean,
      coalesce(private.demandes_text(p_data, 'language'), 'fr'),
      coalesce(private.demandes_text(p_data, 'modality'), 'any'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(private.demandes_array(p_data, 'availability_periods')) x), '{}'),
      coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(private.demandes_array(p_data, 'availability_days')) x), '{}'),
      coalesce(private.demandes_text(p_data, 'preferred_pro_gender'), 'any'),
      private.demandes_text(p_data, 'profession_title_id')::uuid,
      private.demandes_text(p_data, 'clientele_id')::uuid,
      private.demandes_text(p_data, 'concerns'),
      coalesce(private.demandes_text(p_data, 'payer_kind'), 'unknown'),
      private.demandes_text(p_data, 'insurer'),
      coalesce((p_data->>'is_urgent')::boolean, false),
      v_assignee,
      case when v_assignee is not null then pg_catalog.now() end,
      p_actor,
      (p_data->>'has_issues')::boolean,
      private.demandes_codes(p_data, 'issues'),
      private.demandes_text(p_data, 'issues_comment'),
      private.demandes_codes(p_data, 'previous_professionals'),
      private.demandes_text(p_data, 'previous_comment'),
      (p_data->>'has_legal_context')::boolean,
      private.demandes_codes(p_data, 'legal_context'),
      private.demandes_text(p_data, 'legal_detail'),
      private.demandes_text(p_data, 'motif_other'),
      private.demandes_text(p_data, 'availability_other'))
    returning id into v_id;
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'demandes_contact_check' then
      raise exception 'Indiquez comment joindre la personne : un dossier, un nom, un courriel ou un téléphone.' using errcode = 'P0001';
    end if;
    raise;
  end;

  if p_data ? 'motif_ids' then
    perform private.demandes_set_motifs(p_org, v_id, private.demandes_array(p_data, 'motif_ids'));
  end if;
  if v_note is not null then
    insert into public.demande_notes (demande_id, org_id, internal_note, updated_by) values (v_id, p_org, v_note, p_actor);
  end if;
  insert into public.demande_events (demande_id, org_id, kind, to_state, assignee, by_user)
  values (v_id, p_org, 'created', 'new', v_assignee, p_actor);
  return v_id;
end;
$$;

-- update_demande: the two parts (otherwise as 20261014054618).
create or replace function public.update_demande(p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_urgent boolean;
  v_client uuid;
  v_constraint text;
begin
  perform private.demandes_require('demandes.manage');
  perform private.demandes_check_intake(p_patch, array[]::text[]);
  v_row := private.demandes_lock(p_id);
  if v_row.state = 'closed' then
    raise exception 'Cette demande est fermée : rouvrez-la pour la modifier.' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:update_demande', true);
  begin
  update public.demandes d set
    client_id = case when p_patch ? 'client_id' then private.demandes_text(p_patch, 'client_id')::uuid else d.client_id end,
    contact_name = case when p_patch ? 'contact_name' then private.demandes_text(p_patch, 'contact_name') else d.contact_name end,
    contact_first_name = case when p_patch ? 'contact_first_name' then private.demandes_text(p_patch, 'contact_first_name') else d.contact_first_name end,
    contact_last_name = case when p_patch ? 'contact_last_name' then private.demandes_text(p_patch, 'contact_last_name') else d.contact_last_name end,
    contact_email = case when p_patch ? 'contact_email' then pg_catalog.lower(private.demandes_text(p_patch, 'contact_email')) else d.contact_email end,
    contact_phone_e164 = case when p_patch ? 'contact_phone_e164' then private.demandes_text(p_patch, 'contact_phone_e164') else d.contact_phone_e164 end,
    beneficiary = case when p_patch ? 'beneficiary' then private.demandes_text(p_patch, 'beneficiary') else d.beneficiary end,
    previous_therapy = case when p_patch ? 'previous_therapy' then (p_patch->>'previous_therapy')::boolean else d.previous_therapy end,
    language = case when p_patch ? 'language' then coalesce(private.demandes_text(p_patch, 'language'), 'fr') else d.language end,
    modality = case when p_patch ? 'modality' then coalesce(private.demandes_text(p_patch, 'modality'), 'any') else d.modality end,
    availability_periods = case when p_patch ? 'availability_periods'
      then coalesce((select array_agg(x) from jsonb_array_elements_text(private.demandes_array(p_patch, 'availability_periods')) x), '{}')
      else d.availability_periods end,
    availability_days = case when p_patch ? 'availability_days'
      then coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(private.demandes_array(p_patch, 'availability_days')) x), '{}')
      else d.availability_days end,
    preferred_pro_gender = case when p_patch ? 'preferred_pro_gender' then coalesce(private.demandes_text(p_patch, 'preferred_pro_gender'), 'any') else d.preferred_pro_gender end,
    profession_title_id = case when p_patch ? 'profession_title_id' then private.demandes_text(p_patch, 'profession_title_id')::uuid else d.profession_title_id end,
    clientele_id = case when p_patch ? 'clientele_id' then private.demandes_text(p_patch, 'clientele_id')::uuid else d.clientele_id end,
    concerns = case when p_patch ? 'concerns' then private.demandes_text(p_patch, 'concerns') else d.concerns end,
    payer_kind = case when p_patch ? 'payer_kind' then coalesce(private.demandes_text(p_patch, 'payer_kind'), 'unknown') else d.payer_kind end,
    insurer = case when p_patch ? 'insurer' then private.demandes_text(p_patch, 'insurer') else d.insurer end,
    is_urgent = case when p_patch ? 'is_urgent' then coalesce((p_patch->>'is_urgent')::boolean, false) else d.is_urgent end,
    has_issues = case when p_patch ? 'has_issues' then (p_patch->>'has_issues')::boolean else d.has_issues end,
    issues = case when p_patch ? 'issues' then private.demandes_codes(p_patch, 'issues') else d.issues end,
    issues_comment = case when p_patch ? 'issues_comment' then private.demandes_text(p_patch, 'issues_comment') else d.issues_comment end,
    previous_professionals = case when p_patch ? 'previous_professionals' then private.demandes_codes(p_patch, 'previous_professionals')
                                  else d.previous_professionals end,
    previous_comment = case when p_patch ? 'previous_comment' then private.demandes_text(p_patch, 'previous_comment') else d.previous_comment end,
    has_legal_context = case when p_patch ? 'has_legal_context' then (p_patch->>'has_legal_context')::boolean else d.has_legal_context end,
    legal_context = case when p_patch ? 'legal_context' then private.demandes_codes(p_patch, 'legal_context') else d.legal_context end,
    legal_detail = case when p_patch ? 'legal_detail' then private.demandes_text(p_patch, 'legal_detail') else d.legal_detail end,
    motif_other = case when p_patch ? 'motif_other' then private.demandes_text(p_patch, 'motif_other') else d.motif_other end,
    availability_other = case when p_patch ? 'availability_other' then private.demandes_text(p_patch, 'availability_other') else d.availability_other end
   where d.id = v_row.id
  returning d.is_urgent, d.client_id into v_urgent, v_client;
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'demandes_contact_check' then
      raise exception 'Gardez un moyen de joindre la personne : un dossier, un nom, un courriel ou un téléphone.' using errcode = 'P0001';
    end if;
    raise;
  end;

  if p_patch ? 'motif_ids' then
    perform private.demandes_set_motifs(v_row.org_id, v_row.id, private.demandes_array(p_patch, 'motif_ids'));
  end if;
  if v_client is distinct from v_row.client_id then
    if v_row.state = 'matched' and v_row.client_id is not null then
      perform private.demandes_release_clients(v_row.org_id, v_row.matched_professional_id, array[v_row.client_id]);
    end if;
    perform private.demandes_link_clients(v_row.org_id, v_row.id);
  end if;
  if v_urgent is distinct from v_row.is_urgent then
    insert into public.demande_events (demande_id, org_id, kind, by_user)
    values (v_row.id, v_row.org_id, case when v_urgent then 'urgent_set' else 'urgent_cleared' end, auth.uid());
  end if;
end;
$$;

-- The booking page: the first and last names it asks, as such; its duplicate answer greets by the
-- request's first name (otherwise as 20261014054618).
create or replace function public.book_discovery_call_for_service(p_org_id uuid, p_payload jsonb, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_starts timestamptz;
  v_first text := private.demandes_clean(p_payload ->> 'first_name', 100);
  v_last text := private.demandes_clean(p_payload ->> 'last_name', 100);
  v_email text := pg_catalog.lower(private.demandes_clean(p_payload ->> 'email', 254));
  v_phone text := private.demandes_clean(p_payload ->> 'phone_e164', 20);
  v_language text := coalesce(nullif(p_payload ->> 'language', ''), 'fr');
  v_message text := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'message', '')), '');
  v_source uuid;
  v_demande uuid;
  v_task uuid;
  v_link uuid;
  v_expires timestamptz;
  v_dup record;
begin
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' or p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    raise exception 'Invalid booking' using errcode = '22023';
  end if;
  select o.* into v_org from public.organizations o where o.id = p_org_id;
  if v_org.id is null or not private.demandes_booking_open(p_org_id) then
    raise exception 'La prise de rendez-vous en ligne n''est pas ouverte pour le moment. Appelez la clinique.'
      using errcode = 'P0001', hint = 'closed';
  end if;
  begin
    v_starts := (p_payload ->> 'starts_at')::timestamptz;
  exception when others then
    v_starts := null;
  end;
  if v_first is null or v_last is null then
    raise exception 'Indiquez votre prénom et votre nom.' using errcode = 'P0001', hint = 'name';
  end if;
  -- A name, nothing else: it is written in emails (« Bonjour … »), so never a web address.
  if pg_catalog.char_length(v_first) > 99 or pg_catalog.char_length(v_last) > 99
     or not private.is_tidy_text(v_first) or not private.is_tidy_text(v_last)
     or (v_first || ' ' || v_last) ~ '[0-9/\\:@<>{}=?&#%|_~^$*+;"\[\]]'
     or (v_first || ' ' || v_last) ~ '\.[A-Za-z]' then
    raise exception 'Indiquez votre prénom et votre nom en lettres (99 caractères au plus chacun).' using errcode = 'P0001', hint = 'name';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Indiquez une adresse courriel valide : la confirmation y est envoyée.' using errcode = 'P0001', hint = 'email';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Le numéro de téléphone n''est pas valide.' using errcode = 'P0001', hint = 'phone';
  end if;
  if v_phone is null then
    raise exception 'Indiquez un numéro de téléphone : la conseillère vous appelle à ce numéro.' using errcode = 'P0001', hint = 'phone';
  end if;
  if v_language not in ('fr', 'en') then
    raise exception 'Choisissez le français ou l''anglais.' using errcode = 'P0001', hint = 'language';
  end if;
  if v_message is not null and pg_catalog.length(v_message) > 1000 then
    raise exception 'Le message compte 1 000 caractères au plus.' using errcode = 'P0001', hint = 'message';
  end if;
  begin
    v_source := nullif(p_payload ->> 'referral_source_id', '')::uuid;
  exception when others then
    v_source := null;
  end;
  if v_source is not null and not exists (select 1 from public.referral_sources_catalog r where r.org_id = p_org_id and r.id = v_source) then
    v_source := null;  -- a stale list: the answer is dropped, never the booking
  end if;

  -- One booking at a time per clinic: a slot is never given twice.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('demandes.booking:' || p_org_id::text, 0));
  if v_starts is null or not exists (select 1 from private.demandes_booking_slots(p_org_id) s where s.starts_at = v_starts) then
    raise exception 'Cette plage n''est plus libre : choisissez-en une autre.' using errcode = 'P0001', hint = 'slot';
  end if;

  -- The same address already has a call: the anonymous page never learns it. The answer reads as a
  -- booking; nothing new is made; the earlier call gets a fresh cancel link that the caller sends
  -- with the usual confirmation (the call's own time, first name and language) to that address.
  select t.id, t.due_at, d.id as demande_id, d.reference, d.language, d.contact_first_name into v_dup
    from public.demande_tasks t join public.demandes d on d.id = t.demande_id and d.org_id = t.org_id
   where t.org_id = p_org_id and t.kind = 'discovery_call' and t.state = 'open' and t.due_at > pg_catalog.now()
     and d.contact_email = v_email and d.channel = 'booking_page'
   order by t.due_at, t.id
   limit 1
   for update of t;
  if found then
    perform pg_catalog.set_config('app.audit_source', 'rpc:book_discovery_call', true);
    v_link := private.issue_secure_link(p_org_id, 'discovery_call', 'demande_task', v_dup.id, p_token_hash, null,
                                        least(greatest(v_dup.due_at - pg_catalog.now(), interval '1 hour'), interval '30 days'), '{}');
    select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
    return pg_catalog.jsonb_build_object(
      'demande_id', v_dup.demande_id, 'task_id', v_dup.id, 'reference', v_dup.reference,
      'starts_at', v_dup.due_at, 'requested_starts_at', v_starts, 'clinic_name', v_org.name, 'timezone', v_org.timezone,
      'language', case when v_dup.language = 'en' then 'en' else 'fr' end,
      'first_name', coalesce(v_dup.contact_first_name, v_first),
      'email', v_email, 'link_expires_at', v_expires);
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:book_discovery_call', true);
  v_demande := private.demandes_insert(p_org_id, pg_catalog.jsonb_build_object(
    'channel', 'booking_page',
    'contact_first_name', v_first,
    'contact_last_name', v_last,
    'contact_email', v_email,
    'contact_phone_e164', v_phone,
    'language', v_language,
    'concerns', v_message,
    'referral_source_id', v_source,
    'source_utm', case when pg_catalog.jsonb_typeof(p_payload -> 'source_utm') = 'object' then p_payload -> 'source_utm' else '{}'::jsonb end,
    'source_referrer', private.demandes_clean(p_payload ->> 'source_referrer', 500)), null);
  update public.demandes d set source_landing_page = private.demandes_clean(p_payload ->> 'source_landing_page', 500)
   where d.id = v_demande and private.demandes_clean(p_payload ->> 'source_landing_page', 500) is not null;
  insert into public.demande_tasks (demande_id, org_id, kind, due_at)
  values (v_demande, p_org_id, 'discovery_call', v_starts)
  returning id into v_task;
  -- The cancel link: valid until the call.
  v_link := private.issue_secure_link(p_org_id, 'discovery_call', 'demande_task', v_task, p_token_hash, null,
                                      least(greatest(v_starts - pg_catalog.now(), interval '1 hour'), interval '30 days'), '{}');
  select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
  return pg_catalog.jsonb_build_object(
    'demande_id', v_demande, 'task_id', v_task,
    'reference', (select d.reference from public.demandes d where d.id = v_demande),
    'starts_at', v_starts, 'requested_starts_at', v_starts, 'clinic_name', v_org.name, 'timezone', v_org.timezone,
    'language', v_language, 'first_name', v_first, 'email', v_email, 'link_expires_at', v_expires);
end;
$$;

-- -----------------------------------------------------------------------------
-- The emails' first name
-- -----------------------------------------------------------------------------
-- Where the proposal goes: the request's own first name without a file (otherwise as 20261013095548).
create or replace function private.demandes_recipient(p_org uuid, p_demande uuid)
returns table (email text, first_name text, language text)
language sql
stable
set search_path = ''
as $$
  with d as (select x.* from public.demandes x where x.id = p_demande and x.org_id = p_org),
  candidates as (
    select c.email, c.first_name, coalesce(c.language, d.language) as language,
           case when c.is_self then 0 when c.is_main_contact then 1 else 2 end as preference
      from d cross join lateral private.client_contacts_for(d.org_id, d.client_id, 'appointments') c
     where d.client_id is not null
    union all
    select d.contact_email, d.contact_first_name, d.language, 3
      from d where d.client_id is null
  )
  select x.email, x.first_name, x.language from candidates x
   where x.email is not null and x.first_name is not null
   order by x.preference
   limit 1
$$;

-- Where the « still waiting? » email goes: the same (otherwise as 20261013064427).
create or replace function private.waitlist_email_of(p_entry uuid)
returns table (email text, first_name text, language text)
language sql
stable
set search_path = ''
as $$
  with e as (select x.* from public.waitlist_entries x where x.id = p_entry),
  candidates as (
    select c.email, c.first_name, coalesce(c.language, e.language) as language,
           case when c.is_self then 0 when c.is_main_contact then 1 else 2 end as preference
      from e cross join lateral private.client_contacts_for(e.org_id, e.client_id, 'communications') c
     where e.client_id is not null
    union all
    select d.contact_email, d.contact_first_name, e.language, 3
      from e join public.demandes d on d.id = e.demande_id and d.org_id = e.org_id
     where e.client_id is null
  )
  select x.email, x.first_name, x.language from candidates x
   where x.email is not null and x.first_name is not null
   order by x.preference
   limit 1
$$;
