# Clinique MANA — Business Context & Brand

**Sources:** cliniquemana.com (read 2026-10-06: Accueil, À propos, Prendre rendez-vous, Services, Psychologie, Thérapie de couple, Ateliers et conférences, Carrière, Contact, Code de déontologie, Politique de confidentialité) + the legacy app ([inventory](../plans/2026-10-06-legacy-feature-inventory.md)).
**Use:** read before designing any module or writing user-facing copy.

---

## 1. Who MANA is

- **Clinique MANA inc.**, founded in 2017 by **Christine Sirois** (direction and management, "chef d'orchestre"). Head office: 300-797 boul. Lebourgneuf, Québec (QC) G2J 0B5 · 418 907-9754 · info@cliniquemana.com.
- "MANA" means **power** in Polynesian: *donnez-vous le pouvoir d'agir*.
- **More than 50 professionals**, multidisciplinary: psychologues, psychothérapeutes, psychoéducateurs, travailleurs sociaux, sexologues, conseillers d'orientation, nutritionnistes/diététistes, coachs (parental, gestion des écrans). Each is bound by their professional order's code of ethics.
- **100 % online (téléconsultation), everywhere in Québec.** There are no in-person sessions.
- Three audiences: **individuals and families**, **businesses** (ateliers, conférences, its own PAE / employee assistance program offer) and **schools and organisations**.
- Values: **écoute, flexibilité, équité, collaboration**. Monthly online clinical meetings and a yearly codéveloppement day.

## 1b. The business model: a dispatch clinic with a bank of professionals

> "La clinique, c'est un gros dispatch avec une banque de professionnels. Les clients appellent la clinique, et le rôle de la clinique, c'est de trouver un professionnel qui répond aux besoins du client." — Jonathan, 2026-10-06

- MANA **does not** work like a single practice. Its core value is the **match**: conseillères take every incoming request, evaluate the need and **dispatch** the client to the right professional from a bank of ~50 independent professionals.
- **Today MANA runs on GOrendezvous**, a Québec practice-management SaaS (17 000+ professionals). It offers online booking, team agendas, automated reminders, a client portal, client records (forms, clinical notes, AI-assisted notes), invoicing and receipts, payments, revenue reports, and Québec/Canada privacy compliance. It is built around **one practice taking its own bookings**.
- **What GOrendezvous does not cover, and why Clinique MANA exists:**
  - management of the **professional bank**: recruitment, onboarding, documents, insurance, contracts, compensation;
  - the **dispatch workflow**: demande → evaluation → matching → assignment.
- **Product vision:** Clinique MANA is "a GOrendezvous adapted to a dispatch clinic". It covers the professional bank and dispatch, plus, over time, the practice features MANA relies on GOrendezvous for. **Decided 2026-10-06 (design D8):** replace everything except clinical notes, coexisting with GOrendezvous during the transition.

## 2. The people who use the app

| Person | Role in the business | App role (design §2) |
|---|---|---|
| Christine (direction) | Runs the clinic, signs contracts, privacy officer (Loi 25) | `admin` |
| Conseillères (e.g. Alicia, Nathalie) | First contact: free discovery call, needs evaluation, **matching** client ↔ professional. They know every professional's specialties and approach. | `counselor` « Conseillère » (+ overrides as needed) |
| Adjointe administrative (e.g. Rachel) | Administration, billing, management tools | `admin_assistant` « Adjointe administrative » (+ overrides) |
| Professionnels (~50) | Independent contractors, 100 % remote, set their own availability, no exclusivity, can keep a private practice | `provider` |

