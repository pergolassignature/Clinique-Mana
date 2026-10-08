# Runbook — Copie de sécurité de la clé PII (escrow) et restauration

**Statut :** à faire par le propriétaire, sur chaque environnement. Rien n'a été exécuté. · **Écrit :** 2026-10-08 (Phase 4, Task 4a.16) · **ADR :** [0004, « Before Phase 4 »](../adr/0004-secrets-in-vault.md#before-phase-4-sin) · **Conventions :** [§8](../standards/database-conventions.md#8-secrets-and-sensitive-data) · **Plan :** [Mise en service, point 5](../plans/2026-10-08-professionals-module-plan.md#mise-en-service-jonathan) · **Voir aussi :** [rotation de la clé](pii-key-rotation.md)

> **La clé protège les NAS et les numéros de compte.** Seul le propriétaire (Jonathan ou Christine) suit ce runbook, lui-même, dans le tableau de bord Supabase du projet. **Un agent ne l'exécute jamais**, même en partie. La valeur de la clé ne va **jamais** dans le clavardage, git, un ticket, un courriel, une capture d'écran ou un fichier : seulement dans le gestionnaire de mots de passe de la clinique.

## Quoi et pourquoi

- Les colonnes chiffrées (`organization_bank_details.account_number`, puis le NAS et le compte des professionnels en Task 4a.17) sont chiffrées avec une **clé de données** gardée dans Supabase Vault : le secret `pii_encryption_key` (version 1). Une rotation ajoute `pii_encryption_key_v2`, `_v3`… ([rotation](pii-key-rotation.md)).
- Vault chiffre ce secret avec une clé racine gardée par Supabase, **hors de la base**. Une sauvegarde restaurée dans le **même** projet garde donc la clé. Mais un **nouveau** projet (restauration vers un nouveau projet, création de la production, sinistre) ne peut pas la lire : sans copie, toutes les données chiffrées sont **perdues** (il faudrait les ressaisir).
- La copie dans le gestionnaire de mots de passe est le seul moyen de revenir en arrière. Chaque environnement a **sa propre clé** et donc sa propre entrée.
- La vérification au déploiement (`public.pii_health_check()`, job GitHub « Apply Supabase migrations », étape « PII key health check ») déchiffre un texte témoin (`private.pii_canary`, la valeur fixe `mana-pii-canary`) avec chaque version de la clé. Elle échoue si une clé manque ou a changé.

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

1. Ouvrir le **SQL Editor** du projet dans le tableau de bord. Vérifier la référence du projet dans l'adresse (staging : `vnmbjbdsjxmpijyjmmkh`).
2. Lister les versions présentes (noms seulement, aucune valeur) :
   ```sql
   select name, created_at, updated_at
     from vault.secrets
    where name like 'pii_encryption_key%'
    order by name;
   ```
   Attendu avant toute rotation : une ligne, `pii_encryption_key`.
3. Afficher la valeur, **une version à la fois** :
   ```sql
   select decrypted_secret from vault.decrypted_secrets where name = 'pii_encryption_key';
   ```
4. Copier la valeur dans le gestionnaire de mots de passe de la clinique, entrée « Clinique MANA — clé PII (staging) » (champ mot de passe). En note : la référence du projet, le nom exact du secret, la version et la date. Pour une version ≥ 2 : une entrée par version, p. ex. « Clinique MANA — clé PII (staging, v2) ». Ensuite, effacer le résultat de l'éditeur (lancer l'étape 5 dans le même onglet) ; ne jamais exporter ce résultat (CSV, copie dans un autre outil).
5. Noter l'**empreinte** de la clé (un SHA-256, qui ne révèle rien de la clé) dans la note de la même entrée :
   ```sql
   select name, encode(extensions.digest(decrypted_secret, 'sha256'), 'hex') as empreinte
     from vault.decrypted_secrets
    where name like 'pii_encryption_key%'
    order by name;
   ```
6. Vérifier la copie sans réafficher la clé : copier la valeur depuis le gestionnaire, puis dans le Terminal du Mac :
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

1. **Avant le premier `db push`**, dans le SQL Editor du nouveau projet, coller la valeur copiée **seulement** à la place de `<valeur>` :
   ```sql
   select vault.create_secret('<valeur>', 'pii_encryption_key',
     'Clé de chiffrement des renseignements sensibles (ADR 0004). Ne jamais supprimer ni remplacer.');
   ```
   Même chose pour chaque version ≥ 2 encore utilisée (`pii_encryption_key_v2`…), avec son nom exact. Puis **effacer le texte de la requête** et supprimer l'onglet ou l'extrait enregistré : le SQL Editor conserve le texte des requêtes.
