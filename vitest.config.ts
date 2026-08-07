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
    /**
     * HERMETICITE vis-a-vis de l'app EN COURS D'EXECUTION — meme classe de panne que l'exclusion
     * d'`Audit/` ci-dessus : la suite doit mesurer le DEPOT, jamais l'environnement qui la lance.
     *
     * `AUTOWIN_RUN_JOURNAL_ROOT` est une variable de RUNTIME : l'app la pose pour activer la survie
     * niveau 2 (CLI spawne DETACHE, sortie vers un journal sur disque). Lancer `npm run test:unit`
     * depuis un terminal issu de l'app la fait FUIR dans les workers vitest. Consequence mesuree le
     * 2026-08-07 : `claude.ts` basculait sur le chemin journal (`relay`, `stdio: 'ignore'`), donc le
     * stdout simule par les tests n'etait JAMAIS lu — 6 tests de l'adaptateur Claude rouges
     * (artefacts absents, `text` vide, erreur 529 avalee, argv reduit aux 3 args du relais), verts en
     * shell propre. Un faux rouge qui accusait le code au lieu de l'environnement.
     *
     * Valeur VIDE (donc falsy) : le code retombe sur le pipe, exactement le comportement que les
     * tests decrivent. Rien n'est modifie cote production ni cote assertions.
     */
    env: {
      AUTOWIN_RUN_JOURNAL_ROOT: ''
    },
    pool: 'threads',
    maxWorkers: 8,
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
})
