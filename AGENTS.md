# Autowin OS — contexte du dépôt

> Relu à CHAQUE tour, après la constitution. Uniquement des FAITS sur ce dépôt.
> Règles de comportement : `src/main/consignes/constitution.ts`. Leçons et historique : le Brain.
> Plafond : 32 Ko PARTAGÉS avec les AGENTS.md des dossiers parents du même dépôt (le plus proche
> servi d'abord) ; au-delà, la coupe est signalée à l'agent avec le chemin du fichier complet.

## Carte
- Electron + React + TypeScript.
- `src/main/` processus principal (orchestration, modèles IA, contrôles, outils du chat)
- `src/renderer/` interface React · `src/preload/` pont IPC · `src/shared/` types partagés
- `skills/<nom>/SKILL.md` skills · `scripts/` outillage (node, ps1, py)
- `entreprise/<nom>/` tout ce qui est propre à une entreprise — le code ne l'importe JAMAIS ;
  ignoré par git (`.gitignore`), il reste sur le poste
- Distant unique : `origin` = GitHub `Raphi52/Autowin-OS` (Azure débranché le 2026-10-16)

## Sources uniques — on édite ICI, nulle part ailleurs
- Constitution → `src/main/consignes/constitution.ts`
- Consigne du chat → `src/main/consignes/chat-pilotage-prompt.ts`
- Consignes scout/frame/build/clean/judge → `src/main/consignes/phase-briefs.ts` (pas `skills/*/SKILL.md`)
- Chargement de ce fichier → `src/main/consignes/context-files.ts`
- Outils directs du chat → `src/main/chat/chat-mcp.ts`
- Dossier de données → `src/main/app/app-data.ts` (`.autowin-data/`)

## Vérifier
- Typage : `npm run typecheck` — jamais `tsc -p` à la main (faux TS6307).
- Test ciblé : `npx vitest run <fichier.test.ts>` ; `x.ts` a son test `x.test.ts` à côté.
- Lint : `npm run lint`.
- `npm test` = typage + TOUTE la suite + lint : long, seulement avant publication.
- Preuve d'interface : `node scripts/ui-capture.mjs --code-dev`
  (sans `--code-dev`, la capture montre l'app empaquetée, donc sans ta modification).
  Une interface nouvelle se regarde sur un thème sombre ET un clair : `--theme nebuleuse-verre`
  puis `--theme holographique-clair`.

## Interface — déclinable avec nos thèmes, par défaut
- Une couleur passe par un jeton : `var(--text)`, `--text-dim`, `--line`, `--bg-0` à `3`, `--gold`,
  `--rose`, `--ok`, `--warn`, `--err`. Transparence : `color-mix(in srgb, var(--gold) 30%, transparent)`.
- Jeton neuf : sa valeur dans `src/renderer/src/assets/theme.css` ET dans le bloc clair de `src/renderer/src/assets/theme-modes.css`.
- Jamais `var(--x, #hex)` : la valeur de secours est une couleur en dur, et les couches générées la recopient.
- Couleur qui doit rester fixe (décor 3D, papier) : commentaire `couleur-fixe: <raison>` sur sa ligne.

## Garde-fous — ils BLOQUENT vraiment
- `src/main/gardes/separation-entreprise.test.ts` : test rouge si un fichier hors `entreprise/`
  nomme l'entreprise ou ses termes propres (fichiers non suivis compris).
- `.githooks/pre-push` refuse trois cas, et seulement ceux-là :
  1. un push d'agent directement sur `main`/`master` sans `ALLOW_MAIN_PUSH=1`.
     Sur ce dépôt, on pousse DIRECTEMENT sur `main` avec `ALLOW_MAIN_PUSH=1`, sans PR
     (`npm run publier:main` pose la variable) ;
  2. un push vers GitHub dont un commit contient `entreprise/` (même pour un humain) ;
  3. un push vers GitHub qui envoie un nom ou un terme d'entreprise (fichier d'un commit envoyé,
     chemin ou message de commit) : `scripts/separation-avant-push.mjs`, mêmes règles que le test.
  Il ne vérifie PAS qu'un push a été demandé.
- `scripts/garde-npm-modules.mjs` : refuse une commande npm qui modifie `node_modules`
  pendant que l'app tourne (l'exe Electron est verrouillé, l'install casse à mi-chemin).
- `scripts/couleurs-en-dur.mjs` : le commit (`.githooks/pre-commit`) et la suite refusent qu'un
  fichier d'interface nouveau ait une couleur en dur, qu'un ancien en gagne, ou qu'un jeton
  littéral de `theme.css` n'ait pas de valeur claire. Plafonds par fichier :
  `scripts/couleurs-en-dur.plancher.json` ; `--baisser` enregistre une baisse, sans jamais monter.
  Le commit d'une copie de travail d'agent n'y passe pas : seule la suite l'y tient.
- `scripts/appels-bloquants.mjs` : même cliquet pour `execFileSync`, `execSync` et `spawnSync` dans
  `src/main` hors tests (ils figent la fenêtre) — plafonds : `scripts/appels-bloquants.plancher.json`.
  À la place : `execFileHorsFil` (`src/main/gel/execution-hors-fil.ts`) avec un délai maximal.

## Règles du dépôt — refusées par le hook des agents (`src/shared/garde-git-destructeur.ts`)
- Arrêt d'Electron/node PAR NOM, `git stash`, `reset --hard`, `checkout`/`restore` de tout l'arbre,
  `clean -f`, `npm run format` (`prettier --write .`) : plusieurs fils travaillent dans ce même
  dossier ; on ne touche que SES fichiers (`prettier --write <chemin>` reste libre).
- Non vu par le hook : arrêter ou relancer Electron par PID ou en différé — interdit aussi → `restart_app`.
- Commit demandé par l'app (accord de l'utilisateur, 06/11/2026) : quand un lot de plan est refusé
  parce que TES fichiers non commités le bloquent, l'app t'envoie un ordre. Travail terminé et
  vérifié → commite-le (`git commit -- <tes chemins>`, sans pousser) ; sinon, préviens le chef.
  Source : `src/main/orchestration/plans-de-lots-app.ts` (`#demanderLeCommit`).

