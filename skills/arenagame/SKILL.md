---
name: arenagame
description: >-
  Variante de `arena` sur un banc FIXE et LONG : un clone jouable de Clash Royale dans Roblox Studio,
  refait de zéro à chaque tournoi. But final : un jeu PARFAIT produit en UN SEUL prompt. Le jeu n'est QUE l'instrument de mesure : le livrable est une
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

**But final : un jeu PARFAIT en UN SEUL prompt.** Chaque tournoi doit rapprocher Autowin OS du
jour où un unique message utilisateur (« fais un clone de Clash Royale dans Roblox ») suffit à
produire un jeu complet, sans relance ni intervention humaine. C'est l'étalon de toutes les
améliorations : une édition d'Autowin OS vaut ce qu'elle retire comme relance, blocage ou retouche
manuelle sur ce chemin.

**Règle cardinale : le score du jeu n'est pas le but.** Un bras qui fait un meilleur jeu en
contournant Autowin OS (outil bricolé en silence, vérification sautée) apprend MOINS qu'un bras
moyen dont chaque blocage est tracé. Le tournoi se clôt sur des ÉDITIONS D'AUTOWIN OS, pas sur un jeu.

## 0. Pré-requis de l'environnement (vérifié à chaque tournoi)
Installés le 2026-09-21 via Rokit 1.2.0 : `rojo` 7.7.0, `lune` 0.10.5, `selene` 0.31.0, épinglés
dans `modele/rokit.toml`. `check.mjs` appelle les binaires RÉELS de
`~/.rokit/tool-storage/<auteur>/<outil>/<version>/` : les raccourcis de `~/.rokit/bin` refusent de
démarrer dans un dossier sans `rokit.toml` (constaté : « Failed to find tool 'lune' in any project
manifest file »). Vérifier avant tout lancement : `node check.mjs modele` rend `auto: 5` (socle du
squelette vide, tout le reste à 0) et `node check.mjs reference` rend `auto: 51.9` (depuis t5 ; 51.8 avant). Un autre chiffre = le banc a bougé : STOP.
Un outil absent n'arrête pas le tournoi : c'est une étape à fabriquer (`forge`).

