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
    // L'ancienne phrase affirmait « relancer a l'identique a deja echoue N fois » : refutee, car
    // rien ne rattache une issue a une demande. Le message ne porte plus que le constat verifiable.
    expect(friction?.message).not.toContain('identique')
  })

  it('une LIVRAISON remet le compteur à zéro : un progrès réel a eu lieu', () => {
    expect(frictionEchecsRepetes([bloque(), bloque(), livre(), bloque()])).toBeUndefined()
    expect(frictionEchecsRepetes([bloque(), bloque(), bloque(), livre()])).toBeUndefined()
  })

  it('ne compte que la série FINALE, pas tous les échecs du fil', () => {
    expect(
      frictionEchecsRepetes([bloque(), bloque(), livre(), bloque(), bloque(), bloque()])?.runs
    ).toBe(3)
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

/**
 * TROUS TROUVÉS PAR DEUX JUGES ADVERSARIAUX (2026-08-18), tous démontrés par exécution.
 *
 * D4 — `cumul` ignorait le repli `costUsd` des issues d'ancienne lignée, que la pastille par run
 *      utilise pourtant : le bandeau annonçait « 2,00 $ » sous trois pastilles totalisant 10,40 $.
 *      Le volet « forfait » du même reproche est HORS D'ATTEINTE et documenté dans le module :
 *      aucune lignée ne pose `provider` sur l'issue, et la pastille par run a la même limite.
 * D5 — le message affirmait « relancer à l'identique a déjà échoué N fois » sans qu'aucune donnée
 *      ne rattache une issue à une demande. Trois échecs sur trois demandes DIFFÉRENTES le
 *      déclenchaient : un faux signal, dans un module dont l'objet est d'en supprimer.
 * D6 — un montant négatif ou `NaN` passait le garde ; un `gateBlocked` truthy non booléen et un
 *      statut inconnu (`timeout`, espace final) ne comptaient pas.
 */
describe('frictionEchecsRepetes — les trous réfutés par les juges', () => {
  it('D4 — cumule aussi le `costUsd` des issues d’ancienne lignée', () => {
    const friction = frictionEchecsRepetes([
      { status: 'failed', costUsd: 8.4 },
      { status: 'failed', knownCostUsd: 1 },
      { status: 'failed', knownCostUsd: 1 }
    ])
    expect(friction?.cout).toMatch(/10/u)
    expect(friction?.cout).not.toMatch(/^2/u)
  })

  it('D5 — le message n’affirme QUE ce que les données soutiennent', () => {
    const message = frictionEchecsRepetes([
      { status: 'failed' },
      { status: 'failed' },
      { status: 'failed' }
    ])?.message
    expect(message).not.toContain('à l’identique')
    expect(message).toContain('3 orchestrations')
  })

  it('D6 — un montant absurde ne devient jamais un coût affiché', () => {
    const friction = frictionEchecsRepetes([
      { status: 'failed', knownCostUsd: Number.NaN },
      { status: 'failed', knownCostUsd: -5 },
      { status: 'failed', knownCostUsd: 2 }
    ])
    expect(friction?.cout).not.toMatch(/-/u)
  })

  it('D6 — un `gateBlocked` truthy non booléen et un statut inconnu comptent', () => {
    expect(
      frictionEchecsRepetes([
        { gateBlocked: 1 as unknown as boolean },
        { status: 'timeout' },
        { status: 'failed ' }
      ])?.runs
    ).toBe(3)
  })

  it('D7 — la phrase reste grammaticale quand le coût n’est pas un montant', () => {
    const message = frictionEchecsRepetes([
      { status: 'failed', totalTokens: 1_000_000 },
      { status: 'failed', totalTokens: 1_000_000 },
      { status: 'failed', totalTokens: 1_000_000 }
    ])?.message
    expect(message).not.toMatch(/exposé cumulés|tokens cumulés/u)
    expect(message).toMatch(/série\s*:/u)
  })

  it('CONTRE-EXEMPLE — un seuil non atteint reste muet malgré tous ces cas', () => {
    expect(
      frictionEchecsRepetes([{ status: 'timeout' }, { gateBlocked: 1 as unknown as boolean }])
    ).toBeUndefined()
  })
})

/**
 * SECOND PANEL ADVERSARIAL (2026-08-18) — les réparations elles-mêmes ont été réfutées.
 *
 * D-A — BLOQUANT, mesuré sur 109 enregistrements du store live : le repli `knownCostUsd || costUsd`
 *       était faux. La pastille par run ne se replie sur `costUsd` que si `knownCostUsd` est ABSENT
 *       (`hasOwnProperty`) ; présent à `null`, elle dit « coût non exposé ». Le bandeau annonçait
 *       « 25,20 $ connus » là où la pastille disait « non exposé » — la divergence exacte que ce
 *       module promet d'éviter.
 * D-C — `estTerminale` était devenue une liste blanche : `completed`, `merged`, `done` (245
 *       occurrences dans le dépôt) comptaient comme des échecs, et la pastille sœur traite au
 *       contraire tout statut inconnu comme un succès.
 * D-D — mesuré sur 15 + 56 enregistrements réels : la lignée directe et les reprises n'émettent
 *       aucun `status`, donc une LIVRAISON réelle ne remettait pas le compteur à zéro.
 */
describe('frictionEchecsRepetes — second panel', () => {
  it('D-A — `knownCostUsd: null` veut dire NON EXPOSÉ, jamais le repli `costUsd`', () => {
    const issue = { status: 'failed', knownCostUsd: null, costUsd: 8.4, unpricedCalls: 3 }
    const friction = frictionEchecsRepetes([issue, issue, issue])
    expect(friction?.cout).not.toMatch(/25|8[.,]4/u)
    expect(friction?.cout).toMatch(/non exposé|non chiffré/iu)
  })

  it('D-A — `knownCostUsd: 0` est un coût CONNU et nul, pas une absence', () => {
    const issue = { status: 'failed', knownCostUsd: 0, costUsd: 4.2 }
    expect(frictionEchecsRepetes([issue, issue, issue])?.cout).not.toMatch(/12|4[.,]2/u)
  })

  it('D-A — `costUsd` seul (issue d’avant la couverture) est bien cumulé', () => {
    const issue = { status: 'failed', costUsd: 3 }
    expect(frictionEchecsRepetes([issue, issue, issue])?.cout).toMatch(/9/u)
  })

  it('D-C — un statut de SUCCÈS hors liste ne compte pas comme un échec', () => {
    for (const status of ['completed', 'merged', 'done', 'published', 'nothing']) {
      expect(frictionEchecsRepetes([{ status }, { status }, { status }])).toBeUndefined()
    }
  })

  it('D-C — les échecs nommés comptent toujours, espace finale et casse comprises', () => {
    expect(
      frictionEchecsRepetes([
        { status: 'failed ' },
        { status: 'TIMEOUT' },
        { gateBlocked: 1 as unknown as boolean }
      ])?.runs
    ).toBe(3)
  })

  it('D-D — une livraison SANS `status` remet quand même le compteur à zéro', () => {
    const livreSansStatus = { valid: true, gateBlocked: false, costUsd: 1.2 }
    expect(
      frictionEchecsRepetes([
        { status: 'failed' },
        { status: 'failed' },
        livreSansStatus,
        { status: 'failed' }
      ])
    ).toBeUndefined()
  })

  it('D-D — une reprise livrée (`resumed`, sans status) compte comme un progrès', () => {
    expect(
      frictionEchecsRepetes([
        { status: 'failed' },
        { status: 'failed' },
        { resumed: true },
        { status: 'failed' }
      ])
    ).toBeUndefined()
  })

  it('D-D — une reprise BLOQUÉE reste un échec de la série', () => {
    expect(
      frictionEchecsRepetes([
        { resumed: true, gateBlocked: true },
        { resumed: true, gateBlocked: true },
        { resumed: true, gateBlocked: true }
      ])?.runs
    ).toBe(3)
  })
})
