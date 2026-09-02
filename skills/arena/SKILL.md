---
name: arena
description: >-
  Prend UNE tâche et cherche le MEILLEUR WORKFLOW pour la faire — en le mesurant, pas en l'estimant.
  Trois temps : (1) SCOUT lecture seule de candidats de workflow qui amélioreraient le RENDEMENT de
  cette tâche (le chemin demande → livrable accepté : moins de tours, moins de $, moins de minutes,
  zéro reprise), ancré sur la sonde `npm run scout:rendement` et sur les journaux
  `.autowin-data/<profil>/activity/conv-N.jsonl` ; (2) EXPÉRIENCE A/B/C/X — la MÊME tâche exécutée par
  QUATRE bras LANCÉS EN PARALLÈLE dans un SEUL message, chacun dans sa copie de travail isolée :
  A = workflow actuel (témoin, obligatoire), B et C = les deux meilleurs candidats scoutés,
  X = variante qui CASSE une prémisse (chemin court, phase sautée, outil différent) ; (3) JUGE externe
  et adversarial qui compare les quatre livrables sur la MÊME grille (qualité d'abord, puis $ et
  minutes lus dans les journaux, jamais estimés) et rend UN workflow gagnant avec sa preuve, puis
  l'installe au point qui le déclenche. Déclencher sur `/arena <tâche>`, « quel est le meilleur
  workflow pour X », « teste plusieurs façons de faire X », « A/B teste cette tâche »,
  « optimise la manière dont on fait X ». N'UTILISE PAS pour : exécuter simplement la tâche (→ `build`),
  analyser le corpus passé sans rien exécuter (→ `rendement`), auditer un livrable unique (→ `judge`),
  chercher quoi faire sur une codebase (→ `scout`). Ici le livrable est un WORKFLOW GAGNANT PROUVÉ,
  et la tâche n'est que le banc d'essai — mais son meilleur résultat est livré pour de vrai.
---

# arena — trouver le meilleur workflow d'une tâche par expérience A/B/C/X

Tu es l'**ORCHESTRATEUR**. Tu ne juges pas toi-même et tu n'exécutes pas les bras à la main : tu
prépares le banc, tu lances les quatre bras EN PARALLÈLE, tu fais juger de l'extérieur, tu installes
le gagnant.

## Ce que la skill produit
Deux artefacts, jamais un seul :
1. **Le meilleur livrable de la tâche** — celui du bras gagnant, livré pour de vrai (l'expérience ne
   doit pas coûter la tâche).
2. **Le workflow gagnant**, écrit en réflexe (« au moment où X → fais Y »), posé à l'endroit qui le
   déclenche vraiment (consigne de phase, règle de routage, garde-fou, skill), + un `remember`
   `type: lesson` avec les chiffres mesurés.

## Invariant — l'expérience ne prouve rien si elle n'est pas comparable
- **Même tâche, même énoncé, mêmes entrées** pour les quatre bras. Un bras qui reformule la tâche
  invalide la comparaison : le noter INVALIDE, ne pas le classer.
- **A est le témoin obligatoire** : le workflow ACTUEL, inchangé. Sans témoin, on attribue au nouveau
  workflow ce qui n'est que la facilité de la tâche.
- **Isolement** : chaque bras travaille dans SA copie de travail (worktree / dossier séparé). Deux
  bras qui écrivent le même fichier = résultat non attribuable.
- **Les chiffres se LISENT** (`activity/conv-N.jsonl` : `costUsd`, `durationMs`, tours ;
  `npm run scout:rendement --json` pour la base de comparaison). Un chiffre estimé se marque
  « non mesuré » — il ne se met pas dans le tableau comme s'il était mesuré.

## Procédure

### 1. Cadrer le banc (1 message, pas de sous-agent)
- Reformuler la tâche en **critère de succès vérifiable** (le test, la commande, la capture qui dira
  « livré »). Sans lui, il n'y a pas de gagnant possible → le fabriquer, ne pas le demander.
- Fixer le **régime** : jetable ≤2 bras · standard = 4 bras (A/B/C/X) · critique = 4 bras + 2 tours
  de juge. Par défaut : standard.
- **Baseline** : coût et durée observés des tâches comparables (sonde rendement + journaux). Si rien
  de comparable n'existe, le dire : le bras A FERA la baseline.

### 2. SCOUT des candidats de workflow (lecture seule, en parallèle)
Chercher **6 à 10 candidats**, chacun étant une manière DIFFÉRENTE de mener la tâche, pas une idée
d'amélioration du code. Familles à balayer (au moins 4) :
- **routage** — quelle phase joue, dans quel ordre ; phases sautées ou fusionnées ;
- **profondeur** — lecture directe + édition ciblée vs pipeline complet (surdimensionnement) ;
- **parallélisme** — 1 agent vs fan-out, et sur quel découpage ;
- **contexte** — ce qu'on injecte d'abord (`brain_query`, `conversation_search`, graphify) pour ne
  pas refaire du déjà-fait ;
