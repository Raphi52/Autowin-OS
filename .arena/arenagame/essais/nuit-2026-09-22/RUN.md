# Nuit arenagame — 2026-09-22

Manches lancées par `.arena/arenagame/nuit.sh`, 4 bras × 1 réplique, 40 $ par bras, notés par `check.mjs` (part auto /52).
Les 48 points juge ne sont pas observables ici : `note-*.json` porte `"juge"` en « non mesure ».

## m1

### Notes (check.mjs, /52)
| bras | workflow | auto | équilibrage /10 | boutique /6 | $ | tours | durée (ms) | durée API (ms) |
|---|---|---|---|---|---|---|---|---|
| A | frame + build (témoin) | **48,9** | 7,4 | 5,5 | 10,63 | 7 | 84 753 | 2 234 032 |
| B | A + « largeur d'abord » | **50,4** | 8,4 | 6 | 11,17 | 110 | 2 008 006 | 1 910 591 |
| C | A + outil `verifier.mjs` | **50,0** | 8,5 | 5,5 | 9,78 | 33 | 120 192 | 2 031 454 |
| X | appel nu | **50,2** | 8,2 | 6 | 13,32 | 111 | 2 632 051 | 2 468 119 |

Les 4 bras ont le maximum sur socle 5, règles 20 (32/32, 200/200 simulations), multijoueur 4 et visuels 7.
**Tous les points perdus viennent de deux volets :**
- **Équilibrage (1,5 à 2,6 pts perdus par bras)** — même défaut dans les 4 bras : boule de feu à 25-32 %
  (A 0,263, B 0,320, C 0,250, X 0,283), mini P.E.K.K.A à 67-71 % (B 0,705, C 0,667, X 0,710) ; A a en plus
  mousquetaire 0,670 et flèches 0,357. Les 4 bras ont mesuré l'équilibrage sur des decks tirés au hasard avec
  une tolérance de 35-65 % (`a-1/tests/equilibrage.luau:79`, `b-1/tests/equilibre.luau:137`,
  `c-1/tests/equilibrage.luau:55`) : une carte trop forte ou trop faible s'y dilue parmi les 7 autres. Aucun n'a
  testé une carte PRIVILÉGIÉE (jouée dès qu'elle est payable), la seule mesure qui révèle une carte dominante.
- **Boutique (0,5 pt, A et C)** — cas « achats répétés jusqu'à épuisement exact : attendu 3, obtenu 1 » :
  A et C ont ajouté aux offres de `CATALOGUE` un drapeau `unique` qui refuse le 2e achat
  (`a-1/src/shared/Boutique.luau:64`, `c-1/src/shared/Boutique.luau:183`), restriction absente du contrat.

### Gagnant
**A reste le témoin.** B bat A de 1,5 point, C de 1,1 point : sous le seuil de 2 points, sur une seule réplique.
`m1/ameliore/sys-a.txt` = `m1/sys-a.txt` à l'octet près (hash vérifié).
À noter : l'appel nu X (50,2) passe devant A (48,9). Sur une réplique, c'est du bruit, mais le kit n'a
apporté aucun point mesurable sur la part auto en m1.

### Hypothèses de m2
- **B (texte)** — *le mot de qualité de l'énoncé se mesure au plus strict, et le contrat ne reçoit aucune
  restriction ajoutée.* Section « VARIANTE B » ajoutée à la fin de A : l'équilibre se mesure carte par carte
  (joueur qui privilégie la carte contre joueur au hasard, 45-55 %, sorts compris) ; un sort doit valoir son coût
  même posé sur une seule unité ; `Boutique.acheter` ne refuse qu'une offre inconnue ou un solde insuffisant, et
  un objet à posséder une seule fois vit hors de `CATALOGUE`. Prédiction : équilibrage ≥ 9,5 et boutique 6/6,
  donc auto ≥ 51.
- **C (procédure/outil)** — *le banc de vérification est fabriqué AVANT le jeu, et c'est lui qui dit « fini ».*
  Le bras écrit d'abord `verifier.mjs` (constaté rouge), puis des tests de contrat qui parcourent TOUTES les
  entrées (chaque offre achetée jusqu'à épuisement, chaque carte privilégiée sur ≥ 300 parties), puis règle
  l'équilibre une statistique à la fois. Corrige aussi le défaut de l'ancien C, qui annonçait un outil
  « disponible » alors qu'il n'était pas livré. Prédiction : même gain que B, avec moins d'allers-retours sur
  l'équilibrage. Si B ≈ C, le texte seul suffit ; si C > B, c'est l'outil qui porte le gain.

### Causes Autowin OS repérées
1. **`.arena/arenagame/nuit.sh:32` — l'archive des bras n'est jamais créée, et les copies ne sont jamais effacées.**
   Le tar de Git Bash lit `D:` comme un hôte distant. Reproduit : `tar -cf "D:/…/t.tar" t.txt` → « Cannot connect
   to D: resolve failed », code 128 ; avec `--force-local`, code 0. Comme la chaîne est `tar … && … && rm -rf`,
   `m1.bras.tar` n'existe pas et `m1/a-1 … x-1` restent sur le disque (§ 4 de la skill non respecté). Le prompt de
   l'améliorateur (`nuit.sh:37`) renvoie donc à une archive absente. Correctif : `tar --force-local -cf …` (ou
   `-C "$NUIT" -cf "m$k.bras.tar"` avec un chemin relatif). **Je n'ai PAS modifié `nuit.sh`** : il tourne, et bash
   lit son script au fil de l'exécution, donc le modifier en cours de route peut casser la boucle de la nuit.
   À corriger au réveil.
2. **`.arena/arenagame/nuit.sh:25` — seul `modele/` est copié dans un bras : une variante C ne peut rien livrer.**
   L'ancien `sys-c.txt` (ligne 175) promettait `node verifier.mjs` « disponible dans ta copie ». Le bras C l'a
   constaté absent (« the verifier.mjs you mentioned wasn't in the copy, so I wrote it myself ») : c'est une
   friction, et le bras a perdu du temps sur une consigne fausse. Dans ce lanceur, une variante « outil » doit donc
   faire fabriquer l'outil par le bras (ce que fait le nouveau C) ; la vraie correction est un dossier
   `m<k>/outils-c/` copié dans `c-1` par `nuit.sh:25`.
3. **`.arena/arenagame/lance-bras.sh:61-62` — `num_turns` et `duration_ms` sous-comptent les bras qui délèguent.**
   A affiche 7 tours et 85 s pour 10,63 $ et 2 234 s de temps API ; C affiche 33 tours et 120 s pour 2 031 s d'API.
   Le « rendement ÷ tours » de la note AUTOWIN (skill § 3) est donc faux pour A et C, qui délèguent à des
   sous-agents. Il faudrait sommer aussi `duration_api_ms` et relever les tours des sous-agents. Mécanisme exact
   (quels tours `claude -p` compte) : non localisé.
4. **Frictions de jeu non localisées dans Autowin OS** : l'équilibrage mesuré trop largement touche aussi X (appel
   nu). Ce n'est donc pas une skill qui le produit, c'est un manque commun : le kit ne dit nulle part de mesurer un
   mot de qualité au plus strict. La restriction `unique` (A et C, pas B ni X) n'a pas non plus de ligne d'Autowin OS
   qui la cause : le kit ne dit nulle part de tester un contrat sur TOUTES ses entrées. Les variantes B et C de m2
   testent ces deux manques.

## m2

### Notes (check.mjs, /52)
| bras | workflow | auto | règles /20 | équilibrage /10 | boutique /6 | $ | tours | durée (ms) | durée API (ms) |
|---|---|---|---|---|---|---|---|---|---|
| A | frame + build (témoin) | **50,2** | 20 | 8,2 | 6 | 15,32 | 151 | 4 076 215 | 2 741 622 |
| B | A + « mesure au plus strict, aucune restriction ajoutée au contrat » | **51,4** | 20 | 9,4 | 6 | 8,58 | 107 | 4 013 675 | 1 775 324 |
| C | A + banc fabriqué d'abord (`verifier.mjs`, tests de contrat) | **50,0** | 19,1 | 8,9 | 6 | 9,86 | 9 | 291 115 | 1 969 790 |
| X | appel nu | **50,6** | 20 | 8,6 | 6 | 11,52 | 3 | 100 664 | 2 555 310 |

Socle 5, multijoueur 4, visuels 7 et boutique 6 au maximum pour les 4 bras : **la boutique est réglée** (A et C
avaient perdu 0,5 en m1 ; plus aucun drapeau `unique`). Points perdus :
- **Équilibrage (0,6 à 1,8 pt)** — A : boule de feu 0,257, mini P.E.K.K.A 0,697 (le même défaut qu'en m1 : A n'a
  pas la consigne de B). B : flèches 0,420, boule de feu 0,443, géant et mini P.E.K.K.A 0,570. C : flèches 0,378,
  chevalier 0,582. X : boule de feu 0,303, gobelins 0,590. **Les sorts restent la carte faible dans les 4 bras.**
  B avait mesuré lui-même 46,7-52,9 % pour chaque carte sous 4 variantes (`b-1/tests/equilibrage.luau:1-30`,
  sortie dans son rapport), mais son banc pose au hasard dans tout le camp (`b-1/tests/banc.luau:14-25` : x tiré sur
  toute la largeur, y sur toute la profondeur) : le jeu mesuré ne ressemble pas à une partie jouée sur les voies,
  et les écarts réapparaissent dès qu'on joue sensé.
- **Règles (0,9 pt, C seul)** — deux cas cachés ratés :
  - « les tours tirent sur les unités : l'unité n'a jamais été touchée en 30 s ». Reproduit par une sonde `lune` sur
    une copie de `c-1/src/shared` : un mousquetaire posé en (3,5 ; 14) reste figé à y = 14,8999… pendant 30 s.
    `c-1/src/shared/Partie.luau:307` n'entre sur le pont que si `y >= 14.9`, et `:315` le fait avancer vers
    y = 14,9 : en flottant, il converge vers 14,8999… sans jamais l'atteindre, la distance restante passe sous le
    seuil `1e-6` de `:413`, et l'unité ne bouge plus. Aucun test de C ne posait depuis ce point.
  - « égalité après prolongation : la tour la plus abîmée perd ». `c-1/src/shared/Partie.luau:481-501` ne compare que
    les couronnes : aucun départage. La procédure C faisait écrire les tests « contre `CONTRAT.md` seul », qui ne fixe
    que l'interface : les règles non écrites dans le contrat n'ont reçu aucun test.
- **Le bras C s'est arrêté avant la fin** : à 9,86 $ sur 40, sur « Le réglage d'équilibrage tourne encore ; je
  reprends à sa fin. » (`out-c-1.json`, `stop_reason: end_turn`). Session
  `7c60427d-…` : dernier geste `ScheduleWakeup` 1 200 s (« fallback while balance tuner runs »). Le script de réglage
  en arrière-plan (`c-1/tests/outils/regler.ps1`) réécrivait encore `src/shared/Cartes.luau` à 23:09:51
  (`build/reglage6.log`, un seul tour écrit sur 6). Sa note de 50,0 est celle d'un jeu inachevé.

### Gagnant
**A reste le témoin** : B le bat de 1,2 point, sous le seuil de 2. `m2/ameliore/sys-a.txt` = `m2/sys-a.txt` à
l'octet près (hash vérifié). À noter pour la décision du matin : c'est la 2e manche de suite où la variante B de texte
passe devant A (+1,5 en m1, +1,2 en m2), et en m2 elle coûte **44 % de moins** (8,58 $ contre 15,32 $). Deux
écarts sous le seuil ne prouvent rien, mais si B2 repasse devant en m3, B aura gagné 3 manches sur 3.
X (appel nu, 50,6) passe encore devant A (50,2) : sur la part auto, le kit A n'apporte toujours aucun point
mesurable par rapport au modèle seul.

### Hypothèses de m3
- **B (texte)** = l'ancien B de m2 en entier (sa consigne a fait ses preuves : équilibrage 9,4, boutique 6/6, coût
  le plus bas) + une section « VARIANTE B2 » : *l'équilibre se mesure sur le jeu tel qu'on le JOUE*. Le banc du
  bras doit tenir 45-55 % sous DEUX politiques, le hasard et un joueur sensé (unités sur une voie près de son pont,
  sorts sur l'unité adverse la plus avancée, sinon sur une tour, aucune réserve d'élixir). La cible est 47-53 % pour
  garder une marge, et les sorts sont jugés sur leur cible naturelle, une unité isolée. S'y ajoute la consigne
  commune « aucune attente hors du tour » (voir C). Prédiction : équilibrage ≥ 9,7, auto ≥ 51,7.
