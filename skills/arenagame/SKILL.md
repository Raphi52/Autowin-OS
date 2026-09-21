---
name: arenagame
description: >-
  Variante de `arena` sur un banc FIXE et LONG : un clone jouable de Clash Royale dans Roblox Studio,
  refait de zéro à chaque tournoi. Le jeu n'est QUE l'instrument de mesure : le livrable est une
  amélioration PROUVÉE d'Autowin OS (skill réécrite, garde-fou, outil forgé). Quatre bras A/B/C/X
  isolés, une grille déterministe (tests cachés de règles de jeu exécutés hors Studio, build Rojo,
  lint, capture sur bureau caché) PLUS une grille de FRICTIONS du workflow lue dans les journaux ;
  puis les tentatives sont EFFACÉES, seules les mesures restent. Déclencher sur `/arenagame`,
  « lance l'arène jeu », « teste les workflows sur le clone Clash Royale ». PAS pour : faire un vrai
  jeu Roblox (→ `build`), comparer des workflows sur une tâche choisie par l'utilisateur (→ `arena`),
  analyser des conversations passées sans rien lancer (→ `rendement`).
---

# arenagame — un jeu comme banc d'essai, Autowin OS comme vrai livrable

Tu es l'**ORCHESTRATEUR**, comme dans `skills/arena/SKILL.md`, dont tu reprends TOUTE la mécanique
(bras A/B/C/X lancés ensemble, pré-vol `arena:protocole --avant-lancement`, juge externe `/judge`,
bruit de 30 %, répliques, journal `arena:duel`). Ce fichier ne dit que ce qui CHANGE.

## Pourquoi ce banc existe
Les bancs courts (une fonction, un bug) sont finis 4/4 par tous les bras, y compris l'appel nu :
mesuré le 2026-09-21 sur `D:\AutoWinOS\.arena\banc-recherche-arbre` — le modèle seul, sans outil,
un seul message, a obtenu 100/100. Un banc qui ne départage pas n'apprend rien à Autowin OS.
Un clone de Clash Royale oblige à : cadrer un besoin large, découper, outiller un environnement
inconnu (Roblox, Luau, Rojo), vérifier sans interface, tenir sur des dizaines de tours. C'est là que
les workflows diffèrent — et que leurs défauts se VOIENT.

**Règle cardinale : le score du jeu n'est pas le but.** Un bras qui fait un meilleur jeu en
contournant Autowin OS (outil bricolé en silence, vérification sautée) apprend MOINS qu'un bras
moyen dont chaque blocage est tracé. Le tournoi se clôt sur des ÉDITIONS D'AUTOWIN OS, pas sur un jeu.

## 0. Pré-requis de l'environnement (vérifié à chaque tournoi)
Installés le 2026-09-21 via Rokit 1.2.0 : `rojo` 7.7.0, `lune` 0.10.5, `selene` 0.31.0, épinglés
dans `modele/rokit.toml`. `check.mjs` appelle les binaires RÉELS de
`~/.rokit/tool-storage/<auteur>/<outil>/<version>/` : les raccourcis de `~/.rokit/bin` refusent de
démarrer dans un dossier sans `rokit.toml` (constaté : « Failed to find tool 'lune' in any project
manifest file »). Vérifier avant tout lancement : `node check.mjs modele` rend `auto: 5` (socle du
squelette vide, tout le reste à 0) et `node check.mjs reference` rend `auto: 51.8`. Un autre chiffre = le banc a bougé : STOP.
Un outil absent n'arrête pas le tournoi : c'est une étape à fabriquer (`forge`).

