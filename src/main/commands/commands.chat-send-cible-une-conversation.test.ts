import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * Capacite manquante mesuree le 2026-09-05 (conv-297 -> conv-300) : un agent pouvait CREER une
 * conversation mais rien y lancer. `runPrompt` — deja utilise par les taches planifiees — sait
 * pourtant demarrer un vrai tour dans un fil nomme. Ce test verrouille son cablage sur
 * `chat_send` : avec `conversationId`, le message devient un tour REEL dans ce fil (le pilote y
 * resout `/curate` comme skill) ; sans destination valide, le refus est EXPLICITE.
 */
describe('chat_send — destination conversation', () => {
  function socle(): { appelsModele: string[]; os: unknown } {
    const appelsModele: string[] = []
    const os = {
      executionWorkspace: process.cwd(),
      chat: async (_p: unknown, _r: unknown, messages: Array<{ content: string }>) => {
        appelsModele.push(messages[0].content)
        return { text: 'reponse ponctuelle' }
      },
      conversations: { get: () => undefined, list: () => [] },
      registry: { ids: () => ['claude'] },
      roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
      runsWithGate: () => [],
      budget: () => ({ spent: 0 })
    }
    return { appelsModele, os }
  }

  it('lance un vrai tour dans la conversation nommee, sans passer par le modele ponctuel', async () => {
    const { appelsModele, os } = socle()
    const lances: Array<{ conversationId: string; prompt: string }> = []
    const bus = new AppCommandBus(os as never, () => undefined)
    bus.conversationExiste = (id) => id === 'conv-300'
    bus.lancerDansConversation = async (conversationId, prompt) => {
      lances.push({ conversationId, prompt })
      return { ok: true, turnId: 'turn-1' }
    }

    const result = await bus.exec('chat_send', { message: '/curate', conversationId: 'conv-300' })

    expect(result.ok).toBe(true)
    expect(lances).toEqual([{ conversationId: 'conv-300', prompt: '/curate' }])
    expect(appelsModele).toEqual([])
    expect((result.data as { conversationId: string; turnId: string }).conversationId).toBe('conv-300')
    expect((result.data as { turnId: string }).turnId).toBe('turn-1')
  })

  // Mesure arena t13/t14 (2026-09-21) : impossible de faire tourner un fil sur un autre modele que
  // celui de l'orchestrateur, alors que `runPrompt` accepte deja un binding (taches planifiees).
  it('transmet le modele demande au tour lance, et rien quand il n est pas demande', async () => {
    const { os } = socle()
    const bindings: unknown[] = []
    const bus = new AppCommandBus(os as never, () => undefined)
    bus.conversationExiste = () => true
    bus.lancerDansConversation = async (_id, _prompt, binding) => {
      bindings.push(binding)
      return { ok: true, turnId: 't' }
    }

    await bus.exec('chat_send', { message: 'x', conversationId: 'conv-300', model: 'sonnet' })
    await bus.exec('chat_send', {
      message: 'x',
      conversationId: 'conv-300',
      provider: 'codex',
      model: 'gpt-5'
    })
    await bus.exec('chat_send', { message: 'x', conversationId: 'conv-300' })

    expect(bindings).toEqual([
      { provider: 'claude', model: 'sonnet' },
      { provider: 'codex', model: 'gpt-5' },
      undefined
    ])
  })

  it('refuse explicitement une conversation inconnue', async () => {
    const { appelsModele, os } = socle()
    const bus = new AppCommandBus(os as never, () => undefined)
    bus.conversationExiste = () => false
    bus.lancerDansConversation = async () => ({ ok: true })

    const result = await bus.exec('chat_send', { message: '/curate', conversationId: 'conv-999' })

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('conv-999')
    expect(appelsModele).toEqual([])
  })

  it('refuse explicitement quand la capacite n est pas cablee, sans repli silencieux', async () => {
    const { appelsModele, os } = socle()
    const bus = new AppCommandBus(os as never, () => undefined)

    const result = await bus.exec('chat_send', { message: 'salut', conversationId: 'conv-300' })

    expect(result.ok).toBe(false)
    expect(appelsModele).toEqual([])
  })

  it('remonte l echec de demarrage au lieu d annoncer un envoi', async () => {
    const { os } = socle()
    const bus = new AppCommandBus(os as never, () => undefined)
    bus.conversationExiste = () => true
    bus.lancerDansConversation = async () => ({ ok: false, error: 'fil occupe' })

    const result = await bus.exec('chat_send', { message: '/curate', conversationId: 'conv-300' })

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('fil occupe')
  })
})
