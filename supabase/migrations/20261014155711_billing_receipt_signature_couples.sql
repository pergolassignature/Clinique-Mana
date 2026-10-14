-- =============================================================================
-- Facturation: the professional's signature and a couple's two names on the receipt (R-86, R-87)
-- =============================================================================
-- Decisions: R-86 (insurance receipts carry the professional's signature image), R-87 (a session
-- for two prints one receipt naming both people; a couple's individual sessions keep one name),
-- amending BI-9.
--
-- What `billing_document` returns gains, through its two helpers (bodies of
-- `*_billing_queue_payments`, otherwise unchanged):
-- * `private.billing_lines`: each line of an appointment that brought several clients together
--   (AP-5) names them, `served: [{id, name, client_number}]` in the appointment's order (the
--   person seen first); null for an individual session or a line without appointment. Read from
--   Rendez-vous' `appointment_billing_facts` and Clients' `clients_billing_facts`.
-- * `private.billing_professionals`: each professional's `signature: {bucket, object_path}` (her
--   ready image, Professionnels' `professional_signature_files`), null without one. The function
--   `billing-documents` downloads it for a receipt only and prints it above her name; an intern's
--   own signature (R-60 names her supervisor beside it).
-- The PDF decides what prints (`supabase/functions/billing-documents/document.ts`): the receipt
-- names every person served; the invoice, the credit note and the statement stay as they were.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_receipt_signature_couples', true);

-- An invoice's lines with the session's date and length, the professionals they name, and the
-- people a session for several served (R-87).
create or replace function private.billing_lines(p_org uuid, p_invoice_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  with l as (select x.* from public.invoice_lines x where x.org_id = p_org and x.invoice_id = any (p_invoice_ids)),
  f as (select y.* from private.appointment_billing_facts(p_org, (select coalesce(pg_catalog.array_agg(l.appointment_id), '{}') from l)) y)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'invoice_id', l.invoice_id, 'position', l.position, 'line_type', l.line_type, 'description', l.description,
           'service_code', l.service_code, 'quantity', l.quantity, 'unit_price_cents', l.unit_price_cents, 'tax_rule', l.tax_rule,
           'subtotal_cents', l.subtotal_cents, 'gst_cents', l.gst_cents, 'qst_cents', l.qst_cents, 'total_cents', l.total_cents,
           'professional_id', l.professional_id, 'service_date', f.local_date,
           'minutes', case when f.appointment_id is not null then (extract(epoch from f.ends_at - f.starts_at) / 60)::int end,
           'served', case when pg_catalog.cardinality(f.client_ids) > 1 then (
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.client_id, 'name', c.display_name,
                                                                       'client_number', c.client_number) order by c.ord)
               from private.clients_billing_facts(p_org, f.client_ids) c
              where c.found) end)
           order by l.invoice_id, l.position), '[]'::jsonb)
    from l left join f on f.appointment_id = l.appointment_id
$$;

-- The professionals an invoice names, as a receipt prints them, with their signature (R-86).
create or replace function private.billing_professionals(p_org uuid, p_invoice_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  with r as (
    select x.*
      from private.professional_receipt_facts(p_org,
             (select coalesce(pg_catalog.array_agg(distinct l.professional_id), '{}') from public.invoice_lines l
               where l.org_id = p_org and l.invoice_id = any (p_invoice_ids) and l.professional_id is not null)) x
  ),
  s as (select y.* from private.professional_signature_files(p_org, (select coalesce(pg_catalog.array_agg(r.professional_id), '{}') from r)) y)
  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(r) || pg_catalog.jsonb_build_object(
             'signature', case when s.file_id is not null
                               then pg_catalog.jsonb_build_object('bucket', s.bucket, 'object_path', s.object_path) end)
           order by r.name), '[]'::jsonb)
    from r left join s on s.professional_id = r.professional_id
$$;

select pg_catalog.set_config('app.audit_source', '', true);
