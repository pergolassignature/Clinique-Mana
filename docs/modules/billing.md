# Module `billing` (« Facturation »)

The clinic's invoices: a client's dossier billed to its payer, for sessions priced by Services et tarifs, numbered `AAAA-N`, taxed line by line, corrected by credit notes. Plan: [coding plan §8](../plans/2026-10-11-modules-coding-plan.md#8-facturation-billing--batches); [Christine's answers](../research/2026-10-12-christine-answers.md) (5, 6, 7, 9, 10, 11, 15, 16); legacy inventory [§F](../plans/2026-10-06-legacy-feature-inventory.md#f-facturation); decisions R-40, R-56 … R-65 and **BI-1 … BI-12** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| F1 | Invoices, lines, payer model (« Facturé à »), numbering `AAAA-N`, taxes per line with « Statut Indien », credit notes; « Factures », the invoice page, the client's panel, Paramètres → Facturation | built |
| F2 | Morning queue, payments, receipts on payment, statements, PDFs, emails (schema, `billing-documents`); the screens | schema and documents built; screens next |
| F3 | Dunning 3 / 5 / 7 / 10, the balance rule at booking, cancellation fees decided by the professional, refunds | planned |
| FQ | QuickBooks Online (lane B): the connection, the accounts map keyed on the payment modes, the customers read and matched (part 1); the invoices and payments pushed (part 2, after F2) | part 1 built |
| FPay | Payroll (lane C): « Paie », « Ma paie » | planned |

- **Registry:** `modules.key = 'billing'`, depends on `clients`, `services`, `professionals`, `appointments`; starts disabled in every clinic.
- **Migrations:** `20261013105811_clients_billing_facts` (Clients' published facts), `20261013105814_appointments_billing_facts` (Rendez-vous' published facts), `20261013105817_billing_module` (registry, tables, RLS, audit, seeds, RPCs, handlers), `20261013111236_billing_quickbooks` (FQ part 1, below); F2: `20261013113141_professionals_supervisor` (Professionnels: the supervisor, the receipt facts), `20261013113521_billing_queue_payments` (the queue, payments, receipts, statements, deliveries, the job, the templates).
- **Functions:** `billing-documents` (F2: renders and sends the PDFs; job `billing.documents` and user calls).
- **Tests:** pgTAP `135_billing_invoices` (privileges, registry and roles, payment modes, an invoice from an appointment with the grid price and the file-opening fee, taxes per line, never twice, the payer rule, the default payer, « Statut Indien », an amount to type, gapless numbering continuing a set sequence and never backwards, credit notes, drafts only edited, reads, anonymisation); pgTAP `136_professionals_supervisor` and `137_billing_queue_payments` (the queue's drafts once, the holds, « Envoyer » with a refusal for one, the deliveries and P3-40, payments and receipts, credit notes, statements); Deno `billing-documents/*.test.ts` (the receipt's text with the supervisor, the invoice, the statement, English; render, store, email, set aside, retry; preview); Vitest `src/modules/billing/**/*.test.ts(x)` (manifest; `InvoicePage`: lines and totals, the payer, an amount to type, finalising, an adjustment, a credit note, read-only for the conseillère; `ClientBillingPanel`: invoices, default payer, « Créer la facture »); Playwright `e2e/billing.spec.ts` (invoice Alice's appointment, finalise, credit); the audit labels by `src/app/audit-labels.test.ts`.

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

### F2 tables

| Table | What | Rules |
|---|---|---|
| `billing_settings` | per clinic: `queue_from` (« File du matin à partir du ») | null: the queue is off |
| `special_agreements` | a dossier's « entente particulière » (a note), one active | its sessions stop in the queue |
| `billing_queue_items` | per appointment: the draft the queue built (or the refusal's text) | once per appointment; a deleted draft is not rebuilt |
| `payments` | one invoice, the payer, the mode (`payment_modes.code`), the amount, the day, a reference | ≤ the balance; not « Note de crédit »; `external_ref` for the import and FS |
| `receipts` | one per payment, `R-AAAA-N` (sequence kind `receipt`) | |
| `statements` | a dossier's year for one payer | |
| `billing_deliveries` | a document to render and maybe email: kind, `send_email`, `explicit` (« Renvoyer »), status `pending` / `sending` / `done` / `failed`, the email's outcome (`sent`, `skipped` with `not_requested` / `no_email` / `reserved` / `module_disabled`, `failed`), tries | claimed by `billing-documents`; three tries (the per-address limit is none) |

`invoices` gains `queue_day`, `hold_reason` (`special_agreement`, `client_agreement`, `manual`), `hold_note`, `paid_cents`, `payment_status` (`unpaid`, `partial`, `paid`) and `pdf_file_id`; `credit_notes`, `receipts` and `statements` have their `pdf_file_id` (purpose `billing_document`, bucket `documents`, read with `billing.view`, kept).

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

F1's `create_invoice`, `finalize_invoice` (now a PDF, no email), `issue_credit_note` (refused with payments; emailed when the invoice was), `get_invoice` and `get_client_billing` (payments, receipts, deliveries, the agreement, the balance) are replaced with the same signatures; `list_invoices` gains `paid_cents` and `payment_status`.

## Jobs, functions and emails (F2)

- **`billing.build_drafts`** (SQL, hourly at :40): per clinic with a start date, the completed sessions of the days before today (at most 14 back) not queued nor invoiced become drafts, held for an agreement; detail `built=… held=… failed=…`.
- **`billing-documents`** (job `billing.documents`, every 5 minutes; user `{ action: 'deliver' }` with `billing.manage` right after a send, `{ action: 'preview', kind, id }` with `billing.view`): claims up to 25 deliveries, renders each PDF once (pdfmake; the logo when it loads) and stores it, then emails it attached to the payer (templates `billing.invoice`, `billing.credit_note`, `billing.receipt`, `billing.statement`, each with `_en`; attachments allowed). Limits `billing.deliver_user` (120 an hour) and `billing.preview_user` (60 an hour).
- **P3-40:** while Facturation is reserved for its testers, the PDF is made and the email set aside (`reserved`); the send path holds it too (CC-14). pgTAP 137 checks both.

## Screens (F1)

- **« Facturation »** (`/facturation`, `billing.view`): « Factures » newest first by state (real tabs, the view in the URL: Brouillons, Émises, Créditées, Toutes), each row opening the invoice. A new invoice starts from the client's record.
- **The invoice** (`/facturation/factures/:id`): the dossier, « Facturé à » (a draft: the client or a relation with the right), the lines (type, code, quantity, unit price, taxes, total; a « montant saisi » line's amount typed in place; removed from a draft), « Ajouter une ligne » (an adjustment, taxable or not), the totals (sous-total, TPS and TVQ with their rates, total), « Exempté de taxes (Statut Indien) », the notes (the client's fixed once issued). A draft: « Finaliser la facture » (the number in a toast) or « Supprimer le brouillon »; an issued invoice: « Émettre une note de crédit » (a reason), shown on it afterwards. Read-only without `billing.manage`.
- **Clients → « Visites et paiements »** (slot `client.visits`, panel `billing.invoices`): « Facturé à, par défaut », the last year's appointments not invoiced yet with « Créer la facture » (it opens the draft; a second person's appointment is invoiced on the first person's dossier), « Nouvelle facture (sans rendez-vous) », and the dossier's invoices with their payer and state. Payments come with F2.
- **Paramètres → Facturation** (`billing.view`, changed with `billing.settings`): « Numérotation »: the year's last number used (GOrendezvous's at the cutover) and the next one.

## What the module publishes

- **`private.billing_create_service_invoice(org, client, service, source_id, actor)`** → draft id: a service outside the agenda (Demandes' waiting-list fee, a report), priced today. Granted to no role.
- **For Clients:** `private.billing_reassign_client(old, new)` and `private.billing_anonymize_client(id)` in the handler catalogues (a merge moves invoices and default payers; an anonymisation keeps the invoices and their amounts, blanks their notes, drops the default payers). Lane B's FQ adds its QuickBooks part to these two functions (`create or replace`).
- **Coming:** `client_balance(client)`, `private.client_has_balance` (F3, replacing Rendez-vous' stub).

### What this module reads from the others (published only)

- **Clients:** `private.clients_billing_facts(org, ids[])` (number, name, rate variant, « Statut Indien », language, archived, closed), `private.client_contacts_for(…, 'invoices')`, `private.clients_display_names`.
- **Rendez-vous:** `private.appointment_billing_facts(org, ids[])`, `private.client_billable_appointments(org, client, since)`.
- **Services et tarifs:** `private.service_price`, `private.service_booking_facts`, `services_catalog`, `billing_policy_on`.
- **Professionnels:** `private.professional_booking_facts` (titles, primary first); F2: `private.professional_receipt_facts(org, ids[])` (name, primary title, order, licence, and the supervisor's), `private.professional_client_agreement_on(org, professional, client, day)` (the agreement that holds a session in the queue).
- **Core:** `tax_rates` (« Fiscalité »).

## QuickBooks (FQ part 1, lane B)

Decisions **FQ-1 … FQ-5**. PS Hub's connector is the source (roadmap §2.6), its flaws fixed. Nothing is written to QuickBooks in this part (FQ-4).

- **Tables** (`billing.settings` reads them; every write is an RPC): `qbo_connections` (one company per clinic, its realm fixed once connected; statuses `connected`, `needs_reconnect`, `disconnected`), `qbo_connection_tokens` (encrypted under the PII key version, no policy, read only by `get_qbo_credentials` for the service role), `qbo_accounts` (the chart of accounts as last read, a mirror), `qbo_account_map` (`revenue.services`, `revenue.file_opening`, `deposit.<code>` for each **payment mode that lands money** (F1's `payment_modes`, `is_deposit`, active: `credit_note` has none), `expense` per profession title; a suggestion from the clinic's chart, never over a person's choice), `qbo_customers` (the company's customers as last read, a mirror), `qbo_customer_matches` (each customer matched to a file with Clients' duplicate rules: HIGH → linked, MEDIUM or several → « à décider », none → nothing; a person's decision is final), `qbo_links` (the payer's parent customer and the (payer, dossier) sub-customer, R-30, filled by the push).
- **Functions:** `qbo-connect` (user, `billing.settings`: `start` → Intuit's consent with a signed single-use state; `disconnect` → the grant revoked, tokens deleted, the mapping kept), `qbo-callback` (user: the code exchanged, the company stored, the first read), `qbo-sync` (user: accounts and customers read, then matched in pages), `qbo-token-refresh` (job `billing.qbo_token_refresh`, daily, maintenance: Intuit's 100-day refresh token never lapses).
- **Screens:** Paramètres → **QuickBooks** (`quickbooks`: the connection, the Intuit application's two secrets, the return address to declare, the accounts map with « Suggéré », the keep-alive job) and **Clients QuickBooks** (`quickbooks-clients`: « À décider », « Associés », « Sans correspondance », « Ignorés », with « Associer », « Associer à un autre dossier », « Ignorer », « Revenir à l'automatique »); Intuit returns to `/facturation/retour-quickbooks`.
- **Clients:** F1's `private.billing_reassign_client` / `billing_anonymize_client` are replaced with F1's body kept and the QuickBooks part added (matches and links follow a merge; an anonymisation blanks this app's copy of the matched customers).
- **Locally:** `npm run fake:qbo` (port 55394, `_shared/testing/fake-qbo.ts`); the seed stores the fake's application.
- **Tests:** pgTAP `150_billing_quickbooks`; Deno tests of the four functions and `_shared/qbo/`; Vitest `QuickBooksSettingsPage`, `QuickBooksCustomersPage`, `lib/qbo-status`.
- **Part 2 (after F2):** the invoices and payments pushed at finalisation (the hook to agree with lane A), the sub-customers created.

## Keep / Change / Drop

From plan §8's summary and the legacy inventory (§F). Keep: per-line TPS / TVQ, statuses, the file-opening fee, numbering, several lines per invoice, payment modes ↔ QuickBooks accounts. Change: credit notes instead of cancelling an invoice; one payer per invoice, chosen among the authorised relations (no split); numbering `AAAA-N` continuing GOrendezvous's; the server computes every amount. Drop (confirmed by the data): TELUS eRéclamations, gift / loyalty / visit cards, Square, PayPal, Accès D, « seulement TPS », per-service Stripe deposits.
