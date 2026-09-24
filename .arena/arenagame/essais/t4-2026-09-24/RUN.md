# Tournoi t4 — 2026-09-24

4 bras × 2 répliques, 40 $ par bras, lancés par `lance.sh`, notés par `check.mjs` (part auto /52).

## Variantes t4

### Ce que m6 a mesuré (nuit-2026-09-22/m6, une réplique par bras)
| bras | workflow | auto | règles | équilibrage | $ | tours | messages | jetons relus (cache) |
|---|---|---|---|---|---|---|---|---|
| A | frame + build (témoin) | 41,1 | 19,1 | **0 (expiré)** | 6,80 | 87 | 160 | 26,1 M |
| B | base + VARIANTE B + B5 | 49,4 | 19,5 | 7,9 | 10,42 | 105 | 221 | 47,1 M |
| C | base + VARIANTE B + PROCÉDURE C5 | **52** | 20 | 10 | 12,55 | 87 | 286 | 43,9 M |
| X | appel nu | 51,5 | 19,5 | 10 | 10,54 | 93 | 186 | 38,8 M |

Messages et jetons relus : comptés dans les traces `~/.claude/projects/D--AutoWinOS--arena-arenagame-essais-nuit-2026-09-22-m6-<b>-1/*.jsonl`
(sous-agent compris pour C). Points perdus, et leur cause :
- **A : équilibrage à 0 parce que le correcteur a expiré** (`note-a.json` : `"expire": true`, limite de 600 s à
  `check.mjs:77`). Les 8 cartes de A étaient pourtant entre 41,7 et 53,7 %. J'ai mesuré la vitesse sur les copies
  extraites : même sonde `lune` (20 parties, `etat()` + `avancer(0.1)` à chaque pas, une pose tous les 7 pas).
  **A : 40,3 ms par partie ; B : 5,5 ; C : 6,1 ; X : 5,7.** A simule par pas de 0,05 s (`a-1/src/shared/Partie.luau:20`).
  Aucun workflow ne demandait de mesurer la vitesse du moteur.
- **Règles (0,5 à 0,9)** : A et X perdent « un sort touche l'adversaire et épargne ses propres unités » ; A perd aussi le
  cycle ; B perd « égalité après prolongation » parce que son sort n'abîme pas la tour.
- **Équilibrage de B (7,9)** : valkyrie 65 %, boule de feu 38,7 %, géant 39 %.
- **Coût** : C a la note maximale, mais c'est le bras le plus cher. Son `RUN.md` (copie extraite) dit « Équilibre : NON
  TENU après 3 validations neuves ». Son critère était « chaque cellule (48 cellules à 400 parties) dans 45-55 % ». Or
  l'écart type d'une cellule à 400 parties est d'environ 2,5 points, et chaque tirage laissait 0 à 5 cellules hors de la
  bande. Le correcteur lui a donné 10/10. Les appels d'équilibrage ont duré environ 2 h dans les 4 bras (07:05 → 09:04
  pour C). C est aussi le seul bras qui a lancé un sous-agent (1,25 Mo de trace en plus).

### sys-a = le meilleur workflow mesuré : C de m6
A de t4 = `m6/sys-c.txt` (52/52), avec deux changements seulement :
1. **Taille** : de 27 858 à 23 262 caractères. J'ai retiré de FRAME ce qui ne sert pas quand aucun humain ne répond :
   les déclencheurs et hard-gates de conversation, la discipline du QCM, le moteur `_engine`. J'ai aussi condensé les
   paragraphes de justification du registre de confiance et les « À ne pas faire » redondants. Enfin, j'ai retiré la
   mention de `scripts/frame-cas-limites-check.mjs`, qui n'existe pas dans une copie de bras (outil promis mais absent,
   friction déjà vue en m1). BUILD, VARIANTE B et PROCÉDURE C5 sont intacts, mot pour mot.
2. **Règle commune**, en tête : ne jamais arrêter un processus par son NOM (`Stop-Process -Name`,
   `Get-Process … | Stop-Process`, `taskkill /IM`, `killall`, `pkill`), seulement les PID lancés soi-même.

Facteur confondu : le retrait dans FRAME touche A, B et C de la même façon. A contre m6-C n'est donc pas parfaitement
comparable, mais B contre A et C contre A le sont.
B et C = cette même base (20 654 caractères), plus une dernière section qui REMPLACE la PROCÉDURE C5.

