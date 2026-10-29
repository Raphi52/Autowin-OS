---
name: git
description: >-
  `/git` sur un dépôt (« pousse tout », « commit push tout », « du travail non publié », « ai-je
  perdu du travail ? », « qu'est-ce qui n'est pas fusionné ? ») : finit TOUT d'un coup — balaie
  toutes les cachettes (modifications, remises de côté, copies détachées, branches non fusionnées,
  objets pendants), trie chaque porteur par son CONTENU, commite tout, pousse sur la branche
  principale OU ouvre la demande de fusion selon les habitudes de CELUI QUI LANCE pour CE dépôt
  (cible déduite, jamais redemandée), puis range branches vides, copies et remises de côté jusqu'à un
  dépôt propre, à jour, sans rien qui traîne. `/git tri` : le tri seul, rien de publié. NE PAS
  utiliser pour : une mise à jour d'Autowin bloquée (→ `maj`), relire la qualité d'un code
  (→ `judge`), un conflit de fusion déjà en cours, restaurer un fichier depuis un commit connu.
---

# git — tout finir, tout publier, rien qui traîne

## À quoi ça sert

Publier un dépôt demandait de retaper la cible à chaque fois (« /salvage push main origin »,
« /salvage all origin main » : conv-896, 997, 1091, 1108), et même avec elle il restait du travail :
une question de plus pour supprimer les branches vides, des fichiers laissés aux fils en cours, une
suite « relance quand ils auront fini ».

`/git` fait tout cela en un mot, pour **n'importe quel utilisateur et n'importe quel dépôt** : rien
dans cette skill ne suppose un dépôt, un hébergeur ou une personne en particulier. **La cible se déduit** (`scripts/git-cible.mjs`), **le tri
juge chaque porteur par son CONTENU** (étapes 1 et 2), et **`/git` vaut accord** pour commiter,
publier et supprimer les porteurs VIDES — chacun avec son SHA noté.

Le constat le plus fréquent n'est pas un sauvetage : c'est un travail **déjà là**, écrit autrement.
Traiter un doublon comme une perte réintroduit du vieux code par-dessus du neuf ; traiter une perte
comme un doublon jette du travail. Les distinguer, c'est tout le métier du tri.

## Arguments (tous facultatifs)

| Tu écris | Effet |
|---|---|
| `/git` | Tout, avec la cible déduite. |
| `/git tri` | Étapes 1 et 2 seulement : balayage, verdicts, rapport. Rien n'est commité, publié ni supprimé. |
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

### 1. ÉTAT — balayer TOUTES les cachettes avant de toucher

`git fetch --prune <distant>`, puis toutes ces commandes : chacune trouve du travail que les autres
ne voient pas. Consigne chaque trouvaille avec son SHA.

```bash
git status --porcelain                  # non commité, INDEXÉ compris
git status --porcelain --ignored        # vrai travail caché par .gitignore (configs, fixtures locales)
git stash list --format='%gd %H %s'     # remises de côté, SHA compris
git worktree list --porcelain           # copies liées : HEAD + état détaché/branche
git branch --no-merged <distant>/<branche>
git log --oneline --all --not --remotes # commits sur aucun distant : ils n'existent qu'ici
git fsck --no-reflog --lost-found       # commits pendants : remises jetées, rebases tués
git reflog --date=iso                   # resets durs, opérations avortées
git for-each-ref --format='%(refname)' | grep -vE '^refs/(heads|tags|remotes)/'
```

**Les copies détachées sont l'angle mort** : leurs commits n'appartiennent à aucune branche, et
`git for-each-ref` ne les listera jamais. Croise les copies avec l'atteignabilité :

```bash
# substr, pas $2 : les chemins de copies contiennent souvent des espaces.
git worktree list --porcelain |
  awk '/^worktree /{p=substr($0,10)} /^HEAD /{print substr($0,6) "\t" p}' |
while IFS=$'\t' read -r sha path; do
  git for-each-ref --contains "$sha" --count=1 --format='%(refname)' | grep -q . && continue
  git cherry <distant>/<branche> "$sha" | grep -q '^+' && echo "ORPHELIN $sha $path"
done
```

Les deux filtres sont nécessaires : `for-each-ref --contains` écarte ce qu'une branche détient déjà,
`git cherry` (par patch-id) écarte ce qui a été réappliqué sous un autre SHA.

Dans un dépôt où Autowin fait travailler des agents : `get_state.travauxNonPublies`, et chaque
fichier sale rattaché à son fil par `proprietaire_fichier`. `refs/autowin/{tour,safety,integration}/*`
sont des photos de l'app : ni à fusionner, ni à supprimer. `refs/autowin/salvage/*` et
`refs/salvage/*` portent du vrai travail. Les copies `agent__command-verify-*` sont des photos du
dossier principal prises par `verify` : leurs lignes absentes du distant sont en général des versions
dépassées — juge-les par contenu, et garde-en une trace (un ref) avant de les retirer. Dans un autre
dépôt, demande quels outils y écrivent : leurs copies et refs privées sont une cachette de plus.