## Lire l'état de l'app
- Tout vit sous `.autowin-data/autowin-os/` (pas directement sous `.autowin-data/`).
- `conversations.json` = instantané (fils actifs seuls) ; `conversations.json.journal.jsonl`
  = état vivant (il n'existe AUCUN `journal.jsonl` à la racine).
- Archives : `conversations.json.archive/`.
- RUN.md légers (une fiche par nouvelle demande, écrite par l'app) : `demandes/<conv>/<slug>-<date>/RUN.md`,
  volontairement hors de `runs/`. `demandes/index.jsonl` dit quelle fiche porte quel message ;
  `demandes/ecarts.json` compare les fiches au Board, recalculé après chaque fin de tour.
- Ce qu'un tour a VRAIMENT affiché : `turn-journals/<conv>/<turnId>.jsonl` (deltas, commandes,
  `resumed`) ; la sortie brute du modèle : `run-stdout/<token>.stdout.jsonl`, `token` lu dans
  l'événement `provider-journal` du même journal de tour.
- `scripts/conversations-sur-disque.mjs` est un MODULE à importer
  (`texteDuMessage`, `lireArchives`, `ajouterArchives`), pas une commande : lancé seul, il ne sort rien.

## Conventions
- Français partout : commentaires, libellés, messages de commit.
- Un commentaire dit le POURQUOI, pas le quoi ni l'historique : aucun renvoi `conv-NNN` (le lecteur
  n'ouvrira pas ce fil). La provenance vit dans le message de commit, que `git blame` retrouve.
  Contrôle : `node scripts/retirer-conv-commentaires.mjs --verifier <dossiers>` (code 1 s'il en reste ;
  `--appliquer` les retire, sans option il simule).
- Commit : `type(zone): phrase en français (conv-NNN)` — feat, fix, refactor, test, docs.

## Tenir ce fichier à jour
- Suivi par git : il se modifie et se commite comme du code (`docs(agents): …`). La source d'un fait
  va dans le message de commit, jamais dans le texte : `git log -p AGENTS.md` la retrouve.
- Un fait par ligne, que le dépôt peut prouver ; chaque chemin s'écrit en entier depuis la racine.
- `src/main/consignes/agents-md-faits.test.ts` le rejoue à chaque `npm test` : un chemin cité absent
  ou tronqué, un script npm inconnu, un renvoi à un fil ou un fichier sorti de git → rouge. Un fait clé
  y a aussi sa paire (citation mot pour mot + contrôle) : reformuler ce fait, c'est mettre sa paire à jour.
- Leçon, historique, préférence personnelle : pas ici. Au Brain, ou dans le profil de l'utilisateur.