### B (texte) = VARIANTE B6 — sys-b.txt, 24 086 caractères
*Hypothèse : on garde la note de C5 (52) pour moins cher, si le texte dit quand s'arrêter et comment dépenser peu.*
- Même liste de règles que C5, plus : le sort abîme les unités ET les tours adverses (dégâts réduits, jamais nuls).
- **Vitesse** : une partie en moins de 15 ms sous `lune`, mesurée dès que `Partie` tourne (cause de l'échec de A).
- **Arrêt statistique** : moyenne de la carte sur 3 styles dans 47-53 % ET aucune cellule hors 42-58 %. La première
  validation verte arrête l'équilibrage, et on fait au plus 3 validations.
- **Sobriété** : lots dans l'ordre, chaque gros fichier écrit une fois, commandes enchaînées, sorties filtrées, aucun
  sous-agent, rapport court.

Prédiction : auto ≥ 51,5, **≤ 9 $ et ≤ 70 tours** (C5 : 12,55 $).

### C (outil/procédure) = PROCÉDURE C6 — sys-c.txt, 24 308 caractères
*Hypothèse : trois outils fabriqués d'abord remplacent les tours répétitifs du réglage, et coûtent moins qu'un texte.*
Les mêmes critères que B6 (règles, vitesse, verdict statistique), mais portés par des outils :
- `verifier.mjs --rapide|--complet` : ≤ 20 lignes de sortie, avec un test de vitesse bloquant.
- `outils/equilibre.mjs` : parties en parallèle sur (cœurs − 2) processus, PID notés, compteur de validation neuve.
- `outils/regler.mjs` : réglage automatique en UNE commande (au plus 8 passes, un levier par carte, passe annulée si une
  règle rougit, puis une validation qui clôt l'équilibrage).

Prédiction : auto ≥ 51,5, moins de tours que B6 (le réglage tient en quelques commandes) et une durée d'équilibrage
bien sous les 2 h de m6.

### Lecture prévue
- B6 et C6 ≈ 52 pour moins que 12,55 $ : l'arrêt statistique et la vitesse suffisent à baisser le coût sans perdre de
  points. Le moins cher des deux devient A.
- C6 < B6 en coût : les outils paient. B6 < C6 : fabriquer les outils coûte plus que les tours qu'ils évitent.
- B6 ou C6 sous 51 en équilibrage : l'arrêt à 47-53 % de moyenne est trop lâche, et il faut revenir au critère par
  cellule de C5, au prix de son coût.
- A (C5) sous 50 : le 52 de m6 était du bruit d'une réplique. Les 2 répliques de t4 le diront.
- Pour tous les bras, vérifier dans les traces qu'aucune commande n'arrête un processus par son nom.

## Résultats t4 (relance du 2026-09-24 15:46 → 19:02, bureau non caché)
| bras | note auto /52 (rép. 1 · 2) | moyenne | coût $ (1 · 2) | coût moyen |
|---|---|---|---|---|
| A (meilleur mesuré) | 51,3 · 51,6 | 51,45 | 18,17 · 10,40 | 14,28 |
| B (texte) | 51,8 · 51,5 | **51,65** | 8,83 · 6,56 | **7,70** |
| C (outil) | 51,5 · 50,1 | 50,80 | 8,40 · 7,83 | 8,12 |
| X (appel nu) | 52 · 51,4 | 51,70 | 9,21 · 13,29 | 11,25 |
Total des 8 bras : 82,7 $ (hors améliorateur, 15 $ max). Tous les bras : 1 coupure de session reprise par lance-bras.sh (`reprises=1`), code 0.
**Discrimination** : écart max 1,9 point (< 10) → **banc à durcir** (§ 5). À note égale, B coûte 46 % de moins que A et 32 % de moins que X. La règle « battre A de 2 points » est inatteignable sur une échelle saturée à 52 : A n'est pas remplacé mécaniquement, décision humaine.

## Causes Autowin
1. **Consoles lune.exe sur l'écran de l'utilisateur** — cause localisée : les bras écrivent leurs propres `verifier.mjs`, `outils/equilibre.mjs`, `outils/regler.mjs` (a-1, a-2, c-1, c-2) qui appellent `~/.rokit/tool-storage/.../lune.exe` par `spawnSync` sans `windowsHide: true`. Corrigé côté banc : lancement sur bureau caché (`outils/lancer-cache.ps1`, skill § 2).
2. **5 bras sur 8 sans RUN.md** (`clore-run : aucun RUN.md écrit par la session …` pour a-1, b-1, c-1, x-1, x-2) → Autowin les compte en `unknown` (runsBlocked). X n'a pas de kit, c'est attendu ; pour a-1, b-1, c-1 : **non localisé**.
3. **Mort des 3 premiers lancements** : 2 redémarrages du PC (événement 1074, 11:23:49 et 14:56:18) et une console `schtasks` fermée (0xC000013A). Pas un défaut d'Autowin ; consigne ajoutée à la skill.

## Points juge — lecture du code seulement (2026-09-24, sans image)
Présents chez les **8 bras** : menu à onglets (accueil/boutique/cartes ou deck/progression selon le bras), écran de fin, trophées ou route de progression, coffres, quêtes, `BindToClose`, gestion des entrées (tactile/manette), mise en page adaptative (UIScale/contraintes), transitions `TweenService`, retour visuel des coups. Rares : paramètres de son (x-2 seul), probabilités affichées des coffres (b-2, c-1). Taille du code client : 2 825 (c-2) à 5 394 lignes (x-1).
**Conclusion** : la PRÉSENCE des écrans ne départage pas plus que les règles — tous les bras cochent la structure. Seul un jugement sur images (écran réel, Studio en jeu) peut noter la qualité ; le bureau caché ne rend pas la 3D (§ 3). Non observable ici, jamais deviné.