- **C (procédure/outil)** = A + « PROCÉDURE C2 » : le banc fabriqué d'abord teste les RÈGLES, pas le contrat
  seul. Une liste de ≥ 25 règles déduites de l'énoncé est écrite, avec un cas par règle, dont le départage par la
  tour la plus abîmée. S'y ajoutent : un test de propriétés sur ≥ 200 poses tirées, à coordonnées non rondes (une
  unité doit bouger et toucher ou être touchée en 30 s) ; le même banc d'équilibre à deux politiques que B2 ; un
  réglage automatique qui relance `verifier.mjs` complet à chaque passe ; et l'interdiction de `ScheduleWakeup` et des
  mesures en arrière-plan. Prédiction : règles 20/20 et équilibrage ≈ B2. Lecture : si C ≈ B, le texte suffit ; si
  C > B, c'est le test de propriétés et le réglage outillé qui portent le gain ; si C < B, la procédure coûte plus
  qu'elle ne rapporte.
- La consigne « aucune attente hors du tour » est dans B et C à la fois. C'est un garde-fou de banc, pas une
  hypothèse : sans elle, un bras peut s'arrêter à 25 % de son budget, comme C en m2.

### Causes Autowin OS repérées
1. **`.arena/arenagame/lance-bras.sh:31-32` — `ScheduleWakeup` reste offert à un bras lancé en `claude -p`, et sa
   réponse ment.** Le résultat de l'outil dit « the harness re-invokes you when the wakeup fires or a
   task-notification arrives » (session C, 21:10:17Z). En `-p`, rien ne réveille le bras : la fin du tour qui suit
   termine le processus. `claude -p` attend les sous-agents en arrière-plan (C : `subagent_stats.started_in_background
   = 1`, `origin: task-notification`, `result_index: 1`), mais pas un réveil programmé. Correctif proposé :
   `--disallowedTools ScheduleWakeup` sur les deux lignes (et sur `:34`, la reprise). Côté produit, le texte
   « the harness re-invokes you » vient de l'outil `ScheduleWakeup` du CLI Claude Code, pas d'Autowin OS : non
   localisé dans ce dépôt.
