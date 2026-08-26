import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CE TEST VERROUILLE UN CÂBLAGE, ET RIEN D'AUTRE. Il faut le dire, parce que j'ai essayé mieux.
 *
 * LA RÉGRESSION. Pour fermer un faux vert d'affichage, j'ai resserré
 * `isDeliveredOrchestrationOutcome` sans regarder ses cinq appelants. `agent-pilot.ts` s'en servait
 * pour la comptabilité d'ÉCHEC : un run VERT dont la publication est en `hold` — le cas central de
 * ce besoin — est devenu un échec, ce qui arme la relance « corriger et poursuivre ». L'agent
 * repartait réparer ce qui n'avait pas cassé.
 *
 * CE QUE J'AI ESSAYÉ D'ABORD, et pourquoi je ne l'ai pas gardé. Un test appelant
 * `orchestrationEnEchec` en direct : sabotage du câblage → resté VERT, il ne prouvait rien. Puis un
 * test comportemental sur `AgentPilot`, comptant les tours rendus au modèle : sabotage → resté VERT
 * lui aussi, la relance étant gardée par d'autres conditions (`exigerExperienceSoignee`,
 * `relanceDeFormeUtilisee`, forme du « mur ») que le harnais ne reproduit pas. Deux tests qui
 * passaient sans discriminer, donc deux tests qui mentaient.
 *
 * CE QUE CELUI-CI PROUVE : que la comptabilité d'échec lit bien `orchestrationEnEchec` et non le
 * prédicat d'affichage. Remettre `!deliveryClosed` le fait rougir.
 * CE QU'IL NE PROUVE PAS : que la relance ne se déclenche pas en conditions réelles. Cette moitié
 * reste non couverte, et je préfère l'écrire ici que la laisser croire couverte.
 */

const source = readFileSync(join(process.cwd(), 'src/main/agent-pilot.ts'), 'utf8')

describe('la comptabilité d’échec lit le prédicat d’ÉCHEC, pas celui d’affichage', () => {
  it('arme anyActionFailed depuis `orchestrationEnEchec`', () => {
    expect(source).toMatch(/if \(orchestrationEnEchec\([^)]*\)\) \{\s*\n\s*anyActionFailed = true/u)
  })

  it('n’arme plus rien depuis `deliveryClosed`, qui reste réservé à l’affichage', () => {
    expect(source).not.toMatch(/if \(!deliveryClosed\) \{\s*\n\s*anyActionFailed = true/u)
    // `deliveryClosed` garde son rôle : choisir la phrase de clôture montrée à l'utilisateur.
    expect(source).toContain('const closureNotice = deliveryClosed')
  })
})
