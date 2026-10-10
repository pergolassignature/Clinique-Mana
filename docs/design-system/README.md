# Handoff : Clinique MANA — application de gestion

## Overview
Design system + écrans de référence pour la plateforme de gestion de Clinique MANA (clinique de répartition en santé mentale, 100 % en ligne, Québec). Le logiciel suit le parcours : Demande entrante → Appel découverte (conseillère) → Jumelage → Rendez-vous → Reçu/facture → (IVAC / PAE), alimenté par la banque d'environ 50 professionnels autonomes. Ce paquet couvre l'ossature (sidebar, barre du haut, recherche ⌘K), la connexion, l'accueil par rôle, le module Professionnels (liste + fiche), la boîte de réception Demandes (liste + panneau de détail) et Paramètres (menu groupé + Modules).

Cible : le repo `pergolassignature/Clinique-Mana` (React + Vite + Tailwind + shadcn/ui + Supabase, i18n fr-CA). Ce paquet remplace la direction visuelle actuelle (palette sauge/legacy) par celle décrite ici.

## About the Design Files
Les fichiers de ce dossier sont des **références de design écrites en HTML/JSX** : des prototypes qui montrent l'apparence et le comportement attendus, pas du code de production à copier tel quel. La tâche est de **recréer ces écrans dans l'environnement existant du codebase** (React, Tailwind, shadcn/ui, lucide-react, TanStack Router/Query, fr-CA.json) en respectant ses conventions (feature folders, `src/shared/ui`, i18n). Les composants du dossier `components/` montrent les valeurs exactes à porter dans les primitives shadcn existantes (`button.tsx`, `badge.tsx`, `card.tsx`…) — ne pas ajouter une deuxième bibliothèque.

## Fidelity
**Haute fidélité.** Couleurs, typographie, espacements, rayons, états et textes sont définitifs. Reproduire au pixel près avec Tailwind : mapper les tokens ci-dessous dans `tailwind.config.js` / `globals.css` (variables CSS `--*`) et retirer les anciens tokens (sage, honey, warm-gray, radius 14/16).

## Direction visuelle (règles non négociables)
Décidées avec le client (Jonathan, 7 oct. 2026) après rejet des rendus « génériques IA » :
- Page blanche, bordures fines `#E4E4E7`, **aucun panneau gris**, **aucun fond pastel**, **aucune ombre sur les surfaces** (ombres uniquement sur menus, dialogues, toasts).
- Statut = **point de 6 px + mot**, jamais une pilule colorée. Une seule exception : l'étiquette `Urgent` pleine (rouge, texte blanc, 11 px).
- **Un seul bouton d'action coloré par écran** (teal `#1E837C`), les autres en contour blanc ; destructif seulement dans une confirmation.
- Rayons : **4 px contrôles · 6 px cartes/menus · 8 px dialogues**. Avatars et switch ronds.
- États vides : deux lignes de texte, pas de boîte, pas d'icône.
- Infobulles : fond encre `#1F1F20`, rayon 3 px, 12 px, padding 3×7.
- Alertes : blanc, bordure fine, seule l'icône porte la couleur.
- Densité outil : corps 13/18, contrôles 32 px, rangées 40 px min, padding de carte 16.
- Vin (`#9B1B3C`) = logo uniquement.
- Conventions de layout empruntées à Jane, SimplePractice, Owl, Cliniko, GOrendezvous : sidebar claire à gauche, tableaux denses avec barre de filtres et pagination, boîte de réception en liste + panneau de détail à droite, fiches en bandeau d'en-tête + onglets horizontaux + deux colonnes.

## Design Tokens
Source : `design_system/tokens/*.css` (copier tel quel dans `globals.css`). Résumé :

