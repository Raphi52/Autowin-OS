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
