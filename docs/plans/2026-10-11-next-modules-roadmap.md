# Plan de match — les prochains modules (2026-10-11)

**Pour :** Jonathan (à lire et à trancher). **Statut :** proposition, rien n'est construit.
**Sources :** [contexte d'affaires](../standards/business-context.md), [inventaire de l'ancienne app](2026-10-06-legacy-feature-inventory.md) (réf. « §B », « §C »… ci-dessous), [classeur d'accueil](../research/2026-10-08-intake-workbook.md), [visite de GOrendezvous](../research/2026-10-11-gorendezvous-tour.md) (réf. « visite §… »), [doc du socle](../modules/core.md), [ce que publie Professionnels](../modules/professionals.md#what-the-module-publishes), et PS Hub (`../NEW PS Hub`, lu sans rien modifier ; preuves `chemin:ligne` entre parenthèses).
**Lecture :** termes d'écran en français, noms techniques en anglais. Tailles en jours-agent : **S** ≤ 3, **M** 4–8, **L** 9–15, **XL** 16 et plus.

---

## 0. Vue d'ensemble

**Les dates (Jonathan, 2026-10-12 : « le plus rapide possible, sans couper sur la qualité ») :** code terminé et fusionné le **30 octobre 2026**, essais à la clinique en novembre, **bascule le lundi 30 novembre 2026**, repli le 11 janvier 2027 ; le renouvellement de GOrendezvous du **31 janvier 2027** (forfait « Entreprise » discontinué : [visite §0, addenda](../research/2026-10-11-gorendezvous-tour.md)) est la limite dure, pas l'objectif. **Cible de bascule : lundi 11 janvier 2027** (gel de GOrendezvous le vendredi 8 au soir, import final les 9 et 10), **date de repli : lundi 25 janvier 2027**. Tout ce qui est nécessaire pour quitter GOrendezvous passe donc avant le reste, y compris avant la fin de Demandes.

**Principe (Jonathan, 2026-10-11) :** « un système proche de GOrendezvous, adapté à nous, sans réinventer la roue ». On reprend ses écrans et ses règles là où la clinique les utilise ([visite](../research/2026-10-11-gorendezvous-tour.md), listes « À reproduire »), on simplifie ce qu'elle n'utilise pas, et on ajoute ce qui lui manque (dispatch, payeurs tiers, fusion de doublons, frais d'annulation automatiques).

### Ordre recommandé

| # | Module (écran) | Clé | Avant la bascule ? | Taille |
|---|---|---|---|---|
| 1 | **Services et tarifs** | `services` | Oui : catalogue unique, codes de famille | S–M |
| 2 | **Clients** | `clients` | Oui : tout pointe vers un client ; import | L |
| 3 | **Rendez-vous** (agenda, disponibilités, récurrence, rappels J-1 par courriel et texto, lien de confirmation, lien de visio par pro : Zoom ou lien fixe) | `appointments` | Oui (chemin critique) | XL |
| 4 | **Facturation et paiements** (file du matin, Interac, carte au dossier, lien Stripe, impayés, frais décidés par le pro, QuickBooks) | `billing` | Oui (chemin critique) | XL |
| 4b | **SMS** (centrale Yeastar, comme PS Hub : rappels, « OUI », « ARRÊT », consentement, préférence par personne) | dans `communications` | Oui (décidé par Jonathan le 2026-10-12 ; voie C) | M |
| 4c | **Paie des professionnels** (sommaire mensuel, « Ma paie », facture du pro, QuickBooks) | dans `billing` | Oui (voie C) ; premier sommaire le 1er décembre | M |
| 5 | **Importation GOrendezvous** | — | Oui : essais à blanc dès Clients, import final les 28–29 novembre | M–L |
| 6 | **Demandes** lot (a) : boîte, accueil, appels découverte, **liste d'attente** (inscription, frais, consentement, ordre, relances, sorties) | `demandes` | Oui : remplace les faux rendez-vous de l'agenda « conseillère » et la liste par pro de GOrendezvous | L |
| 7 | **Communications** lot (a) : branchement Gmail `info@` et synchro | `communications` | Oui (voie B, avant Clients) ; la boîte à l'écran vient après la bascule | M |
| 8 | **Communications** lot (b) : boîte à l'écran, composeur Gmail, modèles, IA (OpenAI) | `communications` | Non : décembre | L |
| 9 | **Demandes** lot (b) : jumelage, places, offre de plage aux inscrits de la liste d'attente, KPI | `demandes` | Non : décembre | L |
| 10 | **Facturation** lot payeurs tiers (IVAC mensuel, ententes PAE, factures aux payeurs) ; occupé / libre Google | `billing`, `appointments` | Non : juste après la bascule, avant l'IVAC de janvier et la clôture PAE d'avril | M |
| 11 | **Rapports** | `reports` | Non : décembre | M |
| plus tard | Conversations par texto à deux voies, portail client complet, réservation en ligne, B2B (ateliers, conférences) | — | Non | — |

**Réponses de Jonathan (2026-10-11) intégrées :** IA par OpenAI comme PS Hub ; Gmail branché (`info@cliniquemana.com` pour les essais) ; visio : **Zoom, un compte par professionnel** (Meet retiré) ; QuickBooks Online oui ; GOrendezvous : tout importer ; SMS plus tard ; **liste d'attente** des psys à incorporer (§2.3 bis). **Faits chiffrés** d'une 2e passe sur GOrendezvous (2026-01-01 → 2026-10-11, [visite §18](../research/2026-10-11-gorendezvous-tour.md)) intégrés : les questions qu'ils tranchent sont marquées « répondue par les données » au §4. **Réponses de Christine (2026-10-12, [recherche](../research/2026-10-12-christine-answers.md)) et décision de Jonathan « SMS avant la bascule » (2026-10-12) intégrées** : file du matin, carte au dossier, impayés, frais décidés par le pro, IVAC et PAE, paie des pros, lien de visio Zoom ou fixe, SMS ; voir « Réponses de Christine » au §4.

### Rythme et jalons (trois voies ; détail : [plan de code §2](2026-10-11-modules-coding-plan.md))

**Consigne de Jonathan (2026-10-12) : « le plus rapide possible, sans couper sur la qualité ».** L'ancien calendrier étalait ~130 jours-agent sur trois mois comme des journées humaines ; les agents travaillent en continu et en parallèle (un lot « de 4 à 5 jours » se termine en une ou deux heures ; la Phase 4 a pris des jours ; ~15 PR fusionnées le 12 octobre). Les lots, leur ordre, leurs dépendances, leurs tests et leurs revues ne changent pas : c'est la qualité. Ce qui change, c'est la mesure : **des séquences et des portes, pas des semaines.**

| Jalon | Date | Ce que ça veut dire |
|---|---|---|
| **Code terminé et fusionné** | **vendredi 30 octobre 2026** | Tous les lots d'avant la bascule, chacun passé par sa porte de qualité (pgTAP, tests des fonctions, Vitest, Playwright, captures à 3 largeurs, une revue par lot, jamais de fusion avec CI rouge) |
| **Essais à la clinique** | novembre | Essais à blanc de l'import, deux demi-journées (facturation avec Rachel ; agenda et demandes avec les conseillères), listes de vérification par rôle, répétition du 23 au 25 novembre |
| **Bascule partielle possible** | lundi 2 novembre | Si les éléments externes arrivent tôt : Demandes (liste d'attente, page d'appel découverte), consentements et synchro Gmail en service pour les conseillères ; GOrendezvous garde l'agenda, la facturation et les rappels ; les faux rendez-vous de l'agenda « conseillère » s'arrêtent ce jour-là |
| **Bascule** | **lundi 30 novembre 2026** | Rendez-vous, Facturation, SMS, paie : la facturation de décembre, le sommaire de paie du 1er décembre et l'IVAC / PAE de janvier se font dans la nouvelle app |
| **Repli** | lundi 11 janvier 2027 | Chaque étape décalée de six semaines |
| **Limite dure** | 31 janvier 2027 | Le renouvellement de GOrendezvous : une limite, pas l'objectif |

**Les trois voies, en séquence** (chaque lot attend sa porte, jamais ne la saute) :
- **Voie A, le chemin critique :** Services et tarifs (schéma → RPC → écran) → Clients (schéma → RPC → liste et dossier → fusion et Loi 25) → Rendez-vous (schéma et réservation → agenda → récurrence et états → rappels courriel et texto, liens, lien de visio fixe → « Mon agenda ») → Facturation (factures et payeurs → **file du matin**, reçus, relevés → impayés, refus avec solde, frais décidés par le pro, remboursements).
- **Voie B :** Gmail `info@` et `administration@` avec les avis Interac → Demandes (schéma → boîte et accueil → liste d'attente → appels découverte et propositions) → QuickBooks (branchement et correspondance des clients, puis l'envoi des factures après la voie A) → essais à blanc des rendez-vous et de la facturation, déroulé de bascule écrit.
- **Voie C :** SMS → consentements des clients → outil d'import et essai à blanc des clients → page publique d'appel découverte → Zoom par pro → paie des professionnels → Stripe (carte au dossier, prélèvement du lendemain) et rapprochement Interac → rapport Revenus.
- **Après la bascule :** consentements (retrait, rapports), payeurs tiers IVAC et PAE (avant l'IVAC de janvier et la clôture PAE d'avril), Demandes (jumelage, offres de plage, KPI), boîte Gmail à l'écran, composeur et IA, Rapports, occupé / libre Google, conversations par texto.

**Le vrai calendrier, ce sont les éléments externes** (tous à lancer **dès maintenant** ; détail avec responsables et délais : [plan de code §2.3](2026-10-11-modules-coding-plan.md) et [statut, « Mise en service des prochains modules »](2026-10-07-status.md)) : l'export de l'historique des rendez-vous par le support de GOrendezvous ; l'accès à la centrale Yeastar (la sienne, ou un DID dédié sur celle de PS : question 53) avec son application OpenAPI, son secret de webhook et un DID SMS ; l'application OAuth Google « Interne » et Pub/Sub (rapide) ; l'application Zoom (si une publication est exigée : des semaines ; **le lien fixe personnel marche pour tout le monde dès le premier jour**, Zoom est un plus) ; les 7 textes de consentement en français et en anglais ; l'accès QuickBooks ; le compte Stripe ; les pros qui saisissent leur lien de visio ; les clients qui redonnent leur carte ; les deux demi-journées d'essai.

### Dépendances

- **Services et tarifs** → Professionnels (titres, grilles de rétention), socle (taxes datées).
- **Clients** → socle (adresses, fichiers, signature, courriel) ; Professionnels.
- **Rendez-vous** → Clients, Professionnels, Services et tarifs, socle (courriel, liens sécurisés, tâches), Zoom ; nourrit Demandes et Facturation.
- **Facturation** → Rendez-vous, Clients, Services et tarifs, Professionnels (`get_professional_compensation`), Stripe, QuickBooks Online.
- **Importation** → les tables de Clients, Rendez-vous, Facturation et Services et tarifs.
- **Demandes** → Clients, Professionnels, Services et tarifs ; Rendez-vous pour le premier rendez-vous.
- **Communications** → socle (Resend, modèles, journal, webhooks, `runJob`), Gmail ; Clients pour le rattachement ; OpenAI.
- **Rapports** → tous, en lecture par vues publiées.

---

## 1. PS Hub en une table

| Domaine | Verdict | On prend | On laisse |
|---|---|---|---|
| Calendrier | **Adapter l'interface, construire le moteur** | Vues jour / semaine / mois / horaire, glisser-déposer, création au clic, synchro Google incrémentale | Pas de disponibilités, de réservation, de récurrence ni de rappels ; bogue d'heure d'été ; jetons Google en clair |
| Courriels | **Porter (Gmail), failles corrigées** | Synchro Gmail incrémentale, rattachement aux dossiers, boîte, composeur unique (bureau et téléphone), TipTap, modèles, affichage HTML sûr | Jetons déchiffrés rendus sans contrôle, `state` non signé, URL externes, pièces jointes d'une autre organisation, webhook sans secret, pixel d'ouverture |
| IA | **Porter (OpenAI, Chat Completions), avec nos garde-fous** | SDK `openai`, modèle en variable, invite (persona québécoise, formules interdites), Accepter / Rejeter / Affiner | Données de clients dans l'invite, lecture de n'importe quel dossier, aucune limite ni journal de coût, « style d'écriture » appris des courriels |
| Visio | **Rien à porter** (Zoom par pro décidé ; PS Hub ne fait que Meet) | Le principe d'un identifiant stable par réunion (`requestId`), pour que le lien ne change pas au déplacement | Meet |
| SMS | **Porter (avant la bascule, Jonathan 2026-10-12 : « le même système que PS Hub »)** | Client OpenAPI Yeastar et jeton rafraîchi, envoi par DID, webhook signé, fils par numéro, vue des fils | Aucun STOP ni consentement (ajoutés) ; le lien aux opportunités ; le composeur à deux voies vient plus tard |
| Contacts | **Adapter** | Doublons par identité (jamais le nom seul), fusion, frise d'activités | Recherche à six voies, écoutes Realtime de tables entières |
| Relances | **Adapter** | « Relances du jour » par urgence | Rappels de tâches jamais envoyés |
| Comptabilité | **Porter (décidé), failles corrigées** | Connecteur QuickBooks Online | Jetons en clair, `state` non signé, tâche appelée avec la clé `service_role` ; factures SOMA, devis |
| Transversal | **Ne pas copier** | — | Realtime `postgres_changes` sans reconnexion et écoutes mortes ; service worker qui garde les fichiers Storage 7 jours (`vite.config.ts:91-96`) ; déconnexion sur tout message contenant « session » (`src/App.tsx:123-135`) |

## 1 bis. GOrendezvous en une table

| Domaine | À reproduire (la clinique s'en sert) | À simplifier | À ajouter (ce qui manque) |
|---|---|---|---|
| Agenda | Vues Jour / Semaine / Mois / tous les pros ; disponibilités récurrentes + exceptions + services par plage ; présence / absence ; annulation avec raison et « garder à l'horaire » ; récurrence avec contrôle des conflits ; état du rappel ; audit | Lieux = visio et téléphone ; pas de salles, d'équipements ni de cours de groupe | Contrôles dans la base (chevauchement), places restantes pour le jumelage |
| Clients | Proches + 3 droits ; assurance principale et secondaire ; consentements versionnés signés, fr / en, clauses Oui / Non, exigés par service, payeur ou situation, « À compléter » avec date limite (§2.2 bis) ; « Référé par » ; pronoms ; langue ; règle de visibilité des pros | Étiquettes devenues de vrais champs (tarif étudiant ou réduit, payeur externe, IVAC, PAE, banni) | **Fusion des doublons** |
| Services | Familles numérotées 10xxx…80xxx (utiles pour QuickBooks) ; couple facturé à deux ; tarifs étudiant et réduit | **Un catalogue unique** (fini « Z MATRICE » et ~900 couples pro-service) ; prix des grilles de rétention | — |
| Facturation | Facture → paiement (Interac, lien Stripe « PAYER ») → reçu sous 24 h ; plusieurs lignes ; facture divisée pour un couple ; numéro `AAAA-N` ; mode de paiement ↔ compte QuickBooks ; relevé annuel | — | **Frais d'annulation automatiques** (politique à deux paliers) ; **vrais payeurs tiers** (IVAC mensuel, ententes PAE par client) avec factures aux payeurs ; **file du matin** ; carte au dossier prélevée le lendemain ; relances et refus avec solde ; paie des pros |
| Communications | Rappel 1 jour avant, jamais la fin de semaine ; liens confirmer / modifier / annuler avec « appeler à moins de 24 h » ; consentements versionnés par service ou payeur (7) ; règle des 14 ans | Pas de formulaires santé (D8) | — |
| Accueil | Les états de « Requêtes de service » (Nouveau, En évaluation, Accepté, Jumelé, Liste d'attente, Orienté ailleurs, Urgent) | — | Remplacer les faux rendez-vous de l'agenda « conseillère » (appels découverte, liste d'attente) |
| Abandons proposés (ton OK requis) | — | Salles, équipements, groupes, inventaire, formulaires santé, services PRÉSENTIEL, location de bureau, vente d'article, cartes de visite (si inutilisées), TELUS eRéclamations et Lumino Santé (à confirmer) | — |

---

## 2. Les modules

### 2.1 Services et tarifs (`services`) — S–M

- **But :** **un seul catalogue** des services vendus, codé par familles comme dans GOrendezvous, avec durée, taxes et source du prix, que Rendez-vous, Facturation, QuickBooks, la fiche et l'Annexe A lisent tous.
- **Utilisateurs :** administration (modifie) ; conseillères, adjointe et professionnels (lisent).
- **Fonctionnalités :**
  - Garder (§H) : liste avec recherche, filtre actifs / archivés, tri, création, archivage, restauration ; durée, couleur, « toujours taxable » ; services offerts par titre de profession (A2.17) ; aperçu taxes comprises.
  - **De GOrendezvous** ([visite §3](../research/2026-10-11-gorendezvous-tour.md)) : **familles numérotées** 10xxx individuel (30 / 50 min, tarif étudiant, tarif réduit), 20xxx couple et famille (30 / 60 min), 30xxx IVAC, 40xxx PAE externe, 50xxx administratif (rapport, test psychométrique, discussion avec un intervenant, transfert de dossier, appel découverte 15 min, supervision, **inscription à la liste d'attente**, §2.3 bis), 60xxx ateliers, 70xxx annulation tardive / absence, 80xxx frais de déplacement ; le code sert d'article QuickBooks ; **service pour deux** (couple) facturé à deux personnes ; **variantes tarif étudiant et tarif réduit** ; services à 0 $ pour PAE et IVAC (sauf ouverture de dossier IVAC 43,49 $ taxable).
  - Changer : **un catalogue unique** au lieu des services et prix copiés sur chaque pro depuis le faux employé « Z MATRICE » (~900 couples pro-service) ; **pas de copie des prix clients** : ils viennent des grilles de rétention (`retention_grid_prices`, datées, déjà lues par la fiche et l'Annexe A) ; un service dit « prix selon la grille, 50 min », « prix fixe », « gratuit » ou **« montant saisi à la facture »** ; tarifs étudiant et réduit = un rabais daté par service (montant ou pourcentage) ; taxes des taux datés du socle (`tax_rate_on`) ; clé et code choisis une fois.
  - **Ce que les données confirment** ([visite §18](../research/2026-10-11-gorendezvous-tour.md)) : **les prix sont par profession et identiques entre les pros d'une même profession** (30 / 50 / couple 60 : travail social 85 / 120 / 150, psychoéducation 100 / 140 / 165, sexologie 110 / 150 / 175, psychothérapie 120 / 160 / 185, psychologie 130 / 175, étudiant 96 / 120) : le modèle « un prix par (service, profession) » tiré des grilles est le bon, et le **rapport d'écarts** compare ces prix aux grilles de rétention avant la bascule. Les tarifs étudiant (10131, 10151 : 68 lignes) et réduit (10152 : 3 lignes) existent comme services chez GOrendezvous ; ils deviennent des variantes et sont rattachés à l'import. **Taxes pratiquées :** taxées = ouverture de dossier (43,49 $ TTC = 37,83 $ + taxes), inscription à la liste d'attente (21,74 $ = 18,91 $ + taxes), couple 30 min, supervision, frais de déplacement, naturopathie ; **toutes les consultations non taxées**, sexologie et orientation comprises (**confirmé par Christine, 2026-10-12, réponse 15**) ; **« Statut Indien » = exemption de taxes** sur le dossier client (réponse 16). **Famille 50xxx (administratif) :** prix 0 au catalogue et **montant tapé sur la facture** (rapport 56–208 $, discussion 33–84 $, test 40 $, supervision 100 $) : `price_source = 'entered'`, aucun moteur de prorata.
  - Nouveau : **politique d'annulation à deux paliers** en réglage daté (préavis 24 h ; 50 % à la 1re absence ou annulation tardive, puis 100 %), lue par Facturation pour poser les frais seuls ; frais d'ouverture de dossier daté ; modes vidéo et téléphone seulement.
  - Abandon proposé (ton OK requis) : modèles `by_profession_hourly_prorata` et `rule_cancellation_prorata` (§H) ; services **PRÉSENTIEL**, **location de bureau**, **vente d'article**, recherche-action ; champs de GOrendezvous non utilisés (salles, équipements, places, heures fixes, règles par étiquette, RAMQ, spécialité Lumino Santé).
- **Repris de PS Hub :** rien (**construire**). Son catalogue est un calculateur de pergolas (`docs/plans/2025-01-07-calculator-database-design.md`).
- **Modèle de données :**
  - `service_families` : code de famille (10…80), nom, ordre.
  - `services` : `code` (5 chiffres, unique ; les codes réels de GOrendezvous, visite §18), clé, nom, description, famille, durée, `kind` (séance, appel, frais, atelier, administratif), `for_two`, `price_source` (`grid` / `fixed` / `free` / `entered`), prix fixe, règle de taxe (`exempt` / `taxable`, liste confirmée par Christine), couleur, actif.
  - `service_titles` : quels titres de profession offrent quel service.
  - `service_rate_variants` : tarif étudiant, tarif réduit (montant ou pourcentage, datés).
  - `billing_policies` : délai d'annulation, palier 1 et palier 2, frais d'ouverture, datés (`effective_from`).
  - Publie : `services_catalog` (vue), `get_service_price(service, title, variant, on)`, `billing_policy_on(on)`.
- **Intégrations :** socle (taxes datées, audit, réglages) ; Professionnels (titres, grilles) ; QuickBooks par Facturation (le code = l'article).
- **IA :** aucune.
- **Dépendances :** Professionnels.
- **Taille :** S–M (5 jours).
- **Questions :** 9, 10, 11, 23.

### 2.2 Clients (`clients`) — L

- **But :** le dossier **administratif** du client (jamais clinique, D8), au moins aussi complet que la fiche de GOrendezvous : identité, coordonnées, proches et leurs droits, assurance, payeur, consentements, et ses demandes, rendez-vous, factures et courriels.
- **Utilisateurs :** conseillères et adjointe ; professionnel (ses clients, selon la règle de visibilité ci-dessous) ; Christine (accès et destruction, Loi 25).
- **Fonctionnalités :**
  - Garder (§B) : liste filtrable et triable, colonnes au choix, lien profond ; création en sections avec adresse Google ; **détection des doublons** (algorithme §B : HIGH bloque, MEDIUM demande confirmation) ; relations stockées une fois, lues des deux côtés ; archivage ; numéro de client ; historique ; téléphones E.164 ; âge sur la date de naissance (date seule).
  - **De GOrendezvous** ([visite §2](../research/2026-10-11-gorendezvous-tour.md)) :
    - **Informations :** prénom, nom, sexe (F / M / Autre), naissance, courriel, mobile / maison / travail + poste, rappels par courriel oui / non, langue (fr / en), **prénom à la naissance** et **pronoms** (8 choix), fuseau.
    - **Notes administratives :** notes, professionnel principal, **« Référé par »**, champ libre ; la provenance « Comment avez-vous entendu parler de MANA ? » s'y ajoute (liste du site).
    - **Relations** (parent, proche aidant…) avec **contact principal** et **3 droits** : gérer les rendez-vous et formulaires, recevoir les communications, recevoir les reçus et factures.
    - **Assurance principale et secondaire :** assureur, police, certificat, relation, titulaire.
    - **Visites et paiements, reçus, consentements, audits** : onglets du dossier (lus de Rendez-vous, Facturation et du socle).
    - **Règle de visibilité d'un pro :** les clients qu'il a créés, qu'il a vus ou verra en rendez-vous, ou dont il est le pro principal.
  - Changer : les **étiquettes deviennent de vrais champs** (tarif étudiant, tarif réduit, payeur externe, IVAC, PAE, client banni, dossier incomplet, entente de paiement, facturation personnalisée, et l'exemption de taxes de l'étiquette « Statut Indien » si le comptable la confirme) ; les étiquettes libres restantes (5 au plus) servent au tri ; notes et consentements enfin enregistrés (§B « Half-built ») ; recherche côté base ; RLS des relations avec permission.
  - Nouveau : **fusion des doublons** (GOrendezvous ne fait qu'archiver) ; **demande d'accès et de destruction** (export PDF, anonymisation, journalisées) ; recherche ⌘K (`search_clients`) ; genre pour « Femmes seulement » (P4-245).
  - Abandon proposé : « prénom + mot de passe » pour supprimer (remplacé par la permission et la confirmation), numéro RAMQ (non demandé chez MANA : à confirmer), cartes de visite.
- **Repris de PS Hub :** **adapter.**
  - Pris : rapprocher deux fiches par **identité (courriel, téléphone), jamais par le nom seul** (ADR `docs/adr/0033-identity-not-name-for-contact-account-dedup.md`, `supabase/functions/_shared/resolveContactAndAccount.ts`) ; fusion manuelle avec dialogue (`merge-contacts`, `MergeContactDialog.tsx`, `DuplicateContactDialog.tsx`) ; courriel et téléphone normalisés en colonnes, E.164 vérifié (`baseline.sql:17207-17222`) ; frise multicanal pour l'onglet « Historique » (`src/components/crm/conversation/ConversationTimeline.tsx`, `mapActivityToEvent.ts`).
  - Changé : fusion par RPC transactionnelle et auditée ; recherche par RPC définisseuse limitée aux colonnes affichées (comme `search_professionals`), pas le `global_search` à six voies (`20260716154829_global_search_reads_index.sql:1-30`).
  - Pas copié : écoutes Realtime de tables entières (`src/hooks/useCrmContacts.ts:122`, `useCrmCustomers.ts:178`).
- **Modèle de données :**
  - `clients` : identité (dont prénom à la naissance, pronoms), langue, naissance, sexe, coordonnées, adresse, provenance, « Référé par », professionnel principal, rappels oui / non, champs issus des étiquettes, archivé, `client_number`, `external_ref` (import).
  - `client_relations` : paire ordonnée, type et inverse (règle §B), contact principal, **3 droits** par sens.
  - `client_insurances` : rang (principale / secondaire), assureur, police, certificat, relation, titulaire.
  - `client_consent_rules`, `client_consent_requests`, `client_consents` : les règles, les envois et les consentements en vigueur (§2.2 bis).
  - `client_payers` : dossier IVAC (n° de dossier) ou entente PAE du client (fournisseur de PAE, montant par séance ou maximum, renouvellement le 31 mars) ; la consommation et les factures aux payeurs vivent dans Facturation (§2.6) ; aucun employeur (pas de programme PAE de MANA, Christine). Champ « Exemption de taxes (Statut Indien) » (décidé, Christine) et drapeau « Entente particulière » avec note.
  - `client_tags` (5 au plus) ; `client_merges` (journal des fusions).
  - Publie : `clients_directory`, `search_clients`, `get_client_summary(id)`, `private.client_visible_to_professional(client)`.
- **Intégrations :** socle (`places`, fichiers, signature, courriel, audit avec rédaction des noms), Professionnels.
- **IA :** aucune.
- **Dépendances :** socle ; Professionnels.
- **Taille :** L (10 jours) en voie A ; les consentements (§2.2 bis) 5 jours en voie B avant la bascule et 2 jours après.
- **Questions :** 12, 13, 14, 15, 47, 48, 49.

#### 2.2 bis Consentements des clients (Jonathan, 2026-10-11 : « faut que notre module client gère bien ça comme GOrendezvous »)

- **Objectif :** faire **au moins** ce que GOrendezvous fait aujourd'hui ([visite §2 « Consentements », §15, §17](../research/2026-10-11-gorendezvous-tour.md)) : des textes versionnés, signés électroniquement par le bon signataire, exigés au bon moment, visibles au dossier et dans une liste « À compléter » ; et mieux là où la Loi 25 le demande (retrait, copie, conservation).
- **Les 7 textes** (ceux de la clinique : général, liste d'attente psychologie et psychothérapie, transfert de dossier clinique, stagiaire en psychothérapie, coaching, naturopathie, PAE externe) deviennent des **modèles de documents du socle** (signature électronique, §core) : versionnés (brouillon → publié → archivé), **jamais supprimés une fois signés** (une version se rend « inactive » comme chez GOrendezvous), **en français et en anglais** selon la langue du client (un modèle par texte et par langue, publiés ensemble). Le texte général en est à sa 15e version chez GOrendezvous (~340 acceptations) : la v1 chez nous reprend ce texte, Christine le relit (question 15).
- **Champs dynamiques** (GOrendezvous : client, pro, titre, entreprise, adresse, service, lieu, signataire) : nos `{{ variables }}` vérifiées à la publication : `client.prenom`, `client.nom`, `client.date_naissance`, `signataire.nom`, `signataire.lien` (« mère de »), `professionnel.nom`, `professionnel.titre`, `professionnel.ordre_permis`, `clinique.nom`, `clinique.adresse`, `service.nom`, `payeur.organisation`, `aujourd_hui`.
- **Clauses « Accord requis » et « Accord Oui / Non »** (GOrendezvous permet des sections facultatives acceptées ou refusées une à une, p. ex. une autorisation de communiquer avec un tiers). **Choix :** les clauses Oui / Non sont **répondues dans notre page de signature avant la signature**, et les réponses sont **imprimées dans le document** (bloc par clause : « ☒ J'accepte / ☐ Je refuse ») puis signées avec lui ; elles sont aussi gardées en base (`answers`) pour les filtres et les rapports. Pas de cases à cocher Documenso : notre client Documenso ne connaît que signature, initiales, date et nom (`_shared/documenso.ts:109`) et le modèle de rendu est fermé (ADR 0008) ; une clause imprimée et signée vaut preuve, et reste lisible dans le PDF scellé (R-46). Quelles clauses facultatives existent dans les 7 textes : question 47.
- **Quand un consentement est exigé** (règles, Paramètres → Consentements) : par **service** (naturopathie, coaching, supervision), par **type de payeur** (PAE externe, IVAC), par **profession ou statut du pro** (stagiaire en psychothérapie), par **situation** (inscription à la liste d'attente, transfert de dossier) ; et le **général** pour tout premier rendez-vous. Fréquence **une fois** (vaut tant que la version est en vigueur) ou **à chaque rendez-vous** (comme GOrendezvous l'offre). Une **nouvelle version publiée** marque « À signer de nouveau » pour **ce texte seulement**, selon le choix fait à la publication : « tous les clients actifs » ou « les nouveaux clients seulement » (question 48, Christine).
- **Qui signe :** le client ; **à moins de 14 ans** (règle du Code civil du Québec : à 14 ans, le mineur consent seul aux soins), un **parent ou tuteur** du dossier, relié avec le droit **« gérer les rendez-vous et formulaires »** ; **les deux parents** quand la garde partagée est notée sur le dossier (deux signataires, deux liens) ; sinon refus en français (« Ajoutez un proche autorisé au dossier »). La preuve est celle du socle : signataire, date et heure, certificat et journal de Documenso dans le PDF scellé (pas d'adresse IP gardée chez nous).
- **Envoi et signature :** (1) depuis la **demande** (appel découverte : « Envoyer le consentement général ») ; (2) **automatiquement à la réservation du premier rendez-vous** (les textes exigés manquants partent avec la confirmation) ; (3) depuis les **« Actions »** du rendez-vous ; (4) depuis le dossier client (« Envoyer », « Renvoyer », « Signer ici » pour un client au téléphone qui signe sur son appareil). Le client reçoit un **courriel avec un lien sécurisé** (socle, usage unique, 14 jours) vers une page publique de l'app : identité du signataire confirmée (prénom et année de naissance), clauses Oui / Non, puis la **signature intégrée Documenso** (le cadre déjà utilisé pour le consentement des pros, `EmbeddedSigning`, P4-488), téléphone ou ordinateur, retour sur une page « Merci ». Rappel après 7 jours ; lien expiré → « Renvoyer ».
- **« À compléter » et « À surveiller » :** le client voit ses textes en attente avec une **date limite** (par défaut la veille du premier rendez-vous) dans le courriel et la page ; le personnel voit **« Consentements à obtenir »** (liste et filtre « en retard ») et un avis dans la cloche quand un rendez-vous est à moins de 48 h sans consentement exigé.
- **Avant la séance :** le rendez-vous affiche **« Consentement signé » / « manquant »** (par texte exigé) ; le pro le voit dans « Mon agenda » ; **la réservation n'est jamais bloquée**, seulement signalée (recommandation, R-47) ; un **courriel de rappel part 48 h avant** si un texte exigé manque encore.
- **Retrait (Loi 25, mieux que GOrendezvous) :** « Retirer le consentement » au dossier, avec date, par qui et note ; le consentement en vigueur passe à « Retiré » ; les rendez-vous à venir le signalent « manquant » ; une nouvelle signature plus tard crée une nouvelle entrée (l'historique reste). **Copie du PDF signé** au client sur demande (« Envoyer la copie signée », par courriel, journalisé). **Conservation** : les PDF signés suivent la politique que Christine fixe (question 49 ; par défaut, la durée du dossier administratif).
- **Dossier client, onglet « Consentements » :** une ligne par texte applicable au client : état (**Signé le … · v15 · par Marie T. (mère)**, **À signer**, **À signer de nouveau** (v16 publiée), **Retiré le …**, **Refusé**, **Expiré (lien)**), les réponses Oui / Non, le PDF scellé (téléchargement du socle), l'historique de toutes les versions et de tous les envois ; **audit** de chaque envoi, signature, retrait et changement de règle.
- **Import :** les ~340 consentements généraux signés et ceux des 6 autres textes sont importés **comme faits** (texte, version GOrendezvous, date, signataire s'il est exporté), sans PDF (visite §11) ; ils comptent comme « Signé le … (GOrendezvous, v15) ». Les clients d'une version plus ancienne ne sont marqués « À signer de nouveau » que si Christine publie une nouvelle version avec « tous les clients actifs ».
- **Rapports :** nombre de clients **sans consentement valide exigé**, par texte et par pro ; signatures et retraits par mois ; délai moyen envoi → signature (Rapports, §2.8).
- **Modèle de données :** règles `client_consent_rules` (texte, déclencheur : service / payeur / profession / situation / général, cible, fréquence, actif) ; demandes `client_consent_requests` (client, texte, version et langue, signataires, contexte : demande, rendez-vous ou inscription, lien sécurisé, date limite, état, réponses, `signature_request_id` du socle) ; faits `client_consents` (le consentement en vigueur par client et texte : version, signé le, par qui, réponses, PDF, retiré le / par / note, `source` app ou import). Publie `private.required_consents_for(client, service, payer_kind, professional)` (Rendez-vous, Demandes), `client_consents_status` (dossier, « Mon agenda »), `clients_consent_gaps` (Rapports).
- **Taille et calendrier :** 7 jours en deux lots : **C5a** (5 jours, voie C, avant la bascule) : modèles fr / en, règles, signataires, envoi et signature, onglet, « À compléter » et « À surveiller », rappel 48 h ; **C5b** (2 jours, après la bascule) : retrait, copie au client, rapports, campagne « À signer de nouveau ».
- **Questions :** 15, 47, 48, 49.

### 2.3 Demandes — accueil et jumelage (`demandes`) — XL

- **But :** le travail des conseillères : demande reçue → appel découverte → proposition d'un professionnel → premier rendez-vous confirmé, avec la promesse de rappel 24–48 h visible. Remplace le classeur ([recherche §8](../research/2026-10-08-intake-workbook.md#8-requirements-for-the-future-demandes-module)).
- **Utilisateurs :** conseillères ; adjointe (tableau des places) ; administration (statistiques) ; professionnel (demandes qui lui sont assignées, sans notes internes).
- **Fonctionnalités :**
  - Garder (§C) : formulaire d'accueil (type, motifs, besoin, enjeux, consultations antérieures, contexte légal, préférences d'horaire, urgence), participants avec principal, statut, `DEM-AAAA-NNNN`.
  - Garder (§D), selon **les 12 règles publiées par Professionnels** : clientèle et langue en filtres durs, âge minimum et « Femmes seulement », motifs qui notent sans exclure, assurance affichée, « Bon à savoir », places restantes calculées ici, suggestion mémorisée avec `updated_at`. **Exclusions d'un pro (« pas de … ») : un avertissement, pas une interdiction** (décidé, Christine, 2026-10-12, réponse 21 : possible si le motif refusé est présent sans être l'élément à travailler). Les couleurs du classeur sont un guide de priorisation (tableau en construction, réponse 19) ; « pour l'administration seulement » reste à éclaircir avec les conseillères (question 20).
  - Changer : motifs lus du catalogue (fini les 12 clés codées, §C) ; fermeture qui fonctionne ; ordre des suggestions expliqué (score, places, nom).
  - Nouveau (classeur) : boîte des demandes (âge vs 24–48 h, « sans réponse » et prochaine tentative) ; saisie rapide en 20 s ; propositions (qui, quand, réponse) ; liste d'attente avec pro « pont » ; annulations de premier rendez-vous et raison ; tableau des places ; KPI.
  - **De GOrendezvous** ([visite §7, §8](../research/2026-10-11-gorendezvous-tour.md)) : son nouveau formulaire « Requêtes de service » (automne 2026, non activé chez MANA) est une bonne référence. **États :** Nouveau, En évaluation, Accepté, Jumelé, Liste d'attente, Orienté ailleurs, Urgent (Urgent devient un drapeau, pas un état). **Champs d'accueil :** pour qui, thérapie antérieure, langue, mode (vidéo / téléphone), disponibilités, genre du pro souhaité, motif, préoccupations, payeur (assurance, PAE, aucun), assureur, note interne, référence, consentement. **Pas de dépistage PHQ-2 / GAD-2** : ce sont des outils cliniques (D8, question 17).
  - **Remplace des contournements :** aujourd'hui, les appels découverte (« Consultation gratuite 15 min ») et la liste d'attente (« Inscription – Liste attente psychologie et psychothérapie », « LISTE ATTENTE À RAPPELER ») sont de faux rendez-vous dans l'agenda partagé « conseillère ». Demandes (a) les remplace avant la bascule, sinon on les recopierait dans le nouvel agenda : appel découverte = une tâche datée de la demande ; liste d'attente = la conception du §2.3 bis (Jonathan, 2026-10-11 : « pour les psy souvent nous avons une liste d'attente, il faut incorporer ça aussi »).
  - **Propositions :** « Requêtes > Rendez-vous » de GOrendezvous (rendez-vous proposé, accepté par courriel, hachuré d'ici là ; 52 acceptées et 28 en cours au moment de la visite) devient la proposition de premier rendez-vous avec lien d'acceptation (question 7).
  - **Appels découverte : le site renvoie à Calendly** (visite §18 : « Réserver un appel découverte » → calendly.com, pas GOrendezvous ; le formulaire « Nous écrire » est un formulaire Elementor avec la provenance et le consentement, promesse de contact en 24–48 h ouvrables). **Décidé (Christine, réponse 22) : on remplace Calendly seulement si l'app dit d'où viennent les appels et reste aussi simple pour le client ; sinon on le garde.** Donc **une page publique de réservation d'appel découverte** (plages des conseillères, création d'une demande « Nouvelle » avec le rendez-vous d'appel, courriel de confirmation, limite par IP et anti-robot) dont le **suivi de la provenance** (paramètres de campagne / UTM, référent, « Comment avez-vous entendu parler de MANA ? ») est un **critère d'acceptation** ; recommandation : la remplacer, en voie C (11–13 novembre) ; si la page ne satisfait pas ce critère, Calendly reste et ses réservations sont importées (question 44). Le formulaire du site → Demandes reste après la bascule.
  - Abandon proposé (ton OK requis) : `deterministic-scorer`, `holistic-classifier` (naturopathie) et l'interprète d'horaire par Claude **dans le navigateur, clé lue côté client** (`_legacy/src/recommendations/schedule-interpreter.ts:236`).
  - Lot ultérieur : formulaires du site qui créent la demande.
- **Repris de PS Hub :** **adapter des pièces, construire le cœur** (PS Hub n'a pas de jumelage).
  - Pris : entrée depuis un formulaire web (`supabase/functions/ingest-web-lead`, `upload-web-lead-files`) ; vue « Relances du jour » groupée par urgence avec actions en ligne (`docs/plans/2026-04-19-phase1-relances-du-jour-implementation.md`) pour les « sans réponse ».
  - Changé : la fonction publique prend une limite par IP **avant** toute écriture, plus un anti-robot ; celle de PS Hub dit « No auth required » sans limite (`ingest-web-lead/index.ts:7`).
  - Pas copié : les rappels de tâches jamais envoyés (`reminder_at` écrit, jamais lu : `src/hooks/useCrmTasks.ts:404`, `src/lib/inbox/eventTypeMeta.ts:79`).
- **Modèle de données :**
  - `demandes` : reçue le / par, canal, provenance, type, principal, payeur, motifs, langue, préférences, urgence, statut, `notes` (sensibles : permission propre, jamais dans un journal, une notification ou une invite IA).
  - `demande_participants` ; `demande_events` (chaque changement de statut horodaté, tentatives de rappel) ; `demande_propositions` (professionnel, par / le, réponse, instantané).
  - `first_appointment_cancellations`, `capacity_snapshots` (photo du lundi par tâche planifiée) ; la liste d'attente au §2.3 bis.
  - Publie : `demandes_summary`, `get_places_remaining(professional)`, `waitlist_summary` (Rapports).
- **Intégrations :** Professionnels, Clients, Services et tarifs, socle (notifications « demande en retard », tâches), Temps réel (§3.1).
- **IA :** **aucune au départ** : les notes d'accueil contiennent de l'information de santé (question 20).
- **Dépendances :** Clients, Professionnels, Services et tarifs ; plus tard Rendez-vous (d'ici là, `availability_periods`, P4-4).
- **Taille :** XL (27–29 jours) en deux lots : **(a) avant la bascule** (19 jours : 16 en voie B, plus la page publique d'appel découverte, 3 jours en voie C) : boîte, accueil, états, appels découverte, **liste d'attente** (§2.3 bis, partie 1), propositions, page publique ; **(b) après la bascule** (10–12 jours) : jumelage, places, **offres de plage aux inscrits** (§2.3 bis, partie 2), KPI.
- **Questions :** 7, 17, 18, 19, 20, 44 ; liste d'attente : 34 à 40.

#### 2.3 bis Liste d'attente (dans Demandes)

- **Ce qu'elle remplace :** (1) la liste d'attente par professionnel de GOrendezvous (priorité, disponibilités, validité, service, invitation quand une plage se libère, export), **vide chez tous les comptes vérifiés** (visite §18) ; (2) la vraie liste : les faux rendez-vous de l'agenda partagé « conseillère », **51 inscriptions « Inscription – Liste attente psychologie et psychothérapie » à 21,74 $ en 2026** et « LISTE ATTENTE À RAPPELER » à 0 $ ([visite §8, §18](../research/2026-10-11-gorendezvous-tour.md)).
- **Où elle vit : dans Demandes.** Une demande passe à l'état **« Liste d'attente »** et porte une ou deux **inscriptions** : pour une **profession** (Psychologie, Psychothérapie, ou toute autre profession du catalogue) et / ou pour **un professionnel précis**. Pas de liste propre à chaque pro comme dans GOrendezvous : les conseillères la tiennent, le pro voit en lecture les inscriptions qui le visent (question 40).
- **Ordre :** **priorité** (« Normale » ou « Prioritaire », posée par une conseillère avec une raison, visible) puis **date d'inscription** ; le rang s'affiche (« 7e sur 23 en psychologie »).
- **Ce que l'inscription retient** (repris de la demande, modifiable) : disponibilités (matin, après-midi, fin de journée, soir, fin de semaine, et jours), mode (vidéo, téléphone), langue, motifs (étiquettes du catalogue), clientèle (âge), genre de pro souhaité, payeur ; un **pro « pont »** optionnel (un rendez-vous d'attente avec un autre pro, comme le classeur).
- **Frais d'inscription :** un service de Services et tarifs, **« Inscription liste d'attente »** (famille 50xxx), facturé à l'inscription par Facturation (une facture sans rendez-vous). **Confirmé par les données :** 21,74 $ = 18,91 $ + TPS et TVQ, service taxable (code 50100 du gabarit) ; reste à savoir s'il est remboursable ou crédité sur la 1re séance (question 34). Exonération possible avec une raison (PAE, IVAC, entente).
- **Consentement « liste d'attente »** (un des 7 modèles, §2.2) envoyé à l'inscription ; l'inscription est **« Incomplète »** tant que le consentement n'est pas signé ou les frais réglés (ou exonérés), puis **« Active »**.
- **Attente affichée :** jours depuis l'inscription, et l'**attente moyenne** de la liste (inscription → placement, sur 12 mois) comme estimation pour la conseillère, jamais promise au client.
- **Suivi périodique :** une tâche quotidienne (`demandes.waitlist_followup`, heure de la clinique) marque **« À rappeler »** chaque inscription active sans contact depuis N semaines (8 par défaut, question 35) et l'annonce dans la cloche des conseillères ; en option, un **courriel au client** « Souhaitez-vous rester sur la liste d'attente ? » avec deux liens sécurisés (Oui / Non) ; sans réponse en 14 jours → « Sans réponse » à rappeler.
- **Quand une place se libère** (un pro ajoute des disponibilités ou des places pour nouveaux clients, une série se termine ou s'annule, un nouveau pro de la profession est activé) : avis « Place disponible » dans la cloche ; le panneau de jumelage montre les **inscrits compatibles** dans l'ordre de la liste (filtres durs de Professionnels : clientèle, langue, âge minimum, « Femmes seulement », mode, disponibilités) ; la conseillère choisit, puis **« Offrir la plage »** : un courriel avec 1 à 3 plages et un **lien limité dans le temps** (48 h, question 38) ; l'acceptation réserve le rendez-vous et place le client ; un refus ou l'expiration passe au suivant. **Partie 1 (avant la bascule) :** inscription, frais, consentement, ordre, relances, sorties, offre par téléphone notée à la main. **Partie 2 (après) :** suggestions automatiques et offre par lien.
- **Sortie de la liste, avec une raison :** Placé à la clinique, Orienté ailleurs, Ne souhaite plus, Sans réponse, Autre ; date et conseillère gardées.
- **Rapports :** longueur de la liste par profession et par pro, attente moyenne et médiane, entrées et sorties par mois et par raison (Rapports, §2.8).
- **Import :** la liste de GOrendezvous étant vide, **l'import = les faux rendez-vous** « Inscription – Liste attente … » (51 en 2026, plus les années précédentes encore actives) et « LISTE ATTENTE À RAPPELER » de l'agenda « conseillère », pris dans l'export des rendez-vous du support : date d'inscription = date du faux rendez-vous ; frais réglés si une facture existe ; doublons fusionnés par client (§2.7).
- **Modèle de données :** `waitlist_entries` (demande, client, cible : `profession_title_id` ou `professional_id`, priorité et raison, inscrit le, état `incomplete` / `active` / `to_call` / `offered` / `closed`, critères, pro « pont », `fee_status` (`to_invoice` / `invoiced` / `paid` / `waived`), `fee_invoice_id`, consentement, dernier contact, raison et date de sortie, `external_ref`), `waitlist_contacts` (appel, courriel de suivi, réponse), `waitlist_offers` (plages offertes, lien, expire le, réponse). Lecture : `demandes.view` ; un pro lit les inscriptions qui le visent (`demandes.self`, sans note interne).

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
  - **Deux boîtes dès le départ (décidé, Christine, réponse 6) :** `info@cliniquemana.com` (les clients) et **`administration@cliniquemana.com`**, où arrivent les **avis de virement Interac** : la synchro lit chaque avis (montant, nom de l'expéditeur, message) et le publie à Facturation pour le rapprochement (« À rapprocher », §2.6). Boîtes personnelles ensuite.
  - **De GOrendezvous** ([visite §6, §15, §17](../research/2026-10-11-gorendezvous-tour.md)) : les **courriels automatiques** du parcours client deviennent des modèles du socle, en français et en anglais (langue du client) : confirmation, rappel, modification, annulation (par la clinique ou le client), invitation de liste d'attente, facture avec « PAYER », reçu, demande de consentement. Message par clinique, par professionnel ou par service, comme GOrendezvous. Ces envois partent par **Resend** (transactionnel) depuis Rendez-vous et Facturation, pas par Gmail. Les **consentements signés** (7 modèles, versionnés, règle des 14 ans) sont dans Clients (§2.2). Remerciement et sondage : désactivés chez MANA, non repris.
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
- **Taille :** **XL (22–27 jours)** : synchro Gmail et boîte 12–15, composeur 5, modèles 2, IA 3–4. En voie B, en deux lots : **(a) avant la bascule** (12–21 octobre : branchement de `info@`, synchro et un écran d'état de la synchro pour les essais ; il ne dépend que du socle) ; **(b) après la bascule** : boîte à l'écran et rattachement aux clients, composeur, envoi Gmail, modèles, IA. La boîte à l'écran a glissé après la bascule pour faire place à la liste d'attente avant le 11 janvier.
- **Questions :** 27, 28, 29, 30.

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

  Le traitement régional (projet canadien) ajoute 10 % pour les modèles sortis depuis le 5 mars 2026. Recommandation : `gpt-5.4` par défaut, après un essai de 20 brouillons contre `gpt-4o` et `gpt-5.4-mini` (question 29).
- **Loi 25 avec OpenAI :**
  - les données **quittent le Québec** ; OpenAI offre la résidence des données **au Canada** pour un projet API admissible (données au repos ; l'inférence au Canada **n'est pas confirmée**) : créer le projet dans la région Canada si le compte y est admis ;
  - demander la **rétention zéro** (ZDR) pour le projet, ou à défaut confirmer par écrit que les données de l'API ne servent pas à l'entraînement (c'est le régime par défaut de l'API) et la durée de conservation pour la surveillance des abus ;
  - **EFVP** (art. 17) mise à jour par Christine, et OpenAI ajouté aux sous-traitants de la politique de confidentialité ; comme aucun renseignement de client n'est envoyé, l'analyse reste simple (question 28).
- **Taille :** 3–4 jours (le SDK `openai` alourdit chaque fonction, ADR 0008 : à mesurer ; sinon un client `fetch` minimal dans `_shared/ai/`).

#### 2.4 quater Textos (SMS) avant la bascule (décidé par Jonathan, 2026-10-12 : « oui, les SMS avant la bascule »)

- **Pourquoi :** GOrendezvous envoie ~165 rappels par texto par mois, et Christine : « nous aimons bien les textos » (réponse 3) : souvent l'ado reçoit le texto et le parent le courriel. Sans SMS à la bascule, ces clients perdaient leur rappel ; question 43 close.
- **Ce qui est livré avant la bascule (transactionnel seulement) :**
  - **rappels par texto** avec la même règle que le courriel (1 jour ouvrable avant, jamais la fin de semaine, aux heures ouvrables, §2.5) ; confirmation et modification aussi par texto si le client le préfère ;
  - **préférence de canal par personne** (comme GOrendezvous) : texto et / ou courriel, **sur le client et sur chaque proche** (l'ado reçoit le texto, le parent le courriel, réponse 3) ;
  - **réponse « OUI » pour confirmer** (lue par le webhook entrant, met le rendez-vous « confirmé par le client ») ;
  - **« ARRÊT » / « STOP »** traités (retrait immédiat, confirmation par texto, plus jamais de texto à ce numéro sans nouveau consentement) et **consentement enregistré** (LCAP : quand, comment, par qui) ;
  - une **vue des fils** par numéro pour lire les réponses (« Textos reçus ») ; les conversations à deux voies (écrire librement à un client) restent **plus tard**.
- **Transport : la centrale téléphonique Yeastar P-Series, par son OpenAPI, comme PS Hub** (décidé par Jonathan, 2026-10-12 : « on va utiliser le même système que PS Hub pour les textos »). PS Hub envoie ses textos par la centrale (`supabase/functions/_shared/yeastar.ts`, `yeastar-send-sms`, `yeastar-webhook`) : jeton d'accès de l'application OpenAPI rafraîchi, envoi par canal et DID (`yeastar-send-sms/index.ts:135-154`), réception et accusés par webhook signé (`yeastar-webhook/index.ts:874-895`). **Question ouverte (53) :** une **centrale propre à la clinique** (ses données restent chez elle, mais une centrale et un DID SMS à commander) ou un **DID dédié sur la centrale de PS** (prêt en un jour, mais le trafic de la clinique passe par l'infrastructure de PS : à encadrer par une entente de sous-traitance, Loi 25). **Ce que Jonathan fait (§3.4, « Mise en service ») :** choisir, puis fournir l'application OpenAPI (identifiant et secret), le secret de webhook, le DID SMS et son indicatif. Essai réel le 19 octobre.
- **Repris de PS Hub :** le client OpenAPI et le rafraîchissement du jeton (`_shared/yeastar.ts:191-202`, `:315-334`), l'envoi par DID et la journalisation des échecs (`yeastar-send-sms/index.ts:135-154`, `:187-214`), le webhook signé et la réception des textos (`yeastar-webhook/index.ts:738-745`, `:874-895`), les fils par les 10 derniers chiffres (`src/lib/sms/conversations.ts:1-40`), la vue des fils (`src/components/crm/sms/`) ; **pas copié :** l'absence de STOP et de consentement (seul un interrupteur `allow_sms`, `yeastar-send-sms/index.ts:85-93`), le lien aux opportunités.
- **Données :** `sms_consents` (personne, numéro, accordé le, source, retiré le), `sms_messages` (direction, numéro haché pour la recherche, statut, corps effacé après 12 mois), `appointment_reminders.channel = 'sms'` (déjà prévu), `contact_channel_preferences` (client ou proche : courriel, texto, les deux), `sms_settings` (adresse de la centrale, DID, heures d'envoi). Fonctions : `sms-send` (service, appelée par les rappels, jeton Yeastar chiffré et rafraîchi), `sms-webhook` (webhook Yeastar, signature vérifiée avec `timingSafeEqual`, réponses « OUI » et « ARRÊT », accusés de livraison, une limite par IP d'abord), journal des envois sans corps (`sms_log`).
- **Loi 25 et LCAP :** le texto porte le prénom, la date et l'heure, le lien de confirmation ; jamais le motif ni le nom du professionnel sans accord ; la centrale (et PS, si DID dédié) ajoutée aux sous-traitants.
- **Taille :** M (6 jours), voie C, 19–26 octobre (infrastructure), puis 1 jour dans le lot des rappels de Rendez-vous (branchement du canal).

### 2.5 Rendez-vous — agenda, disponibilités, rappels (`appointments`) — XL

- **But :** remplacer l'agenda de GOrendezvous : les pros déclarent leurs disponibilités, les conseillères réservent le premier rendez-vous depuis la demande, les suivis se planifient (hebdo, aux deux semaines, mensuel), les rappels partent seuls, les annulations tardives vont à Facturation.
- **Utilisateurs :** professionnels (« Mon agenda », disponibilités) ; conseillères (réservent, déplacent) ; adjointe (vue d'ensemble, annulations) ; client (confirmations, rappels).
- **Fonctionnalités :**
  - Garder (§E) : vues semaine (puis jour, mois, liste) ; glisser pour créer un bloc, déplacer, redimensionner ; blocs disponible / pause / bloqué / vacances ; éditeur (participants, service, durée, statut créé → confirmé → terminé, ou annulé) ; annulation avec raison, frais si moins de 24 h ; « Client absent » ; lien profond ; occupations Google (freeBusy) ; journal.
  - Changer : **tout à l'heure de la clinique** (l'ancienne mélangeait navigateur et clinique, §E) ; contrôles **dans la base** (dans une disponibilité, service permis, aucun chevauchement par contrainte d'exclusion), jamais appelés dans l'ancienne ; « terminé » posé par une tâche planifiée ; occupations Google en lecture seule (l'ancienne les laissait déplacer).
  - **Parité avec GOrendezvous** ([visite §1, §6, §17](../research/2026-10-11-gorendezvous-tour.md)) :
    - **vues** Jour, Semaine, Prochains jours, Mois ; tous les pros, ceux d'un service, un seul pro ; intervalle de la grille réglable ; cacher les noms ;
    - **disponibilités** en mode d'édition à part : horaire récurrent par défaut, copiable ; exceptions (Jour férié, Vacances, Autre ; « Je suis en vacances toute la semaine ») ; plage visible ou non des clients ; débordement permis ou non ; services permis par plage ; création rapide ;
    - **éditeur :** client (+ « Deuxième personne » pour un service à deux), date, heure, durée, service, pro, mode (vidéo / téléphone), « rendez-vous pour le travail » ; onglets Participants, Facturation, Notes, Actions, Historique ; boutons « Démarrer » (Zoom), « Facture », « Reçu », « Répéter », « Annuler le rendez-vous » ;
    - **états :** en attente d'acceptation (hachuré), rappel envoyé, confirmé par le client, présent / absent (par participant : Sera présent, Présent(e), Absent(e)), annulé, « garder à l'horaire », supprimé ;
    - **raisons d'annulation :** Non spécifiée, Plus requis, Urgence personnelle, Urgence familiale, Urgence au travail, Insatisfaction, Autre (COVID-19 retirée) ; option « garder à l'horaire » ; annulation tardive ou absence → **ligne de frais proposée, confirmée par l'adjointe** (§2.6 : les données montrent que la politique 50 % / 100 % n'est jamais appliquée telle quelle ; l'automatisation attend ton feu vert explicite, question 23) ;
    - **récurrence :** chaque semaine ou aux 2 à 12 semaines, pendant N séances, jours cochés, **contrôle des conflits** (« ignorer les conflits » explicite), participants inclus ; une série ne se répète pas deux fois ;
    - **rendez-vous personnel** (privé, « occupé » pour les collègues) ;
    - **séance de 50 min réservée en plage de 1 h** : « pause après » de 10 min réglée par service (question 6) ;
    - **heures d'ouverture (décidé, Christine, réponse 1) :** lundi au vendredi, 8 h à 17 h, un réglage de la clinique ; des rendez-vous se prennent le soir et la fin de semaine ; **les rappels partent aux heures ouvrables** ;
    - **rappels par courriel et par texto** (SMS avant la bascule, Jonathan, §2.4 quater) : **1 jour ouvrable avant, jamais la fin de semaine** (réglage réel de GOrendezvous, visite §18 : le rappel du lundi part le vendredi), selon la préférence de canal de chaque personne (l'ado le texto, le parent le courriel) ; **un rendez-vous non confirmé la veille ne déclenche rien** (décidé, Christine, réponse 2 : aucun drapeau pour la conseillère) ;
    - **lien dans les courriels : confirmer seulement, en v1.** Les données montrent que presque tous les pros ont « les clients doivent appeler pour annuler : en tout temps » (visite §18) ; le courriel dit donc « Pour modifier ou annuler, appelez la clinique au … », sans lien d'annulation ; le lien d'annulation avec la règle des 24 h reste prévu en option par pro ou clinique, activable plus tard (R-39, révisable) ;
    - **audit** de chaque changement.
  - Changé par rapport à GOrendezvous : la « Raison / Notes » d'un rendez-vous, **visible du client** chez GOrendezvous, devient deux champs : une note interne (jamais envoyée) et un message au client (explicite) ; un compte par conseillère au lieu du compte partagé ; pas de salles, d'équipements, de cours de groupe ni de lieux physiques : **confirmé par les données** (8 635 visites : vidéo 7 681, téléphone 5, en personne ≈ 85 ; les 911 « Bureau administratif » sont vraisemblablement les entrées du compte conseillère, à expliquer à l'import). Les propositions sont acceptées automatiquement chez tous les pros et GOrendezvous n'a aucun délai d'expiration : notre délai de 48 h est un choix à nous.
  - Nouveau : places restantes branchées sur les premiers rendez-vous confirmés (règle 11 de Professionnels) ; plages réelles pour le jumelage ; propositions de rendez-vous avec lien d'acceptation (question 7).
- **Repris de PS Hub :** **adapter l'interface, construire le moteur.** Son calendrier n'est pas un moteur de rendez-vous : c'est la liste de tâches CRM (`crm_tasks`), une copie du Google de chaque vendeur et les installations, dessinées par des vues maison. Aucune disponibilité, réservation, récurrence propre (Google déroulé en occurrences : `calendar-sync/index.ts:415`) ni rappel envoyé.
  - Pris : vues Jour / Semaine / Mois / « Horaire » 30 jours sans librairie (`src/pages/Calendar.tsx:63-110`) ; glisser-déposer par Pointer Events, aimanté aux 15 min, d'un jour à l'autre, position provisoire (`src/components/calendar/CalendarTimeGridView.tsx:225-312`, `:156-202`) ; création au clic (`:336-359`) ; avertissement de chevauchement (`CalendarEventDialog.tsx:222-237`) ; agenda d'un collègue pour un administrateur (ADR 0027, `Calendar.tsx:166-182`) → une conseillère voit l'agenda d'un pro ; synchro Google incrémentale par `syncToken`, repli complet au 410 (`supabase/functions/calendar-sync/index.ts:438-442`).
  - Changé : grille placée **à l'heure locale de la clinique** ; PS Hub place en minutes depuis minuit (`CalendarTimeGridView.tsx:100-110`), donc décale d'une heure les jours de changement d'heure, et affiche l'heure du navigateur (`src/hooks/useCalendarItems.ts:14-18`) ; période filtrée par **chevauchement**, pas par début (PS Hub perd les événements de plusieurs jours : `useCalendarItems.ts:216-217`) ; écritures par RPC en une transaction (PS Hub : deux appels, erreur du `delete` ignorée : `src/hooks/useCrmTasks.ts:612-636`) ; redimensionnement (absent) ; jetons Google **chiffrés** et illisibles du client (en clair chez PS Hub : `baseline.sql:21286-21301`) ; `state` OAuth signé et expirant (non signé : `google-calendar-oauth/index.ts:51`, `google-calendar-callback/index.ts:39-45`) ; déconnexion qui révoque chez Google (`useCalendarConnection.ts:105-111` ne fait que `is_active=false`).
  - Pas copié : la synchro qui lit encore `crm_tasks.google_event_id` alors que la poussée écrit dans `crm_task_assignees` (`calendar-sync/index.ts:324-329` vs `calendar-push-task/index.ts:565-580`) ; `action: "delete"` sans lien vérifié avec la tâche (`calendar-push-task/index.ts:800-806`) ; `reminder_at` jamais lu ; **le miroir complet du Google personnel visible des administrateurs** (`docs/adr/0027-admin-view-team-calendars.md:54-60`) : nos pros ont une pratique privée, on n'importe qu'**occupé / libre**, jamais un titre ni un participant.
- **Visio : un « lien de visio » par professionnel, Zoom ou lien fixe (décidé par Jonathan le 2026-10-11, précisé par Christine le 2026-10-12, réponse 4).** Les pros utilisent **Teams, Google Meet ou Zoom**, chacun paie son abonnement ; ceux qui ne sont pas sur Zoom envoient leur lien à la main aujourd'hui. Chez nous, chaque pro choisit dans « Mon agenda » → carte **« Vidéoconférence »** :
  - **Zoom** : **« Connecter mon Zoom »** (OAuth) ; un lien est créé pour chaque rendez-vous sur son compte, mis à jour au déplacement, supprimé à l'annulation ; ou
  - **Lien fixe** : l'adresse de sa salle personnelle (Meet, Teams ou autre), **insérée automatiquement** dans la confirmation et le rappel de chacun de ses rendez-vous vidéo, et sous « Démarrer » ; c'est une option à part entière, pas un repli.
  - Dans les deux cas, le client reçoit le lien dans la confirmation et le rappel ; le rendez-vous affiche « Lien prêt » / « Lien à créer » ; un pro sans lien de visio déclenche un **avertissement avant de réserver en vidéo** (« Ce professionnel n'a pas de lien de visio : le client le recevra plus tard. »), jamais un blocage.
  - **Zoom, le branchement :** `state` OAuth signé (HMAC, nonce, 10 min), retour vers `APP_URL` ; jetons **chiffrés** comme ceux de Gmail (`private.encrypt_pii`), jamais rendus au navigateur, rafraîchis par une tâche horaire ; échec de rafraîchissement → « À reconnecter » (avis au pro et aux conseillères) ; « Déconnecter » révoque chez Zoom et marque les rendez-vous à venir « Lien à créer » ; le webhook de désautorisation de Zoom est vérifié par signature ; application OAuth de la clinique (question 41).
  - **Ce que voit le personnel :** Paramètres → **« Vidéoconférence »** (chaque pro : Zoom connecté / lien fixe / aucun / à reconnecter, filtre, « Relancer ») et une pastille dans le choix du pro de l'agenda ; rapport « Professionnels prêts pour la bascule ».
  - **Loi 25 :** aucun nom de client chez Zoom (titre « Rendez-vous MANA ») ; Zoom ajouté aux sous-traitants ; un lien fixe est une adresse, rien de plus.
  - **Taille :** Zoom 6 jours en voie B (lot RZ) ; lien fixe 1 jour (dans les lots R4 et R5 : insertion dans les courriels, carte du pro).

- **Modèle de données :**
  - `availability_rules` (jour, heures **locales**, services permis, du … au …) et `availability_exceptions` (congé, bloc ponctuel).
  - `appointment_series` (chaque semaine ou aux 2 à 12 semaines, jours cochés, nombre de séances, fuseau ; conflits ignorés notés).
  - `appointments` (pro, service, début / fin `timestamptz`, mode, état, série, raison et détails d'annulation, « garder à l'horaire », note interne, message au client, personnel, pour le travail) avec contrainte d'exclusion `tstzrange` par pro sur les états actifs ; `appointment_participants` (client, rôle, présence : Sera présent / Présent(e) / Absent(e), confirmation du client).
  - `cancellation_reasons` (liste de départ ci-dessus, modifiable).
  - `video_connections` (un compte Zoom par pro : compte Zoom, état `connected` / `needs_reconnect` / `disconnected`, jetons chiffrés, expiration, ADR 0004) ; `video_tasks` (file créer / modifier / supprimer) ; `appointments.video_url`, `video_external_id`, `video_status` (`ready` / `pending` / `failed`).
  - `calendar_connections` et `external_busy_blocks` (occupé / libre Google, après la bascule).
  - `appointment_reminders` (canal `email`, prévu le, envoyé le, statut ; idempotent) ; `appointment_actions` (lien de confirmation en v1 ; modifier / annuler prévus, désactivés par défaut : purposes du socle) ; vue **« Clients sans rappel »** (rendez-vous à venir dont aucun canal n'a abouti : ni courriel ni texto), pour que les conseillères les appellent.
  - Publie : `get_open_slots(pro, from, to, service)`, `appointments_for_billing`, `first_appointments_confirmed`, `client_visits(client)`.
- **Intégrations :** socle (`runJob` pour rappels et « terminé », courriel Resend, liens sécurisés, notifications), Zoom (OAuth par pro), Google (occupé / libre, après la bascule).
- **IA :** aucune.
- **Dépendances :** Clients, Professionnels, Services et tarifs.
- **Taille :** XL : **21 jours en voie A avant la bascule** (disponibilités et vues ; réservation avec la règle du solde ; états, annulations ; récurrence ; rappels courriel et texto, liens, lien de visio fixe ; « Mon agenda »), **Zoom par pro 6 jours en voie C** ; après la bascule : occupé / libre Google (3 jours).
- **Questions :** 6, 7, 8, 41 (questions 4, 5, 23 et 43 répondues). **La réservation refuse un client avec un solde** (décidé, Christine : règle de Facturation, §2.6, dérogation par l'adjointe).

### 2.6 Facturation et paiements (`billing`) — XL

- **But :** facturer chaque séance réalisée **chaque matin, en file, en un clic**, encaisser (Interac, carte au dossier, lien de paiement), envoyer le reçu, relancer les impayés, facturer l'IVAC et les PAE, et produire **la paie des professionnels** le 1er du mois (prix client × (1 − rétention), déjà calculé par Professionnels). Les réponses de Christine du 2026-10-12 ([recherche](../research/2026-10-12-christine-answers.md)) fixent le parcours ci-dessous ; ce qui est marqué **décidé** n'est pas révisable.
- **Utilisateurs :** adjointe (la file du matin, les paiements, les relances) ; administration (paie, payeurs, QuickBooks) ; professionnel (« Ma paie », frais d'annulation à appliquer ou non, ses reçus) ; client et payeur (facture et reçu par courriel).
- **Fonctionnalités :**
  - Garder (§F, §G) : lignes, TPS et TVQ par ligne, statuts brouillon → en attente → partielle → payée / annulée, frais d'ouverture, numérotation, rapport IVAC.
  - Changer : taux datés du socle mémorisés sur la facture ; total 0 n'est plus « annulé » ; reçu PDF **rendu sur le serveur** (pdfmake, ADR 0008) ; notes de crédit au lieu d'annuler une facture payée.
  - **La file du matin (décidé, Christine, réponse 5) : le gain d'efficacité principal.** Aujourd'hui, la clinique crée et envoie chaque matin, une par une, la facture et le reçu de chaque séance de la veille ; les corrections sont faites le lendemain matin et renvoyées. Chez nous : une **tâche de nuit** construit les **brouillons** des séances de la veille (présence marquée ou heure de fin passée, service et prix du catalogue, payeur du dossier), puis **« File du matin »** pour l'adjointe : relire, ajuster (ligne, montant saisi, payeur, note), **envoyer en un clic, ou tout envoyer** ; les dossiers à **« Entente particulière »** (réponse 8 : l'ancienne « facturation personnalisée » ou « entente de paiement », un drapeau et une note sur le dossier) **s'arrêtent dans la file pour validation** ; une correction après envoi crée une note de crédit et une facture corrigée, renvoyées le lendemain matin. Le reçu part dès le paiement enregistré.
  - **Paiements (décidé, réponse 6) :**
    - **Virement Interac** : les avis arrivent à `administration@cliniquemana.com` ; la **synchro Gmail de cette boîte** (Communications, §2.4) lit chaque avis (montant, expéditeur, message) et alimente **« À rapprocher »** : l'adjointe associe l'avis à une facture en un clic ; compte QuickBooks **« 1075 Virement bancaire à recevoir »** ;
    - **carte au dossier (Stripe)** : quand le client l'accepte, **la clinique prélève la carte le lendemain du rendez-vous** ; chez nous, la carte est enregistrée par Stripe (jamais chez nous), et **le prélèvement du lendemain est automatique** pour les factures envoyées de la file, avec reçu ; compte **« 1070 Banque Stripe »** ; ce qui était « après la bascule » passe **avant** (lot FS, +3 jours) ;
    - **lien « PAYER »** (Stripe) pour les autres ;
    - **« Argent comptant » de GOrendezvous = paiements par carte via QuickBooks Payments** (réponse 6 ; la clinique ne sait pas pourquoi GOrendezvous écrit « comptant ») : à l'import, ces paiements deviennent **« Carte (QuickBooks Payments) »**, un mode gardé pendant la transition ; question 45 close.
    - **Remboursements** et **notes de crédit** gérés.
  - **Impayés (décidé, réponse 7) :** **relances à 3, 5, 7 et 10 jours** (courriel, modèles du socle) ; **un client avec un solde se voit refuser un nouveau rendez-vous** : règle dure à la réservation, avec **dérogation par l'adjointe** (raison notée) et **avis à la conseillère et au professionnel**.
  - **Frais d'annulation et d'absence (décidé, réponse 9) :** **le professionnel décide** d'appliquer ou non les frais ; la ligne est proposée au pro dans « Mon agenda » (« Appliquer les frais » / « Ne pas facturer »), ou décidée par l'adjointe en son nom ; s'il les applique, **30 % lui reviennent, seulement une fois la facture payée** (règle de paie ci-dessous). La politique à deux paliers (50 % puis 100 %) reste le barème proposé ; question 23 close.
  - **Stagiaires (décidé, réponse 10) :** le reçu porte **le nom, l'ordre et le numéro de permis du superviseur** : un champ **« Superviseur »** sur le professionnel (petite migration de Professionnels), lu par le reçu.
  - **Parents séparés (décidé, réponse 11) :** **on ne divise pas les factures** ; le payeur est choisi **par facture** parmi les proches ayant le droit « recevoir reçus et factures » ; les deux parents sont au dossier. L'idée de parts (50 / 50) est retirée (§2.6 bis) ; question 42 close.
  - **IVAC (décidé, réponse 12) :** l'IVAC paie **94,50 $ par séance** et **l'écart est facturé au client** ; **facturation mensuelle à l'IVAC, une facture par client**, avec son numéro de dossier et les dates des rencontres ; des rédactions de rapport sont aussi facturables à l'IVAC.
  - **PAE (décidé, réponses 12 et 13) :** **aucun programme PAE de MANA** : seulement des ententes avec des fournisseurs de PAE qui confient des clients ; **une entente par client** (montant par séance, parfois 100 %, souvent un montant maximum renouvelable le **31 mars**) ; au plus ~3 factures pour une entente de 800 $ ; **le PAE doit être facturé début avril pour fermer l'année**. → Le lot **payeurs tiers (FP) est nécessaire avant l'IVAC de janvier** ; en décembre, IVAC et PAE se font comme aujourd'hui dans QuickBooks, avec une note sur la facture client à 0 $.
  - **Paie des professionnels (décidé, réponse 14) : un lot à part, « Paie » (FPay).** Le 1er du mois, un **sommaire des compensations par professionnel** à partir des séances réalisées du mois : tarif de la grille de reconnaissance (Professionnels) ; **chaque rencontre réalisée est payée** ; IVAC et PAE au même taux que les honoraires réguliers ; **absences et annulations à 30 %, seulement quand le client a payé** (sans délai pour verser le pro ensuite) ; **rapports et discussions avec un intervenant externe à 15 %**. Le pro **valide dans « Ma paie »** et **téléverse sa facture** (ou la génère depuis le sommaire) ; l'administration marque le versement ; la facture du pro va dans QuickBooks en dépense **classée par spécialité**. Remplace les sommaires que Christine fait à la main avec Claude. Premier sommaire : **novembre 2026, le 1er décembre** (séances importées de GOrendezvous).
  - **QuickBooks (décidé, réponse 17) :** factures clients → compte de revenus **« Services »** ; ouvertures de dossier → **« Ventes »** ; factures des professionnels → **comptes de dépenses par spécialité** (psychologie, travail social, orientation…) ; paiements selon les comptes déjà mappés (Interac 1075, Stripe 1070, carte QuickBooks Payments → fonds non déposés, chèque et virement → compte courant).
  - **Taxes (décidé, réponses 15 et 16) :** la liste pratiquée est conforme (ouverture de dossier, liste d'attente, supervision, déplacement, naturopathie taxés ; sexologie et orientation **non taxées**, question 46 close) ; **« Statut Indien » = exemption de taxes**, un champ du dossier client (question 13 close).
  - **De GOrendezvous, gardé** ([visite §5](../research/2026-10-11-gorendezvous-tour.md)) : plusieurs lignes par facture ; facture sans rendez-vous (frais d'inscription, §2.3 bis) ; **numérotation `AAAA-N`** qui continue celle de GOrendezvous ; **reçu** (numéro unique pour la clinique, clinique, titre du pro, « Membre de l'OTSTCFQ / OPQ : n° », adresses, signature, numéros de taxes) ; **relevé annuel** par client.
  - Abandons **confirmés par les données** : TELUS eRéclamations, Lumino Santé, cartes de visite, modes Accès D, PayPal, Square, assurance, « seulement TPS », dépôts Stripe par service (seule la carte au dossier est gardée).
- **Repris de PS Hub :** **porter le connecteur QuickBooks Online (décidé par Jonathan, 2026-10-11), construire la facturation clinique.**
  - Pris : le branchement OAuth (`quickbooks-oauth`, `quickbooks-callback`), la création de factures (`quickbooks-create-invoice/index.ts:363-523`), la synchro des paiements et la reprise (`sync-qbo-invoices`, `sync-single-qbo-payment`, `qbo-sync-cron`, `qbo-resync-worker`), la gestion des articles (`quickbooks-manage-item`, `quickbooks-sync-items`), le PDF (`qbo-download-invoice-pdf`).
  - **Ce qui se synchronise (l'app est la source) :** clients → QBO (payeur parent, sous-client par dossier, §2.6 bis) ; factures → QBO (article par code de service, compte « Services » ou « Ventes ») ; paiements → QBO (compte selon le mode) ; factures des pros → dépenses par spécialité (FPay) ; QBO → app : identifiants et état seulement.
  - **Failles corrigées :** jetons QuickBooks **en clair** (`baseline.sql:20624-20634`) et lisibles par les super-utilisateurs via la RLS (`:30387`) → chiffrés, RPC `service_role` seulement, `revoke` ; `state` OAuth non signé (`quickbooks-oauth/index.ts:47`, `quickbooks-callback/index.ts:29-30`) → signé et expirant ; tâche appelée avec la clé `service_role` (`qbo-sync-cron/index.ts:435`) → `runJob` et `X-Job-Signature`.
  - Pas copié : ni Stripe ni reçu de séance n'existent chez PS Hub ; factures SOMA, projets QBO et devis sont propres à Pergolas Signature.
- **Modèle de données :** `invoice_drafts` (la file du matin : séance, brouillon, état « à valider » / « prêt » / « envoyé », motif d'arrêt), `invoices`, `invoice_lines`, `credit_notes`, `payments`, `refunds`, `interac_notices` (avis lus dans `administration@` : montant, expéditeur, message, rapproché à), `stripe_customers` (identifiant Stripe du payeur, carte au dossier oui / non, jamais le numéro), `dunning_runs` (relances 3 / 5 / 7 / 10 jours), `payer_organisations` (IVAC, fournisseurs de PAE), `payer_agreements` (entente PAE par client : montant par séance ou %, maximum, renouvellement, cadence), `payer_invoices` (factures mensuelles IVAC et PAE), `professional_payout_periods`, `professional_payout_lines` (séance, taux de la grille, règle 100 % / 30 % / 15 %, payable quand), `professional_invoices` (fichier téléversé ou généré), `payment_modes` ; pour QuickBooks : `qbo_connection`, `qbo_links`, `qbo_customer_matches`, `qbo_sync_queue`. Publie `client_balance(client)` et `private.client_has_balance(client)` (règle de refus de Rendez-vous), `billing_summary`, `revenue_*`, `create_service_invoice(…)` (Demandes).
- **Intégrations :** socle (taxes, fichiers, PDF serveur, courriel avec pièce jointe, webhooks, `runJob`), Professionnels (`get_professional_compensation`, superviseur), Communications (avis Interac de `administration@`), Stripe (cartes au dossier, prélèvement, lien), **QuickBooks Online**.
- **IA :** aucune.
- **Dépendances :** Rendez-vous, Clients, Services et tarifs, Professionnels, Communications (boîte `administration@`).
- **Taille :** XL : **19 jours en voie A avant la bascule** (factures et lignes 5 ; **file du matin**, paiements, reçus, relevé 7 ; impayés, refus de rendez-vous, frais décidés par le pro, remboursements 4 ; superviseur, ententes particulières 1 ; Revenus 2) ; **Stripe (carte au dossier et prélèvement du lendemain) et Interac 7 jours, QuickBooks 8 jours en voie B** ; après la bascule : **Paie (FPay) 6 jours** avant le 1er décembre, **payeurs tiers (FP) 6 jours** avant début février.
- **Questions :** 21, 24, 25, 26 (closes : 22, 23, 42, 45, 46).

#### 2.6 bis « Facturé à » : le client et le payeur (décidé par Jonathan, 2026-10-11 ; complété par Christine, 2026-10-12)

- **Ses mots :** « pour QBO, je crois que le mieux c'est d'avoir un client "facturé à" et, dans QBO, un sous-client par dossier. C'est possible, pour un enfant par exemple, que le dossier soit au nom du client mais la facture au père ou à la mère. »
- **Deux notions séparées :** le **client**, la personne servie (le dossier, `client_id`) ; le **payeur**, **« Facturé à »** : le client lui-même (par défaut), une **personne liée** avec le droit « recevoir reçus et factures » (parent, tuteur), ou une **organisation** (IVAC, fournisseur de PAE ; §2.6).
- **Payeur par défaut** sur le dossier, **choisi par facture** au besoin (file du matin). **Parents séparés (décidé, Christine) : la facture n'est pas divisée** ; elle est adressée tantôt à la mère, tantôt au père, les deux étant au dossier ; aucune notion de part.
- **Facture et reçu :** la facture est adressée au payeur ; le **reçu nomme la personne servie et le payeur** (« Services rendus à : … · Payé par : … »), avec le professionnel (ou **son superviseur** pour un stagiaire), son ordre et son permis, la date, la durée, le service, le montant payé, le numéro de reçu, l'adresse de la clinique et les numéros de taxes ; les mentions exigées par les assureurs sont vérifiées avec Rachel sur un échantillon (lot F2).
- **Dans QuickBooks :** payeur = client QBO parent ; chaque dossier = sous-client « facturé avec le parent » ; **un sous-client par paire (payeur, dossier)**, jamais re-parenté (QuickBooks déplacerait l'historique) ; nom « N° de dossier · Prénom N. » ; les clients QBO créés par GOrendezvous sont **rapprochés, jamais recréés** (lot FQ) ; l'historique de GOrendezvous reste sous ses clients actuels.
- **Modèle de données :** `invoices.client_id`, `payer_kind` (`self` / `person` / `organisation`), `payer_client_id` ou `payer_organisation_id` ; `billing_payer_defaults` (dossier → payeur, daté) ; `qbo_links` (payeur → client QBO parent ; (payeur, dossier) → sous-client). Une vérification en base refuse un payeur « personne » sans le droit « recevoir reçus et factures » sur ce dossier.

### 2.7 Importation GOrendezvous (étape à part) — M–L

- **But :** tout ramener de GOrendezvous à la bascule (décidé par Jonathan, 2026-10-11) : **7 390 clients actifs et ~1 078 archivés** (2 635 actifs sans professionnel principal ; 31 étiquettes, dont « IVAC » et « Nouveau client » en double), **tout l'historique de rendez-vous** (8 635 visites en 2026), ~28 000 factures (≈ 8 000 en 2026) et leurs 7 154 paiements, la correspondance des ~64 profils d'employés avec nos professionnels (visite §18). **Jamais de notes cliniques** (GOrendezvous n'en a aucune : [visite §10](../research/2026-10-11-gorendezvous-tour.md)).
- **Utilisateurs :** Jonathan (lance), un agent (prépare et rapporte), Christine et l'adjointe (vérifient des dossiers).
- **D'où vient chaque donnée** ([visite §11](../research/2026-10-11-gorendezvous-tour.md)) :

| Donnée | Source | Format | Remarque |
|---|---|---|---|
| Clients | « Exporter mes clients », liste globale (propriétaire du compte seulement) | Excel, différé | Relations, assurances, étiquettes et archivés à vérifier dans l'export |
| Factures, lignes, paiements | « Revenus » → Exporter (par facture, par service, par paiement) **et / ou QuickBooks** | Excel | L'export n'a que les factures non annulées ; QuickBooks a tout |
| **Historique des rendez-vous** | **Support de GOrendezvous seulement** (aucun export dans l'app) | à négocier | **À demander maintenant** (question 1) |
| Faux rendez-vous « Inscription – Liste attente … » (51 en 2026) et « LISTE ATTENTE À RAPPELER » du compte conseillère | Export des rendez-vous du support (la liste d'attente de GOrendezvous est vide) | — | Deviennent des inscriptions de liste d'attente (§2.3 bis) ; les 911 visites « Bureau administratif » du même compte sont à qualifier (appels découverte, inscriptions, annulations) |
| Annulations, clients à relancer | Impressions → Exporter | Excel | Pour Demandes et Rapports |
| Clients QuickBooks créés par GOrendezvous | API QuickBooks | — | Rapprochés avant tout envoi, jamais recréés (§2.6 bis) |
| Reçus d'assurance, consentements | PDF un par un | PDF | On garde le fait (n°, date, montant ; modèle, version, date de signature), pas les PDF (questions 15, 26) |

- **Étapes :**
  1. **Obtenir les exports** et les garder **hors de git** (`~/Clinique-MANA-import/`, mode 700).
  2. **Correspondances :** profils d'employés → `professionals` (table relue à la main ; « conseillère », « Administration » et « Z MATRICE » exclus) ; ~900 couples pro-service → les services du catalogue unique, par code (les 28 codes du gabarit sont connus, visite §18 ; les anciens services sans code, p. ex. « 50 minutes – Rencontre d'intervention web » 447 lignes, sont rattachés au code équivalent) ; états et raisons d'annulation ; modes de paiement (« Argent comptant » → « Carte (QuickBooks Payments) », décidé, Christine) ; étiquettes → champs (question 13).
  3. **Doublons :** chaque client passe par les **règles de doublons de Clients** (identité : courriel, téléphone, nom + date de naissance) : HIGH → même client (rattaché), MEDIUM → rapport à trancher ; aussi contre les clients déjà créés dans l'app depuis Demandes.
  4. **Essai à blanc** (par défaut) : tables `private.import_*`, rien d'écrit dans les tables des modules ; rapport : comptes, rejets et raisons, doublons, pros ou services sans correspondance, chevauchements, totaux de factures et de paiements comparés à QuickBooks.
  5. **Import réel avec ton feu vert**, idempotent (`external_ref` sur chaque ligne), audité comme « Importation » ; puis dix dossiers vérifiés par Christine et l'adjointe.
- **Règles :** historique en **lecture seule** (rendez-vous passés terminés ou annulés, factures historiques sans recalcul de taxes, sans envoi à QuickBooks, sans courriel) ; seuls les rendez-vous **futurs** deviennent actifs (rappels compris) ; la séquence de factures 2027 reprend après le dernier numéro de GOrendezvous ; les places restantes ne comptent pas l'historique.
- **Repris :** notre `import_professional` (essai à blanc par défaut) et `scripts/import-professionals.mjs` ([runbook](../runbooks/import-professionals.md)) ; rien de PS Hub.
- **Calendrier :** essais à blanc dès que les exports sont en main (clients mi-octobre, rendez-vous dès le fichier du support, facturation fin octobre) ; **répétition complète du 23 au 25 novembre** ; **import final les 28 et 29 novembre 2026**, après le gel du 27 au soir (repli : 9 et 10 janvier).
- **Dépendances :** Clients, Rendez-vous, Facturation, Services et tarifs (leurs tables).
- **Taille :** M–L (8–10 jours en voie B), selon la qualité des exports.
- **Questions :** 1, 2, 13, 15, 26.

### 2.8 Rapports (`reports`) — M

- **But :** les chiffres que le classeur calcule mal (recherche §8.4) et ceux du comptable.
- **Utilisateurs :** administration ; conseillères (leurs chiffres).
- **Fonctionnalités :** demandes par semaine, canal, provenance, conseillère ; taux de confirmation (activité et cohorte) ; délais reçue → contact → proposition → confirmation ; places ; annulations de premier rendez-vous ; rapport IVAC avec export CSV (désactivé dans l'ancienne) ; revenus et paie.
- **De GOrendezvous** ([visite §5, §9](../research/2026-10-11-gorendezvous-tour.md)) : **Revenus** sous trois angles (par facture, par service, par paiement ; filtres période, pro, client, service, mode ; export Excel) ; **clients à relancer** ; **annulations par raison**. GOrendezvous n'a ni KPI d'accueil ni rapport de paie : ce sont nos ajouts. Le revenu et les annulations sont nécessaires dès la bascule (lot minimal en voie A, lu de Facturation) ; le reste en février.
- **Repris de PS Hub :** rien tel quel ; `analytics-ai` envoie des données d'affaires à un modèle, exclu pour une clinique.
- **Modèle de données :** aucune table ; vues publiées par chaque module et une RPC par rapport (permission d'abord).
- **IA :** aucune.
- **Dépendances :** Demandes, Rendez-vous, Facturation.
- **Taille :** M (6–8 jours), dont 2 avant la bascule (Revenus, annulations).

### 2.9 Plus tard : SMS, portails, B2B

- **SMS :** **déplacé avant la bascule** (Jonathan, 2026-10-12 ; §2.4 quater). Reste pour plus tard : les conversations à deux voies (écrire librement à un client par texto), reprises de PS Hub (fils, composeur, `src/components/crm/sms/`).
- **Google Meet** : retiré du plan (Jonathan, 2026-10-11 : on garde Zoom) ; à ajouter seulement si un professionnel le demande, en reprenant la création de Meet de PS Hub (`calendar-push-task/index.ts:505-520`).
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

- **Décidé (Jonathan, 2026-10-12) : les SMS avant la bascule, par la centrale Yeastar comme PS Hub** (§2.4 quater), pas Twilio.
- **Ce que Jonathan fait, dès maintenant (« Mise en service ») :** (1) trancher la **question 53** : centrale propre à la clinique, ou DID dédié sur la centrale de PS ; (2) sur la centrale retenue, créer l'**application OpenAPI** (identifiant et secret) et le **secret de webhook**, prévoir un **DID capable de SMS** (trunk cellulaire ou fournisseur SIP avec SMS) et son indicatif ; (3) coller `YEASTAR_BASE_URL`, `YEASTAR_CLIENT_ID`, `YEASTAR_CLIENT_SECRET`, le secret de webhook et le DID dans les secrets de fonction (jamais dans le clavardage) ; (4) si DID dédié sur la centrale de PS, une entente de sous-traitance entre PS et la clinique (Loi 25). Les mots d'arrêt (« ARRÊT », « ARRET », « STOP ») sont traités par notre webhook. Essai réel le 19 octobre, ~200 textos par mois attendus.

### 3.5 Fournisseur de paiement

- **Stripe (décidé, Christine, réponse 6) :** la clinique a déjà un compte Stripe (268 paiements par carte en 2026) ; **la carte au dossier est utilisée** (le client l'accepte, la clinique prélève le lendemain du rendez-vous) → carte enregistrée chez Stripe, **prélèvement automatique du lendemain** pour les factures envoyées, plus le **lien « PAYER »** ; webhook signé réclamé par `claim_webhook_event`. Les avis Interac de `administration@` alimentent « À rapprocher » (§2.4, §2.6). PS Hub n'a pas de Stripe.

### 3.6 Bascule hors de GOrendezvous

- **Cible : lundi 30 novembre 2026** (Rendez-vous, Facturation, SMS et paie ensemble) ; gel de GOrendezvous le vendredi 27 au soir, import final les 28 et 29, premier « File du matin » le mardi 1er décembre, sommaire de paie de novembre le 1er décembre. **Repli : lundi 11 janvier 2027** (chaque étape décalée de six semaines). **Limite dure : le 31 janvier 2027**, renouvellement de GOrendezvous. Le déroulé (T-30 le 30 octobre, T-14 le 16 novembre, répétition du 23 au 25, gel, import, mise en service, go / no-go le mercredi 2 décembre à midi, retour en arrière) est dans le [plan de code §4](2026-10-11-modules-coding-plan.md).
- **Bascule partielle le lundi 2 novembre**, si les éléments externes arrivent tôt : Demandes (liste d'attente, page d'appel découverte), consentements des clients et synchro Gmail passent en service pour les conseillères, sur l'import réel des clients ; GOrendezvous garde l'agenda, la facturation et les rappels jusqu'au 30 novembre. Jamais l'agenda seul : rappels, factures et file du matin bougent ensemble.
- **Avant :** un compte par conseillère, les professionnels avec leur lien de visio (lien fixe saisi, ou Zoom branché si l'application est prête), la centrale Yeastar branchée avec son DID SMS (§3.4), les cartes au dossier recréées chez Stripe (lien sécurisé aux clients dès le 30 octobre), la boîte `administration@` branchée, les 7 consentements publiés en français et en anglais avec leurs règles (§2.2 bis), QuickBooks branché avec ses comptes et la correspondance des clients relue, les modèles de courriel et de texto relus, les deux demi-journées d'essai faites, la répétition complète.
- **Essais à la clinique (novembre) :** en production, les nouveaux modules visibles des seuls testeurs nommés (un drapeau par personne ajouté dans Clients), sur les clients importés à blanc ; une copie de préproduction a été écartée (un seul projet Supabase, l'import se répète contre les vrais clients QuickBooks, et une deuxième base doublerait les secrets). Listes de vérification par rôle (adjointe, conseillère, professionnel), écrites dans le déroulé de bascule.
- **Retour en arrière :** jusqu'au mercredi 2 décembre à midi, GOrendezvous reste payé et intact (gelé, pas supprimé) ; on y revient en ressaisissant ce qui a été créé depuis le 30 novembre (rapport fourni par l'app) ; nouvel essai le 11 janvier.
- **Import complet de GOrendezvous** (décidé, §2.7) : clients, tout l'historique de rendez-vous, correspondance des pros, factures et paiements. Essais à blanc dès que l'export est en main ; import final la fin de semaine de la bascule ; GOrendezvous gardé en lecture ensuite (question 2).
- **Suite de la bascule :** rappels par courriel et par texto dès le premier jour ; IVAC et PAE de décembre faits dans QuickBooks comme aujourd'hui, puis par l'app dès janvier (lot payeurs tiers, juste après la bascule) ; Calendly remplacé par la page publique si son suivi de provenance est accepté (question 44).

### 3.7 Rappels pour tous les nouveaux modules

- RPC seulement, RLS par `current_permission_keys()`, manifeste et registre, `org_id` et audit partout (CLAUDE.md §5–6) ; courriel par `sendTemplatedEmail`, tâches par `runJob`, fichiers par `storage-sign`, signature par le socle.
- Pas de note clinique, motifs = étiquettes (D8) ; rien de sensible dans un journal, une notification ou une invite IA.
- Pas de cache de fichiers dans un service worker (PS Hub : `vite.config.ts:91-96`, non vidé à la déconnexion) ; erreurs d'authentification par code, jamais par texte (PS Hub déconnecte sur tout message contenant « session » : `src/App.tsx:123-135`).

---

## 4. Questions pour Jonathan (réponds « ok » ou corrige)

### Réponses reçues (Jonathan, 2026-10-11)

- **IA :** OpenAI, comme PS Hub (§2.4 ter).
- **Boîte courriel :** Gmail branché, `info@cliniquemana.com` d'abord (§2.4, §3.3).
- **Visio :** Zoom, un compte par professionnel, lien créé à chaque rendez-vous ; Google Meet retiré (plus tard si un pro le demande) (§2.5).
- **Liste d'attente :** à incorporer, surtout pour les psys (§2.3 bis).
- **« Facturé à » :** le payeur est séparé du dossier ; dans QuickBooks, un client parent par payeur et un sous-client par dossier (§2.6 bis).

### Réponses de Christine (2026-10-12, [recherche](../research/2026-10-12-christine-answers.md)) et de Jonathan (2026-10-12)

Décidées, non révisables, sauf mention « reco ».

- **Heures :** lundi au vendredi, 8 h à 17 h ; rendez-vous le soir et la fin de semaine ; rappels aux heures ouvrables (§2.5).
- **Rendez-vous non confirmé :** on ne fait rien (le drapeau pour la conseillère est retiré).
- **Textos :** « nous aimons bien les textos » ; **Jonathan : SMS avant la bascule** (§2.4 quater ; question 43 close).
- **Visio :** Teams, Google Meet ou Zoom selon le pro, chacun paie le sien → Zoom par OAuth **ou lien fixe personnel**, au choix du pro (§2.5).
- **Factures :** créées et envoyées chaque matin par la clinique, corrections le lendemain → la file du matin (§2.6 ; question 21 close).
- **Paiements :** avis Interac à `administration@` (QBO 1075) ; carte au dossier prélevée le lendemain (QBO 1070) ; « Argent comptant » = carte via QuickBooks Payments (question 45 close).
- **Impayés :** relances à 3, 5, 7 et 10 jours ; refus d'un nouveau rendez-vous avec solde, conseillère et pro avertis.
- **« Facturation personnalisée » / « Entente de paiement » :** entente particulière, validation avant envoi.
- **Frais d'annulation :** le pro décide ; 30 % lui reviennent, seulement si la facture est payée (question 23 close).
- **Stagiaires :** le reçu porte le superviseur (nom, ordre, permis).
- **Parents séparés :** la facture n'est pas divisée ; adressée à l'un ou l'autre ; les deux au dossier (question 42 close).
- **IVAC :** 94,50 $ par séance, écart au client, facturation mensuelle par client avec n° de dossier et dates ; rapports facturables. **PAE :** entente par client (montant par séance ou maximum, renouvelé le 31 mars), ≤ 3 factures par entente de 800 $, à facturer début avril (question 24 close).
- **Programme PAE de MANA :** il n'y en a pas ; seulement des ententes avec des fournisseurs de PAE.
- **Paie des pros :** sommaire le 1er du mois, chaque rencontre payée, IVAC et PAE au taux régulier, absences à 30 % si payées, rapports et discussions à 15 % ; le pro valide et produit sa facture (§2.6, lot Paie).
- **Taxes :** liste conforme (question 46 close) ; **« Statut Indien » = exemption** (question 13 close).
- **QuickBooks :** dépenses des pros par spécialité ; factures clients « Services (revenus) » ; ouvertures de dossier « Ventes (revenus) » (question 25 close).
- **Rapports mensuels :** « oui », sans liste → question 51 (jeu par défaut proposé).
- **Classeur :** tableau en construction ; les couleurs guident la priorisation des conseillères (question 19, en partie) ; « pour l'administration seulement » : sans réponse (question 20 reste, pour la visite avec les conseillères).
- **Exclusions d'un pro :** avertissement, pas interdiction (§2.3).
- **Calendly :** on le remplace **si** l'app dit d'où viennent les appels et reste aussi simple pour le client ; sinon on le garde (question 44 reformulée).

### Répondues par les données (2e passe, visite §18)

- **5 Lieux :** vidéo 7 681 visites, téléphone 5, en personne ≈ 85 sur 8 635 → vidéo et téléphone seulement ; les 911 « Bureau administratif » sont à qualifier à l'import.
- **9 Prix :** par profession, identiques entre les pros d'une même profession → les grilles de rétention sont la bonne source ; le rapport d'écarts les compare aux prix observés.
- **11 Tarifs étudiant et réduit :** existent comme services (10131, 10151, 10152 ; psychologie 96 / 120) → variantes datées ; qui décide reste à dire.
- **14 TELUS eRéclamations et Lumino Santé :** jamais utilisés (0 réclamation ; onglet inactif) → abandonnés. RAMQ : toujours à confirmer (pas de donnée).
- **22 Stripe :** aucun dépôt, aucune carte enregistrée → lien de paiement seulement.
- **34 Frais d'inscription :** 21,74 $ = 18,91 $ + taxes, service taxable ; reste remboursable ou crédité ?
- **Rappels :** 1 jour avant (pas 2), jamais la fin de semaine. **Annulation :** « les clients doivent appeler, en tout temps » chez presque tous les pros → pas de lien d'annulation en v1. **Frais d'annulation :** jamais la règle signée (103 lignes facturées sur 605, montants tapés) → proposés, confirmés par l'adjointe. **Reçus :** numéro unique pour la clinique, modèle confirmé. **Propositions :** acceptation automatique partout, aucun délai d'expiration chez GOrendezvous.
- **Comptabilité :** QuickBooks Online, oui (§2.6).
- **GOrendezvous :** tout importer (§2.7, §3.6).
- **SMS :** plus tard (§2.9, §3.4).
- **Direction :** un système proche de GOrendezvous, adapté à MANA (§0).

### Questions ouvertes

Les questions de la première version, celles de la visite de GOrendezvous (§13 et addenda) et les nouvelles, fusionnées, une seule fois chacune. **À trancher en premier : 50 (troisième voie), 1, 2, 44.** Christine a répondu aux questions 13, 19 (en partie), 21, 23, 24, 25, 42, 45 et 46 ; Jonathan à la 43 : elles sont marquées « répondue » et résumées sous « Réponses de Christine ».

**Bascule et import**
1. **Export de l'historique des rendez-vous :** il ne se fait que par le support de GOrendezvous. Qui le demande ? *Reco : Christine (propriétaire du compte), cette semaine, en demandant aussi les reçus et les consentements en lot ; sans cet export, l'historique des rendez-vous ne peut pas être importé.*
2. **Date de bascule :** lundi 30 novembre 2026 (gel le vendredi 27 au soir), repli le lundi 11 janvier 2027, limite dure le 31 janvier (décidé par Jonathan le 2026-10-12, §0). *Reco : ok ; demander aussi à GOrendezvous un accès en lecture quelques mois après (au mois, ou le forfait le plus bas) pour retrouver un ancien reçu.*
3. **Conseillères :** combien, et toutes dans le compte partagé « conseillère » ? *Reco : chez nous, un compte par personne (rôle « Conseillère »), jamais de compte partagé.*

**Rendez-vous**
4. *(Répondue : Zoom par professionnel ; voir « Réponses reçues ».)*
5. *(Répondue par les données : vidéo et téléphone seulement ; voir « Répondues par les données ».)*
6. **Séance de 50 min réservée en plage de 1 h :** battement voulu ? *Reco : oui, « pause après » de 10 min réglée par service.*
7. **« Requêtes > Rendez-vous »** (rendez-vous proposés au client, acceptés par courriel) : c'est ainsi que se place le premier rendez-vous ? *Reco : oui ; repris comme « proposition » avec lien d'acceptation.*
8. **Agenda Google personnel des pros :** lecture occupé / libre seulement. *Reco : ok, après la bascule.*

**Services et tarifs**
9. *(Répondue par les données : prix par profession ; les grilles restent la source, le rapport d'écarts avant la bascule.)*
10. **Abandons :** prorata horaire, annulation au prorata, PRÉSENTIEL (47 lignes en 2026), location de bureau, vente d'article, recherche-action. *Reco : abandonner.*
11. **Tarifs étudiant et réduit :** montants connus (psychologie 96 / 120 ; réduit 130 chez une pro) ; preuve demandée et qui décide ? *Reco : rabais daté par service, posé sur le client par l'adjointe.*

**Clients**
12. **Ce qu'un pro voit :** la règle de GOrendezvous (clients qu'il a créés, vus ou à voir en rendez-vous, ou dont il est le pro principal). *Reco : ok.*
13. **Étiquettes :** les utiles deviennent des champs (tarif étudiant, tarif réduit, IVAC, PAE, banni, dossier incomplet, « Entente particulière » pour « entente de paiement » et « facturation personnalisée ») ; celles de satisfaction disparaissent. *(« Statut Indien » = exemption de taxes : répondue, Christine.)* *Reco : ok.*
14. **RAMQ :** demandé aux clients ? (TELUS eRéclamations et Lumino Santé : répondue par les données, jamais utilisés.) *Reco : non en v1.*
15. **Consentements :** recréer les 7 modèles dans la signature du socle, en français et en anglais (§2.2 bis) ; à l'import, garder le fait signé (modèle, version, date, signataire) sans les PDF un par un. *Reco : ok ; Christine relit les 7 textes et fournit ou valide les versions anglaises.*

**Demandes**
16. *(Répondue : la liste d'attente vit dans Demandes, §2.3 bis ; les frais sont la question 34.)*
17. **Dépistage PHQ-2 / GAD-2** du formulaire « Requêtes de service » : outils cliniques. *Reco : ne pas les reprendre (D8).*
18. **Formulaires du site → Demandes :** lot après la v1. *Reco : oui.*
19. **Les 7 questions du classeur** ([recherche §8.5](../research/2026-10-08-intake-workbook.md#85-open-questions-for-jonathan)). *Reco :* place rendue à l'annulation d'un premier rendez-vous ; une proposition retient la place 48 h ; exclusions en note surlignée ; liste d'attente pour toute discipline.
20. **IA dans Demandes et le jumelage :** aucune pour l'instant. *Reco : ok.*

**Facturation**
21. *(Répondue, Christine : la clinique crée et envoie chaque matin, corrections le lendemain → la file du matin, §2.6.)*
22. *(Répondue par les données : lien de paiement seulement, aucun dépôt ni carte enregistrée.)*
23. *(Répondue, Christine : le professionnel décide d'appliquer les frais ; 30 % lui reviennent une fois la facture payée.)*
24. *(Répondue, Christine : IVAC 94,50 $ par séance, écart au client, facture mensuelle par client ; PAE par entente, clôture début avril ; aucun programme PAE de MANA.)*
25. *(Répondue, Christine : revenus « Services » et « Ventes », dépenses des pros par spécialité, modes de paiement selon les comptes actuels.)*
26. **Reçus historiques :** factures et paiements viennent de l'export « Revenus » et de QuickBooks ; les reçus PDF ne s'exportent qu'un par un. *Reco : pas de téléchargement un par un ; export en lot par le support (question 1), sinon l'accès en lecture (question 2).*

**Communications et IA**
27. **Boîtes Gmail :** `info@` partagée d'abord, personnelles ensuite. Les conseillères ont-elles des adresses `@cliniquemana.com` ? *Reco : ok.*
28. **OpenAI et Loi 25 :** aucun renseignement de client envoyé ; projet en région Canada si admis ; rétention zéro demandée ; EFVP par Christine ; compte OpenAI au nom de la clinique, pas celui de PS Hub. *Reco : ok.*
29. **Modèle OpenAI :** `gpt-5.4` après un essai contre `gpt-4o` et `gpt-5.4-mini`. *Reco : ok.*
30. **Conservation des courriels synchronisés :** corps effacés après 24 mois. *Reco : ok, à confirmer par Christine.*

**Ordre, portée et abandons**
31. **Ordre :** chemin critique Services et tarifs → Clients → Rendez-vous → Facturation ; voie B : Gmail, consentements, import, Demandes (a), Zoom, Stripe, QuickBooks ; après la bascule : Demandes (b), composeur et IA, payeurs tiers, Meet, Rapports. *Reco : ok (Demandes passe après Rendez-vous à cause du 31 janvier).*
32. **Abandons** (ton OK requis) : salles, équipements, groupes, inventaire, formulaires santé, services PRÉSENTIEL, location de bureau, vente d'article, cartes de visite ; de l'ancienne app : `deterministic-scorer`, `holistic-classifier`, l'interprète d'horaire par IA ; portail client complet et réservation en ligne après la bascule. *Reco : abandonner / reporter.*
33. **Notes cliniques des pros :** où sont-elles tenues (GOrendezvous n'en a aucune) ? *Reco : hors de l'app (D8) ; Christine confirme l'outil.*

**Liste d'attente (§2.3 bis)**
34. **Frais d'inscription de 21,74 $** (répondu par les données : 18,91 $ + taxes, taxable) : remboursables ? crédités sur la 1re séance ? exonérés pour PAE et IVAC ? *Reco : garder la règle d'aujourd'hui (dis-la-moi) ; facturés à l'inscription ; exonération possible avec une raison.*
35. **Fréquence des relances :** *Reco : toutes les 8 semaines, un courriel « Souhaitez-vous rester sur la liste ? » puis un appel si pas de réponse en 14 jours.*
36. **Plusieurs listes pour un client ?** *Reco : oui, au plus deux inscriptions (une profession et / ou un pro précis), un seul frais d'inscription.*
37. **Priorité :** qui peut mettre « Prioritaire », et pour quelles raisons ? *Reco : une conseillère, avec une raison écrite et visible ; l'administration voit la liste des prioritaires.*
38. **Offre de plage :** durée du lien et nombre de clients à la fois ? *Reco : 48 h, un client à la fois, dans l'ordre de la liste.*
39. **Professions avec liste d'attente :** psychologie et psychothérapie seulement ? *Reco : toute profession peut en avoir une ; on commence avec ces deux-là.*
40. **Listes des pros :** les pros tiennent-ils encore leur propre liste (comme dans GOrendezvous) ? *Reco : non, les conseillères la tiennent ; le pro voit en lecture les inscriptions qui le visent.*

**Zoom et facturation**
41. **Application Zoom :** si Zoom exige de publier l'application pour des comptes hors de celui de la clinique, tu crées le compte développeur Zoom de la clinique et soumets l'application ? *Reco : oui, au début du lot Zoom (fin novembre), avec ton feu vert à chaque étape.*
42. *(Répondue, Christine : la facture n'est pas divisée ; adressée à l'un ou l'autre parent, les deux au dossier.)*

**Nouvelles questions (2e passe de données)**
43. *(Répondue, Jonathan, 2026-10-12 : « oui, les SMS avant la bascule » ; §2.4 quater, voie C.)*
44. **Calendly (reformulée après Christine) :** on le remplace seulement si la page de réservation dit d'où vient chaque appel et reste aussi simple pour le client. *Reco : la remplacer, avec le suivi de provenance (campagne / UTM, référent, « Comment avez-vous entendu parler de MANA ? ») comme critère d'acceptation du lot, en voie C les 11–13 novembre ; si le critère n'est pas atteint, Calendly reste et ses réservations sont importées.*
45. *(Répondue, Christine : « Argent comptant » = paiements par carte via QuickBooks Payments ; importés sous « Carte (QuickBooks Payments) ».)*
46. *(Répondue, Christine : la liste des taxes est conforme ; sexologie et orientation non taxées.)*

**Consentements des clients (pour Christine, §2.2 bis)**
47. **Clauses facultatives :** dans les 7 textes, quelles sections sont des « Oui / Non » que le client accepte ou refuse une à une (p. ex. autoriser la communication avec un tiers, l'enregistrement, un stagiaire) ? *Reco : les lister ; chacune devient une clause imprimée avec sa réponse dans le PDF signé.*
48. **Nouvelle version (v16 du général, etc.) :** faire signer de nouveau **tous les clients actifs**, ou **seulement les nouveaux** ? *Reco : « nouveaux clients seulement » par défaut ; « tous les clients actifs » quand le texte change de fond (honoraires, politique d'annulation), choisi à la publication.*
49. **Conservation des PDF signés** et des consentements retirés : durée (Loi 25, dossier administratif) ? *Reco : la durée du dossier administratif du client, fixée par Christine dans Paramètres → Confidentialité ; aucune suppression automatique avant sa réponse.*

**Échéancier et rapports (après les réponses du 12 octobre)**
50. *(Répondue, Jonathan, 2026-10-12 : trois voies, mesurées en séquences et portes, code terminé le 30 octobre, bascule le 30 novembre ; §0 et plan de code §2.)*
51. **Rapports mensuels :** Christine dit « oui » sans liste. *Reco : jeu par défaut : revenus par mois, par pro et par service ; paiements par mode ; impayés et relances ; annulations et absences par pro et par raison ; demandes reçues, confirmées et en attente ; longueur de la liste d'attente ; sommaire de paie par pro ; IVAC et PAE facturés et à facturer. Elle retire ou ajoute.*
53. **Centrale Yeastar pour les textos :** une centrale propre à la clinique (données chez elle ; centrale et DID SMS à commander, 1 à 3 semaines) ou un DID dédié sur la centrale de PS (prêt en un jour ; trafic de la clinique sur l'infrastructure de PS, entente de sous-traitance à signer) ? *Reco : DID dédié sur la centrale de PS pour la bascule, avec l'entente ; migration vers une centrale propre plus tard si la clinique le souhaite.*
52. **Cartes au dossier à la bascule :** Stripe ne transfère pas les cartes enregistrées par GOrendezvous ; les clients concernés recevront un lien sécurisé en décembre pour redonner leur carte (avec le consentement au prélèvement du lendemain). *Reco : ok ; Christine annonce le changement aux clients dans le courriel de décembre.*

## 5. Prochaine étape

- Le [plan de code](2026-10-11-modules-coding-plan.md) détaille chaque module en lots, tâche par tâche pour Services et tarifs et Clients, avec le calendrier à deux voies, le déroulé de la bascule et les décisions à prendre avant chaque module. Il contient aussi le marquage **Keep / Change / Drop** de l'inventaire et de GOrendezvous exigé par CLAUDE.md §5.
- **Lundi 12 octobre :** voie A commence Services et tarifs (lot S1), voie B le branchement Gmail (lot CM1), si tu réponds aux questions 1, 2, 4 et 9.
- **Cette semaine, hors code :** demander l'export de l'historique des rendez-vous au support de GOrendezvous (question 1) et l'accès en lecture après la bascule (question 2).
- Les choix faits sans toi sont notés « délégués — révisables » dans le [journal des décisions](2026-10-07-decisions-log.md) (série R-).

