import { beforeEach } from 'vitest'
import { reinitialiserMagasinCoutsDeSession } from '../src/main/providers/claude-session-cost'

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
