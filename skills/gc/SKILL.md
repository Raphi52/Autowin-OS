---
name: gc
description: >-
  GARBAGE COLLECTOR d'Autowin OS, invoqué chaque jour par le Task Manager (et à la main sur « /gc »,
  « fais le ménage des données », « .autowin-data est trop gros »). Mesure ce qu'occupe
  `.autowin-data`, repère les DÉCHETS prouvés — satellites de conversations supprimées, sorties de
  runs anciennes, fichiers temporaires à la racine — et les DÉPLACE en corbeille datée
  (réversible). Ne supprime jamais définitivement sans demande explicite de l'utilisateur.
  Ne pas utiliser pour le code mort de `src/` (→ `residus`) ni pour le travail non publié ou une
  copie de travail modifiée (→ `salvage`).
---

# gc — le ramasse-miettes des données d'Autowin OS

## Le livrable
Un BILAN court : taille avant → après, ce qui est parti en corbeille (par catégorie, avec le motif
de chaque catégorie), et ce qui est PROPOSÉ à la purge définitive. Rien de collectable → écrire
« rien à collecter — <taille totale> » et s'arrêter : une passe vide doit coûter peu.

## Racines (ce qui est VIVANT — ne jamais y toucher)
- **Conversations vivantes = `get_state`** (son champ `conversations`) : c'est la racine de marquage.
  JAMAIS `conversations.json` seul : sur disque, il n'est réécrit qu'à certains moments, et les
  créations/suppressions récentes ne vivent que dans `conversations.json.journal.jsonl` (mesuré :
  18 ids dans le fichier contre 20 vivantes, dont la conversation GC en cours).
  Sans `get_state` : rejouer ce journal DANS L'ORDRE sur le fichier (`upsert` ajoute
  `conversation.id`, `delete` retire `id`) ; si ni l'un ni l'autre ne se lit → garde-fou « sonde
  qui échoue » : aucun satellite collecté ce jour-là.
  Constaté aussi le 2026-10-05 : le fichier de base, figé au 02/10, ignorait toutes les
  conversations créées depuis — elles n'existaient QUE dans le journal.
  **Puis AJOUTER les archives** : depuis le 2026-10-14 (cb33e5ac), un fil inactif depuis 14 jours
  quitte `conversations.json` pour `conversations.json.archive/<id>.json` — il reste VIVANT.
  Lire leurs ids avec `idsArchives` (`file:///D:/AutoWinOS/scripts/conversations-sur-disque.mjs`,
  qui écarte les pierres tombales `<id>.supprime`), moins ceux que le journal supprime. Mesuré le
  2026-10-16 : 73 fils dans le fichier, 785 en archive, 861 vivants — sans les archives, les
  satellites de 785 conversations vivantes passaient pour orphelins.
