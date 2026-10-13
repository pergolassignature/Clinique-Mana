-- =============================================================================
-- Facturation: what an invoice says about paying (parity audit P13, decision BI-21)
-- =============================================================================
-- GOrendezvous's invoices carry a default note (the tour, §18): the Interac instructions (the
-- clinic's address, autodeposit), the « PAYER » link and « reçu sous 24 h ouvrables ». Here:
-- - the Interac line is built from the clinic's `etransfer_email` (Paramètres → Coordonnées
--   bancaires), printed only when it is set;
-- - a standing note per language on `billing_settings` (Paramètres → Facturation,
--   `billing.settings`): null = the default text below, '' = none;
-- - the « Payer en ligne » button stays the email's (FS);
-- - `billing_clinic` gives `etransfer_email`, `invoice_note_fr` and `invoice_note_en` to the
--   documents; the invoice emails get the variable `document.payment_note`.
-- Delegated wording, revisable (Christine may change it in Paramètres).
-- Additive: two columns, two functions, `create or replace` of two, the invoice emails' default text.

select pg_catalog.set_config('app.audit_source', 'migration:billing_invoice_payment_note', true);

alter table public.billing_settings
  add column invoice_note_fr text,
  add column invoice_note_en text,
  add constraint billing_settings_invoice_note_check check (
    (invoice_note_fr is null or pg_catalog.char_length(invoice_note_fr) <= 1000)
    and (invoice_note_en is null or pg_catalog.char_length(invoice_note_en) <= 1000));

-- The standing note when the clinic has not written its own.
create function private.billing_default_invoice_note(p_language text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_language = 'en'
    then 'Your receipt is sent to you within 24 business hours of your payment.'
    else 'Votre reçu vous est envoyé dans les 24 h ouvrables suivant votre paiement.' end
$$;
revoke all on function private.billing_default_invoice_note(text) from public, anon, authenticated, service_role;

-- « Note des factures » (billing.settings): null restores the default text, blank means none.
create function public.set_billing_invoice_note(p_fr text, p_en text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.settings');
  v_fr text := case when p_fr is null then null else pg_catalog.btrim(p_fr) end;
  v_en text := case when p_en is null then null else pg_catalog.btrim(p_en) end;
begin
  if pg_catalog.char_length(coalesce(v_fr, '')) > 1000 or pg_catalog.char_length(coalesce(v_en, '')) > 1000 then
    raise exception 'La note des factures compte 1 000 caractères au plus.' using errcode = 'P0001', hint = 'invoice_note';
  end if;
  insert into public.billing_settings as s (org_id, invoice_note_fr, invoice_note_en, updated_by)
  values (v_org, v_fr, v_en, auth.uid())
  on conflict (org_id) do update
    set invoice_note_fr = excluded.invoice_note_fr, invoice_note_en = excluded.invoice_note_en, updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.set_billing_invoice_note(text, text) from public, anon;
grant execute on function public.set_billing_invoice_note(text, text) to authenticated;

-- The clinic as a document prints it: its Interac address and the standing invoice note (BI-21).
create or replace function private.billing_clinic(p_org uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'name', o.name, 'legal_name', o.legal_name, 'address_line1', o.address_line1, 'address_line2', o.address_line2,
           'city', o.city, 'province', o.province, 'postal_code', o.postal_code, 'phone', o.phone, 'email', o.email,
           'website', o.website, 'gst_number', o.gst_number, 'qst_number', o.qst_number,
           -- BI-21: how to pay by Interac, and the standing note (null: the default text).
           'etransfer_email', (select b.etransfer_email from public.organization_bank_details b where b.org_id = o.id),
           'invoice_note_fr', coalesce((select s.invoice_note_fr from public.billing_settings s where s.org_id = o.id),
                                       private.billing_default_invoice_note('fr')),
           'invoice_note_en', coalesce((select s.invoice_note_en from public.billing_settings s where s.org_id = o.id),
                                       private.billing_default_invoice_note('en')))
    from public.organizations o where o.id = p_org
$$;
-- Paramètres → Facturation reads the invoice notes and the Interac address (BI-21).
create or replace function public.get_billing_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.billing_require('billing.view');
  s public.billing_settings;
begin
  select x.* into s from public.billing_settings x where x.org_id = v_org;
  return pg_catalog.jsonb_build_object(
    'queue_from', s.queue_from,
    'dunning_from', s.dunning_from,
    'dunning_days', coalesce(pg_catalog.to_jsonb(s.dunning_days), '[3, 5, 7, 10]'::jsonb),
    'block_after_days', coalesce(s.block_after_days, 10),
    'invoice_note_fr', coalesce(s.invoice_note_fr, private.billing_default_invoice_note('fr')),
    'invoice_note_en', coalesce(s.invoice_note_en, private.billing_default_invoice_note('en')),
    'invoice_note_fr_default', s.invoice_note_fr is null,
    'invoice_note_en_default', s.invoice_note_en is null,
    'etransfer_email', (select b.etransfer_email from public.organization_bank_details b where b.org_id = v_org));
end;
$$;
-- The invoice emails print the payment note (the Interac line and the standing note), before the
-- closing line; an optional variable (empty when the clinic has neither).
update public.email_template_defaults d
   set variables = d.variables || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
         'path', 'document.payment_note', 'label', 'Paiement et reçu',
         'sample', case when d.key = 'billing.invoice_en'
                        then 'Payment by Interac e-Transfer to payments@clinic.example (autodeposit). Your receipt is sent to you within 24 business hours of your payment.'
                        else 'Paiement par virement Interac à paiements@clinique.exemple (dépôt automatique). Votre reçu vous est envoyé dans les 24 h ouvrables suivant votre paiement.' end,
         'required', false, 'kind', 'text')),
       body = pg_catalog.replace(d.body,
                case when d.key = 'billing.invoice_en' then E'\n\nIf you have any questions' else E'\n\nPour toute question' end,
                case when d.key = 'billing.invoice_en' then E'\n\n{{document.payment_note}}\n\nIf you have any questions'
                     else E'\n\n{{document.payment_note}}\n\nPour toute question' end)
 where d.key in ('billing.invoice', 'billing.invoice_en')
   and not exists (select 1 from pg_catalog.jsonb_array_elements(d.variables) v where v ->> 'path' = 'document.payment_note');

select pg_catalog.set_config('app.audit_source', '', true);
