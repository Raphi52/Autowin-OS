import { defineConfig } from 'vitest/config'

/**
 * Config des PREUVES VIVANTES (`*.live.test.*`) — celles qui consomment un vrai provider.
 *
 * Elles sont exclues de `vitest.config.ts` : les laisser dans la suite par défaut ferait payer un appel
 * modèle à chaque `npm test` et rendrait la suite rouge hors ligne. Mais une preuve qu'on ne sait plus
 * relancer ne vaut rien, d'où cette config explicite. L'exclusion CLI (`--exclude`) ne surcharge PAS la
 * liste du fichier de config (vérifié : « No test files found »), donc une seconde config est la seule
 * forme qui marche vraiment.
 *
 * Lancer :  npx vitest run --config vitest.live.config.ts
 */
export default defineConfig({
  test: {
    include: ['src/**/*.live.test.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'Audit/**', '**/worktrees/**'],
    pool: 'threads',
    maxWorkers: 2,
    // Un appel modèle réel prend de 10 s à plusieurs minutes : l'horloge de la suite unitaire (20 s)
    // ferait échouer une preuve parfaitement valide.
    testTimeout: 300_000,
    hookTimeout: 60_000
  }
})
