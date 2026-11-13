import { describe, expect, it, vi } from 'vitest'
import { AppCommandBus } from './commands'
import { ConversationStore } from '../store/conversations'

type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]

/**
 * La photo de l'état (`snapshot`) passe à chaque tour d'agent et donne la date du dernier message
 * de l'utilisateur pour chaque fil. Elle la prend dans le RÉSUMÉ du fil (`listResumes`), jamais par
 * `listAvecMessages` : un fil archivé n'aura plus ses messages en mémoire, et sa date doit venir du
 * résumé. Ce test verrouille cet appel, pas le coût du calcul : `resumeDuFil` recalcule la date à
 * chaque lecture, en parcourant les messages en mémoire.
 */
describe('snapshot : la liste des fils prend ses dates dans le résumé', () => {
  it('donne la date du dernier message utilisateur sans appeler listAvecMessages', async () => {
    const conversations = new ConversationStore(() => 1000)
    const fil = conversations.create({ title: 'avec question', provider: 'claude' })
    conversations.append(fil.id, { role: 'user', content: 'ma question' })
    const dateDeLaQuestion = conversations.get(fil.id)!.messages[0].ts
    const relecture = vi.spyOn(conversations, 'listAvecMessages')
    const os = {
      executionWorkspace: process.cwd(),
      conversations,
      registry: { ids: () => ['claude'] },
      roles: { all: () => ({}), getBinding: () => undefined },
      runsWithGate: async () => [],
      budget: () => ({ pricedSpendUsd: 0 }),
      getWorktreeActivity: () => [],
      travauxNonPubliesBornes: () => []
    } as unknown as OsDouble

    const etat = await new AppCommandBus(os, () => {}).snapshot()

    expect(relecture).not.toHaveBeenCalled()
    expect(etat.conversations).toEqual([
      expect.objectContaining({ id: fil.id, lastUserMessageAt: dateDeLaQuestion })
    ])
  })
})
