# Onboarding développeur — Autowin OS

Guide pour un collègue qui veut **contribuer au code** (pas seulement utiliser l'app). Pour juste
installer/utiliser l'app packagée, voir la section « Utilisateur » tout en bas.

Autowin OS = cockpit **Electron + React + TypeScript** d'orchestration d'agents.

---

## 1. Prérequis (une fois par machine)

1. **Node.js** (LTS récent) — vérifier : `node --version`.
2. **Git**.
3. **uv** (gestionnaire de venv Python, pour le brain_server) — https://docs.astral.sh/uv/.
4. Un **accès en écriture** au repo Azure DevOps `AmitelGTC/AutoWinOS` (demander à être ajouté à
   l'équipe). L'accès passe par `az login` — voir la procédure Azure DevOps interne si ton poste
   n'est pas encore configuré.

## 2. Récupérer et installer

```bash
git clone https://dev.azure.com/AmitelGTC/AutoWinOS/_git/AutoWinOS
cd "AutoWinOS"
npm install
```

## 3. Dépendances externes (CLI providers + brain_server)

L'app pilote des CLI (codex/claude) et interroge un service Python (brain_server, RAG). Un script
les met en place — idempotent, ne réinstalle pas ce qui est là :

```bash
npm run bootstrap:deps
```

Il installe les CLI `@openai/codex` et `@anthropic-ai/claude-code` si absentes, crée le venv du
brain_server, et **guide** ce qui ne s'automatise pas (voir §6). Chemin du brain configurable via
`AUTOWIN_BRAIN_TOOLING` (défaut : partage GED Amitel ; pointer un dossier local pour un venv par machine).

## 4. Lancer en développement

```bash
npm run dev
```

Démarre le renderer (Vite, :5173) + Electron avec rechargement à chaud. Le port CDP `:9223` est
ouvert en dev (inspection/pilotage). Au 1er lancement, un **wizard** apparaît **seulement** s'il manque
une dépendance externe ; tout vert → aucune fenêtre.

## 5. Vérifier avant de pousser

```bash
npm run typecheck      # node + web
npm test               # vitest (suite complète)
npm run lint
```

> **Toujours passer par `npm run typecheck`, jamais par un `tsc -p tsconfig.node.json` à la main.**
> Les deux projets sont `composite` : un `tsc -p` nu rend des `TS6307` (« File … is not listed
> within the file list of project ») sur des fichiers de `src/shared/` parfaitement sains. Le script
> passe `--composite false`, ce qui est exactement ce qui les fait disparaître. Mesuré le 2026-08-31 :
> `tsc --noEmit -p tsconfig.node.json` rend **51** TS6307, le même avec `--composite false` en rend
> **0**. Deux d'entre eux (`billing-model.ts`, `portee-de-phase.ts`) ont suffi à faire recommander une
> correction d'`include` sur un `tsconfig.node.json` qui n'avait aucun défaut.

## 5 bis. Où l'app écrit ses données (piège de chemin)

Le `userData` d'Electron est **remplacé** par un stockage **portable** : tout l'état applicatif vit
dans **`.autowin-data/`, à la racine du dépôt** — pas dans `%APPDATA%\Roaming`. La constante est
`PORTABLE_APP_DATA_DIR` (`src/main/app-data.ts`), appliquée via `portableAppDataBase()` depuis
`src/main/index.ts`. Motif : supprimer le dossier du projet laissait 1,8 Go derrière lui.

Conséquence pratique : chercher un modèle, un cache ou un JSON de session sous `AppData/Roaming`
donne un **faux négatif**. Mesuré le 2026-08-31 sur le moteur whisper — déclaré « pas installé »
alors qu'il occupait déjà `.autowin-data/whisper`.

## 6. Config manuelle (secrets / login interactif — non automatisables)

- **Token Brain** : définir la variable d'environnement `AMITEL_BRAIN_TOKEN` (active le RAG).
- **OAuth Codex** : `npm run codex:login`.
- **Kimi Code** (optionnel, en standby par défaut) : installer puis `kimi login` si utilisé.

## 7. Workflow de contribution (IMPORTANT — collaboration multi-devs)

**Activation obligatoire, une fois par clone** (garde-fou déterministe, pas un conseil) :

```bash
git config core.hooksPath .githooks
```

Le hook `pre-push` **refuse** alors le push direct sur `main` **quand il vient d'un agent** — c'est-à-dire
quand la variable `AUTOWIN_OS_WORKSPACE` est présente (l'app l'injecte dans chaque CLI qu'elle lance) ou
quand le push part d'un worktree d'agent (`agent__…`, `integration__…`). Un **humain** dans son checkout
passe : la règle vise l'automate, pas vous.

Exception explicite et tracée, dans les deux cas : `ALLOW_MAIN_PUSH=1 git push`. (`npm run bootstrap:deps`
active le hook automatiquement.)

> Pourquoi cette distinction (2026-07-29) : le hook bloquait d'abord **tout** push sur `main`, humain
> compris. Résultat, celui qui consolidait ses propres branches enjambait sa garde à chaque fois — et une
> garde qu'on contourne systématiquement ne protège plus rien. La revue par Pull Request reste la règle
> pour le travail à plusieurs ; le hook, lui, n'empêche plus que ce qu'aucun humain ne relit.

Ne travaillez **jamais tous sur la même branche** : le working tree se retrouve avec des changements
entremêlés impossibles à committer proprement — vécu sur ce repo (fichiers supprimés sous une autre
session, HEAD incohérent). Règle :

1. Partir de `main` à jour : `git checkout main && git pull`.
2. Créer **sa** branche : `git checkout -b feat/<sujet>` (ou `fix/<sujet>`).
3. Committer par petits pas vérifiés (typecheck + tests verts avant chaque commit).
4. Pousser : `git push -u origin feat/<sujet>`.
5. Ouvrir une **Pull Request** vers `main` (le gabarit `.github/pull_request_template.md` se
   pré-remplit : ce que ça change, la **preuve de vérification**, le périmètre) ; faire relire, puis merger.
6. Une branche = un sujet. Ne pas mélanger deux features dans le même working tree.

**Deux personnes ou deux agents en parallèle ?** N'utilisez jamais le même checkout — donnez à chacun
son propre working tree, sinon vos fichiers se marchent dessus (vécu ici) :

```bash
git worktree add ../autowin-<sujet> -b feat/<sujet>
```

## 8. Repères de structure

- `src/main/` — process principal (accès système, providers, orchestrateur, stores, gates).
- `src/preload/` — pont IPC borné.
- `src/renderer/` — UI React (vues Chat, Agent Studio, Knowledge, Observatory, Worktrees, Settings).
- `src/shared/` — types/utilitaires partagés main↔renderer.
- `scripts/` — outils dev (bootstrap, build desktop, pilotage CDP, captures…).
- `resources/` — assets bundlés.

## 9. Build packagé (pour distribuer aux utilisateurs)

```bash
npm run build:desktop   # dist\win-unpacked\autowin-os.exe + raccourci Bureau
npm run build:win       # installeur NSIS (.exe) à distribuer
```

---

## Annexe — Collègue « utilisateur » (ne code pas)

Pas besoin de git : récupérer l'**installeur NSIS** produit par `npm run build:win`, l'exécuter, puis
`npm run bootstrap:deps` (ou suivre le wizard au 1er lancement) pour les dépendances externes.
