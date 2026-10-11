# Plan de match — les prochains modules (2026-10-11)

**Pour :** Jonathan (à lire et à trancher). **Statut :** proposition, rien n'est construit.
**Sources :** [contexte d'affaires](../standards/business-context.md), [inventaire de l'ancienne app](2026-10-06-legacy-feature-inventory.md) (réf. « §B », « §C »… ci-dessous), [classeur d'accueil](../research/2026-10-08-intake-workbook.md), [doc du socle](../modules/core.md), [ce que publie Professionnels](../modules/professionals.md#what-the-module-publishes), et PS Hub (`../NEW PS Hub`, lu sans rien modifier ; preuves `chemin:ligne` entre parenthèses).
**Lecture :** termes d'écran en français, noms techniques en anglais. Tailles en jours-agent : **S** ≤ 3, **M** 4–8, **L** 9–15, **XL** 16 et plus.

---

## 0. Vue d'ensemble

### Ordre recommandé

| # | Module (écran) | Clé | Pourquoi à ce rang | Taille |
|---|---|---|---|---|
| 1 | **Services et tarifs** | `services` | Petit ; donne les durées à Rendez-vous et les lignes à Facturation ; les prix clients existent déjà dans les grilles de rétention | S–M |
| 2 | **Clients** | `clients` | Demande, rendez-vous, facture et courriel pointent tous vers un client | L |
| 3 | **Demandes** (accueil et jumelage) | `demandes` | Le cœur du métier ; remplace le classeur ; repose sur Professionnels et Clients | XL |
| 4 | **Communications** (courriels clients, modèles, IA) | `communications` | Voie B, dès que Clients est fusionné ; les conseillères écrivent aux clients dès la demande | L |
| 5 | **Rendez-vous** (agenda, disponibilités, rappels) | `appointments` | Remplace l'agenda de GOrendezvous ; donne les vraies plages au jumelage | XL |
| 6 | **Facturation et paiements** | `billing` | Bascule **en même temps** que Rendez-vous, sinon double saisie | XL |
| 7 | **SMS** (rappels) | dans `communications` | Parité avec les rappels de GOrendezvous ; avec ou juste après Rendez-vous | M |
| 8 | **Rapports** | `reports` | KPI du classeur, IVAC, revenus, paie | M |
| plus tard | Portail client, réservation en ligne, B2B (ateliers, PAE employeurs) | — | Après la sortie complète de GOrendezvous | — |

### Dépendances

- **Services et tarifs** → Professionnels (titres, grilles de rétention), socle (taxes datées).
- **Clients** → socle (adresses, fichiers, signature, courriel) ; Professionnels pour le professionnel principal.
- **Demandes** → Clients, Professionnels (`professionals_directory`, catalogues), Services et tarifs.
- **Communications** → Clients, socle (Resend, modèles, journal) ; Demandes et Rendez-vous y ajoutent leurs modèles.
- **Rendez-vous** → Clients, Professionnels, Services et tarifs, Communications (rappels) ; nourrit Demandes (plages, places restantes).
- **Facturation** → Rendez-vous, Clients, Services et tarifs, Professionnels (`get_professional_compensation`, déjà prévue).
- **Rapports** → tous, en lecture par vues publiées.

### Deux voies (processus allégé)

- **Voie A (données métier) :** Services et tarifs → Clients → Demandes → Rendez-vous + Facturation (bascule commune).
- **Voie B (communications) :** composeur + modèles + IA dès que Clients est fusionné, puis SMS, puis les modèles de Demandes et de Rendez-vous.
- Total estimé : **~105 à 130 jours-agent**, soit environ 2 à 3 mois à deux voies.

---

## 1. PS Hub en une table

| Domaine | Verdict | On prend | On laisse |
|---|---|---|---|
| Calendrier | **Adapter l'interface, construire le moteur** | Vues jour / semaine / mois / horaire, glisser-déposer, création au clic, synchro Google incrémentale | Pas de disponibilités, de réservation, de récurrence ni de rappels ; bogue d'heure d'été ; jetons Google en clair |
| Courriels | **Adapter** | Composeur unique (bureau et téléphone), TipTap, sélecteur de modèles, barre IA Accepter / Rejeter / Affiner, affichage HTML sûr | Double chemin Gmail / Resend, synchro Gmail, pixel d'ouverture, file d'approbation morte, failles de jetons |
| IA | **Reprendre l'idée, refaire la conception** | Persona québécoise, formules interdites, aperçu avant acceptation | OpenAI par défaut, données de clients dans l'invite, aucune limite ni journal de coût, « style d'écriture » appris des courriels |
| SMS | **Adapter** | Fils par numéro, interface boîte / fil / composeur, webhook signé | Centrale Yeastar propre à PS ; aucun STOP ni consentement |
| Contacts | **Adapter** | Doublons par identité (jamais le nom seul), fusion, frise d'activités | Recherche à six voies, écoutes Realtime de tables entières |
| Relances | **Adapter** | « Relances du jour » par urgence | Rappels de tâches jamais envoyés |
| Comptabilité | **Porter si besoin** | Connecteur QuickBooks Online | Factures SOMA, calculateur de devis |
| Transversal | **Ne pas copier** | — | Realtime `postgres_changes` sans reconnexion et écoutes mortes ; service worker qui garde les fichiers Storage 7 jours (`vite.config.ts:91-96`) ; déconnexion sur tout message contenant « session » (`src/App.tsx:123-135`) |

---

## 2. Les modules

### 2.1 Services et tarifs (`services`) — S–M

- **But :** une seule liste des services vendus (appel découverte, évaluation, rencontres 30 / 50 / 60 min, ouverture de dossier, annulation tardive, atelier) avec durée, taxes et source du prix, que Rendez-vous, Facturation, la fiche et l'Annexe A lisent tous.
- **Utilisateurs :** administration (modifie) ; conseillères, adjointe et professionnels (lisent).
- **Fonctionnalités :**
  - Garder (§H) : liste avec recherche, filtre actifs / archivés, tri, création, archivage, restauration ; durée, couleur, « toujours taxable » ; services offerts par titre de profession (ancien onglet « Services » du dossier, A2.17) ; aperçu taxes comprises.
  - Changer : clé choisie une fois, jamais modifiée ; **pas de copie des prix clients** : ils vivent dans les grilles de rétention de Professionnels (`retention_grid_prices`, datées), déjà lues par la fiche (`get_professional_public_fees`, P4-218) et l'Annexe A ; un service dit « prix selon la grille, 50 min » ou « prix fixe » ; taxes lues des taux datés du socle (`tax_rate_on`), plus de taux codés en dur ; plus de doublons de prix à chaque sauvegarde (§H « Broken »).
  - Nouveau : politique d'annulation (délai 24 h, pourcentage) et frais d'ouverture de dossier comme réglages datés ; modes vidéo et téléphone seulement.
  - Abandon proposé (ton OK requis) : modèles `by_profession_hourly_prorata` et `rule_cancellation_prorata` (inutilisés ou cassés, §H).
- **Repris de PS Hub :** rien (**construire**). Son catalogue est un calculateur de pergolas (`docs/plans/2025-01-07-calculator-database-design.md`).
- **Modèle de données :**
  - `services` : clé, nom, description, durée, `kind` (séance, appel, frais, atelier), `price_source` (`grid` / `fixed` / `free`), prix fixe, règle de taxe, couleur, actif.
  - `service_titles` : quels titres de profession offrent quel service.
  - `billing_policies` : délai et pourcentage d'annulation, frais d'ouverture, datés (`effective_from`).
  - Publie : `services_catalog` (vue), `get_service_price(service, title, on)`.
- **Intégrations :** socle (taxes datées, audit, réglages) ; Professionnels (titres, grilles).
- **IA :** aucune.
- **Dépendances :** Professionnels.
- **Taille :** S–M (4–6 jours).
- **Questions :** Q1, Q2.

### 2.2 Clients (`clients`) — L

- **But :** le dossier **administratif** du client (jamais clinique, D8) : identité, coordonnées, proches, payeur, consentements, et ses demandes, rendez-vous, factures et courriels.
- **Utilisateurs :** conseillères et adjointe ; professionnel (ses clients seulement, par `private.current_professional_id()`) ; Christine (accès et destruction, Loi 25).
- **Fonctionnalités :**
  - Garder (§B) : liste filtrable et triable, colonnes au choix, lien profond ; création en 4 sections avec adresse Google ; **détection des doublons** (algorithme §B : HIGH bloque, MEDIUM demande confirmation) ; relations (parent, enfant, conjoint, tuteur…, stockées une fois, lues des deux côtés) ; archivage ; numéro `CLI-` ; historique ; téléphones E.164 ; âge sur la date de naissance (date seule).
  - Changer : notes administratives et consentements enfin enregistrés, étiquettes sauvegardées, tuteur réglable (§B « Half-built ») ; recherche côté base ; RLS des relations avec permission (l'ancienne était ouverte à tous, §B) ; solde lu de Facturation, pas recalculé par déclencheur.
  - Nouveau : provenance « Comment avez-vous entendu parler de MANA ? » (liste du site) ; genre (règle « Femmes seulement », P4-245) ; langue ; **demande d'accès et de destruction** (export PDF, anonymisation, journalisées) ; fusion de doublons ; recherche ⌘K (`search_clients`).
- **Repris de PS Hub :** **adapter.**
  - Pris : rapprocher deux fiches par **identité (courriel, téléphone), jamais par le nom seul** (ADR `docs/adr/0033-identity-not-name-for-contact-account-dedup.md`, `supabase/functions/_shared/resolveContactAndAccount.ts`) ; fusion manuelle avec dialogue (`merge-contacts`, `MergeContactDialog.tsx`, `DuplicateContactDialog.tsx`) ; courriel et téléphone normalisés en colonnes, E.164 vérifié (`baseline.sql:17207-17222`) ; frise multicanal pour l'onglet « Historique » (`src/components/crm/conversation/ConversationTimeline.tsx`, `mapActivityToEvent.ts`).
  - Changé : fusion par RPC transactionnelle et auditée ; recherche par RPC définisseuse limitée aux colonnes affichées (comme `search_professionals`), pas le `global_search` à six voies qui a dû passer par une table d'index pour éviter le délai de 8 s (`20260716154829_global_search_reads_index.sql:1-30`).
  - Pas copié : écoutes Realtime de tables entières (`src/hooks/useCrmContacts.ts:122`, `useCrmCustomers.ts:178`).
- **Modèle de données :**
  - `clients` : identité, langue, naissance, genre, coordonnées, adresse, provenance, professionnel principal, étiquettes, archivé, `client_number`.
  - `client_relations` : paire ordonnée, type et inverse (règle §B).
  - `client_consents` : type, version du texte, signé le, expire le, fichier (Documenso du socle, comme le consentement des pros, P4-481).
  - `client_payers` : dossiers PAE et IVAC côté client ; la consommation vit dans Facturation.
  - Publie : `clients_directory`, `search_clients`, `get_client_summary(id)`.
- **Intégrations :** socle (`places`, fichiers, signature, courriel, audit avec rédaction des noms), Professionnels.
- **IA :** aucune.
- **Dépendances :** socle ; Professionnels.
- **Taille :** L (10–12 jours).
- **Questions :** Q3, Q4.

### 2.3 Demandes — accueil et jumelage (`demandes`) — XL

- **But :** le travail des conseillères : demande reçue → appel découverte → proposition d'un professionnel → premier rendez-vous confirmé, avec la promesse de rappel 24–48 h visible. Remplace le classeur ([recherche §8](../research/2026-10-08-intake-workbook.md#8-requirements-for-the-future-demandes-module)).
- **Utilisateurs :** conseillères ; adjointe (tableau des places) ; administration (statistiques) ; professionnel (demandes qui lui sont assignées, sans notes internes).
- **Fonctionnalités :**
  - Garder (§C) : formulaire d'accueil (type, motifs, besoin, enjeux, consultations antérieures, contexte légal, préférences d'horaire, urgence), participants avec principal, statut, `DEM-AAAA-NNNN`.
  - Garder (§D), selon **les 12 règles publiées par Professionnels** : clientèle et langue en filtres durs, âge minimum et « Femmes seulement », motifs qui notent sans exclure, assurance affichée, « Bon à savoir », places restantes calculées ici, suggestion mémorisée avec `updated_at`.
  - Changer : motifs lus du catalogue (fini les 12 clés codées, §C) ; fermeture qui fonctionne ; ordre des suggestions expliqué (score, places, nom).
  - Nouveau (classeur) : boîte des demandes (âge vs 24–48 h, « sans réponse » et prochaine tentative) ; saisie rapide en 20 s ; propositions (qui, quand, réponse) ; liste d'attente avec pro « pont » ; annulations de premier rendez-vous et raison ; tableau des places ; KPI.
  - Abandon proposé (ton OK requis) : `deterministic-scorer`, `holistic-classifier` (naturopathie) et l'interprète d'horaire par Claude **dans le navigateur, clé lue côté client** (`_legacy/src/recommendations/schedule-interpreter.ts:236`).
  - Lot ultérieur : formulaires du site qui créent la demande.
- **Repris de PS Hub :** **adapter des pièces, construire le cœur** (PS Hub n'a pas de jumelage).
  - Pris : entrée depuis un formulaire web (`supabase/functions/ingest-web-lead`, `upload-web-lead-files`) ; vue « Relances du jour » groupée par urgence avec actions en ligne (`docs/plans/2026-04-19-phase1-relances-du-jour-implementation.md`) pour les « sans réponse ».
  - Changé : la fonction publique prend une limite par IP **avant** toute écriture, plus un anti-robot ; celle de PS Hub dit « No auth required » sans limite (`ingest-web-lead/index.ts:7`).
  - Pas copié : les rappels de tâches jamais envoyés (`reminder_at` écrit, jamais lu : `src/hooks/useCrmTasks.ts:404`, `src/lib/inbox/eventTypeMeta.ts:79`).
- **Modèle de données :**
  - `demandes` : reçue le / par, canal, provenance, type, principal, payeur, motifs, langue, préférences, urgence, statut, `notes` (sensibles : permission propre, jamais dans un journal, une notification ou une invite IA).
  - `demande_participants` ; `demande_events` (chaque changement de statut horodaté, tentatives de rappel) ; `demande_propositions` (professionnel, par / le, réponse, instantané).
  - `first_appointment_cancellations`, `waiting_list_entries`, `capacity_snapshots` (photo du lundi par tâche planifiée).
  - Publie : `demandes_summary`, `get_places_remaining(professional)`.
- **Intégrations :** Professionnels, Clients, Services et tarifs, socle (notifications « demande en retard », tâches), Temps réel (§3.1).
- **IA :** **aucune au départ** : les notes d'accueil contiennent de l'information de santé (Q9).
- **Dépendances :** Clients, Professionnels, Services et tarifs ; plus tard Rendez-vous (d'ici là, `availability_periods`, P4-4).
- **Taille :** XL (18–22 jours) en deux lots : (a) boîte, accueil, propositions ; (b) jumelage, places, KPI.
- **Questions :** Q5, Q6, Q9.

### 2.4 Communications — courriels, modèles, IA (`communications`) — L

- **But :** écrire aux clients depuis l'app (suite à l'appel, envoi de la fiche, proposition, relance, liste d'attente), avec des modèles au ton MANA et une aide à la rédaction ; chaque envoi apparaît au dossier.
- **Utilisateurs :** conseillères ; adjointe ; administration (modèles, plafond IA) ; professionnels plus tard.
- **Fonctionnalités :**
  - Rien dans l'ancienne app (aucun courriel client) : **nouveau**, à parité avec GOrendezvous et avec ce qui s'écrit à la main aujourd'hui.
  - Composeur : destinataires parmi le client et ses proches, modèle, texte riche simple, pièces jointes PDF tirées des fichiers de l'app (fiche du pro), aperçu, délai d'annulation de 5 s, « Envoyer ».
  - Modèles : ceux du socle (versionnés, `{{ variables }}` vérifiées, espacement français), étendus aux courriels libres (catégorie ; modèle « clinique » ou « personnel »).
  - « Rédiger avec l'IA » (§2.4 ter).
  - Historique au dossier (`list_subject_emails`) et statut par `emailStatusLabel`.
  - Pas de pixel d'ouverture ; pas de boîte de réception au départ (§3.3).
- **Modèle de données :** l'envoi réutilise `email_log` du socle (sans corps) avec `subject_type = 'client'` ; `communication_templates` si le catalogue du socle ne suffit pas aux modèles personnels ; `ai_requests` (journal IA sans texte) et le réglage `ai_monthly_cap_cents`.
- **Intégrations :** socle (Resend, modèles, journal, webhooks, limites), Clients, Professionnels (`professionals-fiche`), Anthropic.
- **IA :** oui (§2.4 ter).
- **Dépendances :** Clients.
- **Taille :** L (10–12 jours) : composeur 5, modèles 2, IA 4–5.
- **Questions :** Q7, Q15, Q16.

#### 2.4 bis Ce que PS Hub apporte

- **Pris (la partie mûre, l'interface) :**
  - composeur monté une fois pour toute l'app, ancré sur bureau (`src/components/email/composer/ComposerShellDocked.tsx`, `useDockedComposer.ts`), plein écran sur téléphone (`MailComposeModal.tsx`), cœur partagé (`ComposerCore.tsx`, `useComposerState.ts`) ;
  - éditeur TipTap (`composer/RichEmailEditor.tsx:23-30`) et sélecteur de modèles (`TemplatePill.tsx:173-190`) ;
  - barre IA : aperçu avec **Accepter / Rejeter / Affiner**, annulation 10 s après acceptation (`src/components/email/AiQuickBar.tsx:133`, `:368-418`) ; réécriture d'une sélection (`RichSelectionAiBubble.tsx:94`) ;
  - affichage HTML sûr (iframe isolée + DOMPurify : `SafeEmailHtml.tsx:321`, `src/lib/email-sanitize.ts:228-260`) ;
  - délai d'annulation avant envoi (ADR `docs/adr/0063-client-side-email-outbox.md`) ;
  - idées d'invite : persona québécoise, **formules toutes faites interdites**, « seulement le texte final, sans signature » (`supabase/functions/ai-rewrite-email/prompts.ts:36-78`).
- **Changé :**
  - envoi par le **service du socle** (`sendTemplatedEmail`, statuts par webhook) au lieu du double chemin Gmail / Resend (`supabase/functions/_shared/email-router.ts:34-89`) ;
  - modèles versionnés, avec aperçu et variables vérifiées ; ceux de PS Hub : 4 variables par regex, sans version ni aperçu (`src/hooks/useCrmEmailTemplates.ts:243-264`) ;
  - pièces jointes par identifiant de fichier vérifié (règle P3-18), pas en base64, par chemin ou par URL arbitraire ; un envoi qui perd une pièce jointe **échoue** (PS Hub l'envoie sans : `gmail-send/index.ts:193-240`) ;
  - erreurs lues par code (`FunctionCallError.code`) ; chez PS Hub la reconnexion ne se déclenche jamais, le texte comparé étant générique (`src/hooks/useSmartSend.ts:110`, `:163`, `:175`).
- **Pas copié :**
  - **données de clients envoyées à OpenAI** : `gpt-4o` par défaut, Claude seulement avec un drapeau serveur (`ai-rewrite-email/index.ts:66-69`, `:147`, `:158`), téléphone, courriel et adresse dans l'invite (`prompts.ts:59-72`), aucune limite ni journal de coût (`index.ts:175-184`) ;
  - la fonction IA lit les coordonnées de n'importe quel dossier sans contrôle d'accès (`ai-rewrite-email/index.ts:89-91`, `:243-283`) ;
  - le **« style d'écriture » appris des courriels envoyés** (80 courriels envoyés à un modèle : `analyze-writing-style/index.ts:23-27` ; un extrait de 2 000 caractères de chaque envoi, données de clients comprises : `_shared/writing-style.ts:13`, `:39-97`) : incompatible avec la Loi 25 pour une clinique ;
  - résumés IA des courriels reçus (`crm-summarize-email`) ;
  - la synchro Gmail (16 fonctions `gmail-*`) et ses failles : jetons déchiffrés rendus pour n'importe quel utilisateur, sans contrôle ni `revoke` dans les migrations (`baseline.sql:8094-8148`), `state` OAuth non signé et redirection ouverte (`gmail-oauth/index.ts:35`, `:41`), URL externe récupérée sans liste blanche (`gmail-send/index.ts:204-205`), secret de webhook ignoré s'il manque (`gmail-webhook/index.ts:51-61`) ;
  - pixel d'ouverture (`gmail-send/index.ts:80-88`) ; file d'approbation morte (`send-approved-messages` n'existe pas : `send-crm-email/index.ts:747`) ;
  - Realtime sur `gmail_messages` qui pousse des lignes complètes, corps compris, sans reconnexion, avec des noms de canal partagés (`useGmailMessages.ts:201-212`, `useUnreadEmailCount.ts:24-31`).

#### 2.4 ter « Rédiger avec l'IA » : la proposition

- **Où :** fonction Edge `communications-draft`, catégorie **user** (`verifyAuth(req, { module: 'communications', permission: 'communications.ai_draft' })`). Clé `ANTHROPIC_API_KEY` en secret de fonction, jamais dans le navigateur.
- **Modèle :** **Claude Opus 5.5** (`claude-opus-5-5` : 4 $ / 20 $ par million de jetons en entrée / sortie, lecture de cache 0,20 $), effort `low`, réflexion adaptative (toujours active), `max_tokens` 2 000, repli serveur `fallbacks: "default"` (en-tête bêta `server-side-fallback-2026-07-01`). SDK `@anthropic-ai/sdk` dans `deno.json` **seulement si** son poids est acceptable (ADR 0008 : chaque paquet npm du verrou part dans chaque fonction) ; sinon un client `fetch` minimal dans `_shared/ai/`. Option moins chère : Haiku 5.5 (Q15) ; PS Hub note que Haiku donnait un français « à formules » (`ai-rewrite-email/index.ts:157`).
- **Entrées, au minimum :**
  - le **but** choisi dans une liste (confirmer un premier rendez-vous, relancer, envoyer la fiche, annoncer une liste d'attente, répondre à une question pratique) ;
  - la consigne de la conseillère (500 caractères au plus) et le modèle choisi ;
  - un **contexte construit par le serveur** à partir d'identifiants, par une RPC qui ne rend que des champs permis : prénom et titre du professionnel, date et heure formatées, service, délai de rappel, signature de la clinique.
  - **Jamais envoyé :** nom du client (le modèle écrit `{{ client.prenom }}`, rempli ensuite par le serveur), naissance, motifs, notes de demande, payeur, santé, NAS, adresse, téléphone, courriel. La consigne est vérifiée (courriel, téléphone, NAM, NAS) et refusée avec « Retirez les renseignements personnels de la consigne. »
  - Réponse à un courriel reçu : **pas au départ**.
- **Invite :** système fixe, mis en cache : ton MANA (contexte §6 : chaleureux, simple, vouvoiement, phrases courtes), français du Québec, typographie française ; interdits : conseil clinique, diagnostic, promesse de délai, de prix ou de professionnel absente du contexte, lien inventé ; consigne qui évoque une urgence ou une détresse → aucun brouillon, rappel de la procédure de la clinique. Sortie **structurée** (`output_config.format`) `{ subject, body, used_placeholders[] }`, validée par Zod ; une variable hors du modèle → refus.
- **Revue humaine :** le brouillon arrive dans le composeur, **jamais envoyé seul** ; la conseillère modifie et clique « Envoyer » ; `email_log` note `ai_assisted = true` (pas le texte).
- **Journal et coûts :** `ai_requests` (personne, fonctionnalité, modèle, jetons, coût estimé, statut, code d'erreur ; aucun texte) ; limites du socle : 30 brouillons par personne par heure, 300 par clinique par jour ; **plafond mensuel** par clinique (50 $ par défaut), avis important à 80 %, puis « Limite mensuelle atteinte » ; erreurs Anthropic par classes typées, jamais par texte. Coût attendu : ~3 000 jetons d'entrée (dont ~2 000 en cache) et ~600 de sortie ≈ **1 à 2 ¢ par brouillon**, 10 à 20 $ pour 1 000 brouillons.
- **Loi 25 et résidence :** l'API Anthropic traite aux États-Unis (`inference_geo` : `"us"` ou `"global"`, pas de Canada) ; AWS Bedrock en région canadienne est l'autre voie, à vérifier (modèles offerts à `ca-central-1`). Comme aucun renseignement de client n'est envoyé, l'EFVP (art. 17) est simple ; Anthropic s'ajoute aux sous-traitants de la politique de confidentialité ; demander la **rétention zéro** (ZDR) au compte de la clinique ; l'API n'entraîne pas les modèles sur nos données. Christine valide (Q16).

### 2.5 Rendez-vous — agenda, disponibilités, rappels (`appointments`) — XL

- **But :** remplacer l'agenda de GOrendezvous : les pros déclarent leurs disponibilités, les conseillères réservent le premier rendez-vous depuis la demande, les suivis se planifient (hebdo, aux deux semaines, mensuel), les rappels partent seuls, les annulations tardives vont à Facturation.
- **Utilisateurs :** professionnels (« Mon agenda », disponibilités) ; conseillères (réservent, déplacent) ; adjointe (vue d'ensemble, annulations) ; client (confirmations, rappels).
- **Fonctionnalités :**
  - Garder (§E) : vues semaine (puis jour, mois, liste) ; glisser pour créer un bloc, déplacer, redimensionner ; blocs disponible / pause / bloqué / vacances ; éditeur (participants, service, durée, statut créé → confirmé → terminé, ou annulé) ; annulation avec raison, frais si moins de 24 h ; « Client absent » ; lien profond ; occupations Google (freeBusy) ; journal.
  - Changer : **tout à l'heure de la clinique** (l'ancienne mélangeait navigateur et clinique, §E) ; contrôles **dans la base** (dans une disponibilité, service permis, aucun chevauchement par contrainte d'exclusion), jamais appelés dans l'ancienne ; « terminé » posé par une tâche planifiée ; occupations Google en lecture seule (l'ancienne les laissait déplacer).
  - Nouveau : **récurrence** (série hebdo ou aux deux semaines, avec exceptions) pour disponibilités et suivis ; **rappels** courriel J-1 puis SMS ; lien de visio par rendez-vous ; confirmation au client ; places restantes branchées sur les premiers rendez-vous confirmés (règle 11 de Professionnels) ; plages réelles pour le jumelage.
- **Repris de PS Hub :** **adapter l'interface, construire le moteur.** Son calendrier n'est pas un moteur de rendez-vous : c'est la liste de tâches CRM (`crm_tasks`), une copie du Google de chaque vendeur et les installations, dessinées par des vues maison. Aucune disponibilité, réservation, récurrence propre (Google déroulé en occurrences : `calendar-sync/index.ts:415`) ni rappel envoyé.
  - Pris : vues Jour / Semaine / Mois / « Horaire » 30 jours sans librairie (`src/pages/Calendar.tsx:63-110`) ; glisser-déposer par Pointer Events, aimanté aux 15 min, d'un jour à l'autre, position provisoire (`src/components/calendar/CalendarTimeGridView.tsx:225-312`, `:156-202`) ; création au clic (`:336-359`) ; avertissement de chevauchement (`CalendarEventDialog.tsx:222-237`) ; agenda d'un collègue pour un administrateur (ADR 0027, `Calendar.tsx:166-182`) → une conseillère voit l'agenda d'un pro ; synchro Google incrémentale par `syncToken`, repli complet au 410 (`supabase/functions/calendar-sync/index.ts:438-442`).
  - Changé : grille placée **à l'heure locale de la clinique** ; PS Hub place en minutes depuis minuit (`CalendarTimeGridView.tsx:100-110`), donc décale d'une heure les jours de changement d'heure, et affiche l'heure du navigateur (`src/hooks/useCalendarItems.ts:14-18`) ; période filtrée par **chevauchement**, pas par début (PS Hub perd les événements de plusieurs jours : `useCalendarItems.ts:216-217`) ; écritures par RPC en une transaction (PS Hub : deux appels, erreur du `delete` ignorée : `src/hooks/useCrmTasks.ts:612-636`) ; redimensionnement (absent) ; jetons Google **chiffrés** et illisibles du client (en clair chez PS Hub : `baseline.sql:21286-21301`) ; `state` OAuth signé et expirant (non signé : `google-calendar-oauth/index.ts:51`, `google-calendar-callback/index.ts:39-45`) ; déconnexion qui révoque chez Google (`useCalendarConnection.ts:105-111` ne fait que `is_active=false`).
  - Pas copié : la synchro qui lit encore `crm_tasks.google_event_id` alors que la poussée écrit dans `crm_task_assignees` (`calendar-sync/index.ts:324-329` vs `calendar-push-task/index.ts:565-580`) ; `action: "delete"` sans lien vérifié avec la tâche (`calendar-push-task/index.ts:800-806`) ; `reminder_at` jamais lu ; **le miroir complet du Google personnel visible des administrateurs** (`docs/adr/0027-admin-view-team-calendars.md:54-60`) : nos pros ont une pratique privée, on n'importe qu'**occupé / libre**, jamais un titre ni un participant.
- **Modèle de données :**
  - `availability_rules` (jour, heures **locales**, services permis, du … au …) et `availability_exceptions` (congé, bloc ponctuel).
  - `appointment_series` (règle simple : hebdo, aux deux semaines, mensuel ; jusqu'au ou nombre ; fuseau).
  - `appointments` (pro, service, début / fin `timestamptz`, mode, statut, série, annulation et frais, lien visio) avec contrainte d'exclusion `tstzrange` par pro sur les statuts actifs ; `appointment_participants`.
  - `calendar_connections` (jetons chiffrés, ADR 0004) et `external_busy_blocks` (lecture seule).
  - `appointment_reminders` (canal, prévu le, envoyé le, statut ; idempotent).
  - Publie : `get_open_slots(pro, from, to, service)`, `appointments_for_billing`, `first_appointments_confirmed`.
- **Intégrations :** socle (`runJob` pour rappels et « terminé », courriel, notifications), Communications (modèles, SMS), Google (freeBusy), visio (Q11).
- **IA :** aucune.
- **Dépendances :** Clients, Professionnels, Services et tarifs, Communications.
- **Taille :** XL (20–25 jours) en trois lots : (a) disponibilités, réservation, vues ; (b) récurrence, rappels ; (c) Google, visio.
- **Questions :** Q10, Q11, Q14.

### 2.6 Facturation et paiements (`billing`) — XL

- **But :** un reçu après chaque séance (assureur, crédit d'impôt), frais d'annulation, IVAC et PAE, paiements reçus, et **paie des pros** (prix client × (1 − rétention), déjà calculé par Professionnels).
- **Utilisateurs :** adjointe ; administration ; professionnel (ses reçus et sa paie, en lecture) ; client (reçu par courriel).
- **Fonctionnalités :**
  - Garder (§F, §G) : facture par rendez-vous, lignes, TPS et TVQ par ligne, statuts brouillon → en attente → partielle → payée / annulée, moyens de paiement, frais d'ouverture pour un nouveau client, frais d'annulation, IVAC (forfait), PAE (règles de couverture), rapport IVAC, numérotation.
  - Changer : taux datés du socle, mémorisés sur la facture ; couples facturés correctement (l'ancienne n'en facturait qu'un, §F) ; algorithme PAE enfin appelé (§G) ; total 0 n'est plus « annulé » ; reçu PDF **rendu sur le serveur** (pdfmake, ADR 0008) avec ordre et numéro de permis du pro.
  - Nouveau : lien de paiement sur le reçu, carte enregistrée pour les frais d'annulation ; relevé mensuel de paie par pro ; export comptable.
- **Repris de PS Hub :** **porter la comptabilité si besoin, construire la facturation.** Pris : le connecteur **QuickBooks Online** (`quickbooks-oauth`, `quickbooks-create-invoice/index.ts:363-523`, `sync-qbo-invoices`, `qbo-sync-cron`) si le comptable l'utilise (Q13), avec jetons chiffrés dans Vault et `runJob`. Pas copié : ni Stripe ni reçu de séance n'existent chez PS Hub ; factures SOMA et devis sont propres à Pergolas Signature.
- **Modèle de données :** `invoices`, `invoice_lines`, `payments`, `payer_allocations` (IVAC, PAE), séquence sans trou ; `professional_payouts` et lignes (instantané de la rétention, P4-151) ; `payment_provider_events`. Publie `client_balance(client)`, `billing_summary`.
- **Intégrations :** socle (taxes, fichiers, PDF serveur, courriel avec pièce jointe, webhooks), Professionnels, fournisseur de paiement (§3.5), QuickBooks (option).
- **IA :** aucune.
- **Dépendances :** Rendez-vous, Clients, Services et tarifs, Professionnels.
- **Taille :** XL (18–22 jours) ; paiement en ligne et QuickBooks en lot séparé.
- **Questions :** Q12, Q13, Q14.

### 2.7 SMS (dans `communications`) — M

- **But :** rappels par texto (parité GOrendezvous), puis réponses simples (« OUI » pour confirmer).
- **Utilisateurs :** clients ; conseillères (historique, écrire au besoin).
- **Fonctionnalités :** rappel J-1 ; confirmation ; **« ARRÊT » / « STOP »** ; consentement sur le client ; historique et fils par client.
- **Repris de PS Hub :** **adapter.** Pris : fils regroupés par les 10 derniers chiffres (`src/lib/sms/conversations.ts:1-40`) ; interface boîte / fil / composeur (`src/components/crm/sms/`) ; webhook entrant signé HMAC (`supabase/functions/yeastar-webhook/index.ts:874-895`) ; échecs journalisés aussi (`yeastar-send-sms/index.ts:187-214`). Changé : Twilio au lieu de la centrale Yeastar de Pergolas Signature ; webhook réclamé par `claim_webhook_event`. Pas copié : l'absence de STOP, de consentement et de modèles (seul un interrupteur `allow_sms` : `yeastar-send-sms/index.ts:85-93`).
- **Modèle de données :** `sms_messages` (direction, statut, corps effacé après 12 mois), `sms_consents` (accordé, retiré, source) ; modèles SMS dans le catalogue de modèles.
- **Intégrations :** Twilio, socle (limites, webhooks, tâches).
- **IA :** aucune.
- **Dépendances :** Clients, Rendez-vous.
- **Taille :** M (5–7 jours).
- **Questions :** Q8.

### 2.8 Rapports (`reports`) — M

- **But :** les chiffres que le classeur calcule mal (recherche §8.4) et ceux du comptable.
- **Utilisateurs :** administration ; conseillères (leurs chiffres).
- **Fonctionnalités :** demandes par semaine, canal, provenance, conseillère ; taux de confirmation (activité et cohorte) ; délais reçue → contact → proposition → confirmation ; places ; annulations de premier rendez-vous ; rapport IVAC avec export CSV (désactivé dans l'ancienne) ; revenus et paie.
- **Repris de PS Hub :** rien tel quel ; `analytics-ai` envoie des données d'affaires à un modèle, exclu pour une clinique.
- **Modèle de données :** aucune table ; vues publiées par chaque module et une RPC par rapport (permission d'abord).
- **IA :** aucune.
- **Dépendances :** Demandes, Rendez-vous, Facturation.
- **Taille :** M (5–8 jours).

### 2.9 Portail du professionnel (ajouts) et plus tard

- **Ajouts au fil des modules**, sous la permission `*.self` de chaque module : « Mes clients » (Clients), « Mes demandes » (assignées, sans notes internes), « Mon agenda » et « Mes disponibilités » (Rendez-vous), « Mes reçus » et « Ma paie » (Facturation). Pas de module à part.
- **Plus tard :** portail client (reçus, rendez-vous, consentements), réservation en ligne de l'appel découverte, B2B (ateliers, conférences, PAE employeurs). Rien de cela n'est dans l'ancienne app.

---

## 3. Décisions transversales à prendre tôt

### 3.1 Temps réel entre conseillères

- **Besoin :** deux conseillères ne rappellent pas le même client ni ne réservent la même plage ; la boîte des demandes et l'agenda se mettent à jour seuls.
- **PS Hub, à ne pas copier :** 43 abonnements, tous `postgres_changes`, aucun `broadcast` ; pas de reconnexion (seul `src/hooks/useThreeCX.ts:1049-1050` lit l'état) ; une dizaine d'écoutes sur des tables absentes de la publication, donc muettes (p. ex. `src/hooks/useCrmTasks.ts:157`, `src/hooks/useDrawingSlots.ts:194`) ; lignes complètes poussées au navigateur.
- **Recommandation :** un **canal privé `broadcast` par clinique** (`org:<id>`, autorisé par une politique RLS sur `realtime.messages` : membre actif et permission du module), alimenté par des déclencheurs qui n'envoient **que des identifiants** (`{module, table, id, op}`) ; le navigateur invalide la clé React Query et relit par RPC, donc avec ses propres droits. Reconnexion : au retour à `SUBSCRIBED`, tout invalider. Un seul hook du socle (`useOrgRealtime`), construit avec Demandes.
- **Indépendant du temps réel :** « Je m'en occupe » sur une demande (verrou doux, nom et heure) et la contrainte d'exclusion des rendez-vous. La cloche garde son interrogation (P3-24).

### 3.2 Fuseaux horaires de l'agenda (CLAUDE.md §9)

- **Une horloge : celle de la clinique** (`organizations.timezone`). Rendez-vous en `timestamptz` ; règles de disponibilité en **heure locale** avec le fuseau, déroulées en SQL (`at time zone`, `private.clinic_today()`), pour que « mardi 9 h » reste 9 h après le changement d'heure.
- **Grille** construite avec `toClinicTime` / `clinicTimeToUTC`, jamais en minutes depuis minuit.
- **Clients ailleurs** (Îles-de-la-Madeleine, Basse-Côte-Nord, en voyage) : courriels et SMS disent « 14 h, heure du Québec » ; un fuseau par client plus tard si besoin.
- **Tests** aux deux dimanches de changement d'heure pour chaque fonction de date de l'agenda.

### 3.3 Boîte de réception

- **Options :** (a) Gmail API (comme PS Hub) ; (b) boîte de la clinique hors de l'app, `reply-to` vers elle ; (c) réception par Resend (adresse entrante, webhook).
- **Recommandation : (b) au départ, (c) ensuite si utile, (a) seulement sur demande.** Les réponses de clients contiennent souvent de la santé : les copier dans l'app agrandit ce qu'il faut protéger (Loi 25), et la synchro Gmail est la partie la plus lourde et la plus fragile de PS Hub (§2.4 bis). Étape suivante possible : une adresse de réponse par fil (Resend entrant) qui rattache la réponse au client, avec conservation courte.

### 3.4 Fournisseur SMS

- **Recommandation : Twilio**, numéro canadien à 10 chiffres enregistré, rappels seulement au départ, consentement et « ARRÊT » obligatoires (LCAP), corps effacés après 12 mois. Autre choix : Telnyx (moins cher). La centrale Yeastar de PS Hub n'est pas réutilisable.

### 3.5 Fournisseur de paiement

- **Recommandation : Stripe** (Canada) : lien de paiement sur le reçu, carte enregistrée pour les frais d'annulation, webhook signé réclamé par `claim_webhook_event`. Virements Interac et chèques saisis à la main. PS Hub n'a pas de Stripe. À vérifier : ce que GOrendezvous utilise, pour ne pas changer les habitudes des clients.

### 3.6 Bascule hors de GOrendezvous

- Rendez-vous et Facturation **basculent ensemble**, un début de mois. Avant : import des clients et des rendez-vous futurs. GOrendezvous reste en lecture pour l'historique. Demandes peut vivre seul avant (il remplace le classeur, pas GOrendezvous).

### 3.7 Rappels pour tous les nouveaux modules

- RPC seulement, RLS par `current_permission_keys()`, manifeste et registre, `org_id` et audit partout (CLAUDE.md §5–6) ; courriel par `sendTemplatedEmail`, tâches par `runJob`, fichiers par `storage-sign`, signature par le socle.
- Pas de note clinique, motifs = étiquettes (D8) ; rien de sensible dans un journal, une notification ou une invite IA.
- Pas de cache de fichiers dans un service worker (PS Hub : `vite.config.ts:91-96`, non vidé à la déconnexion) ; erreurs d'authentification par code, jamais par texte (PS Hub déconnecte sur tout message contenant « session » : `src/App.tsx:123-135`).

---

## 4. Questions pour Jonathan (réponds « ok » ou corrige)

1. **Prix clients :** une seule source, les grilles de rétention de Professionnels ; Services et tarifs n'en garde pas de copie. *Reco : ok.*
2. **Abandons dans Services et tarifs :** les modèles « taux horaire au prorata » et « annulation au prorata » (inutilisés). *Reco : abandonner.*
3. **Clients de GOrendezvous :** importer les clients actifs et les rendez-vous futurs à la bascule, l'historique reste dans GOrendezvous. *Reco : oui ; peux-tu obtenir un export CSV ?*
4. **Ce qu'un pro voit :** les clients qu'il a eus en rendez-vous ou qui lui sont assignés, pas seulement ceux dont il est « professionnel principal ». *Reco : oui.*
5. **Formulaires du site → Demandes :** dans un lot après la v1 de Demandes, par une fonction publique limitée et anti-robot. *Reco : oui.*
6. **Les 7 questions du classeur** ([recherche §8.5](../research/2026-10-08-intake-workbook.md#85-open-questions-for-jonathan)) à trancher avant la conception de Demandes. *Reco :* place rendue automatiquement à l'annulation d'un premier rendez-vous ; une proposition retient la place 48 h ; exclusions affichées en note surlignée d'abord ; liste d'attente possible pour toute discipline.
7. **Boîte courriel :** pas de synchro de boîte au départ ; réponses vers la boîte de la clinique par `reply-to`. *Reco : ok ; quelle boîte (Google Workspace ou Outlook) ?*
8. **SMS :** Twilio, rappels J-1 seulement, consentement demandé à l'accueil. *Reco : ok.*
9. **IA dans Demandes et le jumelage :** aucune pour l'instant (santé dans les notes). *Reco : ok, on en reparle après six mois de données.*
10. **Google Calendar des pros :** lecture occupé / libre seulement, rien n'est écrit chez Google. *Reco : ok ; un flux ICS anonyme (« Rendez-vous MANA ») plus tard si les pros le demandent.*
11. **Visio :** quelle plateforme ? *Reco : au départ, le lien fixe de chaque pro (sa salle Zoom Santé, Teams ou Doxy.me) sur son profil, copié dans chaque rendez-vous ; un lien généré par l'app plus tard.*
12. **Paiement en ligne :** Stripe. *Reco : ok, après avoir vérifié ce que GOrendezvous utilise.*
13. **Comptabilité :** le comptable utilise-t-il QuickBooks Online ? *Reco : si oui, porter le connecteur de PS Hub (sécurisé) ; sinon export CSV mensuel.*
14. **Bascule :** Rendez-vous et Facturation ensemble, un début de mois, GOrendezvous en lecture ensuite. *Reco : ok.*
15. **Modèle IA :** Claude Opus 5.5 à effort bas (≈ 1–2 ¢ par brouillon). *Reco : ok ; Haiku 5.5 seulement si le coût devient un sujet.*
16. **Données envoyées à l'IA :** aucun nom ni renseignement de client (variables remplies après), traitement aux États-Unis, rétention zéro demandée, EFVP et politique mises à jour par Christine. *Reco : ok.*
17. **Ordre :** Services et tarifs → Clients → Demandes, Communications en voie B dès Clients, puis Rendez-vous + Facturation ensemble, SMS, Rapports. *Reco : ok.*
18. **Abandons venus de l'ancienne app :** `deterministic-scorer`, `holistic-classifier` et l'interprète d'horaire par IA. *Reco : abandonner.*
19. **Portail client et réservation en ligne :** après la bascule. *Reco : ok.*

---

## 5. Prochaine étape : la conception de Services et tarifs

Un document `docs/plans/2026-10-xx-services-module-design.md`, court, qui couvre :

1. **Inventaire §H, marqué Keep / Change / Drop** (CLAUDE.md §5 ; un Drop attend ton OK). Proposition de départ :

| Élément (§H) | Marque | Comment |
|---|---|---|
| Liste : recherche, filtre, tri, groupes, créer, modifier, archiver, restaurer | Keep | Page de Paramètres, `SettingsCard` |
| Champs : nom, description, durée, couleur, « toujours taxable », consentement requis | Keep | Clé choisie une fois, unique, jamais modifiée |
| Clé dérivée du nom sans gestion des doublons | Change | Saisie, vérifiée en base |
| Tarifs par catégorie de profession (« Offert », prix, taxable, taux horaire) | Change | « Offert » → `service_titles` ; prix → grilles de rétention ; aperçu taxes comprises gardé |
| Modèles de prix `fixed`, `by_profession_category` | Change | `price_source` `fixed` / `grid` / `free` |
| Modèles `by_profession_hourly_prorata`, `rule_cancellation_prorata` | Drop | Q2 |
| Catégories taxables (naturopathie, coaching) | Change | Règle de taxe par service ou par titre, taux du socle |
| Prix de départ (30 / 50 / 60 min par catégorie) | Drop ici | Déjà dans les grilles (P4-180 et suivantes) |
| 12 services de départ (dont Appel découverte 0 $, Ouverture de dossier 43,49 $ taxable) | Keep | Rangées de départ, libellés relus |
| Services par titre de profession (A2.17) | Keep | `service_titles` |
| Écriture admin / staff | Change | `services.manage` ; lecture `services.view` |
| Doublons de prix, taux horaire ignoré, taxes codées en dur | Corrigé | Contraintes, `tax_rate_on` |

2. **Le contrat publié** pour Rendez-vous et Facturation : `services_catalog`, `get_service_price(service, title, on)`, `billing_policies` en vigueur.
3. **Permissions et rôles** par défaut, section de Paramètres (`id` anglais, chemin français « services-et-tarifs »).
4. **Tests :** pgTAP (droits, RLS, RPC, prix à une date), unitaires, un parcours Playwright ; `docs/modules/services.md`.
5. **Points ouverts** : réponses à Q1, Q2 ; libellé de la ligne 60 min de l'Annexe A (question 20 du statut).
