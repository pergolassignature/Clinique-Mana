# « Suivi - application » (22 October 2026): test checklist

What to click to confirm that each point of Jonathan's document now behaves the way he asked. Each section opens with his request, then gives the steps and what you should see. Tick a box only after you have seen the expected result yourself.

| # | Jonathan's point | Where it landed |
|---|---|---|
| A | « préparer le contrat ne fonctionne pas » | PR #218 (merged) |
| B | Accents in the address, « Saint-Irénée » | PR #218 (merged) |
| C | « Le contrat sera signé par moi mais les autres formulaires de consentement […] signé par le professionnel assigné » | PR #219 |
| D | 1. The entente first, then the profile | PR #220 |
| E | 3. Birthday in « Profil professionnel », the calendar, a notice to the administration | PR #220 |
| F | 2. Approaches as checkboxes, counted but not on the fiche | PR #220 |
| G | 3. Cheque specimen instead of typing | PR #220 |
| H | Question: can he change the instructions himself? | PR #220 |

## 0. Before you start

- [ ] **Where to test.** #218 is already live on `app.cliniquemana.com`. #219 and #220 need their migrations, which arrive only with the merge (a Vercel preview runs the new screens against the old database). So test them either on the local stack with the branch checked out, or on `app.cliniquemana.com` after the merge. Merging to `main` deploys to the clinic's production.
- [ ] **Accounts.** You need Jonathan's admin account, a test professional whose mailbox you can read, and a test client email you can read.
- [ ] **Off by default, switch on after the deploy:**
  - Paramètres → Tâches planifiées → « Anniversaires des professionnels » (needed for E).
  - Paramètres → Professionnels → Invitations → « L'entente d'abord » (needed for D, only once you reach D).
- [ ] **Paramètres → Signataire** shows Jonathan's name and email (needed for C: he signs every contract).
- [ ] **For the client consents (C):** the Clients module is open to the testing accounts, at least one consent text is published (the seeded ones are still drafts, « Texte provisoire »), and one test client file exists.

## A. « Préparer le contrat » showed a blank frame (#218)

The PDF was fine. The browser was set to download PDFs instead of displaying them, and it refused the preview frame without any message.

- [ ] In Chrome, open `chrome://settings/content/pdfDocuments` and choose the option that downloads PDFs instead of opening them in Chrome.
- [ ] Open a professional → Contrat → « Préparer le contrat ». **Expected:** a short explanation and a « Télécharger le PDF » button instead of a blank box. The page count, the signers and Annexe A still show.
- [ ] Click « Télécharger le PDF ». **Expected:** the contract downloads, named after the document, and opens correctly.
- [ ] Set Chrome back to opening PDFs, then reopen the preview. **Expected:** the contract is drawn in the window, as before.
- [ ] Ask Jonathan to retry on his own computer. If he still sees a blank box with the browser set to open PDFs, the cause is something else: get his browser name and a screenshot.

## B. Addresses with accents (#218)

The address was not displayed wrong: the stored value itself was « Saint-Irã©Nã©E », pasted in already mangled. The app now refuses mangled accents everywhere an address is typed.

