import { defineConfig } from 'vitest/config'

/**
 * Réglages de stabilité de la suite, sans modifier sa résolution ni son isolation.
 *
 * Pourquoi : la suite compte ~240 fichiers joués en parallèle (~150 s de temps de test cumulé). Sous
 * cette charge, un worker peut voir son event loop affamé bien au-delà du défaut vitest de 5 s — pour
 * du travail qui prend 50 ms à vide. Symptôme observé : un test rouge DIFFÉRENT à chaque passe, vert
 * en isolation. Ce n'était pas un code fragile, c'était une horloge trop serrée.
 *
 * 20 s laisse passer la contention sans jamais masquer un vrai blocage (un test réellement pendu
 * échoue toujours, 15 s plus tard). Les rares fichiers à I/O lourde (vrais dépôts git, copie d'un
 * exécutable de ~100 Mo) relèvent encore ce budget chez eux via `vi.setConfig`.
 *
 * Le pool `forks` de Vitest 3.2.7 laisse ici un appel RPC `onTaskUpdate` sans réponse jusqu'à son
 * timeout interne de 60 s, même lorsque toutes les assertions passent. Le pool `threads` conserve
 * l'isolation par fichier mais remplace le canal `child_process` fautif par un `MessagePort`.
 * Huit workers bornent en plus la contention des tests qui créent de vrais dépôts et worktrees Git.
 */
export default defineConfig({
  test: {
    /**
     * Perimetre STRICT du depot. Sans exclusion, vitest ramassait les COPIES de code que les agents
     * deposent sous `Audit/` (instances headless, worktrees d'agents) : mesure du 2026-07-29 —
     * 323 fichiers de test collectes au lieu de ~160, dont 164 qui ne se chargeaient meme pas
     * (dependances absentes dans ces copies). Consequence : la suite paraissait massivement rouge des
     * qu'un agent tournait, et le vrai signal devenait illisible.
     */
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      'Audit/**',
      '**/worktrees/**',
      '**/.claude/**',
      /**
       * Tests `*.live.test.*` : ils consomment un VRAI provider (coût réel, réseau, authentification).
       * Ils répondent à une question qu'aucun mock ne tranche — « le modèle produit-il vraiment ce que
       * le renderer sait rendre ? » — mais les laisser dans la suite par défaut ferait payer un appel
       * modèle à chaque `npm test`, et rendrait la suite rouge hors ligne. Lancement EXPLICITE :
       * `npx vitest run --config vitest.live.config.ts` — `--exclude` en CLI ne surcharge PAS cette
       * liste (vérifié : « No test files found »), d'où une config dédiée plutôt qu'un drapeau.
       */
      '**/*.live.test.*'
    ],
    pool: 'threads',
    maxWorkers: 8,
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
})
