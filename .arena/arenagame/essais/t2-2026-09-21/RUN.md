# RUN arenagame — tournoi t2-2026-09-21
regime: standard · modèle claude-opus-5 · 4 bras × 3 répliques · budget 4 h et 40 $ par bras · grille JEU t2 (52 auto + 48 juge).

## Candidats scoutés
| candidat | famille | source (t1) | retenu |
|---|---|---|---|
| liste de contrôle par volet de l'énoncé, preuve par ligne (réflexe de clôture de build) | formulation SKILL.md build | t1 : bras qui déclarent « fini » avec des volets non prouvés | B |
| règles implicites écrites dans REGLES.md et testées avant de coder | formulation SKILL.md frame | t1 bras B (déjà mesuré, aucun écart) | — |
| outil verifier.mjs (rojo build + selene + tests lune du bras, binaires réels) | outil | t1 bras C (friction binaires Rokit) | C |
| appel nu, aucune skill | plancher | arena § 3 | X |
| garde-fou : refuser « fini » tant que rojo build ≠ 0 | garde-fou | t1 : aucun bras cassé, faible intérêt | — |
| routage : forcer frame avant build sur énoncé multi-volets | routage | hypothèse, non mesurée | — |

## Critère
**Critère binaire** : les 5 assertions de `check.mjs` (build, règles ≥ 80 %, simulation 200/200, boutique sans double crédit, auto ≥ 30/52) passent.
**Preuve** : `node check.mjs <bras>` rend 0.
Rouge constaté AVANT lancement sur le squelette vide (sortie collée) :
```
OK   build rend 0 : une erreur de build est un refus
RATE regles cachees : au moins 80 % des cas, borne basse — 0/28
RATE simulation : aucune partie hors borne ni plantage sur 200 — 0/200
RATE boutique : recu rejoue sans double credit (cas limite) — ["module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet","module Boutique absent ou incomplet"]
RATE part auto >= 30/52 — 5/52
NOTE auto 5/52 · socle 5 regles 0 equilibrage 0 multijoueur 0 visuels 0 boutique 0
exit code: 1
```
Vert sur la référence : même commande, exit code 0, auto 51,8/52.

## Hypothèses (avant lancement)
- X passe le critère binaire (règles connues du modèle) mais perd en volets juge et en rendement.
- B a le moins de « fait » non prouvés (preuve honnête AUTOWIN la plus haute).
- Prédiction auto /52 : X ~38, A ~42, B ~44, C ~44.

## Juges
Deux appels `claude -p` distincts sous la skill judge (out-judge.json, out-judge-2.json), sur captures Studio (bureau caché, mode édition : Play impossible sans clic → menus en jeu et ressenti notés « non observable » si absents des captures).

X est l'appel nu : aucune skill, aucun pipeline, mêmes énoncé et critère que les autres.
Lancement : `lance.sh` (claude -p en arrière-plan, wait).
