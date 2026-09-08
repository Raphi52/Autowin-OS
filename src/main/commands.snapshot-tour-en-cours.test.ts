import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * DÉFAUT VÉCU le 2026-09-08 (conv-346). L'utilisateur demande si un tour relancé après un
 * redémarrage « bosse réellement ». L'agent n'avait AUCUN signe de vie dans son état : `snapshot()`
 * ne rend qu'`updatedAt` / `lastUserMessageAt`. Il a donc deviné en lisant `activity/*.jsonl` et
 * `causal-trace/*.jsonl` — deux journaux écrits en FIN de tour — et a conclu « le tour est mort »
 * alors que le journal du tour s'écrivait à la seconde près.
 *
 * Le main CONNAÎT la réponse : `activeChatTurns.get(id)`, déjà exposé au renderer par
 * `os:pilotChat:active`. Il manquait seulement au contrat de l'agent. Ce test verrouille sa
 * présence : ce n'est pas une consigne de comportement, c'est un fait dans l'état.
 */

type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]

const os = (): OsDouble =>
  ({
    executionWorkspace: process.cwd(),
    conversations: {
      list: () => [
        { id: 'conv-342', title: 'en vol', provider: 'claude', updatedAt: 1, messages: [] },
        { id: 'conv-343', title: 'au repos', provider: 'claude', updatedAt: 1, messages: [] }
      ]
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => undefined },
    runsWithGate: async () => [],
    budget: () => ({ pricedSpendUsd: 0 }),
    getWorktreeActivity: () => [],
    travauxNonPublies: () => [],
    travauxNonPubliesBornes: () => []
  }) as unknown as OsDouble

describe('get_state dit quelles conversations ont un tour EN VOL', () => {
  it('marque la conversation active et laisse l’autre intacte', async () => {
    const bus = new AppCommandBus(os(), () => {})
    bus.tourDeChatActif = (id) => id === 'conv-342'

    const etat = await bus.snapshot()
    const parId = new Map(etat.conversations.map((c) => [c.id, c]))

    expect(parId.get('conv-342')?.tourEnCours).toBe(true)
    expect(parId.get('conv-343')?.tourEnCours).toBeUndefined()
  })

  it('sans câblage, aucune conversation n’est déclarée en vol', async () => {
    const etat = await new AppCommandBus(os(), () => {}).snapshot()
    expect(etat.conversations.every((c) => c.tourEnCours === undefined)).toBe(true)
  })
})
