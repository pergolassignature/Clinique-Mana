-- =============================================================================
-- Facturation, batch FS: Stripe (card on file, the next-day charge, « Payer en ligne »), Interac
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §8 (FS)
-- Answers:   docs/research/2026-10-12-christine-answers.md (6: Interac to administration@, Stripe
--            charged the day after the appointment when the card is on file)
-- Decisions: FS-1 … FS-8 (decisions log), BI-8 (a payment is for one invoice), P3-40
-- Needs:     *_billing_queue_payments.sql (F2), *_core_webhook_events_stripe_provider.sql
--
-- * One way to record a payment (agreed with lane A): `private.billing_record_payment` holds
--   `record_payment`'s checks and sequence (the invoice issued, an active mode never « Note de
--   crédit », 1 ¢ to the balance, a date neither future nor a year before the invoice; then the
--   payment state, the QuickBooks event, the receipt `R-AAAA-N` and its delivery), for an actor or
--   none, and is idempotent on `payments.external_ref` (the same reference answers the receipt
--   already made). `record_payment` keeps its signature and behaviour and calls it.
-- * Card on file (FS-1, FS-2): the payer opens « Enregistrer ma carte » (`/carte#t=…`, purpose
--   `billing_card_setup`, 7 days), reads the authorization and goes to Stripe Checkout (setup
--   mode); Stripe's webhook brings back the card: `stripe_customers` keeps the customer, the
--   payment method and the card's brand, last four digits and expiry, never its number, and the
--   date of her consent. « Retirer la carte » detaches it.
-- * The next-day charge (FS-3): the job `billing.stripe_charges` (`billing-stripe-charges`, at
--   the clinic's hour) charges, once per invoice (`stripe_charges`, kind `auto`), every issued
--   invoice with a balance whose payer has a card on file, issued since her consent and in the
--   last 14 days, while Facturation is open to everyone (P3-40). A success records the payment
--   (mode `stripe`, the PaymentIntent as reference, so the webhook's copy is the same payment); a
--   refusal leaves the invoice unpaid and tells `billing.manage` (« Prélèvement refusé »), and F3's
--   dunning takes it like any unpaid invoice. « Prélever maintenant » (kind `manual`) retries.
-- * « Payer en ligne » (FS-4): an invoice email to a payer without a card carries a link
--   (`/payer#t=…`, purpose `billing_pay`, 30 days, 10 opens) that opens Stripe Checkout for the
--   balance of the moment; the payment is recorded from the webhook. Never for a paid invoice,
--   nor when Stripe is not configured.
-- * Interac (FS-6): `interac_notices` is « À rapprocher »: a transfer notice (amount, sender,
--   message), typed by the adjointe or, later, read from administration@ by Communications
--   (`record_interac_notice_for_service`, CM1b: matched at once when exactly one invoice fits); the
--   list suggests the issued invoices whose balance is the amount, the payer's name in the
--   sender's first; one click records the payment (mode `interac`), or « Ignorer ».
-- * Refunds are F3's (`refunds`, `pending_provider` for a Stripe payment): FS's function will take
--   them from F3's service RPCs once F3 is merged.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_stripe_interac', true);

-- -----------------------------------------------------------------------------
-- Recording a payment, with or without a user (lane A's record_payment, F2)
-- -----------------------------------------------------------------------------
create function private.billing_record_payment(
  p_org uuid, p_invoice_id uuid, p_mode_code text, p_amount_cents int, p_paid_on date, p_reference text,
  p_external_ref text, p_actor uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices;
  v_today date := private.billing_today(p_org);
  v_paid_on date := coalesce(p_paid_on, v_today);
  v_reference text := nullif(pg_catalog.btrim(coalesce(p_reference, '')), '');
  v_year int := extract(year from v_today)::int;
  v_payment uuid;
  v_seq int;
  v_receipt uuid;
begin
  select i.* into v from public.invoices i where i.org_id = p_org and i.id = p_invoice_id for update;
  if v.id is null then
    raise exception 'Facture introuvable.' using errcode = 'P0001', hint = 'invoice_id';
  end if;
  -- The same reference twice (a webhook beside the job, a retry): the receipt already made.
  if p_external_ref is not null then
    select r.id into v_receipt
      from public.payments p join public.receipts r on r.payment_id = p.id
     where p.org_id = p_org and p.external_ref = p_external_ref;
    if v_receipt is not null then
      return v_receipt;
    end if;
  end if;
  if v.status <> 'issued' then
    raise exception 'Un paiement s''enregistre sur une facture finalisée, pas créditée.' using errcode = 'P0001', hint = 'status';
  end if;
  if not exists (select 1 from public.payment_modes m where m.org_id = p_org and m.code = p_mode_code and m.is_active and m.code <> 'credit_note') then
    raise exception 'Choisissez un mode de paiement.' using errcode = 'P0001', hint = 'mode';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > v.total_cents - v.paid_cents then
    raise exception 'Le montant va de 0,01 $ au solde de la facture (%).', private.billing_format_money(v.total_cents - v.paid_cents)
      using errcode = 'P0001', hint = 'amount';
  end if;
  if v_paid_on > v_today then
    raise exception 'La date du paiement ne peut pas être dans le futur.' using errcode = 'P0001', hint = 'paid_on';
  end if;
  if v_paid_on < v.issued_on - 365 then
    raise exception 'La date du paiement précède la facture de plus d''un an : vérifiez-la.' using errcode = 'P0001', hint = 'paid_on';
  end if;
  if v_reference is not null and pg_catalog.char_length(v_reference) > 100 then
    raise exception 'La référence compte 100 caractères au plus.' using errcode = 'P0001', hint = 'reference';
  end if;
  insert into public.payments (org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on, reference, external_ref, created_by)
  values (p_org, v.id, v.payer_client_id, p_mode_code, p_amount_cents, v_paid_on, v_reference, p_external_ref, p_actor)
  returning id into v_payment;
  perform private.billing_apply_payments(v.id);
  perform private.billing_queue_sync(p_org, 'payment_recorded', v.id, v_payment);
  v_seq := private.billing_next_number(p_org, 'receipt', v_year);
  insert into public.receipts (org_id, payment_id, invoice_id, number, year, seq, issued_on, amount_cents)
  values (p_org, v_payment, v.id, 'R-' || v_year::text || '-' || v_seq::text, v_year, v_seq, v_today, p_amount_cents)
  returning id into v_receipt;
  perform private.billing_queue_delivery(p_org, 'receipt', v_receipt, true, false, p_actor);
  return v_receipt;
end;
$$;
revoke all on function private.billing_record_payment(uuid, uuid, text, int, date, text, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.record_payment(
  p_invoice_id uuid, p_mode_code text, p_amount_cents int, p_paid_on date default null, p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
begin
  return private.billing_record_payment(v_org, p_invoice_id, p_mode_code, p_amount_cents, p_paid_on, p_reference, null, auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- stripe_customers: a payer's Stripe customer and card on file
-- -----------------------------------------------------------------------------
create table public.stripe_customers (
  org_id uuid not null,
  payer_client_id uuid not null,
  stripe_customer_id text not null,
  payment_method_id text,
  card_brand text,
  card_last4 text,
  card_exp_month smallint,
  card_exp_year smallint,
  card_status text not null default 'none',
  consent_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_customers_pkey primary key (org_id, payer_client_id),
  constraint stripe_customers_customer_key unique (org_id, stripe_customer_id),
  constraint stripe_customers_payer_fkey foreign key (org_id, payer_client_id) references public.clients (org_id, id),
  constraint stripe_customers_status_check check (card_status in ('none', 'active', 'removed')),
  constraint stripe_customers_active_check check (
    (card_status = 'active') = (payment_method_id is not null and consent_at is not null and card_last4 is not null)),
  constraint stripe_customers_ids_check check (
    stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,64}$' and (payment_method_id is null or payment_method_id ~ '^pm_[A-Za-z0-9]{1,64}$')),
  constraint stripe_customers_card_check check (
    (card_last4 is null or card_last4 ~ '^[0-9]{4}$')
    and (card_brand is null or card_brand ~ '^[a-z_]{1,20}$')
    and (card_exp_month is null or card_exp_month between 1 and 12)
    and (card_exp_year is null or card_exp_year between 2000 and 2100))
);
create index stripe_customers_removed_by_idx on public.stripe_customers (removed_by);
create trigger stripe_customers_set_updated_at before update on public.stripe_customers
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- stripe_charges: each charge of a card on file (the job's, or « Prélever maintenant »)
-- -----------------------------------------------------------------------------
create table public.stripe_charges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null,
  payer_client_id uuid not null,
  kind text not null,
  amount_cents int not null,
  status text not null default 'pending',
  payment_intent_id text,
  failure_code text,
  payment_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  finished_at timestamptz,
  constraint stripe_charges_org_id_id_key unique (org_id, id),
  constraint stripe_charges_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id),
  constraint stripe_charges_payer_fkey foreign key (org_id, payer_client_id) references public.clients (org_id, id),
  constraint stripe_charges_payment_fkey foreign key (org_id, payment_id) references public.payments (org_id, id),
  constraint stripe_charges_kind_check check (kind in ('auto', 'manual')),
  constraint stripe_charges_status_check check (status in ('pending', 'succeeded', 'failed')),
  constraint stripe_charges_amount_check check (amount_cents between 1 and 10000000),
  constraint stripe_charges_pi_check check (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9]{1,64}$'),
  constraint stripe_charges_failure_check check (failure_code is null or failure_code ~ '^[a-z0-9_]{1,64}$'),
  constraint stripe_charges_finished_check check ((status = 'pending') = (finished_at is null))
);
create index stripe_charges_org_invoice_idx on public.stripe_charges (org_id, invoice_id, created_at desc);
create index stripe_charges_org_payer_idx on public.stripe_charges (org_id, payer_client_id);
create index stripe_charges_org_payment_idx on public.stripe_charges (org_id, payment_id);
create index stripe_charges_created_by_idx on public.stripe_charges (created_by);
-- The job charges an invoice once; never two charges in flight for one invoice.
create unique index stripe_charges_one_auto_idx on public.stripe_charges (invoice_id) where kind = 'auto';
create unique index stripe_charges_one_pending_idx on public.stripe_charges (invoice_id) where status = 'pending';
create unique index stripe_charges_pi_key on public.stripe_charges (org_id, payment_intent_id) where payment_intent_id is not null;

-- -----------------------------------------------------------------------------
-- interac_notices: « À rapprocher »
-- -----------------------------------------------------------------------------
create table public.interac_notices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source text not null default 'manual',
  source_ref text,
  received_on date not null,
  amount_cents int not null,
  sender_name text not null,
  message text,
  reference text,
  status text not null default 'to_match',
  invoice_id uuid,
  payment_id uuid,
  matched_at timestamptz,
  matched_by uuid references public.profiles(user_id) on delete set null,
  ignored_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint interac_notices_org_id_id_key unique (org_id, id),
  constraint interac_notices_source_ref_key unique (org_id, source, source_ref),
  constraint interac_notices_invoice_fkey foreign key (org_id, invoice_id) references public.invoices (org_id, id),
  constraint interac_notices_payment_fkey foreign key (org_id, payment_id) references public.payments (org_id, id),
  constraint interac_notices_source_check check (source in ('manual', 'gmail') and (source = 'manual') = (source_ref is null)),
  constraint interac_notices_status_check check (status in ('to_match', 'matched', 'ignored')),
  constraint interac_notices_matched_check check ((status = 'matched') = (payment_id is not null and matched_at is not null)),
  constraint interac_notices_ignored_check check ((status = 'ignored') = (ignored_reason is not null)),
  constraint interac_notices_amount_check check (amount_cents between 1 and 10000000),
  constraint interac_notices_text_check check (
    char_length(sender_name) between 1 and 120 and private.is_tidy_text(sender_name)
    and (message is null or char_length(message) <= 500)
    and (reference is null or char_length(reference) between 1 and 100)
    and (source_ref is null or char_length(source_ref) between 1 and 200)
    and (ignored_reason is null or char_length(ignored_reason) between 3 and 300))
);
create index interac_notices_org_status_idx on public.interac_notices (org_id, status, received_on desc);
create index interac_notices_org_invoice_idx on public.interac_notices (org_id, invoice_id);
create index interac_notices_org_payment_idx on public.interac_notices (org_id, payment_id);
create index interac_notices_matched_by_idx on public.interac_notices (matched_by);
create index interac_notices_created_by_idx on public.interac_notices (created_by);
create trigger interac_notices_set_updated_at before update on public.interac_notices
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS, grants (select only; every write is an RPC), audit
-- -----------------------------------------------------------------------------
alter table public.stripe_customers enable row level security;
alter table public.stripe_charges enable row level security;
alter table public.interac_notices enable row level security;
revoke all on public.stripe_customers, public.stripe_charges, public.interac_notices from anon, authenticated;
grant select on public.stripe_customers, public.stripe_charges, public.interac_notices to authenticated;
create policy stripe_customers_select on public.stripe_customers
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy stripe_charges_select on public.stripe_charges
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));
create policy interac_notices_select on public.interac_notices
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('billing.view')));

