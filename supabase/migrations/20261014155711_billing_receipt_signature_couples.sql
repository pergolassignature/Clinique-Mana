-- =============================================================================
-- Facturation: the professional's signature and a couple's two names on the receipt (R-86, R-87)
-- =============================================================================
-- Decisions: R-86 (insurance receipts carry the professional's signature image), R-87 (a session
-- for two prints one receipt naming both people; a couple's individual sessions keep one name),
-- amending BI-9.
--
-- * `private.billing_lines` (the body of `*_billing_queue_payments`, otherwise unchanged): a line
--   whose appointment is a **service for two** (Services et tarifs' `service_booking_facts.for_two`)
--   and served more than one person names them, `served: [{id, name, client_number}]`: the
--   participants not marked absent (Rendez-vous' `appointment_served_client_ids`, the person seen
--   first), named by Clients' `clients_billing_facts`. Null otherwise: an individual service with
--   a parent or a companion present names no one more (a file number never goes to an insurer for
--   someone who was not served), nor a couple's session where one was absent.
-- * `billing_receipt_signatures_for_service(org, receipt)` (service role): the signature images
--   (`professional_id`, `bucket`, `object_path`; Professionnels' `professional_signature_files`)
--   of the professionals on that receipt's invoice lines. `billing-documents` reads it for a
--   receipt; the document `billing_document` returns, and so `get_billing_document` for
--   `billing.view` users, carries no storage path. Billing users see the image in the receipt's
--   PDF preview.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_receipt_signature_couples', true);

-- An invoice's lines with the session's date and length, the professionals they name, and the
-- people a session for two served (R-87).
create or replace function private.billing_lines(p_org uuid, p_invoice_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  with l as (select x.* from public.invoice_lines x where x.org_id = p_org and x.invoice_id = any (p_invoice_ids)),
  f as (select y.* from private.appointment_billing_facts(p_org, (select coalesce(pg_catalog.array_agg(l.appointment_id), '{}') from l)) y),
  s as (select y.* from private.appointment_served_client_ids(p_org, (select coalesce(pg_catalog.array_agg(l.appointment_id), '{}') from l)) y)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'invoice_id', l.invoice_id, 'position', l.position, 'line_type', l.line_type, 'description', l.description,
           'service_code', l.service_code, 'quantity', l.quantity, 'unit_price_cents', l.unit_price_cents, 'tax_rule', l.tax_rule,
           'subtotal_cents', l.subtotal_cents, 'gst_cents', l.gst_cents, 'qst_cents', l.qst_cents, 'total_cents', l.total_cents,
           'professional_id', l.professional_id, 'service_date', f.local_date,
           'minutes', case when f.appointment_id is not null then (extract(epoch from f.ends_at - f.starts_at) / 60)::int end,
           'served', case when pg_catalog.cardinality(s.client_ids) > 1
                               and coalesce((select b.for_two from private.service_booking_facts(p_org, f.service_id) b), false) then (
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.client_id, 'name', c.display_name,
                                                                       'client_number', c.client_number) order by c.ord)
               from private.clients_billing_facts(p_org, s.client_ids) c
              where c.found) end)
           order by l.invoice_id, l.position), '[]'::jsonb)
    from l
    left join f on f.appointment_id = l.appointment_id
    left join s on s.appointment_id = l.appointment_id
$$;

-- The signature images a receipt prints (R-86), for `billing-documents` only.
create function public.billing_receipt_signatures_for_service(p_org_id uuid, p_receipt_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'professional_id', g.professional_id, 'bucket', g.bucket, 'object_path', g.object_path)
           order by g.professional_id), '[]'::jsonb)
    from private.professional_signature_files(p_org_id,
           (select coalesce(pg_catalog.array_agg(distinct l.professional_id), '{}')
              from public.receipts r
              join public.invoice_lines l on l.org_id = r.org_id and l.invoice_id = r.invoice_id
             where r.org_id = p_org_id and r.id = p_receipt_id and l.professional_id is not null)) g
$$;
revoke all on function public.billing_receipt_signatures_for_service(uuid, uuid) from public, anon, authenticated;
grant execute on function public.billing_receipt_signatures_for_service(uuid, uuid) to service_role;

select pg_catalog.set_config('app.audit_source', '', true);
