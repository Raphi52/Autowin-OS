---
name: salvage
description: >-
  Retrouve et récupère le travail échoué n'importe où dans un dépôt git — modifications non
  commitées, remises de côté, copies de travail détachées, commits orphelins, branches non
  fusionnées, objets pendants du reflog — puis décide pour chacun s'il faut le fusionner, le jeter
  ou le laisser, exécute sans rien perdre, et finit par PUBLIER ce qui a été récupéré en laissant un
  arbre de travail PROPRE. Juge chaque candidat par son CONTENU, jamais par son message : le constat
  le plus fréquent est un travail DÉJÀ intégré autrement. À utiliser quand un dépôt a accumulé du
  travail de côté au fil des sessions ou des agents, quand un outil signale « du travail non publié
  », ou sur « did I lose work? », « what is still not merged? » (§ Quand la déclencher). NE PAS
  utiliser pour relire la qualité d'un code, résoudre un conflit de fusion en cours, ni restaurer un
  fichier depuis un commit connu.
---

# salvage — retrouver le travail échoué, puis le fusionner ou le jeter, sans rien perdre

## À quoi ça sert

**Presque rien de ce qu'un dépôt git a commité n'est vraiment perdu — mais beaucoup est invisible.** Du travail
s'échoue dans des endroits qu'aucune commande de routine ne montre : une copie de travail détachée, une remise de côté que personne
n'a reprise, une branche jamais fusionnée, un objet dont seul le reflog se souvient. Cette skill balaie toutes les cachettes, décide pour
chaque élément, et exécute — avec la discipline qui rend la décision fiable : **juger par le contenu,
prouver avant de supprimer, et ne jamais mesurer un candidat contre un arbre que tu as déjà contaminé
avec lui.**

Le résultat le plus fréquent n'est pas un sauvetage. C'est de découvrir que le travail est **déjà là**, écrit
autrement. Traiter un doublon comme une perte réintroduit du vieux code par-dessus du neuf ; traiter une perte comme
un doublon jette du travail. Les distinguer, c'est tout le métier.

## Quand la déclencher — et quand NON
**Déclencheurs** : un dépôt qui a accumulé du travail de côté au fil des sessions, des agents ou des copies de travail · un outil qui signale « du travail non publié » · avant une grosse fusion, une migration, un ménage de branches ou un passage de machine · après un rebase interrompu, un run d'agent planté, ou une remise de côté à laquelle tu ne fais plus confiance · « did I lose work? » · « what is still not merged? » · « clean up my stashes / branches / worktrees ».
**PAS pour** : relire la qualité d'un code · résoudre un conflit de fusion dans lequel tu es déjà · restaurer un fichier depuis un seul commit connu — c'est un `git checkout`, pas un balayage.

## Procédure

### 1. BALAYER — énumérer toutes les cachettes

Lance-les toutes. Chacune trouve du travail que les autres ne peuvent pas voir. Consigne chaque trouvaille avec son SHA.

```bash
git status --porcelain                  # non commité, INDEXÉ compris (un fichier indexé bloque les fusions)
git status --porcelain --ignored        # vrai travail caché par .gitignore (configs, fixtures locales)
git stash list                          # remises de côté — et voir le piège du stash dans « À ne pas faire »
git worktree list --porcelain           # copies de travail liées : sha de HEAD + état détaché/branche
git branch --no-merged HEAD             # branches locales portant des commits non fusionnés
git branch -r --no-merged origin/HEAD   # idem, côté distant
git log --oneline --all --not --remotes # commits sur aucun distant : non poussés, donc seulement ici
git fsck --no-reflog --lost-found       # commits/blobs pendants : stashes jetés, rebases tués
git reflog --date=iso                   # ce que HEAD a fait récemment : resets durs, opérations avortées
```

**Les copies de travail détachées sont l'angle mort.** Une copie posée sur un HEAD détaché porte des commits que
**`git for-each-ref` ne listera JAMAIS** — ils n'appartiennent à aucune branche. Seul un balayage de répertoires croisé
avec un contrôle d'atteignabilité les trouve :

```bash
# substr, pas $2 : les chemins de copies de travail contiennent des espaces bien plus souvent qu'on ne croit.
git worktree list --porcelain |
  awk '/^worktree /{p=substr($0,10)} /^HEAD /{print substr($0,6) "\t" p}' |
while IFS=$'\t' read -r sha path; do
  # deja contenu par une ref -> pas orphelin
  git for-each-ref --contains "$sha" --count=1 --format='%(refname)' | grep -q . && continue
  # apporte un patch que la base n'a pas deja
  git cherry HEAD "$sha" | grep -q '^+' && echo "ORPHELIN $sha $path"
done
```

