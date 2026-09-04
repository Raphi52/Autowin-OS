# Candidats scoutés — banc /arena /heal autowin os (2026-09-04)

Défaut retenu pour la tâche du banc (chiffré, statique, sans chronomètre) :
`src/main/activity/orchestration-observability.ts` — `persistOrchestrationStep` balaie la liste
complète des événements du fil 4 fois par pas (tour, run, groupe, dépendances inversées).
Mesuré par le critère : 1200 lectures de champ pour 400 événements, là où 800 suffisent (2 passes).

| # | Candidat (workflow imposé au bras) | Retenu | Motif |
|---|---|---|---|
| 1 | Pipeline complet actuel scout→frame→terrain→build→clean→judge | **BRAS A (témoin)** | référence en place |
| 2 | Mesure d'abord : baseline chiffrée obligatoire avant tout candidat, puis fix | **BRAS B** | c'est la thèse de /heal ; teste si la baseline paie |
| 3 | Direct : critère rouge → fix minimal → critère vert, sans phase écrite | **BRAS C** | teste si les phases écrites servent à quelque chose |
| 4 | Casse-prémisse : trois correctifs concurrents écrits, le critère tranche | **BRAS X** | teste la divergence contre la première idée |
| 5 | Duo producteur + relecteur adversarial interne | non | coût x2 pour un banc à 4 bras |
| 6 | Fix guidé par profilage réel (`--cpu-prof`) | non | chronomètre = bruit machine, écarté au cadrage |
| 7 | Réécriture complète du module | non | hors périmètre : refactor opportuniste |