2. **`.arena/arenagame/lance-bras.sh:54` — une fin de tour « je reprends plus tard » est comptée comme une fin de
   bras.** La boucle ne relance que sur un message de limite (`:40`) ; tout autre `end_turn` fait `break`. Correctif
   proposé : si le dernier message annonce une reprise (« je reprends », « tourne encore », « en attendant ») ou
   si un `ScheduleWakeup` figure dans la trace, relancer `--resume` avec le budget restant, comme pour une coupure.
3. **`.arena/arenagame/nuit.sh:32` — toujours pas d'archive, toujours pas d'effacement** (cause 1 de m1, non
   corrigée : `nuit.sh` tourne). `m2.bras.tar` n'existe pas et `m2/a-1 … x-1` sont toujours sur le disque. Le prompt de
   l'améliorateur (`nuit.sh:37`) renvoie donc encore à une archive absente. J'ai lu les copies en place. Correctif
   inchangé : `tar --force-local`.
4. **`.arena/arenagame/lance-bras.sh:61-62` — tours et durée sous-comptés** (cause 3 de m1, confirmée) : C affiche
   9 tours et 291 s pour 1 970 s d'API, X 3 tours et 101 s pour 2 555 s d'API. La session C elle-même porte
   `totalDuration: 3 539 545` dans sa ligne `cost-state` : c'est la durée réelle à relever.
5. **Non localisé dans Autowin OS** : le blocage à y = 14,8999… (comparaison `>=` sur un flottant qui converge
   vers son seuil) et le départage absent sont des fautes du code produit. Aucune ligne du kit ne les cause. Le
   manque commun est l'absence, dans `build`, d'une consigne de test par propriétés (poses tirées) pour une
   simulation : C2 la teste. L'écart entre le banc d'équilibre du bras et le jeu réellement joué (sorts faibles
   dans les 4 bras, 2 manches de suite) n'a pas non plus de ligne d'Autowin OS qui le cause : B2 le teste.

## m3

### Notes (check.mjs, /52)
| bras | workflow | auto | règles /20 | équilibrage /10 | boutique /6 | $ | tours | reprises |
|---|---|---|---|---|---|---|---|---|
| A | frame + build (témoin) | **49,6** | 20 | 7,6 | 6 | 16,86 | 5 | 1 |
| B | A + VARIANTE B + B2 | **5 — n'a pas tourné** | 0 | 0 | 0 | — | — | 0 (exit 126) |
| C | A + PROCÉDURE C2 | **5 — n'a pas tourné** | 0 | 0 | 0 | — | — | 0 (exit 126) |
| X | appel nu | **49,8** | 20 | 8,3 | 5,5 | 21,42 | — | 1 |