Les deux filtres tirent en sens inverse, et les deux sont nécessaires. `for-each-ref --contains` écarte les
commits qu'une branche détient déjà. `git cherry` compare par **patch-id**, donc il reste silencieux sur un travail
déjà réappliqué sous un autre SHA — un cherry-pick, une réapplication manuelle. Enlève le premier et le
balayage hurle sur chaque base périmée ; enlève le second et il cache du vrai travail.

**Racines propres aux outils.** Les lanceurs d'agents, les éditeurs et l'intégration continue gardent souvent des copies de travail privées ou des branches de sauvegarde
dans leur propre espace de noms. Liste ce qui n'est pas une ref normale, et inspecte tout répertoire qu'un tel outil possède
à côté du dépôt :

```bash
git for-each-ref --format='%(refname)' | grep -vE '^refs/(heads|tags|remotes)/'
```

**Demande à l'utilisateur quels outils écrivent dans ce dépôt.** Tu ne peux pas le deviner, et toute une classe de travail
échoué vit exactement là.

### 2. TRIER — est-ce vraiment manquant ? (avant toute décision)

Pour chaque candidat, réponds à une seule question : **son contenu existe-t-il dans l'arbre aujourd'hui ?** Ne réponds jamais
depuis son message — une remise de côté intitulée « WIP dark mode » peut porter du travail livré il y a des semaines.

1. **Compare ses fichiers à l'arbre de travail**, un par un :
   `git show <sha>:<path> | diff - <path>`. Identiques → déjà intégré.
2. **Cherche la FONCTIONNALITÉ, pas le diff.** La même intention est couramment réimplémentée autrement :
   une table de correspondance là où le candidat utilisait des conditions imbriquées, un hook là où il utilisait une classe. Grep
   les identifiants, les chaînes de caractères, le comportement. Un diff textuel les déclare « manquants » alors qu'ils sont
   présents — **la fausse alerte la plus fréquente de toute cette procédure.**
3. **Localise sa base** : `git merge-base <sha> HEAD`, puis
   `git diff --stat $(git merge-base <sha> HEAD) HEAD -- <paths>`. Une base qui a beaucoup bougé ne rend pas le
   travail périmé — elle rend une restauration au niveau du fichier **destructrice**.
4. **Vérifie aussi le distant.** Du travail peut être absent localement et déjà poussé : compare contre
   `origin/main`, pas seulement contre `HEAD`.

Classe chacun : **DOUBLON** (contenu présent, éventuellement réécrit) · **UNIQUE** (vraiment absent) ·
**DÉPASSÉ** (une version évoluée de la même intention est présente) · **INCONNU** (dis-le, ne devine pas).

### 3. DÉCIDER — élément par élément, le goût appartenant à l'humain

| Verdict | Action |
|---|---|
| DOUBLON | Jette le porteur. Rien à fusionner — et nomme le code existant qui le couvre. |
| DÉPASSÉ | En général, on jette. Si l'ancienne version porte quelque chose que la nouvelle n'a pas (un test, un cas limite, une constante nommée), greffe **cette partie seulement**. |
| UNIQUE | Fusionne — étape 4. |
| INCONNU | Laisse intact. Un élément non tranché n'est jamais un candidat à la suppression. |
| Intentions en conflit | **Remonte à l'humain.** |

**Les intentions en conflit** sont le cas qui coûte le plus cher quand on le traite en silence : l'arbre et le candidat
résolvent le même problème différemment. Garde la meilleure **structure** — constantes nommées, réglages séparés,
tests — et laisse l'humain choisir les **valeurs**, surtout tout ce qui est visuel, tonal ou
réglé pour la performance. Si honorer son choix t'oblige à desserrer une assertion que le candidat portait,
comprends ce que cette assertion encodait : une borne sur le goût de quelqu'un n'est pas une propriété de correction, mais
**la desserrer en silence est indiscernable d'une triche**. Dis-le, et écris la raison là où vit
l'assertion.

### 4. RÉCUPÉRER — appliquer sans écraser

- **Fusionne par patch, jamais par restauration de fichier.** `git cherry-pick <sha>`, ou
  `git diff <base>..<sha> > /tmp/p.patch && git apply --3way /tmp/p.patch`.
  **Jamais `git checkout <ref> -- <file>`** quand la base a bougé : cela remplace tout le fichier et
  supprime en silence tout ce qui a été commité depuis.