**Couleurs**
- Page/surfaces : `--bg` #FFFFFF · `--bg-secondary` #F4F4F5 (fond désactivé, hover ghost) · `--bg-tertiary` #E9E9EB · `--surface-sidebar` #F7F7F8 · `--surface-panel-hover` #FAFAFA (hover de rangée) · `--surface-overlay` rgba(31,31,32,.32)
- Bordures : `--border` #E4E4E7 · `--border-light` #EFEFF1 · `--border-strong` #CFCFD4 (hover input/contour)
- Texte : `--text-body` #1F1F20 · `--text-secondary` #6B6B6E · `--text-muted` #8E8E92 · `--text-inverse` #FFFFFF · `--text-link` #1A6B66
- Action : `--primary` #1E837C (teal-600) · hover #1A6B66 · active #175551 · `--primary-soft` #EEF8F7 (rangée sélectionnée) · `--ink` #1F1F20 (soulignement d'onglet actif, toast)
- Statut (points et icônes seulement) : `--success` #249D95 · `--warning` #E0B400 · `--danger` #B3261E (hover #9A1F18) · `--neutral-dot` #A8A8AD
- Focus : `--focus-ring` rgba(30,131,124,.35) ; anneau `0 0 0 2px #fff, 0 0 0 4px ring` ; champs : bordure teal + `0 0 0 1px teal`
- Échelles complètes (wine, teal, mint, gray 0–900) dans `tokens/colors.css`.

**Typographie** — Inter (Google Fonts 400/500/600/700 ; auto-héberger pour Loi 25). `font-feature-settings: "cv02","cv03","cv04","cv11","ss01"`. Antialiasing.
- 2xs 11/16 (overlines, uppercase, +0.06em) · xs 12/16 (captions) · sm 13/18 (corps, labels 500) · base 14/20 (titres de carte 600) · lg 16/24 (titres de section 600) · xl 20/28 (titre de page 600, −0.01em ; chiffres 600 tabulaires) · 2xl 24/32 · 3xl 30/36
- Chiffres dans les tableaux : `font-variant-numeric: tabular-nums`.

**Espacements** — grille 4 px : 2 4 6 8 10 12 16 20 24 32 40 48 64.
- Contrôles : 28 (sm) / 32 / 36 (lg) de haut ; padding horizontal 8 / 12 / 16 ; bouton icône carré 32 ou 28.
- Avatars 24 / 32 / 48. Icônes 14 (boutons, cellules, onglets) / 16 (sidebar, barre du haut) / 12 (inline captions).
- Layout : sidebar 220 (56 repliée) · barre du haut 48 · menu Paramètres 200 · padding de page 24 · padding de carte 16 (12 compact) · rangée 8×12, min 40 · contenu max 1280 (décision UI-1, 2026-10-10 ; 1120 dans la livraison) · formulaires max 640 · écart entre sections 20.

**Rayons** — sm 3 · md 4 (boutons, inputs, nav) · lg 6 (cartes, menus, alertes) · 2xl 8 (dialogues) · full 9999.

**Ombres** — surfaces : none. Menus/popovers : `0 2px 8px rgba(31,31,32,.08), 0 0 0 1px rgba(31,31,32,.04)`. Dialogues/sheets/toasts : `0 12px 32px rgba(31,31,32,.14), 0 0 0 1px rgba(31,31,32,.05)`.

**Mouvement** — `cubic-bezier(.4,0,.2,1)` ; 120 ms (hover), 160 ms (menus, dialogues : fade + zoom 95→100 %), 240 ms (sheet glisse de la droite). Pas de rebond, pas d'entrées en cascade.

## Composants (valeurs exactes)
Référence : `design_system/components/SOURCE.md` (code source + contrats de props de chaque composant, concaténés) et `design_system/components/<groupe>/<Nom>.prompt.md` (usage). À porter dans `src/shared/ui`.

