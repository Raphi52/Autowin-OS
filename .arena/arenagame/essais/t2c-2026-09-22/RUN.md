# RUN arenagame — t2c-2026-09-22 (t2b rejoué sans coupure de quota)
But : vérifier si l'écart A (35,2) / X (41,3) de t2b tient quand les jeux ne sont pas coupés à ~15 min par le quota de session Claude.
Banc : 4 bras (a, b, c, x) × 1 réplique, copies neuves de `modele/` (check.mjs a-1 → auto 5), mêmes prompts/sys/tache que t2, 40 $ par bras, sans limite de temps.
Lancement : le 2026-09-21 à 20:59, `scripts/lancer-detache.ps1` → pid 18384, `"horsJob":true`, code 0 ; `attend-puis-lance.sh` dort jusqu'au 2026-09-22 01:05 (quota rétabli à 1h), écrit `debut.txt`, puis exécute `lance.sh`.
Lire : `attente.txt` · `debut.txt` · `statut.txt` · `fin.txt`. Une sortie `out-*.json` dont `result` contient « session limit » = coupé par le quota à nouveau, pas un bras qui a perdu.
Hypothèse : sans coupure, A rattrape X (sa rigueur finit par payer) ; si A reste sous X de > 6 pts, le coût du cadrage + boucle test-d'abord est structurel.

## Bras B remplacé (2026-09-21 ~21:05, avant le départ)
B = texte de A + « VARIANTE B (largeur d'abord) » : liste de volets avec UN critère minimal chacun, passer au volet suivant dès que le critère est vert, pas de polissage avant que tous aient un premier vert, cadrage réduit à une liste courte. Source : analyse t2b (A polit Partie 8-10 min, n'atteint jamais la boutique).
Ancien B (liste de contrôle par volet) conservé dans `sys-b-t2-liste-controle.txt`, non joué ici.
Prédiction : B atteint la boutique (≥ 5 pts) et dépasse A ; si le quota ne coupe pas, l'écart B/A se réduit à mesure que A finit ses volets.