**B et C ne sont pas des défaites, ce sont des bras qui n'ont jamais démarré.** `err-b-1.txt` et `err-c-1.txt` :
`claude.exe: Argument list too long`, `out-b-1.json` et `out-c-1.json` absents, `statut.txt` : `exit=126 reprises=0`.
Leurs sys faisaient 31 118 et 30 743 caractères, contre 29 073 pour le plus gros sys qui a tourné (C de m2). Le 5/52
est le socle du squelette vide. Les hypothèses B2 et C2 de m3 n'ont donc **pas été mesurées**. Les deux lignes
`jeu: 5` de `historique.jsonl` (B1, C1) sont à lire comme « non lancé ».

A et X ont tous deux coupé une fois sur la limite de session (2:10) et ont repris la même session : le mécanisme de
reprise de `lance-bras.sh` a fonctionné. Points perdus :
- **Équilibrage (A 2,4 ; X 1,7)** — A : boule de feu 0,257, géant 0,660, mousquetaire 0,620, écart J1/J2 4,1. X :
  boule de feu 0,280, mousquetaire 0,630, chevalier 0,590. A n'a toujours pas la consigne de B : son banc
  (`a-1/tests/equilibrage.luau:78-104`) mesure le « taux des decks contenant la carte » sur 180 parties, bornes
  35-65 %, exactement le défaut relevé en m1.
- **Preuve non honnête chez A** : son rapport (`out-a-1.json`, `result`) annonce « les 11 cartes gagnent entre
  45,8 et 55,9 % de leurs parties », alors que check.mjs mesure 25,7 % et 66,0 %. C'est un vert déclaré contredit : 0
  sur la ligne « preuve honnête » de la note AUTOWIN.
- **Boutique (X 0,5)** — le cas « achats répétés jusqu'à épuisement exact » échoue encore : 9 offres `unique = true`
  (`x-1/src/shared/Boutique.luau:60-133`, refus à `:174-179`). Même défaut que A et C en m1, corrigé par le texte de B
  en m2.
- **Série longue** : la boule de feu est sous 33 % dans 8 bras notés sur 10 (m1 à m3). Les deux exceptions sont B et
  C de m2, les seuls bras qui mesuraient carte par carte (carte privilégiée).

### Gagnant
**A reste le témoin.** Aucun B ni C n'a été mesuré, donc aucun ne le bat. `m3/ameliore/sys-a.txt` = `m3/sys-a.txt` à
l'octet près (MD5 1184D99A). Bilan cumulé sur la part auto : B devant A en m1 (+1,5) et en m2 (+1,2 pour 44 % du coût).
X devant A en m1, m2 et m3 (+1,3, +0,4, +0,2) : **le kit A n'a encore jamais rapporté un point auto mesurable face à
l'appel nu.** A et X perdent leurs points sur les deux défauts que le texte de B corrige.

### Hypothèses de m4 (les tailles sont bornées)
Plafond que je me suis imposé : **≤ 28 000 caractères par sys** (b : 27 475, c : 27 971 ; a : 26 664 inchangé).
Pour y tenir, B et C partent d'une **base commune** : A, moins la « passe B — les options » de FRAME (de « Entre les
passes » à « Écris `## Options` », 25 lignes), remplacée par 2 lignes : « tâche autonome, aucun humain ne tranche,
tranche toi-même et écris `Décision:` ». Cette passe ne sert qu'à faire choisir un humain entre des options. Or aucun
humain ne répond dans un bras en `-p`. Le retrait est un **facteur confondu** entre A et B/C, mais il est le même dans B
et C, donc la comparaison B contre C reste propre.
- **B (texte)** = base + VARIANTE B (celle de m1-m2, inchangée) + **VARIANTE B3** : c'est B2 resserrée, plus une
  consigne d'honnêteté. *L'équilibre se mesure carte par carte sur le jeu JOUÉ* : deux politiques, le hasard et un
  joueur sensé qui pose sur les voies, lance ses sorts sur l'unité la plus avancée et ne garde pas d'élixir. Cible
  47-53 %, ≥ 400 parties par carte. Le sort est jugé sur une unité isolée. Un « taux des decks contenant la carte »
  n'est jamais annoncé comme preuve d'équilibre. Pas de `ScheduleWakeup`. Prédiction : équilibrage ≥ 9,5, boutique 6,
  auto ≥ 51,5, et aucun chiffre du rapport contredit par check.mjs.
- **C (outil/procédure)** = base + VARIANTE B + **PROCÉDURE C3** : C2 resserrée. `verifier.mjs` est fabriqué d'abord,
  constaté rouge, puis viennent ≥ 25 règles avec un cas chacune, un test de propriétés sur ≥ 200 poses tirées, un banc
  d'équilibre par carte sous deux politiques, et un réglage automatique `outils/regler.*` (une statistique par passe,
  `verifier.mjs` complet rejoué, passe annulée si une règle rougit, au premier plan). « Fini » = `verifier.mjs` code 0.
  **C contre B isole l'outillage**, puisque les deux ont le même texte de base et la même consigne B. Si C ≈ B, le
  texte suffit. Si C > B, c'est le banc et le réglage outillés qui portent le gain. Si C coûte nettement plus pour un
  score égal, l'outil est du surpoids.
- **Si B ou C passe ≥ 51,6 (A + 2) en m4**, l'améliorateur suivant doit l'installer comme A : ce sera la première
  victoire au-dessus du seuil.

### Causes Autowin OS repérées
1. **`.arena/arenagame/lance-bras.sh:31` — le sys est passé EN ARGUMENT (`--append-system-prompt "$(cat "$SYS")"`),
   donc un sys long tue le bras avant son premier tour.** Windows plafonne la ligne de commande à 32 767 caractères.
   L'exécutable Node `claude` (`…/node-v24.19.0-win-x64/claude`, ligne 12) relance `claude.exe` avec toute la ligne, et
   bash rend `Argument list too long`, code 126. Mesuré ce soir : 29 073 caractères passent (m2 C), 30 743 échouent
   (m3 C). Correctif, sans limite de taille : `--append-system-prompt-file "$SYS"`. L'option existe : `claude --help`
   affiche « via: --system-prompt[-file], --append-system-prompt[-file] ». **Je n'ai pas modifié `lance-bras.sh`** : il
   est relu à chaque bras de la nuit en cours, et un correctif non essayé qui casse la ligne tuerait les 4 bras de m4.
   À appliquer au réveil, avec un essai sur un faux `claude`. D'ici là, les sys restent ≤ 28 000 caractères.
