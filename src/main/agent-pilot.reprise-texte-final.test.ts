import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent, type RecoveredPilotProviderCall } from './agent-pilot'
import { ProviderRegistry } from './providers/registry'
import type { ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'

/**
 * REPRISE APRES REDEMARRAGE : LA REPONSE FINALE NE DOIT PAS DISPARAITRE.
 *
 * MESURE le 2026-09-11 sur `conv-471`. Le process principal a ete relance pendant un tour (une
 * ecriture dans `src/main` suffit en mode dev). Le journal du tour montre `resumed`, puis un `done`
 * au texte VIDE : les phrases deja diffusees ont survecu (222 caracteres), mais le compte-rendu
 * final -- bloc de cloture compris -- n'a jamais atteint le fil, pour 10652 tokens de sortie deja
 * payes. L'utilisateur a lu un fil tronque et ne pouvait pas savoir si le travail etait fini.
 *
 * Le tour repris n'a AUCUNE commande a rejouer : il ne lui reste qu'a livrer son texte. C'est
 * exactement ce cas-la qui rendait du vide.
 */
function harnais(): {
  registry: ProviderRegistry
  roles: RoleModelConfig
  bus: unknown
  appelsProvider: () => number
} {
  let appels = 0
  const adapter: ProviderAdapter = {
    id: 'fixture',
    auth: async () => true,
    async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
      yield* [] as StreamChunk[]
      appels += 1
      return { text: 'Un NOUVEL appel provider.', provider: 'fixture', systemInjected: true }
    }
  }
  return {
    registry: new ProviderRegistry().register(adapter),
    roles: new RoleModelConfig({ orchestrator: { provider: 'fixture', model: 'fixture-model' } }),
    bus: {
      catalog: () => [],
      snapshot: () => ({}),
      snapshotForPrompt: async () => ({}),
      exec: vi.fn()
    },
    appelsProvider: () => appels
  }
}

async function reprendre(recovered: RecoveredPilotProviderCall): Promise<PilotEvent[]> {
  const { registry, roles, bus } = harnais()
  const events: PilotEvent[] = []
  await new AgentPilot(registry, roles, bus as never).chat(
    [{ role: 'user', content: 'fais le travail' }],
    (event) => events.push(event),
    undefined,
    6,
    'conv-reprise',
    undefined,
    undefined,
    undefined,
    'turn-reprise',
    undefined,
    recovered
  )
  return events
}

const DEJA_DIFFUSE = 'Je lance les tests.'
const CLOTURE = '\n\n✅ Fait\nLes 33 tests passent.\n\n👉 Recommandé\nrien'

describe('reprise de tour — le texte final survit au redemarrage', () => {
  it('livre la SUITE quand le resultat recupere reprend le texte deja diffuse', async () => {
    const events = await reprendre({
      iteration: 0,
      attempt: 0,
      streamId: '0:0',
      streamedPrefix: DEJA_DIFFUSE,
      result: {
        text: DEJA_DIFFUSE + CLOTURE,
        provider: 'fixture',
        systemInjected: true
      }
    })
    const done = events.find((event) => event.kind === 'done')
    expect(done).toBeDefined()
    // Le bloc de cloture doit atteindre le fil : c'est lui qui dit que le travail est fini.
    expect(done && 'text' in done ? done.text : '').toContain('✅ Fait')
  })

  it('livre le texte ENTIER quand le resultat recupere ne porte que la suite', async () => {
    const events = await reprendre({
      iteration: 0,
      attempt: 0,
      streamId: '0:0',
      streamedPrefix: DEJA_DIFFUSE,
      result: { text: CLOTURE.trim(), provider: 'fixture', systemInjected: true }
    })
    const done = events.find((event) => event.kind === 'done')
    expect(done && 'text' in done ? done.text : '').toContain('✅ Fait')
  })

  it('ne rend JAMAIS un done vide quand le resultat recupere porte du texte', async () => {
    const events = await reprendre({
      iteration: 0,
      attempt: 0,
      streamId: '0:0',
      streamedPrefix: DEJA_DIFFUSE,
      result: { text: DEJA_DIFFUSE + CLOTURE, provider: 'fixture', systemInjected: true }
    })
    const done = events.find((event) => event.kind === 'done')
    expect(((done && 'text' in done ? done.text : '') ?? '').trim()).not.toBe('')
  })
})
