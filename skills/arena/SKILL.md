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
  X = variante qui CASSE une prémisse (chemin court, phase sautée, outil différent) ; AU MOINS UN bras
  (B ou C) ne diffère QUE par le TEXTE d'une skill utilisée par la tâche — même tâche, même modèle,
  formulation réécrite —, et X est TOUJOURS l'APPEL NU : la même tâche sans aucune skill, sans
  pipeline, sans consigne de phase, pour prouver que l'outillage vaut mieux que rien ; (3) JUGE externe
  et adversarial qui compare les quatre livrables sur la MÊME grille des QUATRE dimensions — qualité
  d'abord, puis coût $, temps, et efficacité (tours et appels d'outils dépensés pour atteindre le
  critère) —, tous lus dans les journaux et jamais estimés, et rend UN workflow gagnant avec sa
  preuve, puis l'installe au point qui le déclenche. Déclencher sur `/arena <tâche>`,
  `/arena /<skill> <cible>` (ex. `/arena /heal autowin os` : c'est alors la SKILL nommée qui est au
  banc, A = son texte actuel), « quel est le meilleur
  workflow pour X », « teste plusieurs façons de faire X », « A/B teste cette tâche »,
  « optimise la manière dont on fait X », « teste des formulations de cette skill ». N'UTILISE PAS pour : exécuter simplement la tâche (→ `build`),
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

## Les QUATRE dimensions mesurées (aucune n'est optionnelle)
Tout banc rend, pour CHAQUE bras, ces quatre-là — dans cet ordre de priorité :
1. **QUALITÉ** — critère de succès atteint avec preuve, puis défauts / rustines / dette laissée. Un
   bras qui rate le critère ne gagne pas, même à 0 $.
2. **COÛT** — `$` LU dans `out-<bras>.json` (`total_cost_usd`), jamais estimé.
3. **TEMPS** — minutes LUES dans `activity/conv-N.jsonl` (`durationMs`), du départ au livrable.
4. **EFFICACITÉ (rendement)** — le chemin : nombre de tours, nombre d'appels d'outils, reprises et
   relances. C'est ce qui distingue deux bras au même prix : `$ ÷ critère atteint` et
   `tours ÷ critère atteint`. Un bras qui atteint le critère en 3 tours bat un bras qui l'atteint en
   9 à coût égal, et un bras qui n'y arrive pas a un rendement NUL, pas « bon marché ».

Une dimension non mesurable se marque `non mesuré` dans le tableau — jamais laissée vide, jamais
remplie d'une estimation.

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
- **`/arena <CIBLE>` sans défaut nommé (un fichier, un widget, un écran) → la tâche se FABRIQUE, elle
  ne se demande pas.** Au moment où l'énoncé ne porte qu'une cible : lire la cible et ses tests
  (lecture seule), en tirer LE défaut le plus mesurable — celui qu'un test peut constater rouge —,
  l'annoncer en UNE ligne comme hypothèse (« je prends X comme tâche du banc — corrige-moi »), puis
  CONTINUER. Rendre la main pour réclamer une cible est un ÉCHEC de la skill : l'utilisateur a déjà
  donné ce qu'il avait. `ask` n'est légitime que si la lecture ne produit AUCUN défaut testable, et
  alors la question propose deux défauts TROUVÉS, jamais « dis-moi lequel ».
