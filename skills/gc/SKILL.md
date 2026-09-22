---
name: gc
description: >-
  GARBAGE COLLECTOR d'Autowin OS, invoqué chaque jour par le Task Manager (et à la main sur « /gc »,
  « fais le ménage des données », « .autowin-data est trop gros »). Mesure ce qu'occupe
  `.autowin-data`, repère les DÉCHETS prouvés — satellites de conversations supprimées, sorties de
  runs anciennes, fichiers temporaires à la racine — et les DÉPLACE en corbeille datée
  (réversible). Ne supprime jamais définitivement sans demande explicite de l'utilisateur.
  Distinct de `residus` (code mort dans `src/`) et de `salvage` (travail non publié).
---

# gc — le ramasse-miettes des données d'Autowin OS

## Le livrable
Un BILAN court : taille avant → après, ce qui est parti en corbeille (par catégorie, avec le motif
de chaque catégorie), et ce qui est PROPOSÉ à la purge définitive. Rien de collectable → écrire
« rien à collecter — <taille totale> » et s'arrêter : une passe vide doit coûter peu.

## Racines (ce qui est VIVANT — ne jamais y toucher)
- `conversations.json` : la liste des ids de conversations vivantes = la racine de marquage.
- `get_state` : runs en cours, `travauxNonPublies`, copies de travail (`run_status`).
- Hors périmètre ABSOLU : `claude-accounts/` (identités, secrets), `Cache/`, `Code Cache/`,
  `GPUCache/`, `Local Storage/`, `Session Storage/`, `Network/`, fichiers `*-wal` (propriété
  d'Electron, il les gère seul), `whisper/`, `piper/` (modèles), `worktrees/` (→ `/salvage`),
  tout fichier de configuration `*.json` à la racine autre que les satellites listés ci-dessous.

## Procédure
0. **Relire la veille.** `conversation_read` sur CETTE conversation : ne re-rapporte pas une
   proposition de purge déjà faite et restée sans réponse, rappelle-la en une ligne.
1. **Mesurer** (lecture seule) : `du -sh` par dossier de `.autowin-data/autowin-os` et de
   `.autowin-data`. Noter le total.
2. **Marquer** — chaque candidat doit porter une PREUVE de mort, sinon il reste :
   | Catégorie | Preuve de mort |
   |---|---|
   | Satellites orphelins (`activity/`, `causal-trace/`, `chat-artifacts/`, `turn-journals/`, `prompt-observability/`) | l'id de conversation dans le nom n'existe PAS dans `conversations.json` |
   | Sorties de runs (`runs/`, `run-state/`) | run terminé depuis > 30 jours ET absent des runs en cours / bloqués / non publiés de `get_state` |
   | Rétention `prompt-observability/` et `run-stdout/` (fichiers directs, pas le sous-dossier `systems/`) | fichier NON MODIFIÉ depuis > 14 jours (mtime) ET, pour `run-stdout/`, son run absent des runs en cours / bloqués de `get_state` — l'âge suffit : ces données sont des journaux, pas un état |
   | Racine `.autowin-data/` : `*.log` > 5 Mo, `tmp/`, captures `tmp-*.png`, `vitest-*.txt` | non modifié depuis > 7 jours et non référencé par un process vivant (`DevToolsActivePort` exclu) |
   | Sauvegardes ponctuelles dans `autowin-os/` : `*.bak`, `*.bak.N`, `*.avant-*`, `*.pre-*`, `g.tmp.jsonl` (y compris dans `activity/` et `prompt-observability/`) | non modifié depuis > 14 jours — copies d'avant-migration, l'original vivant est à côté |
   | Bancs d'essai terminés : `autowin-os/arena-bench*/`, `banc-*/`, `critere-reprises/`, `judge-session-*/` | aucun fichier du dossier modifié depuis > 14 jours |
   | Racine du DÉPÔT : `.tmp-*.log`, `.index*.log`, `.autowin-preuve/`, `.corbeille/` | ignorés par git (`git status --short --ignored` les marque `!!`) ET non modifiés depuis > 7 jours |
   | Dossier temporaire Windows (`%TEMP%`) : `vitest*.log`, `vitest*.json`, `vitest*.txt`, `gc-cand.json` | non modifiés depuis > 7 jours ; jamais le sous-dossier `%TEMP%/claude/` (sessions vivantes) |
   Un nom dont l'id ne se lit pas sans ambiguïté → NON collecté, rapporté en « à vérifier ».
2 bis. **Signaler sans déplacer — gestes git.** Ces restes ne se déplacent PAS : les bouger casse
   git. Ils vont au bilan dans « À purger », avec la commande exacte, et attendent l'accord :
   - **Copies de travail git orphelines** (`git worktree list`) : `bench/runs/*` (déjà **5,3 Go**
     le 2026-09-21), `autowin-os/worktrees/panel*`, `autowin-os/worktrees/<hash>/agent__run-*`.
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
