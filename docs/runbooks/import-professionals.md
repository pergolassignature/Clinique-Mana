# Runbook — Import the existing professionals

**Status:** Built and tested locally (plan Task 4a.19, 2026-10-08). **Not run on staging.** · **Plan:** [Task 4a.19](../plans/2026-10-08-professionals-module-plan.md#task-4a19-import-tooling-for-the-50-existing-professionals-lanes-a-and-d--running-it-on-staging-is-jonathans-go-ahead), decisions P4-20, P4-120–P4-130, P4-192 and P4-245, P4-247, P4-248, [Mise en service item 6](../plans/2026-10-08-professionals-module-plan.md#mise-en-service-jonathan) · **Code:** `scripts/import-professionals.mjs`, RPC `import_professional` (`supabase/migrations/20261008163932_professionals_import.sql`, replaced with the two retention keys by `20261008170703_professionals_compensation_private.sql`, P4-192), pgTAP `048_professionals_import`

> **Running it against staging is Jonathan's call, every time** (CLAUDE.md §11): first the staging dry run, then, after reviewing its report, the `--commit` run. **An agent never runs it against staging.** Jonathan runs it himself, in his own terminal, signed in with his own account.

## What it does
- It reads a CSV of the ~50 professionals and, for each line, calls `import_professional(row, dry_run)`. That RPC writes through the app's own RPCs (creation, titles and licences, languages, clientèles, motifs, IVAC number, activation, and, when the columns are filled, the retention rate and the cumulative sessions) and the same column updates as the « Coordonnées » and Jumelage « Limites de clientèle » cards. There are no approaches (P4-240). Guards, messages, readiness and Historique therefore behave exactly as in the app. The audit rows carry the source `import`, with the person who ran it as the actor.
- **A dry run by default:** each row is fully written and then rolled back, so nothing stays in the database (the deferred checks a commit would make are made too). With `--commit`, the script dry-runs every row first. If any row has an error, it writes nothing. Otherwise it asks you to type `importer`, then imports row by row. Each row is all or nothing.
- **One dry run lists everything to fix:** a line with a CSV error (« douze » in `annees_experience`, an email or IVAC number repeated in the file) still goes through the database's dry run with its other values, and both sides' errors are listed together, column by column. Only a line with more cells than the header (a stray separator: its values may sit under the wrong columns) is not sent; its line says so.
- **The report** is created before anything is asked or imported: an existing path stops the run at once (it is never replaced). It is readable by you only (mode 600). Each line is written to disk as its row completes, so an interrupted run keeps every line done. With `--commit` it holds the dry run's lines (`mode = essai`) and then the import's (`mode = import`). A report with no line (the run stopped before the first one, at the sign-in for example) is removed.
- **Re-runs are safe:** an email the clinic's professionals already use is reported « ignoré » (Courriel déjà présent) and left as it is. The import never updates an existing record; corrections are made in the app.
- **`activer = oui`** activates the record. A complete record is simply activated. An incomplete one is activated with the override reason « Dossier complété hors application ». Aperçu then reads « Activé sans dossier complet » and lists what is missing. This needs `professionals.activate_override`, which only the admin role has.
- **Not imported in 4a** (complete them in the app): gender, address lines, presentation and the « Approche » text (Profil public), public contact, availability and « Accepte de nouveaux clients » (it defaults to yes), documents, the private data (SIN, bank account, tax numbers). Of the compensation, only today's retention rate and the cumulative sessions are imported (see « Rétention »); the « Ententes particulières » and the following months' sessions are entered in the app.

## The CSV
One line per professional, UTF-8 (« CSV UTF-8 » in Excel; Google Sheets exports UTF-8), separated by commas or by semicolons (French Excel). Header names are matched without case or accents (`Prénom` = `prenom`). An unknown column is refused, so a typo cannot be silently ignored. Empty columns may be left out, except the three required ones.

| Column | Required | Content | Example |
|---|---|---|---|
| `prenom`, `nom` | yes | As the professional writes them | `Élodie`, `Gagnon` |
| `courriel` | yes | Login and invitation address; case does not matter | `elodie.gagnon@…` |
| `telephone` | | Personal phone, typed in any usual way | `514 555-0142` |
| `ville`, `province`, `code_postal` | | Home city, province code (QC by default), postal code | `Montréal`, `QC`, `H2J 3K5` |
| `annees_experience` | | Whole number, 0–60 | `14` |
| `titre_1`, `permis_1` | | Primary title (key) and its licence number (required when the title belongs to an order) | `psychologue`, `54321` |
| `titre_2`, `permis_2` | | Second title, if any | `psychotherapeute`, `PT-12` |
| `langues` | | Language codes, separated by `;`. Empty → French | `fr;en` |
| `clienteles` | | Keys separated by `;`, with `*` after a specialized one | `adults*;couples` |
| `age_minimum` | | The youngest client age the professional takes, 0–120 (empty: none). The website's « Enfants (8+) » is `children` in `clienteles` and `8` here | `8` |
| `femmes_seulement` | | `oui` for « Femmes exclusivement », else `non` or empty | `oui` |
| `motifs` | | Keys separated by `;` | `anxiete;deuil;estime_de_soi` |
| `ivac` | | IVAC number (unique in the clinic) | `IVAC-30111` |
| `activer` | | `oui` or `non` (empty = `non`: the record stays « À inviter ») | `oui` |
| `retenue` | | The clinic's retention % applied today, 0–100, two decimals at most; `%` allowed | `27,5 %` |
| `seances_cumulees` | | Cumulative sessions through the end of last month, half sessions allowed, 0–100 000 | `1 237,5` |

`scripts/fixtures/professionals-sample.csv` is a complete example (fictional people).

### Rétention (`retenue`, `seances_cumulees`)
Both columns are optional (leave them out, or leave a cell empty, and nothing is written for that line) and are typed the Québec way: `27,5`, `27.5`, `27,5 %` for `retenue`; `237`, `237,5`, `237.5`, `1 237,5` for `seances_cumulees` (spaces only between groups of three digits). In a comma-separated file a cell holding a comma must be quoted (`"27,5 %"`); Excel and Google Sheets do it themselves. Anything else (letters, `1.237,5`, two separators) is refused on its column, without the value being repeated. The bounds (0–100 % with two decimals at most; 0–100 000 sessions, by half session) are checked by the database, with the app's messages.
- **`seances_cumulees`** is the clinic spreadsheet's total **through the end of last month** (its monthly recalculation: 50/60-minute sessions count 1, 30-minute ones ½). It is written as the opening balance (adjustment « Solde importé ») of **last month**, the month before the import's month in the clinic's time zone. Last month's sessions are therefore already in it: **do not enter them again in « Révision mensuelle »**; start entering sessions with the current month. `0` writes nothing.
- **`retenue`** becomes the applied rate, as a « Taux de départ » decision, from **the first day of the import's month** (in the clinic's time zone): the rate covers the whole month, and the first decision taken afterwards, for the first day of a later month, is accepted. « Révision mensuelle » then shows « Écart à valider » for each professional whose rate differs from the grid's suggestion for their count (a decision there settles it), as it does for a professional imported without `retenue` (no rate yet).
- **The first « Révision mensuelle »** after the import opens on the **current month**, not last month: last month holds only the imported balances (each row reads « Solde importé : … avant le suivi »), so there is nothing to review there. Enter the current month's sessions at its end and review it as usual.
- Both need the permission **`professionals.compensation`** (the admin role only, by default). Without it, the first line holding either value stops the run (`Erreur de la base (42501) : Permission refusée : professionals.compensation`).
- A line « ignoré » (Courriel déjà présent) ignores both: set them on the record's « Rétention » card instead.
- The terminal and the report only say that a line carries them (`retenue, séances cumulées`), never their values. The CSV holds them: keep it outside the repository, as below.

