# Runbook — Le passage de GOrendezvous à l'app (bascule)

**Pour :** Jonathan (avec Christine pour les vérifications de la clinique). **Statut :** prêt à suivre ; rien n'est encore fait sur la base de la clinique. **Liens :** [import GOrendezvous](import-gorendezvous.md) (clients I1, factures I3), [import des professionnels](import-professionals.md), [statut et « Mise en service »](../plans/2026-10-07-status.md).

> **Chaque étape sur la base de la clinique est ta décision, au moment où tu la fais** (CLAUDE.md §11). Les imports se lancent dans ton terminal, avec ton compte : d'abord un essai, puis, après avoir lu le rapport, `--commit`. Un agent ne lance jamais un import ni ne touche la base de la clinique sans ton feu vert dans le clavardage. Aucun mot de passe, aucune clé, aucun export dans le clavardage ni dans git.

Dans ce document, **J** est le jour de la bascule : le premier jour où la clinique travaille dans l'app.

## 1. Avant J (la semaine d'avant)

1. **Les modules sont prêts, encore réservés aux testeurs.** Paramètres → Modules : Clients, Demandes, Rendez-vous, Facturation, Communications et Rapports sont activés et « Réservé aux testeurs » (rien ne part vers un client tant qu'un module est réservé : P3-40).
2. **Les intégrations sont branchées et testées :**
   - Resend (courriels) ;
   - Yeastar (textos) ;
   - Zoom ;
   - Stripe ;
   - QuickBooks (connecté, comptes et taxes associés ; l'envoi reste **en pause**) ;
   - Documenso ;
   - Gmail.
   Chaque test se fait avec une adresse ou un numéro que tu contrôles.
3. **Les réglages de la clinique :**
   - heures d'ouverture et heure des rappels (Paramètres → Rendez-vous) ;
   - taux de taxes (Paramètres → Fiscalité) ;
   - modèles de courriels et de textos relus par Christine.
4. **Une répétition complète** sur la base locale avec les vrais exports, pour voir les rapports. Les exports restent dans `~/Clinique-MANA-import/` et ne vont jamais dans le dépôt.
5. **Les professionnels sont dans l'app** (import des professionnels déjà fait), chacun avec son titre principal et sa grille. La liste des agendas GOrendezvous est faite (`employes.csv`), tout comme celle des anciens services sans code (`services.csv`).
6. **Annonce à l'équipe :** le moment du gel (le soir de J-1), et qui fait quoi le matin de J.

## 2. Le gel (le soir de J-1)

1. **Plus rien ne s'écrit dans GOrendezvous** : ni rendez-vous, ni paiement, ni facture. L'équipe note sur papier ce qui arrive pendant le gel, puis le saisit dans l'app après l'ouverture.
2. **Les rappels de GOrendezvous sont coupés**, sinon les clients en recevraient deux : un de GOrendezvous, un de l'app.
3. **Les exports finaux**, tous du même moment, enregistrés en « CSV UTF-8 » dans `~/Clinique-MANA-import/` :
   - « Exporter mes clients » (liste globale) ;
   - les liens entre clients (`liens.csv`) ;
   - les rendez-vous (pour I2, quand l'import des rendez-vous existe) ;
   - Facturation → Revenus : « par facture », « par service-produit », « par paiement », sur toute la période à reprendre.
4. **Note le dernier numéro de facture de GOrendezvous** pour chaque année. L'import des factures fait suivre la numérotation (« 2026-0001234 » devient « 2026-1234 », et la prochaine facture de l'app est la suivante) ; tu le vérifies à l'étape 3.

## 3. Les imports, dans l'ordre (la nuit ou le matin de J)

Pour chacun : d'abord l'essai, lire le rapport, puis la même commande avec `--commit`. Les commandes exactes sont dans le [runbook de l'import](import-gorendezvous.md).

1. **Les clients et leurs liens** (`clients`, I1). Après l'import :
   - les doublons signalés se fusionnent dans l'app (« Fusionner ») ;
   - les payeurs IVAC, PAE ou externes restent à compléter à la main.
2. **Les rendez-vous** (I2, l'outil de la voie C quand il est prêt). Un rendez-vous importé n'envoie jamais de confirmation (AP-26). Les rappels des rendez-vous à venir partiront de l'app une fois la tâche activée (étape 5).
3. **Les factures, leurs lignes et leurs paiements** (`factures`, I3). Le rapport compare, mois par mois, l'export et ce qui entre. Il liste aussi les factures sans dossier (homonymes, noms changés) : relance avec `--clients-map` pour les ajouter. Une facture importée est de l'historique :
   - rien n'est envoyé (ni courriel, ni reçu, ni QuickBooks : elle y est déjà) ;
   - elle n'est jamais relancée et ne bloque jamais une réservation ;
   - son solde se suit à la main dans « Factures en retard ».
4. **Vérifications de Christine**, sur 5 clients pris au hasard : le dossier, les proches, les rendez-vous à venir, les factures et leur solde sont les bons. Le total par mois du rapport correspond à celui de GOrendezvous.
5. **La numérotation :** Paramètres → Facturation → « Numérotation » montre la dernière facture de l'année ; elle doit suivre le dernier numéro de GOrendezvous noté au gel (`set_invoice_sequence` au besoin).

## 4. Les dates « à partir du » (le matin de J)

Paramètres → Facturation :
- **« File du matin à partir du » = J.** Seuls les rendez-vous à partir de J deviennent des factures à préparer ; ceux d'avant ont été facturés dans GOrendezvous (`billing_settings.queue_from`).
- **« Relances à partir du » = J.** Seules les factures émises dans l'app à partir de J sont relancées et peuvent bloquer une réservation (`billing_settings.dunning_from`). Les factures importées ne le sont jamais, quelle que soit la date.

## 5. Les tâches, dans l'ordre (Paramètres → Tâches planifiées)

Les tâches de la clinique sont désactivées au départ. Active-les une à une ; avant de passer à la suivante, regarde la « Dernière exécution » et la cloche.

| Ordre | Tâche | Ce qu'elle fait | Vérifier avant de continuer |
|---|---|---|---|
| 1 | « Courriels et rappels des rendez-vous » (`appointments.messages`) | Confirmations, changements, annulations et rappels | Un rappel test reçu sur ton adresse ; aucun envoi pour un rendez-vous importé passé |
| 2 | « Envoi des textos » (`communications.sms_dispatch`) | Les textos (rappels, « OUI ») | Un texto reçu sur ton numéro |
| 3 | « Factures, reçus et relevés » (`billing.documents`) | Les PDF et les courriels de Facturation | Une facture test reçue ; le PDF est dans le dossier |
| 4 | « Relances et frais d'annulation » (`billing.follow_up`) | Les relances et les frais à décider | Aucune relance pour une facture importée ; la file des frais est vide ou attendue |
| 5 | « Prélèvements des cartes au dossier » (`billing.stripe_charges`) | Les cartes enregistrées avec consentement | Un prélèvement test en mode Stripe réel, sur ta carte, puis remboursé |
| 6 | « Liens Zoom des rendez-vous » (`appointments.video_sync`) | Les liens Zoom des rendez-vous vidéo | Un rendez-vous vidéo test a son lien |
| 7 | « File du matin » (`billing.build_drafts`), « Rendez-vous terminés » (`appointments.mark_completed`) et les autres tâches de clinique | Les brouillons, les rendez-vous passés notés terminés, les rappels de consentement, le suivi de la liste d'attente | La file du matin ne montre que des rendez-vous à partir de J |
| 8 | « Envoi à QuickBooks » (`billing.qbo_push`), **après le go/no-go** (section 7) | Les factures, paiements et remboursements faits dans l'app | Paramètres → QuickBooks → « Démarrer l'envoi » ; la liste « Envoi à QuickBooks » se vide, sans refus |

L'envoi à QuickBooks a **deux interrupteurs** : la tâche, et « Démarrer l'envoi » (FQ-6). Tant que « Démarrer l'envoi » n'est pas fait, rien ne part, même si la tâche est active.

## 6. Ouvrir les modules à tous (le matin de J)

Paramètres → Modules : pour Clients, Demandes, Rendez-vous, Facturation, Communications et Rapports, désactive « Réservé aux testeurs ». Le module s'ouvre alors à toute l'équipe et peut écrire aux clients. Fais-le dans cet ordre : d'abord Clients et Demandes, puis Rendez-vous et Communications (les rappels partent alors), et enfin Facturation et Rapports.

## 7. Le go/no-go (fin de la première journée, ou J+1)

**Go** si tout est vrai :
- [ ] Les 5 dossiers vérifiés par Christine sont justes (étape 3.4).
- [ ] Les totaux par mois de l'import des factures correspondent à GOrendezvous ; les factures laissées de côté sont expliquées.
- [ ] Les rappels et les textos du jour sont partis, une seule fois, et aucun client ne s'est plaint d'un double rappel.
- [ ] Les réservations, déplacements et annulations du jour se sont faits dans l'app sans retour à GOrendezvous.
- [ ] La file du matin et les factures du jour sont justes (montants, payeurs, taxes).
- [ ] Les paiements reçus (Interac, carte) sont enregistrés et rapprochés.
- [ ] Aucune tâche en erreur dans « Tâches planifiées » ; aucune alerte rouge dans la cloche.
- [ ] Le comptable est d'accord pour que l'app écrive dans QuickBooks à partir de J.

Alors : **« Démarrer l'envoi »** (Paramètres → QuickBooks), puis la tâche 8. GOrendezvous reste ouvert en lecture seule pour consultation pendant un mois, puis tu résilies l'abonnement une fois les derniers exports archivés hors du dépôt.

**No-go** si un point bloque : on corrige, puis on refait le go/no-go le lendemain. Si la correction est longue, on passe au retour arrière.

## 8. Le retour arrière (si la clinique doit revenir à GOrendezvous)

Rien ne s'efface : les données importées et celles saisies dans l'app restent dans l'app (l'historique compte, et on ne réinitialise jamais la base de la clinique).
1. **Arrêter les envois de l'app :**
   - « Mettre en pause » l'envoi à QuickBooks ;
   - désactiver les tâches de la section 5, de la dernière à la première ;
   - remettre les modules en « Réservé aux testeurs » (plus aucun message ne part vers un client : P3-40).
2. **Rallumer GOrendezvous :** les rappels de GOrendezvous, et la saisie à nouveau.
3. **Reporter dans GOrendezvous ce qui s'est fait dans l'app depuis J** : les rendez-vous pris ou déplacés, les paiements reçus, les factures émises. Rapports → « Revenus » et l'Agenda de la période en donnent la liste. Si l'envoi à QuickBooks a déjà démarré, le comptable vérifie avec toi ce qui y est entré.
4. **Prévenir l'équipe**, puis, la cause trouvée, replanifier J. Au prochain essai, les imports reprennent là où ils étaient : ce qui est déjà importé revient « déjà importé ».