- **`/arena /<skill> <cible>` — la tâche EST une invocation de skill : c'est alors la SKILL qui est
  au banc, pas le code.** Au moment où l'énoncé du banc commence par un slash (`/arena /heal autowin
  os`, `/arena /judge ce livrable`) : la skill nommée devient le WORKFLOW testé, la cible reste son
  entrée identique pour les quatre bras, et les bras se répartissent ainsi — **A** = la skill telle
  qu'elle est écrite aujourd'hui, intacte · **B** et **C** = deux variantes de SON texte ou de son
  routage issues du tri de l'étape 2 · **X** = casse-prémisse (faire la cible SANS la skill, ou en
  sautant l'étape que la skill impose). Le banc devient un banc de formulation → l'étape 2 bis
  s'applique en entier. Le critère de succès porte alors sur ce que la skill PROMET, transformé en
  vérification exécutable sur la sortie du bras (`check.mjs` qui ouvre `out-<bras>.json` et le RUN du
  bras : sections obligatoires présentes, chiffres présents et non estimés, cause localisée en
  `file:line`, aucune dimension laissée vide) — pas sur l'impression de qualité du texte rendu. Ne
  demande JAMAIS de reformuler l'énoncé dans ce cas : `/arena /heal autowin os` est un banc complet.
- Reformuler la tâche en **critère de succès vérifiable** (le test, la commande, la capture qui dira
  « livré »). Sans lui, il n'y a pas de gagnant possible → le fabriquer, ne pas le demander.
- **CRITÈRE CONSTATÉ ROUGE AVANT LE LANCEMENT — sinon le banc est REFUSÉ.** Le critère s'EXÉCUTE sur
  le dépôt intact et sa sortie ROUGE est collée dans le RUN.md (commande + code de sortie ≠ 0 +
  assertions en échec). Un critère qui passe déjà au vert ne mesure rien : les quatre bras
  « réussissent » sans avoir rien fait. Si le rouge ne s'obtient pas → **ARRÊT**, on le dit, on ne
  lance aucun bras. Cas particuliers : critère déjà vert = la tâche est faite → arrêt et signalement
  (pas de banc) ; critère qu'on ne peut pas exécuter avant (capture d'écran, jugement à l'œil) = pas
  un critère → en fabriquer un exécutable, ou déclarer le banc impossible.
- **LE CRITÈRE DOIT COUVRIR LES CAS LIMITES — sinon le banc est REFUSÉ.** Au moins **3 assertions**,
  dont au moins **1 cas nominal** et au moins **2 cas limites** pris hors du chemin heureux : entrée
  invalide ou absurde · limite vide / zéro résultat · borne (premier, dernier, égalité) · erreur
  attendue qui DOIT être refusée · **preuve fictive** — le bras cite-t-il une commande, un fichier ou
  un chiffre qui n'existe pas ? Cette dernière famille est la plus souvent oubliée et la plus
  discriminante quand le livrable est un RAPPORT : au banc `clean`, les six assertions ne regardaient
  que l'état final des fichiers, donc 4 bras sur 4 passaient ; l'assertion ajoutée le 2026-09-06
  (« aucune commande du rapport ne porte sur un fichier inexistant ») a fait tomber 2 bras sur 4 —
  ceux qui invoquaient un `scripts/fingerprint.py` absent du dépôt. **Elle ne se réécrit pas : un banc
  à livrable-rapport l'IMPORTE** —
  `import { assertionPreuveFictive } from 'scripts/arena-critere-preuve-fictive.mjs'` dans son
  `check.mjs`, ou `npm run arena:preuve-fictive -- <rapport.md> <racine>` en ligne de commande. Chaque assertion s'écrit dans le RUN.md avec ce qu'elle interdit.
  Un critère qui ne teste que le chemin heureux ne départage personne : au banc du 2026-09-02, les
  **4 bras sur 4** l'ont passé et ont tous raté les MÊMES cas limites (dates absurdes acceptées,
  fenêtre vide) — c'est le critère qui a échoué, pas les bras, et le classement s'est joué sur une
  impression de qualité au lieu d'une mesure.
- **Contrôle de discrimination, après coup** : si les 4 bras passent le critère, le banc est déclaré
  **NON DISCRIMINANT** dans la sortie. Le gagnant devient une piste, jamais une mesure.
- **AU MOMENT où le banc sort 4/4 → écrire la section `## Critère durci` dans le RUN.md, avant de
  clore.** Elle nomme l'assertion PRÉCISE à ajouter pour la reprise et ce qu'elle interdit — pas
  « il faudrait durcir ». Sans elle le banc est déclaré non tenu (point P18 du contrôle). Motif : aux
  bancs du 2026-09-02 et du 2026-09-05 (`clean`), les 4 bras sont passés, le RUN.md l'a dit
  honnêtement… et le tournoi s'est quand même clos sur un gagnant choisi à l'impression, sans que
  rien n'existe pour rejouer. Une déclaration d'échec de mesure qui ne laisse aucun artefact de
  reprise n'est pas un constat : c'est un abandon.