## 1. Le banc — FIGÉ, identique d'un tournoi à l'autre
Dossier : `D:\AutoWinOS\.arena\arenagame\`. Contenu permanent (jamais effacé) :

| chemin | rôle |
|---|---|
| `tache.txt` | l'énoncé donné aux bras, mot pour mot (ci-dessous) |
| `modele/` | point de départ copié dans chaque bras : `default.project.json` Rojo, `rokit.toml`, `selene.toml`, `CONTRAT.md`, `src/shared/Partie.luau` vide |
| `cache/regles.luau` | **28 tests cachés** de règles (élixir, cycle, pose, combat, fin de partie, déterminisme) |
| `cache/simulation.luau` | 200 parties aléatoires, invariants vérifiés à chaque pas |
| `cache/equilibrage.luau` | 2 400 parties « bot qui privilégie une carte » + 2 000 parties bot contre bot (≈ 45 s) |
| `cache/boutique.luau` | 13 tests cachés de la logique de boutique (`src/shared/Boutique.luau`, interface dans `CONTRAT.md`) |
| `cache/visuels.luau` | lit le `.rbxl` construit : images des cartes, modèles `ReplicatedStorage.Modeles.<idCarte>` |
| `reference/` | implémentation de référence : **51,8/52** en auto — preuve que la note auto maximale est atteignable ; elle ne couvre PAS les volets juge (menus, ressenti…) |
| `check.mjs` | `node check.mjs <racine du bras>` → part AUTO de la note JEU, JSON sur 52, code 0 si ≥ 30 ; série t1 : `check-t1.mjs` (sur 85) |
| `historique.jsonl` | une ligne par bras et par tournoi : notes, $, durée, frictions |

`cache/` et `reference/` ne sont JAMAIS copiés dans une copie de bras, ni cités dans un prompt.
Étalonnage t1 (2026-09-21) : squelette vide **20/85**, référence **85/85**.
Étalonnage t2 (2026-09-21, part auto /52) : squelette vide **5**, référence **51,8** (socle 5, règles 20, équilibrage 9,8, multijoueur 4, visuels 7, boutique 6) ; mutant boutique sans protection des reçus rejoués : **5,1/6** (2 cas rouges) — les tests départagent.

**Énoncé (`tache.txt`, série t2 depuis le 2026-09-21)** — au niveau d'un utilisateur, pas d'un algorithme :

> Fais un clone de Clash Royale dans Roblox Studio, en projet Rojo, prêt à être publié sur la
> plateforme. Deux joueurs en multijoueur (et un bot si on joue seul), trois tours chacun (un roi,
> deux princesses), de l'élixir qui se recharge, un deck de 8 cartes dont 4 en main, au moins
> 8 cartes avec leur image, des unités modélisées qui avancent sur deux voies et attaquent, une
> partie de 3 minutes avec prolongation, la victoire aux couronnes, un jeu équilibré, une
> boutique qui donne envie et qui fonctionne, des menus soignés et une progression qui donne
> envie de revenir. La logique de partie doit vivre dans `src/shared/Partie.luau` et respecter
> le contrat de `CONTRAT.md`.

Série t1 (énoncé court, 4 unités, sans boutique) : close, saturée à 85/85, jamais comparée à t2.
`CONTRAT.md` (fourni) ne fixe QUE l'interface : `Partie.nouvelle(graine)`, `:jouer(joueur, carte,
x, y)`, `:avancer(dt)`, `:etat()`. Les RÈGLES ne sont PAS dans l'énoncé : les bras les déduisent,
les tests cachés les vérifient. Un énoncé qui dicte l'algorithme refait l'erreur du banc
recherche-arbre : l'appel nu gagne.

## 2. Les bras
Mêmes règles qu'`arena` § 3 : A = workflow actuel (témoin) · B = variante de TEXTE d'une skill ·
C = candidat non-texte (outil, garde-fou, routage) · X = appel nu. Chaque bras part d'une copie de
`modele/` dans `essais/<tournoi>/<bras>/`, avec un **budget en dollars** identique (40 $ par bras,
écrit dans `RUN.md`). **Aucune limite de temps** (choix de l'utilisateur, conv-767, saisie
ts 1790013239241 : « je veux aucune limite de temps ») : pas de `timeout`, pas de durée dans le
lanceur ni dans l'énoncé. Budget épuisé = le bras s'arrête et il est noté tel quel : un jeu
inachevé est une mesure, pas un incident. La durée réelle est relevée, jamais plafonnée.

**Lancer les bras HORS du tour — jamais en tâche de fond du chat, jamais par `Start-Process`.**
Le `claude` du chat tourne dans un Job Windows `KILL_ON_JOB_CLOSE`
(`src/main/providers/claude.ts` → `src/main/runs/survivable-spawn.ts`) : tout descendant, même lancé par
`Start-Process`, appartient au Job et meurt à la fin du tour. Mesuré en conv-767 : t2 (`run_in_background`,
12 bras morts à 7 s) puis t2v (`Start-Process`, 4 bras vivants à 2 min pendant le tour, morts ensuite sans
`statut.txt` et avec des sorties à 0 octet). Lancement, par l'outil d'Autowin (processus créé par WMI,
donc hors du Job du tour) :
`powershell -NoProfile -File D:\AutoWinOS\scripts\lancer-detache.ps1 -Commande '"<Git>\bin\bash.exe" -lc "<banc>/lance.sh"' -Dossier <banc>`
(`bin\bash.exe`, pas `usr\bin` : sans `-l`, `sleep` et `date` sont introuvables). Code 0 et
`"horsJob":true` = lancé et vérifié hors Job ; tout autre code = pas lancé proprement. Survie à une
VRAIE fin de tour pas encore observée pour cet outil : relis le processus ou `statut.txt` au tour suivant.
Repli déjà prouvé (t2b, 12 bras vivants au tour suivant) :
`schtasks //Create //F //TN AutowinArena-<tournoi> //SC ONCE //ST 23:59 //TR "\"<Git>\bin\bash.exe\" -lc \"<banc>/lance.sh\""`
puis `schtasks //Run //TN AutowinArena-<tournoi>` ; supprime la tâche (`schtasks //Delete //TN … //F`)
une fois `fin.txt` écrit. Contrôle commun : la chaîne des processus parents d'un bras ne doit pas
remonter au `claude.exe` du chat.
Termine ensuite le tour en disant où lire l'avancement (`statut.txt`, `fin.txt`). Au tour suivant,
relis ces fichiers au lieu de relancer. Avant de noter, vérifie que les `out-*.json` ne sont pas
vides : un bras à 0 octet n'a pas tourné, ce n'est pas un bras qui a perdu.

