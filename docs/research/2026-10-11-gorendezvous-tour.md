> Utilisée par le [plan de match des prochains modules](../plans/2026-10-11-next-modules-roadmap.md) et le [plan de code](../plans/2026-10-11-modules-coding-plan.md).

# GOrendezvous — comment la clinique l'utilise (visite en lecture seule, 2026-10-11)

Source : aide en ligne (help.gorendezvous.com, ~60 articles) + l'app en direct, structure seulement. Aucune donnée personnelle.

## 0. Navigation et volumes
- App à page unique `/Schedule/` : agenda au centre, panneaux latéraux. Menu : Profil, Clients, Dossiers, Liste d'attente, Recherche (prochaine plage libre selon les règles de service), Professionnels (sans intérêt), Requêtes, Facturation, Inventaire (désactivé), Tableau de bord, Paramètres.
- Forfait « Entreprise » annuel, renouvelé le 31 janvier 2027 ; 1 000 rendez-vous inclus/mois ; lots prépayés achetés, quota parfois épuisé.
- Volumes : ~7 400 clients actifs ; ~28 000 factures au total, ~8 000 depuis janvier 2026, ~700–800/mois ; ~650–1 000 rendez-vous créés/mois ; 64 profils employés (~60 pros : ~29 TS, ~18 psychoéducateurs, 6 psychologues, 5 sexologues, 3 psychothérapeutes en double titre, 1 c.o., 1 coach, 1 pro sous supervision) + compte partagé « conseillère » + « Administration » + faux employé « Z MATRICE » (gabarit de services copié sur chaque nouveau pro).