- **COMPOSITION IMPOSÉE DES BRAS — vraie pour TOUT banc, pas seulement pour `/arena /<skill>`.**
  Quelle que soit la tâche, les quatre bras se répartissent ainsi :
  **A** = le workflow actuel, textes de skills intacts (témoin) ·
  **B** = obligatoirement une **VARIANTE DE TEXTE** d'une skill réellement utilisée par la tâche
  (voir 2 bis) ·
  **C** = le meilleur candidat non-texte du tri (routage, profondeur, parallélisme, contexte, preuve) ·
  **X** = obligatoirement l'**APPEL NU**.
  Un banc dont B n'est pas une variante de texte, ou dont X n'est pas l'appel nu, est REFUSÉ : c'est
  ce couple qui fait progresser le contenu des skills à chaque `/arena` et qui prouve que ce contenu
  sert à quelque chose.
- **QUELLE SKILL METTRE AU BANC EN B**, quand la tâche n'en nomme aucune : prendre celle qui PORTE le
  plus de décisions dans la tâche (la skill de la phase jouée, ou la consigne de routage qui la
  déclenche), et le DIRE en une ligne. Aucune skill impliquée du tout → le banc de texte porte alors
  sur la CONSIGNE de phase employée ; s'il n'y en a pas non plus, écrire `B non-texte, motif : aucun
  texte pilote la tâche` dans le RUN.md — c'est la SEULE dispense, elle se justifie, elle ne se
  suppose pas.
- **L'APPEL NU (X), défini précisément** : la tâche est confiée à un agent qui reçoit UNIQUEMENT
  l'énoncé et le critère de succès — aucune skill chargée, aucune consigne de phase, aucun pipeline,
  aucun rappel de constitution au-delà du socle du modèle. C'est le PLANCHER de la mesure : si X
  gagne, l'outillage testé COÛTE plus qu'il ne rapporte sur cette tâche, et c'est le résultat le plus
  important du banc — il s'écrit en tête de la sortie, jamais enterré dans le tableau.
- Fixer le **régime** : jetable ≤2 bras · standard = 4 bras (A/B/C/X) · critique = 4 bras + 2 tours
  de juge. Par défaut : standard.
- **Baseline** : coût et durée observés des tâches comparables (sonde rendement + journaux). Si rien
  de comparable n'existe, le dire : le bras A FERA la baseline.

### 2. SCOUT des candidats de workflow (lecture seule, en parallèle)
**D'ABORD : lire les duels DÉJÀ mesurés — un banc ne repart pas de zéro.**

```
npm run arena:duel -- lire --limite 30
```

Le journal `.autowin-data/<profil>/arena-duels.jsonl` porte une ligne par bras des bancs passés
(tâche, workflow, durée, coût, verdict). Un workflow qui y est déjà `perdant` sur une tâche voisine
ne se re-teste pas comme s'il était neuf : soit on l'écarte en citant sa ligne, soit on dit
explicitement ce qui change cette fois. Un workflow déjà `gagnant` devient un candidat B/C fort. Si
le journal est vide, le dire — c'est un premier banc, pas une absence de mesure.

