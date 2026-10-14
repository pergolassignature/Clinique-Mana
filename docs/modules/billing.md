# Module `billing` (« Facturation »)

The clinic's invoices: a client's dossier billed to its payer, for sessions priced by Services et tarifs, numbered `AAAA-N`, taxed line by line, corrected by credit notes. Plan: [coding plan §8](../plans/2026-10-11-modules-coding-plan.md#8-facturation-billing--batches); [Christine's answers](../research/2026-10-12-christine-answers.md) (5, 6, 7, 9, 10, 11, 15, 16); legacy inventory [§F](../plans/2026-10-06-legacy-feature-inventory.md#f-facturation); decisions R-40, R-56 … R-65 and **BI-1 … BI-18** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| F1 | Invoices, lines, payer model (« Facturé à »), numbering `AAAA-N`, taxes per line with « Statut Indien », credit notes; « Factures », the invoice page, the client's panel, Paramètres → Facturation | built |
| F2 | Morning queue, payments, receipts on payment, statements, PDFs, emails (schema, `billing-documents`); the screens | built |
| F3 | Dunning 3 / 5 / 7 / 10, the balance rule at booking, cancellation fees decided by the professional, refunds | built |
| FQ | QuickBooks Online (lane B): the connection, the accounts map keyed on the payment modes, the customers read and matched (part 1); the push of invoices, credit notes, payments and the professionals' bills (part 2) | built (paused until the go/no-go) |
| FS | Online payments (lane C): Stripe card on file and the next-day charge, « Payer en ligne », the webhook, Interac « À rapprocher » ([below](#paiements-en-ligne-fs)) | built (refunds with F3, administration@ with CM1b) |
| FPay | Payroll (lane C): periods, rules, the lock, « Paie », « Ma paie », her invoice, the QuickBooks export ([below](#paie-des-professionnels-fpay)) | built (fee wiring after F3) |

- **Registry:** `modules.key = 'billing'`, depends on `clients`, `services`, `professionals`, `appointments`; starts disabled in every clinic.
- **Migrations:** `20261013105811_clients_billing_facts` (Clients' published facts), `20261013105814_appointments_billing_facts` (Rendez-vous' published facts), `20261013105817_billing_module` (registry, tables, RLS, audit, seeds, RPCs, handlers), `20261013111236_billing_quickbooks` (FQ part 1, below); F2: `20261013113141_professionals_supervisor` (Professionnels: the supervisor, the receipt facts), `20261013113521_billing_queue_payments` (the queue, payments, receipts, statements, deliveries, the job, the templates).
- **Functions:** `billing-documents` (F2: renders and sends the PDFs; job `billing.documents` and user calls).
- **Tests:** pgTAP `135_billing_invoices` (privileges, registry and roles, payment modes, an invoice from an appointment with the grid price and the file-opening fee, taxes per line, never twice, the payer rule, the default payer, « Statut Indien », an amount to type, gapless numbering continuing a set sequence and never backwards, credit notes, drafts only edited, reads, anonymisation); pgTAP `136_professionals_supervisor` and `137_billing_queue_payments` (the queue's drafts once, the holds, « Envoyer » with a refusal for one, the deliveries and P3-40, payments and receipts, credit notes, statements); Deno `billing-documents/*.test.ts` (the receipt's text with the supervisor, the invoice, the statement, English; render, store, email, set aside, retry; preview); Vitest `src/modules/billing/**/*.test.ts(x)` (manifest; `InvoicePage`: lines and totals, the payer, an amount to type, finalising, an adjustment, a credit note, read-only for the conseillère; `ClientBillingPanel`: invoices, default payer, « Créer la facture »); Playwright `e2e/billing.spec.ts` (invoice Alice's appointment, finalise, credit; send the morning queue, record a payment; apply a late-cancellation fee); the audit labels by `src/app/audit-labels.test.ts`.

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

### F2 tables

| Table | What | Rules |
|---|---|---|
| `billing_settings` | per clinic: `queue_from` (« File du matin à partir du ») | null: the queue is off |
| `special_agreements` | a dossier's « entente particulière » (a note), one active | its sessions stop in the queue |
| `billing_queue_items` | per appointment: the draft the queue built (or the refusal's text) | once per appointment; a deleted draft is not rebuilt |
| `payments` | one invoice, the payer, the mode (`payment_modes.code`), the amount, the day, a reference | ≤ the balance; not « Note de crédit » (except an imported credit, BI-27: `payments_credit_note_imported_check` ties the mode to an `external_ref` « gorendezvous:… »); `external_ref` for the import and FS |
| `receipts` | one per payment, `R-AAAA-N` (sequence kind `receipt`) | |
| `statements` | a dossier's year for one payer | |
| `billing_deliveries` | a document to render and maybe email: kind, `send_email`, `explicit` (« Renvoyer »), status `pending` / `sending` / `done` / `failed`, the email's outcome (`sent`, `skipped` with `not_requested` / `no_email` / `reserved` / `module_disabled`, `failed`), tries | claimed by `billing-documents`; three tries (the per-address limit is none) |
| `billing_sync_events` | the QuickBooks outbox (BI-13): `invoice_issued`, `invoice_credited`, `payment_recorded`, `payment_refunded`; invoice, entity, tries, last code | service role only, not audited; once per entity; never an import |

`invoices` gains `queue_day`, `hold_reason` (`special_agreement`, `client_agreement`, `manual`), `hold_note`, `paid_cents`, `payment_status` (`unpaid`, `partial`, `paid`) and `pdf_file_id`; `credit_notes`, `receipts` and `statements` have their `pdf_file_id` (purpose `billing_document`, bucket `documents`, read with `billing.view`, kept).

### F3 tables

| Table | What | Rules |
|---|---|---|
| `billing_settings` (F3 columns) | `dunning_from` (« Relances à partir du »; null: no reminder, no block), `dunning_days` (3, 5, 7, 10), `block_after_days` (10) | `set_billing_dunning` (billing.settings) |
| `billing_dunning_runs` | per invoice and step: the day, the delivery (null: a missed step recorded) | once per step |
| `cancellation_fee_decisions` | per late cancellation or absence: the dossier, the professional, `pending` / `applied` / `waived`, the percent and amount, the draft, who decided (`professional`, `staff`, `automatic`) | the staff read all, a professional her own |
| `refunds` | a payment's refund: amount, reason, `recorded` / `pending_provider` / `failed`, the provider's reference | at most what is left of the payment |

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

## RPCs (F2)

| RPC | Permission | What |
|---|---|---|
| `get_billing_settings()`, `set_billing_queue_from(date)` | view / `billing.settings` | the queue's start (at most 14 days back) |
| `set_special_agreement(client, note)` | `billing.manage` | null or blank ends it |
| `list_morning_queue()` | `billing.view` | the queue's drafts: held first (stored, or live: `price_missing`, `payer_missing`), then by session date |
| `hold_invoice_draft(invoice, note)`, `release_invoice_draft(invoice)` | `billing.manage` | « Mettre en attente » / « Remettre dans la file » (an agreement validated) |
| `send_invoices(ids[])` → (invoice, number, error) | `billing.manage` | each draft finalised and sent (an issued one sent again); a refusal answered for that one |
| `send_billing_document(kind, id)` | `billing.manage` | « Renvoyer » an issued document |
| `record_payment(invoice, mode, cents, day, reference)` → receipt | `billing.manage` | the receipt sent at once |
| `create_statement(client, year, payer, send)` → id | `billing.manage` | stored; emailed when `send` |
| `get_billing_document(kind, id)` | `billing.view` | what a PDF prints, and the logo (« Aperçu », a draft too) |
| `billing_deliveries_for_service`, `billing_document_for_service`, `finish_billing_delivery_for_service`, `discard_billing_file_for_service` | service role | `billing-documents` |
| `billing_sync_events_for_service(org, limit)`, `finish_billing_sync_event_for_service(org, id, error)` | service role | FQ's push (with `private.billing_invoice_for_sync` and `private.billing_payment_for_sync`, granted to no role) |

F1's `create_invoice`, `finalize_invoice` (now a PDF, no email), `issue_credit_note` (refused with payments; emailed when the invoice was), `get_invoice` and `get_client_billing` (payments, receipts, deliveries, the agreement, the balance) are replaced with the same signatures; `list_invoices` gains `paid_cents` and `payment_status`.

## RPCs (F3)

| RPC | Permission | What |
|---|---|---|
| `set_billing_dunning(from, days[], block_after)` | `billing.settings` | the reminders' start, days and the blocking day |
| `list_overdue_invoices()` | `billing.view` | « Impayés » |
| `list_fee_decisions(status)` | `billing.view`, or `billing.self` (her own) | the fees to decide, with the fee now |
| `decide_cancellation_fee(appointment, apply, note)` → draft or null | `billing.self` (her own) or `billing.manage` | « Appliquer les frais » / « Ne pas facturer » |
| `refund_payment(payment, cents, reason)` → id | `billing.manage` | recorded, or waiting for Stripe |
| `refunds_for_service`, `finish_refund_for_service` | service role | lane C's FS |

**Replaced:** `private.client_has_balance` (Rendez-vous' stub), `private.billing_paid_fees` (FPay's stub), `billing_apply_payments` (refunds), `billing_invoice_appointments` (the policy of the clinic named: the queue's drafts get the file opening), the delivery RPCs (`reminder`), `get_invoice` (refunds, reminders, fee), `get_billing_settings`, the Clients handlers.

## Jobs, functions and emails (F2)

- **`billing.build_drafts`** (SQL, hourly at :40): per clinic with a start date, the completed sessions of the days before today (at most 14 back) not queued nor invoiced become drafts, held for an agreement; detail `built=… held=… failed=…`.
- **`billing-documents`** (job `billing.documents`, every 5 minutes; user `{ action: 'deliver' }` with `billing.manage` right after a send, `{ action: 'preview', kind, id }` with `billing.view`): claims up to 25 deliveries, renders each PDF once (pdfmake; the logo when it loads) and stores it, then emails it attached to the payer (templates `billing.invoice`, `billing.credit_note`, `billing.receipt`, `billing.statement`, each with `_en`; attachments allowed). Limits `billing.deliver_user` (120 an hour) and `billing.preview_user` (60 an hour).
- **`billing.follow_up`** (SQL, hourly at :50, F3): the fees to decide (from the queue's start, 30 days back at most) and the reminders due (templates `billing.reminder` / `_en`, the invoice's PDF attached, delivered by `billing-documents` as kind `reminder`), the notice the day a balance blocks; detail `fees=… reminders=…`.
- **P3-40:** while Facturation is reserved for its testers, the PDF is made and the email set aside (`reserved`); the send path holds it too (CC-14). pgTAP 137 checks both.

## Screens (F1)

- **« Facturation »** (`/facturation`, `billing.view`): « Factures » newest first by state (real tabs, the view in the URL: Brouillons, Émises, Créditées, Toutes), each row opening the invoice. A new invoice starts from the client's record.
- **The invoice** (`/facturation/factures/:id`): the dossier, « Facturé à » (a draft: the client or a relation with the right), the lines (type, code, quantity, unit price, taxes, total; a « montant saisi » line's amount typed in place; removed from a draft), « Ajouter une ligne » (an adjustment, taxable or not), the totals (sous-total, TPS and TVQ with their rates, total), « Exempté de taxes (Statut Indien) », the notes (the client's fixed once issued). A draft: « Finaliser la facture » (the number in a toast) or « Supprimer le brouillon »; an issued invoice: « Émettre une note de crédit » (a reason), shown on it afterwards. Read-only without `billing.manage`.
- **Clients → « Visites et paiements »** (slot `client.visits`, panel `billing.invoices`): « Facturé à, par défaut », the last year's appointments not invoiced yet with « Créer la facture » (it opens the draft; a second person's appointment is invoiced on the first person's dossier), « Nouvelle facture (sans rendez-vous) », and the dossier's invoices with their payer and state. Payments come with F2.
- **Paramètres → Facturation** (`billing.view`, changed with `billing.settings`): « Numérotation »: the year's last number used (GOrendezvous's at the cutover) and the next one.

## Screens (F2)

- **« File du matin »** (the first, default tab of `/facturation`): the queue's drafts, held first with their reason and note (« Entente particulière : à valider », « Entente avec le professionnel : à valider », « Montant à indiquer », « Payeur sans adresse courriel », « En attente »), then by session date; each shows the dossier, the session's day, its lines, the payer and the total. « Tout envoyer (N) » sends every ready one, « Envoyer » one (a payer without an address too: its PDF, no email), « Valider l'entente » / « Remettre dans la file » lift a hold, « Mettre en attente » sets one with a note. What went is a toast, what did not is listed by dossier. The other tabs list the invoices, the issued ones with their payment state.
- **The invoice:** a draft has « Aperçu PDF », « Finaliser et envoyer » (primary), « Finaliser sans envoyer », and its hold (« Remettre dans la file »); an issued one has « Télécharger le PDF », what its email did (« Envoyée au payeur par courriel le … », « PDF prêt. Pas envoyé par courriel : … », « Envoi en cours », « Échec »), « Renvoyer au payeur », its payment state, « Paiements » (each with its receipt, its PDF and what its email did) and « Enregistrer un paiement » (mode, amount = the balance, day, reference); the credit note's PDF too.
- **Clients → « Visites et paiements »:** the dossier's balance, « Entente particulière » (a note; « Terminer l'entente »), the invoices' payment state, « Paiements du dossier » with their receipts, and « Relevés » (a year and a payer: « Préparer le relevé » or « Préparer et envoyer au payeur »; each statement's PDF once ready).
- **Paramètres → Facturation:** « File du matin »: « À partir du » (empty: off; at most 14 days back).
- **Professionnels → « Identité et permis » → « Supervision »:** an intern's supervisor (`professionals.manage`).

## Screens (F3)

- **« Impayés »** (a tab of `/facturation`): the unpaid invoices past their due date, oldest first: the invoice, the dossier (« Rendez-vous refusés » when its balance blocks a booking), the payer (« Pas d'adresse courriel »), the due date, the delay, the balance, the last reminder.
- **« Frais d'annulation »** (a tab): the late cancellations and absences, pending first, each with the fee now (« 50 % de la séance : 65,00 $ »), « Appliquer les frais » (its draft joins the morning queue) and « Ne pas facturer » (`billing.manage`), and who decided.
- **« Mon agenda »** (slot `agenda.mine`, panel `billing.fees`, `billing.self`): the professional's own fees to decide, the same two buttons; nothing when there is none.
- **Accueil:** a professional with fees to decide gets « Frais d'annulation à décider » (`billing-my-fees`, `billing.self` with a professional file), linking to that panel (`/mon-agenda#frais`); « Facturation à traiter » counts them for `billing.manage` (→ « Frais d'annulation »). The appointment sheet's « Facturation » says who decides a fee « À décider » (the professional in « Mon agenda », the adjointe for her) and gives `billing.manage` the same two buttons.
- **The invoice:** each payment's « Rembourser » (an amount, what is left by default; a reason) and its refunds (« Remboursé », « En attente de Stripe », « Refusé »); « Relances » (the day each reminder went, or a step passed without one).
- **Paramètres → Facturation → « Relances »:** « Relances à partir du » (empty: no reminder and no refusal), the days, and the day a balance refuses a booking.

## « Exporter (CSV) » on the invoices (parity audit L7)

The tabs « Brouillons », « Émises », « Créditées » and « Toutes » export their invoices, newest first, every page (`fetchAllInvoices`: `list_invoices` 200 at a time, 5 000 at most): number, issue date, file number, client, payer, total, paid, balance, state, payment. Built in the browser (`lib/invoices-csv.ts`), nothing stored.

## The appointment sheet's « Facturation » (parity audit L10, BI-22)

Migration `20261014033531_billing_appointment_billing`; pgTAP `184_billing_appointment_billing`. Facturation fills the core slot `appointment.sheet` (`billing.view`, `pages/AppointmentBillingPanel.tsx`), so Rendez-vous' sheet shows a « Facturation » tab:

- `get_appointment_billing(appointment)` (definer, `billing.view` first; null when not the clinic's or personal) returns the appointment's invoice lines (session, cancellation fee; live or credited) with their invoice's number, state, payment, total and paid, the client billed; `invoiceable` (booked, confirmed or completed, no live session line); `preview`, the price `create_invoice` would put (`service_price` for the first client: her rate, her tax exemption, the professional's title, the day), its taxes and total, `missing` when not fixed, and the file-opening fee when this would be her first invoice; `fee`, the cancellation-fee decision (kind, state, percent, amount, invoice).
- The panel: each live invoice (a link, « Émise », « Payée en partie », « Solde »); not invoiced, « Prix prévu : … » and « Créer la facture » (`billing.manage`, `create_invoice`, then the invoice opens); a fee and its decision; the credited invoices named.

## What the module publishes

- **For Demandes' waiting list (BI-19, migration `20261013152313_billing_source_hooks`):** `private.billing_create_waitlist_fee_invoice(org, client, entry, actor)` → (invoice id, number): the `waitlist_registration` service to the dossier's default payer, issued and sent (P3-40), never twice while one stands (source `waitlist_fee`). **`billing_source_hooks`** (source type → `private.<name>_billing_changed(org, source_id, invoice_id, state)`, like Clients' handler catalogues): an invoice of that source moving between `issued`, `paid` and `credited` calls its module's hook (trigger `invoices_source_hooks`), when that module is enabled.
- **`private.billing_create_service_invoice(org, client, service, source_id, actor)`** → draft id: a service outside the agenda (Demandes' waiting-list fee, a report), priced today. Granted to no role.
- **For Clients:** `private.billing_reassign_client(old, new)` and `private.billing_anonymize_client(id)` in the handler catalogues (a merge moves invoices and default payers; an anonymisation keeps the invoices and their amounts, blanks their notes, drops the default payers). Lane B's FQ adds its QuickBooks part to these two functions (`create or replace`).
- **For Rapports (RP1):** `private.billing_revenue_lines(org, from, to)` (the lines of the invoices issued between two clinic dates, issued or credited, with the invoice's totals and what is paid), `private.billing_revenue_payments(org, from, to)` (the payments of the period with their mode's name and the professionals and services of the invoice's lines not credited), `private.billing_payment_mode_names(org)`; `private.billing_revenue_refunds(org, from, to)` (parity audit L6: the refunds recorded between two clinic dates, by the day they were recorded, with their payment's mode, never the reason). Granted to no role; signatures stable.
- **Coming:** `client_balance(client)`, `private.client_has_balance` (F3, replacing Rendez-vous' stub).

### What this module reads from the others (published only)

- **Clients:** `private.clients_billing_facts(org, ids[])` (number, name, rate variant, « Statut Indien », language, archived, closed), `private.client_contacts_for(…, 'invoices')`, `private.clients_display_names`.
- **Rendez-vous:** `private.appointment_billing_facts(org, ids[])`, `private.client_billable_appointments(org, client, since)`.
- **Services et tarifs:** `private.service_price`, `private.service_booking_facts`, `services_catalog`, `billing_policy_on`.
- **Professionnels:** `private.professional_booking_facts` (titles, primary first); F2: `private.professional_receipt_facts(org, ids[])` (name, primary title, order, licence, and the supervisor's), `private.professional_client_agreement_on(org, professional, client, day)` (the agreement that holds a session in the queue).
- **Professionnels (payroll):** `private.professional_session_pay`, `private.professional_compensation_rate`, `private.professional_payout_facts`, `private.professional_display_names`, `private.professional_profile_id`, `private.professional_for_profile`.
- **Rendez-vous (payroll):** `private.appointments_for_billing(org, from, to)`.
- **Services et tarifs (payroll):** `private.service_payout_facts(org, ids[])`.
- **Core:** `tax_rates` (« Fiscalité »).

## Paie des professionnels (FPay)

Every month, a summary per professional of what the clinic owes her, which she checks and validates in « Ma paie » before attaching her invoice; the administration then marks it paid (Christine 14, decisions **FPay-1 … FPay-12**). Migrations `20261013120845_professionals_payout_facts`, `20261013120848_services_payout_facts`, `20261013120851_billing_payroll`; pgTAP `143_professionals_payout_facts`, `145_billing_payroll`; Vitest `lib/payroll.test.ts`, `pages/MyPayPage.test.tsx`; the function `billing-payout-invoice` (Deno tests beside it).

- **Tables:** `payout_periods` (one per professional and month: state, specialty, counts, total, who built, sent, validated, paid), `payout_lines` (kind `session` / `late_cancellation` / `other_fees` / `workshop` / `adjustment`, the appointment or invoice line, the client, the service, the date, the client price, the retention, the amount, how it was priced; `amount_cents` null = « À compléter »), `professional_invoices` (one per period: uploaded or generated, the file, her number and date, the amount, `qbo_bill_id` for FQ), `payout_service_rules` (a service's rule when not its default). RLS: `billing.payroll` reads all; a professional (`billing.self`) her periods once sent, their lines and invoice; the rules with `billing.settings` or `billing.payroll`.
- **Rules** (FPay-1, FPay-2, FPay-6, FPay-7): sessions at the client price of her primary title's grid for the session's duration less her retention in force that day (`private.professional_session_pay`; an « Entente particulière » first; IVAC and PAE at the regular price; a couple's session once); late cancellation and absence fees once paid, at « Annulation tardive » (`private.billing_paid_fees`, an empty stub until F3 replaces it); reports, discussions and tests from issued invoice lines naming her, before taxes, at « Autres frais »; workshops at « Ateliers et conférences ». The rates are Professionnels' (Paramètres → Rémunération).
- **Once** (FPay-3): unique per appointment and kind, and per invoice line. A build also takes what was missed in the months the payroll already ran (three back at most), never before the clinic's first period sent; a fee counts by its payment's date. Every state change takes the build's advisory lock first (no interleaving, no deadlock).
- **States and lock** (FPay-4, FPay-5): `draft` → `to_validate` → (`correction_requested` → `to_validate`) → `validated` → `paid`. A validated or paid period's lines never change (trigger `payout_lines_lock`); « Rouvrir » (validated only, with a reason) detaches the invoice.
- **RPCs** (`billing.payroll`): `list_payout_periods(month)`, `build_payout_month(month)` (a finished month only), `rebuild_payout_period(id)`, `send_payout_periods(ids)` → `{sent, unpriced}`, `add_payout_adjustment(period, cents, note)`, `remove_payout_adjustment(line)`, `reopen_payout_period(id, reason)`, `mark_period_paid(id, paid_on, note)` (validated with an invoice), `list_payout_export(month)`, `discard_payout_drafts(month)` (drafts never sent). The professional or the administration: `list_my_payout_periods()`, `get_payout_period(id)`, `request_payout_correction(id, note)`, `validate_payout_period(id)`, `attach_professional_invoice(period, file, number, issued_on)` (purpose `billing_professional_invoice`). Settings: `list_payout_rules()`, `set_payout_rule(service, rule)` (`billing.settings`). Service role (the function): `prepare_professional_invoice(period, actor)`, `record_generated_professional_invoice(period, file, number, issued_on, actor)`.
- **Function `billing-payout-invoice`** (user, `billing.self`, the module gate; renders: pdfmake, ADR 0008): « Générer ma facture » renders her invoice from the validated summary (clients by file number only), stores it (`register_system_file`, view `billing.payroll`, owner her) and records it; 20 an hour per caller (`LIMITS.billingPayoutInvoiceUser`).
- **Job** `billing.payout_periods` (SQL maintenance job, daily at 11:15 UTC, acting on the clinic's 1st or a missed 1st within the week): last month's drafts for every clinic with Facturation on; one notice to `billing.payroll`. Notices to the professional on send, reopening and payment; to the administration on a correction. No email (FPay-11).
- **Screens:** « Paie » (`/facturation/paie?mois=AAAA-MM&periode=…`, `billing.payroll`): the month's summaries, « Calculer le mois », « Envoyer les sommaires prêts (n) », « Exporter pour QuickBooks » (CSV by specialty), a summary in a side sheet (lines, adjustments, « Recalculer », « Valider pour … », the invoice on her behalf, « Marquer comme versée », « Rouvrir »). « Ma paie » (`/ma-paie`, `/ma-paie/:periodId`, `billing.self`, an account with a professional file): her summaries, « Valider le sommaire », « Signaler une correction », « Téléverser la facture » or « Générer la facture ». Paramètres → Paie (`payroll`, path `paie`): each service's rule, the job.
- **Open:** the 30 % of a cancellation fee (FPay-6, to confirm with Christine); GST and QST on a registered professional's invoice; a credit note after the lock (clawback); feeding the retention program's monthly session counts from the payroll; FQ pushes the bills; CLAUDE.md §7 to name `billing-payout-invoice` (user function, renders).
## QuickBooks (FQ part 1, lane B)

Decisions **FQ-1 … FQ-5**. PS Hub's connector is the source (roadmap §2.6), its flaws fixed. Nothing is written to QuickBooks in this part (FQ-4).

- **Tables** (`billing.settings` reads them; every write is an RPC): `qbo_connections` (one company per clinic, its realm fixed once connected; statuses `connected`, `needs_reconnect`, `disconnected`), `qbo_connection_tokens` (encrypted under the PII key version, no policy, read only by `get_qbo_credentials` for the service role), `qbo_accounts` (the chart of accounts as last read, a mirror), `qbo_account_map` (`revenue.services`, `revenue.file_opening`, `deposit.<code>` for each **payment mode that lands money** (F1's `payment_modes`, `is_deposit`, active: `credit_note` has none), `expense` per profession title; a suggestion from the clinic's chart, never over a person's choice), `qbo_customers` (the company's customers as last read, a mirror), `qbo_customer_matches` (each customer matched to a file with Clients' duplicate rules: HIGH → linked, MEDIUM or several → « à décider », none → nothing; a person's decision is final), `qbo_links` (the payer's parent customer and the (payer, dossier) sub-customer, R-30, filled by the push).
- **Functions:** `qbo-connect` (user, `billing.settings`: `start` → Intuit's consent with a signed single-use state; `disconnect` → the grant revoked, tokens deleted, the mapping kept), `qbo-callback` (user: the code exchanged, the company stored, the first read), `qbo-sync` (user: accounts and customers read, then matched in pages), `qbo-token-refresh` (job `billing.qbo_token_refresh`, daily, maintenance: Intuit's 100-day refresh token never lapses).
- **Screens:** Paramètres → **QuickBooks** (`quickbooks`: the connection, the Intuit application's two secrets, the return address to declare, the accounts map with « Suggéré », the keep-alive job) and **Clients QuickBooks** (`quickbooks-clients`: « À décider », « Associés », « Sans correspondance », « Ignorés », with « Associer », « Associer à un autre dossier », « Ignorer », « Revenir à l'automatique »); Intuit returns to `/facturation/retour-quickbooks`.
- **Clients:** F1's `private.billing_reassign_client` / `billing_anonymize_client` are replaced with F1's body kept and the QuickBooks part added (matches and links follow a merge; an anonymisation blanks this app's copy of the matched customers).
- **Locally:** `npm run fake:qbo` (port 55395, `_shared/testing/fake-qbo.ts`); the seed stores the fake's application.
- **Tests:** pgTAP `150_billing_quickbooks`; Deno tests of the four functions and `_shared/qbo/`; Vitest `QuickBooksSettingsPage`, `QuickBooksCustomersPage`, `lib/qbo-status`.
## QuickBooks: the push (FQ part 2, lane B)

Migrations `20261013132858_billing_qbo_push` (pgTAP `151`), `20261013163110_billing_qbo_refunds` (pgTAP `157`, after F3) and `20261013192923_billing_qbo_payers` (pgTAP `167`, after FP); decisions **FQ-6 … FQ-13**. The job **« Envoi à QuickBooks »** (`billing.qbo_push`, function `qbo-push`, every 10 minutes, off until enabled) reads F2's outbox `billing_sync_events` (agreed with lane A: `billing_sync_events_for_service`, `finish_billing_sync_event_for_service`, `private.billing_invoice_for_sync`, `private.billing_payment_for_sync`) oldest first, then FPay's professional invoices.

- **The switch (FQ-6):** `qbo_push_paused` in the module's settings, **paused when absent**: nothing at all is sent until the cutover's go/no-go. Paramètres → QuickBooks → « Envoi à QuickBooks »: « Démarrer l'envoi » (asked first; `set_qbo_push_paused`, `billing.settings`, audited) / « Mettre en pause ».
- **What goes (FQ-7):**
  - `invoice_issued` → an **Invoice** for the (payer, dossier) sub-customer under the payer's parent (R-30; part 1's match, else made on first use: `customers.ts`), `DocNumber` the app's number, one line per invoice line on an **item**: the company's item for the service code (its SKU, else a name starting with the code: GOrendezvous's), else one made for it on the income account of its kind (`revenue.file_opening` « Ventes » for a file opening, `revenue.services` « Services » otherwise; a **cancellation fee** (F3, FQ-12) goes on the item of its code `70300` / `70360`, else on « Services », with the line's own text: the percent and the session's day), the tax code `tax.taxable` or `tax.exempt` (two new rows of the map, suggested « TPS/TVQ QC » and « Exonéré »);
  - `invoice_credited` → a **CreditMemo** with the invoice's lines, for the invoice's customer (after the invoice);
  - `payment_recorded` → a **Payment** applied to the pushed invoice, deposited to the account of its mode (`deposit.<code>`), after its invoice;
  - a **third-party payer's invoice** (FP: IVAC, a PAE; FQ-13):
    - It goes to the organisation's customer, the parent: the company's customer of the same name when it exists (GOrendezvous made « IVAC »), linked once as `matched`, else made on first use.
    - It goes there through a sub-customer for the dossier, « facturé avec le parent » (« N° 1234 · Prénom N. · IVAC »).
    - These customers are kept in `qbo_organisation_links` (`record_qbo_organisation_link_for_service`); `qbo_links` keeps client payers only.
    - Its credit memo and payments follow its customer. The payer's reference (its file number) goes in the memo.
    - `payer_claim` lines go on the item of their service code. `payer_share` (negative, on the client's invoice) goes on one item « Part payée par un tiers » on « Services », exempt. Both keep their own text.
    - Clients' merge moves the dossier's link (Facturation's `billing_reassign_client`, widened from FP's version);
  - `payment_refunded` (F3, FQ-11) → a **JournalEntry** dated the clinic's day of the refund, once its payment is in QuickBooks: debit the company's Accounts Receivable account (« Comptes clients », read from the chart; none → `missing_map` `receivable`) for the payment's customer, credit the payment mode's deposit account (`deposit.<code>`); `DocNumber` `R-<invoice number>`. As in the app, the customer owes the amount again until the invoice is paid or credited. Not a RefundReceipt (it would take the amount off the income, then a credit note would take it off twice) and not a negative Payment (QuickBooks has none);
  - a validated or paid payroll period with its invoice (FPay) → a **Bill** for her vendor (`qbo_vendor_links`, made on her first bill), on the expense account of her specialty (the period's title), `professional_invoices.qbo_bill_id` set.
- **Never twice (FQ-8):** `qbo_pushes` keeps each document's push (`pending`, `pushed` with the QuickBooks id, `failed`), one per entity; a document pushed only closes its event. Every create carries Intuit's `requestid` derived from the entity, so an answer lost in transit returns the first document. A refusal is recorded with its code and tried again after 5 min, 10, 20 … 12 h; after 8 tries it is `failed` until « Réessayer ». A missing map line is named (`missing_map`) and nothing is sent. A token Intuit refuses stops the pass (`needs_reconnect`).
- **Totals (FQ-9):** QuickBooks computes the taxes from the codes; when its total differs from the app's (rounding), the push is kept and marked « à vérifier ».
- **Where it shows (FQ-10):** « Envoi à QuickBooks » lists the documents waiting or refused, why in plain words, and « Réessayer » (`list_qbo_pushes`, `retry_qbo_push`); an invoice's page shows « Dans QuickBooks depuis le … », « En attente d'envoi » or « refusé : … » (`qbo_invoice_push_status`, `billing.view`).
- **The sync** also reads the company's items and tax codes (`qbo_items`, `qbo_tax_codes`: mirrors, not audited, like the accounts).
- **Tests:** pgTAP `151_billing_qbo_push`, `157_billing_qbo_refunds` (the refund waits for its payment, then its accounts and customer; no receivable account; the fee line's item and text); Deno `qbo-push/handler.test.ts` (paused, invoice then payment, a refund's journal entry, a lost answer, a refusal, a missing map, a bill, a dead grant) against `fake-qbo.ts` (creates, `requestid`, items, tax codes); Vitest `QuickBooksSettingsPage` (the switch, the list, the tax rows).


## Payeurs tiers : IVAC et PAE (FP)

IVAC and PAE (Christine 12 and 13, decisions **FP-1 … FP-10**). Part 1 (migrations `20261013184129_clients_payer_terms`, `20261013184139_billing_third_party_payers`; pgTAP `166_billing_third_party_payers`): the model, the split, the payer invoices, the closing reminder. Part 2: the screens, below. Part 3 (migration `20261013194601_billing_payer_documents`, pgTAP `168_billing_payer_documents`; FP-11): the import adds the payer tags as payers « à compléter » (`import_client_payers`, after the clients and relations); an organisation's PDF names it with the clinic's provider number and the file number, due on its date, and an IVAC invoice each professional's IVAC number (`billing_document.payer_numbers`). QuickBooks: lane B. Fixes from the parity audit (migration `20261013205523_billing_payer_guards`, pgTAP `169`; FP-12 … FP-14): one active payer per kind, a PAE's file number required to complete it and once per provider, a payment's note.

- **Screens (part 2):** « Payeurs tiers » (`/facturation/payeurs`, menu Facturation, `billing.view`; actions `billing.manage`): one block per organisation (IVAC first) with what is to claim per dossier, « À facturer maintenant » or when it will be (by cadence), the drafts to send (« Tout envoyer »), the unpaid; « Préparer les factures (N) » and « Facturer les PAE » (asks first; once per PAE provider, never IVAC). Paramètres → Payeurs tiers (`payers`, `payeurs-tiers`; seen with `billing.manage` or `billing.settings`): IVAC's rate (`billing.settings`) and the organisations (`billing.manage`: a PAE provider added, any changed; IVAC stays active). A dossier's Facturation panel: « Payeurs tiers » (the year's use, « Budget bas », « Expiré », « À compléter », the organisation billed, « Nouvelle facture à … »). The invoice page names the organisation and its file number (no payer choice); a `payer_share` line is never removed by hand; the morning queue's « Payeur tiers à compléter » opens the dossier's « Assurance et payeurs ». Clients: the payer dialog takes a PAE's amount or share, its renewal day (March 31 by default) and the use before the app; « Payeurs à compléter » (`/clients/payeurs-a-completer`, `clients.view`), linked from « Payeurs tiers ».

- **Tables:** `payer_organisations` (the clinic's IVAC, made for every clinic, and the PAE providers: billing address, contact, language, the clinic's provider number, cadence `monthly` / `threshold` / `closing`, delay to pay, reminders on or off), `billing_payer_rates` (IVAC's rate, dated), `client_payer_organisations` (the organisation chosen for a client's payer). `invoices` gains `payer_organisation_id` and `payer_reference` (`payer_kind = 'organisation'`, `payer_client_id = client_id`, `source_type = 'payer'`); `invoice_lines` gains `payer_share` (negative) and `payer_claim` lines with `client_payer_id`, `payer_organisation_id`, `source_line_id` (a claim's share, claimed once) and `service_on`.
- **The split (FP-2):** `private.billing_apply_payer_shares` on every draft from sessions and again in `billing_finalize`; held « Payeur tiers à compléter » when a payer is a stub or lacks its organisation or coverage, and not finalised (FP-9).
- **Payer invoices (FP-3):** `private.billing_build_payer_invoices(org, organisation, closing, actor)` drafts per organisation and client's payer what is due by its cadence (`billing_payer_claim_until`), or everything (`closing`); `send_invoices` finalises and sends them like any draft.
- **RPCs:** `list_payer_organisations()`, `save_payer_organisation(…)` (`billing.manage`; IVAC kept, PAE providers added), `set_client_payer_organisation(client_payer, organisation)`, `get_payer_settings()`, `set_ivac_rate(from, cents)` (`billing.settings`), `get_client_payers_billing(client)`, `list_payer_queue()`, `prepare_payer_invoices(organisation, closing)`, `create_payer_invoice(client_payer)`. Clients: `save_client_payer` (the terms, the prior use; a save completes a stub), `list_client_payers_to_complete()`, `import_client_payers(row, dry_run)`; published `private.client_payer_terms`, `client_payer_facts`, `client_payers_of`.
- **Elsewhere (FP-6):** an organisation's invoice never on the card, the pay link, an Interac match, the client's balance or statement, the balance rule; reminders only when its organisation has them; its receipt not emailed; a claimed share's client invoice credited after the payer's.
- **For Rapports (RP2, lane B; reviewed by lane C):** `private.billing_payer_claim_facts(org, from, to)`: each payer's share of the period's sessions and each line billed to an organisation by hand, with its claim's state (`to_claim`, `draft`, `claimed`, `partial`, `paid`; the payer invoice's `paid_cents`); `private.billing_payout_facts(org, from_month, to_month)`: the payroll summaries with their amounts per kind (migration `20261014025051_billing_rp2_report_facts`).
- **Job:** `billing.payer_closing` (SQL, daily): after an agreement year ends, one notice to `billing.manage` to invoice what is left.

## Paiements en ligne (FS)

Stripe (card on file, the next-day charge, « Payer en ligne ») and Interac « À rapprocher » (Christine 6, decisions **FS-1 … FS-9**). Migrations `20261013133951_core_webhook_events_stripe_provider` (`stripe` among the webhook providers), `20261013133955_billing_stripe_interac`, `20261013161412_billing_stripe_refunds` (FS-9); pgTAP `161_billing_stripe_interac`, `162_billing_stripe_refunds`; Deno tests of the five functions and `_shared/stripe/`; Vitest `ClientCardPanel`, `InteracPage`, `StripeLinkPage`; Playwright `e2e/stripe-interac.spec.ts`.

- **Recording a payment:** `private.billing_record_payment(org, invoice, mode, amount, paid_on, reference, external_ref, actor)`: `record_payment`'s checks and sequence, idempotent on `external_ref` (FS-1). `record_payment` calls it. A notice read from administration@ is matched at once when exactly one issued invoice has its amount as balance and the payer's name in the sender's.
- **Tables** (`billing.view` reads, every write an RPC, audited): `stripe_customers` (a payer's Stripe customer, card brand, last four, expiry, status, consent date; never the number), `stripe_charges` (each charge: `auto` once per invoice, `manual`; `pending` / `succeeded` / `failed` with Stripe's code), `interac_notices` (`to_match` / `matched` / `ignored`; the message redacted in the audit log).
- **Links:** purposes `billing_card_setup` (`/carte`, 7 days, 5 opens) and `billing_pay` (`/payer`, 30 days, 10 opens), resolved by `resolve_billing_card_link` / `resolve_billing_pay_link`.
- **Functions** (decisions FS-2 … FS-5):
  - `billing-stripe` (user, `billing.manage`): `card_link` (the customer made once, the link, the email `billing.card_setup` / `_en`, sent as an explicit resend (the 5 s double-click guard, not the 60 s same-address limit; a refused email → 429 with `Retry-After`); a reserved module → 409), `charge_now`, `remove_card`; `LIMITS.billingStripeUser`.
  - `billing-stripe-checkout` (public token, `LIMITS.billingCheckoutIp` first): one use of the link, then a Checkout session (setup with the consent text, or payment for the balance); Stripe's URL only.
  - `stripe-webhook` (webhook, `?org=`, `LIMITS.stripeWebhookIp`): signature, claim, module, then the card or the payment, or a charge failed.
  - `billing-stripe-charges` (job `billing.stripe_charges`, 10 h, off until switched on): the due invoices charged once each.
  - `billing-documents` (F2) adds the « Payer en ligne » button to an invoice email when the database issues the link (`issue_billing_link_for_service`), optional (`actionOptional`).
- **Service RPCs:** `stripe_card_link_context_for_service`, `save_stripe_customer_for_service`, `issue_billing_link_for_service`, `begin_billing_checkout_for_service`, `record_stripe_card_for_service`, `stripe_card_for_service`, `stripe_card_removed_for_service`, `record_stripe_payment_for_service`, `stripe_charges_due_for_service`, `begin_stripe_charge_for_service`, `finish_stripe_charge_for_service`, `stripe_payment_failed_for_service`, `record_interac_notice_for_service` (for Communications, CM1b).
- **User RPCs:** `get_client_stripe(client)`, `list_interac_notices(status)`, `add_interac_notice(…)`, `match_interac_notice(notice, invoice)`, `ignore_interac_notice(notice, reason)`.
- **Screens:** « Carte au dossier » in Clients' « Visites et paiements » (slot `client.visits`); « Virements Interac » (`/facturation/virements`); Paramètres → Paiements en ligne (`online_payments`, path `paiements-en-ligne`: the two keys, the webhook address, the job); the public pages `/carte` and `/payer` (and their `?etat=merci` / `annule` returns).
- **Locally:** `npm run fake:stripe` (port 55397, `_shared/testing/fake-stripe.ts`: customers, Checkout with a page that completes it and sends the signed webhook, setup intents, payment methods, off-session PaymentIntents; `pm_fakeDeclined` is refused); the seed holds its keys; `STRIPE_API_BASE_URL` in `supabase/functions/.env`.
- **Refunds (FS-9):** « Rembourser » a Stripe payment: `billing-stripe` (`refund`) refunds the card at Stripe once (`_shared/stripe/refunds.ts`), settled through `settle_stripe_refund_for_service` (F3's `finish_refund_for_service`); `stripe-webhook` settles the pending ones (`charge.refunded`, `refund.updated`, `refund.failed`); the job `billing.stripe_refunds` (`billing-stripe-refunds`, every 10 minutes, off until switched on) takes what is left (`stripe_refunds_due_for_service`, P3-40). Service RPCs: `stripe_refunds_due_for_service`, `stripe_refund_for_service`, `settle_stripe_refund_for_service`.
- **Open:** Interac notices from administration@ (CM1b, once real examples exist); CLAUDE.md §7 to name the five functions.

## The GOrendezvous import (I3, BI-20)
- **RPC:** `import_invoice(row, dry_run)` (`billing.manage`, audit source `import`), called by `scripts/import-gorendezvous.mjs factures` (the runbook `docs/runbooks/import-gorendezvous.md`).
- **One invoice, all or nothing:**
  - `external_ref` « gorendezvous:<GOrendezvous number> »: a re-run answers `skipped`;
  - the number without its zeros, and `invoice_sequences` raised to it;
  - issued, due and finalised on its date, billed to the client;
  - the lines and totals as exported (Σ lines = total); a line's service by code (`private.service_id_by_code`), else an `adjustment` line;
  - the payments (`external_ref` « <invoice ref>:<n> »), and the refunds `recorded` on the latest payment that covers them.
- **The dossier:** `private.clients_import_match` (Clients). Not found or several → `unmatched`.
- **History:**
  - no delivery, receipt or QuickBooks event (`billing_queue_sync` already skips `import`);
  - `billing_run_dunning` and `client_has_balance` skip `source_type = 'import'`.
- **« Note de crédit » payments (BI-27, migration `*_billing_import_credit_notes.sql`, pgTAP `195_billing_import_credit_notes`):** an **imported credit**, a payment in mode `credit_note` that only `import_invoice` writes (`record_payment`, Stripe, Interac and the payers' payments refuse the mode; the check above refuses it without the import's ref). It counts in `paid_cents`; `billing_payment_for_sync` never returns it (a QuickBooks payment or refund push of one is `gone`); `refund_payment` refuses it (« Un crédit importé de GOrendezvous (note de crédit) ne se rembourse pas. ») and the invoice page shows no « Rembourser » for it; no receipt. A refund row carries its `mode_code` (from the tool): it goes on a payment of that mode first, then on the latest payment that covers it. The #171 guards hold for it (an active mode, no future date, the caps, never more than the invoice). The tool's report: « Paiements par note de crédit à importer / importés : N ».
- **Tests:** pgTAP `144_billing_import`; Vitest `scripts/import-gorendezvous/import-i3.test.mjs`.
- **« Payé par » (I2 prep, I-17):** `import_default_payer(row, dry_run)` (`billing.manage`; migration `*_billing_payer_import.sql`, pgTAP `180_billing_payer_import`): the client's dated default payer (`billing_payer_defaults`) from GOrendezvous's « Payé par »; the client herself or already the default `skipped`; a payer without « recevoir reçus et factures » `unmatched` (`payer_not_allowed`).

## Security review (2026-10-14)
Migration `*_billing_security_fixes.sql` (pgTAP `187_billing_security_fixes`) and `billing-stripe-checkout`:
- **QuickBooks, another company (BI-23):** `store_qbo_connection` on a new realm or environment (after « Déconnecter ») also drops the old company's `qbo_vendor_links`, `qbo_organisation_links`, `qbo_items`, `qbo_tax_codes` and `qbo_pushes`, and clears `professional_invoices.qbo_bill_id` / `exported_at`: the new company receives the professionals' bills again.
- **One Bill per professional's invoice (BI-23):** `payroll_record_invoice` (replace) and `reopen_payout_period` (detach) refuse (P0001) when the period's invoice is in QuickBooks (`private.payroll_invoice_in_qbo`: its Bill id, or its `bill` push `pending` or `pushed`); the correction goes through an adjustment on the next month.
- **Audit redaction:** `invoices` + `hold_note`, `payer_reference`; `interac_notices` `message`, `sender_name`, `reference`, `ignored_reason`; `stripe_customers` the `cus_` / `pm_` ids and the card's brand, last four and expiry; `payer_organisations` + `contact_name`, `billing_email`.
- **Anonymisation:** `private.billing_anonymize_client` also clears the payments' notes (and references through the dossier's invoices), `invoices.payer_reference`, the credit notes' and refunds' reasons (through the dossier's invoices too) and the matched Interac notices' sender, message and reference.
- **Locks:** `decide_cancellation_fee` checks `billing.manage` / `billing.self` before it locks the decision; `private.billing_apply_payer_shares` takes `billing.payer:<client_payer_id>` (advisory, to commit) before reading a payer's consumption, so two finalisations never pass its maximum together.
- **Interac by itself (BI-25):** `record_interac_notice_for_service` records a payment only when the sender carries the payer's first and last names (score 2); a last name alone stays « À rapprocher », suggested.
- **Imported invoices (BI-24):** never in the payroll (`private.payroll_build`'s invoice lines) nor in `stripe_charges_due_for_service`.
- **Charges:** `begin_stripe_charge_for_service` resumes a pending charge only under a new charge's checks (issued, a balance at least the charge's, the card and its consent, Stripe set, P3-40).
- **One Checkout session per invoice and balance (BI-26):** `billing-stripe-checkout` sends a payment session with the idempotency key `checkout:<invoice>:<balance>:<half hour>` and an expiry fixed by that half hour (31 to 61 minutes ahead): two links opened together give the same session. Two opened on each side of a half hour still give two (the excess is told to `billing.manage`, `billing.stripe_excess`).
- **« Bill annulé dans QuickBooks » (BI-28, déléguée — révisable):** migration `*_billing_qbo_bill_voided.sql` (pgTAP `196_billing_qbo_bill_voided`), function `qbo-bill-check`. On « Paie », a validated period whose invoice has a Bill (`get_payout_period` gives the administration `invoice.qbo_bill_id`) shows « Facture envoyée à QuickBooks (Bill n° …) » and the action « Bill annulé dans QuickBooks » (`billing.payroll`, who may reopen):
  - **verified:** `qbo-bill-check` (user, module `billing`, `billing.payroll`; 30 an hour per caller, `LIMITS.qboBillCheckUser`) → `qbo_bill_to_check_for_service(actor, org, period)` (the permission first, the caller's org, validated, a Bill) → `GET bill/<id>` (`QboClient.billState`: Intuit's fault 610 « Object Not Found » = deleted, a zero total = voided; a bare 404 is a failure, never a deletion) → still there: the refusal « Le Bill existe toujours dans QuickBooks : supprimez-le d'abord. »; gone → `clear_qbo_bill_for_service(actor, org, period, bill)` (the same checks under the period's lock, the Bill unchanged). No connection 404, a dead grant 409, the Intuit application missing 503, QuickBooks failing 502: each in plain French on the screen;
  - **override:** `force_clear_qbo_bill(period, reason)` for `billing.payroll` **and** `billing.settings` (who manages the QuickBooks connection; not `settings.integrations_manage`, a core key that does not follow the module), a reason of 10 to 500 characters, behind « Forcer le retrait sans vérifier » with the warning « La paie sera payée deux fois si le Bill existe encore dans QuickBooks ».
  - **What forgetting does** (`private.payroll_clear_qbo_bill`): `professional_invoices.qbo_bill_id` / `exported_at` cleared (audited, source `fn:qbo-bill-check` or `rpc:force_clear_qbo_bill`, the caller as actor); the `bill` push set `failed` with `bill_voided` (never pushed again by itself: reopen the period, or « Réessayer » pushes the same invoice) and its new `qbo_pushes.generation` raised, so the re-push carries a new `requestid` (`billRequestId`: Intuit answers a repeated one with the first, deleted, Bill); a row in `qbo_bill_clearances` (period, invoice, Bill, `verified` / `override`, the reason, who, when; `billing.payroll` reads it; audited, `reason` redacted like the module's other reasons). The period may then be reopened and the invoice replaced.
  - **Tests:** pgTAP `196`; Deno `qbo-bill-check/handler.test.ts` (against `fake-qbo.ts`, which now reads and deletes Bills: `GET bill/<id>`, `POST bill?operation=delete`, `deleteBill`, `voidBill`) and `qbo-push` (a forgotten Bill pushed again under a new requestid); Vitest `QboBillDialog.test.tsx`, `lib/qbo-push.test.ts`.

## Keep / Change / Drop

From plan §8's summary and the legacy inventory (§F). Keep: per-line TPS / TVQ, statuses, the file-opening fee, numbering, several lines per invoice, payment modes ↔ QuickBooks accounts. Change: credit notes instead of cancelling an invoice; one payer per invoice, chosen among the authorised relations (no split); numbering `AAAA-N` continuing GOrendezvous's; the server computes every amount. Drop (confirmed by the data): TELUS eRéclamations, gift / loyalty / visit cards, Square, PayPal, Accès D, « seulement TPS », per-service Stripe deposits.