### Keys
Titles, clientèles and motifs are given by their **key**, never by their name: keys never change, while names can be edited in Paramètres. The app never shows keys. These are the seeded ones. Rows added in Paramètres get a key made from their name (`Soutien scolaire` → `soutien_scolaire`).
- **Titles** (`titre_1`, `titre_2`): `psychologue`, `psychotherapeute`, `travailleur_social`, `psychoeducateur`, `sexologue`, `conseiller_orientation`, `nutritionniste` (these need a licence number), `naturopathe`, `coach_professionnel` (no order, no licence).
- **Languages:** `fr`, `en`, `es`, `ca` (Catalan).
- **Clientèles** (P4-244): `children` (Enfants), `adolescents`, `young_adults` (Jeunes adultes), `adults`, `couples`, `families`, `parents`, `athletes` (Athlètes). There is no `seniors` or `groups` any more.
- **Motifs:** the 124 keys of the website catalogue (P4-241), listed with their names by the query below. The seed is `supabase/migrations/20261008082847_professionals_reference_data.sql`. The website's two labels listed under two headings have two keys each: `communication_couple` / `communication_famille`, `anxiete_de_performance` (École) / `anxiete_performance_sexuelle` (Sexualité).
- **There is no `approches` column** (P4-240): a CSV that still has one is refused (« Colonnes inconnues : approches »). Delete the column.

