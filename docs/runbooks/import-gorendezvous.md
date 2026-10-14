# Runbook — Import from GOrendezvous: the clients (I1), the appointments and the waiting list (I2), the invoices (I3)

**Status:** built and tested locally with synthetic files (2026-10-12). **Not run on the clinic's database.** · **Plan:** [§9 I1](../plans/2026-10-11-modules-coding-plan.md#9-importation-gorendezvous--batches) · **Decisions:** I-1 … I-18 · **Code:** `scripts/import-gorendezvous.mjs`, `scripts/import-gorendezvous/`, RPCs `import_client` / `import_client_relation` (`supabase/migrations/20261013043434_clients_import.sql`), pgTAP `115_clients_import`

> **Running it against the clinic's database is Jonathan's call, every time** (CLAUDE.md §11). He runs it himself, in his own terminal, signed in with his own account: first a dry run, then, after reading its report, `--commit`. **An agent never runs it against the clinic's database.**

## Before
1. **The exports** (decision I-1): in GOrendezvous, « Exporter mes clients » (liste globale) and Facturation → Revenus → « par service-produit ». In Excel, save each sheet as « CSV UTF-8 ». Keep them in `~/Clinique-MANA-import/` (`chmod 700`), **never in the repository**: the script refuses a file inside it.
2. **The employees file** (`employes.csv`, I-9): one line per GOrendezvous agenda, with the columns `Employé;Professionnel;Exclure`. `Professionnel` holds the app's display name or the licence number. `conseillère`, « Administration » and « Z MATRICE » are always excluded. Review it with the clinic.
3. **The services file** (`services.csv`, I-9, for `prix`): `Service;Code`, one line per GOrendezvous service without a catalogue code (the legacy ones).
4. **The relations file** (`liens.csv`, I-11, optional): `Client;Proche;Lien;Contact principal;Gère les rendez-vous;Reçoit les communications;Reçoit les factures`.
   - Client and proche are GOrendezvous ClientIds.
   - The link is what the proche is to the client: parent, enfant, tuteur, pupille, conjoint, fratrie or autre.
   - The rights are oui or non.
5. **Module and permissions:**
   - Clients is enabled for the clinic;
   - the operator holds `clients.manage` and `clients.merge`, and for `prix` also `professionals.view` and `services.view`.

## Run
```bash
node scripts/import-gorendezvous.mjs clients --clients ~/Clinique-MANA-import/clients.csv \
  --employees ~/Clinique-MANA-import/employes.csv --relations ~/Clinique-MANA-import/liens.csv \
  --url https://<ref>.supabase.co --anon-key <clé anon> --report ~/Clinique-MANA-import/rapport-essai.txt
```
- **Without `--url`:** the local stack.
- **With a remote `--url`:** it asks for the project reference typed back, then the email and the password, on the terminal.
- **A dry run:** every client goes through `import_client(row, true)` (done, then rolled back).
- **Read the report** before going further:
  - rows refused and why, by line number;
  - values left out;
  - HIGH and MEDIUM duplicates, within the file and with files already in the app (by file number);
  - tags added to the clinic's list;
  - payers to complete (I-8);
  - relations.
- **Then the same command with `--commit`:**
  - nothing is imported if one row is in error;
  - otherwise type `importer`: the clients are imported one by one, then the relations, then the payer tags;
  - the payer tags (IVAC, PAE): each tagged file gets a payer « à compléter » (`import_client_payers`, FP-9), once per kind; a re-run, even after every client is in, adds the missing ones and never one twice;
  - Ctrl-C stops between two rows, and a re-run skips the files already imported.

The price gap report only reads:
```bash
node scripts/import-gorendezvous.mjs prix --lines ~/Clinique-MANA-import/revenus-services.csv \
  --employees ~/Clinique-MANA-import/employes.csv --services ~/Clinique-MANA-import/services.csv --url … --anon-key …
```