Chercher **6 à 10 candidats**, chacun étant une manière DIFFÉRENTE de mener la tâche, pas une idée
d'amélioration du code. Familles à balayer (au moins 4) :
- **routage** — quelle phase joue, dans quel ordre ; phases sautées ou fusionnées ;
- **profondeur** — lecture directe + édition ciblée vs pipeline complet (surdimensionnement) ;
- **parallélisme** — 1 agent vs fan-out, et sur quel découpage ;
- **contexte** — ce qu'on injecte d'abord (`brain_query`, `conversation_search`, graphify) pour ne
  pas refaire du déjà-fait ;
- **preuve** — quelle vérification, à quel moment (cible vs suite entière) ;
- **prémisse cassée** — et si on ne faisait PAS l'étape que tout le monde fait ?
- **formulation** — le MÊME workflow, mais le TEXTE de la skill / de la consigne réécrit : ordre des
  étapes, règle remontée en tête, réflexe « au moment où X → fais Y » contre prose explicative,
  version courte contre version longue, interdiction en négatif contre critère en positif, exemple
  concret ajouté ou retiré. Famille la moins chère à tester et la plus souvent oubliée : le texte est
  ce qui DÉCLENCHE le comportement, donc c'est un facteur mesurable comme un autre.

La famille **formulation** n'est PAS optionnelle : le scout doit produire au moins **3 variantes de
texte** distinctes de la skill mise au banc, pour que B soit un choix trié et non la seule idée venue.

Chaque candidat porte : `hypothèse mesurable` (ce qui devrait baisser : tours / $ / minutes /
reprises) · `coût prévu` · `risque`. Classer par (gain attendu ÷ risque). **B est le meilleur
candidat de la famille formulation** ; **C est le meilleur candidat des autres familles** ; **X n'est
pas tiré du classement du tout** — c'est l'appel nu, fixé d'avance. Un classement qui place deux
candidats non-texte en B et C est un tri à refaire.

**TRACE ÉCRITE OBLIGATOIRE — avant de choisir B, C et X.** Le classement des 6 à 10 candidats
s'ÉCRIT SUR DISQUE dans le RUN.md du banc, section `## Candidats scoutés`, sous forme de tableau :
`candidat | famille | hypothèse mesurable | coût prévu | risque | score (gain ÷ risque) | retenu ?`.
Les lignes retenues portent explicitement `B`, `C` ou `X`. Ce fichier est écrit AVANT le message qui
lance les bras — pas reconstitué après coup, pas résumé dans la réponse au lieu du fichier.
Pas de section `## Candidats scoutés` sur disque → le lancement des bras est REFUSÉ : sans elle, B et
C ne sont pas des candidats triés mais deux idées improvisées, et l'expérience ne mesure plus rien.
Écrire les quatre workflows d'un seul jet sans passer par ce tableau est le défaut CONSTATÉ au run du
2026-09-02 (relevé par le juge) : c'est l'étape de tri qui disparaît, pas une formalité de rédaction.

### 2 bis. Banc de FORMULATION — quand les bras diffèrent par le TEXTE
B étant TOUJOURS une variante de formulation (voir étape 1), ces règles s'appliquent à **tout** banc,
et pas seulement quand la cible est une skill :
- **UN SEUL facteur bouge** : le texte. Même tâche, même critère, même modèle, même régime, même
  découpage. Un bras qui change le texte ET le routage ne dit plus lequel des deux a agi → INVALIDE.
- **A garde le texte ACTUEL, intact.** Chaque autre bras reçoit sa copie du fichier de skill réécrite
  DANS SA propre copie de travail — jamais d'édition du fichier partagé pendant le banc.
- **La variante s'écrit sur disque** : `variantes/<bras>.diff` (ou le fichier réécrit en entier) dans
  le dossier du banc. Le RUN.md porte une section `## Variantes de texte` avec, par bras : le fichier
  visé, le levier changé (ordre · mise en tête · réflexe · longueur · négatif→positif · exemple) et
  l'hypothèse de COMPORTEMENT attendue.
- **Ce qui est mesuré est le COMPORTEMENT, pas le style** : le bras a-t-il fait le geste que la
  formulation visait (vérifier avant de conclure, refuser la rustine, poser la question) ? Le juge le
  lit dans les traces du bras. « Ce texte est mieux écrit » n'est pas un résultat.