The clinic's current lists, archived rows included, can be read with this query. Run it locally, or on staging in the dashboard's SQL editor (read only). Each clinic has its own lists and the import resolves keys in the clinic of the person who runs it, so the query reads one clinic:
```sql
-- The clinic whose keys to list. Today each project holds one clinic, so this picks it.
-- With several clinics, name yours instead: where o.name = 'Clinique MANA'
-- (select id, name from public.organizations lists them).
with org as (select o.id from public.organizations o)
select 'titre' as list, t.key, t.name, o.acronym as ordre, t.is_active
  from public.profession_titles t left join public.professional_orders o on o.id = t.order_id
 where t.org_id in (select id from org)
union all select 'langue', l.code, l.name, null, l.is_active from public.languages l where l.org_id in (select id from org)
union all select 'clientele', c.key, c.name, null, c.is_active from public.clienteles c where c.org_id in (select id from org)
union all select 'motif', m.key, m.name, mc.name, m.is_active
  from public.motifs m left join public.motif_categories mc on mc.id = m.category_id
 where m.org_id in (select id from org)
order by 1, 3;
```
If the `org` line returns more than one clinic, the lists repeat: add the `where` above before using the result.
A convenient way to build the file: keep a « clés » sheet with this result, write names in the working sheet, and turn them into keys with `RECHERCHEV`.