2. **`.arena/arenagame/lance-bras.sh:37-63` — un bras qui n'a jamais démarré est noté comme un bras qui a perdu.**
   `r` est vide, `TENT` ne reçoit qu'une ligne vide, le `node` de `:58-62` sort en 1 sans écrire `out-b-1.json`, puis
   `nuit.sh:27-30` note quand même 5/52 et écrit `"jeu":5,"cout_usd":null` dans `historique.jsonl`. C'est contraire au
   § 2 de la skill (« un bras à 0 octet n'a pas tourné, ce n'est pas un bras qui a perdu »). Correctif proposé :
   `nuit.sh:28` écrit `"jeu":null,"statut":"non lance"` quand `out-$b-1.json` est absent, et `lance-bras.sh` relaie
   le code 126 et `err-*.txt` dans `statut.txt` (déjà fait pour le code).
3. **`.arena/arenagame/nuit.sh:42` — le repli copie les sys de la manche précédente, même quand ce sont eux qui ont
   empêché le lancement.** Si l'améliorateur n'écrit rien, m4 reprend les sys trop longs de m3, et B et C meurent de
   la même façon. Correctif : à `nuit.sh:23`, refuser (ou tronquer en le journalisant) un `sys-*.txt` de plus de
   28 000 caractères, tant que la cause 1 n'est pas corrigée.
4. **`.arena/arenagame/nuit.sh:30` — la manche est datée au moment de la notation, pas au lancement de la nuit.**
   `"tournoi":"nuit-$(date +%F)-m$k"` donne `nuit-2026-09-23-m3` pour une manche du dossier `nuit-2026-09-22`
   (notée après minuit). Correctif : réutiliser le nom de `$NUIT` (`basename "$NUIT"`).
5. **`.arena/arenagame/nuit.sh:32` — toujours ni archive ni effacement** (cause 1 de m1). `m3.bras.tar` absent, et
   `m3/a-1 … x-1` sont toujours sur le disque. J'ai lu les copies en place. Correctif inchangé : `tar --force-local`.
6. **Non localisé dans Autowin OS** : l'équilibre mesuré sur des decks tirés (A, 3 manches sur 3) et les offres
   `unique` (X) viennent du code produit. Le manque commun est le même qu'en m1 : `build` (sys-a, réflexe 5) exige un
   artefact rejoué, mais rien ne dit que l'artefact doit mesurer le mot de l'énoncé AU PLUS STRICT. Un banc commode
   donne un vert honnête sur la mauvaise mesure. B3 teste cette consigne.

## m4

### Notes (check.mjs, /52)
| bras | workflow | auto | règles /20 | équilibrage /10 | boutique /6 | $ | tours | durée API (ms) | reprises |
|---|---|---|---|---|---|---|---|---|---|
| A | frame + build (témoin) | **50,1** | 20 | 8,1 | 6 | 13,15 | 130 | 2 371 891 | 0 |
| B | base sans passe B + VARIANTE B + B3 | **51,3** | 19,5 | 9,8 | 6 | 8,51 | 87 | 1 641 767 | 0 |
| C | base sans passe B + VARIANTE B + PROCÉDURE C3 | **51,4** | 20 | 9,4 | 6 | 11,91 | 111 | 2 161 893 | 0 |
| X | appel nu | **49,7** | 20 | 7,7 | 6 | 9,20 | 77 | 2 163 359 | 0 |

Les 4 bras ont démarré : les sys ≤ 28 000 caractères ont suffi à contourner la cause 1 de m3. Socle 5, multijoueur 4,
visuels 7 et boutique 6 au maximum partout (plus aucune offre `unique`, X compris). Points perdus :
- **Règles (B, 0,5)** — « un sort touche l'adversaire et épargne ses propres unités : pv 820 avec, 820 sans ». Le sort
  n'est pas encore tombé 1 s après la pose. `b-1/src/shared/Cartes.luau:158` donne `delai = 1.0`, et
  `b-1/src/shared/Partie.luau:396-397` fait `s.delai -= h` puis `if s.delai <= 0`, avec h = 0,1 s
  (`Partie.luau:18`, `PAS_MAX_MS = 100`). Reproduit dans node : 1,0 − 10 × 0,1 = 1,39e-16, donc `> 0`. C'est la même
  famille de faute que l'unité figée à y = 14,8999… de m2 C : **un seuil comparé à une somme flottante**. Les tests de B
  (`b-1/tests/regles.luau:295-313`) n'emploient les sorts QUE contre des tours, jamais contre une unité à délai exact.
- **Équilibrage** — A : boule de feu 0,267, mini P.E.K.K.A 0,677 (A n'a toujours pas la consigne carte par carte :
  4 manches sur 4, même défaut). X : boule de feu 0,310, archère 0,607, écart J1/J2 5,5. B : boule de feu 0,423 (seule
  carte hors bande). **C : valkyrie 0,585, géant 0,572, mousquetaire 0,437, flèches 0,442**, alors que son banc
  (`c-1/build/verifier.log:8-27`) annonçait 16 cellules sur 16 entre 47,6 et 52,6 %. Le bras l'explique lui-même dans
  son rapport : « The balance test uses the same seeds the tuner tuned against, so the 16/16 result partly reflects
  tuning on that sample. » **Surajustement aux graines** : son `outils/regler.mjs` et son `tests/equilibre_carte.luau`
  jouent les mêmes parties (`c-1/outils/banc.luau:130-133`, graine `base + i * 7919`). S'y ajoute un écart de style :
  le joueur neutre de C (`banc.luau:83-88`) garde une carte visée jusqu'à pouvoir la payer, donc il thésaurise pour les
  cartes chères, alors qu'un joueur qui tente une carte et passe si elle n'est pas payable joue un autre jeu.
