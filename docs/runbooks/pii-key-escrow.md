# Runbook — Copie de sécurité de la clé PII (escrow) et restauration

**Statut :** à faire par le propriétaire, sur chaque environnement. Rien n'a été exécuté. · **Écrit :** 2026-10-08 (Phase 4, Task 4a.16) · **ADR :** [0004, « Before Phase 4 »](../adr/0004-secrets-in-vault.md#before-phase-4-sin) · **Conventions :** [§8](../standards/database-conventions.md#8-secrets-and-sensitive-data) · **Plan :** [Mise en service, point 5](../plans/2026-10-08-professionals-module-plan.md#mise-en-service-jonathan) · **Voir aussi :** [rotation de la clé](pii-key-rotation.md)

> **La clé protège les NAS et les numéros de compte.** Seul le propriétaire (Jonathan ou Christine) suit ce runbook, lui-même, dans le tableau de bord Supabase du projet. **Un agent ne l'exécute jamais**, même en partie. La valeur de la clé ne va **jamais** dans le clavardage, git, un ticket, un courriel, une capture d'écran ou un fichier : seulement dans le gestionnaire de mots de passe de la clinique.

## Quoi et pourquoi

- Les colonnes chiffrées (`organization_bank_details.account_number`, puis le NAS et le compte des professionnels en Task 4a.17) sont chiffrées avec une **clé de données** gardée dans Supabase Vault : le secret `pii_encryption_key` (version 1). Une rotation ajoute `pii_encryption_key_v2`, `_v3`… ([rotation](pii-key-rotation.md)).
- Vault chiffre ce secret avec une clé racine gardée par Supabase, **hors de la base**. Une sauvegarde restaurée dans le **même** projet garde donc la clé. Mais un **nouveau** projet (restauration vers un nouveau projet, création de la production, sinistre) ne peut pas la lire : sans copie, toutes les données chiffrées sont **perdues** (il faudrait les ressaisir).
- La copie dans le gestionnaire de mots de passe est le seul moyen de revenir en arrière. Chaque environnement a **sa propre clé** et donc sa propre entrée.
- La vérification (`public.pii_health_check()`) déchiffre un texte témoin (`private.pii_canary`, la valeur fixe `mana-pii-canary`) avec chaque version de la clé, et vérifie que chaque version qui chiffre des données a sa clé et son témoin. Elle répond `false` si une clé manque ou a changé. GitHub la lance après chaque push de migrations (job « Apply Supabase migrations », étape « PII key health check ») et chaque jour (workflow « PII key health check (staging) »). Un job rouge est une **alerte** : il ne bloque rien, Vercel déploie l'app quand même.

## Qui et quand

- **Qui :** le propriétaire, Jonathan ou Christine, connecté au tableau de bord Supabase avec son propre compte.
- **Quand :**
  - avant la **première** vraie donnée sensible (NAS ou coordonnées bancaires) sur un environnement, quel qu'il soit ;
  - après chaque rotation, pour la nouvelle version, **avant** d'ajouter son témoin ([rotation](pii-key-rotation.md), étape 2) ;
  - de nouveau si la vérification de l'empreinte (étape 5) ne correspond plus.

## Ne jamais supprimer ni modifier ce secret

