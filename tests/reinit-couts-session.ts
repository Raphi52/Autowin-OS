import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { threadId } from 'node:worker_threads'
import { afterAll, beforeEach } from 'vitest'
import {
  imposerCheminMagasinCoutsDeSession,
  reinitialiserMagasinCoutsDeSession
} from '../src/main/providers/claude-session-cost'

/**
 * UN MAGASIN PAR THREAD. Les fichiers de test tournent en parallèle sur la même racine de données :
 * le `beforeEach` ci-dessous, joué dans CHAQUE fichier, effaçait le magasin d'un AUTRE fichier en
 * plein test (course reproduite le 30/09 : `claude.decumul-session.test.ts` rendait 4,3822 au lieu
 * de 0,1322). Dans un même thread, les fichiers passent l'un après l'autre : plus de course.
 */
imposerCheminMagasinCoutsDeSession(
  join(
    process.env.APPDATA ?? tmpdir(),
    'autowin-couts-session-par-thread',
    `${process.pid}-${threadId}.json`
  )
)
afterAll(() => {
  reinitialiserMagasinCoutsDeSession()
})

/**
 * Le coût d'un tour se déduit du CUMUL de session rendu par le CLI, donc d'un magasin PERSISTANT
 * (`providers/claude-session-cost.ts`). La racine de données des tests est stable d'un run à
 * l'autre (voir `RACINE_DONNEES_TESTS`) : sans remise à zéro, un test qui rejoue le même
 * `session_id` avec le même `total_cost_usd` verrait 0 au deuxième passage. Un test vert une fois
 * sur deux est pire qu'un test rouge.
 */
beforeEach(() => {
  reinitialiserMagasinCoutsDeSession()
})

/**
 * conv-844 (2026-09-24) : en production la reparation tourne jusqu'au vert, sans borne (choix
 * utilisateur). Les tests d'orchestrateur simulent souvent un juge qui refuse TOUJOURS : sans borne,
 * ils bouclaient jusqu'a saturer la memoire. Ils gardent donc l'ancien plafond ; le mode sans borne
 * est couvert a part par `src/main/gates/stopgate.jusqu-au-vert.test.ts`.
 */
process.env.AUTOWIN_REPARATION_BORNEE = '1'

/**
 * Variables qui changent la CONNEXION des CLI d'agents (Claude, Codex, Agy, Grok), retirées de
 * l'environnement hérité du terminal qui lance la suite. Plusieurs moteurs lancent leur CLI avec
 * `process.env` du poste : une `GEMINI_API_KEY` posée sur la machine du développeur arrivait donc
 * dans l'env vérifié et rendait rouge un test dont le code était juste (mesuré :
 * `GEMINI_API_KEY=x npx vitest run src/main/providers/cles-du-coffre.test.ts` → code 1). Même
 * principe que l'hermétisme de `vitest.config.ts` : la suite mesure le dépôt, pas le poste.
 * Un test qui a besoin d'une de ces variables la pose lui-même (`vi.stubEnv`).
 */
for (const nom of [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'AGY_ADC_AUTH',
  'XAI_API_KEY'
])
  delete process.env[nom]
