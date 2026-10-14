# Essais de novembre — listes par rôle

**Pour :** Jonathan et l'équipe de la clinique (adjointe, conseillères, un ou deux professionnels). **But :** faire le tour complet de l'app **en production**, avec les modules « Réservé aux testeurs » et des clients fictifs, avant la bascule ([runbook de bascule](gorendezvous-cutover.md)). **Liens :** [statut et « Mise en service »](../plans/2026-10-07-status.md) ; les guides par rôle : [conseillère](../guides/conseillere.md), [adjointe](../guides/adjointe.md), [professionnel](../guides/professionnel.md), [administrateur](../guides/admin.md).

> **Ces essais se font sur la vraie base de la clinique.** Rien n'y est effacé : un dossier se fusionne, s'archive ou s'anonymise, et une facture se crédite. Aucun vrai client n'est touché si l'on suit les règles ci-dessous.

## 1. Avant de commencer (Jonathan)

1. **Les modules sont réservés aux testeurs.** Dans Paramètres → Modules, chaque module à essayer est activé avec « Réservé aux testeurs ». Les personnes qui testent sont ajoutées comme testeuses, Jonathan compris. Tant qu'un module est réservé :
   - les autres ne le voient pas ;
   - **les envois automatiques du module sont retenus**, même vers une adresse de la clinique (P3-40, CC-14) : confirmations, rappels, propositions, consentements, factures, relances, textos ;
   - le composeur de courriels n'écrit qu'aux adresses de la clinique (les autres sont refusées) ;
   - pour voir un envoi, on se sert des envois de test : « M'envoyer un test » d'un modèle (Paramètres → Courriels) et « Envoyer un texto de test » à votre cellulaire (Paramètres → Textos).
2. **Les tâches automatiques restent désactivées** (Paramètres → Tâches planifiées), sauf celles qu'un essai demande. Chacune est remise à l'arrêt après l'essai.
3. **Les comptes :** chaque personne qui teste se connecte avec son propre compte et son propre rôle. On ne prête pas un compte.
4. **Un canal pour les problèmes** (section 8) est connu de tous.

## 2. Les règles des données fictives

- **Chaque client fictif s'appelle « Test … »** (par exemple « Test Adjointe-1 », « Test Conseillère-3 »), avec une date de naissance fictive.
- **Coordonnées :** l'adresse courriel et le cellulaire **de la personne qui teste**, jamais ceux d'un vrai client : même si un envoi partait par erreur, il n'irait qu'à elle.
- **Jamais de vraie information clinique**, même inventée de façon réaliste : le motif est une étiquette (« Anxiété »), sans détail.
- **Les professionnels :** on utilise le professionnel « test » créé pour les essais, ou celui qui teste, sur son propre agenda.
- **Les factures :** une facture finalisée prend un **vrai numéro** de la suite (AAAA-N), et ce numéro ne revient pas. On en fait le moins possible, chacune créditée après l'essai (section 7). Le comptable est prévenu des numéros utilisés.

## 3. Adjointe

| # | Scénario, du début à la fin | Ce qu'il faut vérifier |
|---|---|---|
| A1 | Créer le client « Test Adjointe-1 » ; l'app signale un doublon possible ; créer quand même, puis ajouter un parent comme proche, avec le droit de recevoir les factures | Le doublon est signalé sans bloquer. Le proche paraît dans le dossier avec ses droits. |
| A2 | Prendre un rendez-vous pour ce client dans l'Agenda : un clic sur une plage libre, le service, le mode vidéo | Le rendez-vous paraît à la bonne heure ; sa confirmation est retenue (module réservé), sans erreur. |
| A3 | Glisser le rendez-vous une heure plus tard, puis l'annuler avec une raison | Le déplacement est refusé hors des disponibilités, ou demande « Hors disponibilités » et une raison. L'annulation demande une raison. |
| A4 | Facturation → la file du matin : la séance d'hier d'un client test, « Envoyer » | La facture sort avec son numéro, le bon payeur et les bonnes taxes ; son PDF est dans le dossier, son courriel retenu (module réservé). |
| A5 | Enregistrer un paiement Interac partiel, puis le solde | Le reçu est créé. Le statut passe « Payée en partie », puis « Payée ». |
| A6 | Rembourser une partie du paiement, puis créditer la facture | Le remboursement est enregistré, et la note de crédit NC-AAAA-N est créée. |
| A7 | La liste d'attente : inscrire « Test Adjointe-1 », puis « Facturer l'inscription » | Les frais passent à « Facturés », puis à « Payés » une fois la facture payée, et l'inscription devient active. |
| A8 | Paramètres → Utilisateurs et accès : donner le rôle « Conseillère » au compte test d'une collègue | Le rôle se donne, même si un module est désactivé (CC-15). |

## 4. Conseillère

| # | Scénario | Ce qu'il faut vérifier |
|---|---|---|
| C1 | Demandes : recevoir la demande « Test Conseillère-1 », la qualifier (motifs, disponibilités, mode, langue), proposer un professionnel | Les motifs sont écrits en entier, par catégorie. La proposition est enregistrée ; son courriel est retenu (module réservé) et la demande le dit. |
| C2 | Le modèle du courriel de proposition : « M'envoyer un test » | Le courriel de test arrive à la conseillère, avec le bon texte et un lien d'exemple. |
| C3 | Appels découverte : planifier un appel, le retrouver le jour même, le marquer fait | Il paraît dans la liste du jour, puis « Fait ». |
| C4 | Courriels : répondre à un courriel qu'une collègue a envoyé à la boîte de la clinique, avec « Rédiger avec l'IA » puis « Raffiner » | La proposition salue avec `{{person.first_name}}` si le fil est rattaché à un dossier. « Utiliser » remplace le texte, et l'envoi à la collègue part après 5 secondes. |
| C5 | Textos : enregistrer le consentement du client test (cellulaire de la conseillère), puis écrire | Tant que Communications est réservé, le texto est refusé en clair (« suspendus »). Le test réel se fait par « Envoyer un texto de test » (admin, D6). |
| C6 | Consentements : préparer le consentement général du client test | La demande est créée ; son envoi est retenu (module réservé) et le dossier montre « À obtenir ». |

