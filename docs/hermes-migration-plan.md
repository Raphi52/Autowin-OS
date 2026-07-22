# Plan de migration Hermes → natif (Autowin OS souverain)

> But : Autowin OS tourne à 100 % sans le binaire `hermes.exe` ni l'arborescence `~/AppData/Local/hermes` / `~/.hermes`, sans perte de fonctionnalité. Établi le 2026-07-22 à partir d'une cartographie read-only du code (55 fichiers référençant `hermes`).

## 0. État des lieux (ce qui est DÉJÀ souverain)

Aucune action requise — vérifié :

- **Providers** : Claude (`providers/claude.ts:75`, « adaptateur souverain, aucune dépendance Hermes ») et Codex (OAuth device-code + store `%APPDATA%\autowin-os\auth.json`) — Hermes n'est cité qu'en commentaire de référence.
- **Cœur harnais** : orchestrateur, rôles, gate/stopgate, ledger de confiance, coût, RUN.md — zéro appel Hermes.
- **Brain / RAG** : lu en direct depuis `\\ged2\rig\…\Amitel Brain` + `~/.graphify` (`harness/snapshot.ts:566-591`). Pas via Hermes. Aucun service/port réseau Hermes n'existe.
- **Traces** : la lecture du spool dégrade proprement à vide si Hermes est absent (pas de crash).

**Le seul shell-out réel vers `hermes.exe`** est isolé dans `src/main/hermes-controls.ts` (`runHermes()`). C'est le verrou.

---

## 1. Séquencement (dépendances entre chantiers)

```
Chantier 1 (registre natif skills/tools/hooks/plugins)  ← VERROU
   ├── débloque → 2 (migrer les SKILL.md sur disque)
   ├── débloque → 5 (renommer la vue)
   └── débloque → 6 (retirer enums/labels 'hermes')
Chantier 3 (spool de traces natif)  ← indépendant de 1
   └── débloque → 4 (injection-proof rebranché)
Chantier 7 (nettoyage commentaires providers)  ← indépendant, à tout moment
Chantier 8 (tests)  ← suit chaque chantier
```

Ordre recommandé : **1 → 2 → (3 → 4) → 5 → 6 → 7**, tests (8) à chaque étape.
Chantiers 3-4 peuvent démarrer en parallèle de 1-2 (équipes/sessions distinctes) car sans couplage.

---

## 2. Chantier 1 — Registre natif skills/tools/hooks/plugins (VERROU, effort L)