- **Variantes trop proches = pas de banc** : si deux formulations disent la même chose autrement, on
  ne mesure que du bruit → refaire des variantes franchement contrastées.
- **Le gagnant s'installe en écrivant SON texte** dans le fichier réel, et la leçon retenue cite le
  LEVIER qui a marché, pas seulement le nom du bras.

### 3. EXPÉRIENCE A/B/C/X — les quatre bras dans UN SEUL message

**PRÉ-VOL OBLIGATOIRE — AU MOMENT où les prompts sont écrits et AVANT d'envoyer quoi que ce soit :**

```
npm run arena:protocole -- --run <RUN.md du banc> --bench <dossier du banc> --avant-lancement
```

Ce mode ne lit que le RUN.md et les `prompt-<bras>.txt` : il tranche les six points qui coûtent le
plus cher à découvrir trop tard (candidats triés, rouge collé, cas limites, énoncé identique, B de
texte, X réellement nu). Code de sortie ≠ 0 → **NE PAS LANCER** : on corrige le prompt, on relance le
pré-vol. Motif mesuré, bancs `residus` et `dogfood` du 2026-09-05 : X citait `/scout` et `/arena`
dans son prompt — donc X n'était pas le plancher de mesure —, et le contrôle ne l'a dit qu'APRÈS que
les quatre bras aient été payés (≈ 11 $ et 15 $ de tournoi rendus ininterprétables sur leur bras X).
Un défaut de prompt se corrige pour zéro dollar avant le départ, jamais après.

Lancer les quatre en même temps (un sous-agent par bras). Chaque bras reçoit, mot pour mot :
- l'énoncé de la tâche (identique), le critère de succès, sa copie de travail,
- **son workflow imposé** (A : actuel, textes intacts · B : texte de skill réécrit · C : candidat
  non-texte scouté · X : appel nu, aucune skill ni consigne),
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
4. **Durée / tours mesurés**, et **efficacité** : tours et appels d'outils dépensés POUR atteindre le
   critère, reprises comprises (un bras qui y arrive en 3 tours bat un bras à 9 tours au même prix)
5. **Reproductibilité** — le workflow marche-t-il hors de cette tâche, ou a-t-il gagné par chance ?

Le juge rend : **un gagnant nommé**, l'écart chiffré au témoin A, et les défauts renvoyés au
producteur. Égalité ou écart dans le bruit → dire « pas de gagnant », garder A. **Un workflow n'est
pas déclaré meilleur parce qu'il est moins cher : moins cher ET au moins aussi bon, sinon il perd.**

### 5. Installer et retenir
- Livrer le meilleur livrable pour de vrai ; jeter les copies de travail perdantes.
- Écrire le workflow gagnant à son point de déclenchement, en une règle-réflexe.
- **SI B GAGNE — le texte de la skill est RÉÉCRIT pour de vrai, dans le fichier réel du dépôt, avec
  la formulation exacte du bras gagnant, en commit dédié.** C'est le but même de la règle « B est
  toujours une variante de texte » : chaque `/arena` doit laisser le contenu des skills MEILLEUR
  qu'avant, pas seulement un rapport. Un banc où B gagne et où `skills/<nom>/SKILL.md` n'a pas changé
  sur disque est un banc INACHEVÉ, à dire tel quel.
- **SI B PERD — l'écrire aussi** : la formulation actuelle a tenu contre une variante triée, c'est
  une mesure en faveur du texte en place, et la variante perdante se journalise pour ne pas être
  re-proposée au banc suivant.
