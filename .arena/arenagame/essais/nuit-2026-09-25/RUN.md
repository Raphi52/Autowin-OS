# Nuit arenagame 2026-09-25

## m0
Source : `essais/t4-2026-09-24` (8 bras = 4 × 2 répliques, déjà notés ; grille t4 à 32 règles). L'améliorateur a lu
`note-*.json`, `out-*.json` et `sys-*.txt`, puis extrait `t4-2026-09-24.bras.tar.gz` dans `m0/ameliore/moi`.

### Notes (auto /52, check.mjs) et coûts
| bras | rép. 1 · 2 | moyenne | rejoué sur la grille t5 (35 règles) | $ (1 · 2) | $ moyen | tours (1 · 2) |
|---|---|---|---|---|---|---|
| A (C5 de m6) | 51,3 · 51,6 | 51,45 | 50,9 · 51,2 | 18,17 · 10,40 | 14,28 | 114 · 125 |
| B (B6, texte) | 51,8 · 51,5 | **51,65** | 51,4 · 51,1 | 8,83 · 6,56 | **7,70** | 108 · 62 |
| C (C6, outils) | 51,5 · 50,1 | 50,80 | 51,1 · 50,2 | 8,40 · 7,83 | 8,12 | 106 · 94 |
| X (nu) | 52 · 51,4 | 51,70 | 51,6 · 51,0 | 9,21 · 13,29 | 11,25 | 107 · 180 |

### Gagnant : B6 devient A
Règle de rendement : B a une note à moins de 1 point de A (+0,2 sur la grille t4, +0,2 sur la grille t5) pour un coût
**inférieur de 46 %** (7,70 $ contre 14,28 $, seuil 30 %). `m0/ameliore/sys-a.txt` est la copie octet pour octet de
`t4-2026-09-24/sys-b.txt` (même empreinte SHA-256, 25 027 caractères). C ne bat pas A (−0,65 point).
Réserve : X, l'appel nu, fait 51,70 pour 11,25 $. B6 le bat en coût (−32 %) mais pas en note. Le kit ne rapporte pas
encore de points auto, seulement du rendement.

### Points perdus (échecs lus dans les note-*.json)
- **Pose sur une tour** : 7 bras sur 8 la ratent sur la grille t5. Seul c-2 la refuse : `c-2/src/shared/Partie.luau`,
  `_positionUnite`, boucle sur `listeTours` avec `math.abs(x - t.x) < t.rayon`. b-1 n'a qu'un contrôle de zone
  (`_zonePosable`), sans emprise des tours.
