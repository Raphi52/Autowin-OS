# Banc /arena — /heal autowin os (2026-09-04)

Dossier de données : `.autowin-data/autowin-os/arena-bench-heal/`

## Candidats scoutés
Défaut retenu : `persistOrchestrationStep` (`src/main/activity/orchestration-observability.ts`)
balaie 4 fois la liste complète des événements du fil à chaque pas persisté.

| Candidat | Principe | Retenu |
|---|---|---|
| Pipeline complet scout→frame→terrain→build→clean→judge | référence en place | A |
| /heal, mesure d'abord : baseline chiffrée obligatoire | thèse de /heal | B |
| Direct : rouge → fix minimal → vert, sans phase écrite | teste l'utilité des phases | C |
| Casse-prémisse : 3 correctifs concurrents, le critère tranche | teste la divergence | X |
| Duo producteur + relecteur adversarial | coût x2 | non |
| Fix guidé par profilage `--cpu-prof` | chronomètre = bruit machine | non |
| Réécriture complète du module | refactor opportuniste | non |

## Rouge du critère, CONSTATÉ avant lancement
```
$ node check.mjs D:/AutoWinOS/.autowin-data/autowin-os/worktrees/arena-heal/ref
RATE C1 charge : un pas ne lit pas la liste des evenements plus de 2 fois — AssertionError: expected 1200 to be less than or equal to 800
OK   C2 non-regression : le parent reste le premier du groupe — ok
OK   C3 non-regression : une dependance l_emporte sur le groupe — ok
OK   C4 cas limite : liste vide, aucun plantage, aucun parent — ok
OK   C5 cas limite : un autre tour et un autre run ne polluent pas le parent — ok
CRITERE NON ATTEINT (exit 1)
```

## Bras
Quatre bras lancés dans un seul envoi (`lance.sh`, `&` + `wait`), une copie de travail chacun sous
`worktrees/arena-heal/<bras>`, énoncé identique mot pour mot (`tache.txt` recopié dans chaque
`prompt-<bras>.txt`, seul le bloc WORKFLOW IMPOSE diffère).

| Bras | Workflow | Critère | $ | min | tours | défauts (juge) | Verdict |
|---|---|---|---|---|---|---|---|
| a | pipeline complet | 5/5 | 0.8714605 | 3.1 | 17 | fermeture allouée par événement | 4e |
| b | /heal mesure d'abord | 5/5 | 1.1697775 | 4.2 | 21 | commentaire chiffré faux | 3e |
| c | direct sans phases | 5/5 | 0.749696 | 3.0 | 17 | garde par truthiness, Set inutile | 2e |
| x | casse-prémisse | 5/5 | 0.8607365 | 3.5 | 18 | paramètres homonymes | 1er — installé |

Les 10 tests d'origine du module restent verts pour les quatre bras (re-vérifiés par moi, pas sur
parole). Juge externe : session distincte, $0.5797185.

Discrimination : 4/4 bras verts sur le critère → NON DISCRIMINANT sur le vert. Le classement vient
du juge externe et du coût mesuré.

## Leçon retenue
AUTOWIN_LESSON_V1 — sur un défaut DÉJÀ chiffré par le critère, le bras « mesure d'abord » (/heal)
a coûté $1.1697775 contre $0.749696 pour le direct (+56 %) et 72 s de plus, pour un classement 3e
sur 4 : la baseline repaie une mesure déjà faite. La divergence forcée (x, $0.8607365) gagne pour
+15 % par rapport au direct.

## Réserve honnête
Les libellés du critère (`check.mjs`) ont été réécrits APRÈS le passage des bras pour que le
contrôle par code puisse les compter ; le test joué (`critere.test.ts`) est resté identique, et le
rouge ci-dessus a été rejoué avec la version finale sur une copie neuve de HEAD.
