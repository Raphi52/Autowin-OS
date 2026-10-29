import { describe, expect, it } from 'vitest'
import { reduceAssistantPilotEvent } from './chat-view-model'
import { actionsDuTour } from './thinking-block-corps'
import { cibleEntiereDe, statutComplet } from '../../../shared/chat-turn'

/**
 * PLAFOND MUET n°5 (conv-1228, 2026-10-28) : le fournisseur coupe la commande d'une action à 120
 * caractères pour l'en-tête d'une ligne (providers/claude.ts) et transmet l'entière à côté
 * (`data.target`). Le main s'en servait pour JUGER la commande (conv-861), mais le journal du bloc
 * Actions ne gardait que le moignon : en dépliant une action, on lisait une commande amputée.
 */
type Message = Parameters<typeof reduceAssistantPilotEvent>[0]
type Evenement = Parameters<typeof reduceAssistantPilotEvent>[1]

const base = { turnId: 't1', parts: [], done: false } as unknown as Message
const entiere = `cd /d/projet && npx vitest run ${'src/un/chemin/assez/long/test.ts '.repeat(6)}--reporter verbose`
const coupee = entiere.slice(0, 120)

describe('le bloc Actions garde la commande entière', () => {
  it('statutComplet recolle la cible entière derrière le nom de l’outil', () => {
    expect(statutComplet(`Bash · ${coupee}`, entiere)).toBe(`Bash · ${entiere}`)
    expect(cibleEntiereDe({ target: entiere })).toBe(entiere)
    expect(cibleEntiereDe(undefined)).toBeUndefined()
  })

  it('le direct garde la ligne entière dans le journal, l’en-tête reste courte', () => {
    const apres = reduceAssistantPilotEvent(base, {
      kind: 'provider-status',
      text: `Bash · ${coupee}`,
      data: { target: entiere },
      turnId: 't1'
    } as Evenement)
    expect(apres.providerStatusLog?.at(-1)).toBe(`Bash · ${entiere}`)
    expect(apres.providerStatus).toBe(`Bash · ${coupee}`)
  })

  it('une commande entière longue ne reçoit pas de « … » de coupe', () => {
    const actions = actionsDuTour(
      [`Bash · ${entiere}`, 'tache de fond en cours - tests', 'Bash terminé - 2 s'],
      undefined,
      true
    )
    const derniere = actions[0]?.sousActions?.at(-1) ?? ''
    expect(derniere.endsWith('…')).toBe(false)
    expect(derniere).toContain('--reporter verbose')
  })
})