- **Règles t4** : a-1 perd la pose avancée du côté d'une princesse détruite. c-2 perd 3 règles d'élixir (recharge en
  2,8 s, refus faute d'élixir, double élixir en prolongation), soit −1,4 point. x-2 perd « le sort n'abîme pas la tour ».
- **Équilibrage (0,2 à 0,5 point par bras)** : les sorts sont trop faibles partout. Sur les 10 sorts des 8 bras, le
  correcteur mesure **45,7 % en moyenne** (42,0 à 50,7 %), alors que b-2 déclarait ses 8 moyennes dans 47-53 %.
  Le géant est trop fort chez a-1 et a-2 (55,3 et 58,3 %). b-2 perd 0,5 point sur l'écart J1/J2 : il mesurait
  0,5 point, le correcteur 5,1.
- **Volets juge (48 points, non mesurés)** : seul x-2 a un réglage du son, et seuls b-2 et c-1 affichent les
  probabilités des coffres (lecture du code, RUN t4).

### B (texte) = VARIANTE B7 — `sys-b.txt`, 28 278 caractères
*Hypothèse : dire en mots les règles et les biais que les bras de t4 ont ratés rattrape les points perdus (pose sur
une tour, élixir en entiers, symétrie, sorts calés 3 à 5 points plus haut) et fait gagner des points juge bon marché
(paramètres du son, probabilités des coffres, écran de fin), sans coûter plus que B6.*
Contenu : A + une section qui ne retire rien. Prédiction : grille t5 ≥ 51,6, sorts ≥ 48 % au correcteur, ≤ 8 $.

### C (outil/procédure) = PROCÉDURE C7 — `sys-c.txt`, 28 453 caractères
*Hypothèse : une liste ne couvre que les règles qu'on y écrit. Un outil qui ATTAQUE le moteur trouve aussi celles que
personne n'a pensé à tester.*
Contenu : A + deux outils fabriqués avant l'équilibrage :
- `tests/sonde.luau` : 300 parties à coups aléatoires, y compris hors bornes et sur les tours, avec des invariants
  vérifiés après chaque appel (coup refusé = état intact, aucune unité sur une tour vivante, élixir exact, cycle de la
  main, sorts) ;
- `tests/miroir.luau` : 50 parties rejouées en miroir, résultat exact attendu ; il remplace la mesure statistique de
  l'écart J1/J2.

C7 garde aussi un lanceur unique `verifier.mjs` dont chaque appel porte `windowsHide: true`. Le régleur automatique de
C6 est abandonné (C6 : 50,8 contre 51,65 pour B6).
Prédiction : pose sur une tour et élixir verts sans qu'on les ait nommés comme règles, écart J1/J2 ≤ 2 points au
correcteur, et un coût ≤ celui de B7 (le miroir évite des milliers de parties).

### Lecture prévue
- B7 ≥ A + 0,5 pour un coût voisin : les biais mesurés se transmettent par le texte.
- C7 ≥ B7 : l'outil vaut mieux que la liste, et la sonde devient une étape de BUILD.
- Aucun des deux au-dessus de A : les 0,5 point restants sont du bruit à une réplique. Il faut alors durcir le banc
  (§ 5) ou mesurer les 48 points juge, pas écrire un B8.

### Causes Autowin OS repérées
1. **3 RUN.md écrits mais non clos (a-1, b-1, c-1 comptés « unknown » = bloqués).** `D:\AutoWinOS\.arena\arenagame\clore-run.mjs:55`
   ne retrouve un RUN.md que par `"file_path":"…RUN.md"`, donc par les outils Write et Edit. Or b-1 (session
   `0993c26c…`) a écrit `~\.claude\runs\t4-2026-09-24-b-1\clash-clone-workspace\RUN.md` par PowerShell `Add-Content`
   (journal, 14:47:43Z et 15:31:05Z), et avait lu ce fichier par `Get-Content` (13:52:20Z). La cause t4 « non
   localisée » est donc localisée pour b-1. Le fichier est aussi celui d'un essai précédent tué, repris sous le même
   nom de dossier. Correctif à faire (hors de ce rôle) : chercher aussi les chemins `…\.claude\runs\…\RUN.md` dans les
   `command` des outils PowerShell/Bash. Non vérifié pour a-1 et c-1 : aucun `file_path` RUN.md dans leurs journaux,
   mode d'écriture non relu.
2. **Consigne de FRAME impossible à suivre en `claude -p`.** Le chemin prescrit est `~\.claude\runs\<session_id>\…`
   (`sys-a.txt:33`, copié de la skill frame), mais aucun bras ne connaît son session_id : tous nomment le dossier
   d'après leur copie (`t4-2026-09-24-b-1`, `t4-c-1`…). C'est ce qui permet à une relance de rouvrir le RUN.md d'un
   essai mort. Source dans le kit : non relue ici (skill frame § 0, dont `sys-a.txt:33` est la copie).
3. **Refus de permission (1 par bras chez a-2, b-1 et c-2)** : `permission_denials` dans `out-a-2.json`,
   `out-b-1.json` et `out-c-2.json`. Ce sont des réécritures de fichiers par script (`WriteAllText` PowerShell,
   `writeFileSync` node), refusées sans cause lue. Règle de permission : **non localisée**.
4. **Machine partagée** : b-1 note 60 à 90 `lune.exe` d'autres sessions et une vitesse mesurée de 6,8 à 33 ms selon
   la charge. Le seuil de 15 ms de B6 est donc fragile en parallèle. Pas un défaut du kit : c'est le banc lui-même
   (4 bras simultanés).

Nettoyage : copies extraites de `m0/ameliore/moi/{a,b,c,x}-{1,2}` effacées après lecture (l'archive
`t4-2026-09-24.bras.tar.gz` reste la source).

## m1
Bras : A = B6 (`m0/ameliore/sys-a.txt`, même empreinte SHA-256 D30983B2…), B = B7 (texte), C = C7 (sonde + miroir),
X = appel nu. Une réplique par bras, lancés à 17:10. L'améliorateur a lu `note-*.json`, `out-*.json`, les journaux de
session et le code extrait de `m1.bras.tar` dans `m1/ameliore/moi`.

### Notes (auto /52, check.mjs) et coûts
| bras | note | règles | équilibrage | $ | messages assistant (journal) | durée | échecs check.mjs |
|---|---|---|---|---|---|---|---|
| A (B6) | **52** | 35/35 | 10 | 12,21 | 209 | 90 min | aucun ; boule de feu 46,0 %, écart J1/J2 0,6 |
| B (B7) | **52** | 35/35 | 10 | 14,44 | 234 | 90 min (cost-state : 5 419 s) | aucun ; gobelins 55,7 %, écart 2,1 |
| C (C7) | 50,7 | 34/35 | 9,1 | **9,41** | 160 | 59 min | double élixir à t = 130 ; flèches 38,0 %, boule de feu 41,0 % |
| X (nu) | 51,3 | 34/35 | 9,7 | 17,65 | — (48 tours) | 88 min | pose acceptée sur la tour en (9, 3) ; canon 40,7 % |

Juges : aucun volet mesuré. `check.mjs` recopie le même bloc `juge` chez les 4 bras (statut « non mesure »).

### Gagnant : A reste B6
- B égale A en note (52) pour **+18 %** de coût : pas adopté.
- C a un coût **inférieur de 23 %**, sous le seuil de 30 %, et il est à **−1,3 point**, au-delà de la marge de
  1 point : pas adopté.
- `m1/ameliore/sys-a.txt` est la copie octet pour octet de `m1/sys-a.txt`.
- À note égale, le coût de B6 a varié de 60 % entre deux manches : 7,70 $ en moyenne en t4, 12,21 $ en m1. À une
  réplique, la règle des −30 % tombe donc dans le bruit du coût. Il faudrait 2 répliques de A par manche pour la
  trancher (+12 $ par manche, à décider par l'humain).

### Où partent les points et les dollars (lus dans le code et les journaux)
- **C : −0,4 point de règles, causé par le kit lui-même.** `c-1/src/shared/Partie.luau:22` :
  `DOUBLE_DES = 180000`, soit un double élixir en prolongation seulement. Le bras l'écrit dans son rapport : « j'ai
  d'abord mis l'élixir doublé dès 2 minutes, comme dans le vrai jeu. Je l'ai ensuite limité à la prolongation, pour
  suivre l'invariant du kit ». a-1 et b-1 ont `DEBUT_DOUBLE = 120000` et passent.
- **Sorts et bâtiments : seules cartes hors bande.** C a deux sorts (flèches 38 %, boule de feu 41 %), avec un écart
  de 15 points entre styles que ni le coût, ni les dégâts, ni le rayon ne bougent. Il s'est arrêté après les 3
  validations de B6. X a un canon à 40,7 %. a-1 a remplacé son canon (22 à 38 % sous SENSÉ) par des gobelins et a
  fait 10/10.
- **Juges externes : 1,5 à 1,8 $.** A et B ont suivi JUDGE, avec 2 passes de sous-agents Sonnet (1,81 $ et 1,49 $).
  C a suivi la ligne « Aucun sous-agent » de B6 et n'a lancé aucun juge.
- **Tâches de fond.** b-1 a fait 7 `run_in_background` et reçu 36 notifications de tâche ; c-1 aucune. B6 interdit
  déjà `ScheduleWakeup`, mais pas `run_in_background`.
- **Question finale.** c-1 finit sur « Décision pour toi : soit tu livres tel quel, soit tu m'accordes encore 20 à 30
  minutes », et son RUN.md reste « open » jusqu'à `clore-run`.

### B (texte) = VARIANTE B8 — `sys-b.txt`, 27 987 octets (A + `moi/add-b.txt`)
*Hypothèse : le surcoût d'A et de B vient de deux consignes qui se contredisent (B6 interdit les sous-agents, JUDGE
les exige) et des tâches de fond. B8 tranche ces deux points. Il redit aussi deux règles, le double élixir dès 120 s
et l'interdiction de poser sur une tour, et impose un deck qui se règle : un seul sort à tête chercheuse, aucun
bâtiment. Avec ce texte, B doit garder le 52 pour ≤ 9 $.*
Prédiction : 52/52, ≤ 9 $, ≤ 170 messages, au plus 2 sous-agents.

### C (outil/procédure) = PROCÉDURE C8 — `sys-c.txt`, 29 344 octets (A + `moi/add-c.txt`)
*Hypothèse : C7 doit son coût bas à ses outils (sonde, miroir, lanceur unique, tout au premier plan). Ses 1,3 point
perdus viennent d'un invariant faux et de sorts impossibles à régler. C8 corrige l'invariant. Avant le réglage, un
outil `outils/tournoi-sorts.mjs` met 3 conceptions de sort en compétition (chercheuse coût 3, chercheuse coût 2,
invocation) et garde la moins sensible au style. Après 2 validations ratées sur un écart entre styles, on remplace la
carte au lieu de la régler.*
Prédiction : ≥ 51,6, sort ≥ 46 % au correcteur, ≤ 9,5 $. Si C8 fait 52 pour ≤ 8,5 $ (−30 % sur 12,21 $), il
remplace A.

### Lecture prévue
- B8 à 52 et ≤ 8,5 $ : la contradiction sous-agents/JUDGE causait le surcoût. Il faut alors la corriger dans
  `lance-bras.sh` (cause 2) plutôt que dans chaque sys.
- C8 ≥ 51,6 et le moins cher : la sonde et le tournoi de sorts deviennent des étapes de BUILD.
- Les deux à 52, à ±30 % du coût de A : le banc ne départage plus que par le bruit du coût. Il faut alors mesurer les
  48 points juge (voie `juge-t4/fenetre.ps1`) avant d'écrire B9.

### Causes Autowin OS repérées
1. **Invariant faux écrit par l'améliorateur m0.** `m1/sys-c.txt:201` dit « monte d'exactement +1 en 2,8 s (+2 en
   prolongation) ». c-1 l'a suivi contre sa connaissance du jeu (−0,4 point). `m1/sys-b.txt:200` portait la même
   erreur (« la recharge doublée en prolongation »), mais b-1 ne l'a pas suivie. Cause : l'améliorateur écrit les
   règles du jeu de mémoire, et rien ne les confronte aux tests. C8 et B8 (§ 3) corrigent la règle ; C8 ajoute « la
   sonde vérifie le jeu, elle ne le définit pas ». Correctif de fond, hors de ce rôle : le prompt de l'améliorateur
   (`nuit.sh:25`) pourrait interdire d'énoncer une règle chiffrée qu'aucun bras n'a vérifiée.
2. **Consignes contradictoires injectées par le lanceur.** `D:\AutoWinOS\.arena\arenagame\lance-bras.sh:25-34`
   ajoute CLEAN et JUDGE à la fin de chaque sys. Or `sys-a.txt:184` (B6) dit « Aucun sous-agent », alors que JUDGE
   demande de lancer « les juges en parallèle » (`sys-effectif-a-1.txt:297` et `:360`). JUDGE prévoit un repli, «
   Aucun sous-agent → juge toi-même en séquence » (`sys-effectif-a-1.txt:309`). Deux bras sur trois ont pris la
   branche chère (1,5 à 1,8 $), le troisième a sauté la relecture. Correctif possible : quand le sys contient
   « Aucun sous-agent », `lance-bras.sh:34` devrait nommer la branche séquentielle de JUDGE.
3. **Tours et durée faux dans `out-b-1.json`.** Le fichier donne `num_turns: 2` et `duration_ms: 36274` pour une
   session de 90 min : `cost-state.totalDuration` vaut 5 419 314 ms dans le journal `cea456db…jsonl`, qui compte
   234 messages. Le `result` final de `claude -p` ne couvre que le dernier segment, celui qui suit les notifications
   de tâches de fond, et `lance-bras.sh:80-81` somme ces champs tels quels. Le coût reste juste, car il est cumulé.
   En revanche, les tours et la durée d'un bras qui utilise `run_in_background` ne sont pas mesurés : il faut les
   lire dans le `cost-state` du journal de session.
4. **Refus de permission (1 chez a-1, 1 chez c-1)**, de même forme qu'en t4 : une réécriture de fichier par script
   (`[IO.File]::WriteAllText` PowerShell chez a-1, `writeFileSync` node dans une chaîne here-string chez c-1).
   **Non localisée**, comme en m0.
5. **X sans RUN.md** (« aucun RUN.md écrit par la session c8782a56… », journal) : attendu pour l'appel nu, ce n'est
   pas un défaut.

Nettoyage : les copies extraites dans `m1/ameliore/moi/{a,b,c,x}-1` sont effacées après lecture ; l'archive
`m1.bras.tar` reste la source. `moi/add-b.txt` et `moi/add-c.txt`, les ajouts de B8 et C8, sont conservés.

## m2
Bras : A = B6 (`m1/ameliore/sys-a.txt`, empreinte SHA-256 D30983B2…), B = B8 (texte), C = C8 (sonde, miroir, tournoi de
sorts), X = appel nu. Une réplique par bras, lancés à 18:53. L'améliorateur a lu `note-*.json`, `out-*.json`, les journaux
de session (`~\.claude\projects\D--AutoWinOS--arena-…-m2-<bras>-1\*.jsonl`) et le code extrait de `m2.bras.tar`.

### Notes (auto /52, check.mjs) et coûts
| bras | note | règles | équilibrage | $ | messages assistant (journal) | durée (cost-state) | sous-agents | échecs check.mjs |
|---|---|---|---|---|---|---|---|---|
| A (B6) | 50,9 | 34/35 | 9,3 | 10,51 | 171 | 53 min | 2 Sonnet, en fond | pose acceptée sur la tour en (9, 3) ; mousquetaire 35,3 % |
| B (B8) | 51,6 | 35/35 | 9,6 | **8,60** | 152 | 49 min | 2 Haiku, 1er plan | archères 58,7 %, géant 57,3 % |
| C (C8) | **51,9** | 35/35 | 9,9 | 8,86 | 161 | 45 min | 0 | géant 43,3 % |
| X (nu) | 51,1 | 34/35 | 9,5 | 13,25 | 96 | 44 min | 2, 6 tâches de fond | pose sur la tour en (9, 3) ; boule de feu 41,3 %, valkyrie 42,0 % |

Cumul de B6 (4 bras : t4 ×2, m1, m2) : **51,55** en moyenne pour **9,53 $**. `out-a-1.json` dit 7 tours et 195 s : faux,
voir cause 3 de m1 (tâches de fond) ; le journal compte 171 messages et 3 155 s.

### Gagnant : A reste B6
- C8 : +1,0 point sur A et −15,7 % de coût. Pas +2 points, et pas −30 % : pas adopté.
- B8 : +0,7 point et −18,2 % de coût : pas adopté.
- `m2/ameliore/sys-a.txt` est la copie octet pour octet de `m2/sys-a.txt` (même SHA-256).
- Réserve : C8 et B8 dominent tous les deux A sur LES DEUX axes dans cette manche, ce que la règle ne sait pas
  récompenser à une réplique. Sur deux manches, la lignée B (B7 52 / 14,44 $, B8 51,6 / 8,60 $) et la lignée C (C7 50,7
  / 9,41 $, C8 51,9 / 8,86 $) restent dans le bruit de B6. Si C9 ou B9 refait ≥ 51,6 pour ≤ 9 $ en m3, c'est la 2e
  domination de suite : il faudra l'adopter (à décider par la règle, ou par l'humain qui l'assouplit).

### Où partent les points et les dollars
- **Pose sur une tour (−0,6 chez A et X).** `a-1/src/shared/Partie.luau:149-169` (`posable`) ne teste que la moitié
  de terrain et la poche d'une princesse détruite, jamais l'emprise des tours. B6 ne dit pas cette règle ; B8 et C8,
  qui la disent (« aucune pose sur l'emprise d'une tour encore debout »), la passent. Le texte transmet la règle.
- **Écart entre le banc du bras et le correcteur : seule source des points perdus par B et C.** a-1 mesurait au dernier
  passage sa mousquetaire à 51,1 % (hasard 51,7, sensé 52,2, impulsif 49,3 : « VERDICT VERT ») ; le correcteur la voit à
  35,3 %. c-1 : géant 48,5 % chez lui, 43,3 % au correcteur. Aucun des styles des bras ne pose une carte seule ni loin
  du front : leurs bots se ressemblent et partagent les biais du jeu qu'ils règlent. Non localisé plus finement
  (les politiques de pose du correcteur ne sont pas à citer dans un prompt).
- **Juges : 1 à 2 $ selon la manière.** a-1 a lancé ses 2 juges Sonnet en `run_in_background`, puis
  `ScheduleWakeup` (1 800 s), alors que B6 interdit `ScheduleWakeup` (`sys-a.txt:187`). b-1 (B8) a pris 2 Haiku au
  premier plan. c-1 (C8) n'a lancé aucun juge et relu seul.
- **Honnêteté de C.** c-1 a posé `status: red` pour une case à 58,2 % sur un plafond de 58 % (sa grille) ; le
  correcteur lui donne 9,9/10 et `clore-run` a reposé `green`. Rapport exact, aucun vert contredit.

### B (texte) = VARIANTE B9 — `sys-b.txt`, 30 773 octets (B8 + `moi/add-b9.txt`)
*Hypothèse : B8 est le bras le moins cher ; ses 0,4 point perdus et ceux de tous les bras viennent d'un réglage
posé au bord de la bande sur un banc qui n'est pas celui du correcteur. Dire en mots la marge à viser ([48, 52]
de moyenne, [44, 56] par case), deux styles de pose en plus (« seul au pont », « derrière le roi »), un réglage borné
à 4 passes, et la sobriété mesurée (juges Haiku au premier plan, écrire un fichier d'un bloc) rattrape ces points sans
rien coûter.*
Prédiction : 52/52, ≤ 8 $, ≤ 130 messages.

### C (outil/procédure) = PROCÉDURE C9 — `sys-c.txt`, 32 139 octets (C8 + `moi/add-c9.txt`)
*Hypothèse : un seul banc, écrit par celui qui règle, confirme ses propres biais (a-1 : 51,1 % contre 35,3 %). Un
CONTRE-BANC indépendant (`outils/contre-banc.mjs`, écrit sans lire les bots, seulement l'interface du contrat, avec 3
politiques de pose différentes) mesure l'écart entre deux bancs, et `verifier.mjs --complet` exige que les deux
voient la carte dans la bande. La contradiction désigne un défaut de conception, pas de moyenne.*
Prédiction : 52/52, ≤ 9 $, aucun sous-agent ni tâche de fond.

### Lecture prévue
- B9 et C9 à 52 : l'écart de banc était la dernière perte auto ; la marge (B) ou le contre-banc (C) devient une étape
  de BUILD, et le banc auto est saturé : il faut mesurer les 48 points juge (voie `juge-t4/fenetre.ps1`).
- C9 > B9 : l'outil vaut mieux que la consigne ; B9 > C9 à coût moindre : la consigne suffit.
- X reste à ≈ 51 : voir cause 1 ci-dessous — X n'est pas un appel nu, la comparaison X ne mesure plus le kit.

### Causes Autowin OS repérées
1. **Les 4 bras, X compris, lisent et écrivent la mémoire d'Autowin OS et les RUN.md des manches précédentes.**
   `D:\AutoWinOS\.arena\arenagame\lance-bras.sh:19` fait `cd "$BANC/$BRAS"`, un dossier DANS le dépôt git
   `D:\AutoWinOS` (`git rev-parse --show-toplevel` = `D:/AutoWinOS` ; le dossier n'est qu'ignoré par
   `.arena/arenagame/.gitignore:5`). `claude -p` (`lance-bras.sh:50-51`) y charge donc la mémoire auto du projet
   `D--AutoWinOS` : dès la première minute, a-1, b-1, c-1 ET x-1 lisent `memory\arenagame-banc-lecons.md`,
   `arenagame-fumee-client-lune.md` et `arenagame-rendu-client-pieges.md` (qui contiennent les leçons « boule de feu
   chercheuse », « sorts coût 2 »…). a-1 et c-1 y ÉCRIVENT ensuite par `Add-Content` (leçons de m2), et a-1, b-1, c-1
   relisent `~\.claude\runs\nuit-2026-09-25-m1-*\…\RUN.md` et b-1 `historique.jsonl`. Conséquences : X n'est pas un
   appel nu (d'où X ≈ A depuis t4), les bras ne sont pas isolés entre eux ni entre manches, et une manche mesure le
   kit + la mémoire accumulée. Correctif possible (hors de ce rôle) : lancer chaque bras hors du dépôt (copie sous
   un dossier sans `.git` parent, ex. `%TEMP%\arena\<bras>`), ou désactiver la mémoire auto pour les bras.
2. **La consigne JUDGE injectée pousse encore aux sous-agents en fond.** `lance-bras.sh:30-32` ajoute la skill judge ;
   « Lance les juges sélectionnés EN PARALLÈLE » (`sys-effectif-a-1.txt:360`) a produit chez a-1 2 juges Sonnet en
   `run_in_background` puis un `ScheduleWakeup`, contre `sys-a.txt:187` (« sans ScheduleWakeup »). Même cause que m1
   cause 2 ; B8 qui tranche (Haiku, premier plan) coûte 1,9 $ de moins.
3. **`out-a-1.json` : `num_turns` 7 et `duration_ms` 195 352 pour 53 min** — `lance-bras.sh` somme le `result` du
   dernier segment ; même cause que m1 cause 3, reproduite ici par les juges en fond.
4. **Aucun refus de permission** dans les 4 bras (`permission_denials: []`), contre 1 à 2 par manche avant.
5. **X sans RUN.md** (journal) : attendu pour l'appel nu.

Nettoyage : copies extraites dans `m2/ameliore/moi/{a,b,c,x}-1` effacées après lecture ; l'archive `m2.bras.tar`
reste la source. `moi/add-b9.txt` et `moi/add-c9.txt`, les ajouts de B9 et C9, sont conservés.
## m3
Bras : A = B6 (`m2/ameliore/sys-a.txt`, SHA-256 D30983B2…), B = B9 (texte), C = C9 (sonde, miroir, tournoi de sorts,
contre-banc), X = appel nu. Une réplique par bras, lancés à 21:55. L'améliorateur a lu `note-*.json`, `out-*.json`, les
journaux de session (`~\.claude\projects\D--AutoWinOS--arena-…-m3-<bras>-1\*.jsonl`) et le code extrait de `m3.bras.tar`.

### Notes (auto /52, check.mjs) et coûts
| bras | note | règles | équilibrage | $ | messages assistant (journal) | durée (journal) | sous-agents | échecs check.mjs |
|---|---|---|---|---|---|---|---|---|
| A (B6) | 50,4 | 34/35 | 8,8 | 10,45 | 141 | 52 min | 2 Sonnet + `ScheduleWakeup` | pose acceptée sur la tour en (9, 3) ; mini-P.E.K.K.A 63,0 %, valkyrie 58,3 %, gobelins 57,7 %, archères 56,3 % |
| B (B9) | 50,8 | 33/35 | 9,7 | **7,42** | 112 | 69 min | 2 Haiku, 1er plan | double élixir à t = 130 et « pas de double à t = 100 » (gain obtenu 0) ; boule de feu 42,3 % |
| C (C9) | 51,7 | 35/35 | 9,7 | 9,99 | 213 | 57 min | 0 | valkyrie 43,0 %, écart J1/J2 4,0 |
| X (nu) | **51,8** | 35/35 | 9,8 | 12,15 | 102 | 56 min | 2 en fond, 5 tâches de fond | valkyrie 43,5 % |

Cumul de B6 (5 bras : t4 ×2, m1, m2, m3) : **51,32** pour **9,71 $** en moyenne. Ses deux dernières mesures sont ses
plus basses (50,9 puis 50,4) : il rate la pose sur une tour 2 fois sur 2, parce que B6 ne dit pas cette règle.

### Gagnant : A reste B6
- C9 : +1,3 point et −4,4 % de coût. Pas +2 points, et pas −30 % : pas adopté.
- B9 : +0,4 point (moins de 1 point) et −29,0 % de coût (7,42 $ contre 10,45 $). Le seuil est de 30 % : pas adopté, à
  0,1 $ près.
- `m3/ameliore/sys-a.txt` est la copie octet pour octet de `m3/sys-a.txt` (même SHA-256 D30983B2…).
- Réserve (2e manche de suite, après m2) : dans cette manche aussi, les deux challengers battent A sur la note ET sur le coût. En
  m2 et m3 réunis, la lignée C (C8, C9) fait 51,8 pour 9,43 $, contre 50,65 pour 10,48 $ à B6 dans les mêmes manches.
  La lignée B fait 51,2 pour 8,01 $. Aucune n'atteint le seuil d'une seule manche. La règle garde un A qui est devenu
  le bras le plus faible de ses propres manches. Deux solutions, à trancher par l'humain : comparer les moyennes de
  lignée sur 2 manches, ou jouer A en 2 répliques.

### Où partent les points et les dollars
- **B9 : −0,9 point, causé par le kit lui-même (point 4 de B9, écrit par l'améliorateur m2).** « Tente une pose sur
  […] un point de leur bord » (`m3/sys-b.txt:241-243`). b-1 a donc fait une emprise FERMÉE,
  `b-1/src/shared/Partie.luau:138` `math.abs(y - t.y) <= t.demi + EPS`, avec un roi en y = 3 de demi-côté 2. La rangée
  du fond y = 1 est donc refusée (`:192`). Or le vrai jeu permet de poser derrière son roi. Son code d'élixir est juste
  (`:348`, double dès 120 000 ms). Mais une vérification qui doit d'abord dépenser l'élixir en posant au fond du camp n'y
  arrive pas, et elle mesure un gain nul. c-1 a une emprise OUVERTE (`c-1/src/shared/Partie.luau:125`, `<`) et passe.
  C'est la 2e fois (après m1, cause 1) qu'une règle écrite de mémoire par l'améliorateur fait perdre des points.
- **A : la pose sur une tour, encore.** `a-1/src/shared/Partie.luau:141-156` (`zoneAutorisee`) ne teste que la moitié
  de terrain et la poche d'une princesse détruite, jamais l'emprise. B6 ne dit pas cette règle, et tous les bras dont
  le texte la dit la passent (B8, C8, C9, B9).
- **Écart entre le banc du bras et le correcteur.** a-1 déclare ses gobelins à 46,9 % (« juste sous 47 % »), le
  correcteur les voit à 57,7 %. b-1 a toutes ses moyennes entre 48,2 et 50,8 %, mais sa boule de feu sort à 42,3 %. Le
  seul biais qui revient à chaque manche est le SORT, trop bas au correcteur : t4 45,7 % en moyenne ; m1 38 et 41 % ;
  m2 41,3 % ; m3 42,3, 46,3 et 46,3 %. La valkyrie est basse chez 3 bras (43 à 44 %) mais haute chez a-1 (58,3 %) : ce
  n'est pas un biais de sens constant.
- **Coût de C9 : 213 messages.** 24 commandes d'équilibrage (banc et contre-banc relancés séparément à chaque
  retouche), 24 `Edit`, et des retouches de `Cartes.luau` par remplacements PowerShell en chaîne. B9, qui a la
  consigne de sobriété, finit en 112 messages.
- **A : juges Sonnet puis `ScheduleWakeup`**, contre `sys-a.txt:184` (« Aucun sous-agent ») et `:187` (« sans
  ScheduleWakeup ») : 2e manche de suite (m2, m3).

### B (texte) = VARIANTE B10 — `sys-b.txt`, 32 852 octets (B9, point 4 neutralisé, + bloc B10 en fin)
*Hypothèse : B9 est le bras le moins cher de la nuit. Il n'a perdu ses points de règles que par une consigne ambiguë
du kit, et ses points d'équilibrage que par le biais constant du sort. Corriger la consigne (emprise OUVERTE, jumeau
d'acceptation pour chaque refus, rangée du fond posable, test « vider ») et viser le sort à [52, 56] au lieu de
[48, 52] rend le 52 sans coût ajouté.*
Prédiction : 52/52, ≤ 8 $, ≤ 130 messages. Si B10 fait ≥ 51,4 pour ≤ 7,3 $, il remplace A par la règle des 30 %.

### C (outil/procédure) = PROCÉDURE C10 — `sys-c.txt`, 35 146 octets (C9 + bloc C10 en fin)
*Hypothèse : la sonde de C ne trouve que les refus MANQUANTS. Un outil `tests/frontieres.luau`, qui donne à chaque
refus un jumeau d'acceptation, trouve aussi les refus TROP LARGES, la seule perte de règles de m3. Le coût de C vient
de deux bancs lancés séparément : un seul `equilibre.mjs --familles bots,contre`, plafonné à 8 commandes, et
l'écriture d'un bloc ramènent C sous 150 messages.*
Prédiction : 52/52, 35/35, ≤ 8,5 $, ≤ 150 messages, au plus 8 commandes d'équilibrage.

### Lecture prévue
- B10 à 52 pour ≤ 7,3 $ : la lignée B remplace A. Le point « un refus trop large coûte autant qu'un refus manquant »
  devient une règle de la skill build (jumeau d'acceptation de chaque garde).
- C10 à 52 et sous 150 messages : le test des frontières et le banc unique deviennent des étapes de BUILD.
- A (B6) sous 51 une 3e manche de suite (après 50,9 et 50,4) : ce n'est plus du bruit. Il faut appliquer la réserve ci-dessus.

### Causes Autowin OS repérées
1. **L'améliorateur écrit des règles de jeu non confrontées aux tests (2e occurrence, −0,9 point).** Le prompt de
   l'améliorateur (`D:\AutoWinOS\.arena\arenagame\nuit.sh:25-26`) demande de « viser les points perdus » sans exiger
   qu'une règle chiffrée ou géométrique soit vérifiée sur le code d'un bras qui passe le test. Le point 4 de B9
   (`m3/sys-b.txt:241-243`) a fait perdre deux règles d'élixir. Correctif possible (hors de ce rôle) : `nuit.sh:26`
   pourrait exiger, pour toute règle énoncée, la ligne d'un bras qui la passe (ici `c-1/src/shared/Partie.luau:125`).
2. **Les 4 bras lisent encore la mémoire d'Autowin OS (m2, cause 1, non corrigée).** Dans les 4 journaux, les 3
   premiers `Read` portent sur `~\.claude\projects\D--AutoWinOS\memory\arenagame-*.md`, X compris. La cause est
   toujours `D:\AutoWinOS\.arena\arenagame\lance-bras.sh:19` (`cd "$BANC/$BRAS"`, dans le dépôt `D:\AutoWinOS`). X
   n'est donc pas un appel nu : il fait 51,8, la meilleure note de m3.
3. **JUDGE injecté contre « Aucun sous-agent » (m1 et m2, cause 2, non corrigée).** `lance-bras.sh:30-32` ajoute la
   skill judge. a-1 a de nouveau lancé 2 juges Sonnet, puis `ScheduleWakeup`, contre `sys-a.txt:184` et `:187`.
4. **`out-a-1.json` : `num_turns` 5 et `duration_ms` 149 099 pour 52 min et 141 messages.** `lance-bras.sh:80-81` somme
   le `result` du dernier segment, qui suit ici le `ScheduleWakeup`. Même cause que m1, cause 3.
5. **Refus de permission : 2 chez c-1** (`out-c-1.json`, `permission_denials`). Ce sont des commandes PowerShell qui
   écrivent par `Set-Content` puis `node`, et par `[IO.File]::WriteAllText`. Même forme qu'en t4 et m1. **Non
   localisée.**
6. **X sans RUN.md** (journal) : attendu pour l'appel nu.

Nettoyage : copies extraites dans `m3/ameliore/moi/{a,b,c,x}-1` et `moi/stats.mjs` effacées après lecture ; l'archive
`m3.bras.tar` reste la source.

## m4
Bras : A = B6 (`m3/ameliore/sys-a.txt`, SHA-256 D30983B2…), B = B10 (texte), C = C10 (sonde, miroir, tournoi de sorts,
frontières, un banc à deux familles), X = appel nu. Une réplique par bras, lancés à 23:16. L'améliorateur a lu
`note-*.json`, `out-*.json`, les journaux de session (`~\.claude\projects\D--AutoWinOS--arena-…-m4-<bras>-1\*.jsonl`)
et le code extrait de `m4.bras.tar`. Il a aussi rejoué `Partie.luau` de chaque bras sous lune (copie temporaire).

### Notes (auto /52, check.mjs) et coûts
| bras | note | règles | équilibrage | $ | appels du modèle (entrées journal) | contexte final | durée | sous-agents | échecs check.mjs |
|---|---|---|---|---|---|---|---|---|---|
| A (B6) | 50,9 | 33/35 | 9,8 | 9,72 | 58 (135) | 267 k | 51 min | 2 Sonnet, 3 tâches de fond | pose sur une tour en (9, 3) ; pose refusée du côté d'une princesse détruite |
| B (B10) | 51,4 | 35/35 | 9,4 | **8,32** | 62 (141) | 279 k | 54 min | 2 Haiku, 1er plan | chevalier 41,3 %, géant 42,3 % |
| C (C10) | **51,8** | 35/35 | 9,8 | 9,05 | 66 (179) | 303 k | 50 min | 0 | valkyrie 57,3 %, écart J1/J2 4,3 |
| X (nu) | 50,6 | 34/35 | 9,0 | 16,79 | 60 (125) | 177 k | 62 min | 2 en fond, 9 tâches de fond | pose sur une tour en (9, 3) ; archères 60,3 %, géant 41,7 %, valkyrie 58,0 %, écart 4,8 |

Aucun refus de permission (`permission_denials: []` ×4), aucune reprise. `out-a-1.json` indique 3 tours et 78 s pour une
session de 51 min (cause 3).

Cumul de B6 (6 bras : t4 b-1 et b-2, m1, m2, m3, m4) : **51,25** pour **9,71 $**. Sur m2-m4, B6 fait 50,73 pour 10,23 $,
la lignée C (C8, C9, C10) 51,80 pour 9,30 $, la lignée B (B8, B9, B10) 51,27 pour 8,11 $.

### Gagnant : A reste B6
- C10 : +0,9 point et −6,9 % de coût. Moins de 2 points, et moins de 30 % de coût en moins : pas adopté.
- B10 : +0,5 point (moins de 1 point) et −14,4 % de coût : pas adopté.
- Même sur les moyennes de lignée m2-m4, aucune règle ne joue : C fait +1,07 point pour −9 %, B +0,54 pour −21 %.
- `m4/ameliore/sys-a.txt` est la copie octet pour octet de `m4/sys-a.txt` (SHA-256 D30983B2…).
- Réserve (3e manche de suite) : B6 est encore le bras le plus faible de sa manche parmi A/B/C. Ses pertes ne sont PAS
  du bruit : il rate la pose sur une tour 3 fois sur 3 (m2, m3, m4), parce que son texte ne dit pas cette règle. La
  règle d'adoption, calibrée pour une note qui départage, ne peut plus remplacer A : l'écart auto possible est
  inférieur à 2 points, et le coût varie de ±30 % d'une manche à l'autre (B6 : 6,56 à 12,21 $). À trancher par l'humain :
  adopter C10 sur 3 manches de domination, ou passer A en 2 répliques.

### Où partent les points et les dollars
- **A : « pose refusée du côté d'une princesse détruite » n'est pas un défaut de zone.** La zone de pose de a-1 est
  juste (`a-1/src/shared/Partie.luau:173-201`). Rejoué sous lune, `jouer(1, 1, 3.5, 19)` rend `false, "partie
  terminee"`. Contre un adversaire passif, la princesse tombe en 27 s, puis le roi 14,4 s plus tard, donc AVANT la
  pose testée, qui se fait jusqu'à 15 s après la chute. Même mesure chez les autres bras : c-1 17,8 s, b-1 et x-1 plus
  de 30 s (le roi est encore debout). Les 4 bras ont les mêmes tours (roi 4 000 pv, princesse 2 700 pv) ; ce sont les
  dégâts des troupes qui diffèrent. En t4, a-1 avait déjà perdu cette règle (RUN m0). C'est donc la tenue des tours
  qui manque.
- **A et X : pose sur une tour en (9, 3), encore.** `a-1/src/shared/Partie.luau:222` n'appelle que `posePermise`, sans
  emprise des tours. Cela fait 3 manches sur 3 pour B6.
- **B10 : ses deux consignes ont tenu.** 35/35 en règles (emprise ouverte, jumeaux d'acceptation), et la boule de feu à
  **52,0 %** au correcteur (B9 : 42,3 % en m3 ; C10, qui visait aussi [52, 56], est à 49,3 %). Le biais du sort, constant
  depuis t4, est corrigé par le texte. Pertes : le chevalier (41,3 %) et le géant (42,3 %), alors que son banc voyait la
  mini P.E.K.K.A à 47,8 % comme seul défaut. En m4, le géant est sous 47 % dans les 4 bras (41,7 à 46,0 %).
- **Bruit du correcteur : c'est le plancher de l'équilibrage.** Le correcteur mesure chaque carte sur 300 parties.
  L'écart-type d'un taux vrai de 50 % y vaut 2,9 points, donc une carte parfaitement au centre sort de [45, 55] environ
  1 fois sur 12. L'écart J1/J2 de c-1 (4,3 points au correcteur, miroir exact sur 50 graines chez lui) est de cet ordre.
  Les 0,2 point perdus par C10 sont indiscernables du bruit.
- **Le coût est dans le contexte de la 2e moitié du bras.** Chez les 3 bras kit, le contexte passe de 55 k (appel 1 :
  sys effectif et mémoire) à environ 150 k à la fin du moteur, puis à 267-303 k après le client. b-1 : les 29 derniers
  appels (34 à 62) se font tous au-dessus de 200 k, et 9 d'entre eux sont des remplacements PowerShell d'une ligne.
  c-1 : après l'appel 29, 37 appels entre 180 et 303 k, y compris des retouches de cartes et la validation de
  l'équilibre (appels 43-44 et 59-62). Côté tokens : lecture du cache 46-50 %, sortie 37-40 %, écriture du cache 13-14 %
  (prix relatifs).

### B (texte) = VARIANTE B11 — `sys-b.txt`, 36 048 octets (B10 + `moi/add-b11.txt`)
*Hypothèse : B10 est bon sur les règles et sur le sort. Il lui manque deux choses dites en mots (des tours qui tiennent
20 s + 20 s contre une poussée seule, le géant visé dans [51, 54]) et une discipline de coût : corriger par lots, et
valider l'équilibre AVANT le client, pour que les appels chers ne se fassent plus à 280 k de contexte. Ce texte doit
rendre le 52 pour ≤ 6,8 $, soit −30 % par rapport à A : la seule voie par laquelle la règle peut encore adopter une
variante.*
Prédiction : 52/52, ≤ 6,8 $, ≤ 50 appels du modèle, géant ≥ 45 % au correcteur.

### C (outil/procédure) = PROCÉDURE C11 — `sys-c.txt`, 39 103 octets (C10 + `moi/add-c11.txt`)
*Hypothèse : le coût de C vient du client, qui reste dans le contexte principal jusqu'à la fin (62 k caractères, plus
20 k de fumée). Un SOUS-AGENT unique, au premier plan et sur le même modèle, écrit le client et la fumée dans un
contexte neuf, à partir d'un brief qui recopie l'interface. Le bras principal ne relit pas ce code : il rejoue
`verifier.mjs --complet`. Ajouts : `tests/tenue.luau` (tours 20 s + 20 s), l'équilibre clos avant le sous-agent, et
aucune commande dépensée sur un écart J1/J2 que le miroir dit exact.*
Prédiction : 52/52, 35/35, ≤ 6,8 $, contexte principal sous 200 k à la fin. Si C11 coûte plus que C10, alors le
sous-agent paie en sortie ce qu'il épargne en contexte : il faut revenir au client dans le fil principal et ne garder
que la tenue.

### Lecture prévue
- B11 ou C11 à ≥ 50,9 pour ≤ 6,8 $ : il est adopté par la règle des 30 %. « Valider l'équilibre avant le client » et
  « corriger par lots » deviennent des règles de la skill build.
- C11 moins cher que B11 à note égale : le levier de coût est le contexte, et il faut un découpage en sous-agents dans
  build, pas du texte.
- Aucun des deux sous 7 $ : le coût d'un bras kit est incompressible vers 8 $ à une réplique. La règle d'adoption doit
  alors être revue par l'humain (réserve ci-dessus).

### Causes Autowin OS repérées
1. **Mémoire d'Autowin OS lue par les 4 bras (m2 et m3, cause non corrigée).** Chaque journal commence par 3 `Read` de
   `~\.claude\projects\D--AutoWinOS\memory\arenagame-*.md`, X compris ; b-1 et c-1 ont ensuite ÉCRIT dans
   `memory/arenagame-banc-lecons.md` (b-1 appel 61, c-1 appel 65). Cause : `D:\AutoWinOS\.arena\arenagame\lance-bras.sh:19`
   (`cd "$BANC/$BRAS"`, un dossier du dépôt `D:\AutoWinOS`). Le contexte de départ monte ainsi à 55 k dès l'appel 1.
2. **JUDGE injecté contre « Aucun sous-agent » (m1, m2, m3, non corrigée).** `lance-bras.sh:30-32` ajoute la skill judge.
   a-1 a lancé 2 juges Sonnet et 3 tâches de fond, contre `m4/sys-a.txt:184` (« Aucun sous-agent ») et `:187` (« au
   premier plan »). Pas de `ScheduleWakeup` cette fois.
3. **Tours et durée faux dans `out-a-1.json`** (3 tours, 78 s, pour 51 min et 58 appels). `lance-bras.sh:80-81` somme le
   `result` du dernier segment, qui suit les tâches de fond. Même cause que m1, m2 et m3.
4. **Message d'échec trompeur (banc, pas Autowin OS ; noté sans rien modifier).** `cache/regles.luau:350-351` rend « pose
   refusée du côté de la princesse détruite » alors que le refus vient de `"partie terminee"` : un lecteur qui corrige
   la zone de pose de a-1 corrigerait un code juste. Le motif rendu par `jouer` n'est pas relevé dans le message.
5. **Plancher de bruit de l'équilibrage (banc).** `cache/equilibrage.luau:129` (`N = 150`, soit 300 parties par carte) :
   écart-type de 2,9 points par carte. Avec 8 cartes, la note d'équilibrage d'un jeu parfaitement réglé fluctue de 0 à
   environ 0,5 point. C'est l'ordre de grandeur de TOUS les écarts auto de la nuit. Le banc ne peut plus départager
   A/B/C par la note auto. Il faut 2 répliques, ou mesurer les 48 points juge.
6. **X sans RUN.md** (journal) : attendu pour l'appel nu.

Nettoyage : copies extraites dans `m4/ameliore/moi/{a,b,c,x}-1` et scripts de lecture (`stats.js`, `cout.js`, `fil.js`)
effacés après lecture ; l'archive `m4.bras.tar` reste la source. `moi/add-b11.txt` et `moi/add-c11.txt`, les ajouts de
B11 et C11, sont conservés.

## m5
Bras : A = B6 (`m4/ameliore/sys-a.txt`, SHA-256 D30983B2…), B = B11 (texte), C = C11 (C10 + client écrit par un sous-agent +
tenue), X = appel nu. Une réplique par bras, lancés à 00:34. L'améliorateur a lu `note-*.json`, `out-*.json`,
`out-*.tentatives.jsonl`, `attente-*.txt`, les journaux de session (`~\.claude\projects\D--AutoWinOS--arena-…-m5-<bras>-1\*.jsonl`)
et le code extrait de `m5.bras.tar`.

### Les 4 bras ont été coupés, et le coût annoncé est faux
Entre 00:52 et 00:54, les 4 bras ont reçu « You've hit your session limit · resets 2:50am » (`attente-*.txt`).
`lance-bras.sh` a attendu environ 2 h, puis a repris chaque session (`reprises=1` ×4). Deux conséquences :
1. **Le coût de la reprise est compté deux fois.** Le `total_cost_usd` que rend `claude -p --resume` est CUMULÉ sur
   toute la session, et non limité à la reprise. Preuve dans `out-a-1.tentatives.jsonl` : pour Opus, le segment 2
   annonce 7 439 605 jetons relus dans `modelUsage`, soit exactement 3 236 245 (segment 1) + 4 203 360 (`usage` du
   segment 2). Même égalité chez b-1 : 1 335 807 + 5 079 322 = 6 415 129. `lance-bras.sh:80` additionne les segments.
   Le coût réel est celui du DERNIER segment. `num_turns` et `duration_ms`, eux, sont par segment (a-1 : 42 puis 24
   tours), et leur somme est juste.
2. **La reprise renchérit elle-même.** Après 2 h d'attente, le cache (durée 1 h) a expiré. Le premier appel de la reprise
   réécrit donc tout le contexte, à 8 $ par million de jetons : environ 1,50 $ pour a-1 (188 k), 1,16 $ pour b-1
   (145 k) et 1,29 $ pour c-1 (161 k).

Prix par million de jetons (Opus 5.5), retrouvés par résolution exacte sur les segments 1 de a, b et c : sortie
**20 $**, écriture du cache (1 h) **8 $**, relecture du cache **0,2 $**.

### Notes (auto /52, check.mjs) et coûts
| bras | note | règles | équilibrage | boutique | $ annoncé (journal) | **$ réel** | $ réel sans la reprise (estimation) | appels (fil principal) | sous-agents | échecs check.mjs |
|---|---|---|---|---|---|---|---|---|---|---|
| A (B6) | 51,2 | 34/35 | 9,6 | 6 | 12,80 | **9,03** | ≈ 7,5 | 46 | 1 Sonnet, 1er plan (0,95 $) | pose acceptée sur la tour en (9, 3) ; géant 42,0 %, boule de feu 44,3 % |
| B (B11) | **52** | 35/35 | 10 | 6 | 10,25 | **7,83** | ≈ 6,7 | 39 | 2 Haiku, 1er plan (≈ 0,4 $) | aucun ; cartes entre 45,3 et 54,7 %, écart J1/J2 2,0 |
| C (C11) | 51,9 | 35/35 | 9,9 | 6 | 15,44 | **12,40** | ≈ 11,1 | 59 | 1 Opus « client + fumée », 24 min (≈ 4,9 $) | boule de feu 43,0 % |
| X (nu) | 51,0 | 34/35 | 9,9 | 5,5 | 22,30 | **15,94** | — | 52 | 3 en fond (Sonnet, Opus, Sonnet) | pose sur la tour en (9, 3) ; « achats répétés jusqu'à épuisement exact : 3 attendus, 1 obtenu » |

Où part le dollar, chez b-1 (appels Opus, 7,44 $) : 3,1 $ de sortie (157 k jetons, dont environ 50 k de fichiers),
3,0 $ d'écriture du cache (377 k jetons, dont 145 k pour la reprise), 1,3 $ de relecture (6,4 M jetons). **Ce que le
modèle écrit fait 80 % du coût.** Chez a-1 : 8,08 $ d'Opus, plus 0,95 $ pour son juge Sonnet.

Cumul de B6 (7 bras : t4 b-1 et b-2, m1 à m5) : **51,24** pour **9,61 $** réels. Sur m2-m5 (4 manches, coûts réels) :
| lignée | notes | moyenne | $ moyen |
|---|---|---|---|
| A = B6 | 50,9 · 50,4 · 50,9 · 51,2 | 50,85 | 9,93 |
| B (B8 → B11) | 51,6 · 50,8 · 51,4 · 52 | 51,45 | **8,04** |
| C (C8 → C11) | 51,9 · 51,7 · 51,8 · 51,9 | **51,83** | 10,08 |

### Gagnant : A reste B6
- B11 : +0,8 point, donc moins de 2. Côté coût : −20 % sur les coûts annoncés (10,25 contre 12,80 $), −13 % sur les
  coûts réels (7,83 contre 9,03 $), −11 % sans les reprises (≈ 6,7 contre ≈ 7,5 $). Aucun n'atteint −30 % : pas adopté.
- C11 : +0,7 point et +37 % de coût réel : pas adopté.
- `m5/ameliore/sys-a.txt` est la copie octet pour octet de `m5/sys-a.txt` (SHA-256 D30983B2…).
- Réserve (4e manche de suite, après m2, m3 et m4) : B6 est le plus faible des trois bras kit, et il rate la pose sur une
  tour 4 fois sur 4. Sur m2-m5, la lignée B fait +0,6 point pour −19 % de coût. La règle d'adoption par manche ne peut
  pas le voir : la note sature (bruit de l'équilibrage ≈ 0,5 point), et le coût varie de ±30 % d'une manche à l'autre,
  voire +40 % quand une coupure force une reprise. À trancher par l'humain : adopter la lignée B sur 4 manches de
  domination, ou juger A sur des moyennes de lignée.

### Où partent les points et les dollars
- **A : pose sur une tour, 4e fois.** `a-1/src/shared/Partie.luau:138-153` (`_zoneLegale`) ne teste que la moitié de
  terrain et la poche d'une princesse détruite, jamais l'emprise des tours. B6 ne dit pas cette règle. Tous les bras
  dont le texte la dit la passent (B8 à B11, C8 à C11).
- **X : un refus inventé dans la boutique.** `x-1/src/shared/Boutique.luau:239` refuse une offre `unique` déjà possédée
  (« deja possede »). C'est le piège que le bloc « VARIANTE B » du kit dit en mots depuis la nuit du 2026-09-22 (m1) :
  les bras kit le passent, l'appel nu non.
- **B11 : ses 4 consignes ont tenu.** Règles à 35/35. Géant à 54,3 % (visé [51, 54] ; 41,7 à 46,0 % dans les 4 bras de
  m4). Boule de feu à 54,7 %. Tenue des tours (aucune règle de poche perdue). 39 appels, donc sous sa cible de 50.
  Seule la cible de coût (≤ 6,8 $) est manquée : 7,83 $ réels, environ 6,7 $ sans la reprise.
- **C11 : le sous-agent client est une perte nette.** Lancé à l'appel 42 (211 k de contexte), il a tourné de 01:16 à
  01:40 et coûté environ 4,9 $ (9,36 $ pour la reprise, moins 4,44 $ pour le fil principal recalculé depuis `usage`). Le
  contexte principal a continué de monter (237 k à la fin) : le moteur, les 6 outils de test et le serveur y étaient
  déjà. C'est la branche prévue en m4 : « si C11 coûte plus que C10, revenir au client dans le fil principal ».
- **Le modèle de coût des améliorateurs précédents était faux.** B11 point 4 et C11 point 1 supposaient que relire un
  gros contexte coûte cher. Aux prix mesurés ci-dessus, un appel à 250 k relit pour 0,05 $, alors que 5 000 jetons de
  réflexion coûtent 0,10 $ et que chaque jeton neuf dans le contexte coûte 8 $ par million.

### B (texte) = VARIANTE B12 — `sys-b.txt`, 38 969 octets (B11 + `moi/add-b12.txt`)
*Hypothèse : B11 a atteint 52/52. Son coût est aux 4/5 dans ce que le modèle écrit (réflexion, fichiers, cache neuf),
et non dans ce qu'il relit. Des consignes qui visent l'écriture doivent faire baisser le coût sans perdre de point :
- réfléchir court et trancher par une mesure ;
- écrire chaque fichier une seule fois, puis procéder par `Edit` groupés (plus de réécriture complète) ;
- des tests en table ;
- un seul juge `haiku` ;
- des sorties de commande réduites aux KO.*
Prédiction : 52/52, au plus 110 k jetons de sortie (B11 : 157 k), au plus 6 $ sans coupure (7,2 $ avec reprise).

### C (outil/procédure) = PROCÉDURE C12 — `sys-c.txt`, 43 424 octets (C11 + `moi/add-c12.txt`)
*Hypothèse : C10 et C11 ont gardé les règles à 35/35. Le surcoût de C11 vient de son sous-agent. Le client revient
donc dans le fil principal, et la tenue reste. Nouvel outil : `outils/cout.mjs`, un compteur qui lit le journal de la
session du bras et donne son coût à chaque étape, face à des budgets cumulés (2,5 · 4 · 5 · 6,5 · 7 $). Un bras qui
voit son compteur dépense moins qu'un bras qui suit une consigne de sobriété à l'aveugle.* Le compteur est vérifié sur
les journaux de m5 : pour les appels Opus, il retrouve la facture au centime près (a-1 8,08 $, b-1 7,44 $).
Prédiction : 51,8 ou plus, au plus 8 $ réels sans coupure, aucun sous-agent, 5 lignes `COUT` dans le RUN.md.

### Lecture prévue
- B12 à 52 pour ≤ 6 $ : le levier du coût est l'écriture. « Réfléchir court, écrire une fois, tests en table »
  deviennent des règles de la skill build.
- C12 ≤ B12 en coût à note égale : un compteur visible vaut mieux qu'une consigne. `cout.mjs` devient un outil du kit,
  lancé par build à chaque étape.
- Nouvelle coupure de session : il faut comparer les coûts réels (dernier segment), pas les `out-*.json`, tant que la
  cause 1 ci-dessous n'est pas corrigée.

### Causes Autowin OS repérées
1. **Coût double compté après une reprise.** `D:\AutoWinOS\.arena\arenagame\lance-bras.sh:80` additionne le
   `total_cost_usd` de chaque segment, alors que `claude -p --resume` rend un coût cumulé sur toute la session (preuve
   ci-dessus). `lance-bras.sh:46` fait la même somme pour calculer le budget restant, qu'elle sous-estime. Le chiffre
   faux se propage à `nuit.sh:47-50` (journal), `nuit.sh:48` (`historique.jsonl` : 12,80 · 10,25 · 15,44 · 22,30 au lieu
   de 9,03 · 7,83 · 12,40 · 15,94) et `nuit.sh:17-18` (`depense`, que `stop` compare au budget de nuit : la nuit s'arrête trop tôt). Correctif (hors de ce
   rôle) : prendre `total_cost_usd` du dernier segment, et garder les sommes de `num_turns` et `duration_ms`.
2. **Coupure de session sur les 4 bras à la fois (00:52-00:54).** Ce n'est pas un défaut d'un bras. 4 bras parallèles
   plus l'améliorateur partagent le même compte. La reprise de `lance-bras.sh:59-71` attend la remise à zéro (environ
   2 h), plus que la durée du cache (1 h) : chaque reprise réécrit tout le contexte (1,2 à 1,5 $ par bras). Les coûts
   d'une manche coupée ne se comparent donc pas à ceux d'une manche entière. **Non corrigeable dans le kit**, à noter à
   chaque manche.
3. **Mémoire d'Autowin OS lue par les 4 bras, et écrite (m2, m3, m4 : non corrigé).** Les 3 premiers `Read` de chaque
   journal portent sur `~\.claude\projects\D--AutoWinOS\memory\arenagame-*.md`, X compris. b-1 (appel 38) et c-1
   (appel 58) y ajoutent leurs leçons par `Add-Content`. Cause : `lance-bras.sh:19` (`cd "$BANC/$BRAS"`, un dossier du
   dépôt `D:\AutoWinOS`).
4. **JUDGE injecté contre « Aucun sous-agent » (m1 à m4, non corrigé, forme atténuée).** a-1 a lancé 1 juge Sonnet au
   premier plan (0,95 $), contre `m5/sys-a.txt:184`. Il n'y a plus ni tâche de fond ni `ScheduleWakeup` chez a-1 cette
   fois. Cause : `lance-bras.sh:30-32`.
5. **Le prompt de l'améliorateur ne donne aucun modèle de coût.** `nuit.sh:25-26` demande de « viser les points
   perdus ». Or la note sature et c'est le coût qui départage. Les améliorateurs m3 et m4 ont donc déduit un modèle de
   coût faux (relire serait cher). B11 point 4 et le sous-agent de C11, à environ 4,9 $, en sont sortis. Correctif
   possible (hors de ce rôle) : écrire les prix (sortie 20 $, cache écrit 8 $, cache relu 0,2 $ par million) dans
   `nuit.sh:25`, ou joindre `moi/cout.mjs` au dossier de nuit.
6. **Libellé de date faux dans `historique.jsonl`.** `nuit.sh:48` écrit `nuit-$(date +%F)-m$k` au moment de la notation :
   m5, noté après minuit, porte `nuit-2026-09-26-m5`, alors que le dossier est `nuit-2026-09-25`. Correctif : dériver le
   libellé de `$NUIT`.
7. **Aucun refus de permission** (`permission_denials: []` ×4). **X sans RUN.md** (`statut.txt`) : attendu pour
   l'appel nu.

Nettoyage : les copies extraites dans `m5/ameliore/moi/{a,b,c,x}-1` et les scripts de lecture (`stats.js`, `fil.js`) sont
effacés après lecture ; l'archive `m5.bras.tar` reste la source. Sont conservés : `moi/add-b12.txt`, `moi/add-c12.txt`
(les ajouts de B12 et C12), et `moi/cout.mjs` (le compteur testé).

## m6
Bras : A = B6 (SHA-256 D30983B2…), B = B12 (texte), C = C12 (C11 sans sous-agent client, + compteur `outils/cout.mjs`), X = appel nu.
Une réplique par bras, lancés à 04:04, aucune reprise. Pas d'améliorateur : la nuit a été arrêtée à la main après la notation
(conv-826, 2026-09-26 05:36, « fini ce banc » ; seul le pid de `nuit.sh` a été arrêté, les 4 `lance-bras.sh` ont fini seuls).
Notes = `note-clore-<b>-1.json` (même `check.mjs`, lancé par `lance-bras.sh`), recopiées en `note-<b>.json`.

### Notes (auto /52, check.mjs) et coûts
| bras | note | règles | équilibrage | $ réel | jetons de sortie (Opus) | tours · min | juges | échecs check.mjs |
|---|---|---|---|---|---|---|---|---|
| A (B6) | 51,3 | 34/35 | 9,7 | 9,03 | 165 k | 66 · 48 | 1 Sonnet (2,22 $) | pose acceptée sur la tour en (9, 3) — **5e manche sur 5** |
| B (B12) | 51,7 | 35/35 | 9,7 | **7,42** | 159 k | 89 · 61 | 1 Haiku (0,21 $) | valkyrie 41,0 % |
| C (C12) | **52** | 35/35 | 10 | 10,42 | 230 k | 98 · 89 | 0 | aucun |
| X (nu) | 49,4 | 32/35 | 8,7 | 13,38 | 302 k | 71 · 90 | — | victoire aux couronnes à la fin du temps, mort subite en prolongation, pose sur la tour |

### Hypothèses de m5 : réfutées sur le coût
- **B12** visait ≤ 110 k jetons de sortie et ≤ 6 $ : **159 k** (B11 : 157 k) et **7,42 $**. « Réfléchis court, écris une fois, tests en
  table » n'a pas fait baisser ce que le modèle écrit. La consigne « un seul juge Haiku » a tenu (0,21 $).
- **C12** visait ≤ 8 $ et 5 lignes `COUT` dans son RUN.md : **10,42 $** et **2** lignes. Le compteur visible n'a pas fait dépenser moins.

### Lignées sur m2-m6 (coûts réels, 1 réplique par manche)
| lignée | notes | moyenne | $ moyen | bat A en note ET en coût |
|---|---|---|---|---|
| A = B6 | 50,9 · 50,4 · 50,9 · 51,2 · 51,3 | 50,94 | 9,75 | — |
| B (B8 → B12) | 51,6 · 50,8 · 51,4 · 52 · 51,7 | 51,50 | **7,92** | **5 manches sur 5** |
| C (C8 → C12) | 51,9 · 51,7 · 51,8 · 51,9 · 52 | **51,86** | 10,14 | 3 sur 5 en coût, 5 sur 5 en note |

## Clôture de la nuit (conv-826, 2026-09-26)

### Dispersion mesurée
Une seule réplique par bras et par manche : la dispersion intra-bras n'est pas mesurée directement. Substitut : A (B6), rejoué à
l'identique 5 fois (m2-m6), varie de 50,4 à 51,3 en note (0,9 point) et de 9,03 à 10,51 $ en coût (16 %). Les écarts de coût
entre lignées (−19 % pour B, +4 % pour C) restent sous le plancher de 30 % de la skill arena : **non concluants en coût seuls**.

Écart hors bruit : la règle cachée « pose refusée sur une tour » — A la rate **5 fois sur 5** (m2-m6), tout bras B ou C dont le
texte la dit la passe (10 sur 10). C'est un résultat CATÉGORIEL, et c'est lui, plus la domination de B sur les deux axes à chaque
manche, qui fonde l'adoption.

### Gagnant : la lignée B — A = B12 (`m6/sys-b.txt`) pour la prochaine nuit
Décision humaine (l'utilisateur : « fais les upgrades de workflow »), que les améliorateurs de m2 à m5 renvoyaient à l'humain.
`nuit.sh` démarre désormais de `essais/nuit-2026-09-25/m6`, et la règle d'adoption de l'améliorateur accepte une lignée qui bat A
sur les deux axes 3 manches de suite. X (appel nu) ne gagne pas : dernier ou avant-dernier en coût à chaque manche.

### Éditions d'Autowin OS (non commitées)
| fichier | cause corrigée | preuve |
|---|---|---|
| `.arena/arenagame/lance-bras.sh` | coût d'une reprise compté deux fois (m5, cause 1) : coût = plus grand segment, budget restant idem | faux `claude` coupé puis repris (3,78 → 9,03 $) : `out.json` = 9,03 $, 66 tours, budget de reprise 36,22 $ |
| `.arena/arenagame/lance-bras.sh` | mémoire d'Autowin lue par les 4 bras, X compris (m2-m5, cause « lance-bras.sh:19 ») : `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | `claude -p` depuis `essais/` : section « auto memory » citée sans la variable, ABSENT avec ; doc https://code.claude.com/docs/en/memory |
| `.arena/arenagame/lance-bras.sh` | JUDGE injecté contre « Aucun sous-agent » (m1-m5) : le workflow du bras prime, juges au premier plan | ligne présente dans `sys-effectif` du test à blanc |
| `.arena/arenagame/nuit.sh` | libellé de date faux dans `historique.jsonl` (m5, cause 6) ; règles de jeu inventées par l'améliorateur (m1 et m3) ; règle d'adoption par lignée ; source par défaut | `bash -n` ; nuit à blanc (0 manche, faux `claude`) : code 0, consigne relue dans `m0/ameliore/prompt.txt` |
| `skills/judge/SKILL.md` | « en parallèle » lu comme « en fond » : juges `run_in_background` + `ScheduleWakeup` (A, m2-m4) | 10 fichiers de tests des skills verts ; 1 rouge antérieur et sans rapport (`kit-cliquets` : descriptions de `gc` et `maintenance`) |
| `skills/build/SKILL.md` | réflexe 4 bis, jumeau d'acceptation de chaque refus (m3 : −0,9 par un refus trop large ; 35/35 ensuite) | idem |
| `historique.jsonl` | m5 : coûts réels et libellé `nuit-2026-09-25-m5` (ancien chiffre gardé en `cout_annonce_usd`) ; lignes m6 ajoutées | diff relu |

### Frictions non localisées
- Refus de permission sur des réécritures de fichiers par script (t4, m1, m3) : règle de permission non trouvée.
- `num_turns` et `duration_ms` d'un bras qui lance des tâches de fond ne couvrent que le dernier segment (m1-m4) : non corrigé,
  les tours réels se lisent dans le journal de session.
- Les consignes de coût (B12, C12) n'ont rien fait baisser : ce qui fait écrire 160 k jetons au modèle n'est pas localisé.

### Effacé / conservé
Effacé : les copies `m6/{a,b,c,x}-1` (manifeste), après archive `m6.bras.tar` relue (131 fichiers sur 131). Les manches m1-m5
l'avaient été par `nuit.sh`. Conservé : `m<k>.bras.tar`, notes, `out-*`, `sys-*`, journaux, `runs/`, ce RUN.md.

### Discrimination
Écart JEU entre bras en m6 : 49,4 à 52 (2,6 points sur 52), et 0,7 point entre les trois bras kit : **banc à durcir**. La note
auto est saturée ; seuls une règle cachée ratée et le coût séparent encore les workflows. Les 48 points juge restent non mesurés.

### Leçon retenue (remember, conv-826)
Sur m2-m6, la lignée B bat le témoin B6 en note ET en coût 5 manches sur 5 (51,50 contre 50,94 ; 7,92 contre 9,75 $ réels) ;
seul écart hors bruit : B6 accepte la pose sur une tour 5 fois sur 5. Les consignes de coût (B12, C12) n'ont rien fait baisser
(159 k jetons de sortie contre 157 k). Jusqu'au 2026-09-26, le lanceur faussait trois mesures : coût d'une reprise compté deux
fois (`--resume` cumule), mémoire automatique du dépôt lue par tous les bras (X n'était pas un appel nu), JUDGE injecté contre
« aucun sous-agent ».

### Contrôle du protocole (`npm run arena:protocole`, 2026-09-26)
Premier passage : **PROTOCOLE NON TENU** (17 RATE sur 22). La plupart tiennent à la forme d'une nuit : le contrôle attend
`prompt-<b>.txt` et `out-<b>.json` à la racine d'un seul tournoi, la nuit les range par manche (P4-P8, P10, P11, P16, P17, P21).
Trois manques sont réels. Il n'y a pas de juge externe distinct des bras (P9), et c'est irrattrapable après coup. Aucun critère
binaire n'est déclaré dans ce RUN.md (P2, P3, P20) : `check.mjs >= 30/52` sert de critère sans y être écrit avant le lancement.
Les duels (P15) et la leçon (P12) sont ajoutés à la clôture.
Second passage, `--bench essais/nuit-2026-09-25/m6` (le dossier qui porte les prompts et les `out-*` d'une manche) :
**PROTOCOLE NON TENU, 10 OK / 12 RATE** — P4, P5, P12, P15, P17, P21 passent ; restent P9 (aucun juge externe), P2/P3/P20
(critère non déclaré avant le lancement), et des écarts de forme d'une nuit (lanceur `nuit.sh` hors du dossier de manche : P6,
P7, P13 ; tableau au format arena : P8, P10, P11 ; pas de section de candidats : P1, P16).
**Critère binaire** : `node .arena/arenagame/check.mjs <bras>` rend 0 (auto ≥ 30/52) — déclaré ici APRÈS coup, donc sans valeur
de pré-déclaration.
