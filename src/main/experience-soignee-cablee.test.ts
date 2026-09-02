import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'

/**
 * LE DRAPEAU D'EXPÉRIENCE DOIT ÊTRE RÉELLEMENT PASSÉ — sinon les gardes sont inertes.
 *
 * MESURÉ le 2026-08-16 : 8 sondes, exactitude 8/8, et pourtant **0 conforme** au juge d'expérience,
 * avec « bloc de clôture absent » sur chacune. Les trois gardes existaient, étaient testées, et ne
 * s'armaient jamais : `index.ts` ne passait pas `exigerExperienceSoignee`, qui vaut `false` par
 * défaut. Du code juste, entièrement inerte.
 *
 * Ce n'est pas la première fois sur cet arbre partagé : le paramètre du tour coupé, son passage à
 * `buildTurnMessages` et son champ de type avaient déjà disparu la veille, chacun repéré par le
 * typecheck. Ici RIEN ne le signalait — un argument optionnel non passé compile parfaitement.
 *
 * D'où ce test : il vérifie le CÂBLAGE, pas la logique. C'est le seul défaut de la famille
 * « exposé mais jamais appelé » qu'aucun test de comportement ne peut attraper.
 */
// La ZONE du process principal, pas un chemin : ce cablage a quitte `index.ts` pour
// `src/main/chat/`. Un demenagement de code n'est pas une regression (mesure du 2026-09-02).
const main = sourceProcessPrincipal()
const pilot = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')

describe('câblage de l’expérience soignée', () => {
  it('le pilote OFFRE le drapeau', () => {
    expect(pilot).toContain('exigerExperienceSoignee')
  })

  it('les gardes d’expérience le CONSULTENT vraiment', () => {
    // Trois gardes : conclusion absente, echec tu, annonce sans action.
    const occurrences = pilot.split('exigerExperienceSoignee &&').length - 1
    expect(occurrences).toBeGreaterThanOrEqual(3)
  })

  it('le CHAT le passe — sans quoi tout ce qui précède est inerte', () => {
    /*
      LE test qui manquait. Sans cet argument, les gardes ne s'arment jamais et l'utilisateur reçoit
      exactement ce qu'il a décrit : des réponses sans conclusion, marquées réussies.
    */
    const compact = main.replace(/\s+/g, ' ')
    const appel = compact.slice(compact.indexOf('turnPilot.chat('))
    expect(appel.slice(0, 1200)).toContain('routingUserMessageOverride')
    expect(appel.slice(0, 1200)).toMatch(/routingUserMessageOverride,[^)]*true/)
  })
})