- **Button** — 32 px, rayon 4, 13 px 500, gap 6, pas d'ombre. `default` teal/blanc (hover teal-700, active teal-800) · `outline` blanc + bordure #E4E4E7 (hover bordure #CFCFD4, fond #F8F8F9) · `ghost` transparent texte secondaire (hover fond #F4F4F5) · `secondary` fond #F4F4F5 · `destructive` #B3261E · `link` teal-700 souligné au hover · `ink` #1F1F20. Désactivé : opacité .5. Tailles sm 28/12 px, lg 36/14 px, icon 32², icon-sm 28².
- **Input / Select / Textarea** — 32 px, rayon 4, bordure #E4E4E7, padding 0 10, 13 px ; placeholder #8E8E92 ; hover bordure #CFCFD4 ; focus bordure teal + anneau 1 px teal ; désactivé fond #F4F4F5 texte #6B6B6E ; erreur bordure #B3261E + caption rouge 12 px sous le champ (4 px). Icône de recherche 14 px à 9 px du bord, padding-left 30. Select : chevron 14 px à droite 8 px, padding-right 28. Textarea min 96, resize vertical.
- **Label** — 13 px 500 encre ; astérisque requis en teal ; indice muted 12 px.
- **Checkbox** — 16², rayon 3, bordure #CFCFD4 ; coché fond + bordure teal, coche blanche 12 px. **Switch** — 32×18, piste #D4D4D8 → teal, pouce 14 blanc, translation 14 px.
- **Badge (statut)** — texte 12 px 500 #6B6B6E, point 6 px (succès teal-500, avertissement #E0B400, erreur #B3261E, neutre #A8A8AD, info teal-500), gap 6, pas de fond ni bordure. `filled` : fond #B3261E (ou encre), blanc, 11/16 600, padding 0 5, rayon 3.
- **Avatar** — rond, fond #F4F4F5, texte #4D4D4F 500 (10/12/16 px), anneau intérieur 1 px rgba(0,0,0,.06), initiales 2 lettres.
- **Card** — blanc, bordure 1 px #E4E4E7, rayon 6, padding 16 ; en-tête titre 14/20 600 + description 12 px muted, action à droite ; interactive : hover fond #FAFAFA + bordure #CFCFD4.
- **Alert** — blanc, bordure #E4E4E7, rayon 6, padding 10×12, icône 15 px colorée (info gris, warning #E0B400, danger #B3261E, success teal-500) ; titre 13 500, corps 13 #6B6B6E ; action à droite.
- **StatusIndicator** — ligne 6 px padding, séparateur #EFEFF1, icône 14 px (circle-check teal, clock jaune, circle-alert rouge), libellé 13 + description 12 muted sur la même ligne de base.
- **EmptyState** — titre 13/500, description 13 muted (max 420), action après 12 px ; padding 24 0 ; aligné à gauche.
- **Tooltip** — fond #1F1F20, blanc, 12 px, rayon 3, padding 3×7, décalage 4 px.
- **Skeleton** — rayon 4, gris rgba(142,142,146,.2) pulsé 2 s.
- **NavTabs** — onglets 13 px #6B6B6E, padding 8×2, écart 12, soulignement 2 px encre quand actif (texte encre 500), ligne de base 1 px #E4E4E7 ; compteur 12 px muted.
- **SidebarNav** — 220 px, fond #F7F7F8, padding latéral 8, pas de bordure ; logo 22 px de haut dans une zone de 48 ; liens 13 px, padding 6×8, rayon 4, icône 16 px #8E8E92, écart 10 ; hover fond rgba(31,31,32,.05) ; actif fond blanc + anneau 1 px #E4E4E7 + texte encre 500 ; badge compteur 12 px muted tabulaire à droite ; pied : avatar 24 + nom 13/500 + rôle 12 muted + icône log-out. Repliée : 56 px, icônes centrées, tooltip natif.
- **Topbar** — 48 px, fond blanc, bordure basse #E4E4E7, padding 0 24 ; gauche : bouton panel-left 28², fil d'Ariane (parents muted, « / »), titre 13/500 ; droite : champ de recherche 28 px (icône 14, « Rechercher… », kbd ⌘K 11 px fond #F4F4F5), cloche 16 (point teal 6 px si notifications), aide, avatar 24.
- **SettingsNav** — 200 px ; groupes avec overline 11 px uppercase muted ; liens 13 px padding 5×8 rayon 4 ; actif fond #F4F4F5 texte encre 500 ; cadenas 12 px à droite si lecture seule.
- **DropdownMenu / Popover / CommandPalette** — panneau blanc, bordure #E4E4E7, rayon 6, ombre menu, padding 4 ; items 13 px padding 6×8 rayon 6 hover #F4F4F5 ; séparateur 1 px ; item danger #B3261E. Palette : champ 40 px sans bordure, groupes avec overline, item sélectionné fond #E9E9EB, max-height 300.
- **Dialog** — max 512, blanc, rayon 8, padding 20, ombre large, grille gap 14 ; titre 16/600, description 13 secondaire ; pied boutons alignés à droite gap 8 ; X 16 px en haut à droite (hors tabulation) ; overlay encre 32 % sans flou ; Échap ferme.
- **AlertDialog** — Dialog sans X, Annuler (outline) + Confirmer (default ou destructive).
- **Sheet** — 480 px à droite, blanc, bordure gauche, ombre large, glisse 240 ms ; en-tête padding 16 20 12 ; corps défilant padding 0 20 20 ; pied bordure haute padding 12.
- **Toast** — 356 px, fond encre, blanc, rayon 6, padding 10×12, ombre large ; icône colorée claire (succès teal-300, erreur #F7A3BB, avertissement #FDE26B) ; titre 13/500, description 13 à 70 %.
- **AuthCard** — carte 360 px, blanc, bordure, rayon 6, padding 28 ; logo 26 px ; titre 16/600 ; sous-titre 13 secondaire ; message d'état en boîte blanche bordée 8×10 ; formulaire gap 16.
- **PageHeader** — titre 20/28 600 −0.01em, sous-titre 13 secondaire, actions à droite gap 6, alignés en bas.
- **Icon** — Lucide, trait 2, currentColor. Production : `lucide-react` avec les mêmes noms.

## Screens / Views
Référence interactive : `ui_kit/index.html` (ouvrir dans un navigateur ; la bibliothèque compilée `_ds_bundle.js` est fournie dans `design_system/`). Textes en fr-CA à reprendre verbatim.

### 1. Connexion (`ui_kit/screen-Login.jsx`)
- Page blanche, AuthCard centrée (min-height 100vh, padding 48×16).
- Logo `logo-header.svg` 26 px ; H1 « Connexion » ; « Connectez-vous pour accéder à votre espace. »
- Champs Courriel (type email, autocomplete username) et Mot de passe ; bouton pleine largeur « Se connecter » (teal) ; séparateur « ou » (ligne 1 px + caption) ; bouton contour pleine largeur « Recevoir un lien de connexion par courriel » ; lien centré « Mot de passe oublié ? ».
- Après envoi du lien : message « Si un compte existe pour ce courriel, un lien de connexion vient d'être envoyé. » (ne jamais révéler l'existence du compte).

