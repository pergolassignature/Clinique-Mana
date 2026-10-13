# Module `billing` (« Facturation »)

The clinic's invoices: a client's dossier billed to its payer, for sessions priced by Services et tarifs, numbered `AAAA-N`, taxed line by line, corrected by credit notes. Plan: [coding plan §8](../plans/2026-10-11-modules-coding-plan.md#8-facturation-billing--batches); [Christine's answers](../research/2026-10-12-christine-answers.md) (5, 6, 7, 9, 10, 11, 15, 16); legacy inventory [§F](../plans/2026-10-06-legacy-feature-inventory.md#f-facturation); decisions R-40, R-56 … R-65 and **BI-1 … BI-6** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| F1 | Invoices, lines, payer model (« Facturé à »), numbering `AAAA-N`, taxes per line with « Statut Indien », credit notes (schema and RPCs; the screens next) | built (schema) |
| F2 | Morning queue, receipts on payment, statements, PDFs, emails, screens | planned |
| F3 | Dunning 3 / 5 / 7 / 10, the balance rule at booking, cancellation fees decided by the professional, refunds | planned |
| FQ | QuickBooks Online (lane B): its `qbo_*` tables and two settings sections plug into this module | planned |
| FPay | Payroll (lane C): « Paie », « Ma paie » | planned |

- **Registry:** `modules.key = 'billing'`, depends on `clients`, `services`, `professionals`, `appointments`; starts disabled in every clinic.
- **Migrations:** `20261013102346_clients_billing_facts` (Clients' published facts), `20261013102349_appointments_billing_facts` (Rendez-vous' published facts), `20261013102352_billing_module` (registry, tables, RLS, audit, seeds, RPCs, handlers).
- **Tests:** pgTAP `135_billing_invoices` (privileges, registry and roles, payment modes, an invoice from an appointment with the grid price and the file-opening fee, taxes per line, never twice, the payer rule, the default payer, « Statut Indien », an amount to type, gapless numbering continuing a set sequence and never backwards, credit notes, drafts only edited, reads, anonymisation); Vitest `src/modules/billing/manifest.test.ts`; the audit labels by `src/app/audit-labels.test.ts`.

## Permissions

| Key | Who (defaults) | What |
|---|---|---|
| `billing.view` | admin, adjointe, conseillère | invoices, lines, credit notes, payers, sequences, payment modes |
| `billing.manage` | admin, adjointe | create, edit drafts, finalise, credit, set the default payer |
| `billing.self` | admin, professionnel | her receipts, payroll, cancellation-fee decisions (F2, FPay, F3) |
| `billing.settings` | admin | the numbering, QuickBooks (FQ) |

## Tables

All per clinic, RLS on (`billing.view`; `payment_modes` also `billing.self`), `select` only (every write is an RPC), audited (notes, line descriptions and credit-note reasons redacted).

| Table | What | Rules |
|---|---|---|
| `payment_modes` | `interac`, `stripe`, `qbo_payments_card`, `bank_transfer`, `cheque`, `credit_note` (seeded per clinic, `seed:billing_reference`); `is_deposit` (false for `credit_note`) | QuickBooks maps `deposit.<code>` (FQ) |
| `invoice_sequences` | per clinic, kind (`invoice`, `credit_note`) and year: the last number given | a number is taken in the finalising transaction (the row stays locked: no gap); `set_invoice_sequence` sets where GOrendezvous stopped, never below a number given |
| `billing_payer_defaults` | a dossier's default payer from a date | the payer must hold the right (below) |
| `invoices` | dossier (`client_id`), « Facturé à » (`payer_kind` `client` / `relation`, `payer_client_id`), `status` `draft` / `issued` / `credited`, `number` `AAAA-N` (drafts have none), issued / due (on receipt), the tax rates applied and « Statut Indien », totals = Σ lines, origin (`appointment`, `manual`, `service`, `import` with `external_ref`), note to the client (fixed once issued), internal note | totals checked (`total = subtotal + TPS + TVQ`) |
| `invoice_lines` | `service` (a session), `file_opening`, `adjustment` (also `cancellation_fee`, `ivac_gap` for F3 and FP): appointment, service and its code, description, quantity, unit price (null: to type), price source, tax rule, amounts, `credited` | one live session line per appointment (a credited invoice frees it) |
| `credit_notes` | the whole invoice credited: `NC-AAAA-N`, reason (3–500), amounts | one per invoice |

**Money (§F):** a line's subtotal is `round(quantity × unit price)`; its TPS and TVQ are each `round(subtotal × rate)` when the line is taxable and the dossier is not « Statut Indien »; the invoice's are the sums. The rates come from core's « Fiscalité » on the day (drafts: today; finalised: the issue date, kept on the invoice).

**Prices:** a session is priced by Services et tarifs' `private.service_price` on its clinic date with the professional's primary title (Professionnels' `professional_booking_facts`, primary first), the client's rate variant and « Statut Indien » (Clients' `clients_billing_facts`); a grid without a rate refuses (« à confirmer », HINT `price_missing`); « montant saisi à la facture » leaves the amount to type before finalising. The file-opening fee (the policy's `file_opening_service_id`) is added to a dossier's first invoice (none issued and not credited), or as asked.

**« Facturé à » (R-61):** the client, or a relation holding « recevoir reçus et factures » (Clients' `client_contacts_for(…, 'invoices')`); chosen per invoice, never split; the default is the dossier's dated default, else the client.

## RPCs (F1)

All definer, permission first, French `P0001` with a HINT naming the field.

| RPC | Permission | What |
|---|---|---|
| `create_invoice(appointment_ids[], payer, file_opening, notes_client, notes_internal)` → id | `billing.manage` | a draft for appointments of one dossier (booked, confirmed or completed; never invoiced twice; an advisory lock per appointment) |
| `create_manual_invoice(client, payer)` → id | same | an empty draft |
| `add_invoice_line(invoice, 'service' | 'adjustment', service, description, quantity, unit_price, taxable)` → id, `set_invoice_line_price(line, cents)`, `remove_invoice_line(line)` | same | drafts only |
| `set_invoice_payer(invoice, payer)`, `set_invoice_notes(invoice, client, internal)`, `delete_invoice_draft(invoice)` | same | the note to the client is fixed once issued |
| `finalize_invoice(invoice)` → number | same | lines present and priced, the payer still allowed; today's rates; `AAAA-N` |
| `issue_credit_note(invoice, reason)` → id | same | the whole invoice; its appointments may be invoiced again |
| `set_default_payer(client, payer)` | same | from today |
| `set_invoice_sequence(year, last_number)` | `billing.settings` | the cutover's continuation |
| `list_invoices(status, client, before, limit)`, `get_invoice(id)` (lines, credit note, names, payer options), `get_client_billing(client)` (default payer, options, invoices, the last year's appointments not invoiced) | `billing.view` | |

## What the module publishes

- **`private.billing_create_service_invoice(org, client, service, source_id, actor)`** → draft id: a service outside the agenda (Demandes' waiting-list fee, a report), priced today. Granted to no role.
- **For Clients:** `private.billing_reassign_client(old, new)` and `private.billing_anonymize_client(id)` in the handler catalogues (a merge moves invoices and default payers; an anonymisation keeps the invoices and their amounts, blanks their notes, drops the default payers). Lane B's FQ adds its QuickBooks part to these two functions (`create or replace`).
- **Coming:** `client_balance(client)`, `private.client_has_balance` (F3, replacing Rendez-vous' stub), the `client.visits` panel (payments, F2).

### What this module reads from the others (published only)

- **Clients:** `private.clients_billing_facts(org, ids[])` (number, name, rate variant, « Statut Indien », language, archived, closed), `private.client_contacts_for(…, 'invoices')`, `private.clients_display_names`.
- **Rendez-vous:** `private.appointment_billing_facts(org, ids[])`, `private.client_billable_appointments(org, client, since)`.
- **Services et tarifs:** `private.service_price`, `private.service_booking_facts`, `services_catalog`, `billing_policy_on`.
- **Professionnels:** `private.professional_booking_facts` (titles, primary first).
- **Core:** `tax_rates` (« Fiscalité »).

## Keep / Change / Drop

From plan §8's summary and the legacy inventory (§F). Keep: per-line TPS / TVQ, statuses, the file-opening fee, numbering, several lines per invoice, payment modes ↔ QuickBooks accounts. Change: credit notes instead of cancelling an invoice; one payer per invoice, chosen among the authorised relations (no split); numbering `AAAA-N` continuing GOrendezvous's; the server computes every amount. Drop (confirmed by the data): TELUS eRéclamations, gift / loyalty / visit cards, Square, PayPal, Accès D, « seulement TPS », per-service Stripe deposits.
