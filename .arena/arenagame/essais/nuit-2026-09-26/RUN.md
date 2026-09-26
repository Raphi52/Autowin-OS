## m0

Améliorateur sur la source déjà notée `essais/nuit-2026-09-25/m6` (bras extraits de `m6.bras.tar` dans `m0/ameliore/moi/`).

### Notes de m6 (check.mjs, auto /52) et coûts réels (`total_cost_usd`, 0 reprise)
| bras | note | règles | équilibrage | $ | tours | décomposition (modelUsage) | échecs check.mjs |
|---|---|---|---|---|---|---|---|
| A (B6) | 51,3 | 34/35 | 9,7 | 9,03 | 66 | Opus 6,80 + Sonnet 2,22 | pose acceptée sur la tour en (9, 3) |
| B (B12) | 51,7 | 35/35 | 9,7 | **7,42** | 89 | Opus 7,22 + Haiku 0,21 | valkyrie 41,0 % |
| C (C12) | **52** | 35/35 | 10 | 10,42 | 98 | Opus 10,42 | aucun |
| X (nu) | 49,4 | 32/35 | 8,7 | 13,38 | 71 | Opus 13,38 | victoire aux couronnes à la fin du temps, mort subite, pose sur la tour ; durée médiane 299,5 s |

Décomposition Opus, sans supposer de prix : les coefficients sortie 20, cache écrit 8, cache relu 0,2 $/M jetons (plus
entrée 4) retrouvent au centime le `costUSD` Opus de A, B et C (6,801, 7,216, 10,416), mais pas celui de X (14,98
calculé contre 13,38). Pour B : sortie 3,17 $ (159 k), cache écrit 2,00 $ (251 k), relu 2,04 $ (10,2 M). La relecture
fait 28 % du coût Opus, pas les 20 % qu'affirme B12.

### Gagnant et A de la prochaine manche
**A = B12, imposé par l'humain** : `sys-a.txt` = copie exacte de `nuit-2026-09-25/m6/sys-b.txt`, écrite par le script,
pas par moi. La règle d'adoption donne le même résultat. B12 contre B6 en m6 : +0,4 point et −18 % de coût, donc ni la
règle des 2 points ni celle des 30 % ne jouent. Mais la règle de lignée joue : la lignée B bat A en note ET en coût en
m4 (51,4 / 8,32 contre 50,9 / 9,72), en m5 (52 / 7,83 contre 51,2 / 9,03) et en m6 (51,7 / 7,42 contre 51,3 / 9,03). La
lignée C ne passe pas cette règle : en m5 elle coûte plus que A (12,40 contre 9,03). **`sys-b.txt` et `sys-c.txt` sont
des variantes de CE texte (B12)**, pas de B6 ni de C12 : chacun est B12 mot pour mot, plus un bloc final.

### Hypothèse de B13 (texte) : viser le centre et borner le réglage, pour le même 51,7 moins cher
Dans son RUN.md, b-1 a fait 10 passes d'équilibrage, puis une 11e après CLEAN, annulée. Il cherchait les « visées
hautes » de B10 et B11 (boule de feu [52, 56], géant [51, 54]), ne les a pas atteintes (50,3 et 50,7), et s'est déclaré
`red` pour ça. Or le correcteur l'a noté 54,0 et 53,3, dans la bande et au-dessus de sa mesure. La carte qui sort au
correcteur change à chaque manche, et ce n'est jamais celle qu'on vise (m2 archères, m4 chevalier et géant, m6
valkyrie). B13 annule les décalages et donne pour toutes les cartes une moyenne dans [47, 53], avec les cases dans
[43, 57], à au moins 800 parties par case. Il plafonne l'équilibrage à 4 passes numérotées, interdit toute passe après
le client ou après CLEAN, et interdit un critère de succès que le correcteur ne mesure pas.
Prédiction : ≥ 51,7, ≤ 6,5 $, ≤ 4 passes, ≤ 75 tours.