- **Sur un arbre partagé ou sale**, travaille dans une copie de travail isolée — applique et commite là, puis fusionne.
  Un index partagé mélange ton changement avec tout ce qui est indexé par ailleurs, et le conflit d'un autre bloque
  ton commit. **Place cette copie HORS du dépôt** : `git worktree add ../<nom> <base>`, ou
  sous la racine de copies de travail de l'app, jamais un chemin relatif qui atterrit dans la copie courante.
  MESURÉ le 2026-09-09 : cette ligne disait `git worktree add <tmp> <base>` sans dire OÙ, et un
  run a résolu `<tmp>` en `.verif` à la racine du dépôt — une copie imbriquée de 200 Mo, non ignorée, qu'un
  simple `git add .` aurait commitée. Un chemin non contraint n'est pas un détail : un chemin relatif
  atterrit dans l'arbre que tu essayais justement de ne pas déranger. Retire la copie quand tu as fini
  (`git worktree remove --force <chemin>`), et ne laisse jamais derrière toi un porteur dont l'étape 5 n'a pas
  tenu compte.
- **Résous les conflits délibérément, et consigne pourquoi** : quel côté a gagné, et ce que le perdant apportait.
  Six mois plus tard, cette note est la seule trace de la décision.
- **Vérifie après avoir appliqué.** Une fusion à 3 points propre prouve que le texte a fusionné, jamais que le résultat est
  cohérent. Joue les tests que ce travail touche.

### 5. DISPOSER — une suppression exige un reçu

Avant de retirer le moindre porteur, **consigne son SHA** :

```bash
git stash list --format='%gd %H %s'   # capture les identifiants AVANT de jeter quoi que ce soit
git rev-parse refs/heads/<branch>
```

Les remises de côté jetées et les branches supprimées survivent dans la base d'objets jusqu'à ce qu'un `git gc` les élague :
`git stash apply <sha>` et `git branch <nom> <sha>` les ramènent. Consigner le SHA transforme un acte
irréversible en acte réversible, et coûte une ligne.

**Ne lance JAMAIS `git gc --prune=now`, `git reflog expire` ou `git worktree prune` pendant un salvage** —
ce sont précisément eux qui rendent ces objets irrécupérables. Obtiens un oui explicite avant de supprimer
quoi que ce soit que tu n'as pas créé.

### 6. LAISSER L'ARBRE PROPRE — un salvage qui finit sale bloque l'action suivante

