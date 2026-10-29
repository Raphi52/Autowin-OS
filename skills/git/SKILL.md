---
name: git
description: >-
  `/git` sur un dépôt (« pousse tout », « commit push tout », « salvage push main origin ») : finit
  TOUT d'un coup — trie le travail non publié par son contenu, commite tout, pousse sur la branche
  principale OU ouvre la demande de fusion selon les habitudes de CELUI QUI LANCE pour CE dépôt
  (cible déduite, jamais redemandée), puis range branches vides, copies et remises de côté jusqu'à un
  dépôt propre, à jour, sans rien qui traîne. NE PAS utiliser pour : un tri sans rien publier
  (→ `salvage`), une mise à jour d'Autowin bloquée (→ `maj`), relire la qualité d'un code (→ `judge`).
---

# git — tout finir, tout publier, rien qui traîne

## À quoi ça sert

Publier un dépôt demandait de retaper la cible à chaque fois (« /salvage push main origin »,
« /salvage all origin main » : conv-896, 997, 1091, 1108), et même avec elle il restait du travail :
une question de plus pour supprimer les branches vides, des fichiers laissés aux fils en cours, une
suite « relance quand ils auront fini ».

`/git` fait tout cela en un mot, pour **n'importe quel utilisateur et n'importe quel dépôt** : rien
dans cette skill ne suppose un dépôt, un hébergeur ou une personne en particulier. **La cible se déduit** (`scripts/git-cible.mjs`), **le tri reprend
`salvage`** (étapes 1 à 4 de `skills/salvage/SKILL.md`, sans les recopier ici), et **`/git` vaut
accord** pour commiter, publier et supprimer les porteurs VIDES — chacun avec son SHA noté.

## Arguments (tous facultatifs)

| Tu écris | Effet |
|---|---|
| `/git` | Tout, avec la cible déduite. |
| `/git pr` · `/git push` | Force le mode pour cette passe. Ajoute « retiens » pour en faire l'habitude du dépôt. |
| `/git sur <branche>` · `/git <distant>` | Change la branche ou le distant visés. |
| `/git sauf <chemin>` | Laisse ce fichier hors du commit. |
| `/git <dossier> <dossier>` | Une passe complète par dépôt, l'une après l'autre. |

## Procédure

`<racine Autowin>` = deux dossiers au-dessus de celui de cette skill (l'installation d'Autowin) :
les scripts et le reçu y vivent, quel que soit le dépôt traité.

### 0. CIBLE — une commande, pas une question

```bash
node <racine Autowin>/scripts/git-cible.mjs --dossier <dépôt>
```

Le JSON rend `distant`, `branche`, `mode` (`push` · `pr` · `local` · `a-preciser`), `exceptionPush`,
`outilDemandeDeFusion` et la `raison`. Tout y est relatif à **la personne qui lance** : ses habitudes
sont rangées sur SON poste (`.autowin-data/autowin-os/git-habitudes.json`, hors git, jamais partagé),
et « ses » commits sont ceux de son identité git (à défaut, son nom de session). Ordre de décision :
habitude retenue pour ce dépôt, puis garde-fou de push du dépôt qui nomme lui-même son exception
(ex. `ALLOW_MAIN_PUSH=1`), puis part de SES commits sur la branche distante (≥ 80 % = son dépôt, push
direct ; sinon dépôt partagé, demande de fusion). Annonce-la en une ligne : « Cible : origin/main,
push direct — <raison> ».

- `source: auteurs` (simple déduction) → `brain_query` « publication <nom du dépôt> ». Ne compte que
  ce qui vaut pour CET utilisateur : une décision d'équipe sur ce dépôt (« pas de demande de fusion
  ici »), ou une note de son Brain perso (préfixe `perso:`). La préférence d'un AUTRE (« dépôt perso de
  X, push direct ») ne l'autorise jamais à pousser chez X. Une note qui s'applique gagne :
  `--retenir push|pr`, et dis-le.
