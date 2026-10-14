# Parity audit before code-complete (2026-10-13)

Read-only audit of `main` (commit `0a1c729d`) against four sources:
- the legacy inventory ([2026-10-06](2026-10-06-legacy-feature-inventory.md));
- the GOrendezvous tour ([research](../research/2026-10-11-gorendezvous-tour.md));
- Christine's answers ([research](../research/2026-10-12-christine-answers.md));
- every batch of the [modules coding plan](2026-10-11-modules-coding-plan.md).

Each item was checked in code (migrations, functions, `src/`), not in docs claims. This document only lists gaps; fixes come in their own PRs. No personal data.

**Counts**

| Source | Checked | Done |
|---|---|---|
| Inventory §A Professionnels and §I Paramètres | 71 | 67 |
| Inventory §B Clients, §C Demandes, §D matching | 73 | 55 |
| Inventory §E Rendez-vous and §H Services | 29 | 16 |
| Inventory §F Facturation, §G and §B payers | 31 | 21 |
| Tour and Christine's answers | 104 | 85 |
| Plan batches | 42 | 34 done, 3 partly (CM1, D4, I4), 5 not started (C5b, R6, I2, D6, RP2) |

Many items appear in more than one source, so the gaps below are merged.

**How to read the tables**
- Size: S under half a day, M 1–2 days, L 3 days or more.
- « Owner » is the coordinator's assignment (2026-10-13).
- **Blocked** names the external input an item waits for.

## Before the cutover (Nov 30)

| # | Gap | Where | Size | Owner | Blocked |
|---|---|---|---|---|---|
| P1 | **Change a booked appointment's service or length**. Today staff must cancel and rebook, which sends two messages and records a cancellation. | Rendez-vous: `move_appointment` or a new RPC; `AppointmentSheet` | M | A | — |
| P2 | **Restore a cancelled appointment**. There is no RPC and no button. | Rendez-vous: `restore_appointment`; `CancelTab` | M | A | — |
| P3 | **Staff marks an appointment « Confirmé »**. Only the link or « OUI » can today. | Rendez-vous: `confirm_appointment`; AppointmentTab | S | A | — |
| P4 | **Appointments outside the grid's 7:00–21:00 are drawn with no height**, so they disappear. | Rendez-vous: `lib/time.ts`, `lib/layout.ts` | S | A | — |
| P5 | **Late cancellation counts calendar hours, not « 24 h ouvrables »**. A Monday appointment cancelled on Saturday is never offered for a fee. | Rendez-vous: `cancel_appointment` and a business-hours helper | S | A | Christine can confirm the meaning |
| P6 | **A request can add only one clinic file**. A couple request books one person of two. | Demandes: `ParticipantsTab` with `ClientPicker` | S | B (B-1) | — |
| P7 | **Intake fields missing**: « enjeux », « contexte légal », professionals consulted before, the « autre » details. | Demandes: migration and `IntakeTab` | S–M | B (B-2) | Christine (fields and wording; no clinical data, D8) |
| P8 | **« Jumelée » by hand**. The database supports it but no screen does. Needed for phone-only clients. | Demandes: `MatchingTab` | S | B (B-3) | — |
| P9 | **Consent state per participant** (badge and warning). | Demandes: `ParticipantsTab`, reading `client_consents_status` | S | B (B-4) | — |
| P10 | **A new payer silently replaces the active one of its kind** (`save_client_payer` with `p_id` null); « Ajouter un payeur » is always enabled. | Clients: `save_client_payer`, `CoverageTab` | S | C | — |
| P11 | **PAE file number not required to complete a payer**, and no unique (provider, file number) among active payers. | Clients and Facturation: `list_client_payers_to_complete`, `billing_payer_incomplete`, an index | S | C | — |
| P12 | **No note on a payment**. | Facturation: `payments.note`, `record_payment`, the payment dialog | S | C | — |
| P13 | **Interac instructions** (`etransfer_email`) and a standing invoice note (« reçu dans les 24 h ») are not printed on the invoice or its email. | Facturation: settings, `billing-documents`, `billing.invoice` | S | C | Christine's wording (light; default from GOrendezvous's note, révisable) |
| P14 | **New-client fee: the `existing_relation` rule** (no fee when a related file already has an invoice). Without it, a sibling's or partner's new file is charged. | Facturation: `billing_invoice_appointments` with Clients' relations | S | C | Christine (is today's practice to exempt them?) |
| P15 | **Appointments and waitlist import (I2)**: no command, no `import_appointment` or `import_waitlist_entry`, no link backfill, no consent facts import. | `scripts/import-gorendezvous/`, Rendez-vous and Demandes RPCs | L | A | I2 export (GOrendezvous support) |
| P16 | **Default payer and consent facts at import**: `import_client_consent_fact_for_service` is never called and `import_default_payer` does not exist. | Import script, a billing migration | M | A | « Payé par » export; the list of consent acceptances |
| P17 | **Rehearsal and final import (I4)**. | Runbooks `gorendezvous-cutover.md`, `essais-novembre.md` | M (ops) | A and B | I2 export, final exports, live Stripe keys, QuickBooks |
| P18 | **Interac notices read from `administration@` (CM1b)**: no parser and no `interac_notices_since`. The fallback is « À rapprocher » by hand (about 150 a month). | Communications: `_shared/gmail/`, `gmail-sync` | S–M | B | Interac notice samples (Rachel); the mailbox connected |
| P19 | **Content and setup, no code**. Contract and image-consent templates are published in production (checked by the coordinator; not a gap). Still open: <br>• the 7 consent texts (fr and en, before the partial cutover of Nov 2); <br>• the business jobs to switch on in « Tâches planifiées »; <br>• the external setups: Yeastar line and number, live Stripe keys, QuickBooks production, `administration@` connected, Documenso production. | Paramètres | S each | Jonathan, Christine | Christine (texts); the accounts and keys |

