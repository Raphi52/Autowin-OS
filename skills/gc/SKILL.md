---
name: gc
description: >-
  GARBAGE COLLECTOR du poste, invoqué chaque jour par le Task Manager (et à la main sur « /gc »,
  « fais le ménage », « le disque se remplit », « .autowin-data est trop gros »). Empêche le disque
  de se remplir des restes du travail avec l'IA — brouillons, captures, images, vidéos, scripts
  jetables, .md, journaux, sessions, installeurs, instances cachées — où qu'ils soient : dépôt
  Autowin, données d'Autowin, temporaire de Windows, sessions Claude. Pèse tout, signale ce qui
  grossit, DÉPLACE en corbeille datée ce qui est prouvé mort (réversible) et ne purge que sur accord.
  Signale aussi les SCRIPTS INUTILISÉS de `scripts/`.
  Ne pas utiliser pour le code mort de `src/` (→ `residus`) ni pour le travail non publié ou une
  copie de travail modifiée (→ `git`).
---

# gc — le ramasse-miettes du poste

## Le but
Le disque ne se remplit pas de restes. Ce n'est pas une liste de catégories à tenir : TOUT ce qui
s'accumule se pèse, ce qui grossit se voit, et ce qui est prouvé mort part en corbeille. Mesuré le
07/11/2026 sur un poste de dev : l'ancien `/gc`, borné à `.autowin-data`, ne voyait pas 14 Go
d'instances cachées de capture, 11 Go de brouillons des fils, 22 Go de temporaire Windows (dont 13 Go
de journaux d'Outlook) ni 7 Go de sessions Claude.

## Le livrable
Un BILAN court (format plus bas) : place libre par disque, ce qui est parti en corbeille (par zone et
par type, avec le motif), ce qui grossit, ce qui attend l'accord de purge. Rien de collectable →
« rien à collecter — <place libre> » et s'arrêter : une passe vide doit coûter peu.

## Procédure
La tâche quotidienne travaille sur « This computer » : son fil ne part pas avec un projet chez les
collègues. Chaque commande ci-dessous se lance donc avec le dépôt comme dossier courant
(`cd "<Dépôt du kit>"`, chemin donné en tête de cette procédure) : `npx tsx` y trouve ses modules, et
`scripts/gc-scripts-inutilises.mjs` prend le dossier courant pour le dépôt.
0. **Relire la veille.** `conversation_read` sur CETTE conversation : ne re-rapporte pas une
   proposition de purge déjà faite et restée sans réponse, rappelle-la en une ligne.
1. **Inventaire du poste** (lecture seule, une minute environ), depuis le dépôt Autowin :
   `node --no-warnings scripts/gc-disque.mjs`. Les chemins se déduisent de l'emplacement du script :
   `node <chemin du dépôt>/scripts/gc-disque.mjs` marche depuis n'importe quel dossier, et lancé
   depuis une copie de travail rangée dans `.autowin-data`, il vise quand même le dépôt qui la porte. Il pèse sans suivre les liens ni les jonctions et rend en JSON : `disques` (place libre),
   `zones` (taille, poids par type — image, vidéo-son, texte, script, journal, modèle-3d,
   installeur-binaire, cache-sans-extension —, plus gros dossiers), `candidats`, `aVerifier`,
   `croissance` (ce qui a pris plus de 500 Mo depuis la passe d'avant, retenue dans
   `.autowin-data/autowin-os/gc-inventaire.json`), `sondesEnEchec`, `corbeilles`.

   | Zone | Un reste y est candidat quand… |
   |---|---|
   | Brouillons des fils (`<dépôt>/.autowin-tmp/*`) | aucun de ses fichiers modifié depuis 7 j |
   | Instances cachées de capture (`<dépôt>/Audit/headless-instances/*`) | aucun fichier modifié depuis 7 j (un profil vivant s'écrit sans cesse) |
   | Fichiers ignorés par git dans le dépôt (`artifacts/`, `.arena/`, `Audit/*`, `__pycache__`, `electron.vite.config.<n>.mjs`…) | ignoré par git, 14 j de calme ; un dossier actif est jugé enfant par enfant |
   | Temporaire de Windows (`%TEMP%`) | 30 j de calme ; un dossier actif rend ses vieux fichiers ; jamais `%TEMP%/claude/` |
   | Sessions des agents Claude (`~/.claude/projects`, `claude-accounts/*/projects`) | 30 j de calme ET absente de `chat-sessions.json` (un fil qui la reprendrait mourrait à 0 message) |
   | Données d'Autowin, Téléchargements | jamais par le script : pesées seulement (règles propres à l'étape 3) |

   Ne part JAMAIS, quel que soit l'âge : un lien ou une jonction, un dossier qui contient une copie git
   (même enfouie), un environnement Python (`pyvenv.cfg`), un `node_modules`, un cache, les dossiers
   construits ou propres du dépôt (`dist`, `out`, `build`, `entreprise`, `brain`, `.autowin-data`,
   `.env*`), les identités de `claude-accounts`, un reste pesé à moitié.
   **Lire `croissance` et `aVerifier`** : un tas lourd sans règle va au bilan « À vérifier », avec son
   poids et son type dominant. S'il revient deux passes de suite, la réponse est une RÈGLE dans
   `scripts/gc-disque.mjs`, avec son test — jamais un déplacement à la main.