- [ ] In the questionnaire (Renseignements personnels), type the city `Saint-IrÃ©nÃ©e`. **Expected:** refused with « Les accents de ce texte sont brouillés. Retapez-le. »
- [ ] Repeat on a professional's « Coordonnées », on a client file's address and in Paramètres → Identité (the clinic's own address). **Expected:** the same refusal everywhere.
- [ ] Type `Saint-Irénée`, `Château-Richer`, `Lac-Mégantic`. **Expected:** accepted, and displayed correctly on the record, on the fiche PDF and in the contract preview.
- [ ] **Still to fix by hand:** the one professional whose city reads « Saint-Irã©Nã©E ». Open her « Coordonnées », retype « Saint-Irénée » and save. This is an ordinary edit in the app.

## C. Who signs (#219)

### The contract: signed by Jonathan

- [ ] Prepare and send a test professional's contract. **Expected:** the envelope has two signers, the professional and Jonathan for the clinic, and Jonathan receives his own signing email.
- [ ] Both sign. **Expected:** the contract reads « En vigueur », and the signed PDF carries both signatures.

### Client consents: signed by the assigned professional

- [ ] On a client file **without** a « professionnel attitré », go to Consentements → « Envoyer ». **Expected:** refused with « Ce dossier n'a pas de professionnel attitré : le consentement doit être signé par le professionnel assigné au dossier… ».
- [ ] Assign an **inactive** professional and send. **Expected:** refused with « Le professionnel attitré à ce dossier n'est pas actif… ».
- [ ] Assign the active test professional and send. **Expected:** only the client receives an email (the professional does not).
- [ ] Before the client signs, log in as the professional → « Mes clients » → « Consentements à signer ». **Expected:** the consent shows « En attente du client » with no « Signer » button.
- [ ] The client answers the questions and signs. Back in the professional's account, **expected:** « À signer » with a « Signer » button, and the signing opens inside the app.
- [ ] She signs. **Expected:** « Signé ». The signed PDF has the client's box and the professional's box with her full name.
- [ ] Shared custody (two authorised parents): send once. **Expected:** both parents receive a link, and the professional's « Signer » appears only once both parents have signed.
- [ ] Log in as **another** professional. **Expected:** her « Consentements à signer » does not list the test client.
- [ ] On a consent that is already signed, click « Envoyer la copie signée ». **Expected:** the copy goes to the client side only. The professional is not emailed and is not asked to sign again.
- [ ] Paramètres → Consentements (module Clients), open a draft text. **Expected:** the drafts now include the professional's signature box and the variable for her name. A text Christine has already edited is unchanged.

## D. 1. The entente first, then the profile (#220)

> « …une première étape pour la cueillette des informations afin de pouvoir générer l'entente en premier… Ensuite la création du profil… »

- [ ] Paramètres → Professionnels → Invitations: the « L'entente d'abord » card is there, **off**.
- [ ] With it off, invite a professional. **Expected:** the full questionnaire, as before (eleven sections, then « Révision et envoi »).
- [ ] Switch on « Demander d'abord ce que l'entente exige » and save, then invite a **new** test professional. **Expected:** her questionnaire asks only « Renseignements personnels » and « Profil professionnel », then « Révision et envoi ».
- [ ] She submits. Review it and apply it. **Expected:** « Préparer le contrat » works (it has her address and her profession), and the contract can be sent.
- [ ] Before the contract is signed, open her record → Documents. **Expected:** no « reste du profil » card yet.
- [ ] She signs, then Jonathan signs. Reopen Documents. **Expected:** « L'entente est en vigueur : au tour du profil », naming the nine sections still to fill, with a « Demander le reste du profil » button.
- [ ] Click it. **Expected:** « Demander une mise à jour » opens with exactly those nine sections ticked. Send it. **Expected:** she receives the usual update email and fills in the rest (clientèles, approches, photo, assurance, …).
- [ ] Review and apply. **Expected:** the card disappears, and the profile can now be activated. Before this step, activation must still be impossible.
- [ ] An invitation sent **before** the setting was switched on keeps its full questionnaire.
- [ ] A professional onboarded with the full questionnaire never sees the card.

## E. 3. Birthday: the field, the calendar and the notice (#220)

> « Ajouter : Date anniversaire à cette section et s'assurer que la date s'affiche dans le calendrier avec une notification pour l'administration »

**In the questionnaire (« Profil professionnel »)**

- [ ] « Date d'anniversaire » shows two dropdowns, Jour and Mois, and no year.
- [ ] Leave it empty. **Expected:** she can continue (the field is optional).
- [ ] Pick only the day. **Expected:** « Choisissez le jour et le mois. »
- [ ] Pick 31 avril. **Expected:** « Ce jour n'existe pas dans ce mois. »
- [ ] Pick 29 février. **Expected:** accepted.
- [ ] On « Révision et envoi », **expected:** written out as « 14 mars », with no year.
- [ ] Staff review sheet: **expected:** a « Date d'anniversaire » row, applied with the rest.

**In the calendar (Rendez-vous → Agenda)**

- [ ] Day or week view on a week that holds her birthday. **Expected:** an « Anniversaires : » line above the calendar, with her name and the date.
- [ ] Month view. **Expected:** a small cake and her name on that day.
- [ ] Log in as a professional → « Mon agenda ». **Expected:** no birthdays (she does not see her colleagues' birthdays).
- [ ] An archived or inactive professional's birthday does **not** show.
- [ ] A 29 February birthday shows on 28 February in a non-leap year.

**The notice to the administration**

- [ ] With « Anniversaires des professionnels » switched on (Paramètres → Tâches planifiées), set a test professional's birthday to today. Click « Exécuter maintenant ». **Expected:** every user who manages the professionals (the admins and the assistant) gets a bell notification « Anniversaire : Prénom Nom ».
- [ ] Click « Exécuter maintenant » a second time. **Expected:** no second notification.
- [ ] Without clicking anything, the notice arrives on its own at **7 h** (clinic time) on the birthday.
- [ ] The professional herself gets no notification.

**Privacy**

- [ ] Her record → Historique: the change appears as « Date d'anniversaire », with the value hidden.

**Limit to know about:** staff cannot type a birthday directly on the record. It comes from the questionnaire. For professionals already active, collect it with « Demander une mise à jour » → Profil professionnel.

## F. 2. Approaches: checkboxes, counted, not on the fiche (#220)

> « …je veux les comptabiliser mais je ne veux pas les ajouter sur la fiche professionnelle. »

- [ ] Questionnaire → Portrait → « Approches »: **17** checkboxes in Jonathan's order, from « Approche cognitive et comportementale (TCC) » to « Autre — précisez ». Compare them word for word with his list.
- [ ] Check « Autre — précisez ». **Expected:** a « Précisez votre approche » field appears (200 characters at most).
- [ ] Check three approaches, save, reload the page. **Expected:** still checked. This is the fix in `31225839`: before it, the selections were lost.
- [ ] Check none. **Expected:** she can still finish (optional).
- [ ] Staff review sheet: **expected:** an « Approches » row listing the names (not codes), and « Approche — précision » when « Autre » is checked.
- [ ] After applying: the fiche PDF and the record's public-profile tab show **no** list of approaches. Only the free-text « Approche » remains, as before.
- [ ] Professionnels → « Approches » button (list header). **Expected:** each approach with its count of **active** professionals, the most common first. The page shows counts only, never names.
- [ ] Archive or deactivate one of the professionals who checked an approach. **Expected:** that approach's count drops by one.

**Limit to know about:** the seventeen names cannot be renamed, reordered or archived from a screen yet. That would need a tab in « Listes ». Say so if Jonathan expects to edit them.

## G. 3. Cheque specimen (#220)

> « …ajouter le spécimen de chèque au lieu de l'inscrire pour éviter les erreurs de frappe »

You chose to **keep** the three typed fields (they are encrypted) and to add the upload alongside them, so that the clinic can compare the two.

- [ ] Questionnaire → « Fiscalité et banque »: the three bank fields are still there, plus « Vous pouvez aussi joindre un spécimen de chèque… » and the link « Joindre un spécimen dans « Mes documents » ».
- [ ] Follow the link (as the professional). **Expected:** « Mes documents » lists « Spécimen de chèque », optional and with no expiry date.
- [ ] Upload a PDF, a JPEG and a PNG. **Expected:** accepted. A Word file or a file over 10 MB is refused.
- [ ] Staff: her record → Documents shows the specimen. Open it, compare it with the typed numbers and mark it verified.
- [ ] A profile **without** a specimen can still be activated (the specimen is not required).
- [ ] The existing clinic has the new type (not only clinics created later).

## H. Question: « est-ce que je peux le faire facilement ou je dois te contacter ? » (#220)

**Answer for Jonathan:** yes, he can do it himself: Paramètres → Professionnels → « Consignes du questionnaire ».

- [ ] The page lists every step, each with « Titre » and « Consigne », and shows the application's current text under each field.
- [ ] Reword one step's instructions and click « Enregistrer ». **Expected:** « Consigne enregistrée. », and the step is marked « Reformulé par la clinique ».
- [ ] Open the questionnaire as the test professional. **Expected:** the new wording on that step.
- [ ] Empty both fields and save. **Expected:** the application's original text comes back.
- [ ] Log in as the assistant (she manages the professionals but not their settings). **Expected:** the page can be read, but its fields are read-only.

**Limit to know about:** a step's title and instructions can be changed, but not the label of each individual field.

## What was checked automatically, and what was not

- CI ran the database tests (pgTAP: one file per new migration), the unit tests, the type and drift checks and the Playwright suite on both PRs. #219 is green. #220 was re-running at the time of writing.
- None of these screens was driven in a real browser against a database during development, because Docker is not available on this machine. **This checklist is their first end-to-end run.**
- Note anything that does not match, with the step and a screenshot. Each section maps to one PR, so fixes go back to that PR.
