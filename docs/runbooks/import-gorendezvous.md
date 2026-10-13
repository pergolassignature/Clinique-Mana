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

## After
- **Duplicates:** merge them in the app (« Fusionner », `clients.merge`). The import never merges.
- **Payers to complete:** the IVAC and PAE tags became payers « à compléter » (the tag also stays on the file). The adjointe completes each one from Clients → « Payeurs à compléter »: the IVAC file number; for a PAE, its provider (as in Paramètres → Payeurs tiers), the amount or share per session, the maximum, the renewal day and what was used this agreement year before the app. Until a payer is completed, its client's drafts wait in the morning queue (« Payeur tiers à compléter »), never billed in full by mistake.
- **Re-running the clients import after the cutover:** the payer step adds a payer for a kind only when the client has no *active* payer of that kind. A completed payer is active, so a re-run leaves it alone. A payer ended since (« Terminer ») is not, so a re-run gives that client a new « à compléter » payer of the same kind. That is fine for the one-time cutover. For a re-run afterwards, end or ignore those stubs in « Payeurs à compléter », or remove the tag from the export first.
- **The report:** delete it when it is no longer needed. It holds line numbers, file numbers, codes and reasons, never a personal value (I-6), but it describes the clinic's files.