## 5. Professionnel

| # | Scénario | Ce qu'il faut vérifier |
|---|---|---|
| P1 | Mon agenda → Disponibilités : glisser pour ajouter une plage samedi 9 h – 12 h, « Seulement cette semaine », puis « Annuler » | La plage paraît, puis disparaît. Le toast dit « Disponible le samedi 9 h – 12 h ». |
| P2 | Déplacer une plage et en raccourcir une autre ; « Je suis en vacances toute la semaine », puis « Annuler » | Si des rendez-vous sortent des disponibilités, l'app avertit (« 1 rendez-vous sera hors disponibilités »). |
| P3 | Ajouter un rendez-vous personnel (« Dentiste »), puis le retirer | Le personnel voit « Occupé » à sa place. |
| P4 | Un rendez-vous test passé, client absent : décider des frais (« Appliquer les frais » ou « Ne pas facturer ») | La décision est enregistrée. La facture de frais paraît dans la file du matin. |
| P5 | Mon profil : demander une mise à jour, puis la soumettre | L'adjointe la voit à réviser. |
| P6 | Paie : le sommaire du mois, « Valider », puis ajouter sa facture | Le statut passe à « Validé ». |

## 6. Administrateur (Jonathan)

| # | Scénario | Ce qu'il faut vérifier |
|---|---|---|
| D1 | Paramètres → Modules : ajouter et retirer une testeuse ; le module reste réservé | Le module paraît ou disparaît pour elle après un rechargement. |
| D2 | Paramètres → IA : la clé, le plafond (5 $ pour l'essai), puis épuiser le plafond avec quelques rédactions | Le composeur dit « plafond atteint ». « Ce mois-ci » compte les demandes. |
| D3 | Rapports : « Revenus » du mois par facture, service et paiement ; « Annulations et absences » | Les totaux concordent avec les factures test. Les exports CSV s'ouvrent dans Excel. |
| D4 | QuickBooks : connexion, comptes associés ; **l'envoi reste en pause** | La liste « Envoi à QuickBooks » montre ce qui attend, et rien ne part. |
| D5 | Journal d'audit : retrouver la création de « Test Adjointe-1 » et la note de crédit | Qui, quand et quoi sont écrits en français. |
| D6 | Une tâche à la fois (par exemple « Courriels et rappels des rendez-vous ») : l'activer, « Exécuter maintenant », puis la remettre à l'arrêt ; « Envoyer un texto de test » dans Paramètres → Textos | Le résultat est vert et rien n'est envoyé à un client (module réservé). Le texto de test arrive. |

## 7. Nettoyer après les essais

À faire **à la fin de chaque séance d'essais**, par la personne qui a créé les données :
1. **Les rendez-vous test à venir :** les annuler (raison « Autre », détail « Essai »).
2. **Les plages et blocages ajoutés :** les supprimer (Mon agenda → Disponibilités, ou l'Agenda d'un professionnel).
3. **Les factures test :** les créditer avec la raison « Essai », sans rien supprimer. Tenir la liste des numéros pour le comptable.
4. **Les demandes et inscriptions test :** les fermer (raison « Autre »).
5. **Les dossiers « Test … » :**
   - « Archiver » si l'on veut les revoir ;
   - sinon « Anonymiser », ce qui retire les coordonnées pour de bon (Loi 25).
   - Ne jamais fusionner un dossier test avec un vrai dossier.
6. **Les brouillons de courriel test :** les supprimer (« Brouillons »).
7. **Les tâches activées pour un essai :** les remettre à l'arrêt (Paramètres → Tâches planifiées).
8. **Les testeurs :** les laisser en place jusqu'à la bascule.

## 8. Signaler un problème

- **Où :** le canal des essais, ou un courriel à Jonathan (sujet « Essai — … »).
- **Quoi écrire :**
  - le rôle, l'écran (son titre) et l'heure ;
  - ce que vous avez fait, étape par étape, ce que vous attendiez et ce qui s'est passé ;
  - le message affiché, recopié tel quel.
- **Jamais de donnée personnelle**, même fictive : désignez un dossier par son **numéro** (n° 1042), une facture par son numéro.
- **Une capture d'écran** aide : recadrez-la pour qu'aucun nom de vrai client n'y paraisse (Loi 25).
- **Bloquant ou non :** dites si vous pouvez continuer. Un problème bloquant passe en tête de liste pour le go/no-go.

## 9. Le lien avec la bascule

Les essais de novembre préparent la liste de go/no-go du [runbook de bascule](gorendezvous-cutover.md#7-le-gono-go-fin-de-la-première-journée-ou-j1). La bascule ne se planifie que lorsque :
- chaque scénario de chaque rôle a été fait au moins une fois sans problème bloquant ;
- les problèmes signalés sont corrigés ou acceptés par Jonathan ;
- le nettoyage de la section 7 est fait.