*Conseillère* and *adjointe administrative* are two roles with distinct defaults (decision #23); each clinic can adjust their defaults or add its own roles in « Utilisateurs et accès » (decision #40). The role defaults are in [the core module doc](../modules/core.md#permission-keys).

## 3. Client journey (what the app must support)

1. **First contact** — the client writes (website forms), books a discovery call online ("Réserver un appel découverte"), or calls. Website forms collect: name, email, phone, message, subject (évaluation gratuite / consultation / appel découverte pour une activité / joindre l'équipe / autre) and **"Comment avez-vous entendu parler de MANA ?"** (Google, réseaux sociaux, recommandation d'un proche, référence d'un professionnel, employeur / PAE, école ou organisme, conférence / atelier / événement, déjà client, autre). Promise: a conseillère calls back **within 24–48 business hours**.
2. **Free discovery call / needs evaluation** — 15–20 min, confidential, often the same day, with a conseillère. This is the **Demande** in the app (motifs, need, issues, history, legal context, schedule preferences, urgency).
3. **Matching** — the conseillère proposes the professional best suited ("le bon professionnel") and tells the client the rate for that discipline. Matching in the app supports this human decision; it doesn't replace it.
4. **Sessions** — usually **50 min (individual) or 60 min (couple / family)**, online. Frequency is set by client and professional (weekly, every two weeks, monthly). Help is offered to connect before the first session.
5. **After each session** — **a receipt is issued** (insurance reimbursement, medical-expense tax credit). Some services are covered by a **PAE** (employee assistance program) or **IVAC**.
6. **Cancellation** — less than **24 h** notice → cancellation fee.

## 4. Professional journey

1. **Recruitment** — job postings (e.g. psychologue: clientele mainly 14+, *honoraires à partir de 126,00 $*; psychothérapeute: *à partir de 115,20 $*) and spontaneous applications with CV through the website. Requirements: member in good standing of their order, **professional liability insurance**, comfortable with technology.
2. **Onboarding** — invitation, questionnaire, documents, contract (Professionnels module, design §5).
3. **Practice** — sets own availability, gets matched clients, clinic handles admin and billing ("Moins d'administratif. Plus de temps pour pratiquer.").
4. **Pay** — the clinic keeps a margin; the professional's fee grows with the **"programme de reconnaissance"** (recognition program). The legacy contract defined margins (consultation 25–30 %) and unused bonus rates. Advertised fees match: for example 160 $ × (1 − 28 %) = 115,20 $.

## 5. Implications for the rebuild

- **Online only:** appointment mode is video or phone (drop `in_person`). The core setting "Lieux de consultation" becomes **head-office address only**. A **videoconference link per appointment** may be needed. Which platform is used is an open question.
- **Referral source** ("Comment avez-vous entendu parler de MANA ?") belongs on the demande and the client, using the website's list, so it can be reported on.
- **Callback SLA (24–48 business hours)** — a demandes inbox with age/urgency is valuable; website forms could feed it later.
- **Receipts** must carry what insurers need: professional name, profession, **order and licence number**, session date and duration, amount. This lands in Facturation, but the data comes from Professionnels, so licence and order must be reliable from module 1.
- **Recognition program** — compensation must support **tiers that change over time** (history by `effective_from`), not one fixed percentage.
- **Recruitment** stays outside the app (decided 2026-10-07). Professionals are created manually once retained.
- **Fiche PDF** is client-facing: sent to the client after the discovery call (download or email from the app).
- **B2B** (ateliers / conférences, MANA's own PAE offer to employers, schools) is a separate future area. It is not in the legacy app.
- **Loi 25:** the privacy officer is Christine Sirois (ext. 222). Clients can request a copy or destruction of their data, so retention and export must be planned per module.

### Product notes from Jonathan (2026-10-07)

- **Matching is the heart of the app.** Professionals are matched on **motifs de consultation** and **spécialités**; both must be first-class, well-curated data in Professionnels (module 1) so Demandes can rely on them.
- **Consultation languages.** Every professional works in French (the default); what matters for matching is who also works in **English** and **Spanish**. The professional profile records the languages; the demande records the client's language, and matching uses it.
- **Insurance expiry is soft.** Legacy deactivated professionals automatically when their liability insurance expired. The rebuild does not: it raises an important in-app notification and sends an email **7 days before** expiry. What happens on the expiry date itself is settled in the Professionnels design.
- **Professional record layout.** The content listed in design §5.5 is right, but the order of the tabs and the way they are presented will be rethought in the Professionnels design.

## 6. Brand & tone

**Tone of voice:** warm, simple, human, reassuring, never clinical. Formal **vous**. Key lines:
- « MANA, c'est d'abord et avant tout des humains. Qui en aident d'autres. »
- « 100 % en ligne, 100 % humain. »
- « Le plus difficile, c'est parfois de faire le premier pas. »
- « Moins d'administratif. Plus de temps pour pratiquer. »

Copy rules for the app: short sentences, plain words, invite rather than command, no diagnostic vocabulary (motifs are orientation tags, not diagnoses), reassure on errors (« Un imprévu, ça arrive. »).

**Visual identity (website):**

| Token | Value | Use on the website |
|---|---|---|
| Wine / burgundy | `#9B1B3C` | Logo, primary call-to-action buttons |
| Charcoal | `#4D4D4F` | Body text and headings |
| Teal | `#249D95` / `#46ACA5` | Accents |
| Mint | `#E2F1EB` | Soft backgrounds |
| Soft pink | `#FCCAD8` | Accents |
| Yellow | `#FBD008` / pale `#FFEFAA` | Highlights |
| Off-white | `#F8F8F9` | Section backgrounds |
| Fonts | **Raleway** (body 16px/24px, headings 500–600, buttons 800), **Karla** (small bold accents) | |

The legacy app tokens (`docs/standards/brand.tokens.md`: sage/mint primary, burgundy "very sparingly", Inter) differ from the website, where burgundy is the main action colour and Raleway is used throughout. **Superseded by the design system** ([`docs/design-system/`](../design-system/README.md), decision #29): in the app, wine is the logo colour only, teal is the action colour, the font is Inter. Former decision for the visual redesign task: align the app with the website identity (Raleway, charcoal text, wine for primary actions, mint/teal for calm surfaces and states) while keeping the app's calm, low-contrast principle.