create trigger stripe_customers_audit after insert or update or delete on public.stripe_customers
  for each row execute function private.audit_trigger();
create trigger stripe_charges_audit after insert or update or delete on public.stripe_charges
  for each row execute function private.audit_trigger();
create trigger interac_notices_audit after insert or update or delete on public.interac_notices
  for each row execute function private.audit_trigger('message');

-- -----------------------------------------------------------------------------
-- Links (secure_links): « Enregistrer ma carte » and « Payer en ligne »
-- -----------------------------------------------------------------------------
insert into public.secure_link_purposes
  (key, module_key, default_ttl, max_ttl, max_uses, requires_session, creates_account, resolve_rpc, accept_rpc, view_permission)
values
  ('billing_card_setup', 'billing', interval '7 days', interval '7 days', 5, false, false, 'resolve_billing_card_link', null, 'billing.view'),
  ('billing_pay', 'billing', interval '30 days', interval '30 days', 10, false, false, 'resolve_billing_pay_link', null, 'billing.view')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Helpers (private, granted to no role)
-- -----------------------------------------------------------------------------
-- Stripe is set for the clinic: its secret key is stored (the webhook secret is checked by the webhook).
create function private.billing_stripe_configured(p_org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.org_secrets s where s.org_id = p_org and s.key = 'stripe_secret_key')
$$;

