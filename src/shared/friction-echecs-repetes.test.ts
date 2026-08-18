import { describe, expect, it } from 'vitest'
import { frictionEchecsRepetes, SEUIL_FRICTION } from './friction-echecs-repetes'
import type { OrchestrationOutcome } from './orchestration-outcome'

const bloque = (extra: Partial<OrchestrationOutcome> = {}): OrchestrationOutcome => ({
  status: 'failed',
  valid: false,
  gateBlocked: true,
  ...extra
})
// La livraison est definie par `isDeliveredOrchestrationOutcome` : `reused: false` en fait partie —
// un run REUTILISE n'a rien livre de neuf, donc ne remet aucun compteur a zero.
const livre = (): OrchestrationOutcome => ({
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false
})

/**
 * Défaut mesuré (conv-1302) : douze orchestrations sans livraison sur la même demande, >20 $, et
 * rien à l'écran ne disait qu'on était dans une série. L'utilisateur a relancé neuf fois.
 */
describe('frictionEchecsRepetes — la série devient visible avant la relance suivante', () => {
  it('ne dit RIEN sous le seuil : un ou deux échecs, c’est la vie', () => {
    expect(frictionEchecsRepetes([bloque()])).toBeUndefined()
    expect(frictionEchecsRepetes([bloque(), bloque()])).toBeUndefined()
  })

  it('au troisième échec d’affilée, rend le constat et le compte', () => {
    const friction = frictionEchecsRepetes([bloque(), bloque(), bloque()])
    expect(friction?.runs).toBe(3)
    expect(friction?.message).toContain('3 orchestrations')
    expect(friction?.message).toContain('a déjà échoué 3 fois')
  })

  it('une LIVRAISON remet le compteur à zéro : un progrès réel a eu lieu', () => {
    expect(frictionEchecsRepetes([bloque(), bloque(), livre(), bloque()])).toBeUndefined()
    expect(frictionEchecsRepetes([bloque(), bloque(), bloque(), livre()])).toBeUndefined()
  })

  it('ne compte que la série FINALE, pas tous les échecs du fil', () => {
    expect(frictionEchecsRepetes([bloque(), bloque(), livre(), bloque(), bloque(), bloque()])?.runs).toBe(3)
  })

  it('un run encore EN COURS n’est ni un échec ni une coupure de série', () => {
    const enCours: OrchestrationOutcome = { status: 'running' }
    expect(frictionEchecsRepetes([bloque(), bloque(), enCours, bloque()])?.runs).toBe(3)
  })

  it('un juge qui REFUSE compte, même sans gate bloqué', () => {
    const refuse = { status: 'failed', valid: false, gateBlocked: false }
    expect(frictionEchecsRepetes([refuse, refuse, refuse])?.runs).toBe(3)
  })

  it('cumule le coût de la série, jamais celui du fil entier', () => {
    const friction = frictionEchecsRepetes([
      bloque({ knownCostUsd: 9 }),
      livre(),
      bloque({ knownCostUsd: 1 }),
      bloque({ knownCostUsd: 2 }),
      bloque({ knownCostUsd: 3 })
    ])
    expect(friction?.cout).toContain('6')
    expect(friction?.cout).not.toContain('15')
  })

  it('AUCUN montant connu → pas de faux zéro, le volume prend le relais', () => {
    const friction = frictionEchecsRepetes([
      bloque({ totalTokens: 1_000_000, unpricedCalls: 2 }),
      bloque({ totalTokens: 1_000_000, unpricedCalls: 2 }),
      bloque({ totalTokens: 1_000_000, unpricedCalls: 2 })
    ])
    expect(friction?.cout).not.toMatch(/0[.,]00/u)
    expect(friction?.cout).toMatch(/token|non exposé|non chiffré/iu)
  })

  it('le seuil par défaut est 3 et reste réglable, jamais en dessous de 2', () => {
    expect(SEUIL_FRICTION).toBe(3)
    expect(frictionEchecsRepetes([bloque(), bloque()], 2)?.runs).toBe(2)
    expect(frictionEchecsRepetes([bloque()], 1)).toBeUndefined()
  })

  it('un fil vide ou sans échec ne produit rien', () => {
    expect(frictionEchecsRepetes([])).toBeUndefined()
    expect(frictionEchecsRepetes([livre(), livre()])).toBeUndefined()
  })
})

/**
 * CÂBLAGE — un module de friction jamais rendu ne freine rien. C'est le défaut « Potemkine » :
 * exposé, testé, mais aucun appelant réel. On vérifie donc la présence de l'appel ET du rendu.
 */
describe('câblage — la friction est réellement affichée dans le composer', () => {
  const chatView = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    return fs.readFileSync(
      path.join(__dirname, '..', 'renderer', 'src', 'components', 'ChatView.tsx'),
      'utf8'
    )
  }

  it('appelle frictionEchecsRepetes sur les issues du fil', () => {
    const source = chatView()
    expect(source).toContain('frictionEchecsRepetes(orchestrationOutcomesFromMessages(messages))')
  })

  it('rend le message dans le composer, repérable pour un test de vue', () => {
    const source = chatView()
    expect(source).toContain('data-testid="friction-echecs-repetes"')
    expect(source).toContain('{friction.message}')
  })
})