## 3. Grille — DEUX notes, la seconde est la vraie

### Note JEU /100 — l'instrument : un jeu PUBLIABLE, pas seulement des règles justes
Chaque ligne dit sa preuve. **Auto** = script rejouable, aucun avis. **Juge** = barème ancré
0 / 1 / 2 / 3 (0 absent · 1 présent mais cassé ou brut · 2 correct · 3 niveau d'un jeu publié du
genre), noté par DEUX juges distincts sur captures et vidéo du bureau caché ; un écart ≥ 2 niveaux
entre juges = arbitrage humain. Aucune note juge sans l'image LUE qui la fonde.
**Ouvrir Studio avec un chemin ABSOLU vers le `.rbxl`.** Avec un chemin relatif, Studio ne trouve pas
la place et reste sur son accueil « Chargement de Studio… » (conv-767 : journal Studio
`place session context change (nullptr <-> nullptr)`). Avec le chemin absolu, via
`scripts/hdesk-lancer.ps1 -Conversation <id>`, la place s'ouvre (titre de fenêtre = le fichier), mais la
**vue 3D reste unie** : `hdesk-observe.ps1` le signale lui-même, car le rendu GPU ne se capture pas sur un
bureau caché — aucun mode de rendu n'y échappe : OpenGL (`FFlagDebugGraphicsPreferOpenGL`) et Vulkan (`FFlagDebugGraphicsPreferVulkan`) testés en conv-767, vue 3D toujours unie et Explorer vide ; Studio n'a pas de rendu logiciel. Sur bureau caché, seuls l'interface de Studio (Explorer, Propriétés, sortie) est
observable ; un volet juge qui exige la vue 3D ou le jeu lancé est noté « non observable », jamais deviné.

