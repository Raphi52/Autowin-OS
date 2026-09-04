# Banc /arena — « le compteur du widget Remontées des agents »

**Banc** : tâche réelle = le compteur de la tuile `notifications` de l'accueil ment au-delà de 30
remontées non lues (`agentNotices` plafonne à 30, puis `unacknowledgedCount` compte sur la liste déjà
tronquée) · critère = `node .arena/banc-remontees/check.mjs <racine>` en code 0 · baseline : aucune tâche
comparable mesurée (`.autowin-data/autowin-os/arena-duels.jsonl` absent — premier banc journalisé), le
bras A (témoin) la fabrique.

## Critère — 5 assertions, 1 nominal + 4 cas limites
Le critère dépose `critere.test.tsx` dans le dépôt visé, REND la vraie page d'accueil (happy-dom) et lit
la pastille RÉELLEMENT affichée, puis retire le fichier. Il n'inspecte aucun nom de fonction : un bras
est libre de corriger où il veut.
1. nominal : 3 remontées dont 2 non lues → la pastille affiche `2`.
2. cas limite — 31 non lues pour 30 lignes affichables → la pastille doit dire `31`, jamais `30`.
   Interdit : compter sur la liste tronquée.
3. cas limite — aucune remontée → liste vide, aucune pastille, aucun plantage.
   Interdit : afficher une pastille à `0`.
4. cas limite — 40 remontées TOUTES acquittées → aucune pastille.
   Interdit : « corriger » en comptant toutes les alertes sans regarder l'acquittement.
5. cas limite — 100 non lues → pastille `100` ET liste toujours bornée à 30 lignes.
   Interdit : supprimer le plafond d'affichage pour faire passer l'assertion 2.

## Rouge constaté AVANT lancement (dépôt intact, C:/Sources/AutoWinOS @ 59b8141f)
```
$ node .arena/banc-remontees/check.mjs C:/Sources/AutoWinOS
OK   nominal : 3 remontées dont 2 non lues, la pastille affiche 2
RATE cas limite — 31 non lues pour 30 lignes affichables : la pastille doit dire 31, jamais 30 — AssertionError: expected '30' to be '31' // Object.is equality
OK   cas limite — aucune remontée : liste vide, aucune pastille, aucun plantage
OK   cas limite — zéro non lue parmi 40 déjà acquittées : aucune pastille
RATE cas limite — 100 non lues : pastille exacte ET liste toujours bornée à 30 lignes — AssertionError: expected '30' to be '100' // Object.is equality

CRITÈRE NON ATTEINT (2 RATE)
exit=1
```
Même rouge reproduit à l'identique dans la copie de travail du bras A avant son départ (exit=1).

## Candidats scoutés
Journal des duels : `.autowin-data/autowin-os/arena-duels.jsonl` ABSENT → premier banc journalisé,
aucun perdant antérieur à écarter. Un seul banc antérieur existe sur disque sans journal
(`.arena/banc-noms/RUN.md`, 2026-09-03) : il avait déjà testé « édition à l'aveugle, sans jamais lire
le fichier » et l'avait classé 4e (le plus cher, le plus lent, contenu le plus pauvre) — ce candidat est
donc ÉCARTÉ ici au lieu d'être re-payé.

| candidat | famille | hypothèse mesurable | coût prévu | risque | score (gain ÷ risque) | retenu ? |
|---|---|---|---|---|---|---|
| pipeline complet inchangé (frame → terrain → build → judge) | routage | référence, aucun gain attendu | moyen | nul | 1,0 | A |
| édition directe ciblée : les 2 fichiers sont NOMMÉS dans l'énoncé, une lecture, une édition, un run du critère | profondeur | −40 % de tours et −$ : rien à explorer, la cause est déjà localisée | faible | corrige le symptôme au mauvais endroit (plafond retiré) | 3,2 | B |
| preuve d'abord : étendre les tests DÉJÀ présents du dépôt (home-widgets-model.test.ts, HomeView.test.tsx) avant de toucher au code | preuve | +qualité, 0 reprise : la non-régression reste dans le dépôt après le banc | moyen | 1 à 2 tours de plus que B | 2,4 | C |
| une seule passe : interdiction d'exécuter le critère avant de rendre son correctif | prémisse cassée | −tours −minutes si la boucle rouge→vert est du luxe sur un défaut aussi localisé | faible | rend un correctif faux sans le savoir | 2,0 | X |
| fan-out 2 agents (l'un sur le modèle, l'autre sur la vue) | parallélisme | −minutes | élevé | les 2 agents écrivent la même paire de fichiers : résultat non attribuable | 0,5 | non |
| pré-chargement Brain + recherche dans les conversations avant d'agir | contexte | évite de refaire du déjà-fait | moyen | aucun acquis mesuré sur ce widget ; coût de contexte payé pour rien | 0,7 | non |
| consigne BUILD réécrite en version courte | formulation | −$ d'injection | faible | changerait le TEXTE **et** rien d'autre à mesurer ici : le défaut est trop localisé pour discriminer une formulation | 0,8 | non |
| correction pilotée uniquement par les libellés RATE, sans jamais lire le code | prémisse cassée | −tours | faible | DÉJÀ classé 4e au banc `banc-noms` (2026-09-03) : re-testé, il re-paierait le même perdant | 0,3 | non |

Ce tableau est écrit sur disque AVANT toute rédaction de prompt et avant le script de lancement.

