# Runbook — Import the existing professionals

**Status:** Built and tested locally (plan Task 4a.19, 2026-10-08). **Not run on staging.** · **Plan:** [Task 4a.19](../plans/2026-10-08-professionals-module-plan.md#task-4a19-import-tooling-for-the-50-existing-professionals-lanes-a-and-d--running-it-on-staging-is-jonathans-go-ahead), decisions P4-20 and P4-120–P4-130, [Mise en service item 6](../plans/2026-10-08-professionals-module-plan.md#mise-en-service-jonathan) · **Code:** `scripts/import-professionals.mjs`, RPC `import_professional` (`supabase/migrations/20261008163932_professionals_import.sql`), pgTAP `048_professionals_import`

> **Running it against staging is Jonathan's call, every time** (CLAUDE.md §11): first the staging dry run, then, after reviewing its report, the `--commit` run. **An agent never runs it against staging.** Jonathan runs it himself, in his own terminal, signed in with his own account.

## What it does
- It reads a CSV of the ~50 professionals and, for each line, calls `import_professional(row, dry_run)`. That RPC writes through the app's own RPCs (creation, titles and licences, languages, clientèles, approaches, motifs, IVAC number, activation) and the same column update as the « Coordonnées » card. Guards, messages, readiness and Historique therefore behave exactly as in the app. The audit rows carry the source `import`, with the person who ran it as the actor.
- **A dry run by default:** each row is fully written and then rolled back, so nothing stays in the database. With `--commit`, the script dry-runs every row first. If any row has an error, it writes nothing. Otherwise it asks you to type `importer`, then imports row by row. Each row is all or nothing.
- **Re-runs are safe:** an email the clinic's professionals already use is reported « ignoré » (Courriel déjà présent) and left as it is. The import never updates an existing record; corrections are made in the app.
- **`activer = oui`** activates the record. A complete record is simply activated. An incomplete one is activated with the override reason « Dossier complété hors application ». Aperçu then reads « Activé sans dossier complet » and lists what is missing. This needs `professionals.activate_override`, which only the admin role has.
- **Not imported in 4a** (complete them in the app): gender, address lines, presentation and approach (Profil public), public contact, availability and « Accepte de nouveaux clients » (it defaults to yes), documents, compensation.

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
| `approches` | | Same format | `cbt*;act` |
| `motifs` | | Keys separated by `;` | `anxiete;deuil;estime_de_soi` |
| `ivac` | | IVAC number (unique in the clinic) | `IVAC-30111` |
| `activer` | | `oui` or `non` (empty = `non`: the record stays « À inviter ») | `oui` |

`scripts/fixtures/professionals-sample.csv` is a complete example (fictional people).

### Keys
Titles, clientèles, approaches and motifs are given by their **key**, never by their name: keys never change, while names can be edited in Paramètres. The app never shows keys. These are the seeded ones. Rows added in Paramètres get a key made from their name (`Proche aidance` → `proche_aidance`).
- **Titles** (`titre_1`, `titre_2`): `psychologue`, `psychotherapeute`, `travailleur_social`, `psychoeducateur`, `sexologue`, `conseiller_orientation`, `nutritionniste` (these need a licence number), `naturopathe`, `coach_professionnel` (no order, no licence).
- **Languages:** `fr`, `en`, `es`.
- **Clientèles:** `children` (Enfants), `adolescents`, `adults`, `seniors` (Aînés), `couples`, `families`, `groups`.
- **Approaches:** `cbt` (TCC), `psychodynamic`, `humanistic`, `systemic`, `gestalt`, `emdr`, `act`, `dbt`, `art_therapy`, `play_therapy`.
- **Motifs:** 72 keys, listed with their names by the query below. The seed is `supabase/migrations/20261008082847_professionals_reference_data.sql`.

The clinic's current lists, archived rows included, can be read with this query. Run it locally, or on staging in the dashboard's SQL editor (read only):
```sql
select 'titre' as list, t.key, t.name, o.acronym as ordre, t.is_active
  from public.profession_titles t left join public.professional_orders o on o.id = t.order_id
union all select 'langue', l.code, l.name, null, l.is_active from public.languages l
union all select 'clientele', c.key, c.name, null, c.is_active from public.clienteles c
union all select 'approche', s.key, s.name, null, s.is_active from public.specialties s
union all select 'motif', m.key, m.name, mc.name, m.is_active
  from public.motifs m left join public.motif_categories mc on mc.id = m.category_id
order by 1, 3;
```
A convenient way to build the file: keep a « clés » sheet with this result, write names in the working sheet, and turn them into keys with `RECHERCHEV`.

### From GOrendezvous or the clinic's spreadsheet
- Export the professionals from GOrendezvous (or start from the clinic's own list), then copy the columns above into a new sheet. The layout of the GOrendezvous export is not known to this repository, so map its columns by hand. The table above is the target.
- Licence numbers go in `permis_1` / `permis_2` only, exactly as the order issued them.
- **Legacy trap (inconsistency 12):** in the old app, the document type `license` meant the **image-rights consent** (« Consentement droit à l'image »), not a professional licence. Never copy anything about a `license` document into `permis_*`. Documents are not imported in 4a (they arrive in 4c).
- Keep the CSV **outside the repository** (for example next to the staging backups, in `clinique-mana-backups/`). Never commit it and never paste it in chat. Delete it once the import is checked. The reports hold emails: they are git-ignored (`import-report-*.csv`); keep them outside the repository as well, and delete them with the CSV.

## Steps
1. **Local dry run with the sample** (any time, no go-ahead needed). Start the local stack (`npm run db:start`, seeded), then:
   ```bash
   ANON="$(npx supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')"
   node scripts/import-professionals.mjs --file scripts/fixtures/professionals-sample.csv --anon-key "$ANON"
   ```
   Sign in as `admin@mana.test` (the local seed's password, `supabase/seed.sql`). Expected: 6 lines « ok », « Résumé : 6 à créer (5 activé(s), dont 1 avec un dossier incomplet) · 0 déjà présent(s) · 0 en erreur. », and a report `import-report-<UTC time>.csv` in the current folder.
2. **Local dry run with the real CSV.** Use the same command with `--file <your csv> --report <folder outside git>/essai-local.csv`. Nothing is written. Fix every line in error and run it again until the run is clean. The local lists are the seeded ones: if Paramètres on staging has rows the seed does not, those keys show as unknown here only.
3. **With Jonathan's go-ahead: dry run on staging.** You need the staging anon key, which is public: Dashboard → Settings → API keys. Then:
   ```bash
   node scripts/import-professionals.mjs --file <your csv> \
     --url https://vnmbjbdsjxmpijyjmmkh.supabase.co --anon-key <staging anon key> \
     --report <folder outside git>/essai-staging.csv
   ```
   Type the project reference `vnmbjbdsjxmpijyjmmkh` when asked, then sign in with **your own** admin account. Review the report: every line should be « ok » (or « ignoré » for a re-run). Read each « activé, dossier incomplet (…) » line, since those records will be activated with the override.
4. **With Jonathan's go-ahead: import.** Run the same command with `--commit` and a new `--report` path. The script dry-runs every row again, writes nothing if a row fails, and otherwise asks you to type `importer`. Each line is printed as it is imported.
5. **Spot-check five records** in the app (Professionnels): one with two titles, one with an IVAC number, one not activated, and one activated with an incomplete file. Check Aperçu, Jumelage, Identité et permis, and Historique (« … a créé le dossier », by you). Also check that the list's count matches the report.
6. Delete the CSV and the reports, or move them to the backup folder until Jonathan decides.

## Messages and exit codes
| Message | Meaning |
|---|---|
| `Ligne N · … · erreur` and `colonne : message` | The value in that column is refused. The messages are the app's (« Motif inconnu : anxite », « Le numéro de permis est requis pour ce titre. », « Ce numéro IVAC est déjà attribué à un autre professionnel. »). At most three unknown keys are named per message, and a value that looks personal reads « (valeur masquée) » |
| `Courriel déjà présent` (ignoré) | The clinic already has this professional; nothing is changed |
| `Courriel déjà présent à la ligne N du fichier.` | The same email appears twice in the CSV |
| `Ce courriel est déjà utilisé.` | A staff account of the clinic uses this address |
| `Erreur de la base (42501) : Permission refusée : …` | The account lacks a permission: `professionals.manage`, `.matching` and `.view`, plus `.activate_override` when a line says `activer = oui` |
| `Connexion refusée …` | Wrong email or password, or a disabled account |
| `Le fichier n'est pas en UTF-8 …` | Save the file again as « CSV UTF-8 » |
| `Adresse refusée …` / `Référence différente …` | Only the local stack may be reached over http; a remote project needs its reference typed back |

Exit code `0`: done, with no line in error. `1`: a line in error, or the import was cancelled. `2`: the run stopped (arguments, file, target, sign-in, a database error).

## Undo
- The dry runs change nothing.
- An imported record is an ordinary record: correct it in the app. To take one out of matching, deactivate it (« Désactiver »). The app has no delete, and the import has no undo. The report's `id` column names each created record if Jonathan decides otherwise.
