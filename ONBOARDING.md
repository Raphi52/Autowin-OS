# Onboarding développeur — Autowin OS

Guide pour un collègue qui veut **contribuer au code** (pas seulement utiliser l'app). Pour juste
installer/utiliser l'app packagée, voir la section « Utilisateur » tout en bas.

Autowin OS = cockpit **Electron + React + TypeScript** d'orchestration d'agents.

---

## 1. Prérequis (une fois par machine)

1. **Node.js** (LTS récent) — vérifier : `node --version`.
2. **Git**.
3. **uv** (gestionnaire de venv Python, pour le brain_server) — https://docs.astral.sh/uv/.
4. Un **accès en écriture** au dépôt GitHub `https://github.com/Raphi52/Autowin-OS`, seul distant
   (`origin`) depuis le 2026-10-16. L'accès passe par ton compte GitHub : Git Credential Manager le
   demande au premier envoi.

## 2. Récupérer et installer

```bash
git clone https://github.com/Raphi52/Autowin-OS.git AutoWinOS
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
`AUTOWIN_BRAIN_TOOLING` (défaut : partage réseau de l'équipe, `brain.racinePartagee` du profil d'entreprise ; pointer un dossier local pour un venv par machine).

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

- **Token Brain** : définir la variable d'environnement `AUTOWIN_BRAIN_TOKEN` (active le RAG ; l'ancien nom
  fourni par le profil d'entreprise reste lu).
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

**Sur ce dépôt, on pousse DIRECTEMENT sur `main`, sans Pull Request** (règle en vigueur, 2026-10-22).
Un agent le fait avec l'exception tracée `ALLOW_MAIN_PUSH=1 git push` — ou `npm run publier:main`, qui
pose la variable puis pousse `origin main`. Le refus du hook ne sert qu'à rendre ce push assumé et tracé.
(`npm run bootstrap:deps` active le hook automatiquement.)

> Pourquoi le hook ne vise que les agents (2026-07-29) : il bloquait d'abord **tout** push sur `main`,
> humain compris. Résultat, celui qui consolidait ses propres branches enjambait sa garde à chaque fois —
> et une garde qu'on contourne systématiquement ne protège plus rien.

Pousser sur `main` ne veut pas dire travailler à plusieurs dans le même checkout : le working tree se
retrouve avec des changements entremêlés impossibles à committer proprement — vécu sur ce repo
(fichiers supprimés sous une autre session, HEAD incohérent). Règle :

1. Partir de `main` à jour : `git checkout main && git pull`.
2. Committer par petits pas vérifiés (typecheck + tests verts avant chaque commit), en ne committant
   que **ses** fichiers : `git commit -- <chemins>`.
3. Pousser directement : `git push origin main` (humain) ou `ALLOW_MAIN_PUSH=1 git push` (agent).
   Refus « non fast-forward » : `git pull --rebase origin main`, puis repousser.
4. Un commit = un sujet. Ne pas mélanger deux sujets dans le même commit.

**Deux personnes ou deux agents en parallèle ?** N'utilisez jamais le même checkout — donnez à chacun
son propre working tree, sinon vos fichiers se marchent dessus (vécu ici). Il se publie ensuite sur
`main` de la même façon :

```bash
git worktree add ../autowin-<sujet> -b <sujet>
# ...commits vérifiés, puis :
git pull --rebase origin main && git push origin HEAD:main
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