- L'utilisateur corrige la cible → `--retenir` tout de suite, avec `--note` sur le pourquoi.
- `a-preciser` (plusieurs distants sans `origin`) → la seule question permise de la passe.
- Lis aussi l'`AGENTS.md` / `CLAUDE.md` du dépôt : format des messages de commit, contrôle à jouer
  avant de pousser, chemins à ne jamais publier, convention de nom de branche.

### 1. ÉTAT — tout voir avant de toucher

`git fetch --prune <distant>`, puis le balayage de `salvage` §1 (statut, remises de côté, copies,
branches non fusionnées, commits absents du distant, refs hors `heads/tags/remotes`).

Dans un dépôt où Autowin fait travailler des agents : `get_state.travauxNonPublies`, et chaque
fichier sale rattaché à son fil par `proprietaire_fichier`. `refs/autowin/{tour,safety,integration}/*`
sont des photos de l'app : ni à fusionner, ni à supprimer. `refs/autowin/salvage/*` et
`refs/salvage/*` portent du vrai travail. Les copies `agent__command-verify-*` sont des photos du
dossier principal prises par `verify` : leurs lignes absentes du distant sont en général des versions
dépassées — juge-les par contenu, et garde-en une trace (un ref) avant de les retirer.

### 2. TRIER — par contenu, jamais par message

`salvage` §2 à §4 : verdict DOUBLON · UNIQUE · DÉPASSÉ · INCONNU pour chaque porteur,
`node <racine Autowin>/scripts/salvage-resurrection.mjs <sha> --base <distant>/<branche>` avant tout
report, report par patch et jamais par restauration de fichier.

### 3. TOUT COMMITER — c'est la différence avec salvage

`salvage` laisse en place le travail sale d'avant ; `/git` le commite, car « tout » est ce que
l'utilisateur demande. Seules exceptions, chacune nommée dans le rapport :

- les fichiers d'un fil dont le tour **tourne encore** (à moitié écrits) → étape 7 ;
- les chemins de `sauf` ;
- un secret (`.env`, clé, jeton) : jamais commité, nommé ;
- tes propres brouillons d'enquête : supprimés, pas commités.

**Comment** : une copie séparée posée sur `<distant>/<branche>`, HORS du dépôt
(`git worktree add --detach ../<dépôt>-git-<conv> <distant>/<branche>`), avec une jonction vers
`node_modules` si les tests en ont besoin. Y poser les fichiers, **un commit par origine** (fil ou
sujet), au format de messages que le dépôt déclare (`AGENTS.md`, `CONTRIBUTING`, historique récent).

**Vérifier dans cette copie** : tests des fichiers touchés, typage s'il existe, contrôles déclarés par
le dépôt dans son `AGENTS.md` / `CLAUDE.md` ou ses hooks. Un rouge causé par un fichier
publié → corrige-le ou sors ce fichier (nommé). Un rouge déjà présent sur `<distant>/<branche>` → dis-le,
il ne bloque pas.

Mode `local` (aucun distant) : commit sur place, `git commit -- <chemins>`.

### 4. PUBLIER — selon la cible

- **push** : depuis la copie, `git push <distant> HEAD:<branche>`, préfixé de `exceptionPush` s'il
  existe (ex. `ALLOW_MAIN_PUSH=1 git push …`). Refusé parce que le distant a bougé → `git fetch`,
  `git rebase <distant>/<branche>` dans la copie, revérifier si l'arbre a changé, repousser.
  Preuve : après `git fetch`, `git rev-parse <distant>/<branche>` = le SHA poussé.
- **pr** : branche au nom imposé par le dépôt (numéro de fiche si l'`AGENTS.md` ou le Brain l'exigent),
  sinon `git/<sujet>` ; `git push -u <distant> <branche-pr>` ; puis `outilDemandeDeFusion`
  (`gh pr create --base <branche> …` ou `az repos pr create --target-branch <branche> …`). Sous
  Windows, `az` peut retirer les accents du titre : `brain_query` sur ce point avant d'écrire.
  **Ne fusionne jamais toi-même** une demande de fusion d'équipe. Preuve : l'adresse rendue.
- **local** : rien ne peut partir ; dis-le.