## Good to know
- **Resuming:** a run stopped by Ctrl-C, a lost connection or an expired session (the session is refreshed during long runs) is resumed by the same command: the files and relations already imported come back « déjà importés ». A relations file added later is imported by a re-run, even when every client is already in.
- **Blocking a `--commit`:** a row the database refuses (one of the two names missing, for example) blocks it, and so does a refused line of the relations file. Fix the file, then run it again.
- **Anonymised files:** a file anonymised after its import is never re-created by a later run (I-13).
- **Defaults:** reminders are on and the time zone is the clinic's for every imported file. GOrendezvous's notes are not imported (I-14).
- **Errors before the report:** an argument or file error stops the run before the report is opened. The terminal says what to fix.

## The invoices (I3)
**Code:** the `factures` command, `scripts/import-gorendezvous/invoices.mjs`; RPC `import_invoice` (`supabase/migrations/20261013173039_billing_import.sql`, with `*_clients_import_match.sql` and `*_services_code_lookup.sql`); pgTAP `144_billing_import`; decision BI-20.

**Before:**
1. **The clients are imported first** (I1): an invoice finds its dossier among the imported files.
2. **The three « Revenus » exports**, for the same period: Facturation → Revenus → « par facture », « par service-produit » and « par paiement », each saved as « CSV UTF-8 » in `~/Clinique-MANA-import/`.
3. **Optional:**
   - `employes.csv` (the lines get their professional);
   - `services.csv` (the legacy services get their code);
   - a `--clients-map` file `Facture;ClientId`, for the invoices whose name the dry run could not settle (homonyms, a name changed since).
4. **Permission:** the operator holds `billing.manage`, and Facturation is enabled.

**Run:**
```bash
node scripts/import-gorendezvous.mjs factures --invoices ~/Clinique-MANA-import/revenus-factures.csv \
  --lines ~/Clinique-MANA-import/revenus-services.csv --payments ~/Clinique-MANA-import/revenus-paiements.csv \
  --employees ~/Clinique-MANA-import/employes.csv --services ~/Clinique-MANA-import/services.csv \
  --url https://<ref>.supabase.co --anon-key <clé anon> --report ~/Clinique-MANA-import/rapport-factures.txt
```
- **A dry run first:** every invoice goes through `import_invoice(row, true)`. Read the report:
  - the counts;
  - per month, the export's invoices and money beside what will be imported;
  - the lines set aside in each file (a line without its invoice, a payment without an invoice number, an unknown payment mode…);
  - the invoices without a dossier (none or several with that name): left out, then added by a re-run with `--clients-map`;
  - the invoices the database refuses, with the reason (the lines do not make the total, an unknown mode, an overpayment…).
- **Then `--commit`:** nothing is imported if one invoice is refused. Otherwise type `importer`.

**What an imported invoice is** (history):
- its GOrendezvous number without the zeros (« 2026-0001234 » → « 2026-1234 »), and the year's numbering continues after it;
- issued on its GOrendezvous date, billed to the client;
- its lines and taxes as exported;
- its payments, with « Argent comptant » as the card through QuickBooks Payments, Accès D as a bank transfer, and a negative amount as a recorded refund.
- **Nothing is sent:** no email, no receipt, no QuickBooks event.
- **Nothing follows it up:** it is never reminded and never blocks a booking. Its balance is followed by hand in « Factures en retard ».

**After:** the invoices « payées par un tiers » (IVAC, PAE…) are counted in the report. They are billed to the client; complete their payer by hand.

## The appointments and the waiting list (I2)
**Status:** prepared against a synthetic export (2026-10-13): support's appointment export has not arrived. When it does, only the column aliases of `scripts/import-gorendezvous/appointments.mjs` (`APPOINTMENT_COLUMNS`) should need to change; its first dry run says which required column is missing.
**Code:** the `rendez-vous` command, `scripts/import-gorendezvous/appointments.mjs`; RPCs `import_appointment` (`*_appointments_import.sql`) and `import_waitlist_entry` (`*_demandes_waitlist_import.sql`); pgTAP `178_appointments_import`, `179_demandes_waitlist_import`; decisions I-15, I-16.