- **SI X (l'appel nu) GAGNE — c'est le résultat qui prime sur tous les autres** : l'outillage a coûté
  plus qu'il n'a rapporté. Il s'annonce en tête, et la suite n'est pas d'installer un texte mais
  d'ALLÉGER la skill (retirer l'étape que l'appel nu a sautée sans perte) ou de restreindre son
  déclenchement.
- **Journaliser les QUATRE bras — une ligne chacun, gagnant ET perdants.** Sans ça le banc suivant
  refait ce tournoi :

  ```
  npm run arena:duel -- noter --tache "<énoncé du banc>" --workflow "<workflow du bras>"
    --bras a --duree-ms <mesuré> --cout-usd <mesuré>
    --verdict gagnant|perdant|nul|abandonne|casse
    --banc <dossier du banc> [--note "<ce qui a discriminé>"]
  (tout sur UNE seule ligne à l'exécution)
  ```

  Les chiffres sont ceux du tableau ci-dessous, donc LUS (`out-<bras>.json` : `total_cost_usd` ;
  `activity/conv-N.jsonl` : `durationMs`) — jamais estimés. Un bras invalidé (énoncé reformulé,
  copie partagée) se note `casse`, pas `perdant` : il n'a pas concouru. Le script refuse une ligne
  sans tâche, sans workflow, ou avec un verdict inventé — c'est voulu : une ligne incomparable pollue
  tous les bancs suivants.
- `remember` (`type: lesson`) : la tâche, le gagnant, Δ$ et Δminutes contre A, la source
  `session:<id>` ou `git:<chemin>@<sha>`.
- Une règle installée sans avoir rejoué la situation d'origine est **non vérifiée** : le dire.

### 6. Contrôle du protocole — du CODE, pas ta relecture
Avant de rendre la sortie ci-dessous :

```
npm run arena:protocole -- --run <RUN.md du banc> --bench <dossier du banc>
```

**Le contrôle ne devine pas les noms : il ouvre ces fichiers EXACTS dans le dossier du banc.** Un banc
qui les nomme autrement est déclaré non tenu même si le travail est bon — donc les écrire sous ces
noms-là, dès la préparation du banc (étape 1) et au retour de chaque bras (étape 3) :

| fichier (dans le dossier du banc) | écrit quand | ce que le contrôle en fait |
|---|---|---|
| `tache.txt` | étape 1, avant le lancement | l'énoncé de référence ; son texte doit se retrouver dans chaque `prompt-<bras>.txt` |
| `check.mjs` | étape 1, avant le lancement | le critère de succès exécutable (`node check.mjs <racine>`), constaté rouge |
| `prompt-<bras>.txt` | étape 3, à l'envoi | un par bras (`a`, `b`, `c`, `x`) : le prompt envoyé mot pour mot, preuve de l'énoncé identique |
| `out-<bras>.json` | étape 3, au retour | un par bras : la sortie JSON brute du sous-agent, d'où sont lus `total_cost_usd` et `session_id` |
| `out-judge.json` | étape 4, au retour du juge | la sortie brute de `judge`, avec son `session_id` — c'est elle qui prouve que le producteur ne s'est pas jugé |
| `lance*.sh` (ou `.ps1`/`.bat`/`.mjs`/`.js`) | étape 3, avant le lancement | le script qui lance les quatre bras ; sans lui, P6, P7 et P13 sortent RATE d'un coup |

Le `RUN.md` passé en `--run` reste à part : c'est le compte rendu (candidats scoutés, rouge collé,
tableau, Discrimination), pas un des artefacts ci-dessus.