-- The payer's live card, or no row.
create function private.billing_active_card(p_org uuid, p_payer uuid)
returns setof public.stripe_customers
language sql
stable
set search_path = ''
as $$
  select c.* from public.stripe_customers c
   where c.org_id = p_org and c.payer_client_id = p_payer and c.card_status = 'active'
$$;

-- « Visa •••• 4242 » for notices and texts.
create function private.billing_card_label(p_brand text, p_last4 text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_brand when 'visa' then 'Visa' when 'mastercard' then 'Mastercard' when 'amex' then 'American Express'
                      when 'discover' then 'Discover' when 'interac' then 'Interac' else 'Carte' end
         || ' •••• ' || coalesce(p_last4, '????')
$$;

-- A name, lower case, without accents or punctuation, for the Interac suggestions.
create function private.billing_name_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.translate(coalesce(p_value, ''),
           'ÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇàâäáãéèêëíìîïóòôöõúùûüçÿ', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuucy')),
           '[^a-z0-9]+', ' ', 'g'))
$$;

-- How well a sender's name matches a payer's: 2 both names, 1 the last name, 0 none.
create function private.billing_name_score(p_sender text, p_first text, p_last text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
           when private.billing_name_key(p_last) = '' then 0
           when ' ' || private.billing_name_key(p_sender) || ' ' like '% ' || private.billing_name_key(p_last) || ' %'
             then case when private.billing_name_key(p_first) <> ''
                         and ' ' || private.billing_name_key(p_sender) || ' ' like '% ' || private.billing_name_key(p_first) || ' %'
                       then 2 else 1 end
           else 0
         end
$$;

-- Tells the billing staff that a charge was refused (one notice per charge).
create function private.billing_notify_charge_failed(p_org uuid, p_charge public.stripe_charges)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_number text;
begin
  select i.number into v_number from public.invoices i where i.id = p_charge.invoice_id;
  perform private.notify(p_org, 'billing', 'billing.charge_failed', 'important', 'Prélèvement refusé',
                         'Le prélèvement de ' || private.billing_format_money(p_charge.amount_cents) || ' pour la facture '
                         || coalesce(v_number, '') || ' a été refusé : la facture reste impayée.',
                         '/facturation/factures/' || p_charge.invoice_id::text, 'invoice', p_charge.invoice_id,
                         'billing.manage', null, 'billing.charge_failed:' || p_charge.id::text, null);
end;
$$;

revoke all on function private.billing_stripe_configured(uuid), private.billing_active_card(uuid, uuid),
  private.billing_card_label(text, text), private.billing_name_key(text), private.billing_name_score(text, text, text),
  private.billing_notify_charge_failed(uuid, public.stripe_charges)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Link pages (resolve-link: what the page shows; nothing else)
-- -----------------------------------------------------------------------------
create function public.resolve_billing_card_link(p_link_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.secure_links;
  c record;
begin
  select x.* into l from public.secure_links x
   where x.id = p_link_id and x.purpose = 'billing_card_setup' and x.subject_type = 'client'
     and x.revoked_at is null and x.expires_at > pg_catalog.now() and x.use_count < x.max_uses;
  if l.id is null or not private.billing_stripe_configured(l.org_id) then
    return null;
  end if;
  select f.* into c from private.clients_billing_facts(l.org_id, array[l.subject_id]) f;
  if not coalesce(c.found, false) or c.is_closed then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'clinic_name', (select coalesce(o.legal_name, o.name) from public.organizations o where o.id = l.org_id),
    'language', coalesce(c.language, 'fr'),
    'first_name', c.first_name,
    'has_card', exists (select 1 from private.billing_active_card(l.org_id, l.subject_id)));
end;
$$;

create function public.resolve_billing_pay_link(p_link_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.secure_links;
  v public.invoices;
  c record;
begin
  select x.* into l from public.secure_links x
   where x.id = p_link_id and x.purpose = 'billing_pay' and x.subject_type = 'invoice'
     and x.revoked_at is null and x.expires_at > pg_catalog.now() and x.use_count < x.max_uses;
  if l.id is null then
    return null;
  end if;
  select i.* into v from public.invoices i where i.org_id = l.org_id and i.id = l.subject_id;
  if v.id is null or v.status <> 'issued' then
    return null;
  end if;
  select f.* into c from private.clients_billing_facts(l.org_id, array[v.payer_client_id]) f;
  return pg_catalog.jsonb_build_object(
    'clinic_name', (select coalesce(o.legal_name, o.name) from public.organizations o where o.id = l.org_id),
    'language', coalesce(c.language, 'fr'),
    'invoice_number', v.number,
    'issued_on', v.issued_on,
    'total_cents', v.total_cents,
    'balance_cents', greatest(v.total_cents - v.paid_cents, 0),
    'available', private.billing_stripe_configured(l.org_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- Service RPCs (billing-stripe, billing-stripe-checkout, stripe-webhook, billing-stripe-charges,
-- billing-documents)
-- -----------------------------------------------------------------------------
-- What « Envoyer le lien pour enregistrer une carte » needs, for p_actor (billing.manage): the
-- payer's name, address and language, her Stripe customer if any. Refusals in French.
create function public.stripe_card_link_context_for_service(p_org_id uuid, p_actor uuid, p_payer_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c record;
  v_email text;
begin
  if not ('billing.manage' = any (private.permission_keys_for(p_actor)))
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id) then
    raise exception 'Permission refusée : billing.manage' using errcode = '42501';
  end if;
  if not private.billing_stripe_configured(p_org_id) then
    raise exception 'Stripe n''est pas configuré : entrez la clé dans Paramètres → Paiements en ligne.' using errcode = 'P0001', hint = 'stripe';
  end if;
  select f.* into c from private.clients_billing_facts(p_org_id, array[p_payer_client_id]) f;
  if not coalesce(c.found, false) or c.is_closed then
    raise exception 'Dossier introuvable.' using errcode = 'P0001', hint = 'client_id';
  end if;
  select nullif(pg_catalog.btrim(x.email), '') into v_email
    from private.client_contacts_for(p_org_id, p_payer_client_id, 'invoices') x
   where x.client_id = p_payer_client_id
   limit 1;
  if v_email is null then
    raise exception 'Ce payeur n''a pas d''adresse courriel : ajoutez-la à son dossier.' using errcode = 'P0001', hint = 'email';
  end if;
  return pg_catalog.jsonb_build_object(
    'payer_client_id', p_payer_client_id,
    'name', c.display_name,
    'first_name', c.first_name,
    'email', v_email,
    'language', coalesce(c.language, 'fr'),
    'clinic_name', (select coalesce(o.legal_name, o.name) from public.organizations o where o.id = p_org_id),
    'customer_id', (select s.stripe_customer_id from public.stripe_customers s
                     where s.org_id = p_org_id and s.payer_client_id = p_payer_client_id));
end;
$$;

-- The payer's Stripe customer (made by the function before the link is sent).
create function public.save_stripe_customer_for_service(p_org_id uuid, p_payer_client_id uuid, p_customer_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stripe_customers (org_id, payer_client_id, stripe_customer_id)
  values (p_org_id, p_payer_client_id, p_customer_id)
  on conflict (org_id, payer_client_id) do update set stripe_customer_id = excluded.stripe_customer_id
   where public.stripe_customers.card_status <> 'active';
end;
$$;

-- Stores a link's hash. « Enregistrer ma carte »: subject the payer (p_actor billing.manage).
-- « Payer en ligne »: subject an issued invoice with a balance whose payer has no card on file;
-- false (nothing stored) when it is not one, or Stripe is not set.
create function public.issue_billing_link_for_service(
  p_org_id uuid, p_purpose text, p_subject_id uuid, p_token_hash bytea, p_actor uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
begin
  if p_purpose = 'billing_card_setup' then
    if p_actor is null or not ('billing.manage' = any (private.permission_keys_for(p_actor))) then
      raise exception 'Permission refusée : billing.manage' using errcode = '42501';
    end if;
    if not private.billing_stripe_configured(p_org_id)
       or not exists (select 1 from private.clients_billing_facts(p_org_id, array[p_subject_id]) f where f.found and not f.is_closed) then
      return false;
    end if;
    perform private.issue_secure_link(p_org_id, 'billing_card_setup', 'client', p_subject_id, p_token_hash, p_actor);
    return true;
  elsif p_purpose = 'billing_pay' then
    select i.* into v from public.invoices i where i.org_id = p_org_id and i.id = p_subject_id;
    if v.id is null or v.status <> 'issued' or v.total_cents - v.paid_cents <= 0
       or not private.billing_stripe_configured(p_org_id)
       or exists (select 1 from private.billing_active_card(p_org_id, v.payer_client_id)) then
      return false;
    end if;
    perform private.issue_secure_link(p_org_id, 'billing_pay', 'invoice', v.id, p_token_hash, null);
    return true;
  end if;
  raise exception 'Usage de lien inconnu' using errcode = '22023';
end;
$$;

-- Opens a checkout from a link (one use of it): what Stripe Checkout needs. {state: invalid} for
-- an unknown, used up, expired or revoked link, an invoice no longer due ({state: paid}), Stripe
-- not set, or the module off.
create function public.begin_billing_checkout_for_service(p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.secure_links;
  v public.invoices;
  c record;
  v_payer uuid;
begin
  select x.* into l from public.secure_links x
   where x.token_hash = p_token_hash and x.purpose in ('billing_card_setup', 'billing_pay')
     and x.revoked_at is null and x.expires_at > pg_catalog.now() and x.use_count < x.max_uses;
  if l.id is null or not public.module_enabled_for_org(l.org_id, 'billing')
     or not private.billing_stripe_configured(l.org_id) then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  if l.purpose = 'billing_pay' then
    select i.* into v from public.invoices i where i.org_id = l.org_id and i.id = l.subject_id;
    if v.id is null or v.status <> 'issued' then
      return pg_catalog.jsonb_build_object('state', 'invalid');
    end if;
    if v.total_cents - v.paid_cents <= 0 then
      return pg_catalog.jsonb_build_object('state', 'paid');
    end if;
    v_payer := v.payer_client_id;
  else
    v_payer := l.subject_id;
  end if;
  select f.* into c from private.clients_billing_facts(l.org_id, array[v_payer]) f;
  if not coalesce(c.found, false) or c.is_closed then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  if (private.consume_secure_link(p_token_hash, l.purpose)).id is null then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  return pg_catalog.jsonb_build_object(
    'state', 'valid',
    'org_id', l.org_id,
    'mode', case when l.purpose = 'billing_pay' then 'payment' else 'setup' end,
    'payer_client_id', v_payer,
    'customer_id', (select s.stripe_customer_id from public.stripe_customers s where s.org_id = l.org_id and s.payer_client_id = v_payer),
    'name', c.display_name,
    'email', (select nullif(pg_catalog.btrim(x.email), '') from private.client_contacts_for(l.org_id, v_payer, 'invoices') x
               where x.client_id = v_payer limit 1),
    'language', coalesce(c.language, 'fr'),
    'invoice_id', v.id,
    'invoice_number', v.number,
    'amount_cents', case when v.id is not null then v.total_cents - v.paid_cents end,
    'clinic_name', (select coalesce(o.legal_name, o.name) from public.organizations o where o.id = l.org_id));
end;
$$;

-- The card Stripe saved (checkout in setup mode): the customer's payer gets it, with today's
-- consent. Returns {payer_client_id, replaced_payment_method_id} (the card it replaces, for the
-- webhook to detach), or null for an unknown customer.
create function public.record_stripe_card_for_service(
  p_org_id uuid, p_customer_id text, p_payment_method_id text, p_brand text, p_last4 text, p_exp_month int, p_exp_year int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payer uuid;
  v_old text;
begin
  select s.payment_method_id into v_old from public.stripe_customers s
   where s.org_id = p_org_id and s.stripe_customer_id = p_customer_id for update;
  update public.stripe_customers s
     set payment_method_id = p_payment_method_id,
         card_brand = pg_catalog.left(pg_catalog.lower(coalesce(p_brand, 'card')), 20),
         card_last4 = p_last4, card_exp_month = p_exp_month, card_exp_year = p_exp_year,
         card_status = 'active', consent_at = pg_catalog.now(), removed_at = null, removed_by = null
   where s.org_id = p_org_id and s.stripe_customer_id = p_customer_id
  returning s.payer_client_id into v_payer;
  if v_payer is null then
    return null;
  end if;
  -- The card link has done its work.
  perform private.revoke_secure_links(p_org_id, 'billing_card_setup', 'client', v_payer, null);
  return pg_catalog.jsonb_build_object('payer_client_id', v_payer,
    'replaced_payment_method_id', case when v_old is distinct from p_payment_method_id then v_old end);
end;
$$;

-- « Retirer la carte », for p_actor (billing.manage): what the function detaches.
create function public.stripe_card_for_service(p_org_id uuid, p_actor uuid, p_payer_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.stripe_customers;
begin
  if not ('billing.manage' = any (private.permission_keys_for(p_actor)))
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id) then
    raise exception 'Permission refusée : billing.manage' using errcode = '42501';
  end if;
  select x.* into v from private.billing_active_card(p_org_id, p_payer_client_id) x;
  if v.payer_client_id is null then
    raise exception 'Ce payeur n''a pas de carte au dossier.' using errcode = 'P0001', hint = 'card';
  end if;
  return pg_catalog.jsonb_build_object('customer_id', v.stripe_customer_id, 'payment_method_id', v.payment_method_id);
end;
$$;

create function public.stripe_card_removed_for_service(p_org_id uuid, p_payer_client_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.stripe_customers s
     set card_status = 'removed', payment_method_id = null, removed_at = pg_catalog.now(), removed_by = p_actor
   where s.org_id = p_org_id and s.payer_client_id = p_payer_client_id and s.card_status = 'active';
end;
$$;

-- A payment Stripe confirmed (Checkout « Payer en ligne », or a charge's PaymentIntent, its
-- charge named by p_charge_id when the metadata carries it): recorded once (the PaymentIntent is
-- the reference), at most the balance. What exceeds it, or a payment the invoice no longer takes
-- (credited, the mode off…), is told to billing.manage, never raised (Stripe would retry for
-- days). Returns {receipt_id, recorded_cents, excess_cents}.
create function public.record_stripe_payment_for_service(
  p_org_id uuid, p_invoice_id uuid, p_payment_intent_id text, p_amount_cents int, p_paid_at timestamptz,
  p_charge_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
  v_receipt uuid;
  v_amount int;
  v_payment uuid;
begin
  if p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9]{1,64}$' or p_amount_cents is null or p_amount_cents < 1 then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  select i.* into v from public.invoices i where i.org_id = p_org_id and i.id = p_invoice_id for update;
  if v.id is null then
    raise exception 'Facture introuvable.' using errcode = 'P0001', hint = 'invoice_id';
  end if;
  -- Already recorded (the job's copy, or a redelivery).
  select r.id, p.amount_cents, p.id into v_receipt, v_amount, v_payment
    from public.payments p join public.receipts r on r.payment_id = p.id
   where p.org_id = p_org_id and p.external_ref = p_payment_intent_id;
  if v_receipt is null then
    v_amount := least(p_amount_cents, greatest(v.total_cents - v.paid_cents, 0));
    if v.status = 'issued' and v_amount > 0 then
      begin
        v_receipt := private.billing_record_payment(p_org_id, v.id, 'stripe', v_amount,
                       least((p_paid_at at time zone private.payroll_tz(p_org_id))::date, private.billing_today(p_org_id)),
                       null, p_payment_intent_id, null);
        select r.payment_id into v_payment from public.receipts r where r.id = v_receipt;
      exception when sqlstate 'P0001' then
        v_amount := 0;
      end;
    else
      v_amount := 0;
    end if;
    if v_amount < p_amount_cents then
      perform private.notify(p_org_id, 'billing', 'billing.stripe_excess', 'important', 'Paiement Stripe à vérifier',
                             'Un paiement Stripe de ' || private.billing_format_money(p_amount_cents) || ' pour la facture '
                             || coalesce(v.number, '') || ' n''a été enregistré que pour '
                             || private.billing_format_money(v_amount) || ' : enregistrez ou remboursez l''écart.',
                             '/facturation/factures/' || v.id::text, 'invoice', v.id, 'billing.manage', null,
                             'billing.stripe_excess:' || p_payment_intent_id, null);
    end if;
  end if;
  update public.stripe_charges s
     set status = 'succeeded', finished_at = coalesce(s.finished_at, pg_catalog.now()), payment_id = v_payment,
         payment_intent_id = coalesce(s.payment_intent_id, p_payment_intent_id)
   where s.org_id = p_org_id and s.status <> 'succeeded'
     and (s.payment_intent_id = p_payment_intent_id or (p_charge_id is not null and s.id = p_charge_id and s.invoice_id = v.id));
  return pg_catalog.jsonb_build_object('receipt_id', v_receipt, 'recorded_cents', v_amount,
                                       'excess_cents', greatest(p_amount_cents - v_amount, 0));
end;
$$;

-- The job's list: issued invoices with a balance whose payer has a card on file, issued since her
-- consent and in the last 14 days, never charged by the job; while Facturation is open to all.
create function public.stripe_charges_due_for_service(p_org_id uuid, p_limit int default 100)
returns table (invoice_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id
    from public.invoices i
    join public.stripe_customers s on s.org_id = i.org_id and s.payer_client_id = i.payer_client_id and s.card_status = 'active'
   where i.org_id = p_org_id and i.status = 'issued' and i.total_cents - i.paid_cents > 0
     and coalesce(i.finalized_at, i.issued_on::timestamptz) >= s.consent_at
     and i.issued_on >= private.billing_today(p_org_id) - 14
     and public.module_open_to_all_for_org(p_org_id, 'billing')
     and private.billing_stripe_configured(p_org_id)
     and not exists (select 1 from public.stripe_charges c where c.invoice_id = i.id and (c.kind = 'auto' or c.status = 'pending'))
   order by i.issued_on, i.number
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- Starts a charge (`auto`: the job, once per invoice; `manual`: « Prélever maintenant » by
-- p_actor, billing.manage): what the PaymentIntent needs. Only an invoice finalised after the
-- payer's consent, while Facturation is open to everyone (P3-40). A charge still pending from the
-- last 24 h is resumed (`resume: true`, the same id, so the same idempotency key: Stripe answers
-- its true outcome without charging again); older, it is given up (`abandoned`). Null when the
-- invoice is no longer chargeable; refusals in French for the manual one.
create function public.begin_stripe_charge_for_service(p_org_id uuid, p_invoice_id uuid, p_kind text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
  s public.stripe_customers;
  c public.stripe_charges;
  v_id uuid;
begin
  if p_kind not in ('auto', 'manual') then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  if p_kind = 'manual' and (p_actor is null or not ('billing.manage' = any (private.permission_keys_for(p_actor)))) then
    raise exception 'Permission refusée : billing.manage' using errcode = '42501';
  end if;
  select i.* into v from public.invoices i where i.org_id = p_org_id and i.id = p_invoice_id for update;
  update public.stripe_charges x
     set status = 'failed', failure_code = 'abandoned', finished_at = pg_catalog.now()
   where x.org_id = p_org_id and x.invoice_id = p_invoice_id and x.status = 'pending'
     and x.created_at < pg_catalog.now() - interval '24 hours';
  select x.* into s from private.billing_active_card(p_org_id, v.payer_client_id) x;
  select x.* into c from public.stripe_charges x where x.org_id = p_org_id and x.invoice_id = p_invoice_id and x.status = 'pending';
  if c.id is not null and s.payer_client_id is not null then
    return pg_catalog.jsonb_build_object(
      'charge_id', c.id, 'amount_cents', c.amount_cents, 'invoice_number', v.number, 'resume', true,
      'customer_id', s.stripe_customer_id, 'payment_method_id', s.payment_method_id,
      'clinic_name', (select coalesce(o.legal_name, o.name) from public.organizations o where o.id = p_org_id));
  end if;
  if v.id is null or v.status <> 'issued' or v.total_cents - v.paid_cents <= 0 or s.payer_client_id is null
     or not private.billing_stripe_configured(p_org_id)
     or not public.module_open_to_all_for_org(p_org_id, 'billing')
     or coalesce(v.finalized_at, v.issued_on::timestamptz) < s.consent_at
     or (p_kind = 'auto' and exists (select 1 from public.stripe_charges x where x.invoice_id = v.id and x.kind = 'auto')) then
    if p_kind = 'manual' then
      raise exception 'Cette facture ne peut pas être prélevée : elle est payée, émise avant l''autorisation de la carte, sans carte au dossier, ou Facturation est réservé aux testeurs.'
        using errcode = 'P0001', hint = 'charge';
    end if;
    return null;
  end if;
  insert into public.stripe_charges (org_id, invoice_id, payer_client_id, kind, amount_cents, created_by)
  values (p_org_id, v.id, v.payer_client_id, p_kind, v.total_cents - v.paid_cents, p_actor)
  returning id into v_id;
  return pg_catalog.jsonb_build_object(
    'charge_id', v_id, 'amount_cents', v.total_cents - v.paid_cents, 'invoice_number', v.number, 'resume', false,
    'customer_id', s.stripe_customer_id, 'payment_method_id', s.payment_method_id,
    'clinic_name', (select coalesce(o.legal_name, o.name) from public.organizations o where o.id = p_org_id));
end;
$$;

-- Ends a charge: succeeded → the payment recorded (record_stripe_payment_for_service); failed →
-- the invoice stays unpaid and billing.manage is told (once). A charge already ended is left.
create function public.finish_stripe_charge_for_service(
  p_org_id uuid, p_charge_id uuid, p_status text, p_payment_intent_id text, p_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.stripe_charges;
  v_result jsonb;
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  select x.* into c from public.stripe_charges x where x.org_id = p_org_id and x.id = p_charge_id for update;
  if c.id is null then
    raise exception 'Prélèvement introuvable.' using errcode = 'P0001';
  end if;
  if p_payment_intent_id is not null and c.payment_intent_id is null then
    update public.stripe_charges x set payment_intent_id = p_payment_intent_id where x.id = c.id;
  end if;
  if c.status <> 'pending' then
    return pg_catalog.jsonb_build_object('status', c.status);
  end if;
  if p_status = 'succeeded' then
    v_result := public.record_stripe_payment_for_service(p_org_id, c.invoice_id, p_payment_intent_id, c.amount_cents, pg_catalog.now(), c.id);
    update public.stripe_charges x set status = 'succeeded', finished_at = pg_catalog.now(),
           payment_id = coalesce(x.payment_id, (select r.payment_id from public.receipts r where r.id = (v_result ->> 'receipt_id')::uuid))
     where x.id = c.id;
    return pg_catalog.jsonb_build_object('status', 'succeeded');
  end if;
  update public.stripe_charges x
     set status = 'failed', finished_at = pg_catalog.now(),
         failure_code = case when p_failure_code ~ '^[a-z0-9_]{1,64}$' then p_failure_code else 'declined' end
   where x.id = c.id
  returning x.* into c;
  perform private.billing_notify_charge_failed(p_org_id, c);
  return pg_catalog.jsonb_build_object('status', 'failed');
end;
$$;

-- A PaymentIntent that failed after the function ended (the webhook): its charge fails, if still
-- pending, found by the PaymentIntent or by p_charge_id (the metadata's, when the function never
-- stored the PaymentIntent).
create function public.stripe_payment_failed_for_service(p_org_id uuid, p_payment_intent_id text, p_failure_code text,
                                                         p_charge_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select c.id into v_id from public.stripe_charges c
   where c.org_id = p_org_id and c.status = 'pending'
     and (c.payment_intent_id = p_payment_intent_id or (p_charge_id is not null and c.id = p_charge_id))
   limit 1;
  if v_id is not null then
    perform public.finish_stripe_charge_for_service(p_org_id, v_id, 'failed', p_payment_intent_id, p_failure_code);
  end if;
end;
$$;

-- A transfer notice read from administration@ (Communications, CM1b): once per message. Matched
-- at once when exactly one issued invoice has that balance and its payer's name is the sender's
-- (FS-6, « auto-match when unique »); otherwise it waits in « À rapprocher ».
create function public.record_interac_notice_for_service(
  p_org_id uuid, p_source_ref text, p_received_on date, p_amount_cents int, p_sender_name text, p_message text, p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_only uuid[];
  v_receipt uuid;
begin
  if not public.module_enabled_for_org(p_org_id, 'billing') then
    return null;
  end if;
  insert into public.interac_notices (org_id, source, source_ref, received_on, amount_cents, sender_name, message, reference)
  values (p_org_id, 'gmail', p_source_ref, p_received_on, p_amount_cents, pg_catalog.left(pg_catalog.btrim(p_sender_name), 120),
          nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_message, '')), 500), ''),
          nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_reference, '')), 100), ''))
  on conflict (org_id, source, source_ref) do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  v_only := array(
    select i.id from public.invoices i
     cross join lateral private.clients_billing_facts(p_org_id, array[i.payer_client_id]) pf
     where i.org_id = p_org_id and i.status = 'issued' and i.total_cents - i.paid_cents = p_amount_cents
       and private.billing_name_score(p_sender_name, pf.first_name,
             pg_catalog.btrim(pg_catalog.substr(pf.display_name, pg_catalog.length(pf.first_name) + 1))) > 0
       and not exists (select 1 from public.stripe_charges c where c.invoice_id = i.id and c.status = 'pending')
       and not exists (select 1 from private.billing_active_card(p_org_id, i.payer_client_id))
     limit 2);
  if pg_catalog.cardinality(v_only) = 1 then
    begin
      v_receipt := private.billing_record_payment(p_org_id, v_only[1], 'interac', p_amount_cents,
                     least(p_received_on, private.billing_today(p_org_id)),
                     nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_reference, '')), 100), ''), 'interac:' || v_id::text, null);
      update public.interac_notices x
         set status = 'matched', invoice_id = v_only[1], matched_at = pg_catalog.now(),
             payment_id = (select r.payment_id from public.receipts r where r.id = v_receipt)
       where x.id = v_id;
    exception when sqlstate 'P0001' then
      -- Left « À rapprocher » for the adjointe.
      null;
    end;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- User RPCs
-- -----------------------------------------------------------------------------
-- A dossier's payers (the client and her default payer) with their card on file, the card link
-- sent and live, the last charges (billing.view).
create function public.get_client_stripe(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
  v_payers uuid[];
begin
  if not exists (select 1 from private.clients_billing_facts(v_org, array[p_client_id]) f where f.found) then
    raise exception 'Dossier introuvable.' using errcode = 'P0001', hint = 'client_id';
  end if;
  v_payers := array(select distinct x from pg_catalog.unnest(array[p_client_id,
                      private.billing_default_payer(v_org, p_client_id, private.billing_today(v_org))]) x);
  return pg_catalog.jsonb_build_object(
    'configured', private.billing_stripe_configured(v_org),
    'payers', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'payer_client_id', f.client_id,
                 'name', f.display_name,
                 'is_self', f.client_id = p_client_id,
                 'card', (select case when s.card_status = 'active' then pg_catalog.jsonb_build_object(
                                   'brand', s.card_brand, 'last4', s.card_last4, 'exp_month', s.card_exp_month,
                                   'exp_year', s.card_exp_year, 'consent_at', s.consent_at) end
                            from public.stripe_customers s where s.org_id = v_org and s.payer_client_id = f.client_id),
                 'link_sent_at', (select max(l.created_at) from public.secure_links l
                                   where l.org_id = v_org and l.purpose = 'billing_card_setup' and l.subject_type = 'client'
                                     and l.subject_id = f.client_id and l.revoked_at is null and l.expires_at > pg_catalog.now()
                                     and l.use_count < l.max_uses),
                 'charges', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                               'id', c.id, 'invoice_id', c.invoice_id, 'invoice_number', i.number, 'kind', c.kind,
                               'amount_cents', c.amount_cents, 'status', c.status, 'failure_code', c.failure_code,
                               'created_at', c.created_at) order by c.created_at desc), '[]'::jsonb)
                               from (select * from public.stripe_charges c0
                                      where c0.org_id = v_org and c0.payer_client_id = f.client_id
                                      order by c0.created_at desc limit 5) c
                               join public.invoices i on i.id = c.invoice_id)
               ) order by f.client_id <> p_client_id), '[]'::jsonb)
                 from private.clients_billing_facts(v_org, v_payers) f where f.found));
