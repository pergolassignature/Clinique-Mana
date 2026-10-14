# Module `reports` (« Rapports »)

The clinic's reports, read-only: what GOrendezvous's « Revenus », « Annulations » and « Clients à relancer » give today (R-27), then the intake, payroll, IVAC and waitlist reports (RP2). The module has **no table**: it reads only what Facturation and Rendez-vous publish, through definer RPCs that check the permission first; the CSV is made in the browser from the answer (no file stored). Plan: [coding plan §12](../plans/2026-10-11-modules-coding-plan.md#12-rapports-reports--batches); data: [GOrendezvous tour](../research/2026-10-11-gorendezvous-tour.md) (Revenus by invoice, by service, by payment; cancellations by reason; clients to call back); decisions R-27 and **RP-1 … RP-6** in the [decisions log](../plans/2026-10-07-decisions-log.md).

| Batch | What | Status |
|---|---|---|
| RP1 | « Revenus » (by invoice, by service, by payment; filters; CSV), « Annulations et absences » (by reason), « Clients à relancer » | built |
| D6 (RP2's intake part) | « Indicateurs des demandes »: activity and cohort, the promise of 2 business days, sources, delays, first appointments cancelled, waiting list, places | built |
| RP2 | Payouts, IVAC (FP) | planned (lane B, February) |

- **Registry:** `modules.key = 'reports'`, depends on `billing` and `appointments`; starts disabled in every clinic (Paramètres → Modules).
- **Migrations:** `20261013160528_billing_report_facts` (Facturation's published facts), `20261013160534_appointments_report_facts` (Rendez-vous'), `20261013160540_reports_module` (registry, permissions, the three RPCs); D6: `20261013233833_demandes_report_facts` (Demandes' published facts), `20261013233839_professionals_catalogue_names` (Professionnels' names), `20261013233844_appointments_first_after` (Rendez-vous'), `20261013233851_reports_demandes` (`report_demandes`). pgTAP `172_reports_demandes`.
- **Tests:** pgTAP `165_reports` (privileges, registry and roles, the three views and their filters, a credited invoice apart and a draft never, the period's rules, cancellations per reason with a couple's appointment once and never a personal one, the clinic's day bounds, the clients to call back, the permissions, the module off, another clinic); Vitest `src/shared/lib/csv.test.ts` (formula guard, quoting, numbers) and `src/modules/reports/**` (periods, labels, each report's CSV, the pages, the manifest); Playwright `e2e/reports.spec.ts`.

## Permissions (RP-1)

| Key | Who (defaults) | What |
|---|---|---|
| `reports.view` | admin | « Annulations et absences », « Clients à relancer », « Consentements » |
| `reports.finance` | admin, adjointe | « Revenus » |

## RPCs

All definer, permission first, French `P0001` with a HINT (`period`, `view`, `kind`). A period goes from a clinic date to another, **a year at most** (366 days, RP-5); at most **5 000 rows** come back (`truncated`), the totals always count everything.

| RPC | Permission | What |
|---|---|---|
| `report_revenue(view, from, to, professional, service, mode)` → jsonb | `reports.finance` | `invoice`: one row per invoice issued in the period and not credited (dossier, payer, professionals, totals, paid, balance); `service`: one row per line, and `by_service`; `payment`: one row per payment made in the period (whatever the invoice's date), and `by_mode`. `credited`: the invoices issued in the period then credited, counted apart (RP-2). `options`: the period's professionals and services, the clinic's modes. |
| `report_cancellations(from, to, professional, reason, kind)` → jsonb | `reports.view` | one row per client of the period's appointments cancelled (reason, late, kept on the schedule, the client's next appointment) or where the client was absent; `by_reason` and `totals` count appointments (a couple's once). Never a personal appointment nor a held one; never the cancellation's details (RP-3). |
| `report_demandes(from, to)` → jsonb | `reports.view`, Demandes enabled (else « Activez d'abord Demandes … », HINT `module`) | the intake indicators (D6, D-42 … D-45, below) |
| `report_clients_to_follow_up(from, to, professional)` → jsonb | `reports.view` | per client, the period's last cancellation or absence with nothing booked, confirmed or completed after it (whoever the professional), files neither archived nor closed; `events`: how many in the period (RP-4). |
| `report_consents(from, to, professional)` → jsonb | `reports.view` | Clients C5b (CC-19): `gaps`, per active consent, today's count of active files in each state (signed, resign, pending, overdue, withdrawn, none), the record tabs' states; `by_professional`, per primary professional and consent, signed and « à obtenir » (pending, overdue, resign, withdrawn); `months`, per month of the period, the signatures in the app, the imported ones and the withdrawals; `delays`, per consent, the period's signatures in the app with the average and median days from the first send; `totals`. Counts only, never a name. The professional filter reads the file's primary professional. |

## What this module reads (published only)

- **Facturation:** `private.billing_revenue_lines(org, from, to)`, `private.billing_revenue_payments(org, from, to)`, `private.billing_revenue_refunds(org, from, to)` (L6), `private.billing_payment_mode_names(org)`.
- **Rendez-vous:** `private.appointment_absence_facts(org, from, to)` (instants: Rapports gives the clinic day's bounds), `private.cancellation_reason_names(org)`.
- **Clients:** `private.clients_display_names`, `private.clients_billing_facts` (archived, closed), and for « Consentements » `private.client_consent_state_facts(org)`, `private.client_consent_event_facts(org, from, to)` and `private.clients_consent_names(org)`.
- **Professionnels:** `private.professional_display_names`. **Services et tarifs:** `private.service_payout_facts` (code, name).
- **Demandes (D6):** `private.demandes_report_requests(org, from, to)`, `_matches`, `_waitlist`, `_capacity` ([Demandes doc](demandes.md#d6-the-intake-indicators)). **Rendez-vous (D6):** `private.appointments_cancelled_between`, `private.appointments_first_after`. **Professionnels (D6):** `private.clientele_names`, `private.profession_title_names` (retired rows keep their names).

## Screens

- **« Revenus »** (`/rapports/revenus`, menu Facturation, `reports.finance`): real tabs « Par facture », « Par service », « Par paiement » (`?vue=`); the period (« Du », « Au », « Ce mois-ci », « Mois dernier », « Cette année », « Année dernière »; this month by default), « Professionnel », « Service », « Mode de paiement » (by payment); the totals, the credited invoices said apart, the rows (each invoice links to its page), « Exporter (CSV) ». Every filter is in the address.
- **Refunds in « Par paiement »** (parity audit L6, RP-7): the refunds recorded in the period (done by hand or confirmed by Stripe; not those still with Stripe or refused) are rows of their own, dated by the clinic day they were recorded, under their payment's mode, the amount negative, « Remboursement » under the mode. The totals and each mode say what was received, « Remboursements (N) » and « Net » (each mode's figure is its net). The CSV gains a « Type » column (« Paiement », « Remboursement »). The mode, professional and service filters apply to a refund through its payment and invoice. The refund's reason is never shown.
- **« Annulations et absences »** (`/rapports/annulations`, menu Suivi, `reports.view`): « Par raison » (the totals, per reason with the late ones, then each appointment with the client's next one or « Aucun rendez-vous après ») and « Clients à relancer » (`?onglet=relancer`: each client linked to the file, the last missed appointment, how many); filters: the period, the professional, the type and the reason; « Exporter (CSV) ».

- **« Consentements »** (`/rapports/consentements`, menu Suivi « Rapport des consentements », `reports.view`): the totals; « Aujourd'hui, par consentement »; « Par professionnel principal »; « Signatures et retraits par mois »; « Délai entre l'envoi et la signature ». Filters: the period, the primary professional. « Exporter (CSV) » saves the states per consent.
- **« Indicateurs des demandes »** (`/rapports/demandes`, menu Accueil des clients, `reports.view`, shown while Demandes is enabled; Demandes D6): the period and real tabs (`?onglet=`):
  - « Activité »: received (a duplicate apart); the matches of the period and their rate ÷ received (« activité »); the period's requests matched since and their share (« cohorte »); the promise of 2 business days (contacted in time, later; not yet within the delay, overdue; matched or closed without a contact); per week (Monday; a week the period cuts reads « (partielle) ») and per month; channel, conseillère (who took it; « Sans conseillère » for the website's form and the booking page), state, professional (also per week) and clientèle;
  - « Provenance » (`provenance`): « Comment avez-vous entendu parler de MANA ? », campaign, utm (source / support), the referrer's site, each with the requests matched since; the last three show their 50 biggest values, the rest in one « Autres valeurs » row;
  - « Délais et premiers rendez-vous » (`delais`): received → first call or message (business days), → first proposal, → match (days): median, average, how many; the first appointments cancelled in the period (once each), their rate ÷ the period's matches (it can pass 100 %), the notice and the lead time (average, shortest, longest), per week of cancellation, per reason and professional;
  - « Liste d'attente et places » (`liste-attente`): people (requests, not list entries) waiting now and those whose registration is incomplete, per list with « Prioritaire »; registered; exits per reason; the wait of those placed; D5's last photo (places left across those who accept new clients) per professional, and the first photo of each week.
  « Exporter (CSV) » saves the tab shown, one line per figure (« Section ; Indicateur ; Valeur »).

## CSV (RP-6)

Made in the browser (`@/shared/lib/csv`): semicolons, a decimal comma, a BOM, CRLF (Excel fr-CA); a text cell starting with `= + - @`, a tab or a carriage return gets a leading `'` (formula injection); the amounts and numbers the app computes are written as they are. The file holds what the screen shows (the same filters, at most 5 000 rows). FPay's payroll export uses the same guard.

## Keep / Change / Drop

| Item | Decision |
|---|---|
| Legacy « Reports = link to IVAC report » (inventory, settings) | **Change:** the IVAC report comes with Payeurs externes (FP) and RP2 |
| GOrendezvous « Revenus » by invoice / by service-product / by payment; filters (period, professional, client, service, mode); Excel export | **Keep** (RP1); a client's own revenue is her « Visites et paiements »; CSV for Excel |
| GOrendezvous « Annulations » by reason, « Clients à relancer » (Impressions → Exporter) | **Keep** (RP1), with the absences |
| GOrendezvous dashboard (acquisition through GOrendezvous's own channels) | **Change:** the intake KPIs by source come from Demandes (D6, RP2) |