### Problème
`hermes-controls.ts` (`runHermes()` → `hermes.exe skills/tools/plugins/hooks list|enable|disable`) est l'UNIQUE source de vérité de « quoi est activé ». Consommé par :
- `loop-skills.ts:59` (pilote la boucle scout→frame→build→judge),
- `skill-registry.ts:39-54,137-174` (statut enabled des SKILL.md),
- `behaviour-files.ts:358-465` (chaîne d'instructions effectives),
- `index.ts:575-640` (IPC vers le renderer / vue `HermesControlsView`).

### Cible
Un registre **local à Autowin**, sans sous-processus. Deux briques :

1. **Inventaire** : scanner les SKILL.md / définitions d'outils depuis une racine Autowin (voir chantier 2), au lieu d'appeler `hermes … list`.
2. **État enabled/disabled** : un fichier de préférences Autowin, ex. `%APPDATA%\autowin-os\registry\enablement.v1.json` :
   ```json
   { "skills": { "frame": true, "build": true, "judge": false },
     "tools":  { "…": true },
     "plugins":{ "…": false },
     "hooks":  { "…": true } }
   ```
   Lu/écrit par un nouveau module `main/native-registry.ts` (API : `listRegistry(kind)`, `setEnablement(kind, id, on)`), qui remplace terme-à-terme la signature de `listHermesControls()` / `setHermesTool()` / `setHermesPlugin()`.

### Rétro-compat
- Au premier lancement, si `enablement.v1.json` absent ET `hermes.exe` présent : **importer une fois** l'état Hermes (migration douce), puis ne plus jamais rappeler Hermes. Sinon : tout activé par défaut (ou politique explicite).
- Garder les mêmes noms d'IPC (`hermes:controls:list`, …) au début pour ne pas casser le renderer → renommage cosmétique reporté au chantier 5.

### Vérification
- `loop-skills` tourne avec `hermes.exe` **renommé/absent** → la boucle scout/frame/build/judge démarre quand même (test rouge→vert : simuler l'absence du binaire).
- Toggle d'une skill dans la vue → persiste dans `enablement.v1.json` → relance → état conservé.
- 589+ tests verts (adapter `hermes-controls.test.ts`, `skill-registry.test.ts`, `behaviour-files.test.ts`).

### Risque : ÉLEVÉ — c'est le point qui casse la boucle si mal migré. Faire derrière un flag le temps de valider en parallèle du chemin Hermes.

---

## 3. Chantier 2 — Migrer les SKILL.md vers une racine Autowin (effort M)

- Aujourd'hui les fichiers vivent sous `~/AppData/Local/hermes/skills` et `.../hermes-agent/skills` (`skill-registry.ts:40-41`).
- Cible : une racine Autowin, ex. `%APPDATA%\autowin-os\skills\` (+ éventuellement une racine « builtin » packagée avec l'app dans `resources/skills`).
- `skill-registry.ts` scanne ces racines au lieu des dossiers Hermes ; `behaviour-files.ts` lit `SOUL.md`/`.hermes.md`/`AGENTS.md` depuis la racine Autowin.
- Rétro-compat : au 1er lancement, copier (pas déplacer) les SKILL.md Hermes existants vers la racine Autowin si la cible est vide.
- Dépend de 1 pour le statut enabled.
- Risque : moyen (déplacement de fichiers + chemins).

---

## 4. Chantier 3 — Spool de traces natif (effort M, indépendant)

- Aujourd'hui `activity/hermes-prompt-trace.ts` LIT `~/.hermes/sessions/events.jsonl` (écrit par un hook côté Hermes). Autowin ne produit pas ce spool lui-même → sans Hermes, l'Observatory « preuve d'injection » est vide.
- Cible : Autowin **écrit son propre spool** (au moment où il remet le `PromptEnvelope` à l'adaptateur, cf. providers), ex. `%APPDATA%\autowin-os\prompt-observability\*.jsonl` — format identique (`exact-redacted`, borné, ACL, rotation) pour réutiliser la lecture/redaction existante.
- `hermes-prompt-trace.ts` → lit la racine Autowin ; `index.ts:1243-1336` inchangé sur la forme.
- Risque : faible-moyen (déjà tolérant à l'absence ; le vrai travail = brancher l'écriture au bon point du pipeline provider).

---

## 5. Chantiers de finition

| # | Chantier | Détail | Effort |
|---|----------|--------|--------|
| 4 | `hermes-injection-proof.ts` rebranché | Logique pure, change seulement la SOURCE des traces (spool natif du #3). `index.ts:677-701`. | S |
| 5 | Renommer `HermesControlsView` → « Skills · Tools » | Vue + `.css` + `App.tsx` + IPC `hermes:*` → `registry:*` (une fois le backend générique). | S |
| 6 | Retirer enums/labels `'hermes'` obsolètes | `commands.ts:105` (`category`), `HermesControlsView.tsx` (`HookModel`), `harness/snapshot.ts:105,521` (`behaviourByEngine.hermes`). | S |
| 7 | Nettoyer commentaires « contrat live Hermes » | `providers/codex.ts:354`, `codex-auth.ts:8,12,84,104` — reformuler en doc externe ou supprimer. Aucun effet runtime. | S |
| 8 | Tests | Adapter/purger ~18 `*hermes*.test.ts` **au fil** des chantiers 1-4. | M (étalé) |

---

## 6. Définition de « fini »

- `hermes.exe` renommé + `~/.hermes` et `~/AppData/Local/hermes` supprimés → Autowin démarre, Memory/Chat/Observatory/Models fonctionnent, la boucle orchestration tourne, l'Observatory affiche les traces (écrites par Autowin lui-même).
- `grep -ri hermes src/` ne renvoie plus que de la doc historique assumée (ou zéro).
- Suite de tests verte, typecheck node+web vert.

## 7. Verrou unique à retenir

Tant que le **chantier 1** n'est pas fait, 2/4/5/6 ne font que déplacer la dépendance. C'est le seul qui supprime réellement le sous-processus externe.