- `get_state` : runs en cours, `travauxNonPublies`, copies de travail (`run_status`).
- Hors périmètre ABSOLU : `claude-accounts/` (identités, secrets), `Cache/`, `Code Cache/`,
  `GPUCache/`, `Local Storage/`, `Session Storage/`, `Network/`, fichiers `*-wal` (propriété
  d'Electron, il les gère seul), `whisper/`, `piper/` (modèles), `worktrees/` (→ `/salvage`),
  tout fichier de configuration `*.json` à la racine autre que les satellites listés ci-dessous.

## Procédure
0. **Relire la veille.** `conversation_read` sur CETTE conversation : ne re-rapporte pas une
   proposition de purge déjà faite et restée sans réponse, rappelle-la en une ligne.
1. **Mesurer** (lecture seule) : taille par dossier de `.autowin-data/autowin-os` et de
   `.autowin-data`. Noter le total. PAS `du` : celui de Git Bash suit la jonction
   `worktrees/<hash>/agent__run-*/node_modules` → le `node_modules` du dépôt et ne finit pas
   (mesuré le 2026-10-11 : > 5 min). Mesurer avec un parcours `lstat` qui saute les liens et
   les jonctions (`readlinkSync` qui rend une cible = lien à ne pas suivre).
2. **Marquer** — chaque candidat doit porter une PREUVE de mort, sinon il reste :
   | Catégorie | Preuve de mort |
   |---|---|
   | Satellites orphelins (`activity/`, `causal-trace/`, `chat-artifacts/`, `turn-journals/`, `prompt-observability/`) | l'id de conversation dans le nom n'existe PAS dans la liste vivante (`get_state`, cf. Racines — jamais `conversations.json` seul) |
   | Sorties de runs (`runs/`, `run-state/`) | dossier non modifié depuis > 30 jours ET AUCUN run bloqué dedans — selon le scan COMPLET ci-dessous, jamais `runsBlocked` de `get_state` — ET absent des travaux non publiés ; pour `run-state/`, sa `conversationId` ne porte aucun run bloqué |
   | Rétention `prompt-observability/` et `run-stdout/` (fichiers directs, pas le sous-dossier `systems/`) | fichier NON MODIFIÉ depuis > 14 jours (mtime) ET, pour `run-stdout/`, son uuid (36 premiers caractères du nom) n'est cité par AUCUN `run-state/*.json` (champ `agentToken`) — l'âge suffit : ces données sont des journaux, pas un état |

   **Runs bloqués = scan complet, pas `get_state`.** `runsBlocked` n'est qu'une FENÊTRE (les 24 RUN.md
   les plus récents ; `runsNonExamines` compte le reste) et, avant le 2026-10-11, il ne voyait AUCUN
   run (mauvaise racine) : les passes des 02 et 03/10 ont mis 42 runs rouges en corbeille sur la foi
   d'une liste vide — remis en place le 13/10. Sonde : un script `.mts` lancé par `npx tsx`, qui
   importe `scanRuns` (`file:///D:/AutoWinOS/src/main/dashboards/runs-scan.ts`) et `isBlocked`
   (`file:///D:/AutoWinOS/src/shared/run-blocked.ts`), scanne `.autowin-data/autowin-os/runs` et rend
   l'ensemble des `session` qui portent au moins un run bloqué (mesuré le 13/10 : 925 RUN.md bloqués
   sur 1 094, 117 conversations). Sonde en échec → `runs/` et `run-state/` NON collectés ce jour-là.
   | Racine `.autowin-data/` : `*.log` > 5 Mo, `tmp/`, captures `tmp-*.png`, `vitest-*.txt` | non modifié depuis > 7 jours et non référencé par un process vivant (`DevToolsActivePort` exclu) |
   | Sauvegardes ponctuelles dans `autowin-os/` : `*.bak`, `*.bak.N`, `*.avant-*`, `*.pre-*`, `g.tmp.jsonl` (y compris dans `activity/` et `prompt-observability/`) — JAMAIS `conversations.json.pre-remake` : c'est un filet pris UNE SEULE FOIS par `backupBeforeFirstMigratedWrite` (`src/main/store/conversations-disk.ts`), recréé dès qu'il manque à partir de données DÉJÀ migrées ; le déplacer ne libère rien et perd le vrai filet (constaté le 2026-10-14 : celui du 21/09, collecté le 13/10, remplacé aussitôt par une copie de 74 Mo) | non modifié depuis > 14 jours — copies d'avant-migration, l'original vivant est à côté |
   | Bancs d'essai terminés : `autowin-os/arena-bench*/`, `banc-*/`, `critere-reprises/`, `judge-session-*/` | aucun fichier du dossier modifié depuis > 14 jours |
   | Racine du DÉPÔT : `.tmp-*.log`, `.index*.log`, `.autowin-preuve/`, `.corbeille/` | ignorés par git (`git status --short --ignored` les marque `!!`) ET non modifiés depuis > 7 jours |
   | Dossier temporaire Windows (`%TEMP%`) : `vitest*.log`, `vitest*.json`, `vitest*.txt`, `gc-cand.json` | non modifiés depuis > 7 jours ; jamais le sous-dossier `%TEMP%/claude/` (sessions vivantes) |
   Un nom dont l'id ne se lit pas sans ambiguïté → NON collecté, rapporté en « à vérifier ».
2 bis. **Signaler sans déplacer — gestes git.** Ces restes ne se déplacent PAS : les bouger casse
   git. Ils vont au bilan dans « À purger », avec la commande exacte, et attendent l'accord :
   - **Copies de travail git orphelines** (`git worktree list`) : `bench/runs/*` (déjà **5,3 Go**),
     `autowin-os/worktrees/panel*`, `autowin-os/worktrees/<hash>/agent__run-*`.
     Candidate si : HEAD détachée, aucune modification (`git -C <copie> status --short` vide),
     aucun fichier modifié depuis > 7 jours, et absente des runs en cours et de `travauxNonPublies`.
     Proposer `git worktree remove <copie>`. Une copie avec des modifications → `/salvage`, pas `/gc`.
   - **Branches `autowin/recovery/*` et remises de côté (`git stash list`)** : les COMPTER et les
     dater dans le bilan, rien de plus. Leur tri relève de `/salvage`.
   - **Chemins périmés** : `git worktree prune --dry-run` ; s'il liste quelque chose, le rapporter.
3. **Balayer = déplacer, pas supprimer.** Déplacer chaque candidat vers
   `.autowin-data/gc-corbeille/AAAA-MM-JJ/<chemin d'origine>` (`move_file`, ou `run` d'un `mv`
   unitaire). Écrire à côté `MANIFEST.txt` : chemin d'origine, taille, motif. C'est ce manifeste
   qui rend la restauration possible.
4. **Proposer la purge.** Les corbeilles de plus de 14 jours sont LISTÉES avec leur taille, jamais
   vidées d'office : la suppression définitive est irréversible, elle attend un « purge » explicite
   de l'utilisateur (via `ask`, option recommandée en premier).
5. **Re-mesurer** et rendre le bilan.

## Format du bilan
```
# GC — AAAA-MM-JJ
.autowin-data : X Go → Y Go (corbeille du jour : Z Mo)
## Collecté        (catégorie · nombre · taille · motif)
## À purger        (corbeille · âge · taille — attend ton accord)
## À vérifier      (candidats sans preuve de mort suffisante)
```

## Garde-fous
- Aucune suppression définitive sans accord explicite ; aucune édition de `conversations.json`.
- Jamais de collecte sur un fichier modifié dans les dernières 24 h (conversation peut-être en cours).
- Pas d'`orchestrate`, pas de commit, pas de kill de processus.
- Une sonde qui échoue (fichier illisible, `get_state` muet) → la catégorie correspondante n'est
  PAS collectée ce jour-là, et c'est dit dans le bilan.