### Hypothèse de C13 (outil/procédure) : c'est la forme du banc de C qui fait ses points d'équilibrage, pas le reste de ses outils
Sur m2-m6, C bat B seulement sur l'équilibrage (moyenne 9,86 contre 9,68), mais coûte 10,14 $ contre 7,92 $. En m6, c-1 a
écrit 15 fichiers de tests et d'outils, et b-1 8. C13 = B12 plus le seul banc de c-1, tel qu'il est dans son code : deux
familles de politiques dans un seul pool, avec l'écart entre familles comme verdict (`c-1/outils/equilibre.mjs:12`,
`:63`) ; un pas de temps varié de 0,1 à 0,3 s (`c-1/outils/banc.luau:14`, `:26`), alors que b-1 avançait toujours de 0,1 s
(`b-1/tools/duel.luau:53`) ; le siège de la favorite alterné (`c-1/outils/banc.luau:21`). C13 impose la famille « contre »
dès la première commande, parce que c'est elle qui a trouvé le défaut du pont de c-1 (son RUN.md, l. 77), et au plus 6
commandes. Il ne reprend ni sonde, ni miroir, ni tournoi de sorts, ni compteur de coût. Prédiction : 10/10 en
équilibrage, 52/52, ≤ 8 $.
Règles de jeu chiffrées ou géométriques ajoutées : aucune nouvelle. Les seuls chiffres ajoutés sont des bandes de banc
et des budgets de commandes. La pose « derrière le roi » de la famille « fond du camp » s'appuie sur l'emprise ouverte de
`b-1/src/shared/Partie.luau:137`, un bras à 35/35.

### Causes Autowin OS repérées
1. `.arena/arenagame/clore-run.mjs:275-276` écrase le `status:` que le bras a posé lui-même. b-1 avait écrit `red` (son
   RUN.md, l. 81 : « status: red à cause de lui seul »), et l'en-tête dit maintenant `green` (l. 3). Le verdict déclaré
   par le bras est perdu, alors que la note AUTOWIN « preuve honnête » (skill arenagame § 3) le compare à check.mjs.
   Piste, non appliquée (hors de mon périmètre) : garder l'ancien statut dans une ligne `status_bras:` avant d'écraser.
2. `.arena/arenagame/lance-bras.sh:34-39` colle CLEAN et JUDGE en entier derrière le workflow. `sys-effectif-b-1.txt` fait
   74 851 octets pour un `sys-b.txt` de 38 969 : le bloc JUDGE seul fait 210 lignes (l. 373-582), alors que B12 limite la
   relecture à un seul juge `haiku`. Ce texte se relit à chaque tour, soit environ 10 k jetons × 89 tours ≈ 0,9 M, et
   ≈ 0,2 $ par bras aux coefficients ci-dessus. L'effet est faible, mais le texte contredit le workflow. La l. 42 dit
   que le workflow prime, et c'est ce qu'a fait b-1 (1 seul juge).
3. Non localisée : pourquoi la valkyrie de b-1 tombe à 41,0 % au correcteur alors que son banc à 5 styles la voyait avec
   toutes ses cases ≥ 46,9 % (son RUN.md, l. 72-73). Ses stats (`b-1/src/shared/Cartes.luau:34-35`) sont proches de celles
   de c-1 (`c-1/src/shared/Cartes.luau:110-117`, 52,3 %), donc l'écart vient du moteur ou du banc, pas de la carte.
   C13 teste l'hypothèse du banc.

## m1

Améliorateur de m1. Bras extraits de `m1.bras.tar` dans `m1/ameliore/moi/`, avec les sondes de l'améliorateur dans
`m1/ameliore/moi/sonde/` (banc « contrat seul », tenue sur deux voies).

