-- =============================================================================
-- Facturation: whether an appointment is invoiced, for Rendez-vous (R-79)
-- =============================================================================
-- Asked:   coordinator's review of R-79 (2026-10-14): the person seen of an appointment already
--          invoiced (at her file) cannot be taken off it; Rendez-vous reads that through a helper
--          Facturation publishes, never its tables.
-- Needs:   *_billing_module.sql (invoice_lines).
--
-- `private.billing_appointment_invoiced(org, appointment)` → boolean: the appointment has a line
-- (its session, a cancellation fee, …) on an invoice, draft or issued, that is not credited.
-- Granted to no role; Rendez-vous' `remove_appointment_participant` calls it.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:billing_appointment_invoiced', true);

create function private.billing_appointment_invoiced(p_org uuid, p_appointment_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.invoice_lines l
      join public.invoices i on i.org_id = l.org_id and i.id = l.invoice_id
     where l.org_id = p_org and l.appointment_id = p_appointment_id and not l.credited and i.status <> 'credited')
$$;
revoke all on function private.billing_appointment_invoiced(uuid, uuid) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