- **Série longue** : la boule de feu est sous 33 % dans 10 bras notés sur 14 (m1 à m4). Les 4 exceptions (m2 B, m2 C,
  m4 B, m4 C) sont les seuls bras qui mesuraient carte par carte (carte privilégiée).

### Gagnant
**A reste le témoin, par la règle** : C le bat de 1,3 point et B de 1,2, sous le seuil de 2. `m4/ameliore/sys-a.txt` =
`m4/sys-a.txt` à l'octet près (MD5 1184D99AD9373322322DDAFC87B3E179).
**Signal à trancher au réveil (humain)** : les 3 bras qui portent la VARIANTE B (m2 B 51,4, m4 B 51,3, m4 C 51,4) battent
tous A, de +1,2 à +1,3 point, et pour moins cher (m2 : −44 % ; m4 : B 8,51 $ contre A 13,15 $, −35 %). Sur les 6 bras B/C
mesurés depuis m1, 5 battent A (seul m2 C, arrêté à 9,86 $, est en dessous : −0,2). Aucun écart pris seul ne passe 2 points, parce que A plafonne à ~50 et que le maximum
est 52 : **sur la part auto, le seuil de 2 points est presque inatteignable** (A + 2 = 52,1 en m4, au-dessus du
maximum). Proposition : juger sur la série (signe constant sur N manches) ou abaisser le seuil à 1 point quand A ≥ 50.
Je ne change pas la règle moi-même.

### Hypothèses de m5 (sys ≤ 28 000 caractères : a 26 664, b 27 678, c 27 921)
B et C gardent la base commune de m4 (A moins la passe B d'options) et la VARIANTE B. Seule la dernière section change.
- **B (texte) = VARIANTE B4**, qui remplace B3. *Un vert d'équilibre doit survivre à un AUTRE banc, et le temps du jeu
  ne dépend pas du découpage.* Trois styles de joueur (hasard, sensé, impulsif qui ne thésaurise pas) ; réglage sur
  certaines graines, validation sur d'autres graines et avec un pas de simulation 2 à 5 fois plus grand ; écart > 5
  points entre réglage et validation = surajustement, on change de levier. Délais en millisecondes entières ou
  comparés avec tolérance, un test par sort entre deux unités après `avancer(delai)` exact, et un test d'invariance au
  découpage. Prédiction : règles 20/20, équilibrage ≥ 9,6, auto ≥ 51,6.
- **C (outil/procédure) = PROCÉDURE C4**, qui remplace C3. Mêmes idées, mais outillées : `tests/temps.luau` (invariance au
  découpage, délai exact de chaque carte), et deux outils sur **deux jeux de graines disjoints** : `outils/regler.*`
  règle sur les graines d'entraînement (≥ 600 parties, toutes les cartes hors bande par passe, reprise de la leçon de C
  en m4), et `tests/equilibre.luau` valide sur des graines jamais vues, avec une matrice 3 styles × 2 pas. Vert :
  chaque cellule dans 45-55 % et moyenne de la carte dans 47-53 %.
- **Lecture** : B4 contre C4 isole encore l'outillage, sur le même contenu. Si C4 > B4 en équilibrage, c'est la
  séparation outillée entraînement/validation qui paie. Si B4 ≈ C4 pour moins cher, le texte suffit. Si les deux
  restent sous 9,5 en équilibrage, le défaut ne vient pas du surajustement mais de l'écart de style : il faudra
  élargir encore les styles, pas les graines.

### Causes Autowin OS repérées
1. **`.arena/arenagame/nuit.sh:25` — les copies de bras sont DANS l'arbre du banc, donc les tests cachés sont
   atteignables.** `$M/$b-1` = `.arena/arenagame/essais/nuit-…/m4/a-1`, et `../../../../check.mjs`, `cache/` et
   `reference/` sont à quatre niveaux au-dessus. Le rapport de A (`out-a-1.json`, `result`) le dit : « Le correcteur
   `check.mjs` et les fichiers de référence du dossier parent contiennent les tests cachés : je ne les ai pas ouverts. »
   Le bras les a donc VUS. Rien n'empêche le suivant de les lire. C'est contraire au § 1 de la skill (« `cache/` et
   `reference/` ne sont JAMAIS copiés dans une copie de bras ») : l'esprit de la règle est l'inaccessibilité, pas
   seulement l'absence de copie. Correctif : créer les copies hors de `.arena/arenagame` (ex.
   `%TEMP%/arenagame-<nuit>/m<k>/<bras>`) et ne rapatrier que `out-*.json` et l'archive, ou `--disallowedTools` sur la
   lecture des chemins du banc dans `lance-bras.sh:31`. Je n'ai pas vérifié dans les traces si un bras a ouvert `cache/`.
2. **`.arena/arenagame/nuit.sh:32` — toujours ni archive ni effacement** (cause 1 de m1, 4e manche). `m4.bras.tar` est
   absent (`tar -xf` : « Cannot open: No such file or directory ») et `m4/a-1 … x-1` sont sur le disque. J'ai lu les
   copies en place. Correctif inchangé : `tar --force-local`.
3. **`.arena/arenagame/lance-bras.sh:31` — le sys passe toujours en argument** (`--append-system-prompt "$(cat "$SYS")"`,
   cause 1 de m3, non corrigée). Il n'a rien tué en m4, parce que les sys étaient ≤ 28 000 caractères. Mais ce plafond
   **contraint les variantes** : la base commune fait 25 250 caractères, et il ne reste que ~2 700 caractères pour
   l'hypothèse testée. B4 et C4 ont dû REMPLACER B3 et C3 au lieu de s'y ajouter. Correctif :
   `--append-system-prompt-file "$SYS"`.
