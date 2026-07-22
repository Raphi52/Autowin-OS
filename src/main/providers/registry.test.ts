import { describe, it, expect, vi } from 'vitest'
import { ProviderRegistry } from './registry'
import { MockProvider } from './mock'
import type { Message, StreamChunk } from './types'

const conv: Message[] = [{ role: 'user', content: 'bonjour' }]

function routedRegistry(system?: string): ProviderRegistry {
  const registry = new ProviderRegistry(system).register(new MockProvider('omniroute'))
  registry.setConversationTransport({ provider: 'omniroute', model: 'auto/coding' })
  return registry
}

describe('ProviderRegistry — contrat d’adaptateur', () => {
  it('refuse une conversation tant qu’OmniRoute n’est pas configuré', async () => {
    const reg = new ProviderRegistry()
      .register(new MockProvider('claude'))
      .register(new MockProvider('codex'))
    expect(reg.ids().sort()).toEqual(['claude', 'codex'])
    await expect(reg.send('codex', conv)).rejects.toThrow(/OmniRoute obligatoire/i)
  })

  it('jette sur provider inconnu (contrat explicite)', async () => {
    const reg = new ProviderRegistry()
    expect(() => reg.get('inconnu')).toThrow(/Provider inconnu/)
  })

  it('streame des chunks PUIS retourne un résultat consolidé', async () => {
    const reg = routedRegistry()
    const chunks: StreamChunk[] = []
    const r = await reg.send('claude', conv, {}, (c) => chunks.push(c))
    expect(chunks.length).toBeGreaterThan(0)
    expect(r.text).toContain('echo(omniroute): bonjour')
    // le texte final = concaténation des deltas (cohérence stream/final)
    expect(
      r.text.startsWith(
        chunks
          .map((c) => c.delta)
          .join('')
          .slice(0, 5)
      )
    ).toBe(true)
  })

  it('INJECTE le bloc système du registre sur chaque tour (preuve d’injection)', async () => {
    const soul = 'REGLE 2: exiger un artefact vérifié avant « done ».\n(reste du kit…)'
    const reg = routedRegistry(soul)
    const r = await reg.send('claude', conv)
    expect(r.systemInjected).toBe(true)
    // le mock "cite" la 1re ligne du système → équivalent d'un modèle appliquant SOUL
    expect(r.text).toContain('REGLE 2')
  })

  it('sans bloc système → pas d’injection (contrôle négatif)', async () => {
    const reg = routedRegistry()
    const r = await reg.send('claude', conv)
    expect(r.systemInjected).toBe(false)
    expect(r.text).not.toContain('system-applied')
  })

  it('refuse explicitement un mode exécution sur un provider de chat', async () => {
    const reg = new ProviderRegistry().register(new MockProvider('claude'))
    await expect(
      reg.send('claude', conv, {
        execution: { cwd: 'C:\\workspace', sandbox: 'workspace-write' }
      })
    ).rejects.toThrow(/sans exécuteur local outillé/)
  })

  it('opts.system surcharge le bloc par défaut du registre', async () => {
    const reg = routedRegistry('DEFAUT')
    const r = await reg.send('claude', conv, { system: 'OVERRIDE-KIT' })
    expect(r.text).toContain('OVERRIDE-KIT')
    expect(r.text).not.toContain('DEFAUT')
  })

  it('décrit sans troncature l’enveloppe réellement remise à l’adaptateur', () => {
    const system = `SOUL + SKILL\n${'instruction '.repeat(2_000)}`
    const reg = routedRegistry(system)
    const envelope = reg.describePrompt('claude', conv, {}, 'claude-sonnet')
    expect(envelope.system).toBe(system)
    expect(envelope.messages).toEqual(conv)
    expect(envelope.provider).toBe('omniroute')
    expect(envelope.model).toBe('auto/coding')
    expect(envelope.limitation).toMatch(/provider/i)
  })

  it('remplace every conversational provider by OmniRoute when migration is active', async () => {
    const direct = new MockProvider('claude')
    const directSend = vi.spyOn(direct, 'send')
    const omniRoute = new MockProvider('omniroute')
    const reg = new ProviderRegistry().register(direct).register(omniRoute)
    reg.setConversationTransport({ provider: 'omniroute', model: 'auto/coding' })
    const result = await reg.send('claude', conv, { model: 'claude-opus' })
    expect(result.provider).toBe('omniroute')
    expect(directSend).not.toHaveBeenCalled()
    const prompt = reg.describePrompt('codex', conv, { model: 'gpt-direct' })
    expect(prompt.provider).toBe('omniroute')
    expect(prompt.model).toBe('auto/coding')
  })

  it('conserve l’exécution locale outillée sans ouvrir de transport conversationnel direct', async () => {
    const direct = Object.assign(new MockProvider('codex'), { supportsExecution: true as const })
    const omniRoute = new MockProvider('omniroute')
    const reg = new ProviderRegistry().register(direct).register(omniRoute)
    reg.setConversationTransport({ provider: 'omniroute', model: 'auto/coding' })
    expect(
      (
        await reg.send('codex', conv, {
          execution: { cwd: 'C:\\workspace', sandbox: 'read-only' }
        })
      ).provider
    ).toBe('codex')
  })

  it('autorise une ressource Fabric enregistrée comme transport conversationnel local-tools', async () => {
    const fabricId = 'fabric:node-gpu-01:qwen3-32b'
    const fabric = new MockProvider(fabricId)
    const reg = new ProviderRegistry().register(fabric)

    reg.setConversationTransport({ provider: fabricId, model: 'qwen3-32b' })
    const result = await reg.send('claude', conv)

    expect(result.provider).toBe(fabricId)
    expect(reg.getConversationTransport()).toEqual({ provider: fabricId, model: 'qwen3-32b' })
  })

  it('confie automatiquement une action OmniRoute au runner local outillé', async () => {
    const direct = Object.assign(new MockProvider('codex'), { supportsExecution: true as const })
    const directSend = vi.spyOn(direct, 'send')
    const omniRoute = new MockProvider('omniroute')
    const omniSend = vi.spyOn(omniRoute, 'send')
    const reg = new ProviderRegistry().register(direct).register(omniRoute)
    reg.setConversationTransport({ provider: 'omniroute', model: 'auto/coding' })

    const result = await reg.send('omniroute', conv, {
      model: 'auto/best-coding',
      reasoningEffort: 'none',
      execution: { cwd: 'C:\\workspace', sandbox: 'workspace-write' }
    })

    expect(result.provider).toBe('codex')
    expect(directSend).toHaveBeenCalledWith(
      conv,
      expect.objectContaining({ model: undefined, reasoningEffort: undefined })
    )
    expect(omniSend).not.toHaveBeenCalled()
  })
})
