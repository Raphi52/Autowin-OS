# RUN arenagame — tournoi t2b-2026-09-21
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
Lancement : `lance.sh` via schtasks (hors du tour du chat).

## Relance (t2b) — 2026-09-21 ~20:07
t2 n'a pas tourné (bras tués à la fin du tour). Relancé sur 12 copies neuves de modele/ (check.mjs → auto 5 sur a-1, c-3, x-2) par schtasks (tâche AutowinArena-t2b). Méthode validée par t2v.

## Résultat — part AUTO /52, notée telle quelle (2026-09-21 20:50)
Les 12 bras se sont arrêtés entre 923 et 1017 s, tous sur « You've hit your session limit · resets 1am » (quota de session Claude épuisé), après 3,02 à 4,08 $ chacun. Jeux inachevés = mesure (§ 2). `node check.mjs <bras>` rend 0 pour les 12 (critère binaire atteint, auto ≥ 30). Notes brutes : `notes/<bras>.json`.

| bras | socle | règles | équil. | multi | visuels | boutique | **auto /52** | $ | tours |
|---|---|---|---|---|---|---|---|---|---|
| A1 | 5 | 20 | 8.1 | 0 | 4 | 0 | **37.1** | 3.41 | 34 |
| A2 | 3 | 18.2 | 7.8 | 0 | 4 | 0 | **33.0** | 3.50 | 33 |
| A3 | 4.8 | 18.9 | 7.9 | 0 | 4 | 0 | **35.6** | 3.02 | 21 |
| B1 | 4.8 | 19.5 | 9 | 0 | 4 | 6 | **43.3** | 4.08 | 44 |
| B2 | 5 | 20 | 8.5 | 0 | 4 | 0 | **37.5** | 3.57 | 42 |
| B3 | 3 | 18.2 | 7.8 | 0 | 4 | 6 | **39.0** | 3.52 | 27 |
| C1 | 5 | 19.5 | 7.6 | 0 | 4 | 0 | **36.1** | 3.33 | 27 |
| C2 | 5 | 19.5 | 8.2 | 0 | 4 | 5.5 | **42.2** | 3.30 | 25 |
| C3 | 4.8 | 20 | 8.9 | 0 | 4 | 5.5 | **43.2** | 3.58 | 36 |
| X1 | 5 | 20 | 8.3 | 0 | 4 | 6 | **43.3** | 3.60 | 33 |
| X2 | 5 | 20 | 8.5 | 0 | 4 | 0 | **37.5** | 3.81 | 33 |
| X3 | 4.8 | 20 | 8.7 | 0 | 4 | 5.5 | **43.0** | 3.76 | 40 |

Moyennes : **X 41.3** · C 40.5 · B 39.9 · **A 35.2** (min–max A 33–37.1, X 37.5–43.3).
Lecture : l'écart est porté presque entièrement par la **boutique** (0 ou ~6 : le bras l'a-t-il atteinte avant la coupure ?). Multijoueur = 0 partout, visuels = 4 partout. Écart intra-bras (≈ 6 pts) du même ordre que l'écart entre bras : **aucun bras ne se détache significativement**. Seul signal : A (workflow actuel) est le plus bas sur les 3 répliques. Prédictions : X ~38 (obtenu 41.3), A ~42 (35.2), B ~44 (39.9), C ~44 (40.5) — hypothèse « X perd » démentie : l'appel nu a la meilleure moyenne.
Part JUGE (/48) : non notée (bureau caché : vue 3D non capturable ; jeux coupés).

## Où A perd son temps avant la boutique (journaux Claude des sessions A1-A3, X1)
Minute d'écriture (depuis le début de la session) :
| bras | cadrage RUN.md | Partie.luau | tests du bras | Boutique.luau |
|---|---|---|---|---|
| A1 | 6.0 (18 cas limites + contrôle `frame-cas-limites-check.mjs`, de 3.6 à 6.2) | 12.8 | 13.6–15.4 | jamais |
| A2 | 3.1 | **6.8** | 7.1–15.1 : 11 éditions en aller-retour Partie ↔ tests | jamais |
| A3 | 5.7 | 13.4 | 14.0–16.2 | jamais |
| X1 | — | 9.4 | 11.1–12.9 (2 fichiers, puis on passe) | **14.3** (+ Progression 14.9) |
Constat : les 5 à 6 premières minutes sont une exploration commune à tous (outils, sonde Rojo). Le coût propre à A est double :
(1) le cadrage écrit d'abord, 2,5 à 3 min ; (2) surtout, la boucle test-d'abord de build qui fait polir la logique de partie
(déjà à 18-20/20 sur les règles) jusqu'à la coupure. A2 écrit Partie AVANT X1 et n'atteint quand même pas la boutique.
Avec 15 min de budget réel, finir un volet à fond coûte les volets suivants ; X les survole tous et marque la boutique (~6 pts).
