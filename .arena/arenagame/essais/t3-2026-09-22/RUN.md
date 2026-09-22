# RUN arenagame — t3-2026-09-22
But final : un jeu parfait en un seul prompt. But de ce tournoi : mesurer la DISPERSION de t2c (1 réplique, écart A/B/C/X ≤ 4,1 pts sur 52 en auto) avec 2 répliques par bras.
Banc : 4 bras (a, b, c, x) × 2 répliques, copies neuves de `modele/` (check.mjs a-1 → auto 5 ; modele 5, reference 51,8 vérifiés le 2026-09-22). Mêmes prompts/sys/tache que t2c (B = largeur d'abord). 40 $ par bras, sans limite de temps.
t2c relevé dans historique.jsonl : X 51,3 (35,6 $) · A 50,4 (25,6 $) · B 49,8 (19,0 $) · C 47,2 (21,9 $). Écart < 10 → banc à durcir sur la part auto ; la part juge (48 pts) n'est pas notée.
Hypothèse : si l'écart entre répliques d'un même bras ≥ écart entre bras, la part auto ne départage plus → durcir cache/ (§ 5) avant t4.
Lire : `statut.txt` · `fin.txt`.

## Résultat (relevé 2026-09-22 15:50, check.mjs, part auto /52)
Les 8 bras COUPÉS par le quota de session Claude (« session limit · resets 7pm ») entre 30 et 33 min, 8-10 $ chacun (≈ 71 $ au total). Ce sont des jeux inachevés : pas comparables à t2c (jeux finis, 45-70 min).
| bras | r1 | r2 | moyenne | écart entre répliques |
|---|---|---|---|---|
| A | 44,5 | 45,3 | 44,9 | 0,8 |
| B | 44,7 | 49,4 | 47,1 | 4,7 |
| C | 45,5 | 47,7 | 46,6 | 2,2 |
| X | 40,4 | 45,2 | 42,8 | 4,8 |
Écart entre moyennes de bras : 4,3 ; écart entre répliques jusqu'à 4,8 → le bruit égale l'écart entre bras.

## Dispersion mesurée
Bruit d'une réplique ≈ ±2,4 pts sur 52 ; écart entre bras ≤ 4,3 (t3) et 4,1 (t2c). Aucun bras ne se détache → banc à durcir.

## Causes Autowin
- Coupure quota récurrente (t2b, t2v, t3) : `lance.sh` lance TOUS les bras en parallèle sur un seul compte ; 8 bras épuisent le quota de session en ~30 min. Cause localisée : `essais/<tournoi>/lance.sh` (boucle `&` sans contrôle de quota). Non corrigé ici.
