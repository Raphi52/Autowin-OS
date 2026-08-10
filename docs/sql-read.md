# `sql_query` — consulter les bases greffes RIG en lecture seule

> Document de référence pour relire ou faire évoluer cette capacité. Il dit aussi ce qui **n'est pas**
> garanti : c'est la partie la plus utile.

## Pourquoi elle existe

À qui lui demandait de consulter `CODE_EVENEMENT_RCS`, l'agent répondait « je n'ai aucun accès SQL ».
C'était exact. Or le paramétrage des greffes est réparti sur ~40 bases, une par greffe : une question
du type « ce code a-t-il le même synonyme partout ? » exige de les balayer. Sans accès, l'agent ne peut
ni constater, ni contredire une hypothèse métier — il ne peut que demander à l'humain de coller le
résultat.

## La contrainte qui domine toute la conception

La connexion se fait en authentification Windows intégrée (`sqlcmd -E`), donc avec le compte de
l'utilisateur. Mesuré sur `RIG_AMIENS` :

```
IS_SRVROLEMEMBER('sysadmin') = 0    IS_MEMBER('db_owner')      = 0
IS_MEMBER('db_datawriter')   = 1    DELETE = 1    UPDATE = 1
```

**Le compte peut écrire dans les bases de PRODUCTION des greffes.** La protection ne peut donc pas
venir des droits SQL : elle est entièrement logicielle. C'est le point à relire en priorité.

## Les quatre couches

| #   | Couche                | Rôle                                                                |
| --- | --------------------- | ------------------------------------------------------------------- |
| 1   | `sql-read-catalog.ts` | la cible doit être un greffe **exploité** selon l'autorité métier   |
| 2   | `sql-read-guard.ts`   | un seul `SELECT`, rien qui écrive, rien qui sorte de la base ciblée |
| 3   | `sql-read-command.ts` | enveloppe `BEGIN TRANSACTION` … `ROLLBACK` inconditionnel           |
| 4   | `sqlcmd-runner.ts`    | bornes de lignes, de verrous, de délai, de taille de sortie         |

Aucune ne suffit seule, et on ne compte jamais sur les suivantes pour rattraper une requête qui
n'aurait pas dû passer : une écriture annulée a quand même pris des verrous sur une base vivante.

## Le périmètre : l'autorité est en base, pas dans le code

```sql
SELECT GRF_NOMBASE_BD, GRF_SERVEUR_BD FROM COMMUN_RIG.dbo.GREFFE WHERE GRF_IS_EXPLOIT = 1
```

Mesuré le 2026-08-07 : **40 greffes exploités sur 4 serveurs**, pour 274 lignes au total.

La version initiale définissait le périmètre par un motif de nom (`^RIG_…`) plus une liste de serveurs
codée en dur. Elle était **fausse dans les deux sens** :

- **trop large** — le préfixe ne dit rien de l'exploitation. Il ouvrait une maquette, une copie figée
  d'avant changement de structure, des bases de service tarif, de formation et de recette. Aucune
  heuristique de nom ne pouvait trancher : `RIG_LE_PUY_MARTIN` ressemble à un greffe et n'en est pas un ;
- **trop étroite** — la liste omettait `RIGBD-POLYNESIE`, qui héberge `RIG_PAPEETE`, greffe **vivant**,
  donc injoignable par erreur.

S'y ajoutent deux cibles de développement énumérées **en clair** dans le code (`RIG_DEV` et
`RIG_RECETTE` sur `SQL-DEV\DEV`) : elles sont `GRF_IS_EXPLOIT = 0`, ce qui est normal, et on préfère les
nommer plutôt qu'affaiblir le critère pour les faire entrer. D'autres bases existent sur ce serveur
(`RIG_REFERENCE`, `RIG_GAP_CERTIF`) : elles ne sont pas ouvertes faute d'avoir été demandées.

⚠️ **`COMMUN_RIG.dbo.GREFFE` contient des secrets** — `GRF_PWD_BD`, `GRF_INFOGREFFE_PASSWORD`,
`GRF_DOCVERIF_PASSWORD`, `GRF_WS_IDNUM_CLEF_API`. Deux règles en découlent, chacune couverte par un
test : la requête du catalogue est **fixe** et ne lit que deux colonnes (jamais `SELECT *`), et
`COMMUN_RIG` **n'est pas dans le catalogue**, donc l'agent ne peut pas la lire lui-même.

**Autorité injoignable = défaut fermé et visible.** Le catalogue est marqué `degraded`, ne contient
aucune base de production, et le message de refus le dit. Il n'est alors pas mis en cache, pour qu'une
panne passagère ne prive pas l'agent de la production une demi-heure.

## L'encodage de sortie de `sqlcmd` — mesuré, contre-intuitif

Le chemin de sortie détermine l'encodage. Mesuré au dump hexadécimal le 2026-08-07 :

