-- =============================================================================
-- Module Demandes (« demandes »): registry, tables, RLS (plan D1, part 1)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D1)
-- Roadmap:   docs/plans/2026-10-11-next-modules-roadmap.md §2.3, §2.3 bis (the waiting list)
-- Research:  docs/research/2026-10-08-intake-workbook.md §8 (the counselors' workbook),
--            docs/research/2026-10-11-gorendezvous-tour.md §7, §8, §18 (« Requêtes de service »)
-- Answers:   docs/research/2026-10-12-christine-answers.md (21: exclusions warn; 19: the colours
--            are a priority hint; 22: Calendly replaced, the source of each request kept)
-- Decisions: R-66, R-74, D-1 … (decisions log)
-- Recipe:    docs/standards/database-conventions.md §9
--
-- The counselors' work: a request comes in (phone, email, the website, the booking page that
-- replaces Calendly) → a discovery call → a professional proposed → the first appointment
-- confirmed, with the 24–48 h callback promise visible. A request (« demande ») is one row with
-- its intake (for whom, motifs, language, mode, availability, payer…), its state, its
-- counselor, its contact attempts, its tasks (the discovery call is a task, not a fake
-- appointment in the « conseillère » agenda), its proposals, and, in state « Liste d'attente »,
-- one or two waiting-list entries (a profession or a professional). Clinical screening is out
-- (D8): motifs are orientation tags. The internal note lives in its own table, read with
-- `demandes.notes` only, redacted from the journal and never copied into an event or a notice.
--
-- Every write goes through RPCs (`…_demandes_rpcs.sql`); the module starts disabled everywhere.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:demandes_module', true);

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------
insert into public.modules (key, name) values ('demandes', 'Demandes')
on conflict do nothing;