### 2. TRIER — par contenu, jamais par message

Pour chaque porteur, une seule question : **son contenu existe-t-il déjà ?** Jamais depuis son
message — une remise « WIP dark mode » peut porter du travail livré il y a des semaines.

1. Compare ses fichiers à l'arbre : `git show <sha>:<chemin> | diff - <chemin>`. Identiques → intégré.
2. **Cherche la FONCTIONNALITÉ, pas le diff** : la même intention est souvent réécrite autrement.
   Grep les identifiants, les chaînes, le comportement — un diff textuel dit « manquant » à tort,
   c'est la fausse alerte la plus fréquente.
3. Localise sa base : `git merge-base <sha> HEAD`, puis
   `git diff --stat $(git merge-base <sha> HEAD) HEAD -- <chemins>`. Une base qui a beaucoup bougé
   rend une restauration de fichier **destructrice**.
4. Compare aussi contre `<distant>/<branche>`, pas seulement `HEAD`.

Verdict, avec sa preuve :

| Verdict | Action |
|---|---|
| **DOUBLON** (contenu présent, même réécrit) | Porteur vide : étape 6. Nomme le code qui le couvre. |
| **DÉPASSÉ** (une version évoluée est présente) | Vide aussi — sauf la partie que la nouvelle n'a pas (un test, un cas limite) : reporte **cette partie seulement**. |
| **UNIQUE** (vraiment absent) | Reporte-le (ci-dessous), puis il part avec l'étape 3. |
| **INCONNU** | Laisse intact, nomme-le. Jamais supprimé. |
| **Intentions en conflit** | Garde la meilleure structure (constantes nommées, tests) ; les VALEURS (couleurs, seuils, durées) reviennent à l'humain — étape 7. |

**Reporter sans écraser** :

- **Avant chaque report**, `node <racine Autowin>/scripts/salvage-resurrection.mjs <sha> --base <distant>/<branche>`.
  Code **1** : le candidat remet ce que la base a annulé → isole ses vraies modifications récentes.
  Code **3** : il touche des fichiers d'une annulation récente → ouvre chaque annulation citée et
  écris ta décision. Seul **0** autorise un report sans relecture. Mesuré : un tri a reporté une
  copie qui remettait les onglets retirés deux jours plus tôt par un revert ; `git cherry` ne pouvait
  pas le voir.
- **Par patch, jamais par restauration de fichier** : `git cherry-pick <sha>` ou
  `git diff <base>..<sha> > <tmp>.patch && git apply --3way <tmp>.patch`. Jamais
  `git checkout <ref> -- <fichier>` quand la base a bougé : tout ce qui a été commité depuis disparaît.
- Un conflit se tranche délibérément, et la note dit quel côté a gagné et ce que le perdant apportait.
- Une fusion propre prouve que le texte a fusionné, pas que le résultat tient : les tests de l'étape 3
  le prouvent.

`/git tri` s'arrête ici : rapport de l'étape 8, sans commit, publication ni suppression.

### 3. TOUT COMMITER

Le travail sale d'avant se commite aussi, car « tout » est ce que l'utilisateur demande. Seules
exceptions, chacune nommée dans le rapport :

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

- **Ne fais pas confiance au message** d'une branche ou d'une remise : compare les contenus.
- **Ne juge pas un porteur contre un arbre auquel tu l'as déjà appliqué** : chaque comparaison
  suivante le mesure contre lui-même et conclut « déjà présent ». Fige l'arbre d'abord.
- N'écarte pas un avertissement de git qui nomme un autre fichier (« The stash entry is kept in case
  you need it again » = l'application a conflité) : `git status` et grep des marqueurs de conflit.
- Ne lis pas le silence d'un outil de rapport comme « rien d'échoué » : un rapporteur aveugle aux
  copies détachées dira zéro pour toujours.
- **Ne redemande ni la cible ni l'accord du ménage des porteurs vides** : `/git` est cet accord.
  La seule question permise porte sur un contenu unique en conflit, ou sur `a-preciser`.
- Ne commite ni un secret, ni le travail d'un fil qui tourne encore.
- Ne fusionne pas toi-même une demande de fusion d'équipe.
- Pas de `push --force`, `reset --hard`, `checkout --` sur le travail d'un autre, `stash pop` nu.
- Ne finis pas sur une branche de chantier, ni avec un `main` local en retard sur le distant.
- Ne déclare pas « poussé » sans le SHA distant relu après `git fetch`.