## After the cutover

| # | Gap | Where | Size | Owner | Blocked |
|---|---|---|---|---|---|
| L1 | Google busy time for professionals who opt in (R6, also A8.1): `calendar_connections`, `external_busy_blocks`, `google-calendar-*`, shown « Occupé » | Rendez-vous | L | C (queued after two-way SMS) | Calendar scope on the clinic's Google OAuth app (Jonathan) |
| L2 | Two-way SMS conversations: threads linked to client files, replies, a file's texts | Communications | M | C (next) | Yeastar line for the live test |
| L3 | PAE tiered rules and templates (free sessions then shared cost, fixed client amount, included services) | Clients and Facturation: `billing_apply_payer_shares` | M | C | Christine (do real agreements have tiers? else a Drop OK from Jonathan) |
| L4 | IVAC event date on the client's IVAC payer | Clients: `client_payers`, `CoverageTab` | S | C | Christine (does IVAC need it?) |
| L5 | IVAC report `/rapports/ivac` (totals by state, filter, professional's IVAC number, CSV) | Rapports (RP2) | M | C | — |
| L6 | Refunds in the revenue « par paiement » view | Rapports: `report_revenue` | S | C | — |
| L7 | CSV on the waitlist, invoices and clients lists | Demandes, Facturation, Clients | S | C | — |
| L8 | Receipt signature (clinic, or per professional) | Facturation: `billing-documents` | S | C | Christine (do insurers require it?); signature images |
| L9 | One receipt per spouse for a couple session | Facturation | M | C | Christine |
| L10 | Billing on the appointment (invoice state, price preview, fee info): needs a new `appointment.sheet` slot | Core slot, Facturation panel | M | C (a core `appointment.sheet` slot) | — |
| L11 | A professional's own receipts (`billing.self`, `/mes-recus`) | Facturation: definer RPC and page | M | C | Christine (do professionals read them today?) |
| L12 | Appointment editor extras: <br>• history tab; <br>• its messages and reminder state on the block; <br>• « resend »; <br>• the required-consent prompt (before consent rules are switched on) | Rendez-vous: `AppointmentSheet` | M | A | — |
| L13 | Deep link to one appointment (`rendez-vous=<id>`); clickable visits on the client's file | Rendez-vous, Clients | S | A | — |
| L14 | Agenda print view (day or week) | Rendez-vous | S | A | — |
| L15 | Service colour on the agenda; drag-resize and drag of a service | Rendez-vous: `TimeGrid` | S | A | Jonathan's Drop mark for resize and drag |
| L16 | Change and cancel links in client emails (24 h rule; disabled by default, AP-20) | Rendez-vous public pages | M | A | Christine (wants them?) |
| L17 | Client's last appointment (published fact, column, filter); list sort and column picker for Clients and Demandes | Rendez-vous, Clients, Demandes | S–M | A | The imported history waits on the I2 export |
| L18 | « Demandes » list on the client's file (new `client.demandes` slot) | Demandes, core slot | S | B | — |
| L19 | The match fills the client's primary professional (A-6) | Demandes, through a Clients helper | S | B (A-6) | — |
| L20 | Matching: next free slot per professional, slot grouping and default service in a proposal | Demandes | M | B | — |
| L21 | Waitlist part 2 (D4): « Place disponible », 48 h offer link, next registrant | Demandes | M | A | — |
| L22 | Demandes KPIs (D6) and the source report (Christine 22); then RP2's other reports | Demandes, Rapports | L | A (D6), C (RP2) | — |
| L23 | Christine's monthly reports (answer 18) | Rapports | M | C | Christine's list |
| L24 | Website « Nous écrire » → a demande | Demandes: `demandes-web-form` | M | B | Website access (Elementor webhook) |
| L25 | Consents part 2 (C5b): withdrawal, gaps, signed copy, re-sign | Clients | M | A | Christine (retention setting) |
| L26 | Services per professional (exclusions within a title), or a read-only « Services offerts » card | Services | S–M | A | I2 export (do exceptions exist?), then Christine (question 62) |
| L27 | Services list sort and description search; after-tax price preview | Services | S | A | — |
| L28 | Workbook priority colours (Christine 19) | Demandes | S | B | Christine's workbook |
| L29 | « Accueil » cards per module (figures, work queues). Legacy had none. | Each module's `homeCards` | M | B (coordinates; each module adds its cards) | — |

Built since: L5 (RP2, RP-7, with « Paie » RP-8); L18, L20 and L17's Demandes part (lane B, A-batch: [demandes doc](../modules/demandes.md#after-the-cutover-audit-the-files-requests-the-inboxs-order-the-slots-a-1-a-4-a-7-a-8), D-46 … D-49); L19 (parity batch, D-41); L22's D6 (D-42 … D-45); L29 (Accueil cards, #142 and #143).

## Stale docs found on the way

`docs/modules/demandes.md`'s batch table still lists D3, D3b, D4 and D5 as « planned »; they are merged. The coding plan's batch states are otherwise right.
