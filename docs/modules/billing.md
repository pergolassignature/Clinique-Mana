# Module `billing` (« Facturation »)

The clinic's invoices: a client's dossier billed to its payer, for sessions priced by Services et tarifs, numbered `AAAA-N`, taxed line by line, corrected by credit notes. Plan: [coding plan §8](../plans/2026-10-11-modules-coding-plan.md#8-facturation-billing--batches); [Christine's answers](../research/2026-10-12-christine-answers.md) (5, 6, 7, 9, 10, 11, 15, 16); legacy inventory [§F](../plans/2026-10-06-legacy-feature-inventory.md#f-facturation); decisions R-40, R-56 … R-65 and **BI-1 … BI-6** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| F1 | Invoices, lines, payer model (« Facturé à »), numbering `AAAA-N`, taxes per line with « Statut Indien », credit notes (schema and RPCs; the screens next) | built (schema) |
| F2 | Morning queue, receipts on payment, statements, PDFs, emails, screens | planned |
| F3 | Dunning 3 / 5 / 7 / 10, the balance rule at booking, cancellation fees decided by the professional, refunds | planned |
| FQ | QuickBooks Online (lane B): its `qbo_*` tables and two settings sections plug into this module | planned |
| FPay | Payroll (lane C): periods, rules, the lock, « Paie », « Ma paie », her invoice, the QuickBooks export ([below](#paie-des-professionnels-fpay)) | built (fee wiring after F3) |

- **Registry:** `modules.key = 'billing'`, depends on `clients`, `services`, `professionals`, `appointments`; starts disabled in every clinic.
- **Migrations:** `20261013105811_clients_billing_facts` (Clients' published facts), `20261013105814_appointments_billing_facts` (Rendez-vous' published facts), `20261013105817_billing_module` (registry, tables, RLS, audit, seeds, RPCs, handlers).
- **Tests:** pgTAP `135_billing_invoices` (privileges, registry and roles, payment modes, an invoice from an appointment with the grid price and the file-opening fee, taxes per line, never twice, the payer rule, the default payer, « Statut Indien », an amount to type, gapless numbering continuing a set sequence and never backwards, credit notes, drafts only edited, reads, anonymisation); Vitest `src/modules/billing/manifest.test.ts`; the audit labels by `src/app/audit-labels.test.ts`.

## Permissions

| Key | Who (defaults) | What |
|---|---|---|
| `billing.view` | admin, adjointe, conseillère | invoices, lines, credit notes, payers, sequences, payment modes |
| `billing.manage` | admin, adjointe | create, edit drafts, finalise, credit, set the default payer |
| `billing.self` | admin, professionnel | her receipts, payroll, cancellation-fee decisions (F2, FPay, F3) |
| `billing.settings` | admin | the numbering, QuickBooks (FQ), the payroll rules (FPay) |
| `billing.payroll` | admin | the payroll: build, send, adjust, reopen, pay, export (FPay-8) |

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
- **Professionnels:** `private.professional_booking_facts` (titles, primary first); for the payroll `private.professional_session_pay`, `private.professional_compensation_rate`, `private.professional_payout_facts`, `private.professional_display_names`, `private.professional_profile_id`, `private.professional_for_profile`.
- **Rendez-vous (payroll):** `private.appointments_for_billing(org, from, to)`.
- **Services et tarifs (payroll):** `private.service_payout_facts(org, ids[])`.
- **Core:** `tax_rates` (« Fiscalité »).

## Paie des professionnels (FPay)

Every month, a summary per professional of what the clinic owes her, which she checks and validates in « Ma paie » before attaching her invoice; the administration then marks it paid (Christine 14, decisions **FPay-1 … FPay-12**). Migrations `20261013111019_professionals_payout_facts`, `20261013111022_services_payout_facts`, `20261013111025_billing_payroll`; pgTAP `143_professionals_payout_facts`, `145_billing_payroll`; Vitest `lib/payroll.test.ts`, `pages/MyPayPage.test.tsx`; the function `billing-payout-invoice` (Deno tests beside it).

- **Tables:** `payout_periods` (one per professional and month: state, specialty, counts, total, who built, sent, validated, paid), `payout_lines` (kind `session` / `late_cancellation` / `other_fees` / `workshop` / `adjustment`, the appointment or invoice line, the client, the service, the date, the client price, the retention, the amount, how it was priced; `amount_cents` null = « À compléter »), `professional_invoices` (one per period: uploaded or generated, the file, her number and date, the amount, `qbo_bill_id` for FQ), `payout_service_rules` (a service's rule when not its default). RLS: `billing.payroll` reads all; a professional (`billing.self`) her periods once sent, their lines and invoice; the rules with `billing.settings` or `billing.payroll`.
- **Rules** (FPay-1, FPay-2, FPay-6, FPay-7): sessions at the client price of her primary title's grid for the session's duration less her retention in force that day (`private.professional_session_pay`; an « Entente particulière » first; IVAC and PAE at the regular price; a couple's session once); late cancellation and absence fees once paid, at « Annulation tardive » (`private.billing_paid_fees`, an empty stub until F3 replaces it); reports, discussions and tests from issued invoice lines naming her, before taxes, at « Autres frais »; workshops at « Ateliers et conférences ». The rates are Professionnels' (Paramètres → Rémunération).
- **Once** (FPay-3): unique per appointment and kind, and per invoice line. A build also takes what was missed in the months the payroll already ran (three back at most), never before the clinic's first period sent; a fee counts by its payment's date. Every state change takes the build's advisory lock first (no interleaving, no deadlock).
- **States and lock** (FPay-4, FPay-5): `draft` → `to_validate` → (`correction_requested` → `to_validate`) → `validated` → `paid`. A validated or paid period's lines never change (trigger `payout_lines_lock`); « Rouvrir » (validated only, with a reason) detaches the invoice.
- **RPCs** (`billing.payroll`): `list_payout_periods(month)`, `build_payout_month(month)` (a finished month only), `rebuild_payout_period(id)`, `send_payout_periods(ids)` → `{sent, unpriced}`, `add_payout_adjustment(period, cents, note)`, `remove_payout_adjustment(line)`, `reopen_payout_period(id, reason)`, `mark_period_paid(id, paid_on, note)` (validated with an invoice), `list_payout_export(month)`, `discard_payout_drafts(month)` (drafts never sent). The professional or the administration: `list_my_payout_periods()`, `get_payout_period(id)`, `request_payout_correction(id, note)`, `validate_payout_period(id)`, `attach_professional_invoice(period, file, number, issued_on)` (purpose `billing_professional_invoice`). Settings: `list_payout_rules()`, `set_payout_rule(service, rule)` (`billing.settings`). Service role (the function): `prepare_professional_invoice(period, actor)`, `record_generated_professional_invoice(period, file, number, issued_on, actor)`.
- **Function `billing-payout-invoice`** (user, `billing.self`, the module gate; renders: pdfmake, ADR 0008): « Générer ma facture » renders her invoice from the validated summary (clients by file number only), stores it (`register_system_file`, view `billing.payroll`, owner her) and records it; 20 an hour per caller (`LIMITS.billingPayoutInvoiceUser`).
- **Job** `billing.payout_periods` (SQL maintenance job, daily at 11:15 UTC, acting on the clinic's 1st or a missed 1st within the week): last month's drafts for every clinic with Facturation on; one notice to `billing.payroll`. Notices to the professional on send, reopening and payment; to the administration on a correction. No email (FPay-11).
- **Screens:** « Paie » (`/facturation/paie?mois=AAAA-MM&periode=…`, `billing.payroll`): the month's summaries, « Calculer le mois », « Envoyer les sommaires prêts (n) », « Exporter pour QuickBooks » (CSV by specialty), a summary in a side sheet (lines, adjustments, « Recalculer », « Valider pour … », the invoice on her behalf, « Marquer comme versée », « Rouvrir »). « Ma paie » (`/ma-paie`, `/ma-paie/:periodId`, `billing.self`, an account with a professional file): her summaries, « Valider le sommaire », « Signaler une correction », « Téléverser la facture » or « Générer la facture ». Paramètres → Paie (`payroll`, path `paie`): each service's rule, the job.
- **Open:** the 30 % of a cancellation fee (FPay-6, to confirm with Christine); GST and QST on a registered professional's invoice; a credit note after the lock (clawback); feeding the retention program's monthly session counts from the payroll; FQ pushes the bills; CLAUDE.md §7 to name `billing-payout-invoice` (user function, renders).

## Keep / Change / Drop

From plan §8's summary and the legacy inventory (§F). Keep: per-line TPS / TVQ, statuses, the file-opening fee, numbering, several lines per invoice, payment modes ↔ QuickBooks accounts. Change: credit notes instead of cancelling an invoice; one payer per invoice, chosen among the authorised relations (no split); numbering `AAAA-N` continuing GOrendezvous's; the server computes every amount. Drop (confirmed by the data): TELUS eRéclamations, gift / loyalty / visit cards, Square, PayPal, Accès D, « seulement TPS », per-service Stripe deposits.
