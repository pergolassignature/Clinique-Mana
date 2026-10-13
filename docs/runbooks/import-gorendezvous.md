# Runbook — Import from GOrendezvous: the clients (I1), the invoices (I3)

**Status:** built and tested locally with synthetic files (2026-10-12). **Not run on the clinic's database.** · **Plan:** [§9 I1](../plans/2026-10-11-modules-coding-plan.md#9-importation-gorendezvous--batches) · **Decisions:** I-1 … I-12 · **Code:** `scripts/import-gorendezvous.mjs`, `scripts/import-gorendezvous/`, RPCs `import_client` / `import_client_relation` (`supabase/migrations/20261013043434_clients_import.sql`), pgTAP `115_clients_import`

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
  - otherwise type `importer`: the clients are imported one by one, then the relations;
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

## Rehearsal on the local stack (synthetic exports)
`scripts/import-gorendezvous/synthetic-exports.mjs <directory outside the repo>` writes made-up exports shaped like the real ones:
- the clients, the relations, the employees and services files;
- the three « Revenus » files, consistent with each other: homonyms, an archived file, every payment mode, a refund, partial payments, a taxable line, an invoice for a person not in the export, one without lines.

Its employees file names the local seed's professionals (Félix Gauthier, Julie Morin). With the local stack reset (`npm run db:reset`), run `clients`, then `factures`, each as a dry run then with `--commit`, signed in as `admin@mana.test`.

Done on 2026-10-13 (lane A):
- **Clients:** 18 created, 1 relation.
- **Invoices:** 37 of 40 imported; the 3 others listed by reason (homonyms, a person not in the export, an invoice without lines). The month totals match the export for what goes in.
- **Payments and refunds:** every mode mapped; the refund recorded; paid amounts net of it.
- **Numbering:** continues at 2026-1237.
- **Nothing triggered:** no delivery, no QuickBooks event.
- **A re-run:** everything « déjà importée ».

**What only the real exports can confirm** (first dry run, before any `--commit`):
1. **The headers** of the three « Revenus » exports and of the client export: the readers use the labels GOrendezvous shows on screen (decision I-2). A missing column refuses the file with its name.
2. **How a client is named** in « Revenus » (« Prénom Nom » or « Nom, Prénom ») and how many invoices match no file or several. The rest goes through `--clients-map`.
3. **Whether the lines make each invoice's total** (discounts, rounding, a line deleted after the invoice). A difference refuses the invoice with its line number.
4. **The payment methods' labels** actually used (each one unknown is listed by name), refunds as negative amounts, and payments without an invoice number (deposits?).
5. **« Payé par »:** what it holds (IVAC, PAE, a parent), to complete the payers by hand.
6. **The volume:** one call per invoice for the dry run, and again for the import. Thousands of invoices take a while; Ctrl-C stops between two invoices, and a re-run resumes.
7. **The numbering per year:** the last GOrendezvous number of each year against « Numérotation » after the import.

## After
- **Duplicates:** merge them in the app (« Fusionner », `clients.merge`). The import never merges.
- **Payers to complete:** the IVAC, PAE and external payer tags. I3 creates the payers from the invoices; until then the tag stays on the file.
- **The report:** delete it when it is no longer needed. It holds line numbers, file numbers, codes and reasons, never a personal value (I-6), but it describes the clinic's files.