**Ne jamais supprimer ni modifier ce secret dans le tableau de bord (Vault).** Cela vaut pour `pii_encryption_key` et pour chaque `pii_encryption_key_v<n>`. Modifier la valeur ou le nom rend illisible tout ce qui a été chiffré avec ; le supprimer aussi. La description du secret le rappelle (« Ne jamais supprimer ni remplacer »). La seule suppression prévue est celle d'une ancienne version, à la fin d'une [rotation](pii-key-rotation.md#7-retirer-lancienne-version), après ses vérifications.

## Staging et production : deux clés différentes, exprès

- Staging et production ont chacun leur clé, et chacun son entrée : « Clinique MANA — clé PII (staging) », « Clinique MANA — clé PII (production) ».
- Une copie des données de production vers staging reste **indéchiffrable** sur staging : c'est voulu (Loi 25 : les vraies données sensibles ne doivent pas être lisibles sur staging). « Afficher » y échoue pour ces lignes.
- **Ne jamais « réparer » cela en copiant la clé de production dans staging.** Pour tester, ressaisir des valeurs de test sur staging.
- Une copie de données ne prend jamais `vault.secrets` ni `private.pii_canary` : le témoin de staging doit rester chiffré avec la clé de staging.

## Copier la clé (export)

> **Avant toute étape qui copie la clé** (ici les étapes 3, 4 et 6, et les restaurations plus bas) :
> - **mettre en pause les gestionnaires d'historique du presse-papiers** (Raycast, Alfred, Paste, Maccy, CopyClip…) : ils gardent chaque copie, sur le disque, parfois synchronisée ;
> - **couper Handoff / le presse-papiers universel** (Réglages Système → Général → AirDrop et Handoff → « Autoriser Handoff… ») : sinon la clé arrive aussi sur l'iPhone et l'iPad du même compte ;
> - **se méfier des extensions de navigateur** qui lisent le presse-papiers (gestionnaires de notes, traducteurs, outils de capture) : faire ces étapes dans une fenêtre où elles sont désactivées, par exemple une fenêtre privée sans extension ;
> - **préférer la copie du gestionnaire de mots de passe lui-même** (bouton « Copier » du champ) : il vide le presse-papiers seul après quelques secondes. Ne jamais copier la clé depuis un fichier, un courriel ou une note.
>
> Remettre les outils en marche seulement après avoir vidé le presse-papiers (`pbcopy < /dev/null`).

1. Ouvrir le **SQL Editor** du projet dans le tableau de bord. Vérifier la référence du projet dans l'adresse (staging : `vnmbjbdsjxmpijyjmmkh`).
2. Lister les versions présentes (noms seulement, aucune valeur) :
   ```sql
   select name, created_at, updated_at
     from vault.secrets
    where name like 'pii_encryption_key%'
    order by name;
   ```
   Attendu avant toute rotation : une ligne, `pii_encryption_key`.
3. Afficher la valeur, **une version à la fois** (relire l'encadré ci-dessus d'abord) :
   ```sql
   select decrypted_secret from vault.decrypted_secrets where name = 'pii_encryption_key';
   ```
4. Copier la valeur dans le gestionnaire de mots de passe de la clinique, entrée « Clinique MANA — clé PII (staging) » (champ mot de passe), puis vider le presse-papiers (`pbcopy < /dev/null` dans le Terminal). En note : la référence du projet, le nom exact du secret, la version et la date. Pour une version ≥ 2 : une entrée par version, p. ex. « Clinique MANA — clé PII (staging, v2) ». Ensuite, effacer le résultat de l'éditeur (lancer l'étape 5 dans le même onglet) ; ne jamais exporter ce résultat (CSV, copie dans un autre outil).
5. Noter l'**empreinte** de la clé (un SHA-256, qui ne révèle rien de la clé) dans la note de la même entrée :
   ```sql
   select name, encode(extensions.digest(decrypted_secret, 'sha256'), 'hex') as empreinte
     from vault.decrypted_secrets
    where name like 'pii_encryption_key%'
    order by name;
   ```
6. Vérifier la copie sans réafficher la clé : copier la valeur avec le bouton « Copier » du gestionnaire, puis dans le Terminal du Mac :
   ```bash
   pbpaste | shasum -a 256
   pbcopy < /dev/null
   ```
   La première ligne doit donner la même empreinte que l'étape 5 (la seconde vide le presse-papiers). Sinon, recommencer à l'étape 3.
7. Dire au coordinateur « clé PII de staging copiée le <date> » (sans valeur ni empreinte), pour cocher la Mise en service.

## Restaurer la clé

### Cas A : restauration dans le même projet

Sauvegarde quotidienne ou restauration à un instant donné (PITR) du **même** projet : Vault et sa clé racine restent en place, il n'y a rien à restaurer. Passer à « Vérifier ».

### Cas B : nouveau projet (restauration vers un nouveau projet, production, sinistre)