### Notes (check.mjs, auto /52) et coûts réels (`total_cost_usd`, 0 reprise pour les 4 bras)
| bras | note | règles | équilibrage | boutique | $ | tours | décomposition (modelUsage) | échecs check.mjs |
|---|---|---|---|---|---|---|---|---|
| A (B12) | **51,6** | 34/35 | **10** | 6 | 6,83 | 59 | Opus 6,51 + Haiku 0,32 | « la carte jouée revient après 4 autres coups : impossible de jouer le coup 4 » |
| B (B13) | 51,3 | 35/35 | 9,3 | 6 | **5,89** | 54 | Opus 5,59 + Haiku 0,30 | géant 40,3 %, boule de feu 42,0 % |
| C (C13) | 51,2 | 35/35 | 9,2 | 6 | 6,19 | 76 | Opus 5,81 + Haiku 0,38 | mousquetaire 40,0 %, mini P.E.K.K.A 59,7 % |
| X (nu) | 49,2 | 33/35 | 8,6 | 5,5 | 9,32 | 53 | Opus 9,32 | tour la plus abîmée en fin de prolongation ; pose sur la tour en (9, 3) ; boule de feu 36,8 %, mini P.E.K.K.A 65,0 % ; achats répétés jusqu'à épuisement |

Jetons Opus (sortie / cache écrit / cache relu) : A 159 k / 228 k / 7,54 M ; B 135 k / 207 k / 6,24 M ; C 142 k / 212 k /
6,30 M ; X 253 k / 424 k / 7,80 M. B13 a produit 15 % de jetons de sortie de moins que B12.

### Gagnant et A de la prochaine manche : **A = B12, inchangé** (`sys-a.txt` identique octet pour octet à `nuit-2026-09-25/m6/sys-b.txt`)
- Règle des 2 points : non (B −0,3, C −0,4).
- Règle des 30 % : non. B est à moins de 1 point, mais coûte seulement 13,7 % de moins (5,89 contre 6,83 $). C coûte
  9,4 % de moins.
- Règle de lignée : non. B13 et C13 ouvrent une lignée sur A = B12, et ils ont une note INFÉRIEURE à A dans leur
  première manche. Le compteur de lignée repart de 0.

### Ce que disent les échecs (lu dans le code, sondes rejouées sous lune)
1. **a-1, −0,4 : les tours cèdent sur les deux voies.** Le cycle de a-1 est juste (`a-1/src/shared/Partie.luau:146-147`).
   Mais en rejouant le protocole du cas (graine 8), la partie est finie à 78,8 s : 3 couronnes, 5 troupes posées, J2
   passif. Le coup 4 est donc refusé (« partie terminée »). a-1 passait la tenue d'une voie de B11
   (`a-1/tests/regles.luau:440`). Ses tours sont celles du kit (`a-1/src/shared/Partie.luau:26-28`), et ses troupes
   frappent les tours à plein.
   Sonde « tenue deux voies », 8 graines : J1 pose en (9, 10) sa première troupe payable, J2 passif. Le roi tombe
   après 43 à 110 s et 5 à 14 poses chez a-1, 56 à 122 s et 6 à 15 poses chez c-1, 95 à 155 s et 10 à 22 poses chez b-1.
   b-1 : facteur de 0,5 contre les tours (`b-1/src/shared/Partie.luau:19`, `:297`), roi 4 800 pv et princesses 3 000 pv
   (`:25-26`).