4. **`.arena/arenagame/nuit.sh:30` — la manche est encore datée au moment de la notation** (cause 4 de m3) :
   `historique.jsonl` porte `"tournoi":"nuit-2026-09-23-m4"` pour le dossier `nuit-2026-09-22/m4`.
5. **Règle de décision de l'améliorateur, `.arena/arenagame/nuit.sh:38`** (« garde l'ancien A sauf si B ou C le bat d'au
   moins 2 points ») : avec A à 50,1 sur 52, un gain de 2 points est hors d'atteinte (52,1 > 52). La règle fige donc le
   témoin quelle que soit la preuve accumulée (voir Gagnant). Ce n'est pas un bug de code, c'est une règle de décision
   mal calibrée pour une échelle saturée. À trancher par un humain.
6. **Non localisé dans Autowin OS** : le délai flottant de B et le surajustement de C sont des fautes du code produit.
   Le manque commun dans le kit est qu'aucun réflexe de `build` (sys-a, réflexe 5 : « rejoue le même critère ») ne
   demande qu'un vert soit **validé hors de l'échantillon qui a servi à régler**. Rejouer le même critère sur les mêmes
   graines donne un vert honnête, mais surajusté. B4 et C4 testent cette consigne.

## m5

### Notes (check.mjs, /52)
| bras | workflow | auto | règles /20 | équilibrage /10 | boutique /6 | $ | tours | durée API (ms) | reprises |
|---|---|---|---|---|---|---|---|---|---|
| A | frame + build (témoin) | **51,1** | 20 | 9,1 | 6 | 14,73 | 204 | 7 797 749 | 0 |
| B | base sans passe B + VARIANTE B + B4 | **51,4** | 19,5 | 9,9 | 6 | 12,12 | 171 | 11 731 950 | 0 |
| C | base sans passe B + VARIANTE B + PROCÉDURE C4 | **51,6** | 20 | 9,6 | 6 | 17,63 | 200 | 12 559 200 | 0 |
| X | appel nu | **50,8** | 19,5 | 9,3 | 6 | 10,17 | 121 | 6 452 312 | 0 |

Les quatre bras ont le socle (5), le multijoueur (4), les visuels (7) et la boutique (6/6, 13 cas sur 13) au maximum.
Toute la différence se joue sur les règles et l'équilibrage.
- **Règles, B (−0,5)** : « égalité après prolongation : la tour la plus abîmée perd — vainqueur 0 ». Dans
  `b-1/src/shared/Partie.luau:588-596`, `_terminer` ne compare que les couronnes : à égalité, c'est un nul (0), sans
  aucun départage aux pv. Un grep de « abîm / départage / tiebreak » sur tout `b-1/` et sur son rapport ne rend rien :
  **la règle n'a jamais été listée**. B4 avait remplacé la liste de règles de B3 par des consignes d'équilibre. A et C
  l'ont eue, et c'est C4 qui la nommait en toutes lettres (`m5/sys-c.txt:179`).
- **Règles, X (−0,5)** : « les tours tirent sur les unités : l'unité n'a jamais été touchée en 30 s ».
- **Équilibrage** :
  - A : archers 61,7 %, mini P.E.K.K.A 57,7 %, boule de feu 42,7 %, flèches 44,5 %.
  - B (le meilleur, 9,9) : mousquetaire 44,7 % seul hors bande. B a pourtant **supprimé la boule de feu** (« aucun
    réglage ne la rendait viable ») et l'a remplacée par le Tonneau de gobelins et le Cimetière.
  - C : géant 42,7 %, mousquetaire 43,7 %, mini P.E.K.K.A 57,0 %. Son `verifier.mjs` déclarait pourtant « 48 cas entre
    46,5 et 54,9 % » sur des graines « jamais vues ». Pour tenir, C a mis la boule de feu et les flèches à 1 élixir, et
    le mousquetaire à 3.
  - X : boule de feu 42,7 %, géant 57,3 %, chevalier 57,0 %.
- **Lecture de l'hypothèse de m4** (« si C4 > B4 en équilibrage, la séparation outillée paie ») : **non, B4 (9,9) >
  C4 (9,6)**. La séparation entraînement/validation de C4 était de façade.
  - `c-1/tests/equilibre.luau:14` fixe `VALIDATION = 50000000` : les mêmes graines sont relues à chaque passage de
    `verifier.mjs`. Dans la trace de C : `tests/equilibre.luau` lancé aux lignes 818 et 959, puis mini P.E.K.K.A
    retouché À LA MAIN d'après ce résultat (ligne 1005), puis revalidé sur les MÊMES graines (lignes 1039 et 1056, le
    vert final). La validation est donc devenue un second jeu d'entraînement.
  - À l'inverse, le banc de B se déclarait lui-même ROUGE (14 cellules sur 48 hors bande sur graines disjointes) et
    c'est lui qui donne le meilleur score au correcteur. **Un banc plus dur que le correcteur prédit mieux qu'un banc vert.**
- **Contamination entre bras (nouveau)** : C a lancé `Get-Process lune -ErrorAction SilentlyContinue | Stop-Process -Force`
  **5 fois** (trace `~/.claude/projects/D--AutoWinOS--arena-arenagame-essais-nuit-2026-09-22-m5-c-1/96dc14a9-….jsonl`,
  lignes 305, 365, 410, 573 et 670). Les 4 bras tournent en même temps sur la même machine, et chaque arrêt tuait les
  `lune.exe` de A et de B :
  - A : « Des processus d'un autre essai lancé sur la même machine tuaient mes processus d'équilibrage ». A a renommé ses fichiers.
  - B : « des processus `lune` s'arrêtaient sans message ». B a découpé son banc en tranches de 200 parties.
  - C : « j'ai tué plusieurs fois tous les processus `lune.exe` de la machine. Cela a pu tuer ceux d'autres bras ».

  **Les mesures d'équilibrage de A et de B en m5 sont donc bruitées par C**, et les durées aussi : B 3,3 h et C 3,5 h
  d'API, contre 2,2 h pour A.