La clé doit exister **avant** que la moindre donnée chiffrée soit chargée. Le plus sûr : avant le premier `supabase db push` du nouveau projet. La migration `…_core_bank_details.sql` crée une clé **aléatoire** si aucun secret `pii_encryption_key` n'existe ; cette clé neuve ne lirait aucune donnée existante.

La valeur de la clé est collée **dans une seule instruction, seule dans l'éditeur**, après des vérifications faites à part. Pourquoi : une instruction qui **échoue** est écrite en entier dans les journaux Postgres, littéraux compris (`log_min_error_statement`, `error` par défaut), et le SQL Editor envoie tout le texte de l'éditeur d'un seul tenant. Une clé dans le texte d'une instruction qui échoue (nom déjà pris, faute de frappe dans une autre ligne) finirait donc dans les journaux de Supabase. Les vérifications ci-dessous écartent les causes d'échec prévisibles ; si l'instruction échoue quand même, la traiter comme une exposition : [rotation](pii-key-rotation.md) une fois la restauration finie.

1. **Avant le premier `db push`**, dans le SQL Editor du nouveau projet :
   1. **Vérifier, à part** (sans valeur), que le nom est libre :
      ```sql
      select count(*) from vault.secrets where name = 'pii_encryption_key';   -- doit être 0
      ```
      Si c'est 1, une clé existe déjà : passer au point 2 (pas de `create_secret`, il échouerait).
   2. Dans un **nouvel onglet vide**, avec ce seul texte, coller la valeur copiée **seulement** à la place de `<valeur>` (relire l'encadré « Avant toute étape qui copie la clé ») :
      ```sql
      select vault.create_secret('<valeur>', 'pii_encryption_key',
        'Clé de chiffrement des renseignements sensibles (ADR 0004). Ne jamais supprimer ni remplacer.');
      ```
   3. Puis **effacer le texte de la requête** et supprimer l'onglet ou l'extrait enregistré : le SQL Editor conserve le texte des requêtes. Vider le presse-papiers.

   Même chose pour chaque version ≥ 2 encore utilisée, avec son nom exact (`pii_encryption_key_v2`, `pii_encryption_key_v3`… ; la version 1 n'a pas de suffixe), vérification du nom comprise.
2. **Si les migrations ont déjà tourné** dans ce nouveau projet (une clé aléatoire a été créée) **et qu'aucune donnée chiffrée n'y existe encore** :
   1. **Vérifier, à part** (sans valeur) qu'il n'y a rien à perdre et que le secret existe :
      ```sql
      select count(*) from private.pii_encrypted_values();                     -- doit être 0
      select count(*) from vault.secrets where name = 'pii_encryption_key';    -- doit être 1
      ```
      **Si le premier compte n'est pas 0, s'arrêter** et appeler le coordinateur : ces valeurs sont chiffrées avec la clé aléatoire, et la remplacer les rendrait illisibles. Si le second est 0, revenir au point 1.
   2. Dans un **nouvel onglet vide**, avec ce seul texte, remplacer la valeur aléatoire par la valeur copiée :
      ```sql
      select vault.update_secret(s.id, '<valeur>') from vault.secrets s where s.name = 'pii_encryption_key';
      ```
      Puis effacer le texte de la requête comme au point 1.
   3. Refaire le témoin de la version 1 (il avait été chiffré avec la clé aléatoire), dans un autre onglet :
      ```sql
      delete from private.pii_canary where key_version = 1;
      select private.pii_seed_canary(1);   -- true
      ```
      `pii_seed_canary` ne crée le témoin que si la clé lit toutes les valeurs déjà chiffrées avec elle : il refuse (`false`, avec un avertissement) plutôt que de rendre la vérification verte sur une mauvaise clé.
3. Charger les données (restauration de la sauvegarde), seulement ensuite.
4. Passer à « Vérifier ».

### Vérifier

Dans le SQL Editor (il s'exécute en `postgres`, propriétaire de la fonction, seul rôle qui peut l'appeler ; les jobs GitHub se connectent aussi en `postgres`) :
```sql
select public.pii_health_check();
```
Attendu : `true`. Puis refaire l'étape 5 de l'export et comparer les empreintes avec celles du gestionnaire. Enfin, dans l'app : Paramètres → Coordonnées bancaires → « Afficher » montre le numéro.

## La vérification échoue

L'étape « PII key health check » d'un job GitHub est rouge (après un push de migrations, ou la vérification quotidienne), ou `select public.pii_health_check();` répond `false`. Rien n'est bloqué : les migrations sont appliquées (sauf si une étape précédente du job a échoué) et l'app est déployée. Ce qui est en cause, c'est la lecture des données chiffrées.

1. **Ne saisir aucun NAS ni numéro de compte** tant que ce n'est pas réglé. Ne pas toucher au secret dans Vault. **Ne jamais insérer un témoin à la main pour faire passer la vérification** : le témoin est la preuve. Seul `private.pii_seed_canary(n)` en crée un, et seulement si la clé lit toutes les valeurs de sa version.
2. Lire l'avertissement dans le journal du job (aucune valeur n'y figure) :
   - `key version N does not decrypt its canary (SQLSTATE 55000)` : le secret de la version N est **absent** (supprimé ou renommé) ;
   - `… (SQLSTATE 39000)` : mauvaise clé ou données corrompues (secret **modifié**, ou nouveau projet sans la copie) ;
   - `decrypts its canary to an unexpected value` : le témoin a été remplacé ;
   - `no canary row` : la table `private.pii_canary` est vide (la clé ne lisait pas les données quand la migration a tourné, ou le témoin a été supprimé) ;
   - `key version N is used by <table> but its key is missing` : des données sont chiffrées avec la version N, dont le secret est **absent** ;
   - `key version N is used by <table> but has no canary` : des données sont chiffrées avec la version N, qui n'a pas de témoin (témoin supprimé, retour en arrière de [rotation](pii-key-rotation.md#revenir-en-arrière-avant-létape-7) inachevé, ou clé remplacée après l'écriture des données) ;
   - « Could not run public.pii_health_check() » : connexion impossible ; voir le dernier point.