### 2. Ossature (`ui_kit/screen-Shell.jsx`)
- Flex horizontal plein écran : SidebarNav (220) + colonne (Topbar 48 + `<main>` défilant padding 24, contenu max 1280 centré (UI-1), sections espacées de 20).
- Menu selon le rôle (ordre exact) :
  - Admin : Accueil · Demandes · Clients · Professionnels · Rendez-vous · Facturation · Paramètres
  - Conseillère : Accueil · Demandes · Clients · Professionnels · Rendez-vous
  - Adjointe administrative : Accueil · Clients · Professionnels · Rendez-vous · Facturation · Paramètres (lecture seule)
- Icônes : house, inbox (badge = nb de demandes à rappeler), circle-user, users, calendar-days, receipt, settings.
- ⌘K / Ctrl+K ouvre la CommandPalette dans un Dialog 600 px sans fond : groupes Clients, Professionnels, Pages.
- Sélecteur de rôle (prototype seulement, à ne pas implémenter) dans la barre du haut.

### 3. Accueil (`ui_kit/screen-Accueil.jsx`)
- Ligne titre : « Bonjour {prénom} » (20/600) + date longue à droite en muted.
- Carte de chiffres : une seule carte, 4 figures côte à côte séparées par des traits 1 px, chaque figure = libellé 12 px secondaire / valeur 20/600 tabulaire / indice 12 muted ; cliquable (hover #FAFAFA). Figures : Demandes à rappeler (valeur rouge si dépassement 24 h), Rendez-vous aujourd'hui, Documents qui expirent, Factures impayées (ou Professionnels actifs si pas de Facturation).
- Grille 2 colonnes (auto-fit min 320) : « À rappeler » (rangées avatar 24 / nom 13 500 / motifs · source 12 muted / Urgent plein / âge) et « Aujourd'hui » (heure 13/500 44 px / client / pro · type / mode vidéo-téléphone avec icône 12).
- Section « À surveiller » : rangées icône 14 colorée + phrase + bouton contour sm à droite (« Voir la fiche », « Relancer »).
- Titres de section 14/600 avec bouton ghost sm « Toutes les demandes → » à droite.

### 4. Professionnels — liste (`ui_kit/screen-Professionnels.jsx`)
- PageHeader « Professionnels » + sous-titre « 6 professionnels · 4 actifs » + bouton teal « + Ajouter ».
- Barre de filtres : Input recherche (icône, max 280, « Rechercher par nom ou courriel… »), Select statut 160 (Tous les statuts / Actif / Invité / En attente / Inactif), bouton ghost « Filtres », compteur « N résultats » à droite (nowrap).
- Tableau dans une Card padding 0 : en-tête overline 11 px uppercase muted, padding 8×12 ; colonnes `minmax(0,2fr) minmax(0,1.6fr) 96px 72px minmax(0,1.4fr)` : Nom (avatar 24 + nom 13/500 + courriel 12 muted), Profession (+ ordre et permis 12 muted), Statut (Badge point), Documents (« 3 / 3 » tabulaire), À surveiller (12 px ; rouge si assurance expire, sinon muted ; « — » si rien).
- Rangées 40 px min, padding 8×12, séparateur haut 1 px, hover #FAFAFA, curseur pointer → ouvre la fiche. Texte tronqué avec ellipse, jamais de retour à la ligne.
- Pied de tableau : « N sur 6 professionnels » à gauche, pagination « ‹ Page 1 sur 1 › » à droite (12 px muted, bordure haute).
- État vide : « Aucun professionnel ne correspond » / « Modifiez la recherche ou les filtres. » + bouton contour « Réinitialiser ».
- Dialogue « Ajouter un professionnel » (description « Une invitation lui sera envoyée par courriel pour compléter son profil. ») : Nom complet*, Courriel*, Profession (select), case « Envoyer l'invitation maintenant » cochée ; Annuler / « Créer et inviter » → toast succès « Invitation envoyée. » en bas à droite 20 px, 3 s.
- Statuts : active → succès « Actif » · invited → neutre « Invité » · pending → neutre « En attente » · inactive → erreur « Inactif ».

### 5. Professionnels — fiche (`Fiche` dans `Professionnels.jsx`)
- Topbar affiche le fil « Professionnels / {Nom} ».
- Bandeau : avatar 48, nom 20/600 + Badge statut, ligne « Profession · Ordre permis · courriel » 13 secondaire ; actions à droite : menu « … » (Modifier le profil, Renvoyer l'invitation, —, Désactiver en rouge / Réactiver), « Fiche PDF » contour, « Envoyer au client » teal.
- NavTabs : Aperçu · Profil · Profil public · Documents (compteur) · Contrats · Rémunération et fiscalité (admin seulement) · Courriels · Historique.
- Aperçu : grille `minmax(0,2fr) minmax(240px,1fr)` gap 20. Gauche : Card « Liste de vérification » (description « Invitation → questionnaire → documents → révision → contrat → activation ») avec StatusIndicator × 5 (Invitation acceptée, Questionnaire complété, Assurance, Contrat signé (Documenso), Profil activé). Droite : Card « Prochaine action » (texte + bouton sm « Envoyer un rappel » si assurance expire, sinon « Rien à faire. Le dossier est complet. ») et Card « Tarifs » (lignes clé/valeur : Individuel · 50 min, Couple / famille · 60 min, Marge clinique 28 %).
- Documents : tableau `2fr 1fr 1fr 32px` Document (icône file-text 14) / Expiration / Statut (Valide, Expire bientôt en rouge, Manquant) / bouton icône download ; pied avec bouton contour sm « Téléverser un document ».
- Profil : Card « Identité et profession » max 640, grille 2 colonnes gap 12 : Prénom, Nom, Profession (select), Ordre professionnel, N° de permis, Courriel ; Annuler / Enregistrer à droite.
- Autres onglets : FullPageMessage « {Onglet} — Cette section sera disponible avec le module Professionnels (phase 4). »

### 6. Demandes (`ui_kit/screen-Demandes.jsx`)
- PageHeader « Demandes » / « Promesse de rappel en 24–48 h ouvrables » + bouton teal « + Nouvelle demande ».
- Filtres : recherche (« Rechercher un client ou un numéro… », max 280), Select étape 200 (Toutes les étapes / À rappeler / Appel découverte fait / Jumelage proposé).
- Layout maître-détail : grille `minmax(0,1fr) minmax(320px,38%)` gap 16 ; sous 1100 px → une colonne, panneau sous la liste.
- Liste (Card padding 0) colonnes `72px minmax(0,2fr) minmax(0,1.3fr) minmax(150px,1.3fr) 48px` : N° (12 muted tabulaire), Client (avatar 24, nom 13/500, étiquette Urgent pleine si urgence haute), Motifs (13 secondaire, « · » entre), Étape (Badge : À rappeler jaune, Appel découverte fait teal, Jumelage proposé succès), Âge (droite). Rangée sélectionnée : fond #EEF8F7. Pied « N demandes · Page 1 sur 1 ». Première demande ouverte par défaut.
- Panneau de détail (sticky top 0, bordure, rayon 6, max-height calc(100vh − 48 − 48), 3 zones) :
  - En-tête padding 12×16 : nom 16/600 + Urgent, ligne « D-1042 · reçue il y a 2 h · Google » 12 muted (ellipse), bouton X icon-sm.
  - Corps défilant padding 16 gap 20 : grille 2 colonnes clé 12 muted / valeur 13 (Téléphone, Disponibilités, Payeur externe, Urgence) ; section « Appel découverte » (Motifs en Badges sans point + bouton ghost sm « + Ajouter », Textarea « Besoin exprimé » min 72, cases Préférences Femme/Homme/Anglais/Soirs) ; section « Suggestions de professionnels » (caption « Vous décidez ; l'app vous aide. Classées par spécialité et disponibilité. », Card de 3 rangées avatar / nom / profession · tarif · dispo / Badge « Spécialisé » sur la première / bouton « Choisir » teal pour la première, contour ensuite).
  - Pied bordure haute padding 10×16 : « Noter l'appel » contour sm + « Proposer un jumelage » teal sm.

### 7. Paramètres (`ui_kit/screen-Parametres.jsx`)
- Titre « Paramètres » 20/600 ; flex : SettingsNav 200 + section max 640.
- Groupes : Clinique (Identité légale, Fiscalité, Signataire, Coordonnées bancaires, Région, Confidentialité (Loi 25)) · Plateforme (Utilisateurs et accès, Modules, Courriels, Signature électronique, Intégrations, Tâches planifiées, Journal d'audit) · Modules (Professionnels, Services et tarifs, Facturation, Payeurs externes, Rendez-vous) · Mon compte.
- Adjointe : groupe Plateforme et Coordonnées bancaires masqués, cadenas sur les autres, champs désactivés, Alert icône lock « Lecture seule — Seule l'administration peut modifier ces informations. »
- Modules : titre 16/600 + « Activez un module lorsqu'il est prêt. Un module désactivé disparaît du menu et de l'application. » ; Card padding 0, rangées padding 10×12 : nom 13/500 + « Requiert : … » 12 muted / Switch à droite.
- Identité légale : Card, grille 2 colonnes gap 12 : Raison sociale (pleine largeur), NEQ, Téléphone, Adresse du siège social (pleine largeur), Courriel, Fuseau horaire (select) ; Annuler / Enregistrer.
- Mon compte : Nom, Courriel ; boutons contour sm « Changer le mot de passe », « Déconnecter tous les appareils ».
- Autres sections : FullPageMessage « Cette section arrive dans une prochaine phase. »

### Non couverts
Clients, Rendez-vous (agenda), Facturation : pas d'écran de référence ; afficher l'EmptyState « {Module} — module en préparation » et réutiliser les patrons liste / fiche / panneau ci-dessus.

## Interactions & Behavior
- Navigation : clic sidebar → route ; rangée de tableau → fiche ou sélection du panneau ; fil d'Ariane cliquable pour revenir.
- Hover : boutons teal → teal-700 ; contour → bordure #CFCFD4 ; ghost et rangées → #F4F4F5 / #FAFAFA ; liens sidebar → rgba(31,31,32,.05). Actif/pressed : teal-800. Focus visible : anneau 2 px teal décalé de 2 px (champs : bordure teal + anneau 1 px).
- Transitions 120–160 ms ease ; dialogue fade + zoom 95 % 160 ms ; sheet glisse 240 ms ; pas d'animations décoratives.
- Dialogue : Échap et clic sur l'overlay ferment ; X hors tabulation ; focus initial sur le premier champ.
- Chargement : Skeleton 12 px dans les rangées ; libellé « chargement… » 12 muted.
- Erreurs : champ bordure rouge + caption ; messages rassurants (« Un imprévu, ça arrive. », « Le reste de l'application fonctionne toujours. Réessayez ou revenez plus tard. »).
- Validation : Nom complet et Courriel requis dans « Ajouter un professionnel » ; courriel invalide → « Courriel invalide. ».
- Responsive : maître-détail passe en une colonne sous 1100 px ; sidebar repliable à 56 px ; tableaux ne débordent jamais (colonnes `minmax(0, …)` + ellipses).
- Format fr-CA : dates « 19 oct. 2026 », « 21 janv. 2026 à 14:30 » ; montants « 160,00 $ » ; « 100 % » ; espace insécable avant : ; ! ? ; guillemets « ».

## State Management
- Session : utilisateur courant, rôle (admin | conseillere | adjointe | professionnel), modules activés (pilotent le menu et les routes).
- Shell : sidebar repliée (persistée), palette ouverte, compteur de demandes à rappeler.
- Professionnels : requête (q, statut, page) ; sélection ; dialogue d'ajout ; toast ; onglet actif de la fiche ; données pro (identité, profession, ordre, permis, statut, documents + expirations, contrat, tarifs, marge).
- Demandes : filtre étape ; demande sélectionnée (par défaut la plus ancienne « À rappeler ») ; brouillon de l'appel découverte (motifs, besoin, préférences) ; suggestions calculées (spécialité, disponibilité, tarif).
- Paramètres : section active ; état des modules (toggle avec dépendances) ; lecture seule selon le rôle.
- Données : Supabase via TanStack Query ; invalidation après création/activation ; toasts sonner stylés comme Toast.

## Assets
- `assets/logo-header.svg` — wordmark MANA (sidebar 22 px, AuthCard 26 px). `assets/logo.png` — lockup complet avec baseline (fiche PDF, marketing). `assets/favicon-legacy.svg` — ancien favicon sauge, à remplacer.
- Icônes : Lucide (`lucide-react`), trait 2 ; mapping : house Accueil · inbox Demandes · circle-user Clients · users Professionnels · calendar-days Rendez-vous · receipt Facturation · settings Paramètres · file-text document · download · upload · send · mail · pencil · user-x · ellipsis · search · bell · circle-help · panel-left · chevron-down/left/right · x · plus · filter · phone · video · triangle-alert · circle-check · circle-alert · clock · lock · log-out.
- Police : Inter (Google Fonts ou auto-hébergée woff2).

## Files
- `design_system/styles.css` + `design_system/tokens/*.css` — tokens à copier.
- `design_system/components/SOURCE.md` — code source et props de chaque primitive ; `components/<groupe>/*.prompt.md` — usage ; `*.card.html` — démos (nécessitent `_ds_bundle.js`).
- `design_system/guidelines/*.html` — spécimens couleurs, type, espacements, marque.
- `design_system/readme.md` — contexte produit, voix et ton, fondations visuelles.
- `design_system/_ds_bundle.js` — bibliothèque compilée nécessaire pour ouvrir les HTML.
- `ui_kit/index.html` + `screen-*.jsx` — prototype interactif (Connexion → Accueil → Professionnels → Demandes → Paramètres).
- `assets/` — logos.
- Repo cible : https://github.com/pergolassignature/Clinique-Mana (lire `CLAUDE.md`, `docs/standards/business-context.md`, `src/shared/ui`, `src/i18n/fr-CA.json` avant d'implémenter).