## 1. Le banc — FIGÉ, identique d'un tournoi à l'autre
Dossier : `D:\AutoWinOS\.arena\arenagame\`. Contenu permanent (jamais effacé) :

| chemin | rôle |
|---|---|
| `tache.txt` | l'énoncé donné aux bras, mot pour mot (ci-dessous) |
| `modele/` | point de départ copié dans chaque bras : `default.project.json` Rojo, `rokit.toml`, `selene.toml`, `CONTRAT.md`, `src/shared/Partie.luau` vide |
| `cache/regles.luau` | **35 tests cachés** de règles (élixir, cycle, pose, combat, fin de partie, déterminisme ; depuis t4 : sorts et départage de fin de prolongation ; depuis t5 : pose sur une tour, temps de déploiement, tenue de voie) |
| `cache/simulation.luau` | 200 parties aléatoires, invariants vérifiés à chaque pas |
| `cache/equilibrage.luau` | 2 400 parties « bot qui privilégie une carte » + 2 000 parties bot contre bot (≈ 45 s) |
| `cache/boutique.luau` | 13 tests cachés de la logique de boutique (`src/shared/Boutique.luau`, interface dans `CONTRAT.md`) |
| `cache/visuels.luau` | lit le `.rbxl` construit : images des cartes, modèles `ReplicatedStorage.Modeles.<idCarte>` |
| `reference/` | implémentation de référence : **51,9/52** en auto (51,8 avant t5) — preuve que la note auto maximale est atteignable ; elle ne couvre PAS les volets juge (menus, ressenti…) |
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
`powershell -NoProfile -File D:\AutoWinOS\scripts\lancer-detache.ps1 -Commande 'powershell -NoProfile -File D:\AutoWinOS\.arena\arenagame\outils\lancer-cache.ps1 -Script <banc>/lance.sh -Id <tournoi>' -Dossier <banc>`
**Toujours sur un bureau caché** (`outils/lancer-cache.ps1` → `scripts/hdesk-lancer.ps1`) : en t4
(2026-09-24), les bras ont écrit leurs propres `verifier.mjs` / `outils/equilibre.mjs` qui appellent
`lune.exe` par `spawnSync` SANS `windowsHide` — une console par appel sur l'écran de l'utilisateur,
des centaines pendant l'équilibrage. Un bureau caché les absorbe toutes, quoi qu'écrivent les bras.
Pas de `schtasks` : sa console bash est VISIBLE et la fermer tue tout (t4 essai 3, code 0xC000013A).
Ne pas redémarrer le PC pendant un tournoi : t4 essais 1 et 2 sont morts ainsi (événement 1074).
(`bin\bash.exe`, pas `usr\bin` : sans `-l`, `sleep` et `date` sont introuvables). Code 0 et
`"horsJob":true` = lancé et vérifié hors Job ; tout autre code = pas lancé proprement. Survie à une
vraie fin de tour observée (conv-767 : témoin pid 24972 lancé à 20:28:49, toujours vivant et écrivant
à 20:29:36, après la fin du tour qui l'avait lancé).
**Chaque bras passe par `lance-bras.sh`, jamais par un `claude -p` nu.** C'est aussi LE point où
tout tournoi reçoit, quel que soit son `lance.sh` : (1) une copie du `sys` complétée par `clean` et
`judge` si elle ne les porte pas (`sys-effectif-<bras>.txt`, le `sys` du tournoi reste intact, le
bras X nu n'est pas touché ; `ARENA_SANS_CLEAN_JUDGE=1` désactive) ; (2) la clôture du RUN.md
(`check.mjs` → `note-clore-<bras>.json` → `clore-run.mjs`). t4 (2026-09-24), lancé hors de
`nuit.sh`, n'avait ni l'un ni l'autre : 11 runs sur 12 bloqués, 0 trace de nettoyage. (3) chaque
`claude -p` y est lancé avec `--setting-sources project,local` : les réglages PERSONNELS
(`~/.claude/settings.json`, qui ne portent qu'un hook Brain) sont ignorés. Ce hook, remis en état le
24/09 à 15:09, injectait dans tous les bras des notes d'un vrai projet voisin (BrainRotRoyale), X
compris : 0 injection dans X le 22/09, 31 le 25/09, et X délégait alors sa production (+25 % de coût).
Prouvé sur un vrai `claude -p` (`--include-hook-events`) : sans l'option, le hook s'exécute ; avec,
aucun événement de hook. Opt-out : `ARENA_AVEC_HOOKS_PERSO=1`. Un `claude` de test lancé depuis une
session Autowin hérite de `CLAUDE_CONFIG_DIR` (compte Autowin, sans ce hook) : le retirer
(`env -u CLAUDE_CONFIG_DIR …`) pour reproduire l'environnement réel d'un bras. t2b, t2v et t3 ont eu TOUS
leurs bras coupés vers 30 min par la limite de session Claude (« You've hit your session limit ·
resets 7pm », `is_error: true`) : des jeux inachevés, notés comme s'ils avaient perdu.
`lance-bras.sh <banc> <bras-replique> <prompt> [sys]` attend l'heure de remise à zéro annoncée puis
reprend la MÊME session (`--resume`) avec le budget restant ; `out-<bras>.json` cumule coût, tours
et durée, et porte `reprises`. Corps du `lance.sh` d'un tournoi :
`for b in a b c x; do for r in 1 2; do bash "$ARENE/lance-bras.sh" "$BANC" $b-$r "$BANC/prompt-$b.txt" $( [ $b = x ] || echo "$BANC/sys-$b.txt" ) & done; done; wait; date > "$BANC/fin.txt"`
(`ARENE=D:/AutoWinOS/.arena/arenagame`). Vérifié le 2026-09-22 avec un faux `claude` coupé deux fois :
2 reprises sur la même session, budget 40 → 30,50 → 21 $, attente calculée jusqu'à 19h02.
**Bras isolés (depuis le 2026-09-26, conv-826)** : `lance-bras.sh` déplace la copie du bras dans
`D:\bras-isoles\<tournoi>-<bras>\jeu` (hors du dépôt) le temps du bras, puis la rend avant la notation ; le RUN.md
du bras vit sous `…\runs` (racine dite en fin de sys, écrite dans `out.json` → `runs_racine`, que `clore-run.mjs`
suit) ; `--settings isolement-<bras>.json` interdit Read/Edit sur `D:\AutoWinOS`, `~\.claude\runs` et Read sur
`~\.claude\projects`, plus les commandes Bash/PowerShell qui les nomment (motifs `*AutoWinOS*`, `*.claude*runs*`,
`*.claude*projects*` — la correspondance IGNORE LA CASSE : un motif sans le point, `*claude*runs*`, a refusé à tort en
nuit-2026-09-26-iso m1 une commande de c-1 qui citait `$env:CLAUDE_SESSION_ID` puis sa propre racine `…\runs`) ; les variables `NUIT_*` sont retirées.
**Ne jamais modifier `lance-bras.sh` ou `nuit.sh` pendant qu'un tournoi tourne** : bash lit le script au fil de
l'exécution, un décalage d'octets casse la fin des bras en cours (notation, retour des copies). Correctif urgent =
même longueur en octets, sinon attendre `fin.txt`.
`ARENA_ISOLER=0` désactive (l'améliorateur de `nuit.sh` l'utilise : il doit lire le banc) ; `ARENA_MODELE` choisit le
modèle (tests à blanc). Mesuré sur un bras à blanc réel (haiku, 0,07 $) : dossiers parents sans trace du banc ;
Read, Get-Content, Glob, Get-ChildItem sur `lance-bras.sh`, `~\.claude\runs` et un ancien RUN.md d'essai →
**refusés**. **Fuite restante** : une recherche récursive de tout `D:\` (`Get-ChildItem D:\ -Recurse -Name`)
voit encore le NOM `AutoWinOS\.arena\arenagame\lance-bras.sh` ; son contenu reste fermé aux outils et aux commandes
qui le nomment, pas à un script qui ouvrirait le fichier lui-même (limite documentée des interdictions ; seul un bac
à sable du système la fermerait).
Repli déjà prouvé (t2b, 12 bras vivants au tour suivant) :
`schtasks //Create //F //TN AutowinArena-<tournoi> //SC ONCE //ST 23:59 //TR "\"<Git>\bin\bash.exe\" -lc \"<banc>/lance.sh\""`
puis `schtasks //Run //TN AutowinArena-<tournoi>` ; supprime la tâche (`schtasks //Delete //TN … //F`)
une fois `fin.txt` écrit. Contrôle commun : la chaîne des processus parents d'un bras ne doit pas
remonter au `claude.exe` du chat.
Termine ensuite le tour en disant où lire l'avancement (`statut.txt`, `fin.txt`). Au tour suivant,
relis ces fichiers au lieu de relancer. Avant de noter, vérifie que les `out-*.json` ne sont pas
vides : un bras à 0 octet n'a pas tourné, ce n'est pas un bras qui a perdu.

