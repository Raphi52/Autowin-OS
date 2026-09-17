# Banc /arena — `arena-dispersion`

**Tache du banc** (fabriquee : l enonce de l utilisateur ne nommait aucune cible, seulement le
profil « complexe a faire, facile a juger ») : ecrire `scripts/banc-dispersion.mjs`, l outil que la
skill `arena` EXIGE (section 4 : « un ecart INTER-bras plus petit que la dispersion INTRA-bras n est
pas un resultat ») et que le depot n a pas. Enonce complet et contrat : `tache.txt`.

**Pourquoi cette tache** : complexe (agregation d un journal JSON-Lines, statistique intra/inter,
six regles de calcul, cinq cas limites) mais jugee par UN code de sortie et un score sur 8 — aucun
gout, aucune impression de qualite dans le verdict.

**Critere binaire** : `node gel/check.mjs <copie du bras>` sort-il en code 0, avec les 8 gardes OK ?
**Preuve** : `node D:/AutoWinOS/bench/dispersion/gel/check.mjs D:/AutoWinOS/bench/runs/disp-<bras>`

**Baseline** : aucune tache comparable mesuree dans `arena-duels.jsonl` (les bancs passes portaient
des correctifs, pas une creation d outil) — le bras A fait la baseline.

## Rouge constate AVANT le lancement
Commande : `node bench/dispersion/check.mjs .` sur le depot intact — **code de sortie 1, score 0/8** :

```
RATE G0 le fichier scripts/banc-dispersion.mjs existe — scripts/banc-dispersion.mjs absent
RATE G1 nominal : sortie JSON valide, code 0 — code 1 — node:internal/modules/cjs/loader:1520
  throw err;
  ^

Error: Cannot find module 'D:\AutoWinOS\scripts\banc-dispersion.mjs'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1517:
RATE G2 chiffres recomputables : moyenne et ecart intra du bras a — bras a absent
RATE G3 cas limite : ecart inter < dispersion intra => departage false — comparaison absente
RATE G4 nominal : ecart inter >> dispersion intra => departage true — sortie non JSON
RATE G5 cas limite : une seule replique => ecartRelatif null et departage refuse — sortie non JSON
RATE G6 cas limite : lignes illisibles ignorees et comptees — code 1 attendu 0 — node:internal/modules/cjs/loader:1520
  throw err;
  ^

Error: Cannot find module 'D:\AutoWinOS\scripts\banc-dispersion.mjs'
    at Module._resol
RATE G7 cas limite : banc sans aucune ligne => code de sortie 2 — code 1 attendu 2

score 0/8
CRITERE NON ATTEINT
exit=1
```

## Cas limites couverts par le critere (8 assertions, dont 5 hors chemin heureux)
| garde | famille | ce qu elle interdit |
|---|---|---|
| G0 | existence | rendre un rapport sans livrable |
| G1 | nominal | sortie non-JSON, contrat de ligne de commande different |
| G2 | chiffre recomputable | valeurs en dur : le facteur des journaux est tire AU HASARD a chaque lancement |
| G3 | borne | conclure a un gagnant quand l ecart inter est noye dans la dispersion intra |
| G4 | nominal (2e point) | refuser de departager meme quand l ecart est ecrasant (garde symetrique de G3) |
| G5 | valeur inconnue | ecrire `0` la ou la dispersion est INCONNUE (une seule replique) |
| G6 | entree invalide | planter sur une ligne JSONL illisible, ou ne pas la compter |
| G7 | vide / erreur attendue | sortir 0 sur un banc sans aucune ligne |

Preuve fictive : couverte par G2 (tout chiffre annonce doit etre recompute sur des donnees tirees au
hasard) — le livrable est du CODE, pas un rapport, donc `arena-critere-preuve-fictive` ne s applique pas.

## Journal des duels deja mesures (lu avant de choisir B et C)
`npm run arena:duel -- lire --limite 40` : 4 familles de bancs, **3 sur 4 « ne departage pas »**, et
une seule mesure nette — un banc ou **X (appel nu) atteint le critere a tous les passages quand A, B
et C ne l atteignent jamais** (portage cdp-attente). Consequence retenue ici : X n est pas un
figurant, et un candidat « pipeline plus complet » n est pas retente (deja perdant, cite ci-dessus).

## Candidats scoutes
| candidat | famille | hypothese mesurable | cout prevu | risque | score (gain/risque) | retenu ? |
|---|---|---|---|---|---|---|
| boucle `build` actuelle, textes intacts | temoin | reference | moyen | nul | — | A |
| `build` reecrit : reflexe 2 « chercher le precedent » remplace par « transcris le contrat en liste d assertions » | formulation | +2 gardes de cas limites passees ; le banc du 17/09 a montre que le precedent mal copie NUIT | moyen | faible | 9 | B |
| `build` raccourci a 4 reflexes (longueur) | formulation | -1 tour | faible | moyen : perd le rouge d abord | 4 | non |
| `build` en interdictions negatives au lieu de reflexes positifs | formulation | aucun gain attendu, controle | faible | moyen | 3 | non |
| contexte PRE-MACHE : schema du journal + en-tete de `arena-duel.mjs` fournis, aucune procedure | contexte | -1 a -2 tours de lecture, forme du depot respectee | faible | faible | 8 | C |
| pipeline complet frame->terrain->build->clean | routage | — | eleve | eleve : deja PERDANT au journal (cdp-attente) | 1 | non |
| fan-out : un sous-agent par cas limite | parallelisme | couverture des gardes | eleve | eleve : 8 gardes couplees dans un seul fichier | 2 | non |
| prémisse cassee : ecrire les tests du contrat AVANT le code | preuve | +gardes limites | moyen | moyen : double le travail, proche de B | 5 | non |
| appel NU : enonce + critere, aucune skill, aucune consigne | plancher | mesure le prix de l outillage | faible | — | — | X |

## Variantes de texte
| bras | fichier vise | levier | hypothese de COMPORTEMENT |
|---|---|---|---|
| B | `skills/build/SKILL.md` (reecrit dans la copie du bras) | SUBSTITUTION d un reflexe + mise en tete : le reflexe 2 « cherche le precedent » devient « transcris le contrat en liste d assertions, les cas limites se lisent, `null` n est pas `0` » | le bras B lit le contrat en entier avant de coder, donc passe G5 (dispersion inconnue) et G7 (code 2) que les autres devinent |
Diff : `variantes/b.diff` (59 lignes). Les bras A, C, X gardent le texte actuel, intact.

## Composition des bras
- **A** temoin — boucle `build` du depot, texte intact.
- **B** — meme boucle, `skills/build/SKILL.md` reecrit dans SA copie (variante de TEXTE).
- **C** — candidat non-texte : contexte pre-mache, aucune procedure imposee.
- **X** — appel NU : `tache.txt` et rien d autre (aucune skill, aucune consigne, aucun pipeline).

## Tir unique assume
Un seul tir par bras : le banc ne conclura donc que sur un resultat CATEGORIEL (score /8 au critere),
jamais sur une marge de cout ou de duree — celles-ci s ecriront `non mesure` pour l ecart.
