# Runbook — Import the GOrendezvous clients (batch I1)

**Status:** built and tested locally with synthetic files (2026-10-12). **Not run on the clinic's database.** · **Plan:** [§9 I1](../plans/2026-10-11-modules-coding-plan.md#9-importation-gorendezvous--batches) · **Decisions:** I-1 … I-12 · **Code:** `scripts/import-gorendezvous.mjs`, `scripts/import-gorendezvous/`, RPCs `import_client` / `import_client_relation` (`supabase/migrations/20261013034027_clients_import.sql`), pgTAP `113_clients_import`

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

## After
- **Duplicates:** merge them in the app (« Fusionner », `clients.merge`). The import never merges.
- **Payers to complete:** the IVAC, PAE and external payer tags. I3 creates the payers from the invoices; until then the tag stays on the file.
- **The report:** delete it when it is no longer needed. It holds line numbers, file numbers, codes and reasons, never a personal value (I-6), but it describes the clinic's files.
