# Research — the intake and matching workbook (« Stats »)

**Date:** 2026-10-08 · **Source:** the clinic's live monthly workbook for October 2026, shared by Jonathan (« here is more you will need to create this app and your knowledge »). It holds 11 sheets of journals, formulas and a written procedure.
**Use:** read before designing **Demandes** (intake and matching). Read §7 before closing the Phase 4 matching profile.
**Privacy:** this document keeps only structure, vocabularies, formulas, workflow and aggregate counts. It holds no client note, no request row, no name, phone number or email. The four counsellors are called « conseillère A–D ». The workbook itself is not stored in the repo.

---

## 1. What the workbook is

Today the conseillères run intake and matching in this Excel file, next to GOrendezvous (see [business context §1b](../standards/business-context.md#1b-the-business-model-a-dispatch-clinic-with-a-bank-of-professionals)). It is the system of record for three things:

1. every incoming **demande** and how it ended;
2. **which professional has room** for a new client, and how many places they have left;
3. the weekly and monthly **statistics** (demandes, confirmations, waiting list, first-appointment cancellations, channels and referral sources).

| Sheet | Role | Typed by hand or calculated |
|---|---|---|
| « Feuille des disponibilités » | Read-only board of the professionals open to new clients, with places left. What a conseillère looks at to propose someone. | Calculated from the MATRICE |
| « DEMANDES REÇUES - <prénom> » ×4 | One journal per conseillère (A–D), one row per demande, plus a « Suivi du jour » block and a 4-week history | Typed (rows), calculated (blocks) |
| « Annulations 1er RDV » | Journal of first-appointment cancellations, with a per-professional summary and a per-reason breakdown | Typed (journal), calculated (summaries) |
| « Résumé Global » | Weekly KPIs, all conseillères together | Calculated, except one cell per week |
| « Résumé Canal et Provenance » | Month totals by channel × outcome and by referral source | Calculated |
| « Professionnels » | Confirmations per professional per week and per clientèle, and their first-appointment cancellations | Calculated (names typed) |
| « MATRICE Bonifiée » | The availability matrix: one row per professional, with title, platform, service types, time windows, notes, capacity and rank | Typed, except 4 helper columns |
| « Marche à suivre » | The manual procedure (4 sections) | Text |

Scale (aggregates): 4 journals with a 400-row template each; about 160 rows were logged in the first ~1.5 weeks of the month, and one conseillère logged about 70 % of them. The MATRICE lists 57 professionals and « Professionnels » 59.

---

## 2. Intake workflow (« Demandes reçues »)

### 2.1 Columns of a journal row

| Column | Meaning | Allowed values (dropdown) |
|---|---|---|
| N° | Row number (pre-filled 1–400; an « Ex. » row shows an example) | — |
| DATE DE LA DEMANDE | Day the request came in | date |
| CANAL | How it arrived | `Téléphone`, `Courriel`, `Rendez-vous pris à l'agenda`, `Rendez-vous ajouté à l'agenda par téléphone`, `Demande reçue auparavant` |
| PROVENANCE | « Comment avez-vous entendu parler de MANA ? » | `Google / moteur de recherche`, `Facebook / Instagram`, `Recommandation d'un proche`, `Référence d'un professionnel`, `Employeur / PAE`, `École / organisme`, `Conférence / atelier / événement`, `Télévision`, `Radio`, `Déjà client(e) de MANA`, `Autre` |
| LISTE D'ATTENTE PSYCHOLOGIE | Whether the person joins the **psychologie** waiting list | `Non`, `Liste d'attente` (on the list only), `Liste d'attente + RV` (on the list **and** booked meanwhile with another professional), or empty (not applicable) |
| CONCLUSION DE LA DEMANDE | How the contact ended | `Proposition`, `Confirmation`, `Confirmation de proposition`, `Non pertinente`, `Répondeur` |
| NOTES | Free text. It often carries health information about the client, so in the app it is sensitive data. | — |
| SEMAINE (calculée) | Monday of the request's week, as text « d mmm » (« 5 oct ») | formula |
| PROFESSIONNEL(LE) | The professional who **gets the appointment** | dropdown fed by the « Professionnels » name list |
| CLIENTÈLE | Type of client | `8-13 ans`, `14-18 ans`, `Adultes`, `Couples-familles`, `IVAC` |

Week formula: `DAY(d − WEEKDAY(d,2) + 1) & " " & CHOOSE(MONTH(…), "janv", …, "déc")`. Weeks start on Monday, and the label has no year.

Two older provenance values still appear in rows: « Recherche google » and « Parents/amis ». The summary formulas fold them by hand into « Google / moteur de recherche » and « Recommandation d'un proche ».

### 2.2 Meaning of the canal values

- **Téléphone / Courriel:** a new request by phone or email.
- **Rendez-vous pris à l'agenda:** the client booked directly in the online agenda. The conseillère logs it so it counts. Most of these rows end as `Confirmation`.
- **Rendez-vous ajouté à l'agenda par téléphone:** the conseillère booked the appointment during a call.
- **Demande reçue auparavant:** **not a new request**. It is a follow-up row for a request already logged, typically the client accepting an earlier proposition. It is excluded from every « Demandes » count. Only its `Confirmation de proposition` is added to the confirmations.

### 2.3 How a request flows

```
received (row: date, canal, provenance)
  ├─ Non pertinente ............ not a request for services (end)
  ├─ Répondeur ................. no live contact yet (voicemail / unanswered email)
  ├─ Liste d'attente ........... psychologie waiting list only (no conclusion, no professional)
  ├─ Confirmation .............. first appointment booked now → PROFESSIONNEL + CLIENTÈLE filled
  └─ Proposition ............... a professional proposed; the client will confirm
        └─ later: a NEW row, canal « Demande reçue auparavant »,
           conclusion « Confirmation de proposition » → PROFESSIONNEL + CLIENTÈLE filled
```

- `Liste d'attente + RV` combines with a `Confirmation`: the client waits for a psychologist and meanwhile sees another professional.
- **The professional and the clientèle are filled only on confirmations.** A `Proposition` row does not say who was proposed, so a proposed place is not held.
- The proposition row and its later confirmation row are **not linked**. The workbook cannot measure time to confirmation or open propositions.
- « Répondeur » comes almost only from emails. « Non pertinente » comes mostly from phone calls. Online self-bookings mostly end as confirmations.
- Mondays carry about a third of the week's rows (the weekend backlog).

### 2.4 « Suivi du jour » (per journal)

« Date du jour » is **typed by hand** (no `TODAY()`), so each journal can show a different day. For that date:

| KPI | Formula (journal rows 5–404) |
|---|---|
| Demandes reçues | `COUNTIFS(date = jour, canal ≠ "Demande reçue auparavant")` |
| Proposition | same + `conclusion = "Proposition"` |
| Confirmations | `(canal ≠ auparavant AND conclusion = "Confirmation") + (conclusion = "Confirmation de proposition")` |
| Liste d'attente | `liste = "Liste d'attente"` (not « + RV », and follow-ups not excluded) |
| Répondeur | `canal ≠ auparavant AND conclusion = "Répondeur"` |

### 2.5 « Historique » (current week + 3 previous)

The same five counts (Demandes, Proposition, Confirm., Liste att., Répond.) per week label. The current week is the week of « Date du jour ». The previous weeks are taken from the **week headers of the « Professionnels » sheet** (`INDEX(Professionnels!B1:F1, MATCH(current) − n)`). Those headers only list the current month's weeks, so early in a month the previous weeks are blank.

---

## 3. Availability matrix (« MATRICE Bonifiée ») and the board

### 3.1 Columns

| Column | Meaning | Values seen |
|---|---|---|
| Couleur | Highlight of the name (conditional format), meaning not written down | `Orange`, `Turquoise`, `Beige`, `Rouge`, `Jaune`, `Lilas` (3 used). Turquoise sits mostly on psychologists and psychotherapists. **Ask Jonathan.** |
| Nom | Professional (typed) | — |
| Titre | Profession, free-text abbreviation | `TS`, `Psyed` (also « PS ED », « psyed »), `Psy`, `Sexo`, `Orientation`, `Psychothérapie`, `Coach Pro certifiée`, and combinations (« Psyed Naturo », « Sexo/psychothé ») |
| Plateforme | Video tool the professional uses | `GOOGLE MEET`, `TEAMS`, `ZOOM`, `COLIB`; free text (« sur demande », an instruction to ask management); **blank for 37 of 57** |
| I / C / F | Service types: **I = Individuel, C = Couple, F = Famille** (each column only accepts its own letter) | I 21, C 12, F 15. **25 rows have none**, so blank does not mean « no ». A family row also covers parent-child mediation. |
| J | **Jour**, daytime availability | `X` (31); one row holds a status (« Arrêt de travail ») instead |
| 16h+ | Available **from 16 h** (late day / evening) | `X` (27) |
| W-E | **Week-end** | `X` (5) |
| Bon à savoir | Free-text matching notes (§3.4) | 48 of 57 filled |
| Disponibilités totales | Places the professional **has now** for new clients (typed, not cumulative) | 1–8 (usually 2–6); one free-text value (« lui écrire si demande ») |
| Disponible | Shown on the board or not (typed) | `Oui` (28), `Non` (28), one invalid `X` |
| Notes | Extra notes shown on the board | mostly languages (« Anglais », « Espagnol », « Catalan »), a start date (« à partir de novembre »), a waiting-list exclusion |
| Date d'inscription | Day the capacity was last (re)declared; the decrement counts from it | most rows carry the same date (a bulk reset) |
| RDV confirmés (depuis) | Confirmations since that date | formula |
| Disponibilités restantes | Places left | formula |
| Rang (aide) | Position on the board | formula |
| Nom (journal, aide) | The name exactly as in the journals' dropdown (the key) | typed |
| Vérif. Professionnels | `✓` / `⚠ Manquant` if the name is missing from « Professionnels » | formula (accent-stripped, upper-case comparison) |

Header legend on the board: « 🌎- anglais » (a marker for English-speaking professionals) and « Disponibilités sans courriel » (meaning not written; likely « bookable without emailing the professional first », as opposed to the Bon à savoir notes that say to write first). **Ask Jonathan** to confirm both.

### 3.2 Remaining places

```
RDV confirmés (P) = Σ over the 4 journals of
    COUNTIFS(pro = Nom journal, date de la demande ≥ Date d'inscription, canal ≠ auparavant, conclusion = "Confirmation")
  + COUNTIFS(pro = Nom journal, date de la demande ≥ Date d'inscription, conclusion = "Confirmation de proposition")
  (0 when Date d'inscription is empty)

Disponibilités restantes (Q) =
    ""                   if no name or no total
    total                if Date d'inscription is empty   (never decrements)
    MAX(0, total − P)    if total is a number
    total (as text)      otherwise (« lui écrire si demande »)
```

Every confirmation a conseillère logs removes one place. When none are left the cell shows 0 and turns yellow on the board. The professional stays listed until someone sets « Disponible = Non ». The board total (« TOTAL DES DISPONIBILITÉS (restantes) ») sums Q. In the sample it was about 80 places across 28 professionals.

Quirks:
- The count uses the **date of the request**, not the date of confirmation. A request logged before a reset and confirmed after it is not counted.
- **A first-appointment cancellation does not give the place back.** Staff must retype the total (procedure §3).

### 3.3 Rank and the board

`Rang = IF(Disponible = "Oui", COUNTIF($M$3:M3, "Oui"), "")`: a running count of the « Oui » rows in sheet order. The procedure keeps the sheet sorted A→Z by name. The board pulls rank 1, 2, 3 … with `INDEX/MATCH`.

So the **rank is not a priority**. It filters on « Disponible = Oui » and keeps the alphabetical order. Nothing in the workbook orders professionals by fit, by places left, or by fairness of distribution. The conseillère chooses by reading the board.

Board conditional formats: places left = 0 → yellow; `I` / `C` / `F` → coloured badges (pink, blue, green); name highlighted by its « Couleur ». A separate block at the bottom, « Pour l'administration seulement », is a hand-kept list of professionals that the conseillères do not see on the board (for example a specific programme or language).

### 3.4 « Bon à savoir »: the kinds of content

Free text, read by the conseillère at the moment of choosing. In the 48 notes:

| Kind | How often | Where it belongs in the app |
|---|---|---|
| Age bounds (« 14 ans et plus », a maximum age, a preferred range) | ~28 | clientèles / minimum client age |
| Preferred themes and populations | most notes | motifs (score) |
| **Exclusions** (« pas de … », « aucun … »: themes, couple work, legal processes, risk levels) | ~17 | no structured home yet (§7) |
| Service-type rules (« couples seulement », individual only, « 1er rv les 2 » for couples, no couples in summer) | ~7 | clientèles + note |
| Daily limits and spacing (max clients per day, max evening sessions, 15–30 min between sessions, start on the hour) | ~6 | Rendez-vous booking rules (later) |
| Time windows (mornings only, daytime only) | ~3 | availability periods |
| Booking lead time (« ne pas donner un rdv moins de 24 h / 72 h avant ») | 2 | Rendez-vous booking rules |
| Contact first (« toujours écrire un courriel avant de réserver ») | 1 | note / booking rule |
| Women-only clientèle | 1 | women-only flag |
| French only | 1 | languages |
| Practical (a technique, a programme, where sessions are receipted) | a few | public profile / note |

---

## 4. First-appointment cancellations (« Annulations 1er RDV »)

**Journal fields:**
- N°;
- DATE DE L'ANNULATION (when the cancellation is received);
- PROFESSIONNEL(LE) (dropdown);
- DATE DU RENDEZ-VOUS PRÉVU;
- DATE DE LA PRISE DE RENDEZ-VOUS (when it was booked);
- DÉLAI AVANT RDV (JOURS) (formula);
- RAISON DE L'ANNULATION (dropdown);
- NOTES;
- SEMAINE (calculée, from the cancellation date).

**Reasons:**
- `A trouvé une ressource ailleurs`;
- `Préfère un suivi en présentiel`;
- `Raisons financières / assurances`;
- `N'a plus besoin / problème résolu`;
- `Indisponibilité / conflit d'horaire`;
- `Aucune raison donnée` (kept on purpose to track how many come without a reason);
- `Autre (voir notes)`.

**Delay:** `IF(OR(rdv = "", prise = ""), "", rdv − prise)`. That is the **booking lead time** (appointment − booking). The legend says « date du RDV prévu − date de l'annulation », which is the **notice** given. Formula and legend disagree. The app should store all three dates and show both measures.

**Section 2, per professional:** count, average / min / max delay, and how many say « Aucune raison donnée » (`COUNTIF`, `AVERAGEIFS`, `MINIFS`, `MAXIFS`). Its ranges start at journal row 11, so the first 5 rows are left out. Those 5 rows were copied from older cell comments and may lack the booking date.

**Section 3, per reason:** count and %. Its formulas point at the wrong rows (they compare to cells in the professional list), so **it always shows 0**. This is a broken range left over from an inserted block.

Links: « Professionnels » column « ANNULATION AVANT RDV » counts each professional's cancellations over all rows. « Résumé Global » counts them per week of the cancellation date.

In the sample (two weeks), 8 cancellations against 54 attributed confirmations gave a 14.8 % rate (« TOTAL DES ANNULATIONS » = cancellations ÷ confirmations). The booking lead time ran from 2 to 18 days. « Aucune raison donnée » was the most frequent reason.

---

## 5. Summaries and KPIs

### 5.1 « Résumé Global » (one row per week, rows typed: the month's Mondays)

| KPI | Formula (summed over the 4 journals, by week label) |
|---|---|
| DEMANDES | rows with `canal ≠ "Demande reçue auparavant"` |
| CONFIRMATION | `canal ≠ auparavant AND conclusion = "Confirmation"` |
| CONF. PROPOSITION | `conclusion = "Confirmation de proposition"` (any canal) |
| CONFIRMATIONS TOTALES | CONFIRMATION + CONF. PROPOSITION |
| % CONFIRMÉES | `IFERROR(confirmations totales / demandes, 0)` |
| ANNULATIONS 1er RDV | cancellation rows whose week = this week |
| LISTE D'ATTENTE SEULEMENT | `liste = "Liste d'attente"` (not « + RV ») |
| PROPOSITION / RÉPONDEUR / NON PERTINENTE | `canal ≠ auparavant AND conclusion = …` |
| DISPONIBILITÉS TOTALES DÉBUT DE SEMAINE | **typed every Monday**: a copy of the board total (it changes during the week) |
| TOTAL | sum of the weeks |

The confirmation rate mixes cohorts. CONF. PROPOSITION counts follow-ups of earlier weeks' demandes, but the denominator holds only this week's new demandes. In the sample the rate was about 35–44 % per week and 38 % for the month to date.

### 5.2 « Résumé Canal et Provenance » (« total du mois »)

1. **By canal** (Téléphone, Courriel, Rendez-vous pris à l'agenda, Rendez-vous ajouté à l'agenda par téléphone): NB DEMANDES, PROPOSITION, CONFIRMATION, CONF. PROPOSITION, NON PERTINENTE, RÉPONDEUR. Then **totals**: demandes (`date ≠ "" AND canal ≠ auparavant`), confirmations totales, % confirmées, annulations (non-empty cancellation weeks), liste d'attente seulement, and the five conclusions.
2. **By provenance** (the 11 values, legacy values folded in): count, and « dont confirmées » (Confirmation + Confirmation de proposition).
3. **Waiting list (psychologie):** total (`≠ "Non"` and not empty), « dont liste seulement », « dont liste + RV ».

« Total du mois » has **no date filter**: it sums the whole journal. The journal legend calls the journal annual, so these totals would grow past the month. Provenance was empty on more than half the rows.

### 5.3 « Professionnels »

Per professional (names typed in column A):
- confirmations per week (the month's 5 Monday headers, typed);
- TOTAL;
- ANNULATION AVANT RDV;
- confirmations per clientèle (8-13 / 14-18 / Adultes / Couples-familles / IVAC).

Both kinds of confirmation are counted, with `SUMPRODUCT` and `TRIM` on names. A helper column holds an accent-stripped, upper-case name for the MATRICE check.

**Defect:** the clientèle formulas compare to « 14 - 18 Ans » and « Couples - Familles », while the dropdown values are « 14-18 ans » and « Couples-familles ». Those two columns are **always 0**. In the sample, 13 of 55 confirmations were missing from the per-clientèle view. Totals at the bottom use `SUBTOTAL(109, …)`.

---

## 6. « Marche à suivre » (the manual procedure, generalised)

1. **Add a professional.**
   - Type the name **exactly the same** in 3 places: MATRICE name, MATRICE « Nom (journal) », « Professionnels » column A.
   - Unhide a reserve row in the MATRICE and fill in title, platform, I/C/F, 16h+, W-E and Bon à savoir.
   - Copy the 4 helper formulas down from the row above.
   - Re-sort the MATRICE A→Z (columns A–S), then add the name at the end of « Professionnels » and re-sort it.
   - Check that the name appears in the conseillères' dropdowns and in the cancellations dropdown, and on the board once « Disponible = Oui ».
2. **Log a first-appointment cancellation.**
   - One row per cancellation, filled with the dropdowns. The delay computes itself.
   - Weekly counts use the cancellation date, so check that date.
   - **The place is not given back:** re-add it by hand (step 3).
3. **Add availability to a professional** (new places announced, or a place freed by a cancellation).
   - In the MATRICE, type the number of places the professional has **now** (not a sum with the old number).
   - Set « Disponible = Oui » (« Non » hides them from the board).
   - Set « Date d'inscription » to today; only confirmations from that date count.
   - Never type in the computed columns or on the board.
4. **Every Monday:** copy the board total into « Résumé Global », « Disponibilités totales début de semaine ».

Not written but implied:
- **A new workbook each month.** The file is named after the month, and the weeks in « Résumé Global » and the « Professionnels » headers are typed per month.
- **« Date du jour » is updated by hand** in each journal.

---

## 7. Implications for Phase 4 (Professionnels)

Phase 4's matching profile (per the [module doc](../modules/professionals.md), plus the additions under way):
- availability periods, which the module doc lists as `am / pm / evening / weekend`, with « fin de journée » being added;
- `accepting_new_clients`;
- clientèles (age bounds; `couples`, `families`, `groups`);
- motifs, approaches and languages;
- a minimum client age;
- women-only.

### 7.1 What the workbook relies on, and where it should live

| Workbook attribute | Phase 4 today | Recommendation |
|---|---|---|
| **Disponible** (Oui/Non) | `accepting_new_clients` | **Covered.** Keep it separate from the places left: the workbook lists a professional with 0 places (yellow) until someone sets « Non ». |
| **Capacity**: « Disponibilités totales » + « Date d'inscription » → « restantes » | — | **Phase 4, small:** store the declared number on the matching profile (`new_client_places`, nullable smallint; null = not tracked, the « lui écrire si demande » case) and stamp `new_client_places_set_at` automatically on every change. « Date d'inscription » is that timestamp, not a separate attribute. **The decrement belongs to Demandes:** places left = declared − first appointments confirmed since `set_at` (by confirmation date, not request date), with a cancelled first appointment giving the place back automatically (confirm with Jonathan). Why now: conseillères (`professionals.matching`) update this number several times a week in the Jumelage tab, the board cannot exist without it, and Demandes should not have to add a column to Professionnels' table. Rendez-vous slots replace it later, as they replace the periods (P4-4). |
| **I / C / F** service types | clientèles `couples`, `families` + age groups | **Covered, no new field.** I = any age clientèle, C = `couples`, F = `families`. « Couples seulement » = holding only `couples`. When importing, **a blank I/C/F must not mean « no »** (25 of 57 rows are blank): leave those for the conseillères to set. |
| **J / 16h+ / W-E** | availability periods | **Covered.** J → `am` + `pm`, 16h+ → the late-day period, W-E → `weekend`. The workbook defines late day **by the clock (16 h)**, so the period's label or help text should say where it starts (« Fin de journée (16 h et plus) »). Keep `am` / `pm` split: some notes say « AM seulement ». |
| **Plateforme** (Teams / Zoom / Google Meet / Colib) | — | **Not matching; later.** The clinic is 100 % online, no client chooses by tool, and 37 of 57 are blank. It is appointment logistics: Rendez-vous (a video link per appointment, already an open question in [business context §5](../standards/business-context.md#5-implications-for-the-rebuild)). At most an optional practice field in the 4b questionnaire if the fiche should show it. |
| **Bon à savoir** | `availability_note` (≤ 500, availability only) | **Phase 4: add a staff-only free-text « Bon à savoir » (matching notes)** to the matching profile, shown wherever Demandes suggests the professional. It is what conseillères read at the moment of choice. Over time, move each recurring kind to structure: age → clientèles / minimum age (under way); women-only (under way); language → languages; couples-only → clientèles. **Exclusions** (~17 of 48 notes) are the main kind with no home. Phase 4's rule is « motifs score, never exclude » (Demandes rule 6). Record this as an open question for the Demandes design: « motifs refusés » as a hard filter, or a highlighted note. Daily limits, spacing, lead time and contact-first are **Rendez-vous booking rules**; until then they stay in the note. |
| **Notes** column | languages; `availability_note` | Languages: covered. « À partir de novembre »: an optional « accepte de nouveaux clients à partir du » date is a cheap candidate (else the note). The waiting-list exclusion is Demandes' concern (below). |
| **Titre** abbreviations | `profession_titles` (9 seeded) + several professions per person | **Covered.** Import map: TS → `travailleur_social`, Psyed → `psychoeducateur`, Psy → `psychologue`, Sexo → `sexologue`, Orientation → `conseiller_orientation`, Psychothérapie → `psychotherapeute`, Coach Pro → `coach_professionnel`; combinations become two professions. |
| **Couleur** | — | **Do not model** until its meaning is known (ask Jonathan). If it means a category, use an explicit tag or badge, never a bare colour. |
| « Pour l'administration seulement » list | — | **Ask Jonathan** what puts a professional there. If it is « not proposed by conseillères », that is a visibility flag for Demandes, not a capacity number. |
| Clientèle « IVAC » | — | IVAC is a **payer**, not a clientèle. It belongs on the demande or client (payer / funding), not on the clientèle list. |

The workbook's report bands (8-13, 14-18) differ from the seeded clientèles (0-12, 13-17, 18-64, 65+). Since clientèle bounds are editable per clinic, Demandes reports should derive the band from the client's age, not from a separate pick-list.

### 7.2 What the workbook tells us not to copy

- **A name is not a key.** A name typed in three places, with trailing spaces in 9 of 57 rows, is matched by `TRIM` in some formulas and not in others. The app uses ids everywhere; this is already the case.
- **Status is not an availability flag.** « Arrêt de travail » typed in the « J » column is a status (Phase 4's deactivation reasons, or « n'accepte pas de nouveaux clients » with a note).

---

## 8. Requirements for the future Demandes module

### 8.1 Data model sketch

- **`demandes`**
  - Fields:
    - `received_at` (timestamptz) and `received_by` (conseillère);
    - `channel` (`phone`, `email`, `online_booking`, `phone_booking`, later `web_form`);
    - `referral_source` (reference list seeded with the 11 provenance values, the same list as the website);
    - the principal person and the clientèle (derived from age, or couple / family);
    - payer (PAE, IVAC, private);
    - motifs, language and schedule preferences;
    - `notes` (sensitive health information: access by permission, never in logs or notifications).
  - **No « Demande reçue auparavant » rows:** a follow-up is an event on the same demande.
- **Status with history** (`demande_events`): `nouvelle` → `sans_reponse` (répondeur, with attempt count and last attempt) → `proposee` → `confirmee`, or `non_pertinente`, or `liste_attente`. Every change is timestamped, which gives time to first contact, time to proposition, time to confirmation and the 24–48 h callback promise.
- **`demande_propositions`**: professional, proposed by, proposed at, status (`en_attente`, `acceptee`, `refusee`, `expiree`), and the recommendation snapshot (professional directory `updated_at`, Phase 4 Demandes rule 10). This records **who was proposed**, which the workbook loses, and can hold a place for a set time.
- **First appointment**: professional, booked at, appointment date. Once Rendez-vous exists, a link to the appointment.
- **Cancellation of a first appointment**: cancelled at, reason (reference list seeded with the 7 reasons), note. Both delays are derived: lead time (appointment − booking) and notice (appointment − cancellation).
- **Waiting list**: discipline (today only psychologie; make it a list), since, and an optional **bridge professional** (« + RV »). Respect professionals who take no waiting-list clients.
- **Capacity**: Phase 4's declared places + `set_at`. Places left = declared − confirmed first appointments since `set_at` + cancelled first appointments (if they give the place back), computed in one view, never typed.
- **Capacity snapshots**: a daily (or Monday) scheduled snapshot of total places, replacing the Monday copy.

### 8.2 Screens

1. **Demandes inbox**: all conseillères or « mes demandes »; status filters; age against the 24–48 h promise; « sans réponse » with the next attempt due; open propositions waiting for the client.
2. **Quick log**: a 20-second entry for channel, provenance, clientèle and outcome, so the non-pertinente and répondeur rows stay cheap.
3. **Matching panel** (replaces « Feuille des disponibilités »):
   - eligible professionals only (Phase 4 Demandes rules);
   - places left, with professionals at 0 shown apart;
   - service type, time windows, languages and Bon à savoir in view;
   - exclusions highlighted;
   - a visible, documented order (fit score, then places left, then name), not alphabetical by accident.
4. **Availability board** for the adjointe: places per professional, editable in place (writes the Phase 4 field), with « dernière mise à jour ».
5. **Waiting list** view.
6. **First-appointment cancellations**: log and per-professional and per-reason views.
7. **Statistics** (§8.3), by week and by month, for any range.

### 8.3 KPIs (same meaning as the workbook, defined once)

- Demandes received (new only), by week, conseillère, channel and provenance.
- Outcomes: proposition, confirmation, non pertinente, sans réponse, liste d'attente (with and without a bridge appointment).
- **Confirmation rate, two views:**
  - activity: confirmations in the period ÷ demandes in the period (the workbook's figure);
  - **cohort**: share of the period's demandes that are eventually confirmed. The cohort view fixes the mixing in §5.1.
- Confirmations per professional per week and per clientèle (all bands counted; §5.3 defect).
- First-appointment cancellations: per week (by cancellation date), rate (÷ confirmations), by reason, by professional, lead time and notice (average / min / max).
- Places: total places left now, at the start of each week (snapshot), and per professional.
- Response times: received → first contact → proposition → confirmation.

### 8.4 What the app should do better than the workbook

- **One record per demande**, with linked follow-ups, instead of a second unlinked row.
- **Capacity that maintains itself:** it decrements on confirmation (by confirmation date), gives the place back on a first-appointment cancellation, and needs no « Date d'inscription » trick.
- **No hand work:**
  - no triple name entry, copied formulas, re-sorting or reserve rows;
  - no « Date du jour » to type;
  - no Monday copy;
  - no monthly workbook, typed weeks or month-bound history.
- **Adding a conseillère** is adding a user. Every workbook formula names the four journals one by one.
- **Fixed vocabularies with history:**
  - reference lists replace dropdowns, so old values are not folded in by hand;
  - provenance is required (or « Non précisé ») on new demandes, so the referral report means something.
- **Correct reports.** The workbook has these defects:
  - the per-clientèle counts drop two clientèles;
  - the per-reason cancellation counts are always 0;
  - the cancellation delay disagrees with its legend;
  - the « total du mois » has no date filter;
  - the per-professional cancellation stats skip the first rows.
- **Who was proposed** is recorded, and a proposition can hold a place.
- **Sensitive notes protected:** a request note can hold health information, so it is permission-gated and audited, and stays out of exports unless asked for.
- **A visible, explained order** for suggestions, instead of « Disponible = Oui » in alphabetical order.

### 8.5 Open questions for Jonathan

1. What do the name colours (Orange, Turquoise, Beige, …) and « Disponibilités sans courriel » mean?
2. Should a cancelled first appointment give the place back automatically?
3. Should a pending proposition hold a place, and for how long?
4. Exclusions in « Bon à savoir »: a hard filter (« motifs refusés ») or a highlighted note?
5. What puts a professional on the « Pour l'administration seulement » list?
6. Is the psychologie waiting list the only one, or should any discipline have one?
7. « Répondeur » on emails: no reply from the client, or an automatic reply sent by the clinic?
