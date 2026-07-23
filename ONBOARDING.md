# Onboarding développeur — Autowin OS

Guide pour un collègue qui veut **contribuer au code** (pas seulement utiliser l'app). Pour juste
installer/utiliser l'app packagée, voir la section « Utilisateur » tout en bas.

Autowin OS = cockpit **Electron + React + TypeScript** d'orchestration d'agents.

---

## 1. Prérequis (une fois par machine)

1. **Node.js** (LTS récent) — vérifier : `node --version`.
2. **Git**.
3. **uv** (gestionnaire de venv Python, pour le brain_server) — https://docs.astral.sh/uv/.
4. Un **accès en écriture** au repo GitHub `Raphi52/Autowin-OS` (demander à être ajouté comme
   collaborateur, ou cloner ta fork).

## 2. Récupérer et installer

```bash
git clone https://github.com/Raphi52/Autowin-OS.git
cd "Autowin-OS"
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

## 6. Config manuelle (secrets / login interactif — non automatisables)

- **Token Brain** : définir la variable d'environnement `AMITEL_BRAIN_TOKEN` (active le RAG).
- **OAuth Codex** : `npm run codex:login`.
- **Kimi Code** (optionnel, en standby par défaut) : installer puis `kimi login` si utilisé.

## 7. Workflow de contribution (IMPORTANT — collaboration multi-devs)

Ne travaillez **jamais tous sur la même branche** : le working tree se retrouve avec des changements
entremêlés impossibles à committer proprement. Règle :

1. Partir de `main` à jour : `git checkout main && git pull`.
2. Créer **sa** branche : `git checkout -b feat/<sujet>` (ou `fix/<sujet>`).
3. Committer par petits pas vérifiés (typecheck + tests verts avant chaque commit).
4. Pousser : `git push -u origin feat/<sujet>`.
5. Ouvrir une **Pull Request** vers `main` ; faire relire, puis merger.
6. Une branche = un sujet. Ne pas mélanger deux features dans le même working tree.

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