Il lit les fichiers du banc et rend 18 points OK/RATE (candidats écrits, rouge collé, cas limites du
critère, 4 bras, énoncé identique, copies distinctes, départ simultané, chaque `$` du tableau égal au
`total_cost_usd` du bras, juge distinct, format du tableau, ligne Discrimination, leçon chiffrée,
copies perdantes retirées, et — si le banc teste des variations de TEXTE — section `## Variantes de
texte` avec son levier plus un `variantes/<bras>.diff` non vide par bras, et enfin les QUATRE lignes
du banc dans `arena-duels.jsonl` — un tournoi non journalisé est RATE, gagnant seul journalisé
compris), et enfin — si le banc est sorti 4/4 — la section `## Critère durci` nommant l'assertion à
ajouter pour la reprise (P18). Code de sortie 0 =
protocole tenu. Les six points lisibles avant le départ des bras se contrôlent avec
`--avant-lancement` (étape 3) : le faire à la fin seulement, c'est payer le tournoi pour apprendre
qu'il était invalide. Un RATE se corrige, ou s'écrit dans la
sortie tel quel — il ne se tait pas : au banc du 2026-09-02, quatre de ces points étaient RATE sans
que rien ne le dise. Les 4 points de **jugement** que le script liste en fin de sortie ne sont pas
mécanisables ; ils restent au juge.

## Sortie (format imposé)

**Banc** : tâche · critère de succès · baseline (ou « aucune, A la fabrique »).

| bras | workflow | critère atteint | $ mesuré | min | tours | rendement ($/tours pour le critère) | défauts | verdict |
|---|---|---|---|---|---|---|---|---|
| A (témoin) | … | … | … | … | … | … | … | … |
| B (texte de skill réécrit) | … | … | … | … | … | … | … | … |
| C (candidat non-texte) | … | … | … | … | … | … | … | … |
| X (appel nu, sans skill) | … | … | … | … | … | … | … | … |

**Gagnant** : bras + workflow en une phrase · **Δ contre A** : $ et minutes · **Preuve** : l'artefact
et le journal cités · **Installé où** : le fichier/point de déclenchement · **Limite** : ce qui reste
non prouvé (une seule tâche testée = un seul point de mesure) · **Discrimination** : combien de bras
ont passé le critère — `4/4` ⇒ banc NON DISCRIMINANT, le gagnant n'est qu'une piste.

## Pièges qui tuent l'expérience
- **Pas de témoin** → aucun écart interprétable.
- **Bras lancés l'un après l'autre** → le second profite du travail du premier ; ils doivent partir
  ensemble, dans un seul message.
- **X mou** (une variante de B au lieu de l'appel nu) → on perd le plancher de mesure : sans lui, on
  ne sait pas si l'outillage bat le fait de ne rien avoir du tout.
- **Aucun bras de texte** (B pris hors de la famille formulation) → le banc mesure des workflows mais
  ne rend AUCUNE amélioration au contenu des skills : `/arena` cesse alors de les faire progresser.
- **Chiffres estimés** présentés comme mesurés → faux vert.
- **Le producteur se juge** → le classement se fait par `judge` externe, jamais par toi.
- **Gagnant généralisé sur une seule tâche** → l'annoncer comme une piste mesurée, pas comme une loi.
- **Banc non journalisé** → le tournoi suivant re-teste les mêmes perdants et repaie le même coût :
  `npm run arena:duel -- noter` sur les quatre bras fait partie de l'étape 5, pas d'un extra.
- **B et C improvisés** (aucune section `## Candidats scoutés` écrite avant le lancement) → il n'y a
  pas eu de tri, donc rien ne dit que les bras testés valaient la peine d'être testés.
- **Critère jamais vu rouge** → on ne sait pas s'il testait quoi que ce soit ; un bras peut « réussir »
  sans avoir touché au défaut.
- **Variantes de texte quasi identiques** (reformulation cosmétique) → on mesure du bruit et on
  conclut sur un goût de rédaction.
- **Texte ET workflow changés dans le même bras** → l'effet n'est plus attribuable.
- **Critère chemin-heureux seul** → les 4 bras passent, le banc ne départage plus rien et le
  classement retombe sur le goût du juge.
- **Banc 4/4 clos sans `## Critère durci`** → on sait que la mesure a échoué et on ne laisse rien
  pour la refaire : le banc suivant repaiera le même tournoi mou.
- **Pré-vol sauté** → un X qui cite une skill ou un B qui n'est pas du texte se découvre APRÈS les
  quatre bras, quand l'argent est dépensé et le tournoi ininterprétable.