**Un salvage n'est pas fini quand les verdicts sont écrits ; il est fini quand `git status
--porcelain` est vide.** Toute opération en aval refuse un arbre sale : tirer, rebaser,
changer de branche, et le bouton **« Mettre à jour »** de l'app, qui décline plutôt que de fusionner
par-dessus du travail non commité. Laisser derrière soi des fichiers de sonde, des patchs à moitié appliqués, un `.rej`, une copie de travail temporaire ou un index non repris
transforme un sauvetage réussi en dépôt coincé — l'utilisateur a appuyé sur salvage, puis n'a pas pu appuyer sur mettre à jour.

Boucle la boucle, dans cet ordre :

```bash
git status --porcelain             # DOIT etre vide a la fin — indexe compris
git status --porcelain --ignored   # tes propres fichiers de brouillon comptent aussi comme residu
git stash list                     # chaque remise que tu as creee est reprise ou explicitement gardee + notee
git worktree list --porcelain      # chaque copie temporaire que tu as ajoutee est retiree
git diff --name-only --diff-filter=U ; grep -rn '^<<<<<<< ' -- .   # zero marqueur de conflit
```

Règles de clôture :
- **Ce que tu as récupéré est commité.** Un patch appliqué et laissé non commité n'est pas sauvé, c'est un
  nouvel élément échoué — exactement l'état que cette skill existe pour supprimer.
- **Ce que tu as créé pour l'enquête est retiré** : patchs temporaires (`/tmp/p.patch`), fichiers de
  sonde, copies de travail isolées (`git worktree remove <tmp>` — jamais `git worktree prune`).
- **Ce qui était sale AVANT que tu commences reste exactement tel quel.** Note-le dans le rapport comme
  préexistant et intouché ; ne commite ni ne jette le travail en cours de quelqu'un d'autre pour atteindre un
  statut propre.
- **Si l'arbre ne peut pas être rendu propre** (élément non tranché, conflit que l'humain doit arbitrer), dis-le
  explicitement, nomme ce qui reste et pourquoi, et préviens que mettre à jour / tirer refusera tant que ce ne sera pas réglé.

### 7. PUBLIER — c'est le tri qui rend la publication sûre

**Un salvage qui reste local n'est pas fini.** Le tri existe pour que la publication puisse se faire sans
enterrer un travail qui vivait déjà ailleurs ; une fois que chaque candidat porte un verdict adossé à son contenu,
cette condition est remplie et la publication fait partie de CETTE passe — pas d'un prompt de suivi pour l'humain.

```bash
git log --oneline @{u}..HEAD        # ce que cette machine detient encore seule
git push                            # ou : git push -u origin HEAD pour une branche neuve
git rev-parse HEAD origin/<branch>  # les deux SHA egaux = publie, prouve, pas suppose
```

Ne publie que ce que le tri a couvert, et seulement après que les contrôles ciblés sont verts. Si un garde-fou refuse
(branche protégée, hook de pre-push), applique l'exception qu'il nomme et dis-le ; si la publication n'est vraiment
pas à toi de la faire — la branche de quelqu'un d'autre, un distant que tu ne possèdes pas —, dis-le plutôt que de laisser
le travail en local en silence. Ne termine jamais un salvage en demandant à l'humain de pousser : cette demande est exactement
la boucle que cette étape supprime (retour utilisateur, 2026-09-03 : « salvage doit push »).

### 8. RAPPORTER

Une ligne par élément : ce que c'est · où il vivait · le verdict **avec sa preuve** (quel fichier correspondait,
quel identifiant a été trouvé) · l'action menée · le SHA de récupération. Dis clairement ce que tu n'as pas pu classer.
Termine le rapport par le **`git status --porcelain` final** (vide, ou les lignes exactes qui restent et
pourquoi) — cette ligne est la preuve que le dépôt est de nouveau utilisable.

## À ne pas faire

- **Ne fais pas confiance au message.** Les étiquettes de remises de côté et de branches décrivent l'intention au moment de l'écriture, pas
  la réalité d'aujourd'hui. Compare les contenus.
- **Ne juge pas un candidat contre un arbre auquel tu l'as déjà appliqué.** Dès qu'une application, une reprise ou une
  fusion a touché l'arbre, chaque comparaison ultérieure mesure le candidat contre lui-même et
  conclut « déjà présent ». Restaure ou fige l'arbre d'abord, puis compare.
- **Ne lance pas un `git stash pop` nu.** Si ton propre `git stash push` n'avait rien à remiser — fichiers
  déjà propres ou commités —, **aucune entrée n'est créée**, et le `pop` nu retire la remise de *quelqu'un d'autre*
  du sommet, appliquant du travail sans rapport et laissant des marqueurs de conflit. Passe un
  `git stash apply <sha>` explicite, et confirme qu'un push a bien créé une entrée avant de t'y fier.
- **N'écarte pas un avertissement de git parce qu'il nomme un fichier auquel tu ne pensais pas.** « The stash
  entry is kept in case you need it again » veut dire que l'application a conflité. Vérifie tout l'arbre —
  `git status`, puis grep des marqueurs de conflit — pas seulement le fichier que tu avais en tête.
- **Ne restaure pas un fichier en bloc** quand sa base a divergé. Applique un patch.
- **Ne supprime pas sans SHA consigné**, et jamais le travail d'un autre auteur sans un oui clair.
- **Ne déclare pas le balayage complet** tant qu'un élément est INCONNU. Rapporte-le comme non tranché.
- **Ne t'arrête pas aux verdicts pour t'en aller.** Un sauvetage qui laisse l'arbre sale n'a fait que déplacer le
  problème : le prochain tirage, changement de branche ou « Mettre à jour » est refusé. Termine sur un
  `git status` vide.
- **Ne lis pas le silence d'un outil de rapport comme « rien d'échoué ».** Un rapporteur aveugle aux copies de travail
  détachées rapportera zéro pour toujours. Vérifie qu'il couvre les catégories de l'étape 1.

## Réflexes

- **Le constat par défaut est DOUBLON.** Les sessions et agents parallèles convergent sur les mêmes correctifs bien
  plus souvent qu'ils ne perdent du travail. Attends-toi à ça ; laisse la preuve le renverser.
- **La récupérabilité avant le jugement.** Rends tout réversible d'abord, décide ensuite. Une erreur
  que tu peux défaire est un désagrément ; une erreur que tu ne peux pas défaire est une perte.
- **Une application propre n'est pas une fusion correcte.** La fusion du texte et le sens n'ont aucun rapport.
- **Fini veut dire propre ET publié, pas décidé.** Un salvage se termine sur deux preuves : un `git status
  --porcelain` vide, et un `HEAD` égal à son amont — ou bien chaque ligne restante, et chaque
  commit non poussé, nommés et justifiés.
- **Le goût appartient à l'humain.** La structure, les tests et le nommage, tu peux les juger. Les couleurs, les seuils et les
  durées, non — remonte-les avec les chiffres côte à côte.