-- A request names clients (the person, the participants) and professionals (the match, the
-- proposals, the waiting list's targets) and reads their catalogues (motifs, titles, clientèles).
insert into public.module_dependencies (module_key, depends_on) values
  ('demandes', 'clients'),
  ('demandes', 'professionals')
on conflict do nothing;

insert into public.permissions (key, module_key, description) values
  ('demandes.view',     'demandes', 'Voir les demandes et la liste d''attente'),
  ('demandes.manage',   'demandes', 'Créer et traiter les demandes'),
  ('demandes.notes',    'demandes', 'Lire et écrire la note interne d''une demande'),
  ('demandes.waitlist', 'demandes', 'Gérer la liste d''attente'),
  ('demandes.self',     'demandes', 'Voir ses propres demandes et inscriptions (professionnel)')
on conflict do nothing;

-- Defaults (D-1, as Clients' CL-1): the counselors and the adjointe work the requests, the
-- waiting list and the notes (the same set, so a manager holding one role may give the other:
-- core's role guard); the professional reads the requests matched to her and the entries naming
-- her.
insert into public.role_permissions (role, permission_key) values
  ('admin',           'demandes.view'),
  ('admin',           'demandes.manage'),
  ('admin',           'demandes.notes'),
  ('admin',           'demandes.waitlist'),
  ('admin',           'demandes.self'),
  ('counselor',       'demandes.view'),
  ('counselor',       'demandes.manage'),
  ('counselor',       'demandes.notes'),
  ('counselor',       'demandes.waitlist'),
  ('admin_assistant', 'demandes.view'),
  ('admin_assistant', 'demandes.manage'),
  ('admin_assistant', 'demandes.notes'),
  ('admin_assistant', 'demandes.waitlist'),
  ('provider',        'demandes.self')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- demandes: one request
-- -----------------------------------------------------------------------------
-- reference: « DEM-AAAA-NNNN », the year of reception (clinic time) and an order within it,
-- given at creation, never changed (trigger). channel: how it came in. Source (R-74): the
-- « Comment avez-vous entendu parler de MANA ? » answer (Clients' referral_sources), the
-- campaign (utm_campaign), every utm_* parameter and the referring page, captured by the public
-- booking page (D3c) and the website form. client_id: the person's file once known (none for a
-- first call); contact_*: who called, before a file exists (personal data, redacted).
-- beneficiary: for whom (GOrendezvous's « pour qui »). availability_periods / _days: when the
-- person can meet (the workbook's periods; ISO days 1–7). profession_title_id / clientele_id:
-- what is sought (orientation, never a diagnosis). concerns: what the person describes (health
-- information: redacted, never notified, never sent to an AI). state (D-2): new, evaluating,
-- accepted, proposed, matched, waitlist, closed (with closed_reason). is_urgent: a flag, not a
-- state (GOrendezvous's « Urgent »). Contact attempts: last_contact_at, next_contact_at (the
-- next try, what « sans réponse » shows), contact_attempts.
create table public.demandes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  reference text not null,
  reference_year int not null,
  reference_seq int not null,
  received_at timestamptz not null default now(),
  received_by uuid references public.profiles(user_id) on delete set null,
  channel text not null default 'phone',
  referral_source_id uuid,
  source_campaign text,
  source_utm jsonb not null default '{}',
  source_referrer text,
  client_id uuid,
  contact_name text,
  contact_email text,
  contact_phone_e164 text,
  beneficiary text,
  previous_therapy boolean,
  language text not null default 'fr',
  modality text not null default 'any',
  availability_periods text[] not null default '{}',
  availability_days smallint[] not null default '{}',
  preferred_pro_gender text not null default 'any',
  profession_title_id uuid,
  clientele_id uuid,
  concerns text,
  payer_kind text not null default 'unknown',
  insurer text,
  state text not null default 'new',
  closed_reason text,
  closed_at timestamptz,
  is_urgent boolean not null default false,
  assigned_to uuid,
  assigned_at timestamptz,
  matched_professional_id uuid,
  matched_at timestamptz,
  last_contact_at timestamptz,
  next_contact_at timestamptz,
  contact_attempts int not null default 0,
  external_ref text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint demandes_org_id_id_key unique (org_id, id),
  constraint demandes_org_reference_key unique (org_id, reference),
  constraint demandes_org_year_seq_key unique (org_id, reference_year, reference_seq),
  constraint demandes_referral_source_fkey foreign key (org_id, referral_source_id) references public.referral_sources (org_id, id),
  constraint demandes_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id),
  constraint demandes_profession_title_fkey foreign key (org_id, profession_title_id) references public.profession_titles (org_id, id),
  constraint demandes_clientele_fkey foreign key (org_id, clientele_id) references public.clienteles (org_id, id),
  constraint demandes_assigned_to_fkey foreign key (assigned_to, org_id) references public.profiles (user_id, org_id),
  constraint demandes_matched_professional_fkey foreign key (org_id, matched_professional_id) references public.professionals (org_id, id),
  constraint demandes_reference_check check (reference ~ '^DEM-[0-9]{4}-[0-9]{4,6}$'),
  constraint demandes_reference_seq_check check (reference_seq >= 1),
  constraint demandes_channel_check check (channel in ('phone', 'email', 'web_form', 'booking_page', 'sms', 'referral', 'walk_in', 'other')),
  constraint demandes_source_campaign_check check (char_length(source_campaign) between 1 and 200 and private.is_tidy_text(source_campaign)),
  constraint demandes_source_utm_check check (jsonb_typeof(source_utm) = 'object' and pg_catalog.length(source_utm::text) <= 2000),
  constraint demandes_source_referrer_check check (char_length(source_referrer) between 1 and 500 and source_referrer !~ '[[:cntrl:]]'),
  constraint demandes_contact_name_check check (char_length(contact_name) between 1 and 200 and private.is_tidy_text(contact_name)),
  constraint demandes_contact_email_check check (contact_email = lower(contact_email) and char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint demandes_contact_phone_check check (contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint demandes_beneficiary_check check (beneficiary in ('self', 'child', 'teen', 'couple', 'family', 'other')),
  constraint demandes_language_check check (language in ('fr', 'en')),
  constraint demandes_modality_check check (modality in ('video', 'phone', 'any')),
  constraint demandes_availability_periods_check check (
    availability_periods <@ array['morning', 'afternoon', 'late_afternoon', 'evening', 'weekend']::text[]),
  constraint demandes_availability_days_check check (availability_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  constraint demandes_preferred_pro_gender_check check (preferred_pro_gender in ('female', 'male', 'any')),
  constraint demandes_concerns_check check (char_length(concerns) between 1 and 4000),
  constraint demandes_payer_kind_check check (payer_kind in ('self', 'insurance', 'eap', 'ivac', 'other', 'unknown')),
  constraint demandes_insurer_check check (char_length(insurer) between 1 and 120 and private.is_tidy_text(insurer)),
  constraint demandes_state_check check (state in ('new', 'evaluating', 'accepted', 'proposed', 'matched', 'waitlist', 'closed')),
  constraint demandes_closed_reason_check check (closed_reason in ('referred_out', 'not_relevant', 'no_answer', 'withdrew', 'duplicate', 'other')),
  constraint demandes_closed_consistency_check check ((state = 'closed') = (closed_reason is not null and closed_at is not null)),
  constraint demandes_matched_consistency_check check (state <> 'matched' or matched_professional_id is not null),
  constraint demandes_contact_attempts_check check (contact_attempts >= 0),
  constraint demandes_external_ref_check check (char_length(external_ref) between 1 and 64 and private.is_tidy_text(external_ref)),
  -- Someone to call back: a file, a name, or a way to reach them.
  constraint demandes_contact_check check (client_id is not null or contact_name is not null or contact_email is not null or contact_phone_e164 is not null)
);
create unique index demandes_org_external_ref_key on public.demandes (org_id, external_ref) where external_ref is not null;
-- The inbox: open requests newest first, per state, per counselor, the callbacks due.
create index demandes_org_state_received_idx on public.demandes (org_id, state, received_at desc, id desc);
create index demandes_org_assigned_idx on public.demandes (org_id, assigned_to) where state <> 'closed';
create index demandes_org_next_contact_idx on public.demandes (org_id, next_contact_at) where state <> 'closed';
create index demandes_org_referral_source_idx on public.demandes (org_id, referral_source_id);
create index demandes_org_client_idx on public.demandes (org_id, client_id);
create index demandes_org_profession_title_idx on public.demandes (org_id, profession_title_id);
create index demandes_org_clientele_idx on public.demandes (org_id, clientele_id);
create index demandes_org_matched_professional_idx on public.demandes (org_id, matched_professional_id);
create index demandes_assigned_to_idx on public.demandes (assigned_to, org_id);
create index demandes_received_by_idx on public.demandes (received_by);
create index demandes_created_by_idx on public.demandes (created_by);

-- The reference: the year of reception in the clinic's time zone, then the next number of that
-- year (a transaction lock per clinic and year, as clients' file numbers). Never changed.
create function private.demandes_assign_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  select o.timezone into v_tz from public.organizations o where o.id = new.org_id;
  new.reference_year := extract(year from (new.received_at at time zone coalesce(v_tz, 'America/Toronto')))::int;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('demandes.reference:' || new.org_id::text || ':' || new.reference_year::text, 0));
  if new.reference_seq is null then
    select coalesce(max(d.reference_seq), 0) + 1 into new.reference_seq
      from public.demandes d where d.org_id = new.org_id and d.reference_year = new.reference_year;
  end if;
  new.reference := 'DEM-' || new.reference_year::text || '-' || pg_catalog.lpad(new.reference_seq::text, 4, '0');
  return new;
end;
$$;
revoke all on function private.demandes_assign_reference() from public, anon, authenticated, service_role;
create trigger demandes_assign_reference before insert on public.demandes
  for each row execute function private.demandes_assign_reference();

create function private.demandes_freeze_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id or new.reference is distinct from old.reference
     or new.reference_year is distinct from old.reference_year or new.reference_seq is distinct from old.reference_seq
     or new.received_at is distinct from old.received_at then
    raise exception 'La clinique, le numéro et la date de réception d''une demande ne changent pas.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.demandes_freeze_reference() from public, anon, authenticated, service_role;
create trigger demandes_freeze_reference before update on public.demandes
  for each row execute function private.demandes_freeze_reference();

-- -----------------------------------------------------------------------------
-- demande_motifs: the orientation tags of a request (Professionnels' catalogue, never a diagnosis)
-- -----------------------------------------------------------------------------
create table public.demande_motifs (
  demande_id uuid not null,
  motif_id uuid not null,
  org_id uuid not null,
  created_at timestamptz not null default now(),
  constraint demande_motifs_pkey primary key (demande_id, motif_id),
  constraint demande_motifs_demande_fkey foreign key (org_id, demande_id) references public.demandes (org_id, id) on delete cascade,
  constraint demande_motifs_motif_fkey foreign key (org_id, motif_id) references public.motifs (org_id, id)
);
create index demande_motifs_org_motif_idx on public.demande_motifs (org_id, motif_id);
create index demande_motifs_org_demande_idx on public.demande_motifs (org_id, demande_id);

-- -----------------------------------------------------------------------------
-- demande_notes: the internal note (demandes.notes only; never logged, notified or sent to an AI)
-- -----------------------------------------------------------------------------
create table public.demande_notes (
  demande_id uuid primary key,
  org_id uuid not null,
  internal_note text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint demande_notes_demande_fkey foreign key (org_id, demande_id) references public.demandes (org_id, id) on delete cascade,
  constraint demande_notes_note_check check (char_length(internal_note) between 1 and 8000)
);
create index demande_notes_org_idx on public.demande_notes (org_id, demande_id);
create index demande_notes_updated_by_idx on public.demande_notes (updated_by);

-- -----------------------------------------------------------------------------
-- demande_participants: who the request is for (a couple, a family, a child and a parent)
-- -----------------------------------------------------------------------------
-- A participant is a client once known (client_id), else a name until the file exists. One is
-- the main person (is_primary).
create table public.demande_participants (
  id uuid not null default gen_random_uuid(),
  demande_id uuid not null,
  org_id uuid not null,
  client_id uuid,
  display_name text,
  relationship text not null default 'self',
  birthday date,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint demande_participants_pkey primary key (demande_id, id),
  constraint demande_participants_id_key unique (id),
  constraint demande_participants_demande_fkey foreign key (org_id, demande_id) references public.demandes (org_id, id) on delete cascade,
  constraint demande_participants_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id),
  constraint demande_participants_who_check check (client_id is not null or display_name is not null),
  constraint demande_participants_name_check check (char_length(display_name) between 1 and 200 and private.is_tidy_text(display_name)),
  constraint demande_participants_relationship_check check (relationship in ('self', 'child', 'partner', 'parent', 'sibling', 'other')),
  constraint demande_participants_birthday_check check (birthday >= date '1900-01-01')
);
create unique index demande_participants_one_primary_key on public.demande_participants (demande_id) where is_primary;
create index demande_participants_org_client_idx on public.demande_participants (org_id, client_id);
create index demande_participants_org_demande_idx on public.demande_participants (org_id, demande_id);

-- -----------------------------------------------------------------------------
-- demande_events: the request's history in codes (state changes, assignments, contact attempts)
-- -----------------------------------------------------------------------------
-- No free text: what was said lives in the internal note. The workbook's KPIs read these rows
-- (delays to first contact, to proposal, to first appointment; D6).
create table public.demande_events (
  id uuid not null default gen_random_uuid(),
  demande_id uuid not null,
  org_id uuid not null,
  kind text not null,
  from_state text,
  to_state text,
  closed_reason text,
  contact_channel text,
  contact_outcome text,
  professional_id uuid,
  assignee uuid,
  at timestamptz not null default now(),
  by_user uuid references public.profiles(user_id) on delete set null,
  constraint demande_events_pkey primary key (demande_id, id),
  constraint demande_events_id_key unique (id),
  constraint demande_events_demande_fkey foreign key (org_id, demande_id) references public.demandes (org_id, id) on delete cascade,
  constraint demande_events_professional_fkey foreign key (org_id, professional_id) references public.professionals (org_id, id),
  constraint demande_events_assignee_fkey foreign key (assignee) references public.profiles (user_id) on delete set null,
  constraint demande_events_kind_check check (kind in ('created', 'state_changed', 'assigned', 'contact', 'task_done', 'urgent_set', 'urgent_cleared')),
  constraint demande_events_states_check check (
    (from_state is null or from_state in ('new', 'evaluating', 'accepted', 'proposed', 'matched', 'waitlist', 'closed'))
    and (to_state is null or to_state in ('new', 'evaluating', 'accepted', 'proposed', 'matched', 'waitlist', 'closed'))),
  constraint demande_events_closed_reason_check check (closed_reason in ('referred_out', 'not_relevant', 'no_answer', 'withdrew', 'duplicate', 'other')),
  constraint demande_events_contact_channel_check check (contact_channel in ('phone', 'email', 'sms', 'other')),
  constraint demande_events_contact_outcome_check check (contact_outcome in ('reached', 'voicemail', 'no_answer', 'message_sent', 'wrong_number'))
);
create index demande_events_org_demande_at_idx on public.demande_events (org_id, demande_id, at);
create index demande_events_org_kind_at_idx on public.demande_events (org_id, kind, at);
create index demande_events_org_professional_idx on public.demande_events (org_id, professional_id);
create index demande_events_assignee_idx on public.demande_events (assignee);
create index demande_events_by_user_idx on public.demande_events (by_user);

-- -----------------------------------------------------------------------------
-- demande_tasks: what is to be done, dated (the discovery call, a callback, a follow-up)
-- -----------------------------------------------------------------------------
create table public.demande_tasks (
  id uuid not null default gen_random_uuid(),
  demande_id uuid not null,
  org_id uuid not null,
  kind text not null,
  due_at timestamptz not null,
  assigned_to uuid,
  state text not null default 'open',
  outcome text,
  done_at timestamptz,
  done_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint demande_tasks_pkey primary key (demande_id, id),
  constraint demande_tasks_id_key unique (id),
  constraint demande_tasks_demande_fkey foreign key (org_id, demande_id) references public.demandes (org_id, id) on delete cascade,
  constraint demande_tasks_assigned_to_fkey foreign key (assigned_to, org_id) references public.profiles (user_id, org_id),
  constraint demande_tasks_kind_check check (kind in ('discovery_call', 'callback', 'follow_up', 'other')),
  constraint demande_tasks_state_check check (state in ('open', 'done', 'cancelled')),
  constraint demande_tasks_outcome_check check (outcome in ('reached', 'voicemail', 'no_answer', 'message_sent', 'wrong_number', 'not_needed')),
  constraint demande_tasks_done_check check ((state = 'open') = (done_at is null))
);
create index demande_tasks_org_open_due_idx on public.demande_tasks (org_id, due_at) where state = 'open';
create index demande_tasks_org_demande_idx on public.demande_tasks (org_id, demande_id);
create index demande_tasks_assigned_to_idx on public.demande_tasks (assigned_to, org_id);
create index demande_tasks_done_by_idx on public.demande_tasks (done_by);
create index demande_tasks_created_by_idx on public.demande_tasks (created_by);

-- -----------------------------------------------------------------------------
-- demande_propositions: a professional proposed (who, when, by whom, the answer)
-- -----------------------------------------------------------------------------
-- directory_snapshot: what the person was told about the professional (Professionnels' public
-- profile at that moment), so a later change of the profile does not rewrite the history.
create table public.demande_propositions (
  id uuid not null default gen_random_uuid(),
  demande_id uuid not null,
  org_id uuid not null,
  professional_id uuid not null,
  proposed_at timestamptz not null default now(),
  proposed_by uuid references public.profiles(user_id) on delete set null,
  response text not null default 'pending',
  responded_at timestamptz,
  decline_reason text,
  directory_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint demande_propositions_pkey primary key (demande_id, id),
  constraint demande_propositions_id_key unique (id),
  constraint demande_propositions_demande_fkey foreign key (org_id, demande_id) references public.demandes (org_id, id) on delete cascade,
  constraint demande_propositions_professional_fkey foreign key (org_id, professional_id) references public.professionals (org_id, id),
  constraint demande_propositions_response_check check (response in ('pending', 'accepted', 'declined', 'no_answer', 'expired', 'withdrawn')),
  constraint demande_propositions_responded_check check ((response = 'pending') = (responded_at is null)),
  constraint demande_propositions_decline_reason_check check (decline_reason in ('schedule', 'fee', 'professional', 'changed_mind', 'other')),
  constraint demande_propositions_snapshot_check check (jsonb_typeof(directory_snapshot) = 'object')
);
create index demande_propositions_org_professional_idx on public.demande_propositions (org_id, professional_id);
create index demande_propositions_org_demande_idx on public.demande_propositions (org_id, demande_id);
create index demande_propositions_proposed_by_idx on public.demande_propositions (proposed_by);

-- -----------------------------------------------------------------------------
-- waitlist_entries: a place on the waiting list (roadmap §2.3 bis)
-- -----------------------------------------------------------------------------
-- A request in state « Liste d'attente » holds one or two entries: for a profession
-- (target_profession_title_id: psychologie, psychothérapie, any title) and / or a professional.
-- Order: priority (`priority` before `normal`, with a reason) then registered_at; the rank is
-- computed, never stored. Criteria copied from the request (and editable): availability, mode,
-- language, motifs (catalogue ids, checked by the RPCs), clientèle, preferred gender, payer.
-- bridge_professional_id: a professional seen meanwhile (« pont »). state: `incomplete` until
-- the « liste d'attente » consent is signed and the fee paid or waived, then `active`, `to_call`
-- (the follow-up job), `offered`, `closed` (exit_reason, exited_at). fee: the « Inscription liste
-- d'attente » service, invoiced by Facturation (fee_invoice_id, no FK: Facturation comes later).
create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  demande_id uuid not null,
  client_id uuid,
  target_profession_title_id uuid,
  target_professional_id uuid,
  priority text not null default 'normal',
  priority_reason text,
  registered_at timestamptz not null default now(),
  registered_by uuid references public.profiles(user_id) on delete set null,
  availability_periods text[] not null default '{}',
  availability_days smallint[] not null default '{}',
  modality text not null default 'any',
  language text not null default 'fr',
  preferred_pro_gender text not null default 'any',
  clientele_id uuid,
  payer_kind text not null default 'unknown',
  motif_ids uuid[] not null default '{}',
  bridge_professional_id uuid,
  state text not null default 'incomplete',
  fee_status text not null default 'to_invoice',
  fee_waived_reason text,
  fee_invoice_id uuid,
  consent_signed_at timestamptz,
  last_contact_at timestamptz,
  next_contact_at timestamptz,
  exit_reason text,
  exited_at timestamptz,
  exited_by uuid references public.profiles(user_id) on delete set null,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waitlist_entries_org_id_id_key unique (org_id, id),
  constraint waitlist_entries_demande_fkey foreign key (org_id, demande_id) references public.demandes (org_id, id) on delete cascade,
  constraint waitlist_entries_client_fkey foreign key (org_id, client_id) references public.clients (org_id, id),
  constraint waitlist_entries_title_fkey foreign key (org_id, target_profession_title_id) references public.profession_titles (org_id, id),
  constraint waitlist_entries_professional_fkey foreign key (org_id, target_professional_id) references public.professionals (org_id, id),
  constraint waitlist_entries_bridge_fkey foreign key (org_id, bridge_professional_id) references public.professionals (org_id, id),
  constraint waitlist_entries_clientele_fkey foreign key (org_id, clientele_id) references public.clienteles (org_id, id),
  constraint waitlist_entries_target_check check (target_profession_title_id is not null or target_professional_id is not null),
  constraint waitlist_entries_priority_check check (priority in ('normal', 'priority')),
  constraint waitlist_entries_priority_reason_check check (
    (priority = 'priority') = (priority_reason is not null)
    and (priority_reason is null or (char_length(priority_reason) between 1 and 300 and private.is_tidy_text(priority_reason)))),
  constraint waitlist_entries_availability_periods_check check (
    availability_periods <@ array['morning', 'afternoon', 'late_afternoon', 'evening', 'weekend']::text[]),
  constraint waitlist_entries_availability_days_check check (availability_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  constraint waitlist_entries_modality_check check (modality in ('video', 'phone', 'any')),
  constraint waitlist_entries_language_check check (language in ('fr', 'en')),
  constraint waitlist_entries_preferred_pro_gender_check check (preferred_pro_gender in ('female', 'male', 'any')),
  constraint waitlist_entries_payer_kind_check check (payer_kind in ('self', 'insurance', 'eap', 'ivac', 'other', 'unknown')),
  constraint waitlist_entries_motif_ids_check check (pg_catalog.cardinality(motif_ids) <= 50),
  constraint waitlist_entries_state_check check (state in ('incomplete', 'active', 'to_call', 'offered', 'closed')),
  constraint waitlist_entries_fee_status_check check (fee_status in ('to_invoice', 'invoiced', 'paid', 'waived')),
  constraint waitlist_entries_fee_waived_check check (
    (fee_status = 'waived') = (fee_waived_reason is not null)
    and (fee_waived_reason is null or (char_length(fee_waived_reason) between 1 and 300 and private.is_tidy_text(fee_waived_reason)))),
  constraint waitlist_entries_exit_reason_check check (exit_reason in ('placed', 'referred_elsewhere', 'withdrew', 'no_answer', 'other')),
  constraint waitlist_entries_closed_check check ((state = 'closed') = (exit_reason is not null and exited_at is not null)),
  constraint waitlist_entries_external_ref_check check (char_length(external_ref) between 1 and 64 and private.is_tidy_text(external_ref))
);
create unique index waitlist_entries_org_external_ref_key on public.waitlist_entries (org_id, external_ref) where external_ref is not null;
-- The list of a profession or a professional, in order (open entries: priority, then date).
create index waitlist_entries_org_title_order_idx on public.waitlist_entries (org_id, target_profession_title_id, priority, registered_at)
  where state <> 'closed';
create index waitlist_entries_org_professional_order_idx on public.waitlist_entries (org_id, target_professional_id, priority, registered_at)
  where state <> 'closed';
create index waitlist_entries_org_demande_idx on public.waitlist_entries (org_id, demande_id);
create index waitlist_entries_org_client_idx on public.waitlist_entries (org_id, client_id);
create index waitlist_entries_org_bridge_idx on public.waitlist_entries (org_id, bridge_professional_id);
create index waitlist_entries_org_clientele_idx on public.waitlist_entries (org_id, clientele_id);
create index waitlist_entries_org_next_contact_idx on public.waitlist_entries (org_id, next_contact_at) where state <> 'closed';
create index waitlist_entries_registered_by_idx on public.waitlist_entries (registered_by);
create index waitlist_entries_exited_by_idx on public.waitlist_entries (exited_by);

-- -----------------------------------------------------------------------------
-- waitlist_contacts: each follow-up of an entry (a call, the « still waiting? » email, an answer)
-- -----------------------------------------------------------------------------
create table public.waitlist_contacts (
  id uuid not null default gen_random_uuid(),
  entry_id uuid not null,
  org_id uuid not null,
  kind text not null,
  outcome text not null,
  at timestamptz not null default now(),
  by_user uuid references public.profiles(user_id) on delete set null,
  constraint waitlist_contacts_pkey primary key (entry_id, id),
  constraint waitlist_contacts_id_key unique (id),
  constraint waitlist_contacts_entry_fkey foreign key (org_id, entry_id) references public.waitlist_entries (org_id, id) on delete cascade,
  constraint waitlist_contacts_kind_check check (kind in ('call', 'email', 'sms', 'followup_email')),
  constraint waitlist_contacts_outcome_check check (outcome in ('reached', 'voicemail', 'no_answer', 'message_sent', 'wants_to_stay', 'wants_to_leave'))
);
create index waitlist_contacts_org_entry_at_idx on public.waitlist_contacts (org_id, entry_id, at);
create index waitlist_contacts_by_user_idx on public.waitlist_contacts (by_user);

-- -----------------------------------------------------------------------------
-- waitlist_offers: a slot offered to an entry (by phone in part 1, by a 48-h link in part 2)
-- -----------------------------------------------------------------------------
-- slots: 1–3 `{ "starts_at", "ends_at" }` (ISO times). secure_link_id: part 2's link (core's
-- secure links), none for an offer made by phone.
create table public.waitlist_offers (
  id uuid not null default gen_random_uuid(),
  entry_id uuid not null,
  org_id uuid not null,
  professional_id uuid not null,
  slots jsonb not null default '[]',
  channel text not null default 'phone',
  offered_at timestamptz not null default now(),
  offered_by uuid references public.profiles(user_id) on delete set null,
  expires_at timestamptz,
  secure_link_id uuid,
  response text not null default 'pending',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waitlist_offers_pkey primary key (entry_id, id),
  constraint waitlist_offers_id_key unique (id),
  constraint waitlist_offers_entry_fkey foreign key (org_id, entry_id) references public.waitlist_entries (org_id, id) on delete cascade,
  constraint waitlist_offers_professional_fkey foreign key (org_id, professional_id) references public.professionals (org_id, id),
  constraint waitlist_offers_slots_check check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) <= 3),
  constraint waitlist_offers_channel_check check (channel in ('phone', 'email', 'link')),
  constraint waitlist_offers_response_check check (response in ('pending', 'accepted', 'declined', 'expired', 'withdrawn')),
  constraint waitlist_offers_responded_check check ((response = 'pending') = (responded_at is null))
);
create index waitlist_offers_org_professional_idx on public.waitlist_offers (org_id, professional_id);
create index waitlist_offers_org_entry_idx on public.waitlist_offers (org_id, entry_id);
create index waitlist_offers_offered_by_idx on public.waitlist_offers (offered_by);

-- -----------------------------------------------------------------------------
-- Privileges: select only, every write is an RPC
-- -----------------------------------------------------------------------------
revoke all on public.demandes, public.demande_motifs, public.demande_notes, public.demande_participants,
  public.demande_events, public.demande_tasks, public.demande_propositions, public.waitlist_entries,
  public.waitlist_contacts, public.waitlist_offers
  from anon, authenticated;
grant select on public.demandes, public.demande_motifs, public.demande_notes, public.demande_participants,
  public.demande_events, public.demande_tasks, public.demande_propositions, public.waitlist_entries,
  public.waitlist_contacts, public.waitlist_offers
  to authenticated;

alter table public.demandes enable row level security;
alter table public.demande_motifs enable row level security;
alter table public.demande_notes enable row level security;
alter table public.demande_participants enable row level security;
alter table public.demande_events enable row level security;
alter table public.demande_tasks enable row level security;
alter table public.demande_propositions enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.waitlist_contacts enable row level security;
alter table public.waitlist_offers enable row level security;

-- -----------------------------------------------------------------------------
-- RLS: staff with demandes.view; the professional (demandes.self) her matched requests and the
-- entries naming her; the internal note with demandes.notes only
-- -----------------------------------------------------------------------------
create policy demandes_select_staff on public.demandes
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('demandes.view')));
create policy demandes_select_self on public.demandes
  for select to authenticated
  using (matched_professional_id = (select private.current_professional_id()) and (select private.has_permission('demandes.self')));

-- The children follow the request: whatever request the caller may read (the demandes policies
-- above apply inside the subquery: an invoker read).
create policy demande_motifs_select on public.demande_motifs
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and ((select private.has_permission('demandes.view')) or (select private.has_permission('demandes.self')))
    and demande_id in (select d.id from public.demandes d)
  );