end;
$$;

-- « À rapprocher »: the notices of a state, newest first, each with up to three suggested
-- invoices (issued, a balance; the amount equal first, then the payer's name in the sender's).
create function public.list_interac_notices(p_status text default 'to_match', p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
begin
  if p_status not in ('to_match', 'matched', 'ignored') then
    raise exception 'État inconnu.' using errcode = 'P0001', hint = 'status';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', n.id, 'source', n.source, 'received_on', n.received_on, 'amount_cents', n.amount_cents,
             'sender_name', n.sender_name, 'message', n.message, 'reference', n.reference, 'status', n.status,
             'invoice_id', n.invoice_id, 'invoice_number', (select i.number from public.invoices i where i.id = n.invoice_id),
             'matched_at', n.matched_at, 'ignored_reason', n.ignored_reason,
             'suggestions', case when n.status = 'to_match' then (
               select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'invoice_id', s.id, 'number', s.number, 'issued_on', s.issued_on,
                        'balance_cents', s.balance, 'payer_name', s.payer_name, 'client_name', s.client_name,
                        'amount_matches', s.balance = n.amount_cents, 'name_score', s.score)
                        order by (s.balance = n.amount_cents) desc, s.score desc, s.issued_on desc), '[]'::jsonb)
                 from (select i.id, i.number, i.issued_on, i.total_cents - i.paid_cents as balance,
                              pf.display_name as payer_name, cf.display_name as client_name,
                              private.billing_name_score(n.sender_name, pf.first_name,
                                pg_catalog.btrim(pg_catalog.substr(pf.display_name, pg_catalog.length(pf.first_name) + 1))) as score
                         from public.invoices i
                         cross join lateral private.clients_billing_facts(v_org, array[i.payer_client_id]) pf
                         cross join lateral private.clients_billing_facts(v_org, array[i.client_id]) cf
                        where i.org_id = v_org and i.status = 'issued' and i.total_cents - i.paid_cents > 0
                          and (i.total_cents - i.paid_cents = n.amount_cents
                               or private.billing_name_score(n.sender_name, pf.first_name,
                                    pg_catalog.btrim(pg_catalog.substr(pf.display_name, pg_catalog.length(pf.first_name) + 1))) > 0)
                        order by (i.total_cents - i.paid_cents = n.amount_cents) desc, 7 desc, i.issued_on desc
                        limit 3) s) end)
             order by n.received_on desc, n.created_at desc), '[]'::jsonb)
      from (select x.* from public.interac_notices x where x.org_id = v_org and x.status = p_status
             order by x.received_on desc, x.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300)) n
  );