| volet | poids | mesure | preuve |
|---|---|---|---|
| **1. Socle** | 5 | `rojo build` rend 0 ; `selene src` 0 erreur ; aucune erreur console sur 5 min de Play | auto (build, lint, journal de sortie Studio) |
| **2. Règles** | 20 | élixir, cycle main/deck, pose, ciblage, dégâts, tours, couronnes, prolongation, égalité, déterminisme | auto : `cache/regles.luau` (proportion de cas) + `cache/simulation.luau` (200 parties qui se TERMINENT) |
| **3. Équilibrage** | 10 | aucune carte dominante ni inutile ; coût cohérent avec la puissance ; aucune partie jouée d'avance | auto : `cache/equilibrage.luau`, 2 000 parties bot contre bot à decks tirés : taux de victoire de chaque carte dans [45 %, 55 %] = plein, dégressif jusqu'à 0 hors [35 %, 65 %] ; durée médiane d'une partie entre 2 et 4 min ; écart de victoire joueur 1 / joueur 2 < 4 points (bruit mesuré : ±5 points sur 400 parties, d'où 2 000) |
| **4. Multijoueur** | 10 | serveur autoritaire (le client n'envoie qu'une INTENTION, le serveur revalide coût, main, zone) ; appariement de 2 joueurs ; bot si seul ; déconnexion gérée | auto : lecture du code (aucun `jouer` côté client, RemoteEvent validé) + Studio « 2 clients » capturé ; juge 0-3 sur la fluidité |
| **5. Cartes et visuels** | 15 | chaque carte a une IMAGE (ImageId non vide), un cadre, son coût lisible ; ≥ 4 MODÈLES d'unités distincts (pas des blocs nus) ; arène et tours modélisées ; animations d'attaque et de mort | auto : `lune` ouvre le `.rbxl` et compte images et modèles ; juge 0-3 sur la qualité des modèles et des cartes |
| **6. Menus et interface** | 10 | menu principal, écran de deck, écran de fin, paramètres (son) ; lisible en téléphone ET en PC (UIScale / contraintes) ; transitions | juge 0-3 sur captures 1920×1080 et 390×844 ; auto : présence de chaque écran |
| **7. Boutique** | 10 | FONCTIONNELLE : un achat débite la monnaie, crédite l'objet, est persistant (DataStore sous `pcall`), `ProcessReceipt` idempotent pour Robux ; DÉSIRABLE : mise en avant, prix lisibles, offre du jour | auto : test `lune` de la logique d'achat (solde, double achat, reçu rejoué) ; juge 0-3 sur l'envie |
| **8. Gameplay et ressenti** | 10 | lisibilité d'une partie, retour des coups (chiffres de dégâts, effets, sons), bot qui joue des coups sensés, rythme | juge 0-3 sur vidéo d'une partie complète contre le bot |
| **9. Progression et rétention** | 5 | trophées, niveaux ou arènes, récompenses (coffres), quêtes quotidiennes — une raison de revenir | auto : présence et persistance ; juge 0-3 |
| **10. Prêt à publier** | 5 | icône et miniatures, nom et description, contrôles mobile et manette, performances (≥ 30 images/s avec 20 unités), aucune donnée perdue à la sortie (`BindToClose`), objets aléatoires payants avec probabilités affichées (règle Roblox) | auto : liste de contrôle ; FPS mesuré dans Studio |

Poids : 52 auto (socle 5, règles 20, équilibrage 10, multijoueur 4, visuels 7, boutique 6), 48 juge — le jeu « beau » ne pèse jamais plus que le jeu « juste ». Les
48 points juge n'ont PAS d'étalonnage de référence (la référence n'a ni menus ni ressenti) : ils
sont notés sur leur barème ancré, jamais estimés sans image lue.
Les bots d'équilibrage ne gardent pas d'élixir en réserve et lancent les sorts sur l'unité adverse la plus avancée : un
bot qui thésaurise faisait perdre tout sort à 20 % (défaut du bot, pas du jeu).

### Note AUTOWIN /100 — le livrable (journaux, jamais la mémoire du bras)
Lue dans `activity/conv-N.jsonl`, `causal-trace/*.jsonl` et `out-<bras>.json` de chaque bras :
| poids | mesure | source |
|---|---|---|
| 25 | **rendement** : note JEU ÷ $ et ÷ tours, comparé à A | `total_cost_usd`, nombre de tours |
| 20 | **frictions** : outil manquant, commande refusée, boucle répétée ≥ 2 fois à l'identique, question inutile à l'utilisateur, rustine | événements de refus et relances dans la trace ; −4 par friction |
| 20 | **preuve honnête** : chaque « fait/vert » du bras est suivi d'un artefact ; un vert déclaré que `check.mjs` contredit = 0 | rapport du bras contre la note JEU |
| 15 | **outillage forgé et réutilisable** : ce que le bras a dû fabriquer (script, skill) et qui servirait ailleurs | fichiers créés hors `src/` |
| 20 | **défauts d'Autowin OS révélés** : chaque friction REMONTÉE à sa cause (fichier + ligne d'Autowin OS qui la produit) | section `## Causes Autowin` du RUN.md |