3. Diagnostiquer dans le SQL Editor, sans afficher de clé : la requête des versions (export, étape 2), celle des empreintes (étape 5), à comparer avec les empreintes notées dans le gestionnaire, et l'inventaire des versions utilisées par les données :
   ```sql
   select * from private.pii_key_versions_in_use() order by 1, 2;
   ```
4. Corriger avec la copie du gestionnaire, pour la version en cause et sous son nom exact (`pii_encryption_key` pour la version 1, `pii_encryption_key_v<n>` sinon). Comme pour la restauration : relire l'encadré « Avant toute étape qui copie la clé », **vérifier à part** que le secret existe (`select count(*) from vault.secrets where name = '<nom>';`), puis coller la valeur dans une instruction **seule dans un onglet vide**, et effacer le texte ensuite.
   - secret présent (compte 1) mais empreinte différente : `select vault.update_secret(s.id, '<valeur>') from vault.secrets s where s.name = '<nom>';`
   - secret absent (compte 0) : `select vault.create_secret('<valeur>', '<nom>', 'Clé de chiffrement des renseignements sensibles (ADR 0004). Ne jamais supprimer ni remplacer.');`
   - témoin absent (`no canary row`, ou `has no canary`) alors que l'empreinte de la version correspond à la copie : `select private.pii_seed_canary(<n>);` → `true`. S'il répond `false` (« does not decrypt every value stored with it »), la clé présente ne lit pas les données : ne rien forcer, passer au point 5.

   Puis `select public.pii_health_check();` → `true`, et relancer le job (« Re-run jobs »).
5. **Sans copie** de la version en cause, les données chiffrées avec elle sont perdues : elles devront être ressaisies. Appeler le coordinateur avant toute autre action ; la décision (vider ces colonnes, refaire le témoin) se prend ensemble.
6. Connexion impossible : vérifier l'hôte `SUPABASE_DB_POOLER_HOST` des workflows `supabase-migrations.yml` et `pii-health.yml` (Tableau de bord → Connect → « Session pooler »), ou le secret de dépôt `SUPABASE_DB_POOLER_URL` s'il existe, et le secret `SUPABASE_DB_PASSWORD`. Un avertissement « supabase link resolved the pooler host … » dans le job donne l'hôte que la CLI a trouvé.