end;
$$;

-- A notice typed from administration@ (billing.manage).
create function public.add_interac_notice(
  p_received_on date, p_amount_cents int, p_sender_name text, p_message text default null, p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_sender text := pg_catalog.btrim(coalesce(p_sender_name, ''));
  v_id uuid;
begin
  if p_received_on is null or p_received_on > private.billing_today(v_org) or p_received_on < private.billing_today(v_org) - 365 then
    raise exception 'La date du virement va de l''an dernier à aujourd''hui.' using errcode = 'P0001', hint = 'received_on';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 10000000 then
    raise exception 'Le montant du virement est requis.' using errcode = 'P0001', hint = 'amount';
  end if;
  if char_length(v_sender) < 1 or char_length(v_sender) > 120 or not private.is_tidy_text(v_sender) then
    raise exception 'Le nom de l''expéditeur est requis (120 caractères au plus).' using errcode = 'P0001', hint = 'sender_name';
  end if;
  insert into public.interac_notices (org_id, received_on, amount_cents, sender_name, message, reference, created_by)
  values (v_org, p_received_on, p_amount_cents, v_sender,
          nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_message, '')), 500), ''),
          nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_reference, '')), 100), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- « Rapprocher »: the notice pays the invoice (mode interac, on the notice's date): the receipt.
create function public.match_interac_notice(p_notice_id uuid, p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  n public.interac_notices;
  v public.invoices;
  v_receipt uuid;
begin
  select x.* into n from public.interac_notices x where x.org_id = v_org and x.id = p_notice_id for update;
  if n.id is null or n.status <> 'to_match' then
    raise exception 'Cet avis est déjà rapproché ou ignoré.' using errcode = 'P0001', hint = 'notice';
  end if;
  select i.* into v from public.invoices i where i.org_id = v_org and i.id = p_invoice_id;
  if v.id is not null and n.amount_cents > v.total_cents - v.paid_cents then
    raise exception 'Le virement (%) dépasse le solde de la facture (%) : enregistrez-le en plusieurs paiements depuis les factures, puis ignorez l''avis.',
      private.billing_format_money(n.amount_cents), private.billing_format_money(v.total_cents - v.paid_cents)
      using errcode = 'P0001', hint = 'amount';
  end if;
  v_receipt := private.billing_record_payment(v_org, p_invoice_id, 'interac', n.amount_cents, n.received_on,
                 n.reference, 'interac:' || n.id::text, auth.uid());
  update public.interac_notices x
     set status = 'matched', invoice_id = p_invoice_id, matched_at = pg_catalog.now(), matched_by = auth.uid(),
         payment_id = (select r.payment_id from public.receipts r where r.id = v_receipt)
   where x.id = n.id;
  return v_receipt;
end;
$$;

create function public.ignore_interac_notice(p_notice_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.manage');
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'Indiquez la raison (3 à 300 caractères).' using errcode = 'P0001', hint = 'reason';
  end if;
  update public.interac_notices x set status = 'ignored', ignored_reason = v_reason
   where x.org_id = v_org and x.id = p_notice_id and x.status = 'to_match';
  if not found then
    raise exception 'Cet avis est déjà rapproché ou ignoré.' using errcode = 'P0001', hint = 'notice';
  end if;
end;
$$;

revoke all on function public.resolve_billing_card_link(uuid), public.resolve_billing_pay_link(uuid),
  public.stripe_card_link_context_for_service(uuid, uuid, uuid), public.save_stripe_customer_for_service(uuid, uuid, text),
  public.issue_billing_link_for_service(uuid, text, uuid, bytea, uuid), public.begin_billing_checkout_for_service(bytea),
  public.record_stripe_card_for_service(uuid, text, text, text, text, int, int), public.stripe_card_for_service(uuid, uuid, uuid),
  public.stripe_card_removed_for_service(uuid, uuid, uuid),
  public.record_stripe_payment_for_service(uuid, uuid, text, int, timestamptz, uuid), public.stripe_charges_due_for_service(uuid, int),
  public.begin_stripe_charge_for_service(uuid, uuid, text, uuid), public.finish_stripe_charge_for_service(uuid, uuid, text, text, text),
  public.stripe_payment_failed_for_service(uuid, text, text, uuid),
  public.record_interac_notice_for_service(uuid, text, date, int, text, text, text),
  public.get_client_stripe(uuid), public.list_interac_notices(text, int), public.add_interac_notice(date, int, text, text, text),
  public.match_interac_notice(uuid, uuid), public.ignore_interac_notice(uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_billing_card_link(uuid), public.resolve_billing_pay_link(uuid),
  public.stripe_card_link_context_for_service(uuid, uuid, uuid), public.save_stripe_customer_for_service(uuid, uuid, text),
  public.issue_billing_link_for_service(uuid, text, uuid, bytea, uuid), public.begin_billing_checkout_for_service(bytea),
  public.record_stripe_card_for_service(uuid, text, text, text, text, int, int), public.stripe_card_for_service(uuid, uuid, uuid),
  public.stripe_card_removed_for_service(uuid, uuid, uuid),
  public.record_stripe_payment_for_service(uuid, uuid, text, int, timestamptz, uuid), public.stripe_charges_due_for_service(uuid, int),
  public.begin_stripe_charge_for_service(uuid, uuid, text, uuid), public.finish_stripe_charge_for_service(uuid, uuid, text, text, text),
  public.stripe_payment_failed_for_service(uuid, text, text, uuid),
  public.record_interac_notice_for_service(uuid, text, date, int, text, text, text)
  to service_role;
grant execute on function public.get_client_stripe(uuid), public.list_interac_notices(text, int),
  public.add_interac_notice(date, int, text, text, text), public.match_interac_notice(uuid, uuid),
  public.ignore_interac_notice(uuid, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- The next-day charge job (function billing-stripe-charges, off until switched on)
-- -----------------------------------------------------------------------------
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('billing.stripe_charges', 'billing', 'Prélèvements des cartes au dossier',
   'Chaque jour, prélève sur la carte au dossier du payeur les factures émises depuis la veille (une fois par facture). Un refus laisse la facture impayée et avise la facturation.',
   'function', 'billing-stripe-charges', null, 'billing.stripe_charges', 10, false)
on conflict do nothing;
select cron.schedule('billing.stripe_charges', '25 * * * *', $$select private.invoke_job_function('billing.stripe_charges')$$);

-- -----------------------------------------------------------------------------
-- Emails: « Enregistrer ma carte »; the invoice's « Payer en ligne » button
-- -----------------------------------------------------------------------------
insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission,
   recipient_mode, allows_attachments)
values
  ('billing.card_setup', 'billing', 'Carte au dossier',
   'Envoyé au payeur pour qu''il enregistre sa carte : la clinique la prélève le lendemain de chaque rendez-vous.',
   'Vous recevez ce courriel parce que la clinique vous propose de garder une carte au dossier pour vos paiements.',
   'Enregistrer une carte pour vos paiements — {{clinic.name}}',
   E'Bonjour {{recipient.first_name}},\n\n'
   'Pour simplifier vos paiements, vous pouvez enregistrer une carte de crédit au dossier. La clinique la prélèvera '
   'le lendemain de chaque rendez-vous, du montant de la facture qui vous est envoyée.\n\n'
   'La carte est enregistrée par Stripe, notre fournisseur de paiement : la clinique ne voit jamais son numéro. '
   'Vous pouvez demander de la retirer en tout temps.\n\n'
   'Le lien est valable 7 jours.',
   'Enregistrer ma carte',
   '[{"path": "recipient.first_name", "label": "Prénom du payeur", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"}]'::jsonb,
   'billing.view', 'subject', false),
  ('billing.card_setup_en', 'billing', 'Carte au dossier (anglais)', 'Le courriel de la carte au dossier, en anglais.',
   'You receive this email because the clinic offers to keep a card on file for your payments.',
   'Save a card for your payments — {{clinic.name}}',
   E'Hello {{recipient.first_name}},\n\n'
   'To make your payments simpler, you can save a credit card on file. The clinic will charge it the day after each '
   'appointment, for the amount of the invoice sent to you.\n\n'
   'The card is saved by Stripe, our payment provider: the clinic never sees its number. You may ask for it to be '
   'removed at any time.\n\n'
   'The link is valid for 7 days.',
   'Save my card',
   '[{"path": "recipient.first_name", "label": "Prénom du payeur", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"}]'::jsonb,
   'billing.view', 'subject', false)
on conflict do nothing;

-- The invoice's button (shown only when the email has a « Payer en ligne » link, FS-4).
update public.email_template_defaults set button_label = 'Payer en ligne' where key = 'billing.invoice' and button_label is null;
update public.email_template_defaults set button_label = 'Pay online' where key = 'billing.invoice_en' and button_label is null;

select pg_catalog.set_config('app.audit_source', '', true);
