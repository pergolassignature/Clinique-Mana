# Runbook — Rotation de la clé PII

**Statut :** procédure prête, jamais exécutée sur un environnement distant. Le chemin complet (nouvelle clé, témoin, re-chiffrement, retrait de l'ancienne version) est rejoué par le test pgTAP `047_core_pii_key_versions`. · **Écrit :** 2026-10-08 (Phase 4, Task 4a.16) · **ADR :** [0004, « Before Phase 4 »](../adr/0004-secrets-in-vault.md#before-phase-4-sin) · **Conventions :** [§8, « Key versions »](../standards/database-conventions.md#8-secrets-and-sensitive-data) · **Voir aussi :** [copie de sécurité de la clé](pii-key-escrow.md)

> Seul le propriétaire (Jonathan ou Christine) fait une rotation, lui-même, dans le SQL Editor du projet. **Un agent ne l'exécute jamais.** Aucune valeur de clé n'est tapée ni affichée ici : la nouvelle clé est générée dans la base, puis copiée dans le gestionnaire de mots de passe avec le [runbook de copie](pii-key-escrow.md).

## Quand

- La clé a pu être exposée (affichée ou copiée hors du gestionnaire de mots de passe, export égaré).
- Une personne qui avait accès à la copie quitte la clinique.
- Pas de rotation de routine décidée à ce jour.

## Principe

- **Versions :** la version 1 est le secret Vault `pii_encryption_key` ; la version n ≥ 2 est `pii_encryption_key_v<n>`. Chaque ligne chiffrée garde la version avec laquelle elle a été écrite (`key_version`).
- **Écriture :** les nouvelles valeurs sont chiffrées avec la version la plus haute qui a un **témoin** dans `private.pii_canary` (`private.pii_current_key_version()`). Ajouter le témoin d'une nouvelle clé est donc le geste qui fait basculer les écritures vers elle.
- **Lecture :** chaque ligne se déchiffre avec sa propre version. Les deux clés coexistent le temps du re-chiffrement.
- **Vérification :** `public.pii_health_check()` doit rester `true` à chaque étape ; le job de déploiement la relance à chaque fusion.

Les étapes ci-dessous passent de la version 1 à la version 2. Pour une rotation suivante, remplacer 1 par la version courante et 2 par la suivante.

**Tables chiffrées** (à tenir à jour : toute nouvelle table chiffrée s'ajoute ici et à la requête d'inventaire, conventions §8) :

| Table | Colonnes chiffrées | Clé de ligne |
|---|---|---|
| `public.organization_bank_details` | `account_number` | `org_id` |
| `public.professional_private` (à partir de la Task 4a.17) | `sin`, `bank_account` | `professional_id` |

## Avant de commencer

1. La copie de la version courante est à jour dans le gestionnaire (empreinte vérifiée, [copie](pii-key-escrow.md#copier-la-clé-export), étapes 5 et 6).
2. Une sauvegarde récente existe (Tableau de bord → Database → Backups).
3. `select public.pii_health_check();` → `true`.
4. Inventaire des versions en usage :
   ```sql
   select 'organization_bank_details' as table_name, key_version, count(*)
     from public.organization_bank_details
    group by key_version
   -- à partir de la Task 4a.17 :
   -- union all
   -- select 'professional_private', key_version, count(*) from public.professional_private group by key_version
    order by 1, 2;
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
insert into private.pii_canary (key_version, ciphertext)
values (2, private.encrypt_pii('mana-pii-canary', 2));

select private.pii_current_key_version();   -- 2
select public.pii_health_check();           -- true
```

### 4. Re-chiffrer les lignes existantes, par lots

Chaque exécution traite au plus 500 lignes, dans sa propre transaction (le SQL Editor exécute le bloc d'un seul tenant). **Relancer le bloc jusqu'à ce que l'`update` touche 0 ligne.** Pas de fonction : une fonction ferait tous les lots dans une seule transaction.

`organization_bank_details` :
```sql
select set_config('app.audit_source', 'runbook:pii-key-rotation', true);
update public.organization_bank_details b
   set account_number = private.encrypt_pii(private.decrypt_pii(b.account_number, b.key_version), 2),
       key_version = 2
 where b.org_id in (select x.org_id from public.organization_bank_details x
                     where x.key_version < 2 order by x.org_id limit 500);
```

`professional_private` (à partir de la Task 4a.17 ; une valeur absente reste absente) :
```sql
select set_config('app.audit_source', 'runbook:pii-key-rotation', true);
update public.professional_private p
   set sin = private.encrypt_pii(private.decrypt_pii(p.sin, p.key_version), 2),
       bank_account = private.encrypt_pii(private.decrypt_pii(p.bank_account, p.key_version), 2),
       key_version = 2
 where p.professional_id in (select x.professional_id from public.professional_private x
                              where x.key_version < 2 order by x.professional_id limit 500);
```

À savoir :
- Chaque ligne se déchiffre avec **sa** version : le bloc reste juste si quelqu'un enregistre en même temps (la ligne, déjà en version 2, est simplement re-chiffrée en version 2).
- Chaque ligne re-chiffrée écrit une ligne d'historique (`source = 'runbook:pii-key-rotation'`) : la valeur chiffrée y est masquée (« [redacted] »), `key_version` passe de 1 à 2.
- La date « Modifié le » des coordonnées bancaires prend la date de la rotation.

### 5. Vérifier

1. L'inventaire (« Avant de commencer », point 4) ne montre plus que la version 2.
2. `select public.pii_health_check();` → `true`.
3. Dans l'app : Paramètres → Coordonnées bancaires → « Afficher » montre le bon numéro (et, après la Task 4a.17, le compte d'un professionnel).

### 6. Garder l'ancienne version

Garder `pii_encryption_key` (version 1), son témoin **et** sa copie dans le gestionnaire jusqu'à ce que les deux conditions soient vraies :
- chaque ligne est en version 2 (étape 5) ;
- les sauvegardes prises avant la fin de l'étape 4 ont expiré : la plus ancienne sauvegarde de Database → Backups (et de la restauration à un instant donné, si elle est active) est postérieure à la fin de l'étape 4. Restaurer une sauvegarde plus ancienne exige la version 1.

### 7. Retirer l'ancienne version

La seule suppression de clé prévue. D'abord le témoin, puis le secret, en vérifiant après chaque geste :
```sql
-- Rien ne doit rester en version 1 (inventaire) :
select count(*) from public.organization_bank_details where key_version = 1;   -- 0
-- à partir de la Task 4a.17 : select count(*) from public.professional_private where key_version = 1;   -- 0

delete from private.pii_canary where key_version = 1;
select public.pii_health_check();   -- true

delete from vault.secrets where name = 'pii_encryption_key';
select public.pii_health_check();   -- true
```
Les fonctions à un argument (`encrypt_pii(text)`, `decrypt_pii(bytea)`) sont la version 1 : elles cessent de fonctionner ici. Le code n'utilise que les formes versionnées (conventions §8) ; le coordinateur le confirme avant l'étape 7. Marquer l'entrée « (staging) » du gestionnaire comme retirée, avec la date, sans la supprimer tant qu'une archive ou un export antérieur peut contenir des données de version 1.

## Revenir en arrière (avant l'étape 7)

1. Retirer le témoin de la version 2 : les écritures reviennent à la version 1.
   ```sql
   delete from private.pii_canary where key_version = 2;
   ```
2. Re-chiffrer vers la version 1 les lignes déjà en version 2 : les blocs de l'étape 4 avec `2` remplacé par `1` dans `encrypt_pii(…, 1)` et `key_version = 1`, et la condition `x.key_version <> 1`.
3. `select public.pii_health_check();` → `true`. Le secret `pii_encryption_key_v2` peut rester (sans témoin, il ne sert à rien) ; ne le supprimer qu'une fois l'inventaire entièrement en version 1.

## Après la rotation

Dire au coordinateur « rotation PII vers la version 2 faite le <date> sur <environnement> » (aucune valeur) ; il l'inscrit dans l'état du projet.
