import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { ProviderRegistry } from './providers/registry'
import type { Message, ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'

/**
 * Preuve que la garde est APPELEE, pas seulement atteignable.
 *
 * Mesure du 20/08 sur une conversation reelle : l'agent a affirme « `edit_file` n'existe pas dans
 * le catalogue reellement disponible de cette session », puis a passe huit tours a reclamer des
 * droits shell dont il n'avait pas besoin — 13,15 $, zero ligne ecrite. `directReadOnly` vaut
 * `false` en dur : un tour pilote par l'utilisateur recoit TOUJOURS le catalogue complet.
 */
function harnais(reponses: string[]) {
  const promptsRecus: string[] = []
  const adapter: ProviderAdapter = {
    id: 'fixture-outil',
    auth: async () => true,
    async *send(messages: Message[]): AsyncGenerator<StreamChunk, SendResult, void> {
      yield* [] as StreamChunk[]
      promptsRecus.push(messages.map((m) => m.content).join('\n'))
      return {
        text: reponses[promptsRecus.length - 1] ?? 'Terminé.',
        provider: 'fixture-outil',
        systemInjected: true
      }
    }
  }
  const bus = {
    catalog: () => [
      {
        name: 'edit_file',
        description: 'Remplacer un extrait unique dans un bureau isolé',
        args: {},
        annotations: { readOnlyHint: false }
      },
      {
        name: 'verify',
        description: 'Rejouer la vérification du projet',
        args: {},
        annotations: { readOnlyHint: true }
      }
    ],
    snapshot: () => ({}),
    snapshotForPrompt: async () => ({}),
    exec: vi.fn()
  }
  const pilote = new AgentPilot(
    new ProviderRegistry().register(adapter),
    new RoleModelConfig({ orchestrator: { provider: 'fixture-outil', model: 'fixture' } }),
    bus as never
  )
  return {
    promptsRecus,
    jouer: () =>
      pilote.chat(
        [{ role: 'user', content: 'applique le correctif' }],
        () => undefined,
        undefined,
        4,
        'conv-outil'
      )
  }
}

describe('AgentPilot — un outil faussement déclaré absent déclenche une relance', () => {
  it('relance avec la correction quand l’agent dit ne pas avoir edit_file', async () => {
    const h = harnais([
      "`edit_file` n'existe pas dans le catalogue réellement disponible de cette session.",
      'Corrigé avec edit_file.'
    ])
    await h.jouer()
    expect(h.promptsRecus.length).toBeGreaterThanOrEqual(2)
    const relance = h.promptsRecus[1]
    expect(relance).toContain('tu affirmes ne pas disposer de')
    expect(relance).toContain('`edit_file`')
    expect(relance).toContain('aucun droit shell')
  })

  it('ne relance PAS quand la réponse n’affirme aucune absence', async () => {
    const h = harnais(['J’ai appliqué le correctif avec edit_file, la vérification passe.'])
    await h.jouer()
    const relances = h.promptsRecus.filter((p) => p.includes('tu affirmes ne pas disposer de'))
    expect(relances).toEqual([])
  })

  it('ne relance QU’UNE fois, même si l’agent répète son affirmation', async () => {
    const h = harnais([
      "`edit_file` n'existe pas.",
      "`edit_file` n'existe toujours pas, je maintiens.",
      'Bon, terminé.'
    ])
    await h.jouer()
    const relances = h.promptsRecus.filter((p) => p.includes('tu affirmes ne pas disposer de'))
    // Insister serait harceler : une seule relance, puis on laisse le tour se terminer.
    expect(relances.length).toBeLessThanOrEqual(1)
  })
})
