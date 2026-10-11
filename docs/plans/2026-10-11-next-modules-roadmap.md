# Plan de match — les prochains modules (2026-10-11)

**Pour :** Jonathan (à lire et à trancher). **Statut :** proposition, rien n'est construit.
**Sources :** [contexte d'affaires](../standards/business-context.md), [inventaire de l'ancienne app](2026-10-06-legacy-feature-inventory.md) (réf. « §B », « §C »… ci-dessous), [classeur d'accueil](../research/2026-10-08-intake-workbook.md), [visite de GOrendezvous](../research/2026-10-11-gorendezvous-tour.md) (réf. « visite §… »), [doc du socle](../modules/core.md), [ce que publie Professionnels](../modules/professionals.md#what-the-module-publishes), et PS Hub (`../NEW PS Hub`, lu sans rien modifier ; preuves `chemin:ligne` entre parenthèses).
**Lecture :** termes d'écran en français, noms techniques en anglais. Tailles en jours-agent : **S** ≤ 3, **M** 4–8, **L** 9–15, **XL** 16 et plus.

---

## 0. Vue d'ensemble

**La date qui commande tout :** GOrendezvous se renouvelle le **31 janvier 2027** et son forfait « Entreprise » est discontinué (le renouvellement forcerait Essentiel ou Premium : [visite §0, addenda](../research/2026-10-11-gorendezvous-tour.md)). **Cible de bascule : lundi 11 janvier 2027** (gel de GOrendezvous le vendredi 8 au soir, import final les 9 et 10), **date de repli : lundi 25 janvier 2027**. Tout ce qui est nécessaire pour quitter GOrendezvous passe donc avant le reste, y compris avant la fin de Demandes.

**Principe (Jonathan, 2026-10-11) :** « un système proche de GOrendezvous, adapté à nous, sans réinventer la roue ». On reprend ses écrans et ses règles là où la clinique les utilise ([visite](../research/2026-10-11-gorendezvous-tour.md), listes « À reproduire »), on simplifie ce qu'elle n'utilise pas, et on ajoute ce qui lui manque (dispatch, payeurs tiers, fusion de doublons, frais d'annulation automatiques).

### Ordre recommandé

| # | Module (écran) | Clé | Avant la bascule ? | Taille |
|---|---|---|---|---|
| 1 | **Services et tarifs** | `services` | Oui : catalogue unique, codes de famille | S–M |
| 2 | **Clients** | `clients` | Oui : tout pointe vers un client ; import | L |
| 3 | **Rendez-vous** (agenda, disponibilités, récurrence, rappels J-1 par courriel, lien de confirmation, Zoom par pro) | `appointments` | Oui (chemin critique) | XL |
| 4 | **Facturation et paiements** (facture → paiement → reçu, Interac, Stripe, QuickBooks, frais d'annulation) | `billing` | Oui (chemin critique) | XL |
| 5 | **Importation GOrendezvous** | — | Oui : essais à blanc dès Clients, import final le 9–10 janvier | M–L |
| 6 | **Demandes** lot (a) : boîte, accueil, appels découverte, **liste d'attente** (inscription, frais, consentement, ordre, relances, sorties) | `demandes` | Oui : remplace les faux rendez-vous de l'agenda « conseillère » et la liste par pro de GOrendezvous | L |
| 7 | **Communications** lot (a) : branchement Gmail `info@` et synchro | `communications` | Oui (voie B, avant Clients) ; la boîte à l'écran vient après la bascule | M |
| 8 | **Communications** lot (b) : boîte à l'écran, composeur Gmail, modèles, IA (OpenAI) | `communications` | Non : janvier–février | L |
| 9 | **Demandes** lot (b) : jumelage, places, offre de plage aux inscrits de la liste d'attente, KPI | `demandes` | Non : janvier–février | L |
| 10 | **Facturation** lot payeurs tiers (PAE, IVAC, employeurs, factures en lot) ; occupé / libre Google | `billing`, `appointments` | Non : février | M |
| 11 | **Rapports** | `reports` | Non : février | M |
| plus tard | SMS, Google Meet (seulement si un pro le demande), portail client complet, réservation en ligne, B2B | — | Non | — |

**Réponses de Jonathan (2026-10-11) intégrées :** IA par OpenAI comme PS Hub ; Gmail branché (`info@cliniquemana.com` pour les essais) ; visio : **Zoom, un compte par professionnel** (Meet retiré) ; QuickBooks Online oui ; GOrendezvous : tout importer ; SMS plus tard ; **liste d'attente** des psys à incorporer (§2.3 bis). **Faits chiffrés** d'une 2e passe sur GOrendezvous (2026-01-01 → 2026-10-11, [visite §18](../research/2026-10-11-gorendezvous-tour.md)) intégrés : les questions qu'ils tranchent sont marquées « répondue par les données » au §4.

### Calendrier à deux voies (détail : [plan de code §2](2026-10-11-modules-coding-plan.md))

| Semaines | Voie A (chemin critique) | Voie B |
|---|---|---|
| 12 – 16 oct. | Services et tarifs | Gmail : branchement et synchro de `info@` |
| 19 – 30 oct. | Clients | Gmail (fin) ; **consentements des clients** (5 jours, §2.2 bis) ; outil d'import (début) |
| 2 – 27 nov. | Rendez-vous (agenda, disponibilités, récurrence, états, rappels, liens) | Demandes (a) avec la liste d'attente ; Zoom par pro |
| 30 nov. – 18 déc. | Facturation (factures, paiements, reçus, relevé, frais d'annulation et d'inscription) | Zoom par pro (fin) ; Stripe et Interac ; QuickBooks |
| 21 déc. – 8 janv. | Page publique d'appel découverte (remplace Calendly, 3 jours ; reportée en janvier si la bascule le demande) ; tampon : corrections, formation, répétition de bascule | QuickBooks (fin), essai à blanc de la facturation ; répétition complète |
| 9 – 11 janv. | **Bascule** | **Bascule** |
| 11 janv. – fin févr. | Demandes (b) (jumelage, offres de plage), payeurs tiers, occupé / libre Google | Boîte Gmail, composeur et IA, Rapports |

- **Chemin critique :** Services et tarifs → Clients → Rendez-vous → Facturation → QuickBooks → import final → bascule. Voie A : ~50 jours-agent d'ici le 18 décembre ; voie B : ~56 d'ici le 30 décembre (la boîte Gmail à l'écran a glissé après la bascule pour faire place à la liste d'attente) ; la voie A garde deux semaines de tampon (période des fêtes) avant le gel.
- **Ce qui le menace :** l'export de l'historique des rendez-vous, qui ne se fait **que par le support de GOrendezvous** (à demander maintenant, question 1) ; les revues de Jonathan à chaque lot ; QuickBooks (accès au compte de la clinique).
- **Total :** ~113 jours-agent avant la bascule (page d'appel découverte comprise), ~45 après.

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
| SMS | **Plus tard** | Fils par numéro, interface boîte / fil / composeur, webhook signé | Centrale Yeastar propre à PS ; aucun STOP ni consentement |
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
| Facturation | Facture → paiement (Interac, lien Stripe « PAYER ») → reçu sous 24 h ; plusieurs lignes ; facture divisée pour un couple ; numéro `AAAA-N` ; mode de paiement ↔ compte QuickBooks ; relevé annuel | — | **Frais d'annulation automatiques** (politique à deux paliers) ; **vrais payeurs tiers** (PAE, IVAC, employeurs) avec factures ou relevés en lot |
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
  - **Ce que les données confirment** ([visite §18](../research/2026-10-11-gorendezvous-tour.md)) : **les prix sont par profession et identiques entre les pros d'une même profession** (30 / 50 / couple 60 : travail social 85 / 120 / 150, psychoéducation 100 / 140 / 165, sexologie 110 / 150 / 175, psychothérapie 120 / 160 / 185, psychologie 130 / 175, étudiant 96 / 120) : le modèle « un prix par (service, profession) » tiré des grilles est le bon, et le **rapport d'écarts** compare ces prix aux grilles de rétention avant la bascule. Les tarifs étudiant (10131, 10151 : 68 lignes) et réduit (10152 : 3 lignes) existent comme services chez GOrendezvous ; ils deviennent des variantes et sont rattachés à l'import. **Taxes pratiquées :** taxées = ouverture de dossier (43,49 $ TTC = 37,83 $ + taxes), inscription à la liste d'attente (21,74 $ = 18,91 $ + taxes), couple 30 min, supervision, frais de déplacement, naturopathie ; **toutes les consultations non taxées**, sexologie et orientation comprises (à confirmer par le comptable pour ces deux-là seulement). **Famille 50xxx (administratif) :** prix 0 au catalogue et **montant tapé sur la facture** (rapport 56–208 $, discussion 33–84 $, test 40 $, supervision 100 $) : `price_source = 'entered'`, aucun moteur de prorata.
  - Nouveau : **politique d'annulation à deux paliers** en réglage daté (préavis 24 h ; 50 % à la 1re absence ou annulation tardive, puis 100 %), lue par Facturation pour poser les frais seuls ; frais d'ouverture de dossier daté ; modes vidéo et téléphone seulement.
  - Abandon proposé (ton OK requis) : modèles `by_profession_hourly_prorata` et `rule_cancellation_prorata` (§H) ; services **PRÉSENTIEL**, **location de bureau**, **vente d'article**, recherche-action ; champs de GOrendezvous non utilisés (salles, équipements, places, heures fixes, règles par étiquette, RAMQ, spécialité Lumino Santé).
- **Repris de PS Hub :** rien (**construire**). Son catalogue est un calculateur de pergolas (`docs/plans/2025-01-07-calculator-database-design.md`).
- **Modèle de données :**
  - `service_families` : code de famille (10…80), nom, ordre.
  - `services` : `code` (5 chiffres, unique ; les codes réels de GOrendezvous, visite §18), clé, nom, description, famille, durée, `kind` (séance, appel, frais, atelier, administratif), `for_two`, `price_source` (`grid` / `fixed` / `free` / `entered`), prix fixe, règle de taxe (`exempt` / `taxable` / `to_confirm`), couleur, actif.
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
  - `client_payers` : dossiers PAE, IVAC, employeur (organisation, n° de dossier, échéance, couverture) ; la consommation vit dans Facturation.
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
- **Taille et calendrier :** 7 jours en deux lots : **C5a** (5 jours, voie B, 22–28 octobre, avant la bascule) : modèles fr / en, règles, signataires, envoi et signature, onglet, « À compléter » et « À surveiller », rappel 48 h ; **C5b** (2 jours, après la bascule, janvier) : retrait, copie au client, rapports, campagne « À signer de nouveau ».
- **Questions :** 15, 47, 48, 49.

### 2.3 Demandes — accueil et jumelage (`demandes`) — XL

- **But :** le travail des conseillères : demande reçue → appel découverte → proposition d'un professionnel → premier rendez-vous confirmé, avec la promesse de rappel 24–48 h visible. Remplace le classeur ([recherche §8](../research/2026-10-08-intake-workbook.md#8-requirements-for-the-future-demandes-module)).
- **Utilisateurs :** conseillères ; adjointe (tableau des places) ; administration (statistiques) ; professionnel (demandes qui lui sont assignées, sans notes internes).
- **Fonctionnalités :**
  - Garder (§C) : formulaire d'accueil (type, motifs, besoin, enjeux, consultations antérieures, contexte légal, préférences d'horaire, urgence), participants avec principal, statut, `DEM-AAAA-NNNN`.
  - Garder (§D), selon **les 12 règles publiées par Professionnels** : clientèle et langue en filtres durs, âge minimum et « Femmes seulement », motifs qui notent sans exclure, assurance affichée, « Bon à savoir », places restantes calculées ici, suggestion mémorisée avec `updated_at`.
  - Changer : motifs lus du catalogue (fini les 12 clés codées, §C) ; fermeture qui fonctionne ; ordre des suggestions expliqué (score, places, nom).
  - Nouveau (classeur) : boîte des demandes (âge vs 24–48 h, « sans réponse » et prochaine tentative) ; saisie rapide en 20 s ; propositions (qui, quand, réponse) ; liste d'attente avec pro « pont » ; annulations de premier rendez-vous et raison ; tableau des places ; KPI.
  - **De GOrendezvous** ([visite §7, §8](../research/2026-10-11-gorendezvous-tour.md)) : son nouveau formulaire « Requêtes de service » (automne 2026, non activé chez MANA) est une bonne référence. **États :** Nouveau, En évaluation, Accepté, Jumelé, Liste d'attente, Orienté ailleurs, Urgent (Urgent devient un drapeau, pas un état). **Champs d'accueil :** pour qui, thérapie antérieure, langue, mode (vidéo / téléphone), disponibilités, genre du pro souhaité, motif, préoccupations, payeur (assurance, PAE, aucun), assureur, note interne, référence, consentement. **Pas de dépistage PHQ-2 / GAD-2** : ce sont des outils cliniques (D8, question 17).
  - **Remplace des contournements :** aujourd'hui, les appels découverte (« Consultation gratuite 15 min ») et la liste d'attente (« Inscription – Liste attente psychologie et psychothérapie », « LISTE ATTENTE À RAPPELER ») sont de faux rendez-vous dans l'agenda partagé « conseillère ». Demandes (a) les remplace avant la bascule, sinon on les recopierait dans le nouvel agenda : appel découverte = une tâche datée de la demande ; liste d'attente = la conception du §2.3 bis (Jonathan, 2026-10-11 : « pour les psy souvent nous avons une liste d'attente, il faut incorporer ça aussi »).
  - **Propositions :** « Requêtes > Rendez-vous » de GOrendezvous (rendez-vous proposé, accepté par courriel, hachuré d'ici là ; 52 acceptées et 28 en cours au moment de la visite) devient la proposition de premier rendez-vous avec lien d'acceptation (question 7).
  - **Appels découverte : le site renvoie à Calendly** (visite §18 : « Réserver un appel découverte » → calendly.com, pas GOrendezvous ; le formulaire « Nous écrire » est un formulaire Elementor avec la provenance et le consentement, promesse de contact en 24–48 h ouvrables). Demandes doit donc remplacer Calendly ou s'y brancher : **une page publique de réservation d'appel découverte** (plages des conseillères, création d'une demande « Nouvelle » avec le rendez-vous d'appel, courriel de confirmation, limite par IP et anti-robot), prévue en lot (a) mais **premier lot à reporter en janvier si la voie A glisse**, puisque Calendly n'a pas d'échéance (question 44). Le formulaire du site → Demandes reste après la bascule.
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
- **Taille :** XL (27–29 jours) en deux lots : **(a) avant la bascule** (19 jours : 16 en voie B, plus la page publique d'appel découverte, 3 jours en voie A dans le tampon de décembre) : boîte, accueil, états, appels découverte, **liste d'attente** (§2.3 bis, partie 1), propositions, page publique ; **(b) après la bascule** (10–12 jours) : jumelage, places, **offres de plage aux inscrits** (§2.3 bis, partie 2), KPI.
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
    - **rappels par courriel seulement pour l'instant** : **1 jour avant, jamais la fin de semaine** (réglage réel de GOrendezvous, visite §18 : le rappel du lundi part le vendredi), envoyé tôt le matin (heure de la clinique) ; le SMS est remis à plus tard (§2.9), **mais GOrendezvous envoie aujourd'hui ~165 rappels par texto par mois** : voir le risque de régression à la question 43 ;
    - **lien dans les courriels : confirmer seulement, en v1.** Les données montrent que presque tous les pros ont « les clients doivent appeler pour annuler : en tout temps » (visite §18) ; le courriel dit donc « Pour modifier ou annuler, appelez la clinique au … », sans lien d'annulation ; le lien d'annulation avec la règle des 24 h reste prévu en option par pro ou clinique, activable plus tard (R-39, révisable) ;
    - **audit** de chaque changement.
  - Changé par rapport à GOrendezvous : la « Raison / Notes » d'un rendez-vous, **visible du client** chez GOrendezvous, devient deux champs : une note interne (jamais envoyée) et un message au client (explicite) ; un compte par conseillère au lieu du compte partagé ; pas de salles, d'équipements, de cours de groupe ni de lieux physiques : **confirmé par les données** (8 635 visites : vidéo 7 681, téléphone 5, en personne ≈ 85 ; les 911 « Bureau administratif » sont vraisemblablement les entrées du compte conseillère, à expliquer à l'import). Les propositions sont acceptées automatiquement chez tous les pros et GOrendezvous n'a aucun délai d'expiration : notre délai de 48 h est un choix à nous.
  - Nouveau : places restantes branchées sur les premiers rendez-vous confirmés (règle 11 de Professionnels) ; plages réelles pour le jumelage ; propositions de rendez-vous avec lien d'acceptation (question 7).
- **Repris de PS Hub :** **adapter l'interface, construire le moteur.** Son calendrier n'est pas un moteur de rendez-vous : c'est la liste de tâches CRM (`crm_tasks`), une copie du Google de chaque vendeur et les installations, dessinées par des vues maison. Aucune disponibilité, réservation, récurrence propre (Google déroulé en occurrences : `calendar-sync/index.ts:415`) ni rappel envoyé.
  - Pris : vues Jour / Semaine / Mois / « Horaire » 30 jours sans librairie (`src/pages/Calendar.tsx:63-110`) ; glisser-déposer par Pointer Events, aimanté aux 15 min, d'un jour à l'autre, position provisoire (`src/components/calendar/CalendarTimeGridView.tsx:225-312`, `:156-202`) ; création au clic (`:336-359`) ; avertissement de chevauchement (`CalendarEventDialog.tsx:222-237`) ; agenda d'un collègue pour un administrateur (ADR 0027, `Calendar.tsx:166-182`) → une conseillère voit l'agenda d'un pro ; synchro Google incrémentale par `syncToken`, repli complet au 410 (`supabase/functions/calendar-sync/index.ts:438-442`).
  - Changé : grille placée **à l'heure locale de la clinique** ; PS Hub place en minutes depuis minuit (`CalendarTimeGridView.tsx:100-110`), donc décale d'une heure les jours de changement d'heure, et affiche l'heure du navigateur (`src/hooks/useCalendarItems.ts:14-18`) ; période filtrée par **chevauchement**, pas par début (PS Hub perd les événements de plusieurs jours : `useCalendarItems.ts:216-217`) ; écritures par RPC en une transaction (PS Hub : deux appels, erreur du `delete` ignorée : `src/hooks/useCrmTasks.ts:612-636`) ; redimensionnement (absent) ; jetons Google **chiffrés** et illisibles du client (en clair chez PS Hub : `baseline.sql:21286-21301`) ; `state` OAuth signé et expirant (non signé : `google-calendar-oauth/index.ts:51`, `google-calendar-callback/index.ts:39-45`) ; déconnexion qui révoque chez Google (`useCalendarConnection.ts:105-111` ne fait que `is_active=false`).
  - Pas copié : la synchro qui lit encore `crm_tasks.google_event_id` alors que la poussée écrit dans `crm_task_assignees` (`calendar-sync/index.ts:324-329` vs `calendar-push-task/index.ts:565-580`) ; `action: "delete"` sans lien vérifié avec la tâche (`calendar-push-task/index.ts:800-806`) ; `reminder_at` jamais lu ; **le miroir complet du Google personnel visible des administrateurs** (`docs/adr/0027-admin-view-team-calendars.md:54-60`) : nos pros ont une pratique privée, on n'importe qu'**occupé / libre**, jamais un titre ni un participant.
- **Visio : Zoom, un compte par professionnel (décidé par Jonathan, 2026-10-11 : « on garde Zoom, puisque c'est ça aujourd'hui que chaque professionnel doit brancher »).** Comme dans GOrendezvous ([visite §1](../research/2026-10-11-gorendezvous-tour.md)) : chaque pro branche son propre compte Zoom par OAuth, et **un lien est créé pour chaque rendez-vous** sur son compte. Google Meet et le lien fixe sortent du plan (Meet « plus tard », seulement si un pro le demande, §2.9).
  - **Brancher :** dans le portail du professionnel, « Mon agenda » → carte **« Vidéoconférence »** (Rendez-vous possède cette page ; « Mon profil » reste à Professionnels) → **« Connecter mon Zoom »** : la page d'autorisation de Zoom s'ouvre, le pro accepte, il revient sur sa carte qui dit « Zoom connecté : <adresse du compte Zoom> · depuis le … ». Le `state` OAuth est signé (HMAC, nonce à usage unique, 10 min) et le retour va toujours vers `APP_URL`.
  - **Ce que voit le personnel :** un écran **« Vidéoconférence »** dans Paramètres (chaque professionnel : Connecté / Non connecté / À reconnecter, avec un filtre et « Relancer ») et une pastille dans le choix du professionnel de l'agenda (l'écran appartient à Rendez-vous, Professionnels ne change pas) ; avant la bascule, un rapport « Professionnels prêts pour la bascule » (§3.6) ; un pro peut aussi être relancé par courriel (« Connecter votre Zoom »).
  - **Jetons :** chiffrés comme ceux de Gmail (`private.encrypt_pii`, liste de `private.pii_encrypted_values()`), lus seulement par les fonctions, jamais rendus au navigateur ; une tâche (`appointments.zoom_token_refresh`, toutes les heures) rafraîchit ceux qui expirent dans l'heure ; un échec de rafraîchissement (révoqué, mot de passe changé) passe la connexion à **« À reconnecter »** et avertit le pro et les conseillères (cloche).
  - **Création des liens :** à la réservation, au déplacement et à l'annulation, une file (`video_tasks`) est vidée par une tâche (`appointments.video_sync`) qui crée, modifie ou supprime la réunion sur le compte du pro (titre « Rendez-vous MANA », jamais le nom du client) ; le lien va sur le rendez-vous, dans la confirmation, le rappel et le bouton **« Démarrer »**. Une erreur Zoom laisse le rendez-vous réservé et l'affiche « Lien à créer », avec « Réessayer ».
  - **Pro non connecté :** l'éditeur de rendez-vous affiche un **avertissement avant de réserver en vidéo** (« Ce professionnel n'a pas connecté son Zoom : le client recevra le lien plus tard. ») ; on peut réserver quand même ou passer en téléphone ; dès que le pro se connecte, la file crée les liens des rendez-vous à venir et envoie un courriel « Votre lien de rencontre » aux clients concernés.
  - **Débrancher et rebrancher :** « Déconnecter » (confirmation) révoque l'accès chez Zoom, efface les jetons et marque les rendez-vous à venir « Lien à créer » ; « Reconnecter » refait l'autorisation. Le webhook de désautorisation de Zoom (signé, vérifié avec `timingSafeEqual`) fait la même chose si le pro retire l'application depuis Zoom.
  - **Application Zoom :** une application OAuth de la clinique (identifiant client et secret en secrets de fonction), portées minimales (réunions de l'utilisateur, profil). À vérifier au début du lot : si l'application doit être publiée sur la place de marché Zoom pour des comptes hors de celui de la clinique (question 41).
  - **Loi 25 :** aucun nom de client chez Zoom ; Zoom ajouté aux sous-traitants.
  - **Taille :** 6 jours en voie B, avant la bascule (au lieu de 5 : carte du pro, vue du personnel, rafraîchissement, avertissement).

- **Modèle de données :**
  - `availability_rules` (jour, heures **locales**, services permis, du … au …) et `availability_exceptions` (congé, bloc ponctuel).
  - `appointment_series` (chaque semaine ou aux 2 à 12 semaines, jours cochés, nombre de séances, fuseau ; conflits ignorés notés).
  - `appointments` (pro, service, début / fin `timestamptz`, mode, état, série, raison et détails d'annulation, « garder à l'horaire », note interne, message au client, personnel, pour le travail) avec contrainte d'exclusion `tstzrange` par pro sur les états actifs ; `appointment_participants` (client, rôle, présence : Sera présent / Présent(e) / Absent(e), confirmation du client).
  - `cancellation_reasons` (liste de départ ci-dessus, modifiable).
  - `video_connections` (un compte Zoom par pro : compte Zoom, état `connected` / `needs_reconnect` / `disconnected`, jetons chiffrés, expiration, ADR 0004) ; `video_tasks` (file créer / modifier / supprimer) ; `appointments.video_url`, `video_external_id`, `video_status` (`ready` / `pending` / `failed`).
  - `calendar_connections` et `external_busy_blocks` (occupé / libre Google, après la bascule).
  - `appointment_reminders` (canal `email`, prévu le, envoyé le, statut ; idempotent) ; `appointment_actions` (lien de confirmation en v1 ; modifier / annuler prévus, désactivés par défaut : purposes du socle) ; vue **« Clients sans rappel »** (rendez-vous à venir dont le client n'a pas de courriel ou dont le courriel a rebondi), pour que les conseillères les appellent tant que le SMS n'existe pas.
  - Publie : `get_open_slots(pro, from, to, service)`, `appointments_for_billing`, `first_appointments_confirmed`, `client_visits(client)`.
- **Intégrations :** socle (`runJob` pour rappels et « terminé », courriel Resend, liens sécurisés, notifications), Zoom (OAuth par pro), Google (occupé / libre, après la bascule).
- **IA :** aucune.
- **Dépendances :** Clients, Professionnels, Services et tarifs.
- **Taille :** XL : **20 jours en voie A avant la bascule** (disponibilités et vues ; réservation, états, annulations ; récurrence ; rappels et liens ; « Mon agenda »), **Zoom par pro 6 jours en voie B** ; après la bascule : occupé / libre Google (3 jours).
- **Questions :** 6, 7, 8, 23, 41, 43 (questions 4 et 5 répondues).

### 2.6 Facturation et paiements (`billing`) — XL

- **But :** un reçu après chaque séance (assureur, crédit d'impôt), frais d'annulation, IVAC et PAE, paiements reçus, et **paie des pros** (prix client × (1 − rétention), déjà calculé par Professionnels).
- **Utilisateurs :** adjointe ; administration ; professionnel (ses reçus et sa paie, en lecture) ; client (reçu par courriel).
- **Fonctionnalités :**
  - Garder (§F, §G) : facture par rendez-vous, lignes, TPS et TVQ par ligne, statuts brouillon → en attente → partielle → payée / annulée, moyens de paiement, frais d'ouverture pour un nouveau client, frais d'annulation, IVAC (forfait), PAE (règles de couverture), rapport IVAC, numérotation.
  - Changer : taux datés du socle, mémorisés sur la facture ; couples facturés correctement (l'ancienne n'en facturait qu'un, §F) ; algorithme PAE enfin appelé (§G) ; total 0 n'est plus « annulé » ; reçu PDF **rendu sur le serveur** (pdfmake, ADR 0008) avec ordre et numéro de permis du pro.
  - Nouveau : relevé mensuel de paie par pro ; export comptable.
  - **De GOrendezvous** ([visite §5, §15, §16](../research/2026-10-11-gorendezvous-tour.md)) :
    - **parcours :** facture envoyée après la séance, payable le jour même → paiement par **virement Interac** (dépôt automatique, rapproché par l'adjointe) ou **carte par le lien « PAYER »** (Stripe) → **reçu** envoyé dès le paiement enregistré (question 21) ; facture et reçu sont deux documents ;
    - **une facture porte plusieurs lignes** (plusieurs rendez-vous ou services) ; une facture peut aussi venir **sans rendez-vous** (frais d'inscription à la liste d'attente, §2.3 bis) ; une facture payée ou à plusieurs lignes ne s'annule pas : on fait une note de crédit ;
    - **couple : facture divisible**, un reçu par personne avec la part payée ;
    - **numérotation `AAAA-N`** (année + séquence) ; à la bascule, la séquence de 2027 continue celle de GOrendezvous ;
    - **modes de paiement, d'après les données** (7 154 paiements en 2026 : « Argent comptant » 4 955 / 632 k$, Interac 1 800 / 221 k$, Stripe 268 / 34 k$, notes de crédit 119, 24 remboursements, visite §18) : on garde **Interac, Stripe (carte), virement bancaire, chèque et note de crédit**, chacun relié à son compte QuickBooks comme aujourd'hui (Interac → « Virement bancaire à recevoir », Stripe → « Banque Stripe », virement et chèque → compte courant, note de crédit → compte courant) ; **remboursements** gérés (24 cette année). « Argent comptant » (le plus utilisé) est très probablement le **dépôt automatique Interac saisi comme comptant** : à confirmer avec Rachel (question 45) ; l'historique est importé tel quel sous un mode « Comptant (GOrendezvous) » inactif, relié au compte courant comme aujourd'hui. Accès D, PayPal, Square, cartes cadeau et de fidélité, assurance, « seulement TPS » : abandonnés (inutilisés ou déjà désactivés) ;
    - **reçu** (modèle confirmé par les données, visite §18) : numéro **unique pour la clinique** (pas par pro), clinique, titre du pro, « Membre de l'OTSTCFQ / OPQ : n° », adresse de la clinique et du client, signature, numéros de taxes imprimés automatiquement ; **relevé annuel** par client (année fiscale), par courriel ou PDF ;
    - **politique d'annulation à deux paliers**, en réglage daté (Services et tarifs) : préavis 24 h ; annulation tardive ou absence → **50 % la 1re fois, puis 100 %** ; retard non prolongé et facturé en entier. **Ce que les données montrent :** 549 + 56 lignes d'annulation en 2026, seulement ~103 facturées (17,75 à 140 $, montant tapé), jamais la règle signée. Donc, par défaut, **la ligne de frais est proposée et confirmée par l'adjointe** ; l'automatisation (posée seule) n'arrive qu'avec ton feu vert explicite et celui de Christine (question 23) ;
    - **vrais payeurs tiers** (gain net sur GOrendezvous, qui ne facture qu'un client ou un proche) : organisation PAE, IVAC ou employeur, n° de dossier, part couverte, **factures ou relevés en lot au payeur**, consommation du forfait PAE ; **après la bascule** (question 24) ; d'ici là, facture client à 0 $ comme aujourd'hui.
  - Abandons **confirmés par les données** : TELUS eRéclamations (0 réclamation, 0 prédétermination), Lumino Santé (inactif), dépôts Stripe et cartes enregistrées (aucun : lien de paiement seulement), cartes de visite (aucune ligne facturée), modes Accès D, PayPal, Square, assurance, « seulement TPS ».
- **Repris de PS Hub :** **porter le connecteur QuickBooks Online (décidé par Jonathan, 2026-10-11), construire la facturation clinique.**
  - Pris : le branchement OAuth (`quickbooks-oauth`, `quickbooks-callback`), la création de factures (`quickbooks-create-invoice/index.ts:363-523`), la synchro des paiements et la reprise (`sync-qbo-invoices`, `sync-single-qbo-payment`, `qbo-sync-cron`, `qbo-resync-worker`), la gestion des articles (`quickbooks-manage-item`, `quickbooks-sync-items`), le PDF (`qbo-download-invoice-pdf`).
  - **Ce qui se synchronise, et dans quel sens (l'app est la source) :**
    - **clients → QBO** : chaque payeur devient un client QBO parent et chaque dossier un sous-client « facturé avec le parent » (§2.6 bis, décidé par Jonathan) ; nom et numéro de dossier seulement ;
    - **factures / reçus → QBO** : chaque facture finalisée, avec un article QBO par service (lignes sobres, p. ex. « Rencontre 50 min », jamais un motif) et les taxes appliquées ;
    - **paiements → QBO** : chaque paiement enregistré dans l'app (Stripe, Interac, comptant), rattaché à sa facture ;
    - **QBO → app** : seulement les identifiants QBO et l'état de synchro (et, si le comptable saisit des paiements directement dans QBO, leur lecture pour rapprochement : question 25) ;
    - **paie des pros → QBO** (fournisseurs et factures fournisseur) : plus tard, question 25.
  - **Failles corrigées :** jetons QuickBooks **en clair** (`baseline.sql:20624-20634`) et lisibles par les super-utilisateurs via la RLS (`:30387`) → chiffrés comme Gmail, RPC `service_role` seulement, `revoke` ; `state` OAuth en base64 non signé, cru par le retour (`quickbooks-oauth/index.ts:47`, `quickbooks-callback/index.ts:29-30`) → `state` signé et expirant, retour vers `APP_URL` seulement ; tâche appelée avec la clé `service_role` en en-tête (`qbo-sync-cron/index.ts:435`) → `runJob` et `X-Job-Signature` (CLAUDE.md §7) ; un webhook Intuit, si utilisé, exige son jeton de vérification et passe par `claim_webhook_event`.
  - Pas copié : ni Stripe ni reçu de séance n'existent chez PS Hub ; factures SOMA, projets QBO et devis sont propres à Pergolas Signature.
- **Modèle de données :** `invoices`, `invoice_lines`, `payments`, `refunds`, `credit_notes`, `payer_allocations` (IVAC, PAE), séquence sans trou ; `professional_payouts` et lignes (instantané de la rétention, P4-151) ; `payment_provider_events`. Pour QuickBooks : `qbo_connection` (jetons chiffrés, `realm_id`, état ; aucun droit client), `qbo_links` (notre ligne ↔ identifiant QBO, version de synchro, dernière erreur en code), `qbo_sync_queue` (envois en attente, repris par la tâche). Publie `client_balance(client)`, `billing_summary`.
- **Intégrations :** socle (taxes, fichiers, PDF serveur, courriel avec pièce jointe, webhooks, `runJob`), Professionnels, fournisseur de paiement (§3.5), **QuickBooks Online** (OAuth Intuit ; fonctions `qbo-connect`, `qbo-callback` (user, administration), `qbo-sync` (job `billing.qbo_sync` et après chaque facture ou paiement)).
- **IA :** aucune.
- **Dépendances :** Rendez-vous, Clients, Services et tarifs, Professionnels.
- **Taille :** XL : **15 jours en voie A avant la bascule** (factures et lignes, paiements et reçus, relevé, frais d'annulation, couple) ; **Stripe et Interac 4 jours et QuickBooks 7 jours en voie B** ; payeurs tiers 6 jours après la bascule.
- **Questions :** 21, 23, 24, 25, 26, 42, 45 (question 22 répondue par les données).

#### 2.6 bis « Facturé à » : le client et le payeur (décidé par Jonathan, 2026-10-11)

- **Ses mots :** « pour QBO, je crois que le mieux c'est d'avoir un client "facturé à" et, dans QBO, un sous-client par dossier. C'est possible, pour un enfant par exemple, que le dossier soit au nom du client mais la facture au père ou à la mère. »
- **Deux notions séparées :**
  - le **client** : la personne servie, le dossier (`client_id`) ;
  - le **payeur**, **« Facturé à »** (`payer`), l'un de :
    - le client lui-même (par défaut) ;
    - une **personne liée** : parent ou tuteur, un dossier de Clients relié avec le droit « recevoir reçus et factures » (§2.2) ;
    - une **organisation** : PAE, IVAC ou employeur (modèle des payeurs tiers, §2.6).
- **Payeur par défaut** sur le dossier (onglet « Visites et paiements » : « Facturé à »), **remplaçable** pour un rendez-vous, une série ou une facture (p. ex. un PAE pour les 3 premières séances, puis le client).
- **Facture et reçu :**
  - la **facture** est adressée au payeur (nom, adresse, courriel du payeur ; elle part à lui) ;
  - le **reçu** nomme **la personne servie et le payeur** (« Services rendus à : Léa T. · Payé par : Marie T. »), ce dont l'assureur a besoin pour la réclamation d'un enfant ; il porte aussi le nom du professionnel, sa profession, son ordre et son numéro de permis, la date, la durée et la nature du service, le montant payé, le numéro de reçu, l'adresse de la clinique, et les taxes s'il y en a ;
  - **à vérifier** (avec Rachel et un échantillon d'assureurs) : les mentions exactes que demandent les principaux assureurs (certains exigent la date de naissance du patient, le numéro de membre ou la signature du professionnel), la mention du titulaire du régime quand il n'est pas le payeur, et ce que le reçu doit dire pour le crédit d'impôt pour frais médicaux (le parent peut le réclamer pour son enfant : le reçu doit nommer l'enfant comme patient et la personne qui a payé).
- **Dans QuickBooks :**
  - **payeur = client QBO (parent)** ; **chaque dossier = sous-client QBO** sous ce payeur, avec **« Facturer avec le parent »** (`Job = true`, `ParentRef`, `BillWithParent = true`) : les factures vont au payeur, et restent traçables par dossier ;
  - **un sous-client par paire (payeur, dossier)**, plutôt que re-parenter : quand le payeur d'un dossier change (PAE puis le client, ou un autre parent), on crée un nouveau sous-client sous le nouveau payeur et l'ancien reste avec son historique. **Pourquoi :** re-parenter un sous-client dans QuickBooks déplace tout son historique et son solde sous le nouveau parent, donc les anciennes factures et paiements sembleraient payés par le mauvais payeur ; la paire garde chaque facture sous celui qui l'a payée. Coût : quelques sous-clients de plus, rares ;
  - **noms** : QuickBooks exige un nom d'affichage unique ; le sous-client s'appelle « N° de dossier · Prénom N. » (complété d'un suffixe si la paire se répète) ; aucune information de santé ;
  - **le client qui paie pour lui-même** suit la même règle (client QBO = lui, sous-client = son dossier), pour une seule forme de rapport.
- **Couples et familles :**
  - une **facture divisée** = deux factures, chacune à son payeur, donc deux clients QBO parents (chacun avec le sous-client de son dossier) ;
  - **un seul payeur pour la famille** (p. ex. un parent pour deux enfants) = un client QBO parent avec un sous-client par enfant ; le relevé du parent regroupe tout ;
  - **parents séparés à 50 / 50** : deux payeurs avec une part chacun, deux factures et deux reçus (question 42).
- **À la bascule, les clients QBO créés par GOrendezvous :** GOrendezvous synchronise déjà QuickBooks, donc les clients existent. **Étape de correspondance** (lot FQ, puis I3) : lire la liste des clients QBO par l'API ; les rapprocher de nos dossiers et payeurs (courriel, nom, numéro de client de GOrendezvous s'il est dans QBO) ; les correspondances sûres sont gardées (le client QBO existant devient le payeur parent, nos sous-clients sont créés dessous) ; les autres vont dans un rapport à trancher ; **aucun client QBO n'est créé tant qu'une correspondance probable existe**. L'historique de GOrendezvous reste sous ses clients QBO actuels et n'est jamais renvoyé.
- **Modèle de données :** `invoices.client_id` (dossier) et `invoices.payer_kind` (`self` / `person` / `organisation`), `payer_client_id` ou `payer_organisation_id`, `payer_share_percent` ; `billing_payer_defaults` (dossier → payeur et part, datés) ; `billing_payer_overrides` (rendez-vous ou série → payeur) ; `qbo_links` (payeur → client QBO parent ; paire (payeur, dossier) → sous-client QBO). Une vérification en base refuse un payeur « personne » qui n'a pas le droit « recevoir reçus et factures » sur ce dossier.

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
  2. **Correspondances :** profils d'employés → `professionals` (table relue à la main ; « conseillère », « Administration » et « Z MATRICE » exclus) ; ~900 couples pro-service → les services du catalogue unique, par code (les 28 codes du gabarit sont connus, visite §18 ; les anciens services sans code, p. ex. « 50 minutes – Rencontre d'intervention web » 447 lignes, sont rattachés au code équivalent) ; états et raisons d'annulation ; modes de paiement (« Argent comptant » gardé tel quel en historique) ; étiquettes → champs (question 13).
  3. **Doublons :** chaque client passe par les **règles de doublons de Clients** (identité : courriel, téléphone, nom + date de naissance) : HIGH → même client (rattaché), MEDIUM → rapport à trancher ; aussi contre les clients déjà créés dans l'app depuis Demandes.
  4. **Essai à blanc** (par défaut) : tables `private.import_*`, rien d'écrit dans les tables des modules ; rapport : comptes, rejets et raisons, doublons, pros ou services sans correspondance, chevauchements, totaux de factures et de paiements comparés à QuickBooks.
  5. **Import réel avec ton feu vert**, idempotent (`external_ref` sur chaque ligne), audité comme « Importation » ; puis dix dossiers vérifiés par Christine et l'adjointe.
- **Règles :** historique en **lecture seule** (rendez-vous passés terminés ou annulés, factures historiques sans recalcul de taxes, sans envoi à QuickBooks, sans courriel) ; seuls les rendez-vous **futurs** deviennent actifs (rappels compris) ; la séquence de factures 2027 reprend après le dernier numéro de GOrendezvous ; les places restantes ne comptent pas l'historique.
- **Repris :** notre `import_professional` (essai à blanc par défaut) et `scripts/import-professionals.mjs` ([runbook](../runbooks/import-professionals.md)) ; rien de PS Hub.
- **Calendrier :** essai à blanc des clients début novembre ; des rendez-vous dès que l'export du support arrive et que les tables de Rendez-vous existent (fin novembre) ; de la facturation fin décembre ; **répétition complète** la semaine du 4 janvier ; **import final les 9 et 10 janvier 2027**, après le gel du 8 au soir.
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

- **SMS (décidé par Jonathan, 2026-10-11 : « on garde pour le futur »).** **Attention, régression :** GOrendezvous envoie aujourd'hui des rappels par texto chaque jour (~165 en octobre 2026, inclus au forfait, visite §18) ; à la bascule, les clients sans courriel ou qui ne lisent pas leurs courriels perdront leur rappel. Palliatif prévu dans Rendez-vous : la vue « Clients sans rappel » pour les appeler ; l'autre option est d'avancer les rappels Twilio (question 43). Ce que le SMS couvrirait le jour venu, dans `communications` (M, 5–7 jours) :
  - rappels de rendez-vous par texto (J-1, comme le courriel) (en plus du courriel), puis réponses simples (« OUI » pour confirmer) ;
  - fournisseur **Twilio** (numéro canadien à 10 chiffres enregistré ; Telnyx en solution de rechange) ; la centrale Yeastar de PS Hub n'est pas réutilisable ;
  - **« ARRÊT » / « STOP »** et **consentement** enregistré sur le client (LCAP), absents de PS Hub (seul un interrupteur `allow_sms` : `yeastar-send-sms/index.ts:85-93`) ;
  - repris de PS Hub : fils par les 10 derniers chiffres (`src/lib/sms/conversations.ts:1-40`), interface boîte / fil / composeur (`src/components/crm/sms/`), webhook signé HMAC (`yeastar-webhook/index.ts:874-895`) ;
  - données : `sms_messages` (corps effacés après 12 mois), `sms_consents`. Le modèle `appointment_reminders` prévoit déjà un canal, donc rien à refaire dans Rendez-vous.
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

- **Décidé (Jonathan, 2026-10-11) : plus tard.** Le jour venu : Twilio, rappels d'abord, consentement et « ARRÊT » obligatoires (§2.9). **Mais les SMS sont actifs aujourd'hui** (~165 rappels par mois) : régression à la bascule, question 43.

### 3.5 Fournisseur de paiement

- **Stripe, confirmé par les données :** la clinique a déjà un compte Stripe branché à GOrendezvous (268 paiements par carte en 2026), sans dépôt ni carte enregistrée → **lien de paiement seulement**, webhook signé réclamé par `claim_webhook_event`. Interac (1 800 paiements, dépôt automatique) est rapproché à la main dans « À rapprocher ». PS Hub n'a pas de Stripe.

### 3.6 Bascule hors de GOrendezvous

- **Date :** Rendez-vous et Facturation **basculent ensemble le lundi 11 janvier 2027** (repli : lundi 25 janvier), avant le renouvellement de GOrendezvous du 31 janvier ; gel de GOrendezvous le vendredi 8 au soir, import final les 9 et 10. Le déroulé (gel, import final, essai, fin de semaine de mise en service, retour en arrière) est dans le [plan de code §4](2026-10-11-modules-coding-plan.md).
- **Avant :** un compte par conseillère, les professionnels invités et leur Zoom branché, les 7 consentements publiés en français et en anglais avec leurs règles (§2.2 bis), QuickBooks branché, les modèles de courriel relus, une répétition complète la semaine du 4 janvier.
- **Retour en arrière :** jusqu'au mercredi 13 janvier, GOrendezvous reste payé et intact (gelé, pas supprimé) ; on peut y revenir en ressaisissant les rendez-vous créés depuis le 11 (rapport fourni par l'app).
- **Import complet de GOrendezvous** (décidé, §2.7) : clients, tout l'historique de rendez-vous, correspondance des pros, factures et paiements s'ils s'exportent. Essais à blanc dès que Clients est en place ; import final la fin de semaine avant la bascule, après un dernier export ; GOrendezvous gelé puis gardé en lecture.
- **Suite de la bascule :** courriels de rappel actifs dès le premier jour (pas de SMS : la vue « Clients sans rappel » est tenue chaque matin par une conseillère) ; QuickBooks branché avant la première facture ; Calendly reste en service jusqu'à la page publique d'appel découverte (question 44).

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

Les questions de la première version, celles de la visite de GOrendezvous (§13 et addenda) et les nouvelles, fusionnées, une seule fois chacune. **À trancher en premier : 1, 2, 23, 43, 44.**

**Bascule et import**
1. **Export de l'historique des rendez-vous :** il ne se fait que par le support de GOrendezvous. Qui le demande ? *Reco : Christine (propriétaire du compte), cette semaine, en demandant aussi les reçus et les consentements en lot ; sans cet export, l'historique des rendez-vous ne peut pas être importé.*
2. **Date de bascule :** lundi 11 janvier 2027 (gel le vendredi 8 au soir), repli le lundi 25, avant le renouvellement du 31 janvier. *Reco : ok ; demander aussi à GOrendezvous un accès en lecture quelques mois après (au mois, ou le forfait le plus bas) pour retrouver un ancien reçu.*
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
13. **Étiquettes :** les utiles deviennent des champs (tarif étudiant, tarif réduit, payeur externe, IVAC, PAE, banni, dossier incomplet, entente de paiement, facturation personnalisée) ; celles de satisfaction disparaissent. « Statut Indien » = exemption de taxes ? *Reco : ok ; l'exemption à confirmer par le comptable.*
14. **RAMQ :** demandé aux clients ? (TELUS eRéclamations et Lumino Santé : répondue par les données, jamais utilisés.) *Reco : non en v1.*
15. **Consentements :** recréer les 7 modèles dans la signature du socle, en français et en anglais (§2.2 bis) ; à l'import, garder le fait signé (modèle, version, date, signataire) sans les PDF un par un. *Reco : ok ; Christine relit les 7 textes et fournit ou valide les versions anglaises.*

**Demandes**
16. *(Répondue : la liste d'attente vit dans Demandes, §2.3 bis ; les frais sont la question 34.)*
17. **Dépistage PHQ-2 / GAD-2** du formulaire « Requêtes de service » : outils cliniques. *Reco : ne pas les reprendre (D8).*
18. **Formulaires du site → Demandes :** lot après la v1. *Reco : oui.*
19. **Les 7 questions du classeur** ([recherche §8.5](../research/2026-10-08-intake-workbook.md#85-open-questions-for-jonathan)). *Reco :* place rendue à l'annulation d'un premier rendez-vous ; une proposition retient la place 48 h ; exclusions en note surlignée ; liste d'attente pour toute discipline.
20. **IA dans Demandes et le jumelage :** aucune pour l'instant. *Reco : ok.*

**Facturation**
21. **Facture → paiement → reçu :** deux documents ; le reçu part **dès que le paiement est enregistré** (au lieu de « sous 24 h ouvrables ») ; l'adjointe valide les virements Interac. Qui envoie aujourd'hui ? *Reco : ok.*
22. *(Répondue par les données : lien de paiement seulement, aucun dépôt ni carte enregistrée.)*
23. **Frais d'annulation :** les données montrent que la politique signée (24 h ; 50 % puis 100 %) **n'est pas appliquée** (605 lignes d'annulation en 2026, ~103 facturées, montants tapés de 17,75 à 140 $). Veux-tu l'appliquer ? *Reco : la ligne de frais est proposée à chaque annulation tardive ou absence et l'adjointe la confirme ou l'efface ; on ne la pose seule qu'avec ton feu vert et celui de Christine, après un mois de chiffres.*
24. **PAE et IVAC aujourd'hui :** facturés comment (QuickBooks, relevé mensuel, n° de dossier) ? *Reco : à la bascule, garder la facture client à 0 $ et le processus actuel ; les factures en lot aux payeurs en février ; valider avec Rachel.*
25. **QuickBooks :** lignes sobres (code et nom du service, jamais un motif), chaque mode de paiement relié à son compte ; paiements saisis directement dans QuickBooks ? paie des pros plus tard. *Reco : ok ; à valider avec le comptable.*
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
42. **Parents séparés à 50 / 50 :** deux payeurs, deux factures et deux reçus, chacun avec sa part ? *Reco : oui, part réglée sur le dossier (« Facturé à » à deux payeurs).*

**Nouvelles questions (2e passe de données)**
43. **SMS, régression à la bascule :** GOrendezvous envoie ~165 rappels par texto par mois ; « SMS plus tard » les fait disparaître le 11 janvier. Deux options : (a) garder « plus tard » et donner aux conseillères la vue « Clients sans rappel » (rendez-vous dont le client n'a pas de courriel ou dont le courriel a rebondi) pour les appeler, 0,5 jour, dans le plan ; (b) avancer les rappels par texto Twilio (M, 5–7 jours : numéro, consentement, « ARRÊT », rappel J-1) comme premier lot de la voie B après la bascule (11–15 janvier), ou avant si tu retires autre chose. *Reco : (a) à la bascule, puis (b) en janvier si les conseillères le demandent ; d'ici là, la clinique peut dire aux clients que les rappels arrivent par courriel.*
44. **Calendly :** « Réserver un appel découverte » sur le site pointe vers Calendly. Le remplacer par notre page publique de réservation (plages des conseillères, demande créée automatiquement), ou le garder et recopier les réservations dans Demandes ? *Reco : le remplacer, mais seulement quand Demandes (a) est en place ; la page publique est prévue en décembre dans le tampon de la voie A et se reporte en janvier si la bascule le demande, Calendly n'ayant pas d'échéance.*
45. **« Argent comptant » (4 955 paiements, 632 k$ en 2026) :** c'est bien le dépôt automatique Interac saisi comme comptant ? *Reco : à confirmer avec Rachel ; si oui, « Comptant » n'existe plus comme mode actif et l'adjointe rapproche les dépôts Interac dans « À rapprocher » ; l'historique reste tel quel sous « Comptant (GOrendezvous) ».*
46. **Sexologie et orientation non taxées** (comme pratiqué) : le comptable confirme ? *Reco : garder non taxé, règle `to_confirm` affichée dans le catalogue jusqu'à sa réponse.*

**Consentements des clients (pour Christine, §2.2 bis)**
47. **Clauses facultatives :** dans les 7 textes, quelles sections sont des « Oui / Non » que le client accepte ou refuse une à une (p. ex. autoriser la communication avec un tiers, l'enregistrement, un stagiaire) ? *Reco : les lister ; chacune devient une clause imprimée avec sa réponse dans le PDF signé.*
48. **Nouvelle version (v16 du général, etc.) :** faire signer de nouveau **tous les clients actifs**, ou **seulement les nouveaux** ? *Reco : « nouveaux clients seulement » par défaut ; « tous les clients actifs » quand le texte change de fond (honoraires, politique d'annulation), choisi à la publication.*
49. **Conservation des PDF signés** et des consentements retirés : durée (Loi 25, dossier administratif) ? *Reco : la durée du dossier administratif du client, fixée par Christine dans Paramètres → Confidentialité ; aucune suppression automatique avant sa réponse.*

## 5. Prochaine étape

- Le [plan de code](2026-10-11-modules-coding-plan.md) détaille chaque module en lots, tâche par tâche pour Services et tarifs et Clients, avec le calendrier à deux voies, le déroulé de la bascule et les décisions à prendre avant chaque module. Il contient aussi le marquage **Keep / Change / Drop** de l'inventaire et de GOrendezvous exigé par CLAUDE.md §5.
- **Lundi 12 octobre :** voie A commence Services et tarifs (lot S1), voie B le branchement Gmail (lot CM1), si tu réponds aux questions 1, 2, 4 et 9.
- **Cette semaine, hors code :** demander l'export de l'historique des rendez-vous au support de GOrendezvous (question 1) et l'accès en lecture après la bascule (question 2).
- Les choix faits sans toi sont notés « délégués — révisables » dans le [journal des décisions](2026-10-07-decisions-log.md) (série R-).

