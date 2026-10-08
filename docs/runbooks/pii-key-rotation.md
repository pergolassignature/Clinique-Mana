# Runbook — Rotation de la clé PII

**Statut :** procédure prête, jamais exécutée sur un environnement distant. Le chemin complet (nouvelle clé, témoin, re-chiffrement, relance du lot, retour en arrière, retrait de l'ancienne version) est rejoué par le test pgTAP `047_core_pii_key_versions`, avec les blocs SQL de ce runbook tels quels. · **Écrit :** 2026-10-08 (Phase 4, Task 4a.16) · **ADR :** [0004, « Before Phase 4 »](../adr/0004-secrets-in-vault.md#before-phase-4-sin) · **Conventions :** [§8, « Key versions »](../standards/database-conventions.md#8-secrets-and-sensitive-data) · **Voir aussi :** [copie de sécurité de la clé](pii-key-escrow.md)

> Seul le propriétaire (Jonathan ou Christine) fait une rotation, lui-même, dans le SQL Editor du projet. **Un agent ne l'exécute jamais.** Aucune valeur de clé n'est tapée ni affichée ici : la nouvelle clé est générée dans la base, puis copiée dans le gestionnaire de mots de passe avec le [runbook de copie](pii-key-escrow.md).

## Quand

- La clé a pu être exposée (affichée ou copiée hors du gestionnaire de mots de passe, export égaré).
- Une personne qui avait accès à la copie quitte la clinique.
- Pas de rotation de routine décidée à ce jour.

## Principe

- **Noms des secrets Vault :** la version 1 est `pii_encryption_key`, **sans suffixe** ; la version 2 est `pii_encryption_key_v2`, la version 3 `pii_encryption_key_v3`, et ainsi de suite (`pii_encryption_key_v<n>` pour n ≥ 2). Il n'existe pas de `pii_encryption_key_v1`.
- **Une version par ligne :** chaque ligne chiffrée garde la version avec laquelle **toutes** ses colonnes chiffrées ont été écrites (`key_version`). Une écriture de l'app re-chiffre toute la ligne avec la version courante (conventions §8).
- **Écriture :** les nouvelles valeurs sont chiffrées avec la version la plus haute qui a un **témoin** dans `private.pii_canary` (`private.pii_current_key_version()`). Ajouter le témoin d'une nouvelle clé est donc le geste qui fait basculer les écritures vers elle.
- **Lecture :** chaque ligne se déchiffre avec sa propre version. Les deux clés coexistent le temps du re-chiffrement.
- **Vérification :** `select public.pii_health_check();` doit donner `true` à la fin de chaque étape (sauf pendant un retour en arrière, voir plus bas). Elle vérifie que chaque témoin se déchiffre, que chaque version qui chiffre des données a sa clé et son témoin, **et** que chaque valeur chiffrée se déchiffre avec la version de sa ligne. GitHub la lance aussi après chaque push de migrations et chaque jour (workflows « Apply Supabase migrations » et « PII key health check ») : un job rouge est une alerte, il ne bloque rien (Vercel déploie l'app quand même).

Les étapes ci-dessous passent de la version 1 à la version 2. Pour une rotation suivante, remplacer 1 par la version courante et 2 par la suivante, dans les nombres **et** dans les noms de secrets.

**Tables chiffrées.** La liste qui fait foi est la fonction `private.pii_encrypted_values()` (une branche par colonne chiffrée, avec la clé de ligne) : la vérification et l'inventaire la lisent, et le test pgTAP `047` échoue si une table qui a une colonne `key_version` n'y figure pas. Toute nouvelle colonne chiffrée s'y ajoute, et ici (tableau et bloc de l'étape 4), dans le même changement (conventions §8) :

| Table | Colonnes chiffrées | Clé de ligne |
|---|---|---|
| `public.organization_bank_details` | `account_number` | `org_id` |
| `public.professional_private` (à partir de la Task 4a.17) | `sin`, `bank_account` | `professional_id` |
| `public.professional_submission_private` (à partir de la Task 4b.1, P4-38 : valeurs saisies dans le questionnaire) | `sin`, `bank_account` | `submission_id` |

## Avant de commencer

1. La copie de la version courante est à jour dans le gestionnaire (empreinte vérifiée, [copie](pii-key-escrow.md#copier-la-clé-export), étapes 5 et 6).
2. Une sauvegarde récente existe (Tableau de bord → Database → Backups).
3. `select public.pii_health_check();` → `true`.
4. Inventaire des versions qui chiffrent des données (nombre de valeurs chiffrées par table et par version) :
   ```sql
   select * from private.pii_key_versions_in_use() order by 1, 2;
   ```

## Étapes

### 1. Créer la nouvelle clé

La valeur est générée dans la base ; personne ne la tape.
```sql
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'base64'),
  'pii_encryption_key_v2',
  'Clé de chiffrement des renseignements sensibles, version 2 (ADR 0004). Ne jamais supprimer ni remplacer.'
);
```
Rien ne change encore : aucune écriture n'utilise une clé sans témoin.

### 2. Copier la nouvelle clé, avant toute donnée

Suivre le [runbook de copie](pii-key-escrow.md#copier-la-clé-export) pour `pii_encryption_key_v2`, nouvelle entrée « Clinique MANA — clé PII (staging, v2) », empreinte vérifiée. **Ne pas passer à l'étape 3 sans cette copie** : dès l'étape 3, de nouvelles données sont chiffrées avec la version 2.

### 3. Ajouter le témoin de la version 2 (les écritures basculent)

```sql
select private.pii_seed_canary(2);          -- true
select private.pii_current_key_version();   -- 2
select public.pii_health_check();           -- true
```
`pii_seed_canary` ne crée le témoin que si la clé existe et lit toutes les valeurs déjà chiffrées avec cette version (aucune, pour une clé neuve). `false` : lire l'avertissement, ne pas aller plus loin.

### 4. Re-chiffrer les lignes existantes, par lots

Chaque exécution traite au plus 500 lignes par table, dans sa propre transaction (le SQL Editor exécute le texte d'un seul tenant). **Relancer le tout jusqu'à ce que l'inventaire affiché à la fin ne montre plus que la version 2.** Pas de fonction : une fonction ferait tous les lots dans une seule transaction.

```sql
do $$
declare
  v_target constant integer := 2;   -- la version vers laquelle re-chiffrer
  v_count integer;
begin
  if private.pii_current_key_version() <> v_target then
    raise exception 'La version d''écriture est %, pas % : rien n''est re-chiffré.', private.pii_current_key_version(), v_target;
  end if;
  perform pg_catalog.set_config('app.audit_source', 'runbook:pii-key-rotation', true);

  update public.organization_bank_details b
     set account_number = private.encrypt_pii(private.decrypt_pii(b.account_number, b.key_version), v_target),
         key_version = v_target
   where b.org_id in (select x.org_id from public.organization_bank_details x
                       where x.key_version <> v_target order by x.org_id limit 500);
  get diagnostics v_count = row_count;
  raise notice 'organization_bank_details : % ligne(s) re-chiffrée(s)', v_count;

  -- À partir de la Task 4a.17 (une valeur absente reste absente) :
  -- update public.professional_private p
  --    set sin = private.encrypt_pii(private.decrypt_pii(p.sin, p.key_version), v_target),
  --        bank_account = private.encrypt_pii(private.decrypt_pii(p.bank_account, p.key_version), v_target),
  --        key_version = v_target
  --  where p.professional_id in (select x.professional_id from public.professional_private x
  --                               where x.key_version <> v_target order by x.professional_id limit 500);
  -- get diagnostics v_count = row_count;
  -- raise notice 'professional_private : % ligne(s) re-chiffrée(s)', v_count;

  -- À partir de la Task 4b.1 : professional_submission_private, même forme (clé de ligne submission_id).
end;
$$;

select * from private.pii_key_versions_in_use() order by 1, 2;
```

**Relancer sans risque.** Le bloc peut être exécuté autant de fois qu'il le faut, même interrompu ou en même temps que l'app :
- il ne prend que les lignes qui ne sont pas encore en version 2 : une fois tout re-chiffré, il ne touche plus **aucune** ligne (rien n'est réécrit, aucune ligne d'historique) ;
- chaque ligne se déchiffre avec **sa** version, lue dans la même instruction : une ligne enregistrée entre-temps par l'app (déjà en version 2) est au pire re-chiffrée en version 2, jamais abîmée ;
- il refuse de tourner (exception, rien d'écrit) si la version d'écriture n'est pas celle visée : par exemple avant l'étape 3, ou avec un `v_target` mal tapé ;
- une exécution qui échoue est annulée en entier : rien n'est à moitié re-chiffré. Une seule valeur illisible (`ERROR: Wrong key or corrupt data`) fait échouer chaque exécution : voir [« Une valeur illisible »](#une-valeur-illisible).

À savoir :
- Chaque ligne re-chiffrée écrit une ligne d'historique (`source = 'runbook:pii-key-rotation'`) : la valeur chiffrée y est masquée (« [redacted] »), `key_version` passe de 1 à 2.
- La date « Modifié le » des coordonnées bancaires prend la date de la rotation.

### 5. Vérifier

1. L'inventaire (« Avant de commencer », point 4) ne montre plus que la version 2.
2. `select public.pii_health_check();` → `true`.
3. Dans l'app : Paramètres → Coordonnées bancaires → « Afficher » montre le bon numéro (et, après la Task 4a.17, le compte d'un professionnel).

### 6. Garder l'ancienne version un temps

- **Le secret Vault `pii_encryption_key`** (version 1) et son témoin restent jusqu'à ce que chaque valeur soit en version 2 (étape 5) et qu'aucun retour en arrière ne soit plus envisagé (quelques jours d'usage normal). Les sauvegardes ne l'imposent pas : une restauration dans le **même** projet (sauvegarde quotidienne ou PITR) ramène sa propre copie de Vault, avec les secrets tels qu'ils étaient au moment de la sauvegarde, version 1 comprise.
- **L'entrée « (staging) » du gestionnaire de mots de passe** (version 1), elle, reste tant qu'une sauvegarde, un export ou une archive pris avant la fin de l'étape 4 existe : restaurer ces données dans un **nouveau** projet exigera la version 1 depuis le gestionnaire ([copie](pii-key-escrow.md#cas-b--nouveau-projet-restauration-vers-un-nouveau-projet-production-sinistre)). La marquer comme retirée, avec la date, sans la supprimer avant.

### 7. Retirer l'ancienne version

La seule suppression de clé prévue. **Un seul bloc**, à exécuter tel quel : il vérifie tout avant de supprimer quoi que ce soit, et la moindre vérification ratée annule le bloc en entier (rien n'est supprimé).

```sql
do $$
declare
  v_old constant integer := 1;   -- la version à retirer
  -- version 1 : pii_encryption_key (sans suffixe) ; version n ≥ 2 : pii_encryption_key_v<n>
  v_name constant text := case when v_old = 1 then 'pii_encryption_key' else 'pii_encryption_key_v' || v_old end;
  v_deleted integer;
begin
  if v_old = private.pii_current_key_version() then
    raise exception 'La version % est la version d''écriture : rien n''est retiré.', v_old;
  end if;
  if exists (select 1 from private.pii_key_versions_in_use() u where u.key_version = v_old) then
    raise exception 'Des valeurs sont encore chiffrées avec la version % (étape 4) : rien n''est retiré.', v_old;
  end if;
  if not public.pii_health_check() then
    raise exception 'pii_health_check() est déjà faux : rien n''est retiré.';
  end if;

  delete from private.pii_canary where key_version = v_old;
  if not public.pii_health_check() then
    raise exception 'pii_health_check() serait faux sans le témoin de la version % : rien n''est retiré.', v_old;
  end if;

  delete from vault.secrets where name = v_name;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'Secret % introuvable : rien n''est retiré.', v_name;
  end if;
  if not public.pii_health_check() then
    raise exception 'pii_health_check() serait faux sans le secret % : rien n''est retiré.', v_name;
  end if;
  raise notice 'Version % retirée (témoin et secret %).', v_old, v_name;
end;
$$;

select public.pii_health_check();   -- true
```
Une erreur (« … rien n'est retiré ») : lire le message, corriger (souvent : finir l'étape 4), relancer le bloc. Les fonctions à un argument (`encrypt_pii(text)`, `decrypt_pii(bytea)`) sont la version 1 : elles cessent de fonctionner ici. Le code n'utilise que les formes versionnées (conventions §8) ; le coordinateur le confirme avant l'étape 7. Pour l'entrée du gestionnaire, voir l'étape 6.

## Revenir en arrière (avant l'étape 7)

1. Retirer le témoin de la version 2 : les écritures reviennent à la version 1.
   ```sql
   delete from private.pii_canary where key_version = 2;
   ```
   Dès ce moment, `pii_health_check()` est **faux** (la version 2 chiffre encore des données mais n'a plus de témoin) : c'est attendu, et le job quotidien serait rouge. Faire le point 2 tout de suite.
2. Re-chiffrer vers la version 1 les lignes déjà en version 2 : le bloc de l'étape 4 avec `v_target constant integer := 1`, relancé jusqu'à ce que l'inventaire ne montre plus que la version 1.
3. `select public.pii_health_check();` → `true`. Le secret `pii_encryption_key_v2` peut rester (sans témoin, il ne sert à rien). Pour le supprimer, une fois l'inventaire entièrement en version 1 : le bloc de l'étape 7 avec `v_old constant integer := 2` (il refuse tant qu'une valeur est chiffrée en version 2). Garder son entrée du gestionnaire comme à l'étape 6.

## Une valeur illisible

Une valeur chiffrée qui ne se déchiffre pas avec la clé de sa version : typiquement une **copie de données de production sur staging** (voulue illisible, [copie](pii-key-escrow.md#staging-et-production--deux-clés-différentes-exprès)), ou une clé remplacée après l'écriture des données. Symptômes :
- `pii_health_check()` est faux, avec l'avertissement `a value of <table>.<colonne> stored with key version N does not decrypt (SQLSTATE 39000)` ;
- le bloc de l'étape 4 échoue à chaque exécution (`Wrong key or corrupt data`, rien n'est re-chiffré) ;
- dans l'app, enregistrer les coordonnées bancaires **sans retaper le numéro de compte** échoue avec « Le numéro de compte enregistré ne peut pas être lu avec la clé de cet environnement. » (le compte gardé doit être re-chiffré, donc lu) ; « Afficher » échoue aussi.

**Trouver les lignes en cause**, dans le SQL Editor. Le bloc n'affiche aucune valeur : la table, la colonne, la clé de ligne (un identifiant), la version et le SQLSTATE.
```sql
do $$
declare
  r record;
  v_bad integer := 0;
begin
  for r in select e.table_name, e.column_name, e.row_key, e.key_version, e.ciphertext
             from private.pii_encrypted_values() e order by 1, 3, 2 loop
    begin
      perform private.decrypt_pii(r.ciphertext, r.key_version);
    exception when others then
      v_bad := v_bad + 1;
      raise notice '%.% ligne % : illisible avec la version % (SQLSTATE %)', r.table_name, r.column_name, r.row_key, r.key_version, sqlstate;
    end;
  end loop;
  raise notice '% valeur(s) illisible(s)', v_bad;
end;
$$;
```
La clé de ligne est la colonne du tableau « Tables chiffrées » (`org_id`, `professional_id`, `submission_id`).

**Que faire :**
- **Sur staging** (copie de production, données de test) : ces valeurs sont perdues pour staging, c'est voulu. Supprimer la ligne, puis ressaisir des **valeurs de test** dans l'app. Pour les coordonnées bancaires de la clinique : `delete from public.organization_bank_details where org_id = '<clé de ligne>';` (une ligne d'historique est écrite), ou simplement retaper un numéro de compte complet dans Paramètres → Coordonnées bancaires (un nouveau numéro remplace l'ancien sans le lire). Pour les autres tables, la même suppression avec leur clé de ligne. Puis relancer le bloc ci-dessus (`0 valeur(s) illisible(s)`) et `select public.pii_health_check();` → `true`. **Ne jamais copier la clé de production dans staging** pour « réparer ».
- **Sur la production : s'arrêter.** Ne rien supprimer, ne pas continuer la rotation, ne pas toucher aux secrets. Noter la sortie du bloc (sans valeur) et appeler le coordinateur : c'est le cas « La vérification échoue » du [runbook de copie](pii-key-escrow.md#la-vérification-échoue), points 4 et 5 (la bonne clé est peut-être dans le gestionnaire de mots de passe).

## Après la rotation

Dire au coordinateur « rotation PII vers la version 2 faite le <date> sur <environnement> » (aucune valeur) ; il l'inscrit dans l'état du projet.