### 5. RÉALIGNER l'arbre principal

Finir sur `<branche>`, à jour avec le distant — jamais sur une branche de chantier.

- Aucun fichier sale sur les chemins publiés → `git switch <branche>` puis `git merge --ff-only <distant>/<branche>`.
- Sinon (cas courant : les fichiers publiés sont encore « modifiés », avec le même contenu) →
  `git update-ref refs/heads/<branche> <nouveau> <ancien>`, puis pour chaque chemin de
  `git diff --name-only <ancien> <nouveau>` : `git checkout <nouveau> -- <f>` SEULEMENT si
  `git hash-object <f>` vaut le blob de `<nouveau>` ou celui de `<ancien>` ; sinon on n'y touche pas
  (c'est le travail d'un autre). Méthode mesurée en conv-1045 : 134 fichiers sur 134 alignés.

### 6. RANGER — sans redemander, avec un reçu

**`/git` est l'accord** pour supprimer les porteurs VIDES (contenu déjà dans `<distant>/<branche>`,
par ancêtre ou par `git cherry` sans « + »). Avant toute suppression, écris le reçu
`<racine Autowin>/.autowin-data/autowin-os/git/recus-<AAAA-MM-JJ>-<conv>.txt` : une ligne
`<type> <nom> <sha>` par élément. `git branch <nom> <sha>` ou `git stash store <sha>` les ramène.

- Branches locales vides → `git branch -D`, seulement si elle pointe encore sur le SHA du reçu.
- Copies de travail sans modification et dont le HEAD est contenu → retire d'abord leur jonction
  `node_modules`, puis `git worktree remove`. La copie d'un run ou d'un fil **vivant** reste.
- Remises de côté dont le contenu est déjà publié → `git stash drop <sha vérifié>`, jamais un `pop` nu.
- Branches distantes : en mode **push** (dépôt perso), les tiennes déjà fusionnées →
  `git push <distant> --delete <b>`. En mode **pr**, ne touche qu'aux tiennes déjà fusionnées.
- Ta copie séparée et tes patchs temporaires : retirés.

Jamais : `git gc --prune`, `git reflog expire`, `git worktree prune`, `push --force`, ni un porteur
qui garde un patch unique ou un verdict INCONNU.

### 7. CE QUI NE PEUT PAS PARTIR MAINTENANT

- **Fil encore en cours** : ne commite pas son travail à moitié écrit. Pose une
  surveillance (`task_list` d'abord, puis `task_create` avec
  `"source": { "kind": "app-event", "events": ["chat-turn-done"], "conversationId": "<fil>" }`)
  qui renvoie `/git` dans CE fil à la fin de son tour. Le ménage se finit seul, sans relance de ta part.
- **Intentions en conflit ou verdict INCONNU** : une seule `ask`, à la toute fin, quand tout le reste
  est déjà fait.

### 8. PREUVE DE FIN

Un tableau, une ligne par élément : ce que c'est · verdict et preuve · action · SHA. Puis ces quatre
lignes, relevées et non supposées :

```bash
git status --porcelain              # vide, ou chaque ligne restante avec son fil et sa surveillance
git rev-parse HEAD <distant>/<branche>   # égaux (push) — ou l'adresse de la demande de fusion (pr)
git branch                          # <branche> seule, plus les branches de fils vivants, nommées
git stash list ; git worktree list  # vide ; arbre principal + copies de runs vivants
```

## À ne pas faire

- **Ne redemande ni la cible ni l'accord du ménage des porteurs vides** : `/git` est cet accord.
  La seule question permise porte sur un contenu unique en conflit, ou sur `a-preciser`.
- Ne commite ni un secret, ni le travail d'un fil qui tourne encore.
- Ne fusionne pas toi-même une demande de fusion d'équipe.
- Pas de `push --force`, `reset --hard`, `checkout --` sur le travail d'un autre, `stash pop` nu.
- Ne finis pas sur une branche de chantier, ni avec un `main` local en retard sur le distant.
- Ne déclare pas « poussé » sans le SHA distant relu après `git fetch`.