- **preuve** — quelle vérification, à quel moment (cible vs suite entière) ;
- **prémisse cassée** — et si on ne faisait PAS l'étape que tout le monde fait ?

Chaque candidat porte : `hypothèse mesurable` (ce qui devrait baisser : tours / $ / minutes /
reprises) · `coût prévu` · `risque`. Classer par (gain attendu ÷ risque). **Garder 2** pour B et C,
et **1 casse-prémisse** pour X — X n'est jamais le 3e meilleur du classement, c'est le plus
DIFFÉRENT, sinon les quatre bras testent la même idée.

### 3. EXPÉRIENCE A/B/C/X — les quatre bras dans UN SEUL message
Lancer les quatre en même temps (un sous-agent par bras). Chaque bras reçoit, mot pour mot :
- l'énoncé de la tâche (identique), le critère de succès, sa copie de travail,
- **son workflow imposé** (A : actuel · B, C : candidats scoutés · X : casse-prémisse),
- l'obligation de rendre : le livrable, la preuve du critère (exit code / test / capture), la liste
  ordonnée de ce qu'il a fait, et **ce qui a échoué en route**.

Bras qui échoue = **résultat**, pas incident : il reste dans le tableau avec sa cause. Ne jamais
relancer un bras « pour lui donner sa chance » — ce serait le favoriser.
Après les retours : **vérifier les artefacts réels**, pas les rapports (réflexe 3), et relever les
chiffres dans les journaux.

### 4. JUGE — externe, adversarial, une seule grille
Passer la main à `judge` avec les quatre livrables ANONYMISÉS (bras A/B/C/X, sans dire lequel est le
témoin ni lequel est « l'idée neuve »). Grille, dans cet ordre — un bras qui rate la première
dimension ne peut PAS gagner sur les suivantes :
1. **Le critère de succès est-il atteint, avec preuve ?** (oui/non, jamais « presque »)
2. **Qualité du livrable** (défauts avec preuve, rustines, dette laissée)
3. **Coût $ mesuré**
4. **Durée / tours mesurés**
5. **Reproductibilité** — le workflow marche-t-il hors de cette tâche, ou a-t-il gagné par chance ?

Le juge rend : **un gagnant nommé**, l'écart chiffré au témoin A, et les défauts renvoyés au
producteur. Égalité ou écart dans le bruit → dire « pas de gagnant », garder A. **Un workflow n'est
pas déclaré meilleur parce qu'il est moins cher : moins cher ET au moins aussi bon, sinon il perd.**

### 5. Installer et retenir
- Livrer le meilleur livrable pour de vrai ; jeter les copies de travail perdantes.
- Écrire le workflow gagnant à son point de déclenchement, en une règle-réflexe.
- `remember` (`type: lesson`) : la tâche, le gagnant, Δ$ et Δminutes contre A, la source
  `session:<id>` ou `git:<chemin>@<sha>`.
- Une règle installée sans avoir rejoué la situation d'origine est **non vérifiée** : le dire.

## Sortie (format imposé)

**Banc** : tâche · critère de succès · baseline (ou « aucune, A la fabrique »).

| bras | workflow | critère atteint | $ mesuré | min | tours | défauts | verdict |
|---|---|---|---|---|---|---|---|
| A (témoin) | … | … | … | … | … | … | … |
| B | … | … | … | … | … | … | … |
| C | … | … | … | … | … | … | … |
| X (casse-prémisse) | … | … | … | … | … | … | … |

**Gagnant** : bras + workflow en une phrase · **Δ contre A** : $ et minutes · **Preuve** : l'artefact
et le journal cités · **Installé où** : le fichier/point de déclenchement · **Limite** : ce qui reste
non prouvé (une seule tâche testée = un seul point de mesure).

## Pièges qui tuent l'expérience
- **Pas de témoin** → aucun écart interprétable.
- **Bras lancés l'un après l'autre** → le second profite du travail du premier ; ils doivent partir
  ensemble, dans un seul message.
- **X mou** (une variante de B) → l'expérience ne teste que trois fois la même idée.
- **Chiffres estimés** présentés comme mesurés → faux vert.
- **Le producteur se juge** → le classement se fait par `judge` externe, jamais par toi.
- **Gagnant généralisé sur une seule tâche** → l'annoncer comme une piste mesurée, pas comme une loi.