create policy demande_participants_select on public.demande_participants
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and ((select private.has_permission('demandes.view')) or (select private.has_permission('demandes.self')))
    and demande_id in (select d.id from public.demandes d)
  );
create policy demande_notes_select on public.demande_notes
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('demandes.notes')));
create policy demande_events_select on public.demande_events
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('demandes.view')));
create policy demande_tasks_select on public.demande_tasks
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('demandes.view')));
create policy demande_propositions_select on public.demande_propositions
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('demandes.view')));
create policy waitlist_entries_select_staff on public.waitlist_entries
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('demandes.view')));
create policy waitlist_entries_select_self on public.waitlist_entries
  for select to authenticated
  using (target_professional_id = (select private.current_professional_id()) and (select private.has_permission('demandes.self')));
create policy waitlist_contacts_select on public.waitlist_contacts
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('demandes.view')));
create policy waitlist_offers_select on public.waitlist_offers
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('demandes.view')));

-- -----------------------------------------------------------------------------
-- updated_at and the journal (personal values redacted: the journal shows a change, never it)
-- -----------------------------------------------------------------------------
create trigger demandes_set_updated_at before update on public.demandes
  for each row execute function private.set_updated_at();
create trigger demande_notes_set_updated_at before update on public.demande_notes
  for each row execute function private.set_updated_at();