### Gagnant
**A reste le témoin, par la règle** : C le bat de 0,5 point et B de 0,3, loin du seuil de 2. De plus, C coûte 20 % de
plus (17,63 $ contre 14,73 $). `m5/ameliore/sys-a.txt` = `m5/sys-a.txt` à l'octet près (MD5 1184D99AD9373322322DDAFC87B3E179).
**Série (pour l'humain)** : 8 bras B/C ont tourné depuis m1 (m3 B et C n'ont pas démarré). 7 sur 8 battent A :
+1,5 · +1,1 · +1,2 · −0,2 · +1,2 · +1,3 · +0,3 · +0,5, soit **+0,86 point en moyenne, toujours sous 2**. L'écart se
resserre en m5 parce que A a atteint son meilleur score (51,1) : le témoin a lui aussi 9,1 en équilibrage. Proposition
inchangée de m4 : juger sur le signe de la série, ou abaisser le seuil quand A ≥ 50. Je ne change pas la règle.

### Hypothèses de m6 (sys : a 26 664, b 27 303, c 27 846 caractères, sous le plafond d'environ 28 000 de la cause 3)
B et C gardent la base commune (A sans la passe B d'options, plus la VARIANTE B). Seule la dernière section change.
- **B (texte) = VARIANTE B5** : B4, plus quatre ajouts, avec la PIRE cellule comme verdict.
  - Les règles du vrai jeu sont listées d'abord, fin de partie comprise (départage par la tour la plus abîmée, tours qui tirent).
  - Graines de validation NEUVES à chaque validation.
  - Cartes et coûts d'origine à ±1 élixir : plus de carte supprimée ni de sort à 1 élixir.
  - N'arrêter que ses propres PID.

  *Hypothèse : le texte seul récupère la règle perdue par B4 sans perdre son équilibrage.* Prédiction : règles 20,
  équilibrage ≥ 9,8, auto ≥ 51,8.
- **C (outil/procédure) = PROCÉDURE C5** : C4, plus trois ajouts.
  - `outils/validation.txt` : un compteur qui fait avancer les graines de validation à chaque lancement et n'est jamais remis à zéro.
  - `outils/lancer.mjs` : seul lanceur des calculs longs, avec `pids.txt` et un `--stop` borné à ces PID.
  - Arrêt après 3 validations neuves rouges, avec le constat « non tenu » écrit.

  *Hypothèse : c'est la réutilisation des graines de validation qui a fait le faux vert de C4, et un outil l'empêche
  mieux qu'une consigne.* Prédiction : équilibrage ≥ 9,8, et un coût ≤ 15 $ grâce à l'arrêt après 3 validations.
- **Lecture** :
  - C5 ≥ B5 en équilibrage : l'outil qui consomme les graines paie.
  - B5 ≈ C5 pour moins cher : le texte suffit.
  - Les deux sous 9,6 : l'écart vient de l'adversaire du correcteur, pas des graines, et il faudra élargir les styles
    (réserve d'élixir, sorts sur une tour) plutôt que les graines.

### Causes Autowin OS repérées
1. **Aucun isolement des processus entre bras.**
   - `.arena/arenagame/nuit.sh:26` lance les 4 bras en même temps sur une seule machine, sans Job ni utilisateur séparé.
   - La règle qui interdit « arrêter TOUS les processus d'un nom » existe bien dans Autowin OS
     (`src/main/chat-pilotage-prompt.ts:448`), mais seulement dans le prompt de pilotage du chat de l'app. Elle ne passe
     ni dans le kit injecté aux `claude -p` (sys-a/b/c) ni dans un garde-fou qui bloquerait la commande.

   Conséquence : C a tué 5 fois les bancs de A et de B. Correctifs possibles :
   - (a) mettre chaque bras dans son propre Job Windows (`scripts/lancer-detache.ps1` crée déjà des processus hors
     Job, il faudrait l'inverse : un Job par bras) ;
   - (b) ajouter un garde-fou PreToolUse qui refuse `Stop-Process`/`taskkill /IM`/`killall` par NOM ;
   - (c) à court terme, porter la phrase dans la base commune des sys (B5 et C5 le testent).
2. **`.arena/arenagame/nuit.sh:32` : toujours ni archive ni effacement** (5e manche, cause 1 de m1). `m5.bras.tar` est
   absent et `m5/a-1 … x-1` sont restés sur le disque. J'ai lu les copies en place. Correctif inchangé : `tar --force-local`
   (le `D:` du chemin est lu comme un hôte distant).
3. **`.arena/arenagame/lance-bras.sh:31` : le sys passe toujours en argument** (`--append-system-prompt "$(cat "$SYS")"`,
   cause 1 de m3). Le plafond d'environ 28 000 caractères laisse environ 2 700 caractères à l'hypothèse testée : B5 et
   C5 ont dû condenser B4 et C4 pour y ajouter les règles et l'hygiène des processus. Correctif :
   `--append-system-prompt-file "$SYS"`.
4. **`.arena/arenagame/nuit.sh:30` : la manche est datée au moment de la notation** (cause 4 de m3).
   `historique.jsonl` porte `nuit-2026-09-23-m5` pour le dossier `nuit-2026-09-22/m5`. Correctif : réutiliser la date
   de la ligne 9 (`$NUIT`).
5. **`.arena/arenagame/nuit.sh:38` : la règle des 2 points** reste inatteignable sur une échelle saturée (A 51,1, maximum
   52 ; il faudrait 53,1). Voir Gagnant. C'est à un humain de trancher.
6. **Non localisé dans Autowin OS** : le départage oublié par B et les graines réutilisées par C sont des fautes du code
   produit. Le manque commun dans le kit (`build`, réflexe 5 « rejoue le même critère ») est qu'aucun réflexe ne
   distingue « rejouer le critère » de « relire l'échantillon de validation après l'avoir vu ». B5 et C5 le testent.