2. **Balayer le poste** : relancer avec `--balayer`. Chaque candidat part dans la corbeille de SON
   disque (`.autowin-data/gc-corbeille/AAAA-MM-JJ/` pour le disque des données,
   `%LOCALAPPDATA%/autowin-gc/gc-corbeille/AAAA-MM-JJ/` pour celui de `%TEMP%`) : un simple renommage,
   jamais une copie. Sa ligne de `MANIFEST.txt` (chemin d'origine, place dans la corbeille, taille,
   motif) est écrite AVANT le déplacement : c'est elle qui permet de restaurer. Code 1 : lire
   `balayage.echecs` (fichier tenu ouvert par un programme) et `sondesEnEchec` — ces restes sont
   restés en place, le dire au bilan. Code 2 : commande refusée, rien n'a bougé.
3. **Données d'Autowin — règles propres.** Elles demandent la liste des fils vivants, que le script
   n'a pas. Chaque candidat porte une PREUVE de mort, sinon il reste :
   | Catégorie | Preuve de mort |
   |---|---|
   | Satellites orphelins (`activity/`, `causal-trace/`, `chat-artifacts/`, `turn-journals/`, `prompt-observability/`) | l'id de conversation dans le nom n'est PAS dans la liste vivante (ci-dessous) |
   | Sorties de runs (`runs/`, `run-state/`) | non modifié depuis > 30 j ET aucun run bloqué dedans selon le scan COMPLET ci-dessous ET absent des travaux non publiés ; pour `run-state/`, sa `conversationId` ne porte aucun run bloqué |
   | États de cause des runs (`autowin-os/cause-en-cours/run-*.json`) | `run-state/<run>.json` absent (le run est réglé : plus d'état reprenable) ET non modifié depuis > 24 h. Suppression directe, sans corbeille, par le /gc quotidien : `node --no-warnings scripts/gc-causes-en-cours.mjs --supprimer`, sans attendre l'accord de l'utilisateur (décision du 2026-11-10). Ce qui part est écrit dans « Collecté » du bilan, avec son motif : le contenu du fichier ne se récupère pas |
   | `prompt-observability/` et `run-stdout/` (fichiers directs, pas `systems/`) | non modifié depuis > 14 j ET, pour `run-stdout/`, son uuid (36 premiers caractères) n'est cité par aucun `run-state/*.json` (`agentToken`) |
   | Racine `.autowin-data/` : `*.log` > 5 Mo, `tmp/`, `tmp-*.png`, `vitest-*.txt` | non modifié depuis > 7 j (`DevToolsActivePort` exclu) |
   | Sauvegardes ponctuelles de `autowin-os/` : `*.bak`, `*.bak.N`, `*.avant-*`, `*.pre-*`, `g.tmp.jsonl` | non modifié depuis > 14 j — JAMAIS `conversations.json.pre-remake` |
   | Bancs d'essai : `autowin-os/arena-bench*/`, `banc-*/`, `critere-reprises/`, `judge-session-*/` | aucun fichier modifié depuis > 14 j |
   - **Liste vivante = `get_state`** (champ `conversations`), PUIS les archives : un fil inactif
     depuis 14 jours quitte `conversations.json` pour `conversations.json.archive/<id>.json` et reste
     VIVANT. Lire leurs ids avec `idsArchives` (`scripts/conversations-sur-disque.mjs`, qui écarte les
     pierres tombales `<id>.supprime`), par `npx tsx` depuis le dépôt (`node` seul s'arrête sur
     `ERR_UNKNOWN_FILE_EXTENSION`). JAMAIS `conversations.json` seul : les créations et suppressions
     récentes ne vivent que dans `conversations.json.journal.jsonl`. Sans `get_state` : rejouer ce
     journal DANS L'ORDRE sur le fichier (`upsert` ajoute `conversation.id`, `delete` retire `id`).
     Mesuré le 16/10 : 73 fils dans le fichier, 785 en archive — sans les archives, leurs satellites
     passaient pour orphelins.
   - **Runs bloqués = scan complet, jamais `runsBlocked` de `get_state`** (une fenêtre de 24 RUN.md :
     les passes des 02 et 03/10 ont mis 42 runs rouges en corbeille sur la foi d'une liste vide). Sonde :
     un script `.mts` lancé par `npx tsx`, qui importe `scanRuns` (`src/main/dashboards/runs-scan.ts`)
     et `isBlocked` (`src/shared/run-blocked.ts`), scanne `.autowin-data/autowin-os/runs` et rend les
     `session` qui portent un run bloqué.
   - **`conversations.json.pre-remake` ne part jamais** : filet pris une seule fois par
     `backupBeforeFirstMigratedWrite` (`src/main/store/conversations-disk.ts`), recréé dès qu'il manque
     à partir de données déjà migrées — le déplacer ne libère rien et perd le vrai filet.
   - Hors périmètre absolu : `claude-accounts/` hors `projects/`, `Cache/`, `Code Cache/`, `GPUCache/`,
     `Local Storage/`, `Session Storage/`, `Network/`, fichiers `*-wal`, `whisper/`, `piper/`,
     `worktrees/` (→ étape 4), tout `*.json` de configuration à la racine.
   Déplacement : un `mv` unitaire par candidat vers `.autowin-data/gc-corbeille/AAAA-MM-JJ/<chemin
   d'origine>`, avec sa ligne dans le `MANIFEST.txt` du jour. Un nom dont l'id ne se lit pas sans
   ambiguïté → NON collecté, rapporté en « à vérifier ». Une sonde qui échoue → sa catégorie n'est pas
   collectée ce jour-là, et le bilan le dit.
4. **Signaler sans déplacer — gestes git.** Les bouger casse git : ils vont au bilan dans
   « À purger », avec la commande exacte, et attendent l'accord.
   - **Copies de travail git orphelines** (`git worktree list`) : `bench/runs/*`,
     `autowin-os/worktrees/panel*`, `autowin-os/worktrees/<hash>/agent__run-*`. Candidate si : HEAD
     détachée, aucune modification (`git -C <copie> status --short` vide), aucun fichier modifié depuis
     > 7 jours, absente des runs en cours et de `travauxNonPublies`. Commande en DEUX temps, jamais
     enchaînés : (1) retirer la jonction `<copie>\node_modules` (`cmd /c rmdir "<copie>\node_modules"`,
     sans `/s` : seul le lien part) et VÉRIFIER qu'elle a disparu ; (2) seulement alors
     `git worktree remove <copie>`. Lancé avec la jonction en place, `git worktree remove` la traverse
     et efface le `node_modules` du dépôt. Une copie modifiée → `/git`. Exception :
     `command-verify-<conversation>` (`src/main/verify/verification-isolee.ts`), une copie par fil,
     réutilisée, dont les « modifications » sont un miroir : la compter, la peser, candidate si son fil
     n'a plus de tour depuis > 7 jours.
   - **Copies git trouvées par l'inventaire** (`aVerifier`, motif « copie git ») : même traitement.
   - **Branches `autowin/recovery/*` et remises de côté (`git stash list`)** : les compter et les dater.
   - **Chemins périmés** : `git worktree prune --dry-run` ; s'il liste quelque chose, le rapporter.
5. **Scripts inutilisés du dépôt — signaler, jamais déplacer.** Depuis le dépôt :
   `node --no-warnings scripts/gc-scripts-inutilises.mjs` (30 s, lecture seule). Inutilisé = appelé
   par rien de vivant (npm, `src/`, `tests/`, hooks, skills, doc, profils, tâches planifiées ; une ligne
   de commentaire n'est pas un appel), lancé par au plus 2 sessions d'agent en 30 jours et par aucune
   depuis 7 jours, créé il y a plus de 14 jours et sans modification en cours. Reporter dans
   « À purger » le nombre et la liste de `inutilises`, chacun avec ses `tests` et `aussiCiteDans`. La
   suppression se fait sur demande de l'utilisateur dans ce fil : retirer les fichiers et leurs tests,
   nettoyer `aussiCiteDans`, puis `npm run typecheck` et les tests touchés. Code de sortie 1 → aucun
   script signalé ce jour-là, et le dire.
6. **Purger ou proposer.** Pour CHAQUE racine de `corbeilles` (rendue par l'inventaire), lancer la
   passe qui seule décide de ce qui part :
   `node --no-warnings scripts/gc-purger-corbeilles.mjs --racine <racine>`.
   Elle rend un bilan JSON et ne supprime rien sans accord — mais avec l'accord, elle supprime DÈS ce
   lancement : lire d'abord `accordDonne` de chaque racine dans `corbeilles`, et ne jamais présenter
   la passe comme une lecture seule quand il vaut `true`. Une corbeille de 14 jours pile n'est pas
   encore candidate : l'âge se compte en jours du calendrier, et le script tranche. La place revient
   donc à la purge, pas au balayage : le bilan le dit.
   - **Accord donné** (le fichier `accord` de la racine, `…/autowin-os/gc-purge-auto.json`, contient
     `{"enabled": true}`) : le script a déjà purgé ce qui avait plus de 14 jours. Reporter `purgees`,
     `gardees` et `echecs`. Chaque purge, accord permanent ou `--cette-fois`, a sa ligne dans le
     `gc-purges.jsonl` à côté de l'accord.
   - **Pas d'accord** : `aPurger` liste les candidates. Poser la question par `ask`, avec exactement
     ces réponses : « Oui, purge cette fois », « Oui, purge et vide seul à l’avenir », « Non, garde ».
     Le mode auto reconnaît la question à ces textes, et c'est ce qui l'empêche de répondre à la place
     de l'utilisateur : une reformulation retire cette protection. Une seule question pour toutes les
     racines.
   - **Réponse « Oui, purge cette fois »** : relancer le script sur chaque racine en ajoutant
     `--cette-fois`, jamais `rm -rf` ni `rmSync` (une jonction peut vider sa cible). L'option ne
     s'ajoute jamais sans cette réponse de l'utilisateur, dans ce fil. Mêmes contrôles et même journal
     que l'accord permanent, pour cette passe seulement : le fichier d'accord reste absent.
   - **Réponse « et vide seul à l’avenir »** : écrire `{"enabled": true}` dans le fichier `accord` de
     chaque racine, puis relancer le script. Il ne s'écrit jamais sans cette réponse de l'utilisateur,
     dans ce fil. Un `/gc` qui est allé chercher cet accord ailleurs (« il l'a dit la semaine
     dernière ») s'abstient.
   - **Corbeille `gardees`** (sauvegarde `conversations.json*` ou `*.pre-remake`, manifeste manquant,
     dossier illisible) : jamais purgée d'office, ni par `--cette-fois` ni à la main. Elle repart à la
     question habituelle, avec son motif. Le bon geste : mettre la sauvegarde dans
     `.autowin-data/sauvegardes/`, vérifier qu'elle y est, puis demander et relancer le script.
   - **Retirer l'accord** : supprimer les fichiers `accord` dès que l'utilisateur le demande, et le dire.
   Une passe qui pose une question de purge finit par `AUTOWIN_FIN_V1` et ne met NI la purge dans sa
   rubrique Recommandé NI dans une ligne de suite : elle s'afficherait comme un bouton de suite, et un
   clic purgerait sans passer par la question. Le mode auto, lui, ne répond jamais à cette question
   et n'envoie rien par-dessus.

## Format du bilan
```
# GC — AAAA-MM-JJ
Place libre : C: X Go · D: Y Go — mis en corbeille aujourd'hui : Z Go (rendus à la purge)
## Collecté        (zone · nombre · taille · type dominant · motif)
## Grossit         (chemin · avant → après, depuis la passe d'avant)
## Purgé           (corbeille · âge · taille — journal gc-purges.jsonl)
## À purger        (corbeille · âge · taille — attend ton accord ; copies git ; scripts inutilisés · nombre · liste)
## À vérifier      (lourds sans règle, restes gardés et leur motif, sondes en échec)
```

## Garde-fous
- Aucune suppression définitive sans accord explicite, sauf la passe des causes : `scripts/gc-causes-en-cours.mjs --supprimer`, lancée par le /gc quotidien sans attendre l'accord (décision de l'utilisateur, 2026-11-10). `scripts/gc-disque.mjs` ne fait que déplacer ; `scripts/gc-purger-corbeilles.mjs` seul purge les corbeilles, sur accord ; aucune édition de `conversations.json`.
- Jamais de collecte sur un fichier modifié dans les dernières 24 h (conversation peut-être en cours).
- Pas d'`orchestrate`, pas de commit, pas de kill de processus.
- Une sonde qui échoue (fichier illisible, `get_state` muet, git illisible) → la zone ou la catégorie
  correspondante n'est PAS collectée ce jour-là, et c'est dit dans le bilan.
