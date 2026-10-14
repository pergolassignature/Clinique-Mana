# Mise en service — la liste, dans l'ordre

**Pour :** Jonathan (avec Christine, l'adjointe, les professionnels et nos fournisseurs, quand une étape le dit). **J = lundi 30 novembre 2026**, le premier jour où la clinique travaille dans l'app. « T-14 » veut dire 14 jours avant J (le lundi 16 novembre).

Cette page rassemble, dans l'ordre où les faire, toutes les étapes de « Mise en service » qui étaient éparpillées dans le [statut](../plans/2026-10-07-status.md), les documents des modules (`docs/modules/`) et les runbooks. Les détails techniques restent dans ces documents : chaque étape renvoie au bon endroit.

> **Règles qui valent pour chaque étape**
> - Chaque action sur la base de la clinique est **ta décision, au moment où tu la fais**. Un agent ne touche jamais la base de la clinique sans ton feu vert.
> - **Aucune clé, aucun mot de passe, aucun NAS ni numéro de compte** dans le clavardage, un courriel ou git. Les clés se collent dans l'app (Paramètres) ou dans le tableau de bord du fournisseur, et se gardent dans le gestionnaire de mots de passe.
> - **Tant qu'un module est « Réservé aux testeurs »** (Paramètres → Modules), rien ne part vers un client : ni courriel, ni texto, ni facture, ni rappel. On teste donc en production avec des testeurs (toi d'abord), puis on « ouvre » le module à tous le jour venu.
> - **Les tâches planifiées de la clinique sont éteintes au départ** (Paramètres → Tâches planifiées). Les tâches d'entretien tournent toujours et ne se règlent pas (tableau à l'[annexe A](#annexe-a--les-tâches-planifiées)).

Légende des colonnes : **Qui** fait l'étape · **Où** dans l'app (ou ailleurs) · **Vérifier** comment savoir que c'est bon.

---

## 1. Dès maintenant, et au plus tard le 30 octobre (T-31)

### 1.1 Les fondations techniques

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 1 | Secrets du dépôt GitHub : `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (et `SUPABASE_DB_POOLER_URL` si besoin) | Jonathan | GitHub → Settings → Secrets | La prochaine fusion : « Apply Supabase migrations » est vert et dit « PII key health check passed » |
| 2 | Être averti des tâches en échec : notifications GitHub par courriel, « Only notify for failed workflows » | Jonathan | github.com → Settings → Notifications → Actions | Lancer une fois « Scheduled jobs health check (production) » à la main : vert |
| 3 | Variables Vercel : `VITE_DOCUMENSO_URL=https://sign.cliniquemana.com` (Production et Preview), puis redéployer | Jonathan | Vercel → Settings → Environment Variables | La signature intégrée s'ouvre dans l'app |
| 4 | Auth Supabase : les 5 modèles de `supabase/templates/` et leurs sujets en français ; la liste des adresses de retour contient `/connexion/confirmer`, `/reinitialiser-mot-de-passe`, `/mon-compte` et `/**` | Jonathan | Supabase → Authentication → Email Templates, URL Configuration | « Mot de passe oublié » envoie un lien vers `/connexion/confirmer` |
| 5 | Secrets des fonctions : `INTERNAL_FUNCTION_SECRET` (nouvelle valeur aléatoire), `APP_URL` et `ALLOWED_ORIGINS` (= `https://app.cliniquemana.com`), `EMAIL_TRANSPORT=resend` ; `SENTRY_DSN` au besoin. Jamais les `*_BASE_URL` locaux | Jonathan | Supabase → Edge Functions → Secrets | Un courriel de test part (étape 9) |
| 6 | Coffre de la base : `project_url` et `internal_function_secret` (la même valeur qu'à l'étape 5) | Jonathan | Supabase → SQL Editor (Vault) | Le lendemain matin, « Tâches planifiées » montre des exécutions « ok », jamais « configuration_missing » |
| 7 | **Copier la clé PII** dans le gestionnaire de mots de passe, avant le premier NAS ou numéro de compte réel ; vérifier les réglages de journalisation de la base | Jonathan ou Christine | [runbook clé PII](pii-key-escrow.md), étapes 1 à 7 | L'empreinte SHA-256 notée correspond ; `select public.pii_health_check()` répond `true` |
| 8 | Clé Google Places neuve, limitée à « Places API (New) », quotas 2 000 / 300 par jour, alerte de budget ; supprimer l'ancienne | Jonathan | Google Cloud → APIs ; secret `GOOGLE_PLACES_API_KEY` | Paramètres → Identité légale → « Adresse » propose des adresses |

### 1.2 Les courriels et la signature

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 9 | Clé Resend de l'app (« Sending access », limitée à `gestion.cliniquemana.com`) ; suivi des ouvertures et des clics désactivé | Jonathan | Paramètres → Courriels → « Clé d'API Resend » ; Resend → Domains | « M'envoyer un test » arrive |
| 10 | Webhook Resend vers l'adresse affichée dans Courriels (événements sent, delivered, delivery_delayed, bounced, complained) et son secret | Jonathan | Resend → Webhooks ; Paramètres → Courriels → « Secret du webhook » | « Dernier événement reçu » se met à jour ; un envoi à `bounced@resend.dev` affiche « Adresse introuvable » |
| 11 | Documenso, étape 7 : jeton d'API `clinique-mana-app`, « Adresse de l'instance » `https://sign.cliniquemana.com`, webhook et son secret ; logo, double authentification de l'admin, sauvegarde de `.env` et `cert.p12` | Jonathan | Documenso ; Paramètres → Signature électronique ; [runbook Documenso](documenso-instance.md) | « Tester la connexion », puis « Envoyer un document test » ; le PDF signé contient le certificat **et** le journal d'audit |
| 12 | Les 7 vérifications `VERIFY` de Documenso (position des champs, annulation, PDF signé, retour après signature, etc.) | Jonathan (ou un agent avec ton feu vert) | `docs/plans/2026-10-08-documenso-envelope-api-plan.md` §4 | Chaque résultat noté au statut |
| 13 | Christine relit **tous** les modèles de courriels | Christine | Paramètres → Courriels → Modèles | Chaque modèle marqué relu |

### 1.3 Les comptes et les professionnels

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 14 | Inviter un compte par conseillère et pour l'adjointe (E12) | Jonathan | Paramètres → Utilisateurs | Chacune se connecte |
| 15 | Professionnels : le modèle « Contrat de service » a un **brouillon** avec le texte 2026 (« Convention de prestation de services professionnels », sans ligne « Texte à faire valider… » ; en production, la version 2, la version 1 publiée restant en usage d'ici là) ; Christine le relit dans l'aperçu (« Accorde le droit à l'image » activé) (l'Annexe A s'y imprime en tableau « Nature du service · Part du Professionnel · Part de la Clinique MANA »), puis le publie. Le contrat 2026 **comprend le droit à l'image (article 6.2)** : un nouveau professionnel n'a plus de « Consentement au droit à l'image » séparé à signer. Ce formulaire séparé ne sert qu'aux professionnels sous un ancien contrat : le publier seulement si on veut le leur envoyer (alors le valider et retirer « Texte à faire valider… »). « Identité légale » et « Signataire » remplis | Christine, Jonathan | Paramètres → Contrats et formulaires ; Identité légale | Un contrat test envoyé à ton adresse se signe, initiales comprises ; l'Annexe A montre les bons pourcentages (premier palier de la grille de la profession, et les taux de Paramètres → Rémunération) ; une fois signé, l'onglet Documents du dossier test lit « Accordé par le contrat de service signé le … » |
| 16 | Importer les ~50 professionnels : essai local, essai sur la base de la clinique, puis `--commit` | Jonathan | [runbook import des professionnels](import-professionals.md) | 5 fiches vérifiées ; les fichiers CSV et les rapports supprimés |
| 17 | Chaque professionnel a un titre principal et un taux de départ ; son numéro IVAC s'il en a un | Adjointe | Professionnels → fiche → Rémunération ; Expérience et payeurs | Paramètres → Rémunération ne signale aucun manque |
| 18 | **Le superviseur de chaque stagiaire** (les reçus l'impriment) | Adjointe | Professionnels → fiche → Identité et permis → « Supervision » | Un reçu test d'une séance de stagiaire nomme le superviseur |
| 19 | Tâches « Rappels d'invitation » et « Échéances des assurances » activées quand les invitations partent | Jonathan | Paramètres → Tâches planifiées | « Dernière exécution » le lendemain matin |

### 1.4 Le 30 octobre

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 20 | Courriel aux professionnels (connexion, questionnaire, lien vidéo à saisir avant le 16 novembre) et aux clients (nouvelle plateforme ; lien pour enregistrer une carte : les cartes ne passent pas de GOrendezvous) | Jonathan, Christine | Paramètres → Courriels ; Stripe en mode test d'abord | Quelques réponses reçues |

---

## 2. Lundi 2 novembre (T-28) : la bascule partielle (Demandes, consentements, Gmail)

Ouvre les modules **dans l'ordre de leurs dépendances** (un module ne s'active pas tant que ceux dont il dépend sont éteints ; l'[annexe B](#annexe-b--lordre-des-modules) donne l'ordre complet).

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 21 | Activer **Services et tarifs** ; vérifier les prix et le rapport d'écarts ; noms 20100 et 20102 confirmés ; **20170 non taxable** (R-88) | Jonathan, Christine | Paramètres → Modules ; Paramètres → Services et tarifs → « Prix » | « Aucun écart » avec GOrendezvous, ou chaque écart expliqué |
| 22 | Activer **Clients**, puis **Demandes** — ouverts à tous (pas « Réservé aux testeurs ») : sinon aucune proposition, aucun suivi ni aucune confirmation d'appel ne part | Jonathan | Paramètres → Modules | Une demande test va jusqu'à « Placée » |
| 23 | **Consentements (E5)** : Christine remplace chaque « Texte provisoire » en français (textes reçus le 14 octobre, à relire d'abord : [réponses](../research/2026-10-14-christine-answers-suite.md#consentements-pièces-jointes) ; pas de version anglaise, R-75 ; « Stagiaire » encore à recevoir), publie, puis active les règles (le général pour tous, les autres par situation) | Christine | Paramètres → Consentements → « Modifier le texte », « Publier », règles | « Publier » apparaît une fois le texte remplacé ; une demande de signature test arrive et se signe |
| 24 | Durée de conservation des consentements signés : **5 ans** (R-76) | Christine | Paramètres → Consentements → « Conservation » | La durée s'affiche |
| 25 | Tâche « Rappels de consentement » | Jonathan | Paramètres → Tâches planifiées | « Dernière exécution » à 8 h le lendemain |
| 26 | **Liste d'attente** : consentement « liste d'attente » publié et sa règle active ; frais 50100 vérifiés ; réglages (8 semaines par défaut ; courriel de suivi éteint par défaut) ; tâche « Suivi de la liste d'attente » | Christine, Jonathan | Paramètres → Liste d'attente ; Tâches planifiées | Une inscription test devient « active » une fois le consentement signé et les frais payés |
| 27 | **Appels découverte** : plages, durée, délai, capacité, puis « Réservation en ligne » ouverte ; le bouton du site pointe vers `…/appel-decouverte?clinique=<id>` ; les rendez-vous Calendly recopiés, puis Calendly résilié | Jonathan, une conseillère | Paramètres → Appels découverte ; site web | Un appel réservé sur la page publique arrive dans Demandes, avec sa confirmation par courriel |
| 28 | **Gmail** (Communications) : projet Google Cloud « Interne », API Gmail et Pub/Sub, client OAuth (retour `/courriels/retour-google`), sujet Pub/Sub ; activer Communications ; coller les identifiants ; abonnement « push » ; connecter `info@` puis `administration@` ; tâches « Synchronisation Gmail » et « Renouvellement de la surveillance Gmail » | Jonathan | Google Cloud ; Paramètres → Courriels Gmail ; [doc Communications](../modules/communications.md) | Les deux boîtes « Connectée » ; un courriel envoyé à `info@` apparaît en moins d'une minute |
| 29 | Une fois Clients ouvert : « Rattachement des anciens courriels », une fois, avec « Exécuter maintenant » | Jonathan | Paramètres → Tâches planifiées | Des fils rattachés à leurs dossiers |
| 30 | **IA (rédaction)** : clé OpenAI avec plafond mensuel ; modèle, prix et plafond (50 $ par défaut) ; « Rédiger avec l'IA » activé | Jonathan | Paramètres → IA | « Utiliser », « Annuler », « Raffiner » fonctionnent ; « Ce mois-ci » compte la demande |

---

## 3. Du 2 au 16 novembre (T-28 à T-14) : tout le reste, branché et testé

Les modules Rendez-vous, Facturation et Rapports s'activent **réservés aux testeurs** : rien ne part vers un client avant J.

### 3.1 Rendez-vous

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 31 | Activer **Rendez-vous**, réservé aux testeurs (Services et Clients doivent être actifs) | Jonathan | Paramètres → Modules | L'agenda s'affiche |
| 32 | Jours et heures d'ouverture (lundi au vendredi, 8 h à 17 h), rappel **1 jour ouvrable avant à 8 h** (comme GOrendezvous), « Préavis compté en heures ouvrables » ; sens de « 24 h ouvrables » confirmé (AP-31) ; liens « Annuler » et « Demander un changement » allumés (R-89) | Jonathan, Christine | **Paramètres → Agenda** | Les valeurs affichées ; voir aussi l'étape 52 |
| 33 | **Zoom** : application « General » sur le Zoom Marketplace (retour `/mon-agenda/videoconference`, droits « meetings » et « user read », événement « App deauthorized ») ; identifiants collés ; tâche « Liens Zoom des rendez-vous » | Jonathan | Zoom Marketplace ; Paramètres → Vidéoconférence | Un rendez-vous vidéo test a son lien Zoom |
| 34 | **Chaque professionnel** connecte son Zoom ou saisit un lien fixe (la clinique peut le saisir pour lui) — **au plus tard le 16 novembre** (E8) | Chaque professionnel, adjointe | Mon agenda → Vidéoconférence ; fiche du professionnel | Aucun professionnel actif sans lien |
| 35 | **Agendas Google** (plages occupées) : projet Google Cloud séparé, écran « Externe », API Calendar, retour `/mon-agenda/agenda-google` ; identifiants collés ; tâche « Plages occupées des agendas Google » ; chaque professionnel qui le veut se connecte | Jonathan, professionnels | Google Cloud ; Paramètres → Agenda → « Agendas Google des professionnels » | Une plage occupée de l'agenda Google d'un testeur apparaît dans l'agenda |

### 3.2 Les textos (Yeastar)

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 36 | anexa5 crée le canal SMS de la clinique, son numéro et son application ; l'entente de traitement PS–clinique est signée (Loi 25) | anexa5, Jonathan | Centrale Yeastar | Les identifiants reçus |
| 37 | Centrale (adresse, identifiant, numéro), « Secret de l'application » ; deuxième entrée « Webhook Event Push » (événements 30030, 30031, 30032) et son secret | Jonathan | Paramètres → Textos | Le « Test » de la centrale affiche « Dernier événement reçu le … » |
| 38 | Christine relit le texte de consentement (avec ARRÊT) et la réponse de retrait | Christine | Paramètres → Textos | — |
| 39 | Tâche « Envoi des textos » activée, puis « Envoyer un texto de test » ; répondre, puis répondre « ARRÊT » | Jonathan | Paramètres → Textos ; Tâches planifiées | Le texto arrive ; la réponse et le retrait s'affichent dans « Textos » |

### 3.3 Facturation

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 40 | Activer **Facturation**, réservé aux testeurs (Clients, Services, Professionnels et Rendez-vous actifs) | Jonathan | Paramètres → Modules | — |
| 41 | **Adresse Interac** de la clinique ; « Note des factures » relue avec Christine | Jonathan, Christine | Paramètres → Coordonnées bancaires ; Paramètres → Facturation | Une facture test montre l'adresse et la note |
| 42 | **QuickBooks** : application Intuit (identifiants, retour `/facturation/retour-quickbooks`), connexion de la vraie compagnie ; tableau des comptes et des deux taxes vu avec le comptable ; « À décider » des clients réglés. **L'envoi reste en pause** | Jonathan, Christine, comptable | Paramètres → QuickBooks ; Paramètres → Clients QuickBooks | « Connecté » ; rien dans « Envoi à QuickBooks » |
| 43 | **Stripe** : clé secrète (`sk_test_` d'abord), webhook (5 événements) et son secret ; tâche « Remboursements par Stripe » ; Christine écrit le texte de consentement de la carte au dossier (E7) | Jonathan, Christine | Paramètres → Paiements en ligne | Avec une carte de test : lien de carte, facture, « Prélever maintenant », « Payer en ligne », remboursement |
| 44 | **IVAC et PAE** : IVAC : numéro de fournisseur, sans courriel (envoi par le portail de la CNESST, R-84), numéro IVAC de chaque professionnel (liste reçue le 14 octobre) ; chaque fournisseur PAE | Adjointe, Christine | Paramètres → Payeurs tiers | Chaque payeur complet |
| 45 | **Paie** : part du professionnel confirmée : 70 % des frais d'annulation, 85 % des rapports (rétentions 30 % et 15 %, R-59) ; réglages relus | Christine | Paramètres → Paie ; Paramètres → Rémunération | — |

### 3.4 Rapports et essais

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 46 | Activer **Rapports** (après Facturation et Rendez-vous) | Jonathan | Paramètres → Modules | « Revenus » d'un mois connu = l'export « Revenus » de GOrendezvous ; « Exporter (CSV) » fonctionne |
| 47 | **Les séances d'essai de novembre**, puis le nettoyage | Jonathan, l'équipe | [runbook des essais](essais-novembre.md) | Chaque essai coché |

---

## 4. Du 23 au 26 novembre (T-7 à T-4) : la répétition et le go/no-go

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 48 | **Répétition complète des imports** sur la base locale avec les vrais exports (rien sur la base de la clinique) | Jonathan | [runbook de l'import](import-gorendezvous.md) ; `~/Clinique-MANA-import/` (jamais dans le dépôt) | Les rapports sans erreur ; aucun chevauchement à venir |
| 49 | `employes.csv` et `services.csv` relus | Jonathan, Christine | `~/Clinique-MANA-import/` | Aucune ligne refusée à l'essai |
| 50 | **Go/no-go du 26 novembre** : tout ce qui précède est fait ou a un plan B ; l'équipe sait qui fait quoi du 27 au 30 | Jonathan, Christine | — | Décision notée au statut |

---

## 5. Vendredi 27 novembre (T-3) : le gel

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 51 | **18 h : plus rien ne s'écrit dans GOrendezvous** ; l'équipe note sur papier ce qui arrive pendant le gel | Christine, l'équipe | GOrendezvous | — |
| 52 | **Rappels de GOrendezvous coupés, le soir, après son dernier lot.** GOrendezvous rappelle « 1 jour avant » sans envoi la fin de semaine : son lot du vendredi a rappelé les rendez-vous de samedi à lundi 30. L'app rappellera, dès lundi, ceux de mardi 1er décembre (I-19). Si GOrendezvous rappelait 48 h d'avance, il faudrait le couper un soir plus tôt | Jonathan | GOrendezvous → Communications → Notifications et rappels | Le réglage de GOrendezvous affiche les rappels coupés |
| 53 | **Exports finaux**, tous du même moment, en « CSV UTF-8 » dans `~/Clinique-MANA-import/` (mode 700) : clients, liens, rendez-vous (avec l'id du rendez-vous et le ClientId si le support les fournit), consentements signés, les trois « Revenus » | Jonathan | GOrendezvous ; support GOrendezvous | Chaque fichier ouvert une fois pour vérifier son en-tête |
| 54 | **Noter le dernier numéro de facture de GOrendezvous** pour chaque année | Jonathan | GOrendezvous → Facturation | Noté (pas dans git) |

---

## 6. Samedi 28 et dimanche 29 novembre (T-2, T-1) : les imports, dans cet ordre

Pour chaque commande : **l'essai d'abord**, lire le rapport, puis la même commande avec `--commit` (taper « importer »), dans ton terminal, avec ton compte. Si les modules sont encore réservés aux testeurs, **tu dois être testeur de chacun** (sinon leurs permissions te manquent). Les commandes exactes : [runbook de l'import](import-gorendezvous.md).

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 55 | `clients` (avec les liens et les payeurs « à compléter ») ; ensuite, fusionner les doublons signalés | Jonathan | Terminal ; Clients → « Fusionner » | Le rapport : 0 erreur ; les doublons traités |
| 56 | `factures` (lignes et paiements) ; relancer avec `--clients-map` pour les factures sans dossier | Jonathan | Terminal | Le total par mois = GOrendezvous ; les laissées de côté expliquées |
| 57 | `consentements` — **avant** les rendez-vous (une inscription à la liste d'attente n'est active qu'avec son consentement) | Jonathan | Terminal | Le nombre importé = l'export, moins les lignes listées |
| 58 | `rendez-vous` (et la liste d'attente) | Jonathan | Terminal | **Aucun chevauchement à venir** ; les rendez-vous sans dossier ajoutés par une relance |
| 59 | `payeurs` (« Payé par ») | Jonathan | Terminal | Les payeurs sans le droit « recevoir reçus et factures » ajoutés dans les proches, puis relance |
| 60 | La numérotation suit le dernier numéro noté au gel (`set_invoice_sequence` au besoin) | Jonathan | Paramètres → Facturation → « Numérotation » | La prochaine facture suit celle de GOrendezvous |
| 61 | **Christine vérifie 5 clients pris au hasard** : dossier, proches, rendez-vous à venir, factures et soldes, consentements | Christine | Clients | Les 5 sont justes |
| 62 | L'adjointe complète les payeurs « à compléter » (IVAC, PAE) | Adjointe | Clients → « Payeurs à compléter » | La liste est vide, ou ce qui reste est noté |

---

## 7. Lundi 30 novembre (J), avant 8 h : l'ouverture

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 63 | **« File du matin à partir du » = J** et **« Relances à partir du » = J** (sans elles, aucune facture n'est préparée et aucune relance ne part ; les factures importées ne sont jamais relancées) | Jonathan | Paramètres → Facturation | Les deux dates affichées |
| 64 | **Ouvrir les modules à tous** (décocher « Réservé aux testeurs »), dans cet ordre : Clients et Demandes (déjà ouverts le 2 novembre), Rendez-vous et Communications, puis Facturation et Rapports | Jonathan | Paramètres → Modules | Chaque module affiche « Ouvert à tous » |
| 65 | **Activer les tâches, une à une**, avant 8 h pour la première ; avant chaque suivante, regarder la « Dernière exécution » et la cloche :<br>1. « Courriels et rappels des rendez-vous » — son premier passage rappelle les rendez-vous de **mardi 1er décembre**, jamais ceux de lundi (déjà rappelés par GOrendezvous vendredi) ;<br>2. « Envoi des textos » (déjà actif depuis l'étape 39 ; le vérifier) ;<br>3. « Factures, reçus et relevés » ;<br>4. « Prélèvements des cartes au dossier » (seulement une fois des cartes enregistrées ; Stripe en clés réelles) ;<br>5. les tâches restantes de l'[annexe A](#annexe-a--les-tâches-planifiées) qui ne sont pas encore actives.<br>**Pas** « Envoi à QuickBooks » : il attend le go/no-go (étape 67) | Jonathan | Paramètres → Tâches planifiées | Un rappel de mardi reçu sur ton adresse ; aucun envoi pour un rendez-vous importé passé ; la file du matin ne montre que des rendez-vous à partir de J |
| 66 | La journée : réservations, déplacements, annulations, paiements faits dans l'app ; ce qui a été noté sur papier pendant le gel est saisi | L'équipe | — | Aucun retour à GOrendezvous |

---

## 8. Mercredi 2 décembre, midi (J+2) : le go/no-go final

| # | Étape | Qui | Où | Vérifier |
|---|---|---|---|---|
| 67 | **Go/no-go** : la liste de la [section 7 du runbook de bascule](gorendezvous-cutover.md#7-le-gono-go-fin-de-la-première-journée-ou-j1). Go : « Démarrer l'envoi » à QuickBooks, puis activer la tâche « Envoi à QuickBooks » (les deux sont nécessaires) | Jonathan, Christine, comptable | Paramètres → QuickBooks ; Tâches planifiées | La liste « Envoi à QuickBooks » se vide, sans refus |
| 68 | **Fermer les importations GOrendezvous (après la bascule).** Une fois la dernière importation vérifiée (clients, factures, consentements, rendez-vous, payeurs) : ouvrir la carte « Importation GOrendezvous », cliquer « Fermer les importations » et confirmer. Dès ce moment, tous les outils d'importation de GOrendezvous sont refusés pour la clinique, quelles que soient les permissions. Pour une importation tardive, « Rouvrir les importations » sur la même carte ; les refermer dès qu'elle est terminée et vérifiée. Aucune requête SQL | Un administrateur (`modules.manage`) | Paramètres → Modules → « Importation GOrendezvous » ; détail : [runbook de l'import](import-gorendezvous.md), « After » | La carte affiche « Importations fermées », avec la date et le nom de la personne |
| 69 | **Supprimer ensuite les exports bruts et les rapports d'import** de l'ordinateur (CSV, sources Excel, copies dans Téléchargements ou les courriels), puis vider la corbeille | Jonathan | `~/Clinique-MANA-import/` | Le dossier est vide |
| 70 | GOrendezvous reste en lecture seule un mois, puis on résilie après l'archivage des derniers exports hors du dépôt | Jonathan | GOrendezvous | — |

**No-go ou problème grave :** le [retour arrière](gorendezvous-cutover.md#8-le-retour-arrière-si-la-clinique-doit-revenir-à-gorendezvous). Date de repli : 11 janvier ; limite : 31 janvier.

---

## Annexe A — Les tâches planifiées

**À activer** (éteintes au départ, Paramètres → Tâches planifiées), avec l'étape où on le fait :

| Tâche | Clé | Étape |
|---|---|---|
| Rappels d'invitation | `professionals.invitation_reminders` | 19 |
| Échéances des assurances | `professionals.insurance_expiry_notice` | 19 |
| Rappels de consentement | `clients.consent_reminders` | 25 |
| Nouvelles signatures (campagne, facultatif) | `clients.consent_campaign` | au besoin, après 23 |
| Suivi de la liste d'attente | `demandes.waitlist_followup` | 26 |
| Synchronisation Gmail ; Renouvellement de la surveillance Gmail | `communications.gmail_sync`, `communications.gmail_watch_renew` | 28 |
| Liens Zoom des rendez-vous | `appointments.video_sync` | 33 |
| Plages occupées des agendas Google | `appointments.google_busy_sync` | 35 |
| Envoi des textos | `communications.sms_dispatch` | 39 |
| Remboursements par Stripe | `billing.stripe_refunds` | 43 |
| **Courriels et rappels des rendez-vous** | `appointments.messages` | **65, J avant 8 h** |
| Factures, reçus et relevés | `billing.documents` | 65 |
| Prélèvements des cartes au dossier | `billing.stripe_charges` | 65 |
| **Envoi à QuickBooks** (avec « Démarrer l'envoi ») | `billing.qbo_push` | **67, après le go/no-go** |

**Toujours actives, rien à régler** (entretien) : notamment la file du matin (`billing.build_drafts`, réglée par la date « File du matin à partir du »), les relances et frais (`billing.follow_up`, réglés par « Relances à partir du »), les rendez-vous passés notés terminés (`appointments.mark_completed`), les périodes de paie, la clôture des payeurs, le jeton QuickBooks, l'expiration des propositions, la libération des créneaux retenus, la capacité des professionnels et les purges. Le [runbook de bascule](gorendezvous-cutover.md) le dit aussi.

## Annexe B — L'ordre des modules

Un module ne s'active qu'une fois ses dépendances actives, et ne s'ouvre à tous qu'une fois ses dépendances ouvertes. Pour remettre un module en « Réservé aux testeurs », on commence par ceux qui en dépendent.

1. Professionnels (déjà ouvert)
2. Services et tarifs · Clients · Communications (dépendent de Professionnels ; Communications ne dépend de rien)
3. Demandes (Clients, Professionnels)
4. Rendez-vous (Clients, Services, Professionnels)
5. Facturation (Clients, Services, Professionnels, Rendez-vous)
6. Rapports (Facturation, Rendez-vous)

## Annexe C — Ce qui bloque encore la mise en service

- **Christine :** les 7 textes de consentement en français et en anglais (E5) ; les contrats ; FPay-6 ; S-5 ; AP-31 ; la durée de conservation des consentements ; les libellés de suivi des demandes (D-40) ; la question 62 (exclusions par professionnel) ; l'EFVP et la politique de confidentialité ; les détails IVAC et PAE.
- **Support GOrendezvous (E1) :** l'export des rendez-vous, idéalement avec l'id du rendez-vous et le ClientId ; savoir si les consentements signés s'exportent.
- **Rachel (E11) :** les exemples d'avis Interac (lecture automatique des virements).
- **Comptable :** le NAS, « avant taxes », le tableau des comptes QuickBooks, l'accord pour l'envoi à partir de J.
- **Jonathan :** Documenso étape 7 et ses 7 vérifications ; la publication de l'application Zoom (des semaines possibles) ; l'application Google « Externe » ; les comptes des conseillères (E12) ; les questions ouvertes du statut.