**Before:**
1. **The clients are imported first** (I1), then the consents (below): an entry on the waiting list is active only once its « liste d'attente » consent is in force.
2. **Support's appointment export**, saved as « CSV UTF-8 » in `~/Clinique-MANA-import/`. The reader needs the date, the client, the agenda (professional) and the service; it also reads the time, the end or the duration, GOrendezvous's appointment id and ClientId (and the second client's), the service code, the status, the mode, the cancellation reason and date, and the video link. **It never reads the notes** (D8).
3. `employes.csv` (required: every agenda must be named; « conseillère », « Administration », « Bureau administratif » and « Z MATRICE » are always administrative) and `services.csv` (the services without a code).
4. **Optional:** « par service-produit » (`--lines`): a client with an « Inscription – Liste attente » line has her registration fee « payée »; without it, every imported registration is « à facturer ».
5. **Permission:** `appointments.manage`, `clients.manage`, `clients.merge`, `demandes.manage`, `demandes.waitlist`, with Rendez-vous and Demandes enabled.

**Run:**
```bash
node scripts/import-gorendezvous.mjs rendez-vous --appointments ~/Clinique-MANA-import/rendez-vous.csv \
  --employees ~/Clinique-MANA-import/employes.csv --services ~/Clinique-MANA-import/services.csv \
  --lines ~/Clinique-MANA-import/revenus-services.csv \
  --url https://<ref>.supabase.co --anon-key <clé anon> --report ~/Clinique-MANA-import/rapport-rendez-vous.txt
```
- **The waiting list:** GOrendezvous kept it as fake « Inscription – Liste attente » appointments. A registration on a professional's agenda puts the client on that professional's list. One on the conseillère's or « Bureau administratif » agenda puts her on the profession's list (`--waitlist-profession`, `psychologue` by default). A cancelled registration is left out. The other rows of the administrative agendas are set aside (not sessions).
- **A dry run first:** every appointment goes through `import_appointment(row, true)`, then every registration through `import_waitlist_entry(row, true)`. Read the report:
  - the rows read, the past and coming appointments, the registrations;
  - the lines set aside on purpose and the lines refused (an agenda missing from the employees file, a service without a code, an unreadable time, a duplicate): **a refused line blocks `--commit`**;
  - the appointments without a dossier (none or several with that name): left out, then imported by a re-run once the export carries their ClientId;
  - **the overlaps** (`en conflit`), with **the coming ones apart**: fix them in GOrendezvous or in the app before the cutover. No coming overlap may remain (I2's acceptance);
  - per month, the export beside what the app will hold.
- **Then `--commit`:** nothing is imported while a line is refused or a row is in error. Type `importer` for the appointments, then again for the waiting list.

**What an imported appointment is:**
- **past:** « Terminé » (each client present or absent) or « Annulé » (its reason by name, else « Non spécifiée »), its slot without the pause. **It is never billed again:** neither the morning queue, nor a cancellation fee, nor the file's « à facturer » (its invoice comes from I3);
- **coming:** « Réservé » or « Confirmé », with its pause. GOrendezvous's video link is kept, and no Zoom meeting replaces it. **No confirmation is sent**; the reminders go out as for any appointment, and a move, cancellation or restore made in the app afterwards is told to the client;
- each client is linked to the professional (« Mes clients »).

**Reminders at the cutover (one reminder, never two, never none):**
- An imported coming appointment sends **no confirmation** at its import, but gets **its reminder** from the messages job like any appointment (pgTAP `178_appointments_import`): the clients booked in GOrendezvous for December are reminded by the app.
- The app reminds the appointments of the **next business day**, from the reminder hour (`appointment_settings`, 8 h). GOrendezvous reminds them on its own schedule. To avoid a double reminder or a gap, follow this order:
  1. **Import** (`rendez-vous --commit`) before the cutover day.
  2. **Switch GOrendezvous's reminders off** the evening before the first business day of the app, once GOrendezvous's last batch has gone out (it covered that next day's appointments).
  3. **Enable the app's messages job** « Courriels et rappels des rendez-vous » (`appointments.messages`, off by default; Paramètres → Tâches planifiées), with Rendez-vous open to everyone (not « Réservé aux testeurs », P3-40), that morning, **before the reminder hour**. Its first pass reminds the following business day's appointments, which GOrendezvous never reminded.
- **Check GOrendezvous's lead time** (« 24 h avant » or « 48 h avant ») against the app's (`reminder_business_days`, 1 business day by default). With 48 h, GOrendezvous's last batch has also reminded the day after the first app day, and the app's first pass would remind those appointments again. Then switch GOrendezvous's reminders off one evening earlier: its next-to-last batch already covered the first app day. Never run both while GOrendezvous's reminders are on.

**What an imported registration is:** an entry on its list, with its GOrendezvous date (its rank) and its fee (« payée » or « à facturer »). It is active once the consent is in force and the fee is paid or waived, else « incomplète ». All of a client's imported registrations share one request « Liste d'attente » (channel « Autre »).

## The signed consents (I2)
**Code:** the `consentements` command, `scripts/import-gorendezvous/consents.mjs`; RPC `import_client_consent` (`*_clients_consent_import.sql`, through C5a's `import_client_consent_fact_for_service`); pgTAP `181_clients_consent_import`; decision I-18.
- **The export:** one row per client and form signed (ClientId, client, form, date signed, version, signer). A form is matched to one of the clinic's 7 consents by its name; any other form is listed and left out. The same consent twice keeps the latest signature.
- **Run:** `node scripts/import-gorendezvous.mjs consentements --consents ~/Clinique-MANA-import/consentements.csv --url … --anon-key … --report …`, as a dry run, then with `--commit` (`clients.manage` and `clients.merge`).
- **What an imported consent is:** a fact « signé dans GOrendezvous » (source `import`, its date, version and signer, no PDF). A consent already in force is « déjà importé ».

## « Payé par »: the default payers (I2)
**Code:** the `payeurs` command, `scripts/import-gorendezvous/payers.mjs`; RPC `import_default_payer` (`*_billing_payer_import.sql`); pgTAP `180_billing_payer_import`; decision I-17.
- **From « Revenus par facture »:** per client, her latest invoice decides. If another person paid it, that person becomes her default payer from that date. If she paid it herself, or an organisation did (IVAC, PAE, an insurer: payers « à compléter », I-8), nothing is set.
- **Run:** `node scripts/import-gorendezvous.mjs payeurs --invoices ~/Clinique-MANA-import/revenus-factures.csv [--clients-map …] --url … --anon-key … --report …`, as a dry run, then with `--commit` (`billing.manage`). Run it after the clients and their relations.
- **Left out and listed:** a payer without « recevoir reçus et factures » in the client's relations (add the relation, then re-run), and a client or payer not found.

## Rehearsal on the local stack (synthetic exports)
`scripts/import-gorendezvous/synthetic-exports.mjs <directory outside the repo>` writes made-up exports shaped like the real ones:
- the clients, the relations, the employees and services files;
- the three « Revenus » files, consistent with each other: homonyms, an archived file, every payment mode, a refund, partial payments, a taxable line, an invoice for a person not in the export, one without lines, two invoices « Payé par » a relative;
- I2's appointment export (history and coming, an absence, a cancellation, a couple, a phone call, a video link, a coming overlap, the homonyms, the waiting list's fake appointments, an administrative agenda) and the consents export.

Its employees file names the local seed's professionals (Félix Gauthier, Julie Morin). With the local stack reset (`npm run db:reset`), run `clients`, then `factures`, `consentements`, `rendez-vous` and `payeurs`, each as a dry run then with `--commit`, signed in as `admin@mana.test`.

Done on 2026-10-13 (lane A):
- **Clients:** 18 created, 1 relation.
- **Invoices:** 37 of 40 imported; the 3 others listed by reason (homonyms, a person not in the export, an invoice without lines). The month totals match the export for what goes in.
- **Payments and refunds:** every mode mapped; the refund recorded; paid amounts net of it.
- **Numbering:** continues at 2026-1237.
- **Nothing triggered:** no delivery, no QuickBooks event.
- **A re-run:** everything « déjà importée ».

Done for I2 on 2026-10-13 (lane A), after the clients and invoices:
- **Consents:** 13 imported (general, waiting list, coaching); the unknown form and the earlier duplicate listed.
- **Appointments:** 38 of 40 imported (24 completed with one absence and a couple, 1 cancelled, 13 coming of which one with its video link); the homonyms without their ClientId listed; the coming overlap listed as `conflict`; the administrative agenda's call set aside.
- **Nothing triggered:** no confirmation, no Zoom task; nothing of the imported history in the morning queue; no coming overlap left.
- **Waiting list:** 3 registrations on 3 requests « Liste d'attente »: one active (consent in force, fee paid), two « incomplètes » (fee « à facturer »).
- **Payers:** 1 default payer set (a parent with the right); the relative without it listed; IVAC counted as an organisation.
- **A re-run:** everything « déjà importé ».

**What only the real exports can confirm** (first dry run, before any `--commit`):
1. **The headers** of the three « Revenus » exports and of the client export: the readers use the labels GOrendezvous shows on screen (decision I-2). A missing column refuses the file with its name.
2. **How a client is named** in « Revenus » (« Prénom Nom » or « Nom, Prénom ») and how many invoices match no file or several. The rest goes through `--clients-map`.
3. **Whether the lines make each invoice's total** (discounts, rounding, a line deleted after the invoice). A difference refuses the invoice with its line number.
4. **The payment methods' labels** actually used (each one unknown is listed by name), refunds as negative amounts, and payments without an invoice number (deposits?).
5. **« Payé par »:** what it holds (IVAC, PAE, a parent), to complete the payers by hand.
6. **The volume:** one call per invoice for the dry run, and again for the import. Thousands of invoices take a while; Ctrl-C stops between two invoices, and a re-run resumes.
7. **The numbering per year:** the last GOrendezvous number of each year against « Numérotation » after the import.
8. **I2, the appointment export:** its headers (one id per appointment? the ClientId? the time in its own column? the end or a duration?), its statuses' labels (an unknown one refuses the line by name), how the waiting list's fake appointments are named and on which agendas, and whether the video links are there.
9. **I2, the consents export:** whether GOrendezvous exports the signed forms at all, and their names.

## After
- **Duplicates:** merge them in the app (« Fusionner », `clients.merge`). The import never merges.
- **Payers to complete:** the IVAC and PAE tags became payers « à compléter » (the tag also stays on the file). The adjointe completes each one from Clients → « Payeurs à compléter »: the IVAC file number; for a PAE, its provider (as in Paramètres → Payeurs tiers), the amount or share per session, the maximum, the renewal day and what was used this agreement year before the app. Until a payer is completed, its client's drafts wait in the morning queue (« Payeur tiers à compléter »), never billed in full by mistake.
- **Re-running the clients import after the cutover:** the payer step adds a payer for a kind only when the client has no *active* payer of that kind. A completed payer is active, so a re-run leaves it alone. A payer ended since (« Terminer ») is not, so a re-run gives that client a new « à compléter » payer of the same kind. That is fine for the one-time cutover. For a re-run afterwards, end or ignore those stubs in « Payeurs à compléter », or remove the tag from the export first.
- **The report:** delete it when it is no longer needed. It holds line numbers, file numbers, codes and reasons, never a personal value (I-6), but it describes the clinic's files.
