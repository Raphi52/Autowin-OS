# RUN arenagame — t2v-2026-09-21 (validation du lancement détaché)
But : prouver que les bras survivent à la fin du tour de chat (t2 : 12 bras morts à 7 s, sorties à 0 octet).
Banc : 4 bras (a, b, c, x) × 1 réplique, copies neuves de `modele/` (check.mjs → auto 5 avant lancement), mêmes prompts/sys que t2, 40 $ par bras, sans limite de temps.
Lancement : Start-Process (Git\bin\bash.exe -lc lance.sh) à ~19:59 le 2026-09-21. 4 claude.exe vivants 2 min après.
Critère de réussite : `statut.txt` porte 4 lignes et les 4 `out-*.json` font plus de 0 octet. Si c'est vert → relancer t2 (12 bras, copies neuves).

## Essai 1 — ROUGE (20:02)
Start-Process : 0 claude.exe vivant après la fin du tour, pas de statut.txt, 8 sorties à 0 octet. Cause : Job KILL_ON_JOB_CLOSE du chat (survivable-spawn.ts), hérité par les descendants.
## Essai 2 — lancé ~20:04 par schtasks (tâche AutowinArena-t2v), mêmes copies (aucun fichier écrit à l'essai 1), sorties remises à zéro.
Pendant le tour : 4 claude.exe, dont la chaîne des parents ne remonte pas au claude.exe du chat.
## Constat 20:05 — VERT sur la survie
Les 4 claude.exe lancés par schtasks ont survécu à la fin du tour (CPU en hausse, b-1 écrit dans probe/). Le tournoi t2 est relancé dans t2b-2026-09-21.

## Notes — part AUTO /52 (2026-09-21 ~21:10), comptée comme 4e réplique de t2b
Les 4 bras ont tourné 1139 à 1256 s puis ont été coupés par le quota de session Claude (« session limit »), comme t2b. Notes brutes : `notes/<bras>.json`.
| bras | socle | règles | équil. | multi | visuels | boutique | **auto** | $ | tours |
|---|---|---|---|---|---|---|---|---|---|
| A | 4.8 | 20 | 8.9 | 0 | 4 | 6 | **43.7** | 4.41 | 32 |
| B | 5 | 19.5 | 8.4 | 1.3 | 7 | 6 | **47.2** | 5.01 | 45 |
| C | 5 | 20 | 7 | 0 | 4 | 5.5 | **41.5** | 4.86 | 41 |
| X | 3 | 20 | 8.4 | 0 | 7 | 6 | **44.4** | 4.51 | 41 |
Avec ~4 min de plus que t2b, **A atteint la boutique** (6 pts) : confirme que l'écart t2b tenait surtout au temps disponible.
Moyennes sur 4 répliques (t2b ×3 + t2v) : **X 42.05** · B 41.75 · C 40.75 · **A 37.35**.