| Chemin                        | Encodage réel                                          |
| ----------------------------- | ------------------------------------------------------ |
| pipe (stdout)                 | **CP850** (codepage OEM console) : `é` = `0x82`        |
| pipe + `-f 65001` ou `-u`     | inchangé — l'option ne vise que les fichiers           |
| `-o fichier`                  | CP1252                                                 |
| `-o fichier` + `-u`           | UTF-16LE + BOM                                         |
| **`-o fichier` + `-f 65001`** | **UTF-8 + BOM** — le seul chemin explicitement Unicode |

Lu en UTF-8, le pipe rendait **un `U+FFFD` par accent, dans un JSON parfaitement valide** :
« Adjonction d'activité » arrivait corrompu à l'agent sans aucune trace. D'où la sortie par fichier
temporaire, supprimée sur tous les chemins de sortie.

Un raisonnement d'audit avait affirmé le contraire (« sqlcmd écrit de l'UTF-8 sur un pipe ») et un
correctif avait été appliqué sur cette base. **Seul le dump hexadécimal a tranché.** À retenir avant de
« simplifier » ce module.

## Historique d'audit — quatre rounds adversariaux

| Round | Note   | Contournement trouvé                          | Mécanisme                                                                |
| ----- | ------ | --------------------------------------------- | ------------------------------------------------------------------------ |
| 1     | 8/100  | `SELECT 1 AS [x'a] ; COMMIT ; DELETE … ; --'` | la garde ignorait les identifiants `[…]`                                 |
| 2     | 15/100 | `SELECT 1` ⏎ `GO` ⏎ `commit` ⏎ `delete[T]`    | `GO` sépare les instructions **sans** `;`                                |
| 3     | 22/100 | `… OR [z` ⏎ `GO` ⏎ `delete T` ⏎ `]=1`         | un `GO` **dans** un crochet : invisible pour la garde, actif pour sqlcmd |
| 4     | 82/100 | _aucun en écriture_                           | mais deux fuites de confidentialité (voir plus bas)                      |

Chacun des trois premiers aboutissait à un `DELETE` **permanent**. Aucun n'a été exécuté : le panel
avait consigne de rapporter, jamais de tirer.

Ce que ces rounds ont enseigné, et qui ne doit pas être perdu :

- le `COMMIT` injecté referme l'enveloppe → l'écriture devient définitive. Les couches 2 et 3 tombent
  **ensemble** : « garde lexicale compensée par le rollback » n'était pas de la défense en profondeur ;
- le correctif du round 1 a lui-même introduit une régression — remplacer `[…]` par `x` collait le jeton
  au voisin, donc `delete[T]` devenait `deletex` et échappait à la frontière de mot ;
- **T-SQL juxtapose les instructions sans séparateur** : `SELECT 1 AS a SELECT 2 AS b` en exécute deux.
  La garantie « une seule instruction » ne repose donc ni sur le `;` ni sur `GO`, mais entièrement sur la
  liste de mots-clés ;
- `QUOTED_IDENTIFIER` est **OFF** sous `sqlcmd -Q` (mesuré) alors que la garde traite `"…"` comme un
  identifiant : la sécurité tenait par accident, sur une prémisse fausse. D'où le `SET` dans l'enveloppe ;
- au round 4, `syscacheobjects` rendait **55 948 plans de requêtes d'autres bases avec leurs littéraux**
  — du contenu applicatif d'autres greffes — et `sysperfinfo` énumérait les 334 bases du serveur. Cause :
  les DMV étaient interdites, **pas leurs équivalents de compatibilité**, résolubles sans qualification.

## Ce qui n'est PAS garanti

- **La garde reste LEXICALE.** Le round 4 n'a rien trouvé en écriture, ce qui est une vraie amélioration,
  mais ne prouve pas qu'il n'y a plus rien.
- **La seule garantie hors modèle serait un login SQL réellement en lecture seule** (`db_datareader`
  uniquement) au lieu de `-E`. Avec un tel compte, franchir la garde ne suffirait plus à écrire. Cela
  demande une action DBA — **non fait à ce jour**.
- **Synonymes et vues cross-base** : la garde ne peut pas voir la cible d'un synonyme. Vérifié négatif
  sur 18 bases RIG (0 synonyme, 0 vue cross-base), donc théorique aujourd'hui — mais non défendu.
- **`OBJECT_NAME`/`OBJECT_ID` restent autorisées.** Leur forme à deux arguments peut nommer un objet
  d'une autre base : fuite de NOMS d'objets, sans accès aux données. Compromis retenu sciemment pour
  garder l'exploration des métadonnées utilisable.
- **Le résultat touche brièvement le disque** (fichier temporaire de l'utilisateur, supprimé sur tous
  les chemins de sortie).

## Vérification

`npx vitest run src/main/sql-read src/main/sqlcmd` — 94 tests. Les preuves en conditions réelles vivent
dans `scripts/preuve-*.mts` et `scripts/verif-audit*.mts` (non suivis par git) : elles interrogent les
vrais serveurs, y compris le tour complet agent → commande → base depuis une conversation.