### From GOrendezvous or the clinic's spreadsheet
- Export the professionals from GOrendezvous (or start from the clinic's own list), then copy the columns above into a new sheet. The layout of the GOrendezvous export is not known to this repository, so map its columns by hand. The table above is the target.
- Licence numbers go in `permis_1` / `permis_2` only, **bare**, as the order issued them (`10000-20`, never the website's « Membre de l’OPQ 10000-20 »). The script still cleans what the website shows, before sending (P4-247):
  - a leading « Membre de l’ » (or « Membre de l' ») and an order acronym before the number are dropped: the order comes from the title;
  - **« OTSFCQ »**, a typo on four website profiles, is read as OTSTCFQ (dropped like any acronym; the title `travailleur_social` gives the order);
  - trailing punctuation is dropped (« 1000020, » → « 1000020 »);
  - a 7-digit **OPPQ** number gets its dash, `NNNNN-AA` (« 1000020 » → « 10000-20 »): OPPQ has that format (`licence_pattern`, P4-248), so a number without the dash would be refused;
  - a membership of an association that is **not an order** (the coach's « Membre de RITMA 1234 ») is not a licence: the line is refused under `permis_1`. Leave `permis` empty (the coach title has no order) and keep the membership in a note or the public profile text.
- **One person, two titles:** a professional listed twice in the website's directory (two professions, one profile page) is **one** CSV line with `titre_1` / `permis_1` (the primary title: the one whose fees apply) and `titre_2` / `permis_2`.
- **Two values to confirm before the real run** (Jonathan asks the clinic): one OTSTCFQ number on the website is one character short, and one psychoéducatrice shows the Travail social fees. Neither blocks a dry run.
- **Fees are not imported.** The website's coach prices (120 / 80 $) include QC taxes; the grid stays before tax (104,37 / 69,58 $). A professional with no 30-minute fee on the website simply does not offer it. Fees belong to Rémunération / Services et tarifs, not to this import.
- **Legacy trap (inconsistency 12):** in the old app, the document type `license` meant the **image-rights consent** (« Consentement droit à l'image »), not a professional licence. Never copy anything about a `license` document into `permis_*`. Documents are not imported in 4a (they arrive in 4c).
- Keep the CSV **outside the repository** (for example next to the staging backups, in `clinique-mana-backups/`). Never commit it and never paste it in chat. Delete it once the import is checked. The reports hold emails: **give every real run a `--report` path outside the repository** (in the same folder as the CSV). The default name lands in the current folder; it is git-ignored (`import-report-*.csv`), which is a safety net, not a place to keep them. Delete the reports with the CSV.

## Steps
1. **Local dry run with the sample** (any time, no go-ahead needed). Start the local stack (`npm run db:start`, seeded), then:
   ```bash
   ANON="$(npx supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')"
   node scripts/import-professionals.mjs --file scripts/fixtures/professionals-sample.csv --anon-key "$ANON"
   ```
   Sign in as `admin@mana.test` (the local seed's password, `supabase/seed.sql`; admin, so it holds `professionals.compensation` for the sample's `retenue` and `seances_cumulees`). Expected: 6 lines « ok », « Résumé : 6 à créer (5 activé(s), dont 1 avec un dossier incomplet) · 0 déjà présent(s) · 0 en erreur. », and a report `import-report-<UTC time>.csv` in the current folder (fictional people only; delete it afterwards).
2. **Local dry run with the real CSV.** Use the same command with `--file <your csv> --report <folder outside git>/essai-local.csv`. Nothing is written. Fix every line in error and run it again until the run is clean. The local lists are the seeded ones: if Paramètres on staging has rows the seed does not, those keys show as unknown here only.
3. **With Jonathan's go-ahead: dry run on staging.** You need the staging anon key, which is public: Dashboard → Settings → API keys, the `anon` / publishable one. The secret key (`service_role`, `sb_secret_…`) is refused: it would bypass the permissions the import relies on. Then:
   ```bash
   node scripts/import-professionals.mjs --file <your csv> \
     --url https://vnmbjbdsjxmpijyjmmkh.supabase.co --anon-key <staging anon key> \
     --report <folder outside git>/essai-staging.csv
   ```
   Type the project reference `vnmbjbdsjxmpijyjmmkh` when asked, then sign in with **your own** admin account. Review the report: every line should be « ok » (or « ignoré » for a re-run). Read each « activé, dossier incomplet (…) » line, since those records will be activated with the override.
4. **With Jonathan's go-ahead: import.** Run the same command with `--commit` and a new `--report` path. The script dry-runs every row again, writes nothing if a row fails, and otherwise asks you to type `importer`. Each line is printed, and written to the report, as it is imported. If the run stops before the end, see « Reprendre après une interruption ».
5. **Spot-check five records** in the app (Professionnels): one with two titles, one with an IVAC number, one not activated, and one activated with an incomplete file. Check Aperçu, Jumelage, Identité et permis, and Historique (« … a créé le dossier », by you). For one imported with `retenue` and `seances_cumulees`, check the « Rétention » card: the rate (« Taux de départ », from the first day of the import's month) and the cumulative count (last month's « Solde importé ») match the spreadsheet. Also check that the list's count matches the report.
6. Delete the CSV and the reports, or move them to the backup folder until Jonathan decides.

## Reprendre après une interruption
An import can stop partway: Ctrl-C, the terminal closed (SIGTERM), the network lost, or a database error.
- **Ctrl-C** (or SIGINT / SIGTERM) stops between two rows: the row under way finishes (each row is all or nothing), then the script prints « Import arrêté après N ligne(s) sur M », signs out and closes the report. Ctrl-C at a question (credentials, project reference, `importer`) cancels the run instead: nothing has been imported then. A row stuck on the network cannot be cut short from the keyboard; close the terminal, then resume.
- **What was imported** is in the report: every `mode = import` line, each written as its row completed, with the record's `id`. The rows after the last line were not touched.
- **To resume,** run the same command again with `--commit` and a **new** `--report` path (the old report is kept, never replaced). The rows already created come back « ignoré » (Courriel déjà présent) in the dry run and in the import; the others are imported. Nothing is created twice.
- Keep both reports together: the first says which rows the interrupted run created, the second the rest.

## Messages and exit codes
| Message | Meaning |
|---|---|
| `Ligne N · … · erreur` and `colonne : message` | The value in that column is refused. The messages are the app's (« Motif inconnu : anxite », « Le numéro de permis est requis pour ce titre. », « Ce numéro IVAC est déjà attribué à un autre professionnel. »). At most three unknown keys are named per message, and only a value shaped like a key is quoted: anything else (a name, an address, a number) reads « (valeur masquée) » |
| `Courriel déjà présent` (ignoré) | The clinic already has this professional; nothing is changed |
| `Courriel déjà présent à la ligne N du fichier.` | The same email appears twice in the CSV |
| `Numéro IVAC déjà présent à la ligne N du fichier.` | The same IVAC number (spaces and case ignored) appears twice in the CSV |
| `ligne : Plus de cellules que de colonnes …` | A stray separator in that line: it was neither read nor sent. Fix the line |
| `La première ligne doit contenir les en-têtes …` | The file starts with data: add the header line (column names) |
| `Le rapport … existe déjà …` | Choose another `--report` path; nothing was asked or imported |
| `Cette clé est une clé secrète (service_role) …` | Use the project's public anon key, never the secret one |
| `Import arrêté après N ligne(s) sur M …` | The import stopped partway: see « Reprendre après une interruption » |
| `Ce courriel est déjà utilisé.` | A staff account of the clinic uses this address |
| `retenue : Indiquez un pourcentage …` / `seances_cumulees : Indiquez un nombre de séances …` | The cell is not a number the CSV can read (see « Rétention ») |
| `retenue : Le taux de retenue est un pourcentage entre 0 et 100 …` / `seances_cumulees : Le nombre de séances cumulées est compris entre 0 et 100 000 …` | The value is out of bounds, or has too many decimals |
| `Erreur de la base (42501) : Permission refusée : …` | The account lacks a permission: `professionals.manage`, `.matching` and `.view`, plus `.activate_override` when a line says `activer = oui`, and `.compensation` when a line has `retenue` or `seances_cumulees` |
| `Connexion refusée …` | Wrong email or password, or a disabled account |
| `Le fichier n'est pas en UTF-8 …` | Save the file again as « CSV UTF-8 » |
| `Adresse refusée …` / `Référence différente …` | On this computer only the local stack (`http://127.0.0.1:55321`, `http://localhost:55321`) may be reached; a remote project must be https and needs its reference typed back |

Exit code `0`: done, with no line in error. `1`: a line in error, or the run was cancelled (`importer` not typed, Ctrl-C at a question). `2`: the run stopped (arguments, file, target, key, report path, sign-in, a database error, an interruption between rows).

## Undo
- The dry runs change nothing.
- An imported record is an ordinary record: correct it in the app. To take one out of matching, deactivate it (« Désactiver »). The app has no delete, and the import has no undo. The report's `id` column names each created record if Jonathan decides otherwise.
