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
| 4 | **Communications** (boîte Gmail, courriels clients, modèles, IA) | `communications` | Voie B, dès que Clients est fusionné ; Gmail branché (`info@` d'abord) ; les conseillères écrivent aux clients dès la demande | XL |
| 5 | **Rendez-vous** (agenda, disponibilités, rappels par courriel, visio Meet / Zoom) | `appointments` | Remplace l'agenda de GOrendezvous ; donne les vraies plages au jumelage | XL |
| 6 | **Facturation et paiements** (+ QuickBooks Online) | `billing` | Bascule **en même temps** que Rendez-vous, sinon double saisie | XL |
| 7 | **Importation GOrendezvous** (étape à part) | — | Essais à blanc dès Clients ; import final juste avant la bascule de Rendez-vous + Facturation | M–L |
| 8 | **Rapports** | `reports` | KPI du classeur, IVAC, revenus, paie | M |
| plus tard | **SMS** (décidé : « on garde pour le futur »), portail client, réservation en ligne, B2B (ateliers, PAE employeurs) | — | Après la sortie complète de GOrendezvous | — |

**Réponses de Jonathan (2026-10-11) intégrées :** IA par OpenAI comme PS Hub ; Gmail branché (`info@cliniquemana.com` pour les essais) ; visio Zoom et Google Meet ; QuickBooks Online oui ; GOrendezvous : tout importer ; SMS plus tard.

### Dépendances

- **Services et tarifs** → Professionnels (titres, grilles de rétention), socle (taxes datées).
- **Clients** → socle (adresses, fichiers, signature, courriel) ; Professionnels pour le professionnel principal.
- **Demandes** → Clients, Professionnels (`professionals_directory`, catalogues), Services et tarifs.
- **Communications** → Clients, socle (Resend, modèles, journal, webhooks, `runJob`), Google (Gmail API), OpenAI ; Demandes et Rendez-vous y ajoutent leurs modèles.
- **Rendez-vous** → Clients, Professionnels, Services et tarifs, socle (courriel de rappel), Google (Meet) ; nourrit Demandes (plages, places restantes).
- **Facturation** → Rendez-vous, Clients, Services et tarifs, Professionnels (`get_professional_compensation`, déjà prévue), QuickBooks Online.
- **Importation GOrendezvous** → les tables de Clients, Rendez-vous, Facturation et Services et tarifs.
- **Rapports** → tous, en lecture par vues publiées.

### Deux voies (processus allégé)

- **Voie A (données métier) :** Services et tarifs → Clients → Demandes → Rendez-vous + Facturation (bascule commune, précédée de l'import final de GOrendezvous).
- **Voie B (communications) :** dès que Clients est fusionné : (a) branchement Gmail, synchro, boîte ; (b) composeur, modèles, IA ; puis les modèles de Demandes et de Rendez-vous ; puis les essais à blanc de l'import.
- Total estimé : **~125 à 150 jours-agent** (au lieu de 105–130 : Gmail +12–15, visio +3–4, QuickBooks +5–7, import +7–10, SMS retiré −6), soit environ 3 mois à deux voies.

---

## 1. PS Hub en une table

| Domaine | Verdict | On prend | On laisse |
|---|---|---|---|
| Calendrier | **Adapter l'interface, construire le moteur** | Vues jour / semaine / mois / horaire, glisser-déposer, création au clic, synchro Google incrémentale | Pas de disponibilités, de réservation, de récurrence ni de rappels ; bogue d'heure d'été ; jetons Google en clair |
| Courriels | **Porter (Gmail), failles corrigées** | Synchro Gmail incrémentale, rattachement aux dossiers, boîte, composeur unique (bureau et téléphone), TipTap, modèles, affichage HTML sûr | Jetons déchiffrés rendus sans contrôle, `state` non signé, URL externes, pièces jointes d'une autre organisation, webhook sans secret, pixel d'ouverture |
| IA | **Porter (OpenAI, Chat Completions), avec nos garde-fous** | SDK `openai`, modèle en variable, invite (persona québécoise, formules interdites), Accepter / Rejeter / Affiner | Données de clients dans l'invite, lecture de n'importe quel dossier, aucune limite ni journal de coût, « style d'écriture » appris des courriels |
| Visio | **Porter** | Création de Meet par l'API Calendar avec `requestId` stable | — |
| SMS | **Plus tard** | Fils par numéro, interface boîte / fil / composeur, webhook signé | Centrale Yeastar propre à PS ; aucun STOP ni consentement |
| Contacts | **Adapter** | Doublons par identité (jamais le nom seul), fusion, frise d'activités | Recherche à six voies, écoutes Realtime de tables entières |
| Relances | **Adapter** | « Relances du jour » par urgence | Rappels de tâches jamais envoyés |
| Comptabilité | **Porter (décidé), failles corrigées** | Connecteur QuickBooks Online | Jetons en clair, `state` non signé, tâche appelée avec la clé `service_role` ; factures SOMA, devis |
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
- **Questions :** 1, 2.

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
- **Questions :** 3 ; import de GOrendezvous : §2.7.

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
- **IA :** **aucune au départ** : les notes d'accueil contiennent de l'information de santé (question 6).
- **Dépendances :** Clients, Professionnels, Services et tarifs ; plus tard Rendez-vous (d'ici là, `availability_periods`, P4-4).
- **Taille :** XL (18–22 jours) en deux lots : (a) boîte, accueil, propositions ; (b) jumelage, places, KPI.
- **Questions :** 4, 5, 6.

### 2.4 Communications — boîte Gmail, courriels, modèles, IA (`communications`) — XL

- **But :** que les conseillères lisent et répondent aux courriels des clients **dans l'app** (boîte Gmail de la clinique, fils rattachés au dossier), écrivent avec des modèles au ton MANA et une aide à la rédaction, et que chaque échange apparaisse au dossier du client. **Décidé (Jonathan, 2026-10-11) :** Gmail est branché, en commençant par `info@cliniquemana.com` pour les essais ; Resend reste pour les courriels transactionnels (invitations, rappels, avis).
- **Utilisateurs :** conseillères (principales) ; adjointe ; administration (branche les boîtes, modèles, plafond IA) ; professionnels plus tard.
- **Fonctionnalités :**
  - Rien dans l'ancienne app (aucun courriel client) : **nouveau**, à parité avec GOrendezvous et avec ce qui se fait aujourd'hui dans Gmail.
  - **Boîte « Courriels »** : liste des fils, lu / non lu, archiver, étiquettes, recherche ; fil complet ; pièces jointes reçues copiées dans notre stockage.
  - **Rattachement** de chaque fil à un client par **identité** (courriel connu ; règle de doublons de Clients) ; plusieurs correspondances ou aucune → file « À rattacher » ; rattachement manuel ; le fil apparaît au dossier client et dans la demande.
  - **Composeur** : répondre dans le fil ou écrire, envoyé **depuis Gmail** (le message est dans « Envoyés » de la boîte et garde le fil) ; destinataires parmi le client et ses proches ; modèle ; pièces jointes tirées des fichiers de l'app (fiche du pro) ; délai d'annulation de 5 s.
  - **Modèles** : ceux du socle (versionnés, `{{ variables }}` vérifiées, espacement français), étendus aux courriels libres (catégorie ; « clinique » ou « personnel »).
  - « Rédiger avec l'IA » (§2.4 ter).
  - Pas de pixel d'ouverture ; pas d'IA sur les courriels reçus.
- **Une boîte partagée ou une par conseillère ? Recommandation : la boîte partagée `info@` d'abord**, branchée une fois par l'administration, lue et utilisée par toutes les conseillères (c'est là que les clients écrivent ; une réponse reste visible des collègues) ; **les boîtes personnelles ensuite**, si les conseillères ont des adresses `@cliniquemana.com` et le demandent, chacune branchée par sa propriétaire et visible d'elle seule (plus les permissions données). Le modèle de données gère les deux dès le départ (`kind = shared | personal`). Pas de délégation à l'échelle du domaine (un compte de service qui lirait toutes les boîtes) : trop large.
- **Repris de PS Hub :** voir §2.4 bis.
- **Modèle de données :**
  - `mail_connections` : adresse, `kind` (`shared` / `personal`), propriétaire, état, portées accordées, `history_id`, échéance de la surveillance Gmail ; **jetons chiffrés** avec version de clé (règle PII, ADR 0004), dans une table sans aucun droit client.
  - `mail_threads` : fil Gmail, sujet, dernier message, nombre, non lus, client rattaché, état de rattachement (résumé tenu par la base, pas recalculé dans le navigateur).
  - `mail_messages` : identifiant Gmail, fil, expéditeur, destinataires, date, extrait, étiquettes, lu ; corps conservé **24 mois** puis effacé (Loi 25, à confirmer par Christine).
  - `mail_attachments` → `stored_files` (objectif d'upload propre au module, permission du module).
  - `mail_sync_state` (verrou à bail, dernier passage, erreur en code) ; `mail_actions` (archiver, lire, étiqueter, en file).
  - `email_log` du socle pour Resend (sans corps) ; `ai_requests` (journal IA sans texte) et réglage `ai_monthly_cap_cents`.
  - Permissions : `communications.inbox` (lire la boîte partagée), `communications.send`, `communications.mailboxes_manage` (brancher, débrancher), `communications.ai_draft`.
- **Intégrations :** Gmail API (OAuth Google, notifications Pub/Sub), socle (Resend, modèles, journal, webhooks réclamés, limites, `runJob`, fichiers), Clients, Professionnels (`professionals-fiche`), OpenAI (IA).
- **Fonctions Edge (catégories de CLAUDE.md §7) :** `gmail-connect` et `gmail-callback` (user, `communications.mailboxes_manage`) ; `gmail-webhook` (webhook) ; `gmail-sync` (job `communications.gmail_sync` et après chaque notification) et `gmail-watch-renew` (job) ; `gmail-send`, `gmail-modify` (user) ; `communications-draft` (user, IA).
- **IA :** oui (§2.4 ter).
- **Dépendances :** Clients.
- **Taille :** **XL (22–27 jours)**, au lieu de L : synchro Gmail et boîte 12–15, composeur 5, modèles 2, IA 3–4. En voie B, en deux lots : (a) branchement, synchro, boîte, rattachement ; (b) composeur, envoi Gmail, modèles, IA.
- **Questions :** 11, 14, 15, 16.

#### 2.4 bis Ce que PS Hub apporte, et les failles corrigées

- **Pris :**
  - synchro incrémentale par l'historique Gmail, repli complet au 404 / 410 (`supabase/functions/gmail-sync/index.ts:1137-1180`, `:1166`), premier passage limité (45 jours chez PS Hub : `:1067-1071`), verrou à bail contre deux synchros en même temps (`:80-110`), passe de rattrapage lancée par la tâche de renouvellement (`:1266-1272`) ;
  - surveillance Gmail par Pub/Sub, renouvelée par tâche (`gmail-webhook/index.ts:116-141`, `gmail-watch-renew`) ;
  - rattachement automatique : d'abord un autre message du fil déjà rattaché, puis l'expéditeur connu ; une seule correspondance → rattaché, plusieurs → à revoir ; adresses génériques et internes exclues (`gmail-sync/index.ts:578-809`) ; rattachement manuel (`gmail-link-email/index.ts:43-94`) ;
  - actions archiver / lire / étiqueter par lot avec mise à jour optimiste et annulation (`gmail-modify-message/index.ts:85`, `:227`, `:257` ; `src/hooks/useGmailActions.ts:103-221`) ;
  - composeur monté une fois pour toute l'app, ancré sur bureau (`src/components/email/composer/ComposerShellDocked.tsx`, `useDockedComposer.ts`), plein écran sur téléphone (`MailComposeModal.tsx`), cœur partagé (`ComposerCore.tsx`, `useComposerState.ts`) ; éditeur TipTap (`composer/RichEmailEditor.tsx:23-30`) ; sélecteur de modèles (`TemplatePill.tsx:173-190`) ; délai d'annulation avant envoi (ADR `docs/adr/0063-client-side-email-outbox.md`) ;
  - boîte en trois volets (`src/pages/Courriels.tsx`) et affichage HTML sûr, iframe isolée + DOMPurify (`SafeEmailHtml.tsx:321`, `src/lib/email-sanitize.ts:228-260`) ;
  - construction MIME (`supabase/functions/_shared/mime-builder.ts`).
- **Failles de PS Hub, et ce qu'on fait à la place :**
  - **Jetons :** `get_gmail_tokens(p_user_id)` rend les jetons **déchiffrés** de n'importe quel utilisateur, sans contrôle d'appelant ni `revoke` dans les migrations (`baseline.sql:8094-8148`). → Jetons chiffrés (pgcrypto, clé dans Vault, version de clé, comme le NAS et le numéro de compte) ; lus **seulement** par une RPC `service_role` appelée par les fonctions ; `revoke all … from anon, authenticated` ; jamais rendus au navigateur, ni à leur propriétaire. Les jetons Calendar en clair de PS Hub (`gmail-callback/index.ts:190-194`) n'existent pas ici.
  - **RPC :** les tables sont lues et écrites directement depuis le navigateur (`useGmailMessages.ts:21`). → Lecture par RPC ou vues gardées par RLS (`communications.inbox`), écriture par RPC définisseuse, permission vérifiée en premier, `search_path = ''` ; une boîte personnelle n'est visible que de sa propriétaire (PS Hub laisse `see_all_opportunities` lire toutes les boîtes : `baseline.sql:32393-32397`).
  - **OAuth :** `state` en base64 non signé et `origin` fourni par le client qui devient la redirection (`gmail-oauth/index.ts:35`, `:41` ; `gmail-callback/index.ts:39-41`, `:255`). → `state` signé HMAC (personne, boîte, nonce à usage unique, expiration 10 min), vérifié avant tout échange de code ; retour **toujours** vers `APP_URL` + un chemin fixe ; `postMessage` vers notre origine seulement, origine vérifiée à l'écoute (PS Hub : `"*"`, `GmailOAuthReturn.tsx:27-32`).
  - **URL externes :** `external_url` récupérée par le serveur sans liste blanche (`gmail-send/index.ts:204-205`). → Supprimé : aucune pièce jointe par URL.
  - **Pièces jointes :** chemins de stockage téléchargés en service role sans contrôle d'organisation (`gmail-send/index.ts:214-217`) ; pièces perdues en silence (`:193-240`). → Seulement des `stored_files` de la même clinique, lus par la règle de `storage-sign` (la RLS de l'appelant décide) ; une pièce introuvable fait **échouer** l'envoi.
  - **Webhook :** secret ignoré s'il manque (`gmail-webhook/index.ts:51-61`), adresse cherchée par `ilike` (`:95`), synchro lancée sans `waitUntil` (`:118`). → Secret **obligatoire** (ou jeton OIDC de Pub/Sub vérifié), sinon 503 ; limite par IP d'abord ; réclamation par `claim_webhook_event` ; adresse comparée exactement ; synchro par tâche, pas en tâche de fond perdue.
  - **Autres :** reconnexion jamais détectée (texte générique comparé : `src/hooks/useSmartSend.ts:110`, `:163`) → codes d'erreur ; rattachement limité à 10 messages, le reste jamais rattaché (`gmail-sync/index.ts:626-637`) → reprise par la tâche ; destinataires « À » devenus « Cc » (`buildSendPayload.ts:54-56`) ; Realtime qui pousse des lignes complètes, corps compris, sans reconnexion, noms de canal partagés (`useGmailMessages.ts:201-212`, `useUnreadEmailCount.ts:24-31`) → canal par clinique avec identifiants seulement (§3.1) ; images en ligne dans un compartiment **public** (`20260619140336_email_inline_images_bucket.sql:24-26`) → compartiment privé.
- **Portées Google demandées :** `gmail.modify` et `gmail.send` seulement (PS Hub ajoute `settings.basic` et `calendar.events` sur le même consentement : `gmail-oauth/index.ts:53-71`, ADR 0015). Application OAuth **« Interne »** au Google Workspace de la clinique : pas de vérification Google requise.
- **Pas copié :** le double chemin Gmail / Resend pour un même message (`_shared/email-router.ts:34-89`) : ici Gmail pour la conversation, Resend pour le transactionnel ; le pixel d'ouverture (`gmail-send/index.ts:80-88`) ; la file d'approbation morte (`send-crm-email/index.ts:747`) ; le « style d'écriture » appris des courriels envoyés (`analyze-writing-style/index.ts:23-27`, `_shared/writing-style.ts:39-97`) ; les résumés IA des courriels reçus (`crm-summarize-email`).

#### 2.4 ter « Rédiger avec l'IA » : OpenAI, comme PS Hub, avec nos garde-fous

- **Décidé (Jonathan, 2026-10-11) :** OpenAI, comme PS Hub.
- **Ce que fait PS Hub :** fonction `ai-rewrite-email`, SDK npm `openai` (`index.ts:21`, `:110`), API **Chat Completions** (`openai.chat.completions.create`, `:146-153`), modèle `AI_REWRITE_OPENAI_MODEL` sinon **`gpt-4o`** (`:147`) ; OpenAI est le chemin par défaut, Anthropic seulement avec un drapeau serveur (`:63-69`) ; `max_tokens` 3 072 (réponse complète) ou 1 024 (réécriture), pas de flux (`:147-148`). Deux modes : réécrire une sélection, rédiger une réponse complète avec un historique d'au plus 20 tours (`:220-233`). Invite système (`prompts.ts:36-78`) : persona en français du Québec, **formules toutes faites interdites**, « seulement le texte final, sans signature », ligne « Objet : » seulement si le sujet est vide. Interface : aperçu du brouillon avec **Accepter / Rejeter / Affiner**, annulation 10 s après acceptation (`src/components/email/AiQuickBar.tsx:133`, `:368-418`) ; bulle de réécriture d'une sélection (`RichSelectionAiBubble.tsx:94`).
- **Repris tel quel :** l'API Chat Completions et le SDK `openai`, le modèle en variable d'environnement, les deux modes, l'invite (persona, formules interdites, texte final sans signature), la barre Accepter / Rejeter / Affiner et la bulle de sélection.
- **Nos garde-fous (ce que PS Hub n'a pas) :**
  - **fonction Edge seulement**, catégorie user : `communications-draft`, `verifyAuth(req, { module: 'communications', permission: 'communications.ai_draft' })` ; clé `OPENAI_API_KEY` en **secret de fonction**, jamais dans le navigateur ;
  - **aucun nom ni renseignement de client** : PS Hub met téléphone, courriel et adresse dans l'invite et interdit les variables (`prompts.ts:59-72`), et lit les coordonnées de n'importe quel dossier sans contrôle (`index.ts:89-91`, `:243-283`). Ici, le modèle écrit `{{ client.prenom }}`, rempli **ensuite par le serveur** ; le contexte est construit par le serveur à partir d'identifiants, par une RPC qui vérifie la permission et ne rend que des champs permis (prénom et titre du pro, date et heure formatées, service, signature de la clinique) ;
  - **aucune donnée clinique** : jamais de motifs, notes de demande, payeur, santé ; la consigne de la conseillère (500 caractères) est vérifiée (courriel, téléphone, NAM, NAS) et refusée sinon ; en mode « réponse », le message du client cité est d'abord **nettoyé** (adresses, numéros, signature retirés) et limité, et la conseillère voit ce qui part (« Texte envoyé à l'IA ») ;
  - invite : nos interdits ajoutés (conseil clinique, diagnostic, promesse de délai, de prix ou de professionnel absente du contexte, lien inventé ; consigne qui évoque une urgence → aucun brouillon, rappel de la procédure de la clinique) ; sortie **en JSON selon un schéma** (`{ subject, body, used_placeholders }`), validée par Zod ;
  - **revue humaine toujours** : le brouillon arrive dans le composeur, jamais envoyé seul ; `ai_assisted = true` noté sur l'envoi, pas le texte ;
  - **limites et plafond** : 30 brouillons par personne par heure, 300 par clinique par jour (`consume_rate_limit`), plafond mensuel par clinique (50 $ par défaut, avis à 80 %, puis « Limite mensuelle atteinte ») ; `ai_requests` journalise jetons, coût estimé et code d'erreur, jamais de texte ; erreurs OpenAI par statut et code, jamais par texte (PS Hub compare le message pour le 429 : `index.ts:175-184`).
- **Coût par brouillon** (tarifs publiés sur developers.openai.com/api/docs/pricing, lus le 2026-10-11, **à revérifier avant la mise en service**), pour ~3 000 jetons d'entrée dont ~2 000 en cache et ~600 de sortie :

| Modèle | Entrée / cache / sortie (par million) | Par brouillon | 1 000 brouillons |
|---|---|---|---|
| `gpt-4o` (celui de PS Hub) | 2,50 $ / 1,25 $ / 10,00 $ | ≈ 1,1 ¢ | ≈ 11 $ |
| `gpt-5.4` | 2,50 $ / 0,25 $ / 15,00 $ | ≈ 1,2 ¢ (plus si le modèle raisonne) | ≈ 12–25 $ |
| `gpt-5.4-mini` | 0,75 $ / 0,075 $ / 4,50 $ | ≈ 0,4 ¢ | ≈ 4 $ |

  Le traitement régional (projet canadien) ajoute 10 % pour les modèles sortis depuis le 5 mars 2026. Recommandation : `gpt-5.4` par défaut, après un essai de 20 brouillons contre `gpt-4o` et `gpt-5.4-mini` (question 15).
- **Loi 25 avec OpenAI :**
  - les données **quittent le Québec** ; OpenAI offre la résidence des données **au Canada** pour un projet API admissible (données au repos ; l'inférence au Canada **n'est pas confirmée**) : créer le projet dans la région Canada si le compte y est admis ;
  - demander la **rétention zéro** (ZDR) pour le projet, ou à défaut confirmer par écrit que les données de l'API ne servent pas à l'entraînement (c'est le régime par défaut de l'API) et la durée de conservation pour la surveillance des abus ;
  - **EFVP** (art. 17) mise à jour par Christine, et OpenAI ajouté aux sous-traitants de la politique de confidentialité ; comme aucun renseignement de client n'est envoyé, l'analyse reste simple (question 11).
- **Taille :** 3–4 jours (le SDK `openai` alourdit chaque fonction, ADR 0008 : à mesurer ; sinon un client `fetch` minimal dans `_shared/ai/`).

### 2.5 Rendez-vous — agenda, disponibilités, rappels (`appointments`) — XL

- **But :** remplacer l'agenda de GOrendezvous : les pros déclarent leurs disponibilités, les conseillères réservent le premier rendez-vous depuis la demande, les suivis se planifient (hebdo, aux deux semaines, mensuel), les rappels partent seuls, les annulations tardives vont à Facturation.
- **Utilisateurs :** professionnels (« Mon agenda », disponibilités) ; conseillères (réservent, déplacent) ; adjointe (vue d'ensemble, annulations) ; client (confirmations, rappels).
- **Fonctionnalités :**
  - Garder (§E) : vues semaine (puis jour, mois, liste) ; glisser pour créer un bloc, déplacer, redimensionner ; blocs disponible / pause / bloqué / vacances ; éditeur (participants, service, durée, statut créé → confirmé → terminé, ou annulé) ; annulation avec raison, frais si moins de 24 h ; « Client absent » ; lien profond ; occupations Google (freeBusy) ; journal.
  - Changer : **tout à l'heure de la clinique** (l'ancienne mélangeait navigateur et clinique, §E) ; contrôles **dans la base** (dans une disponibilité, service permis, aucun chevauchement par contrainte d'exclusion), jamais appelés dans l'ancienne ; « terminé » posé par une tâche planifiée ; occupations Google en lecture seule (l'ancienne les laissait déplacer).
  - Nouveau : **récurrence** (série hebdo ou aux deux semaines, avec exceptions) pour disponibilités et suivis ; **rappels par courriel seulement pour l'instant** (J-1, par Resend et un modèle du socle ; le SMS est remis à plus tard, §2.9) ; lien de visio par rendez-vous (ci-dessous) ; confirmation au client ; places restantes branchées sur les premiers rendez-vous confirmés (règle 11 de Professionnels) ; plages réelles pour le jumelage.
- **Repris de PS Hub :** **adapter l'interface, construire le moteur.** Son calendrier n'est pas un moteur de rendez-vous : c'est la liste de tâches CRM (`crm_tasks`), une copie du Google de chaque vendeur et les installations, dessinées par des vues maison. Aucune disponibilité, réservation, récurrence propre (Google déroulé en occurrences : `calendar-sync/index.ts:415`) ni rappel envoyé.
  - Pris : vues Jour / Semaine / Mois / « Horaire » 30 jours sans librairie (`src/pages/Calendar.tsx:63-110`) ; glisser-déposer par Pointer Events, aimanté aux 15 min, d'un jour à l'autre, position provisoire (`src/components/calendar/CalendarTimeGridView.tsx:225-312`, `:156-202`) ; création au clic (`:336-359`) ; avertissement de chevauchement (`CalendarEventDialog.tsx:222-237`) ; agenda d'un collègue pour un administrateur (ADR 0027, `Calendar.tsx:166-182`) → une conseillère voit l'agenda d'un pro ; synchro Google incrémentale par `syncToken`, repli complet au 410 (`supabase/functions/calendar-sync/index.ts:438-442`).
  - Changé : grille placée **à l'heure locale de la clinique** ; PS Hub place en minutes depuis minuit (`CalendarTimeGridView.tsx:100-110`), donc décale d'une heure les jours de changement d'heure, et affiche l'heure du navigateur (`src/hooks/useCalendarItems.ts:14-18`) ; période filtrée par **chevauchement**, pas par début (PS Hub perd les événements de plusieurs jours : `useCalendarItems.ts:216-217`) ; écritures par RPC en une transaction (PS Hub : deux appels, erreur du `delete` ignorée : `src/hooks/useCrmTasks.ts:612-636`) ; redimensionnement (absent) ; jetons Google **chiffrés** et illisibles du client (en clair chez PS Hub : `baseline.sql:21286-21301`) ; `state` OAuth signé et expirant (non signé : `google-calendar-oauth/index.ts:51`, `google-calendar-callback/index.ts:39-45`) ; déconnexion qui révoque chez Google (`useCalendarConnection.ts:105-111` ne fait que `is_active=false`).
  - Pas copié : la synchro qui lit encore `crm_tasks.google_event_id` alors que la poussée écrit dans `crm_task_assignees` (`calendar-sync/index.ts:324-329` vs `calendar-push-task/index.ts:565-580`) ; `action: "delete"` sans lien vérifié avec la tâche (`calendar-push-task/index.ts:800-806`) ; `reminder_at` jamais lu ; **le miroir complet du Google personnel visible des administrateurs** (`docs/adr/0027-admin-view-team-calendars.md:54-60`) : nos pros ont une pratique privée, on n'importe qu'**occupé / libre**, jamais un titre ni un participant.
- **Visio : Zoom et Google Meet (décidé par Jonathan, 2026-10-11).**
  - **Deux façons :** (a) **lien créé par rendez-vous** par l'API ; (b) **lien fixe par professionnel** (sa salle Zoom ou Meet) inscrit à son profil et copié dans chaque rendez-vous.
  - **Recommandation : Google Meet créé par rendez-vous, et le lien fixe en repli** (Zoom ou Meet) pour les pros qui tiennent à leur salle. Raisons : un lien unique par séance évite qu'un client tombe sur la séance précédente d'une salle réutilisée ; la clinique a déjà Google Workspace (Gmail branché) ; PS Hub crée déjà des Meet par l'API Calendar (`conferenceData.createRequest` avec `hangoutsMeet` et un `requestId` stable par tâche, pour que le lien ne change pas au déplacement : `supabase/functions/calendar-push-task/index.ts:505-520` ; `conferenceDataVersion=1` : `:536`).
  - **Comment :** un agenda Google « Rendez-vous MANA » de la clinique (compte de la clinique branché par l'administration, OAuth « Interne », portée `calendar.events` seule) ; chaque rendez-vous y crée un événement **sans nom de client** (« Rendez-vous MANA »), avec Meet ; le lien est gardé sur le rendez-vous et envoyé dans la confirmation et le rappel ; un déplacement met l'événement à jour, une annulation le supprime. À vérifier en essai : les droits d'hôte du professionnel invité (salle d'attente, admission) ; au besoin, l'API Meet (`spaces`) pour régler l'accès.
  - **Zoom par l'API** (plus tard, seulement si des pros l'exigent) : application **Server-to-Server OAuth** au compte Zoom de la clinique (identifiant de compte, identifiant client et secret en secrets de fonction), chaque pro doit être un utilisateur sous licence de ce compte ; option santé de Zoom à vérifier (Loi 25).
  - **Identifiants :** jetons Google chiffrés comme ceux de Gmail (même table `calendar_connections`), `state` signé, jamais rendus au navigateur ; secrets Zoom dans les secrets de fonction.
  - **Taille :** lien fixe +1 jour ; Meet par rendez-vous +3–4 jours ; Zoom par l'API +3–4 jours de plus.
- **Modèle de données :**
  - `availability_rules` (jour, heures **locales**, services permis, du … au …) et `availability_exceptions` (congé, bloc ponctuel).
  - `appointment_series` (règle simple : hebdo, aux deux semaines, mensuel ; jusqu'au ou nombre ; fuseau).
  - `appointments` (pro, service, début / fin `timestamptz`, mode, statut, série, annulation et frais, lien visio) avec contrainte d'exclusion `tstzrange` par pro sur les statuts actifs ; `appointment_participants`.
  - `calendar_connections` (jetons Google chiffrés, ADR 0004 ; l'agenda Meet de la clinique et le freeBusy des pros) et `external_busy_blocks` (lecture seule).
  - `appointments.video_provider` (`meet` / `zoom` / `fixed`), `video_url`, `video_event_id` ; `professionals_video_links` (lien fixe par pro, dans ce module).
  - `appointment_reminders` (canal `email` pour l'instant, prévu le, envoyé le, statut ; idempotent).
  - Publie : `get_open_slots(pro, from, to, service)`, `appointments_for_billing`, `first_appointments_confirmed`.
- **Intégrations :** socle (`runJob` pour rappels et « terminé », courriel Resend, notifications), Google (freeBusy, Calendar API pour Meet), Zoom (plus tard).
- **IA :** aucune.
- **Dépendances :** Clients, Professionnels, Services et tarifs.
- **Taille :** XL (24–29 jours) en trois lots : (a) disponibilités, réservation, vues ; (b) récurrence, rappels par courriel ; (c) Google freeBusy, Meet par rendez-vous et liens fixes.
- **Questions :** 7, 9, 17.

### 2.6 Facturation et paiements (`billing`) — XL

- **But :** un reçu après chaque séance (assureur, crédit d'impôt), frais d'annulation, IVAC et PAE, paiements reçus, et **paie des pros** (prix client × (1 − rétention), déjà calculé par Professionnels).
- **Utilisateurs :** adjointe ; administration ; professionnel (ses reçus et sa paie, en lecture) ; client (reçu par courriel).
- **Fonctionnalités :**
  - Garder (§F, §G) : facture par rendez-vous, lignes, TPS et TVQ par ligne, statuts brouillon → en attente → partielle → payée / annulée, moyens de paiement, frais d'ouverture pour un nouveau client, frais d'annulation, IVAC (forfait), PAE (règles de couverture), rapport IVAC, numérotation.
  - Changer : taux datés du socle, mémorisés sur la facture ; couples facturés correctement (l'ancienne n'en facturait qu'un, §F) ; algorithme PAE enfin appelé (§G) ; total 0 n'est plus « annulé » ; reçu PDF **rendu sur le serveur** (pdfmake, ADR 0008) avec ordre et numéro de permis du pro.
  - Nouveau : lien de paiement sur le reçu, carte enregistrée pour les frais d'annulation ; relevé mensuel de paie par pro ; export comptable.
- **Repris de PS Hub :** **porter le connecteur QuickBooks Online (décidé par Jonathan, 2026-10-11), construire la facturation clinique.**
  - Pris : le branchement OAuth (`quickbooks-oauth`, `quickbooks-callback`), la création de factures (`quickbooks-create-invoice/index.ts:363-523`), la synchro des paiements et la reprise (`sync-qbo-invoices`, `sync-single-qbo-payment`, `qbo-sync-cron`, `qbo-resync-worker`), la gestion des articles (`quickbooks-manage-item`, `quickbooks-sync-items`), le PDF (`qbo-download-invoice-pdf`).
  - **Ce qui se synchronise, et dans quel sens (l'app est la source) :**
    - **clients → QBO** : un client QBO par client facturé (ou payeur : PAE, IVAC), nom et numéro de dossier seulement ;
    - **factures / reçus → QBO** : chaque facture finalisée, avec un article QBO par service (lignes sobres, p. ex. « Rencontre 50 min », jamais un motif) et les taxes appliquées ;
    - **paiements → QBO** : chaque paiement enregistré dans l'app (Stripe, Interac, comptant), rattaché à sa facture ;
    - **QBO → app** : seulement les identifiants QBO et l'état de synchro (et, si le comptable saisit des paiements directement dans QBO, leur lecture pour rapprochement : question 18) ;
    - **paie des pros → QBO** (fournisseurs et factures fournisseur) : plus tard, question 18.
  - **Failles corrigées :** jetons QuickBooks **en clair** (`baseline.sql:20624-20634`) et lisibles par les super-utilisateurs via la RLS (`:30387`) → chiffrés comme Gmail, RPC `service_role` seulement, `revoke` ; `state` OAuth en base64 non signé, cru par le retour (`quickbooks-oauth/index.ts:47`, `quickbooks-callback/index.ts:29-30`) → `state` signé et expirant, retour vers `APP_URL` seulement ; tâche appelée avec la clé `service_role` en en-tête (`qbo-sync-cron/index.ts:435`) → `runJob` et `X-Job-Signature` (CLAUDE.md §7) ; un webhook Intuit, si utilisé, exige son jeton de vérification et passe par `claim_webhook_event`.
  - Pas copié : ni Stripe ni reçu de séance n'existent chez PS Hub ; factures SOMA, projets QBO et devis sont propres à Pergolas Signature.
- **Modèle de données :** `invoices`, `invoice_lines`, `payments`, `payer_allocations` (IVAC, PAE), séquence sans trou ; `professional_payouts` et lignes (instantané de la rétention, P4-151) ; `payment_provider_events`. Pour QuickBooks : `qbo_connection` (jetons chiffrés, `realm_id`, état ; aucun droit client), `qbo_links` (notre ligne ↔ identifiant QBO, version de synchro, dernière erreur en code), `qbo_sync_queue` (envois en attente, repris par la tâche). Publie `client_balance(client)`, `billing_summary`.
- **Intégrations :** socle (taxes, fichiers, PDF serveur, courriel avec pièce jointe, webhooks, `runJob`), Professionnels, fournisseur de paiement (§3.5), **QuickBooks Online** (OAuth Intuit ; fonctions `qbo-connect`, `qbo-callback` (user, administration), `qbo-sync` (job `billing.qbo_sync` et après chaque facture ou paiement)).
- **IA :** aucune.
- **Dépendances :** Rendez-vous, Clients, Services et tarifs, Professionnels.
- **Taille :** XL (24–28 jours) : facturation 18–22, puis QuickBooks 5–7 en lot séparé ; le paiement en ligne (Stripe) aussi en lot séparé.
- **Questions :** 8, 9, 18.

### 2.7 Importation GOrendezvous (étape à part) — M–L

- **But :** tout ramener de GOrendezvous à la bascule (décidé par Jonathan, 2026-10-11) : clients, **tout l'historique de rendez-vous**, correspondance des professionnels, factures et paiements s'ils s'exportent. **Jamais les notes cliniques** (D8) : elles restent dans un outil clinique.
- **Utilisateurs :** Jonathan (lance), un agent (prépare et rapporte), Christine et l'adjointe (vérifient des dossiers).
- **Étapes :**
  1. **Obtenir les exports** : demander à GOrendezvous un export complet en CSV ou Excel (clients, rendez-vous avec statut, service, professionnel, client ; factures, reçus et paiements ; professionnels). Les fichiers restent **hors de git**, dans `~/Clinique-MANA-import/` (comme l'import des pros).
  2. **Correspondances** : professionnels de GOrendezvous → `professionals` (table de correspondance relue à la main) ; services → `services` ; statuts → nos statuts ; taxes et moyens de paiement.
  3. **Doublons** : chaque client passe par les **règles de doublons de Clients** (identité : courriel, téléphone, nom + date de naissance ; HIGH fusionne, MEDIUM va au rapport), contre les clients déjà saisis dans l'app depuis Demandes.
  4. **Essai à blanc** (par défaut) : tables `private.import_*`, rien d'écrit dans les tables du module ; rapport : comptes, rejets et raisons, doublons, pros ou services sans correspondance, rendez-vous qui se chevauchent.
  5. **Import réel avec ton feu vert**, idempotent (identifiant source `external_ref` sur chaque ligne), audité comme « Importation » ; puis cinq dossiers vérifiés.
- **Règles :** historique en **lecture seule** (rendez-vous passés « terminés » ou « annulés », factures historiques sans recalcul de taxes ni envoi à QuickBooks, ni rappel ni courriel) ; seuls les rendez-vous **futurs** deviennent actifs ; les places restantes ne comptent pas l'historique.
- **Repris :** notre propre `import_professional` (essai à blanc par défaut) et `scripts/import-professionals.mjs` ([runbook](../runbooks/import-professionals.md)) ; rien de PS Hub.
- **Calendrier :** essais à blanc dès que Clients est en place, puis à chaque lot de Rendez-vous et de Facturation ; **import final la fin de semaine avant la bascule**, GOrendezvous gelé après le dernier export, puis gardé en lecture.
- **Dépendances :** Clients, Rendez-vous, Facturation (leurs tables), Services et tarifs.
- **Taille :** M–L (7–10 jours), selon la qualité des exports.
- **Questions :** 19.

### 2.8 Rapports (`reports`) — M

- **But :** les chiffres que le classeur calcule mal (recherche §8.4) et ceux du comptable.
- **Utilisateurs :** administration ; conseillères (leurs chiffres).
- **Fonctionnalités :** demandes par semaine, canal, provenance, conseillère ; taux de confirmation (activité et cohorte) ; délais reçue → contact → proposition → confirmation ; places ; annulations de premier rendez-vous ; rapport IVAC avec export CSV (désactivé dans l'ancienne) ; revenus et paie.
- **Repris de PS Hub :** rien tel quel ; `analytics-ai` envoie des données d'affaires à un modèle, exclu pour une clinique.
- **Modèle de données :** aucune table ; vues publiées par chaque module et une RPC par rapport (permission d'abord).
- **IA :** aucune.
- **Dépendances :** Demandes, Rendez-vous, Facturation.
- **Taille :** M (5–8 jours).

### 2.9 Plus tard : SMS, portails, B2B

- **SMS (décidé par Jonathan, 2026-10-11 : « on garde pour le futur »).** Ce qu'il couvrirait le jour venu, dans `communications` (M, 5–7 jours) :
  - rappels de rendez-vous J-1 par texto (en plus du courriel), puis réponses simples (« OUI » pour confirmer) ;
  - fournisseur **Twilio** (numéro canadien à 10 chiffres enregistré ; Telnyx en solution de rechange) ; la centrale Yeastar de PS Hub n'est pas réutilisable ;
  - **« ARRÊT » / « STOP »** et **consentement** enregistré sur le client (LCAP), absents de PS Hub (seul un interrupteur `allow_sms` : `yeastar-send-sms/index.ts:85-93`) ;
  - repris de PS Hub : fils par les 10 derniers chiffres (`src/lib/sms/conversations.ts:1-40`), interface boîte / fil / composeur (`src/components/crm/sms/`), webhook signé HMAC (`yeastar-webhook/index.ts:874-895`) ;
  - données : `sms_messages` (corps effacés après 12 mois), `sms_consents`. Le modèle `appointment_reminders` prévoit déjà un canal, donc rien à refaire dans Rendez-vous.
- **Portail du professionnel**, ajouté au fil des modules sous la permission `*.self` de chacun : « Mes clients » (Clients), « Mes demandes » (assignées, sans notes internes), « Mon agenda » et « Mes disponibilités » (Rendez-vous), « Mes reçus » et « Ma paie » (Facturation). Pas de module à part.
- **Portail client** (reçus, rendez-vous, consentements), **réservation en ligne** de l'appel découverte, **B2B** (ateliers, conférences, PAE employeurs) : après la bascule. Rien de cela n'est dans l'ancienne app.

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
- **Clients ailleurs** (Îles-de-la-Madeleine, Basse-Côte-Nord, en voyage) : courriels de confirmation et de rappel disent « 14 h, heure du Québec » ; un fuseau par client plus tard si besoin.
- **Tests** aux deux dimanches de changement d'heure pour chaque fonction de date de l'agenda.

### 3.3 Boîte de réception

- **Décidé (Jonathan, 2026-10-11) : Gmail API**, en commençant par `info@cliniquemana.com` pour les essais (§2.4).
- **Recommandation retenue :** la boîte partagée `info@` d'abord, les boîtes personnelles des conseillères ensuite ; Gmail pour la conversation avec les clients, **Resend pour le transactionnel** (invitations, rappels, avis), comme aujourd'hui.
- **Ce que ça change pour la Loi 25 :** des courriels de clients, souvent avec de la santé, entrent dans l'app : accès par permission (`communications.inbox`), corps effacés après 24 mois (à confirmer par Christine), jamais dans un journal, une notification ou une invite IA, pièces jointes en stockage privé ; l'EFVP couvre Google (déjà sous-traitant) et cette copie.
- **Prérequis :** Google Workspace de la clinique ; application OAuth « Interne » ; un sujet Pub/Sub pour les notifications Gmail (à créer par toi dans Google Cloud, avec ton feu vert à chaque étape).

### 3.4 Fournisseur SMS

- **Décidé (Jonathan, 2026-10-11) : plus tard.** Le jour venu : Twilio, rappels d'abord, consentement et « ARRÊT » obligatoires (§2.9).

### 3.5 Fournisseur de paiement

- **Recommandation : Stripe** (Canada) : lien de paiement sur le reçu, carte enregistrée pour les frais d'annulation, webhook signé réclamé par `claim_webhook_event`. Virements Interac et chèques saisis à la main. PS Hub n'a pas de Stripe. À vérifier : ce que GOrendezvous utilise, pour ne pas changer les habitudes des clients.

### 3.6 Bascule hors de GOrendezvous

- Rendez-vous et Facturation **basculent ensemble**, un début de mois. Demandes peut vivre seul avant (il remplace le classeur, pas GOrendezvous).
- **Import complet de GOrendezvous** (décidé, §2.7) : clients, tout l'historique de rendez-vous, correspondance des pros, factures et paiements s'ils s'exportent. Essais à blanc dès que Clients est en place ; import final la fin de semaine avant la bascule, après un dernier export ; GOrendezvous gelé puis gardé en lecture.
- **Suite de la bascule :** courriels de rappel actifs dès le premier jour (pas de SMS) ; QuickBooks branché avant la première facture.

### 3.7 Rappels pour tous les nouveaux modules

- RPC seulement, RLS par `current_permission_keys()`, manifeste et registre, `org_id` et audit partout (CLAUDE.md §5–6) ; courriel par `sendTemplatedEmail`, tâches par `runJob`, fichiers par `storage-sign`, signature par le socle.
- Pas de note clinique, motifs = étiquettes (D8) ; rien de sensible dans un journal, une notification ou une invite IA.
- Pas de cache de fichiers dans un service worker (PS Hub : `vite.config.ts:91-96`, non vidé à la déconnexion) ; erreurs d'authentification par code, jamais par texte (PS Hub déconnecte sur tout message contenant « session » : `src/App.tsx:123-135`).

---

## 4. Questions pour Jonathan (réponds « ok » ou corrige)

### Réponses reçues (Jonathan, 2026-10-11)

- **IA :** OpenAI, comme PS Hub (§2.4 ter). *(ancienne question sur le modèle IA)*
- **Boîte courriel :** Gmail branché, `info@cliniquemana.com` d'abord (§2.4, §3.3). *(ancienne question 7)*
- **Visio :** Zoom et Google Meet (§2.5). *(ancienne question 11)*
- **Comptabilité :** QuickBooks Online, oui (§2.6). *(ancienne question 13)*
- **GOrendezvous :** tout importer (§2.7, §3.6). *(ancienne question 3)*
- **SMS :** plus tard (§2.9, §3.4). *(ancienne question 8)*

### Questions encore ouvertes

1. **Prix clients :** une seule source, les grilles de rétention de Professionnels ; Services et tarifs n'en garde pas de copie. *Reco : ok.*
2. **Abandons dans Services et tarifs :** les modèles « taux horaire au prorata » et « annulation au prorata » (inutilisés). *Reco : abandonner.*
3. **Ce qu'un pro voit :** les clients qu'il a eus en rendez-vous ou qui lui sont assignés, pas seulement ceux dont il est « professionnel principal ». *Reco : oui.*
4. **Formulaires du site → Demandes :** dans un lot après la v1 de Demandes, par une fonction publique limitée et anti-robot. *Reco : oui.*
5. **Les 7 questions du classeur** ([recherche §8.5](../research/2026-10-08-intake-workbook.md#85-open-questions-for-jonathan)) à trancher avant la conception de Demandes. *Reco :* place rendue automatiquement à l'annulation d'un premier rendez-vous ; une proposition retient la place 48 h ; exclusions affichées en note surlignée d'abord ; liste d'attente possible pour toute discipline.
6. **IA dans Demandes et le jumelage :** aucune pour l'instant (santé dans les notes). *Reco : ok, on en reparle après six mois de données.*
7. **Google Calendar des pros :** lecture occupé / libre seulement, rien d'écrit dans leur agenda personnel (le Meet vit dans l'agenda de la clinique). *Reco : ok.*
8. **Paiement en ligne :** Stripe. *Reco : ok, après avoir vérifié ce que GOrendezvous utilise.*
9. **Bascule :** Rendez-vous et Facturation ensemble, un début de mois, précédés de l'import final ; GOrendezvous en lecture ensuite. *Reco : ok.*
10. **Ordre :** Services et tarifs → Clients → Demandes ; Communications (Gmail, puis composeur et IA) en voie B dès Clients ; puis Rendez-vous + Facturation avec l'import ; puis Rapports ; SMS plus tard. *Reco : ok.*
11. **OpenAI et Loi 25 :** aucun nom ni renseignement de client envoyé (variables remplies par le serveur) ; projet OpenAI dans la région Canada si le compte y est admis ; rétention zéro demandée, ou à défaut l'assurance écrite que l'API n'entraîne pas sur nos données ; EFVP et politique mises à jour par Christine. *Reco : ok ; qui ouvre le compte OpenAI de la clinique (pas celui de PS Hub) ?*
12. **Abandons venus de l'ancienne app :** `deterministic-scorer`, `holistic-classifier` et l'interprète d'horaire par IA. *Reco : abandonner.*
13. **Portail client et réservation en ligne :** après la bascule. *Reco : ok.*
14. **Boîtes Gmail :** `info@` partagée d'abord, lue par toutes les conseillères ; boîtes personnelles ensuite, chacune visible de sa propriétaire. *Reco : ok ; les conseillères ont-elles des adresses `@cliniquemana.com` à elles ?*
15. **Modèle OpenAI :** `gpt-5.4` par défaut, après un essai de 20 brouillons contre `gpt-4o` (celui de PS Hub) et `gpt-5.4-mini`. *Reco : ok.*
16. **Conservation des courriels synchronisés :** corps effacés après 24 mois, fils et métadonnées gardés. *Reco : ok, à confirmer par Christine.*
17. **Visio :** Meet créé par rendez-vous dans l'agenda de la clinique, lien fixe Zoom ou Meet par pro en repli ; Zoom par l'API seulement si des pros l'exigent. *Reco : ok.*
18. **QuickBooks :** lignes sobres (service et durée, jamais un motif) ; les paiements saisis directement dans QBO sont-ils fréquents (lecture pour rapprochement) ? la paie des pros dans QBO plus tard. *Reco : ok ; à valider avec le comptable.*
19. **Export GOrendezvous :** le demander maintenant (clients, rendez-vous, factures, reçus, paiements, en CSV ou Excel), car il conditionne les essais à blanc. *Reco : oui, c'est toi ou Christine qui le demandez.*

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
| Modèles `by_profession_hourly_prorata`, `rule_cancellation_prorata` | Drop | Question 2 |
| Catégories taxables (naturopathie, coaching) | Change | Règle de taxe par service ou par titre, taux du socle |
| Prix de départ (30 / 50 / 60 min par catégorie) | Drop ici | Déjà dans les grilles (P4-180 et suivantes) |
| 12 services de départ (dont Appel découverte 0 $, Ouverture de dossier 43,49 $ taxable) | Keep | Rangées de départ, libellés relus |
| Services par titre de profession (A2.17) | Keep | `service_titles` |
| Écriture admin / staff | Change | `services.manage` ; lecture `services.view` |
| Doublons de prix, taux horaire ignoré, taxes codées en dur | Corrigé | Contraintes, `tax_rate_on` |

2. **Le contrat publié** pour Rendez-vous et Facturation : `services_catalog`, `get_service_price(service, title, on)`, `billing_policies` en vigueur.
3. **Permissions et rôles** par défaut, section de Paramètres (`id` anglais, chemin français « services-et-tarifs »).
4. **Tests :** pgTAP (droits, RLS, RPC, prix à une date), unitaires, un parcours Playwright ; `docs/modules/services.md`.
5. **Points ouverts** : réponses aux questions 1 et 2 ; libellé de la ligne 60 min de l'Annexe A (question 20 du statut).