create trigger demande_participants_set_updated_at before update on public.demande_participants
  for each row execute function private.set_updated_at();
create trigger demande_tasks_set_updated_at before update on public.demande_tasks
  for each row execute function private.set_updated_at();
create trigger demande_propositions_set_updated_at before update on public.demande_propositions
  for each row execute function private.set_updated_at();
create trigger waitlist_entries_set_updated_at before update on public.waitlist_entries
  for each row execute function private.set_updated_at();
create trigger waitlist_offers_set_updated_at before update on public.waitlist_offers
  for each row execute function private.set_updated_at();

create trigger demandes_audit after insert or update or delete on public.demandes
  for each row execute function private.audit_trigger(
    'contact_name', 'contact_email', 'contact_phone_e164', 'concerns', 'source_referrer', 'source_utm');
create trigger demande_motifs_audit after insert or update or delete on public.demande_motifs
  for each row execute function private.audit_trigger();
create trigger demande_notes_audit after insert or update or delete on public.demande_notes
  for each row execute function private.audit_trigger('internal_note');
create trigger demande_participants_audit after insert or update or delete on public.demande_participants
  for each row execute function private.audit_trigger('display_name', 'birthday');
create trigger demande_events_audit after insert or update or delete on public.demande_events
  for each row execute function private.audit_trigger();
create trigger demande_tasks_audit after insert or update or delete on public.demande_tasks
  for each row execute function private.audit_trigger();
create trigger demande_propositions_audit after insert or update or delete on public.demande_propositions
  for each row execute function private.audit_trigger();
create trigger waitlist_entries_audit after insert or update or delete on public.waitlist_entries
  for each row execute function private.audit_trigger('priority_reason', 'fee_waived_reason');
create trigger waitlist_contacts_audit after insert or update or delete on public.waitlist_contacts
  for each row execute function private.audit_trigger();
create trigger waitlist_offers_audit after insert or update or delete on public.waitlist_offers
  for each row execute function private.audit_trigger();