2. **b-1 et c-1 : un bot de banc qui attend la favorite.** Chez b-1, `b-1/src/shared/Bot.luau:117-121` et `:162-163` ;
   chez c-1, `c-1/src/shared/Bot.luau:148-149`. Le correcteur voit alors des cartes à 10 points de leur banc : géant de
   b-1, banc 51,1 %, correcteur 40,3 % ; mousquetaire de c-1, banc 50,9 %, correcteur 40,0 %. Les bancs dont le bot joue
   la favorite seulement si elle est payable ont fait 10 (a-1 m1, `a-1/src/shared/Bot.luau:77-83`), et 9,7, 9,7 et 10
   en m6 de la nuit du 2026-09-25. Le point 3 de B6 (« posée dès qu'elle est payable ») est donc ambigu, et b-1 l'a
   commenté juste (`Bot.luau:2`) puis codé à l'envers.
3. **Hypothèse réfutée : un banc qui ne passe que par le contrat.** Le bot joue dès qu'il peut, en un point au
   hasard, et vise avec ses sorts l'unité la plus avancée (`sonde/banc-contrat.luau`, 400 parties par carte). Il ne
   retrouve PAS les écarts du correcteur : géant de b-1 à 51,0 %, mousquetaire de c-1 à 52,5 %. Je ne l'ai donc pas
   prescrit.
4. **Visées de B13 contre celles de B12.** B13 visait le centre : géant 40,3 % et boule de feu 42,0 %. Avec les visées
   hautes de B12, a-1 a eu 50,3 et 55,7 %, et c-1 49,0 et 56,0 %.

### Hypothèse de B14 (texte)
B12, plus quatre changements :
- la tenue sur deux voies en consigne : le roi tient au moins 90 s ET au moins 8 poses, sur 8 graines, d'après
  b-1:19/25-26/297 ;
- une phrase qui lève l'ambiguïté du favori (le favori ne fait jamais garder d'élixir) ;
- les visées de B12 rétablies (le point 1 de B13 est annulé) ;
- le plafond de 4 passes de B13 gardé, et un `red` interdit pour une simple marge de banc.
Prédiction : 35/35, équilibrage ≥ 9,7, ≥ 51,7, ≤ 6,5 $.

### Hypothèse de C14 (outil et procédure)
La consigne ne suffit pas, puisque B12 disait déjà « dès qu'elle est payable ». C14 = B12 plus une porte exécutable,
`tools/porte.luau`, en code 1 si l'un de ses deux cas est rouge : tenue sur deux voies, et « le bot n'attend jamais la
favorite ». Elle est lancée avant CHAQUE passe de banc. Le seul banc permis est celui de a-1 (10/10) :
`a-1/tests/banc.luau:52-66` et `a-1/tests/banc.ps1:8-14`. Il y a au plus 4 passes, et ni familles ni pas variés.
Prédiction : 35/35, équilibrage ≥ 9,7, ≥ 51,7, ≤ 6,8 $.
Règles de jeu chiffrées ajoutées : une seule, la tenue sur deux voies (90 s, 8 poses), passée par b-1 (35/35) aux
lignes citées et mesurée par la sonde. Les autres chiffres sont des bandes et des budgets de banc, repris de B12 et
B13.

### Causes Autowin OS repérées
1. `.arena/arenagame/clore-run.mjs:275-276` écrase encore le verdict du bras. b-1 écrit « Verdict : status red » (son
   RUN.md, l. 96), et l'en-tête dit `status: green` (l. 3). C'est déjà signalé en m0 et pas encore corrigé. La note
   AUTOWIN « preuve honnête » perd son entrée.
2. `.arena/arenagame/lance-bras.sh:34-39` colle toujours CLEAN et JUDGE en entier : `sys-effectif-a-1.txt` fait
   75 620 octets pour un `sys-a.txt` de 38 969. C'est déjà signalé en m0. Les 3 bras ont bien suivi la l. 42 (un seul
   juge `haiku`).
3. `skills/arenagame/SKILL.md:137` dit encore « garde A sauf si B ou C le bat d'au moins 2 points ». Les règles des
   30 % et de la lignée n'y figurent qu'aux l. 138-139. Un améliorateur qui ne lit que la l. 137 applique une règle
   périmée.
4. `clore-run` : « aucun RUN.md écrit par la session » pour x-1 (journal). C'est attendu pour un appel nu, sans
   workflow : ce n'est pas un défaut.
5. Non localisée : l'écart entre le banc d'un bras et le correcteur reste de 10 points sur une carte, même avec un
   bot qui ne passe que par le contrat (point 3 ci-dessus). La cause est dans le bot caché du correcteur, que ni les
   bras ni l'améliorateur ne doivent lire.

## m2 (relevé par l'orchestrateur, conv-826 — aucun améliorateur après la dernière manche)
Bras : A = B12 (SHA-256 760784C0…), B = B14, C = C14, X = appel nu. Lancés à 07:18 ; les 4 bras ont été coupés par la limite de
session dès le départ (« resets 7:50am », `attente-*.txt`) et repris après ≈ 33 min (`reprises=1` ×4) : chaque reprise a réécrit le
cache, les coûts de m2 ne se comparent pas à ceux de m1 sans cette réserve. Fin de nuit : `fin.txt` 09:18:30, 65,13 $ au total.