## 1. Agenda
- Vues Jour, Semaine, Prochains jours, Mois ; afficher tous les pros, ceux d'un service, un pro, une salle, un équipement, un lieu. Préférences : plage horaire, intervalle 5–60 min, cacher les noms, n° de reçu, infos de paiement, rendez-vous supprimés. Impressions : horaire, revenus, clients à relancer, présence aux cours, Lumino Santé.
- Création : clic sur une plage ; clic sur un rendez-vous = éditeur.
- Champs : client (+ « Deuxième personne » si service pour deux), date/heure, durée (79 choix), service (propre au pro), pro, lieu, salle, étiquette, n° de reçu, équipements, « rendez-vous pour le travail ». « Raison / Notes » est VISIBLE DU CLIENT.
- Onglets : Participants (Sera présent / Présent(e) / Absent(e)) ; Facturation (paiement, Facture, solde) ; Notes (notes du rendez-vous, du client, raison et détails d'annulation, pro principal, « Référé par », champ personnalisé) ; Actions (renvoyer la notification, demande de consentement, remerciement, sondage, avis au pro) ; Audits ; Messages SMS. Boutons : Démarrer (Zoom), Facture, Reçu, Répéter, Annuler le rendez-vous.
- Raisons d'annulation : Non spécifiée, Plus requis, Urgence personnelle, Urgence familiale, Urgence au travail, COVID-19, Insatisfaction, Autre. Options : rembourser, garder à l'horaire.
- États : en attente d'acceptation (hachuré), rappel envoyé (cloche), confirmé par le client (crochet), présent/absent, annulé / gardé à l'horaire / supprimé.
- Récurrence : chaque semaine ou aux 2–12 semaines, durant N, jours cochés, « ignorer les conflits », « inclure les participants » ; une série ne se répète pas deux fois.
- Rendez-vous personnel (privé, occupé pour les collègues) ; rendez-vous pour le travail.
- Disponibilités (mode d'édition à part, « J'ai terminé ») : plage visible ou non des clients, débordement permis ou non, non disponible (Jour férié, Vacances, Autre), libellé, lieux, salles, services permis ; horaire récurrent par défaut copiable ; création rapide 7 jours × 2 plages ; « Je suis en vacances toute la semaine ».
- Lieux : Bureau administratif, Vidéoconférence (virtuel), Téléphone, À domicile, un CPE partenaire, deux lieux nommés (dont le bureau d'un pro). Aucune salle. Équipement : Zoom.
- Visio : un compte Zoom PAR PRO branché par OAuth ; « Démarrer » envoie le lien au client ; le lien est aussi dans la confirmation.
- Séances de 50 min réservées en plages de 1 h.
- À reproduire : vues Jour/Semaine/Mois/tous les pros ; disponibilités récurrentes + exceptions + services par plage ; présence/absence ; annulation avec raison et « garder à l'horaire » ; récurrence 1–4 semaines avec contrôle des conflits ; audit ; état du rappel. À simplifier : salles, équipements, cours de groupe, inventaire ; lieux = visio + téléphone (à confirmer).

## 2. Clients
- Fiche : Informations (id, prénom, nom, sexe F/M/Autre, naissance, lien de réservation, courriel + « Inviter », mobile/maison/travail + poste, rappels courriel/SMS oui/non, langue fr/en, fuseau, format d'heure, prénom à la naissance, pronoms 8 choix) ; Visites & Paiements (passés/à venir, actifs/annulés, paiements et remboursements QBO/Stripe/Square, solde) ; Reçus d'assurance (Brouillon/Disponible/Annulé, partage portail) ; À compléter (formulaires) ; Cartes de visite ; Assurance principale et secondaire (assureur, police, certificat, relation, titulaire, consentements TELUS eRéclamations) ; Notes administratives (notes, pro principal, champ personnalisé, « Référé par », RAMQ + expiration) ; Adresse ; Relations (type, parent/proche aidant, contact principal, 3 droits : gérer rendez-vous et formulaires, recevoir communications, recevoir reçus/factures) ; Consentements (nom, version, date/heure, signature électronique) ; Audits.
- Liste : recherche, par pro ou « Liste globale », filtre par étiquettes (et/ou), archivés inclus ou non.
- Étiquettes (max 5/client) : Ancien tarif, nouveau tarif, Annulation ou absence 1re rencontre, Atelier, ATTENTION, Client banni, Couple, Famille, Dossier incomplet, Entente de paiement, Entreprise MANA, Facturation personnalisée, Fin de suivi, IVAC, Liste d'attente, Mauvais client, Naturopathie, Note de crédit, Nouveau client, Offert, PAE externe, Paiement automatique, Payeur, Payeur externe, Statut Indien, Tarif réduit, Tarif étudiant, Satisfaite, Très satisfait(e), Visio (doublons).
- Pas de fusion de doublons (on archive). Suppression : propriétaire seulement, prénom + mot de passe.
- Visibilité d'un pro : clients qu'il a créés, vus ou à voir en rendez-vous, ou dont il est le pro principal.
- À reproduire : proches + 3 droits ; assurance principale/secondaire ; consentements versionnés ; étiquettes → champs (tarif étudiant/réduit, payeur externe, IVAC, PAE, banni) ; « Référé par » ; pronoms ; langue ; règle de visibilité des pros. À ajouter : fusion des doublons.

## 3. Services et prix
- Catalogue numéroté : 10xxx individuel (30/50 min, tarif étudiant, tarif réduit), 20xxx couple et famille (30/60 min), 30xxx IVAC, 40xxx PAE externe, 50xxx administratif (rapport, test psychométrique, discussion avec un intervenant, transfert de dossier, appel découverte 15 min, supervision), 60xxx ateliers, 70xxx annulation tardive/absence, 80xxx frais de déplacement ; ~15 anciens services sans code (location de bureau, vente d'article, recherche-action) ; variantes « PRÉSENTIEL » ; naturopathie.
- Services ET prix rattachés à chaque employé (copiés de « Z MATRICE ») ; ~900 couples pro-service.
- 0 $ au catalogue : PAE, IVAC (sauf ouverture de dossier IVAC 43,49 $ taxable), annulation tardive (prix tapé à la main).
- Champs d'un service : nom, description, catégorie, profession, type (recherche), spécialité Lumino Santé, pour deux personnes, en personne ou visio, durée, prix, prix visible en ligne, taxable (dates début/fin), places, couleur, ordre, pause après, heures fixes, lieux, salles, équipements, qui peut le choisir (6 options), délai minimum de réservation, adresse du client requise, libellé « Raison » personnalisé, RAMQ demandée, règles par étiquette (non disponible, accepter à la main, modifier le prix).
- Couple : un onglet par client, facture divisible, un reçu par personne avec % payé ; compte pour deux dans le quota.
- À reproduire : familles et codes (utiles pour QBO), couple facturé à deux, variantes étudiant/réduit. À simplifier : un catalogue unique (prix dans les grilles de rétention). À retirer si confirmé : PRÉSENTIEL, location de bureau, vente d'article.

## 4. Professionnels et personnel
- Fiche pro : genre, titre, profession, biographie, description courte ; Services ; Conditions de santé (~60, ≈ nos motifs) ; Clientèles (hommes, femmes, bébés, enfants, adolescents, aînés, femmes enceintes, couples, familles, LGBTQ+, TSA, sourds, diabète, mobilité réduite, déficience intellectuelle) ; Vidéoconférence (Zoom) ; Reçus (modèle : nom, titre, infos) ; Signature (image) ; Titres professionnels (ordre, n° de licence) ; Options ; Liste d'attente ; Permissions ; Profil Assurance.
- Options : réservation en ligne, nouveaux clients doivent appeler, acceptation automatique, client doit appeler pour annuler (toujours / < 24, 48, 72 h), limite dans le futur, limite par client, maximum par jour, remplissage vers le bas, espacement, cacher le pro, service dans les communications, RAMQ à la réservation, 2FA.
- Permissions : administrateur, gestionnaire, gérer l'horaire de tous, voir l'horaire de tous, gérer son horaire, voir tous les clients, voir les coordonnées des clients, supprimer des fiches de dossier. Un pro : gère son horaire + voit les coordonnées de ses clients. Compte partagé « conseillère » : tous les droits (admin compris). Profil « Soutien administratif » inutilisé.
- À reproduire : clientèles ; titre/ordre/n° de licence sur les reçus ; « appeler pour annuler à moins de 24 h ».

## 5. Facturation
- Menu : Revenus (par facture / service-produit / paiement ; filtres lieu, période, pro, client, service, mode ; Exporter Excel, Imprimer) ; Factures (date, client, pro, n°, total, solde) ; Transactions (paiements, remboursements) ; Visites ; Assurance (TELUS eRéclamations : Traitée, Rejetée, Annulée, Erreur de connexion, Erreur ; prédéterminations ; ~65 assureurs) ; Paramètres (numéro `[yyyy]-[7]`, note par défaut fr/en, date de départ des soldes).
- Parcours : facture envoyée après la séance, payable le jour même → paiement par virement Interac (dépôt automatique) ou carte via lien « PAYER » (Stripe) → reçu d'assurance dans les 24 h ouvrables après paiement. Facture et reçu = deux documents.
- Une facture peut porter plusieurs rendez-vous/services ; une facture payée ou à plusieurs lignes ne s'annule pas.
- Modes de paiement (chacun relié à un compte QBO) : Accès D, Argent comptant, Assurance, Carte cadeau, Carte de crédit, Carte de fidélité, Carte de visites, Chèque, Interac, note de crédit, PayPal, « seulement TPS », Square, Stripe, Virement bancaire.
- Stripe connecté ; dépôt possible par service (10–100 %) avec remboursement auto selon délai (15 min–72 h). QBO actif et synchronisé (factures, paiements) ; Zapier activé.
- Taxes : TPS/TVQ avec numéros, date d'effet, par lieu. Étiquette « Statut Indien » (exemption ?).
- Absence / annulation tardive : pas de frais automatiques ; on ajoute un rendez-vous du service « Annulation tardive / absence » et on tape le prix.
- Reçus : modèle par pro, options (adresse client, nom/catégorie du service, montant payé seulement, raison, signature, payeur) ; numéro unique entreprise ; relevé sur période (année fiscale) par courriel/PDF ou portail.
- Cartes de visite : une (« Rencontre de suivi 20 minutes », 10 visites).
- À reproduire : facture puis reçu ; Interac + lien carte ; plusieurs lignes ; facture divisée pour un couple ; relevé annuel ; numérotation AAAA-N ; mode de paiement ↔ compte QBO ; frais d'annulation (à automatiser).

## 6. Communications
- Rappels : 2 jours avant, jamais la fin de semaine (avancés au jeudi/vendredi) ; courriel d'abord (minuit–~10 h), puis SMS si pas confirmé / pas de courriel / refus ; liens de confirmation et d'annulation (domaine gordv.ca).
- Personnalisation : message entreprise / par pro / par service, fr/en ; signature ; adresse en copie ; communications activables par service.
- Courriels automatiques : confirmation, demande de rendez-vous, rappel, annulation (pro ou client), remerciement et sondage (désactivés), formulaire santé, invitation liste d'attente, facture avec « PAYER », reçu.
- 7 modèles de consentement (liste d'attente, transfert de dossier, stagiaire en psychothérapie, coaching, naturopathie, PAE, …).
- À reproduire : rappel J-2 sans fin de semaine ; confirmation/annulation par lien ; consentements versionnés.

## 7. Réservation en ligne et requêtes
- Réservation en ligne désactivée ; services « Non disponible en ligne » ; nouveaux clients doivent appeler.
- Requêtes > Rendez-vous : rendez-vous proposés au client (« Envoyées »), acceptés par courriel (hachurés d'ici là) ; ~52 acceptées, ~28 envoyées : sert à placer des rendez-vous.
- Requêtes > Service (nouveau, automne 2026, non activé, forfait supérieur) : accueil et jumelage. États : Nouveau, En évaluation, Accepté, Jumelé, Liste d'attente, Orienté ailleurs, Urgent. Formulaire : pour qui, thérapie antérieure, langue, mode, disponibilités, genre du pro souhaité, motif, préoccupations, payeur (assurance, PAE, aucun), assureur, note interne, référence, consentement, dépistage PHQ-2 / GAD-2.

## 8. Liste d'attente
- Fonction GOrendezvous : par pro, priorité, disponibilités (jour, de, à), validité, pro, service, deuxième personne, lieu, notes ; invitation sur une plage libérée (auto en option) ; Exporter.
- En parallèle : faux rendez-vous dans l'agenda « conseillère » (« Inscription – Liste attente psychologie et psychothérapie » 21,74 $, « LISTE ATTENTE À RAPPELER », « Consultation gratuite 15 min ») : appels découverte et liste d'attente gérés comme des rendez-vous.

## 9. Rapports
- Revenus (3 angles, Excel) ; clients à relancer et annulations par raison (Excel) ; tableau de bord = acquisition par les canaux GOrendezvous. Pas de KPI d'accueil, pas de rapport de paie.

## 10. Dossiers cliniques
- Essai terminé, module non utilisé : aucune note clinique dans GOrendezvous (va dans le sens de D8).

## 11. Exports
| Donnée | Dans l'app | Format | Remarque |
|---|---|---|---|
| Clients | « Exporter mes clients » (par pro ou liste globale ; propriétaire seulement) | Excel, différé | ClientId, FirstName, LastName, Email, Sex, Language, Cell/Home/WorkPhone (+ indicatifs), WorkPhoneExtension, StreetNumber…, anniversaire, dernier rendez-vous ; relations/assurance/étiquettes/archivés à vérifier |
| Factures, lignes, paiements | Revenus → Exporter (3 angles) | Excel | non annulées seulement ; QBO contient tout |
| Liste d'attente | Exporter par pro | Excel | |
| Annulations, clients à relancer | Impression → Exporter | Excel | |
| Rendez-vous (historique) | AUCUN export | — | impression, iCal/Google, Zapier (à venir) ; à demander au support |
| Reçus d'assurance, consentements | pas d'export en lot | PDF un par un | |

## 12. Surprises
1. Pas d'export des rendez-vous → demande au support.
2. « Requêtes de service » de GOrendezvous ≈ notre futur Demandes.
3. Services « PRÉSENTIEL » et lieux physiques encore présents.
4. Compte « conseillère » partagé, tous droits admin ; appel découverte et liste d'attente gérés comme des rendez-vous.
5. Prix et services par pro, copiés de « Z MATRICE ».
6. Visio = un Zoom par pro (pas Meet, pas lien fixe).
7. Facture d'abord, reçu après paiement ; Interac principal.
8. QBO déjà synchronisé, modes de paiement reliés aux comptes.
9. « Raison » d'un rendez-vous visible du client.
10. Pas de fusion de doublons ; 64 profils pour ~60 pros actifs.

## 13. Questions pour Jonathan
1. Conseillères toutes dans le compte partagé ? Combien ?
2. PRÉSENTIEL, À domicile, CPE, bureau d'un pro : encore utilisés ?
3. Liste d'attente : celle de GOrendezvous ou les faux rendez-vous ? Frais d'inscription 21,74 $ ?
4. Rendez-vous proposés au client = façon de placer le premier rendez-vous ?
5. Plages de 1 h pour 50 min voulues (10 min de battement) ?
6. Source des prix pendant la transition ?
7. Garder facture → paiement → reçu sous 24 h ? Qui envoie ?
8. Cartes enregistrées / dépôts Stripe utilisés ? Automatiser les frais < 24 h ?
9. Les pros tiennent-ils à leur Zoom personnel ?
10. TELUS eRéclamations et Lumino Santé utilisés ?
11. Où sont les notes cliniques des pros ?
12. Qui demande l'export complet au support ?
13. Basculer avant le renouvellement du 31 janvier 2027 ?
14. « Statut Indien » = exemption de taxes ?

## 15. Formulaires et consentements
- GOrendezvous : formulaires santé (dans la tenue de dossiers : raison, note libre, cases, échelle 0–10, sections, signes vitaux, tableau, fichier ; une fois avant le 1er rendez-vous ou à chaque rendez-vous ; par service et par pro ; fr/en) ; consentements (texte riche avec champs dynamiques client/pro/titre/entreprise/adresse/service/lieu/signataire ; sections « Accord requis » ou « Oui/Non » ; versionnés ; par employé et service, un actif par service ; une fois ou à chaque rendez-vous ; jamais supprimés, rendus inactifs ; signature électronique à l'acceptation). « À compléter » = formulaires en attente avec date limite.
- MANA : AUCUN formulaire santé. 7 consentements (liste d'attente psycho/psychothérapie, transfert de dossier clinique, stagiaire en psychothérapie, général, coach, naturopathie, PAE externe). Le général : ~340 acceptations, 15e version, demandé une fois ; sections Consentement (14 ans et plus, sinon parent), Cadre, Démarche, Honoraires (facture payable le jour même, carte ou virement ; tribunal au taux horaire + déplacement), Politique d'annulation et de retard (préavis 24 h ouvrables ; sinon 50 % à la 1re absence puis 100 % ; retard non prolongé, facturé en entier), Confidentialité, Dossier client, Mise à terme, Dispositions générales. Pas de formulaire d'accueil.
- À reproduire : consentements versionnés signés (socle de signature), par service ou type de payeur ; règle 14 ans ; politique d'annulation à deux paliers en réglage daté. Pas de formulaires santé (D8).

## 16. Payeurs externes (PAE, IVAC)
- GOrendezvous ne facture pas d'organisation : payeur = un client ou un proche (« Payé par » sur facture/reçu). Pas de facturation en lot ni de relevé par organisation. TELUS eRéclamations = assureurs privés seulement.
- MANA : PAE et IVAC à 0 $ (sauf ouverture IVAC 43,49 $) → facture client à 0 $ ; facturation PAE/IVAC hors GOrendezvous (QBO ou rapport ?) ; étiquettes comme repères manuels ; mode « Assurance » et « seulement TPS ». À valider avec Rachel.
- À reproduire (gain réel) : vrai payeur tiers (organisation PAE, IVAC, employeur) avec n° de dossier, part couverte, factures/relevés au payeur en lot, consommation du forfait PAE.

## 17. Portail client
- Identification nom + courriel + code à 6 chiffres (pas de mot de passe). Réserver ou liste d'attente (pour soi ou une personne à charge) ; confirmer/modifier/annuler par les liens des courriels (sauf si le pro exige un appel : < 24 h chez MANA) ; raison d'annulation ; formulaires et consentements « À compléter » ; reçus d'assurance partagés ; factures par courriel/SMS avec « PAYER ». Proches : gérer rendez-vous et formulaires, recevoir communications, reçus et factures.
- MANA : réservation en ligne désactivée ; portail utilisé via les liens des courriels, reçus partagés, consentements.
- À reproduire : liens confirmer/modifier/annuler dans les courriels avec la règle 24 h ; consentements par lien ; reçus par courriel. Portail complet plus tard.
- Nouvelles questions : comment PAE et IVAC sont facturés aujourd'hui (QBO ? relevé mensuel ? n° de dossier ?) ; la politique 50 % puis 100 % est-elle appliquée ? ; le forfait « Entreprise » est discontinué : le renouvellement du 31 janvier 2027 forcerait Essentiel ou Premium.

## 18. Faits chiffrés (2e passe en lecture seule, compte Administration, période 2026-01-01 → 2026-10-11)

Comptes et réglages seulement ; aucun nom de client ni de professionnel.

### Visites et lieux
- 8 635 visites : Vidéoconférence 7 681 ; « Bureau administratif » 911 (vraisemblablement les entrées administratives et du compte conseillère : à expliquer à l'import) ; bureau d'un pro 35 ; PRÉSENTIEL ≈ 47 lignes facturées ; CPE 3 ; Téléphone 5 ; À domicile 0. → Vidéo et téléphone suffisent.
- Le filtre « service » de la vue Visites compte 916 entrées (une par couple pro-service).

### Catalogue (gabarit « Z MATRICE », 28 services) et lignes facturées (8 661 lignes, 895 771 $ TTC)
| Code | Service | Lignes 2026 | Prix observés | Taxable |
|---|---|---|---|---|
| 10100 | Ouverture de dossier – Individuel | 589 | 43,49 (= 37,83 + taxes) ; 21,74 | oui |
| 10130 | Consultation individuelle 30 min | 146 | 85 / 100 / 110 / 120 / 130 selon la profession | non |
| 10131 | … 30 min tarif étudiant | 2 | 80, 96 | non |
| 10150 | Consultation individuelle 50 min | 5 062 | 120 / 140 / 150 / 160 / 175 selon la profession | non |
| 10151 | … 50 min tarif étudiant | 68 | 100, 120 | non |
| 10152 | … 50 min tarif réduit | 3 | 130 | non |
| 10154 / 10155 | PRÉSENTIEL (ouverture, 50 min) | 2 / 43 | — | — |
| 10157 | Consultation naturopathie | 9 | 113,07 ; 121,76 (taxée) | oui |
| 20100 / 20102 | Ouverture de dossier couple-famille | 78 | 43,49 | oui |
| 20150 | Consultation individuelle – couple-famille 60 | 93 | 150 / 165 / 175 / 185 | non |
| 20160 | Consultation couple-famille 60 (pour deux) | 403 | 150 / 165 / 175 / 185 | non |
| 20170 | Consultation couple-famille 30 | 3 | 110, 150 | oui (gabarit) |
| 30100 | Ouverture de dossier IVAC | 23 | 43,49 | oui |
| 30150 / 30152 | IVAC 50 min (part client) / tarif réduit | 235 / 20 | 0 à 80,50 / 0 | non |
| 40130 / 40150 / 40160 | PAE externe 30 / 50 / couple 60 | 4 / 288 / 16 | 0 (130 fois sur 288), sinon 48–173 | non |
| 50100 | Inscription à la liste d'attente | 51 (compte conseillère) | 21,74 (= 18,91 + taxes) | oui |
| 50400 | Rédaction de rapport | 8 | 0 au catalogue, 56–208 tapé | non |
| 50401 | Test psychométrique | 3 | 40 | non |
| 50500 | Discussion avec un autre intervenant | 15 | 0 au catalogue, 33–84 tapé (≈ par tranche) | non |
| 50600 / 50601 | Transfert de dossier / Appel découverte 15 min | 40 / 5 | 0 | non |
| 50602 | Supervision | 24 | 0 ou 100 | oui |
| 60100 / 60200 | Atelier – animation / participation | 5 / 0 | 0 ; 1 500–1 899 tapé | non |
| 70300 / 70360 | Annulation tardive / absence – individuel / couple | 549 / 56 | 0 (446 / 52 fois) ; sinon 17,75–140 tapé | non |
| 80100 | Frais de déplacement | 1 | 57,80 | oui |
- Anciens services sans code encore facturés : « 50 minutes – Rencontre d'intervention web » 447 lignes, « Annulation tardive ou absence non motivée » 92 lignes (640 $), « Ouverture de dossier » 66, « PAE externe – 50 minutes » 38, « Service de consultation » 28, « Inscription – Liste attente services de psychologie et de psychothérapie » 51 × 21,74 $, etc.
- **Prix par profession, identiques entre les pros d'une même profession** (30 min / 50 min / couple 60) : travail social 85 / 120 / 150 ; psychoéducation 100 / 140 / 165 ; sexologie 110 / 150 / 175 ; psychothérapie 120 / 160 / 185 ; psychologie 130 / 175 (étudiant 96 / 120 ; pas de service couple, IVAC ni PAE). Un pro offre 13 à 18 des 28 services du gabarit.
- Taxes pratiquées : taxées = ouverture de dossier, inscription à la liste d'attente, couple 30 min, supervision, frais de déplacement, naturopathie ; toutes les consultations (sexologie et orientation comprises) non taxées. Aucune date de taxe, aucun lieu (sauf 10100), pas de pause, pas de règle par étiquette ; tous « non disponible en ligne ».
- Compte conseillère : 7 services (ouverture IVAC, annulation tardive 0 $, consultation gratuite 15 min, inscription liste d'attente 21,74 $, « LISTE ATTENTE À RAPPELER » 0 $, ouverture de dossier moins de 14 ans 0 $, préparation de la téléconsultation 0 $) ; 119 lignes en 2026 = 51 inscriptions + 56 annulations 0 $ + 12 ouvertures IVAC.

### Paiements (7 154 paiements, 904 812 $)
- Argent comptant 4 955 / 631 687 $ ; Interac 1 800 / 221 011 $ ; Stripe 268 / 33 678 $ ; note de crédit 119 / 11 448 $ ; chèque 2 ; virement bancaire 4 ; Accès D 4 ; carte de crédit 2. 24 remboursements. « Argent comptant » est très probablement le dépôt automatique Interac saisi comme comptant.
- Factures 2026 : affichage « 1 à 10 de 8 000 » (plafond probable). Format du numéro de facture « [yyyy]-[7] » ; note par défaut (fr) = texte Interac (adresse de la clinique, dépôt auto) + lien PAYER + « reçu sous 24 h ouvrables » ; note anglaise vide.
- Modes de paiement → compte QuickBooks : Argent comptant → Cash → Compte courant ; Carte de crédit → QuickBooks Payments → Fonds non déposés ; Chèque → Compte courant ; Interac → Interac → Virement bancaire à recevoir ; note de crédit → Compte courant ; Stripe → Banque Stripe ; Virement bancaire → Dépôt direct → Compte courant ; Accès D et « seulement TPS » non mappés ; désactivés : Assurance, Carte cadeau, Carte de fidélité, PayPal, Square.
- Stripe : connecté au niveau entreprise ; aucun dépôt à la réservation, aucune carte enregistrée ; remboursement automatique sauf à moins de 24 h. TELUS eRéclamations : 0 réclamation, 0 prédétermination. Lumino Santé : inactif. QuickBooks : activé (synchronisation). Zapier : clé active, zaps inconnus.

### Agenda, rappels, annulation
- Rappels : **1 jour avant**, « ne pas envoyer durant la fin de semaine » = oui (le rappel du lundi part le vendredi) ; aucun réglage d'heure ; aucune personnalisation par service, message d'entreprise vide.
- **SMS actifs** : rappels par texto envoyés chaque jour (« Pour confirmer ou annuler, cliquez … »), ~165 SMS en octobre 2026, inclus au forfait.
- Annulation : « Les clients doivent appeler pour annuler » = **oui, en tout temps** pour presque tous les pros (1 TS sur 3 = non) ; « accepter automatiquement les demandes » = oui partout ; aucun frais automatique (voir 70300 / 70360).
- Zoom : activé par employé, la plupart cochés (une dizaine non). Réglage de durée ou d'expiration d'une proposition : introuvable. Requêtes de service : désactivées. Réservation en ligne : non. Liste d'attente (fonction) : **vide** pour tous les comptes vérifiés ; « permettre aux clients de s'ajouter » = oui, invitation automatique = non.

### Clients
- 7 390 actifs, 8 468 avec les archivés (≈ 1 078 archivés) ; 2 635 actifs sans professionnel principal ; 31 étiquettes (« IVAC » et « Nouveau client » en double). Filtre par étiquette masqué dans la liste ; pas de colonne « sans courriel ».

### Reçus et permissions
- Numéro de reçu unique pour l'entreprise (option « séquentiel par professionnel » = non). Modèle de reçu par pro : nom, titre (TS, Psychologue), « Membre de l'OTSTCFQ / OPQ : n° », adresse de la clinique, adresse du client oui, signature oui, « montant payé seulement » non, « payé par » non ; numéros de taxes imprimés automatiquement. Relevé : pas dans les paramètres (fiche client ou portail).
- Compte conseillère partagé : administrateur, gestionnaire, horaires de tous, tous les clients et leurs coordonnées ; **pas** la suppression. Compte Administration : tout. Pros : gérer son horaire + voir les coordonnées de ses clients, rien d'autre.
- Requêtes > Rendez-vous (en cours) : acceptées 52, envoyées 28, refus 2.

### Site web
- « Prendre rendez-vous » → « Réserver un appel découverte » ouvre **Calendly** (pas GOrendezvous) ; « Nous écrire » = formulaire Elementor (nom, courriel, téléphone, message, « Comment avez-vous entendu parler de MANA ? », consentement, reCAPTCHA) → « une conseillère communiquera avec vous dans un délai de 24 à 48 heures ouvrables ».