2. **Si les migrations ont déjà tourné** dans ce nouveau projet (une clé aléatoire a été créée) **et qu'aucune donnée chiffrée n'y existe encore**, vérifier d'abord qu'il n'y a rien à perdre :
   ```sql
   select count(*) from public.organization_bank_details;   -- doit être 0
   -- à partir de la Task 4a.17 : select count(*) from public.professional_private;   -- doit être 0
   ```
   Seulement si chaque compte donne 0, remplacer la valeur aléatoire par la valeur copiée, puis refaire le témoin de la version 1 (il avait été chiffré avec la clé aléatoire) :
   ```sql
   select vault.update_secret(s.id, '<valeur>') from vault.secrets s where s.name = 'pii_encryption_key';
   delete from private.pii_canary where key_version = 1;
   insert into private.pii_canary (key_version, ciphertext)
   values (1, private.encrypt_pii('mana-pii-canary', 1));
   ```
   Puis effacer le texte de la requête comme à l'étape 1. **Si un compte n'est pas 0, s'arrêter** et appeler le coordinateur : refaire le témoin rendrait la vérification verte alors que ces lignes sont chiffrées avec une autre clé.
3. Charger les données (restauration de la sauvegarde), seulement ensuite.
4. Passer à « Vérifier ».

### Vérifier

Dans le SQL Editor (il s'exécute en `postgres`, propriétaire de la fonction ; le job de déploiement l'appelle de la même façon) :
```sql
select public.pii_health_check();
```
Attendu : `true`. Puis refaire l'étape 5 de l'export et comparer les empreintes avec celles du gestionnaire. Enfin, dans l'app : Paramètres → Coordonnées bancaires → « Afficher » montre le numéro.

## La vérification du déploiement échoue

L'étape « PII key health check » du job GitHub est rouge. Les migrations **sont** appliquées ; ce qui est en cause, c'est la lecture des données chiffrées.

1. **Ne saisir aucun NAS ni numéro de compte** tant que ce n'est pas réglé. Ne pas toucher au secret dans Vault. **Ne jamais refaire un témoin pour faire passer la vérification** : le témoin est la preuve, le refaire avec la mauvaise clé masquerait la perte.
2. Lire l'avertissement dans le journal du job (aucune valeur n'y figure) :
   - `key version N does not decrypt its canary (SQLSTATE 55000)` : le secret de la version N est **absent** (supprimé ou renommé) ;
   - `… (SQLSTATE 39000)` : mauvaise clé ou données corrompues (secret **modifié**, ou nouveau projet sans la copie) ;
   - `decrypts its canary to an unexpected value` : le témoin a été remplacé ;
   - `no canary row` : la table `private.pii_canary` est vide (la clé était illisible quand la migration a tourné, ou le témoin a été supprimé) ;
   - « Could not run public.pii_health_check() » : connexion impossible ; voir le dernier point.
3. Diagnostiquer dans le SQL Editor, sans afficher de clé : la requête des versions (export, étape 2) et celle des empreintes (étape 5), à comparer avec les empreintes notées dans le gestionnaire.
4. Corriger avec la copie du gestionnaire, pour la version en cause et sous son nom exact :
   - secret présent mais empreinte différente : `select vault.update_secret(s.id, '<valeur>') from vault.secrets s where s.name = '<nom>';`
   - secret absent : `select vault.create_secret('<valeur>', '<nom>', 'Clé de chiffrement des renseignements sensibles (ADR 0004). Ne jamais supprimer ni remplacer.');`
   - table vide (`no canary row`) alors que l'empreinte de la version 1 correspond à la copie : `insert into private.pii_canary (key_version, ciphertext) values (1, private.encrypt_pii('mana-pii-canary', 1));` (c'est la seule situation où l'on crée un témoin hors d'une rotation : l'empreinte prouve que c'est la bonne clé).

   Effacer ensuite le texte de la requête. Puis `select public.pii_health_check();` → `true`, et relancer le job (« Re-run jobs »).
5. **Sans copie** de la version en cause, les données chiffrées avec elle sont perdues : elles devront être ressaisies. Appeler le coordinateur avant toute autre action ; la décision (vider ces colonnes, refaire le témoin) se prend ensemble.
6. Connexion impossible : vérifier l'hôte `SUPABASE_DB_POOLER_HOST` du workflow (Tableau de bord → Connect → « Session pooler »), ou le secret de dépôt `SUPABASE_DB_POOLER_URL` s'il existe, et le secret `SUPABASE_DB_PASSWORD`. Un avertissement « supabase link resolved the pooler host … » dans le job donne l'hôte que la CLI a trouvé.