| bras | note | règles | équilibrage | $ réel | sortie Opus | échecs check.mjs |
|---|---|---|---|---|---|---|
| A (B12) | **51,5** | 35/35 | 9,5 | 8,85 | 194 k | géant 61,0 %, gobelins 55,2 % |
| B (B14) | 51,2 | 34/35 | 9,6 | **6,41** | 157 k | « destruction du roi : J1 ne gagne pas en attaquant seul » |
| C (C14) | 51,2 | 34/35 | 9,6 | 8,39 | 173 k | même règle que B |
| X (nu) | 50,0 | 34/35 | 8,4 | 8,80 | 228 k | « les tours tirent sur les unités » ; boule de feu 31,3 %, mini P.E.K.K.A 66,7 % |

Prédictions de m1 : B14 et C14 visaient ≥ 51,7 — **non tenues** (51,2). B14 tient son coût (≤ 6,5 $) malgré la reprise.

## Clôture de la nuit du 2026-09-26 (conv-826)
**A = B12 reste** : sur 2 manches, A fait 51,6 puis 51,5 ; B13/B14 51,3 / 51,2 et C13/C14 51,2 / 51,2. Les variantes coûtent moins
(−14 % et −28 % pour B) mais sous le seuil de 30 %, et avec une note plus basse à chaque manche : aucune règle d'adoption ne joue.

**Premier vrai appel nu (mémoire automatique coupée, `lance-bras.sh`)** : X fait **49,2** et **50,0**, contre 50,87 en moyenne pour
les 6 X de la nuit du 25 qui lisaient `memory\arenagame-*.md`. Les trois bras kit font 51,2 à 51,6 (moyenne 51,33) : **le kit bat
l'appel nu en note dans les 2 manches** (+1,7 point en moyenne, contre ≈ +0,6 quand X lisait la mémoire), et B le bat en coût dans
les 2 manches. Deux manches seulement : écart à confirmer, mais il a le signe attendu — une partie de l'avance de X venait des
leçons du kit qu'il lisait en mémoire.

**Coût** : m1, sans reprise, coûte 5,89 à 6,83 $ par bras kit (m6 du 25 : 7,42 à 10,42 $). Candidat non isolé : le contexte de
départ allégé de la mémoire. Même tendance pour X (9,32 $ contre 13,38 $ en m6).

**Frictions et causes**
- `clore-run.mjs` réécrit l'en-tête `status:` (m0, cause 1) : `m2/runs/arena-m2-a1/…/RUN.md` porte `status: green` en l. 3 et
  « - status: red » en l. 83 (verdict du bras). Autowin affiche ce run « clash-clone » en **rouge bloqué**. Non corrigé ici :
  `clore-run.mjs` est en cours de modification dans un autre fil (conv-861).
- `historique.jsonl` : les 4 lignes de m4 du 25 (notées après minuit) portaient `nuit-2026-09-26-m4` ; corrigées en
  `nuit-2026-09-25-m4` (champ `correction`). Les lignes de cette nuit portent le bon libellé (`nuit.sh` corrigé).
- Limite de session sur les 4 bras à la fois en m2 : m0 + m1 + l'améliorateur ont épuisé la fenêtre ; non corrigeable dans le kit.

**Effacé / conservé** : copies `m1/` et `m2/{a,b,c,x}-1` effacées par `nuit.sh` après archive (`m1.bras.tar`, `m2.bras.tar`,
117 fichiers chacune, relues) ; notes, `out-*`, `sys-*`, `runs/`, journaux et ce RUN.md conservés.

**Discrimination** : kit 51,2 à 51,6 — saturé, banc à durcir entre A/B/C. Seul X se détache désormais (−1,2 à −2,4 points).

remember (leçon) : voir la mémoire du fil conv-826.
