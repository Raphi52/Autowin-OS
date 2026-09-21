# RUN arenagame — tournoi t1-2026-09-21
Budget par bras : 90 min, 15 $ · modèle claude-opus-5 · 3 répliques par bras (A/B/C/X) lancées ensemble.
A = frame+build (texte actuel) · B = A + règle « REGLES.md + test lune avant de coder » · C = A + outil verifier.mjs · X = énoncé nu.
Hypothèse (écrite avant lancement) : C > A en JEU (l'outil supprime la friction binaires Rokit) ; X plus bas en règles cachées.
Prédiction : X ~55, A ~65, B ~72, C ~72 /85.

## Dispersion mesurée
| bras | JEU /85 (r1,r2,r3) | $ moyen (min–max) | tours moyens | durée moy. |
|---|---|---|---|---|
| A frame+build | 85, 85, 85 | 3,33 (2,91–3,73) | 40,3 | 10,4 min |
| B + REGLES.md | 85, 85, 85 | 2,84 (2,66–3,04) | 27,0 | 9,3 min |
| C + verifier.mjs | 85, 85, 83,2 | 2,88 (2,16–3,95) | 32,7 | 8,8 min |
| X appel nu | 85, 85, 85 | 3,76 (2,92–5,07) | 26,0 | 12,5 min |
Dispersion intra-bras jusqu'à 83 % (C) et 74 % (X) en coût : tout écart entre moyennes (< 30 %) est dans le bruit.
Discrimination JEU : 1,8 point → **banc à durcir**. Prédiction (X ~55) : FAUSSE.
Correction du banc APRÈS lancement : 6 appels `jouer(1, i, 9, 2)` de cache/regles.luau posaient sur la tour du roi (9,3) ; remplacés par (9,10), référence toujours 85/85, tous les bras renotés (copie de l'ancien fichier : cache/regles.luau.avant-t1).

## Causes Autowin
- scripts/arena-duel.mjs:48 refusait les répliques (`a1`) alors que skills/arena/SKILL.md G7 en exige 3 → corrigé, test ajouté (scripts/arena-duel.test.mjs, rouge puis 21/21).
- Non localisée : 2 bras (A1, B3) terminent leur rapport par une mention des connecteurs claude.ai (Gmail…) sans rapport avec la tâche — vient du harnais `claude -p`, pas d'un fichier d'Autowin OS trouvé.
- Non localisée : les RUN.md de cadrage des bras sont écrits hors de la copie du bras (chemin `~\.claude\runs\…` prescrit par skills/frame/SKILL.md:31) → la note AUTOWIN ne peut pas les lire depuis la copie ; comportement voulu par frame, pas modifié.
Gagnant : aucun au-delà du bruit → A reste le workflow installé.

## Protocole (arena:protocole, 2026-09-21) — PROTOCOLE NON TENU, 19 points RATÉS
Réels : pas de juge externe (P9, et le point « jouable » /15 n'est pas noté) · pas de `## Candidats scoutés` (P1, P16) · critère binaire et rouge non écrits AVANT lancement (P2, P3, P20) · l'énoncé ne cite pas `check.mjs` aux bras (P21).
De forme : fichiers rangés sous essais/t1-2026-09-21/ avec des noms `out-A1.json`, `prompt.txt`, `sys-A.txt`, alors que le contrôle attend `out-a-1.json` / `prompt-a.txt` à la racine du banc (P4-P8, P10-P15, P17). Cause : skills/arenagame/SKILL.md § 2 ne fixe pas cette disposition.