Le gagnant du tournoi se lit sur la note AUTOWIN ; la note JEU sert de critère de qualité (un bras
sous 40/100 en JEU ne peut pas gagner, comme un bras qui rate le critère dans `arena`).

## 4. Clôture — Autowin OS amélioré, tentatives effacées
Dans cet ordre, sans en sauter :
1. **Relever** toutes les notes et frictions dans `historique.jsonl` et `RUN.md` (`## Dispersion
   mesurée`, `## Causes Autowin`) — AVANT tout effacement.
2. **Traduire chaque cause localisée en édition d'Autowin OS** (skill, prompt de pilotage,
   garde-fou, script), une par commit dédié, vérifiée hors modèle (`npm test` ciblé sur le fichier
   touché). Une friction sans cause localisée s'écrit « non localisée », jamais en règle ajoutée
   (constitution : « Pas de pansement »).
3. **Installer le gagnant** comme `arena` § 5 (B gagne → le texte de la skill est réécrit ; X gagne
   → alléger l'outillage) et journaliser les quatre bras via `npm run arena:duel -- noter`.
4. **Effacer les tentatives** : `essais/<tournoi>/` (copies de bras, projets Roblox, `.rbxl`) et les
   `git worktree` créés pour le tournoi. Portée STRICTE : uniquement les chemins listés dans
   `essais/<tournoi>/manifeste.txt`, écrit au lancement. Ne jamais effacer `modele/`, `cache/`,
   `check.mjs`, `historique.jsonl`, `RUN.md`, ni les journaux `out-*.json`. Dire en une ligne ce qui
   disparaît et ce qui reste. Avant l'effacement, archiver `git diff` de chaque bras dans
   `essais/<tournoi>.diffs.zip` (quelques Ko) : c'est la preuve du juge, elle ne se perd pas.
5. `npm run arena:protocole -- --run <RUN.md> --bench <dossier>` ; un RATE s'écrit tel quel.

## 5. Durcir le banc entre deux tournois
Tournoi t1 (2026-09-21, 12 bras) : **11 sur 12 à 85/85, l'appel nu compris** — le banc ne départage
pas encore. Tout point de pose d'un test caché doit tomber sur une case LIBRE : `(9, 2)` touchait la
tour du roi et pénalisait les bras qui appliquaient la bonne règle (corrigé en `(9, 10)`).

Si 3 bras ou plus dépassent 85 en JEU, le banc ne départage plus : ajouter des cas cachés
(règle déduite, pas dictée) dans `cache/` et le noter dans `historique.jsonl`. Ne JAMAIS modifier
`tache.txt` entre deux tournois qu'on veut comparer : un énoncé changé casse la série.

## Sortie (format imposé)
Le tableau d'`arena` § Sortie, avec deux colonnes en plus : `JEU /100` et `AUTOWIN /100`. Puis :
**Éditions d'Autowin OS** (une ligne par commit : fichier, cause corrigée, preuve) ·
**Frictions non localisées** · **Effacé / conservé** · **Discrimination** (écart JEU entre bras ;
si < 10 points, dire « banc à durcir »).

## Pièges
- **Optimiser le jeu** au lieu d'Autowin OS → un beau clone et zéro édition : tournoi raté.
- **Énoncé qui dicte les règles** → l'appel nu fait 100, rien n'est mesuré.
- **Effacer avant de relever** → les frictions, seule vraie récolte, disparaissent.
- **Effacement hors manifeste** → geste destructeur non borné : interdit.
- **Tester dans Studio à la main** → note non rejouable ; tout passe par `lune` et `rojo build`,
  sauf le point « jouable », seul à avis.
