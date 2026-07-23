import { describe, it, expect, vi } from 'vitest'
import { ProviderRegistry } from './registry'
import { MockProvider } from './mock'
import type { Message, StreamChunk } from './types'

const conv: Message[] = [{ role: 'user', content: 'bonjour' }]

/** Registre de chat direct : le provider demandé répond LUI-MÊME (plus d'intermédiaire OmniRoute). */
function directRegistry(system?: string): ProviderRegistry {
  return new ProviderRegistry(system)
    .register(new MockProvider('claude'))
    .register(new MockProvider('codex'))
}

describe('ProviderRegistry — contrat d’adaptateur', () => {
  it('route une conversation DIRECTEMENT vers le provider demandé (plus d’OmniRoute)', async () => {
    const reg = directRegistry()
    expect(reg.ids().sort()).toEqual(['claude', 'codex'])
    const r = await reg.send('codex', conv)
    expect(r.provider).toBe('codex')
    expect(r.text).toContain('echo(codex): bonjour')
  })

  it('jette sur provider inconnu (contrat explicite)', async () => {
    const reg = new ProviderRegistry()
    expect(() => reg.get('inconnu')).toThrow(/Provider inconnu/)
    await expect(reg.send('inconnu', conv)).rejects.toThrow(/Provider inconnu/)
  })

  it('streame des chunks PUIS retourne un résultat consolidé', async () => {
    const reg = directRegistry()
    const chunks: StreamChunk[] = []
    const r = await reg.send('claude', conv, {}, (c) => chunks.push(c))
    expect(chunks.length).toBeGreaterThan(0)
    expect(r.text).toContain('echo(claude): bonjour')
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
    const reg = directRegistry(soul)
    const r = await reg.send('claude', conv)
    expect(r.systemInjected).toBe(true)
    expect(r.text).toContain('REGLE 2')
  })

  it('sans bloc système → pas d’injection (contrôle négatif)', async () => {
    const reg = directRegistry()
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
    const reg = directRegistry('DEFAUT')
    const r = await reg.send('claude', conv, { system: 'OVERRIDE-KIT' })
    expect(r.text).toContain('OVERRIDE-KIT')
    expect(r.text).not.toContain('DEFAUT')
  })

  it('décrit sans troncature l’enveloppe réellement remise à l’adaptateur (provider demandé)', () => {
    const system = `SOUL + SKILL\n${'instruction '.repeat(2_000)}`
    const reg = directRegistry(system)
    const envelope = reg.describePrompt('claude', conv, { model: 'claude-sonnet' })
    expect(envelope.system).toBe(system)
    expect(envelope.messages).toEqual(conv)
    expect(envelope.provider).toBe('claude')
    expect(envelope.model).toBe('claude-sonnet')
    expect(envelope.limitation).toMatch(/provider/i)
  })

  it('le provider demandé répond lui-même — aucune redirection silencieuse', async () => {
    const claude = new MockProvider('claude')
    const claudeSend = vi.spyOn(claude, 'send')
    const codex = new MockProvider('codex')
    const codexSend = vi.spyOn(codex, 'send')
    const reg = new ProviderRegistry().register(claude).register(codex)
    const result = await reg.send('claude', conv, { model: 'claude-opus' })
    expect(result.provider).toBe('claude')
    expect(claudeSend).toHaveBeenCalled()
    expect(codexSend).not.toHaveBeenCalled()
  })

  it('conserve l’exécution locale outillée (fallback codex) pour un provider non-exécuteur', async () => {
    const codex = Object.assign(new MockProvider('codex'), { supportsExecution: true as const })
    const chat = new MockProvider('kimi')
    const reg = new ProviderRegistry().register(chat).register(codex)
    const r = await reg.send('kimi', conv, {
      execution: { cwd: 'C:\\workspace', sandbox: 'read-only' }
    })
    expect(r.provider).toBe('codex')
  })

  it('refuse toute substitution d’exécuteur pour une route Fabric', async () => {
    const fabricId = 'fabric:node-gpu-01:qwen3-32b'
    const fabric = new MockProvider(fabricId)
    const fabricSend = vi.spyOn(fabric, 'send')
    const codex = Object.assign(new MockProvider('codex'), { supportsExecution: true as const })
    const codexSend = vi.spyOn(codex, 'send')
    const reg = new ProviderRegistry().register(fabric).register(codex)

    await expect(
      reg.send(fabricId, conv, {
        execution: { cwd: 'C:\\workspace', sandbox: 'workspace-write' }
      })
    ).rejects.toThrow(/tool-stream/i)
    expect(fabricSend).not.toHaveBeenCalled()
    expect(codexSend).not.toHaveBeenCalled()
  })
})
