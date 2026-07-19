import { describe, it, expect } from 'vitest'
import { ProviderRegistry } from './registry'
import { MockProvider } from './mock'
import type { Message, StreamChunk } from './types'

const conv: Message[] = [{ role: 'user', content: 'bonjour' }]

describe('ProviderRegistry — contrat d’adaptateur', () => {
  it('route vers l’adaptateur enregistré par id', async () => {
    const reg = new ProviderRegistry()
      .register(new MockProvider('claude'))
      .register(new MockProvider('codex'))
    expect(reg.ids().sort()).toEqual(['claude', 'codex'])
    const r = await reg.send('codex', conv)
    expect(r.provider).toBe('codex')
  })

  it('jette sur provider inconnu (contrat explicite)', async () => {
    const reg = new ProviderRegistry()
    await expect(reg.send('inconnu', conv)).rejects.toThrow(/Provider inconnu/)
  })

  it('streame des chunks PUIS retourne un résultat consolidé', async () => {
    const reg = new ProviderRegistry().register(new MockProvider('claude'))
    const chunks: StreamChunk[] = []
    const r = await reg.send('claude', conv, {}, (c) => chunks.push(c))
    expect(chunks.length).toBeGreaterThan(0)
    expect(r.text).toContain('echo(claude): bonjour')
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
    const reg = new ProviderRegistry(soul).register(new MockProvider('claude'))
    const r = await reg.send('claude', conv)
    expect(r.systemInjected).toBe(true)
    // le mock "cite" la 1re ligne du système → équivalent d'un modèle appliquant SOUL
    expect(r.text).toContain('REGLE 2')
  })

  it('sans bloc système → pas d’injection (contrôle négatif)', async () => {
    const reg = new ProviderRegistry().register(new MockProvider('claude'))
    const r = await reg.send('claude', conv)
    expect(r.systemInjected).toBe(false)
    expect(r.text).not.toContain('system-applied')
  })

  it('opts.system surcharge le bloc par défaut du registre', async () => {
    const reg = new ProviderRegistry('DEFAUT').register(new MockProvider('claude'))
    const r = await reg.send('claude', conv, { system: 'OVERRIDE-KIT' })
    expect(r.text).toContain('OVERRIDE-KIT')
    expect(r.text).not.toContain('DEFAUT')
  })

  it('décrit sans troncature l’enveloppe réellement remise à l’adaptateur', () => {
    const system = `SOUL + SKILL\n${'instruction '.repeat(2_000)}`
    const reg = new ProviderRegistry(system).register(new MockProvider('claude'))
    const envelope = reg.describePrompt('claude', conv, {}, 'claude-sonnet')
    expect(envelope.system).toBe(system)
    expect(envelope.messages).toEqual(conv)
    expect(envelope.provider).toBe('claude')
    expect(envelope.model).toBe('claude-sonnet')
    expect(envelope.limitation).toMatch(/provider/i)
  })
})