## 2 bis. Mode nuit — enchaîner les tournois sans humain
Demande utilisateur (conv-782, 2026-09-22 : « lance des /arenagame toute la nuit le but c est d améliorer les workflows jusqu a avoir un jeu parfait en one shot »).
`.arena/arenagame/nuit.sh` enchaîne des MANCHES dans `essais/nuit-<date>/m<k>` : 4 bras × 1 réplique (A = meilleur workflow mesuré, B = variante de texte, C = variante outil/procédure, X = appel nu), chacun via `lance-bras.sh` à 40 $, notés par `check.mjs` et ajoutés à `historique.jsonl`, puis clos par `clore-run.mjs` (`status: green` si le critère de `check.mjs` est atteint, `red` sinon) ; copies archivées en `m<k>.bras.tar` puis effacées. Entre deux manches, un AMÉLIORATEUR (`claude -p`, 15 $) lit les notes et le code produit, garde A sauf si B ou C le bat d au moins 2 points, écrit deux nouvelles variantes et une section `## m<k>` dans `essais/nuit-<date>/RUN.md`. Il n a PAS le droit de toucher `check.mjs`, `cache/`, `reference/`, `modele/` ni l énoncé.
Depuis conv-826 (2026-09-25) : si `NUIT_SOURCE` est un tournoi DÉJÀ noté (`note-*.json`), l améliorateur passe d abord (`m0/ameliore`) — sinon m1 rejouait à l identique des workflows déjà mesurés (~45 $). Règle d adoption de A élargie : B ou C remplace A aussi s il est à moins de 1 point pour un coût inférieur d au moins 30 % (la note auto sature près de 52/52 depuis t4, la règle des 2 points ne pouvait plus jouer). Piège : l arrêt à l heure vaut de `NUIT_FIN_H` à 18 h, donc un lancement l après-midi avec la valeur par défaut s arrête AVANT la première manche — mettre `NUIT_FIN_H=24` pour ne pas s arrêter à l heure. Les variables ne traversent pas `lancer-detache.ps1` (WMI) : les fixer dans un `lance.sh` du dossier de nuit (modèle : `essais/nuit-2026-09-25/lance.sh`).
**Nuit du 2026-09-25 (m0-m6, 277 $ réels dont 12,70 $ d améliorateurs ; arrêtée à la main après m6, conv-826 « fini ce banc »)** : sur m2-m6, la lignée B (B8 → B12) bat le témoin B6 en note ET en coût dans les **5 manches sur 5** (moyennes 51,50 contre 50,94 ; 7,92 $ contre 9,75 $ réels) ; la lignée C a la meilleure note (51,86) pour un coût voisin de A (10,14 $). Écarts de note dans le bruit de l équilibrage (≈ 0,5 point), SAUF une règle : B6 accepte la pose sur une tour **5 fois sur 5**, les B et C qui la disent la passent. Décision humaine : la lignée B est adoptée, **A = B12** (`essais/nuit-2026-09-25/m6/sys-b.txt`, 38 969 octets), point de départ par défaut de la prochaine nuit (`NUIT_SOURCE` = `essais/nuit-2026-09-25/m6`). La règle d adoption de l améliorateur accepte désormais une lignée qui bat A sur les deux axes 3 manches de suite. Ce qui en sort pour Autowin OS (hors jeu) : `build` 4 bis (jumeau d acceptation de chaque refus) et `judge` (juges au premier plan). Correctifs du lanceur le 2026-09-26 : `lance-bras.sh` coupe la mémoire automatique (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` : avant, les 4 bras, appel nu compris, lisaient `memory\arenagame-*.md` du dépôt — **tout X antérieur au 2026-09-26 n est pas un appel nu**), prend le coût du DERNIER segment après une reprise (`--resume` rend un coût cumulé : m5 annonçait 12,80 $ pour 9,03 $ réels) et dit que le workflow du bras prime sur CLEAN/JUDGE ; `nuit.sh` étiquette `historique.jsonl` par le dossier de nuit et exige, pour toute règle de jeu écrite par l améliorateur, la ligne d un bras qui la passe.
`NUIT_A_FIXE=<sys>` impose A à la première manche (l améliorateur m0 écrit B et C sur ce texte ; le script recopie A après lui). Aucun améliorateur ne tourne après la DERNIÈRE manche. Nuit du 2026-09-26 (`essais/nuit-2026-09-26/lance.sh`, 2 manches, A = B12) : premiers vrais appels nus, aucun des 4 bras de m1 ne lit `memory\` (contrôlé sur leurs premiers appels d outils) ; 0 console visible sur l écran réel avec jusqu à 21 `lune.exe` actifs (`surveillance-consoles.txt`). Isolement encore incomplet, observé le même jour : un bras kit a lu `D:\AutoWinOS\.arena\arenagame\lance-bras.sh` (hors de sa copie) et les bras listent `~\.claude\runs` (RUN.md des essais précédents) — le dossier du banc reste lisible depuis un bras. Résultat (fin 09:18, 65 $) : A = B12 reste (51,6 · 51,5 ; B13/B14 et C13/C14 plus bas, moins chers sous le seuil de 30 %) ; **le vrai appel nu fait 49,2 · 50,0**, contre 50,87 en moyenne pour les X du 25 qui lisaient la mémoire — le kit le bat en note dans les 2 manches (+1,7 point). m1 sans reprise : 5,9 à 6,8 $ par bras kit (m6 : 7,4 à 10,4 $).
Arrêts : `NUIT_BUDGET_USD` (500 $ par défaut, une manche ne démarre que s il reste 170 $), `NUIT_FIN_H` (9 h), `NUIT_MANCHES` (6). Arrêter une nuit en cours : tuer le SEUL pid de `nuit.sh` (jamais par nom), laisser finir les `lance-bras.sh` vivants, puis faire à la main la fin de manche du script (notes, `historique.jsonl`, archive `m<k>.bras.tar` relue, effacement du manifeste, `fin.txt`). Lancement hors du tour par `lancer-detache.ps1` comme au § 2. Au réveil : lire `journal.txt`, `RUN.md`, `fin.txt` ; la note des 48 points de jugement reste non observable (§ 3).

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
**Voie qui voit la 3D : Studio dans la session de l'utilisateur, piloté SANS sa souris** (conv-826, 2026-09-25,
outils `juge-t4/fenetre.ps1`) : `PrintWindow(PW_RENDERFULLCONTENT)` sur la fenêtre Studio capture la vue 3D
(arène, tours, rivière lues), et des clics par `PostMessage` ferment les dialogues (« Migration de la technologie
d'éclairage » → Continuer) et lancent Jouer, sans prendre le curseur ni le premier plan. LIMITE mesurée : quand
la fenêtre du bureau à distance de l'utilisateur est RÉDUITE, Studio ne redessine plus la 3D (capture édition et
capture en jeu identiques au pixel, redimensionner n'y change rien). Préalable : fenêtre RDP affichée, ou sur le
PC CLIENT `HKCU\Software\Microsoft\Terminal Server Client\RemoteDesktop_SuppressWhenMinimized` = 2 (DWORD)
(https://docs.uipath.com/robot/standalone/2023.4/user-guide/executing-tasks-in-a-minimized-rdp-window). Non
encore mesuré : le rendu quand Studio est simplement caché derrière une autre fenêtre.

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
   mesurée`, `## Causes Autowin`) — AVANT tout effacement. Chaque bras noté est aussitôt CLOS :
   `node .arena/arenagame/clore-run.mjs <note-<b>.json> <out-<b>-1.json>` pose `status: green|red`
   dans le RUN.md que sa session a écrit (retrouvé par le journal de session, le nom du dossier
   n'étant pas le session_id). Sans ce statut, Autowin lit `unknown` et compte l'essai comme run
   BLOQUÉ (mesuré le 2026-09-23 : 46 essais terminés remontaient ainsi). Le statut ne suffit pas
   (une case `- [ ]` bloque aussi) : clore-run RANGE ensuite le dossier du RUN.md dans
   `<dossier du out.json>/runs/` — c'est là, et plus sous `~\.claude\runs`, qu'on relit un bras clos. Avant de
   poser son statut, clore-run recopie UNE fois le `status:` du bras dans `status_bras:` (`aucun` s'il n'en avait
   pas, `inconnu` si le RUN.md était déjà rangé) : le verdict déclaré par le bras est la base de la note « preuve
   honnête » (§ 3). Avant le 2026-09-26 il était écrasé (nuit-2026-09-26 m2 a-1 : `red` posé, `green` relu).
   Tant que le bras tourne, son RUN.md est sous `~\.claude\runs` et Autowin l'affiche (ouvert, puis rouge si le
   bras s'est déclaré `red`) jusqu'à sa clôture : c'est attendu, pas un blocage.
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

Durcissement t5 (2026-09-24), mesuré sur les 8 bras de t4 rejoués : « pose refusée sur une tour » rate chez **7 bras sur 8** (seul c-2 passe) ; « temps de déploiement » et « tenue de voie » passent chez les 8. Écart auto inchangé (**50,2 → 51,6**, 1,4 point) : un cas de règles pèse 20/35 ≈ 0,6 point, trop peu pour départager. Les règles sont presque épuisées comme levier ; le vrai départage est dans les 48 points juge (menus, ressenti), encore non mesurés.
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