## Résultats

Les quatre bras sont partis EN MÊME TEMPS par `lance.sh` (un `git worktree` distinct chacun,
`node_modules` partagé en lien). Chiffres LUS dans `out-<bras>.json` (`total_cost_usd`,
`duration_ms`, `num_turns`) — aucun estimé. Critère RE-JOUÉ par l'orchestrateur dans chaque copie.

| bras | workflow | critère atteint | $ mesuré | min | tours | défauts | verdict |
|---|---|---|---|---|---|---|---|
| A (témoin) | pipeline complet inchangé (cadrage → plan → build par petits pas → auto-relecture) | oui (exit 0) | 2,7207 | 13,9 | 51 | ses tests ne couvrent que la fonction pure : défaut réinjecté au SITE D'APPEL → suite VERTE (mutation jouée par le juge). 6× le prix du moins cher pour un diff plus petit que le gagnant | 2e |
| B | édition directe ciblée (fichiers nommés, 1 édition, 0 exploration) | oui (exit 0) | 0,4463 | 1,1 | 8 | ZÉRO test ajouté : défaut réinjecté au site d'appel → vert ; compteur qui ignore l'acquittement → vert aussi. Aucun commentaire au site d'appel | 4e |
| C | preuve d'abord : étendre les tests DÉJÀ présents du dépôt avant de corriger | oui (exit 0) | 1,0198 | 2,9 | 16 | commentaire nommant une entrée falsifiante non légale au typage (corrigée à l'installation) | **gagnant** (juge externe) |
| X (casse-prémisse) | une seule passe : interdiction d'exécuter le critère avant de rendre | oui (exit 0) | 0,5074 | 1,3 | 7 | ZÉRO test ajouté, mêmes deux mutations vertes que B ; a réussi du premier coup sur un énoncé qui NOMMAIT déjà les deux fichiers | 3e |

**Gagnant** : bras **C** — écrire le garde-fou dans les fichiers de test DÉJÀ présents du dépôt, avant
le correctif, en visant le site d'appel. **Δ contre A** : −1,7009 $ (−62 %), −11,0 min, −35 tours, ET
une couverture strictement meilleure : A est dominé sur les quatre dimensions mesurées.
**Preuve** : `out-c.json` `session_id` 9cc113bb-b753-4aee-96f0-8db16318bac6, `total_cost_usd` 1,019833 ;
critère rejoué par l'orchestrateur dans les 4 copies (exit 0 partout, `verif-<bras>.txt`) ; jugement
externe `out-judge.json` `session_id` 99bc8cc6-04b4-4008-ab64-1b4dce9b5a22, qui a départagé par
mutation testing (12 exécutions vitest : défaut remis au site d'appel → SEUL le bras C rougit).
**Installé où** : `src/main/phase-briefs.ts` (consigne BUILD in-app, fondu dans la garde « reproduis le
rouge AVANT de fixer ») et `skills/build/SKILL.md` étape 5. Le brief BUILD est plafonné à 2600
caractères par son propre test : la clause a été payée en resserrant la prose la plus faible, aucune
des 12 exigences listées par le test n'a été retirée (2595 → 2597 caractères, 37 tests verts).
**Limite** : une seule tâche, une seule exécution par bras. L'énoncé NOMMAIT déjà les deux fichiers et
la cause : c'est ce qui rend B et X si bon marché, et ça ne se reproduira pas sur un défaut à
localiser. Le gagnant est une piste mesurée, pas une loi.
**Discrimination** : 4/4 bras ont passé le critère ⇒ banc **NON DISCRIMINANT** au sens du critère. Le
classement s'est joué sur une mesure SUPPLÉMENTAIRE et exécutable (mutation au site d'appel), pas sur
une impression — mais le critère lui-même n'a départagé personne, et c'est un défaut du critère.

## Leçon
AUTOWIN_LESSON_V1 : sur un défaut localisé et NOMMÉ dans l'énoncé, les 4 workflows A/B/C/X produisent
le MÊME correctif de production à la ligne près et passent tous le critère externe (5/5). L'amplitude
mesurée est 0,4463 $ → 2,7207 $ (banc total 6,41 $ juge compris, ~19,5 min). Ce qui départage n'est
pas le correctif mais le GARDE-FOU laissé dans le dépôt : réinjecter le défaut à son site d'appel
laisse la suite verte chez 3 bras sur 4. Un critère externe qui se retire après la mesure ne prouve
rien sur la dette laissée.

## Obstacle réparé en route (instrument de preuve)
`scripts/arena-protocole-check.mjs` retenait le PREMIER fichier `lance*` par ordre alphabétique. Ce
banc en porte deux (`lance.sh` pour les bras, `juge.sh` pour le juge) : tant que le second s'appelait
`lance-juge.sh`, le contrôle notait P6 et P7 sur le lanceur du JUGE et rendait « 2 dossiers distincts
pour 4 bras » + « lancement séquentiel » sur un banc où les quatre bras étaient partis ensemble. Faux
RATE corrigé à la SOURCE (le contrôle retient désormais le lanceur qui parle des quatre bras), avec
son test de non-régression : `scripts/arena-protocole-check.test.mjs` « choisit le lanceur des QUATRE
BRAS, meme si un autre lance*.sh le precede » — rouge quand on remet `candidats[0]`, vert avec le fix.
