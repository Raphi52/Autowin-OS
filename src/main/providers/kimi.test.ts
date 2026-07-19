import { describe, expect, it } from 'vitest'
import { buildKimiPrompt, KimiCliAdapter, kimiTextFromEvent, resolveKimiCommand } from './kimi'

describe('KimiCliAdapter — contrat compte CLI', () => {
  it('injecte explicitement le système et conserve le fil, sans message system dupliqué', () => {
    const prompt = buildKimiPrompt(
      [
        { role: 'system', content: 'ignoré côté historique' },
        { role: 'user', content: 'Bonjour' },
        { role: 'assistant', content: 'Salut' },
        { role: 'user', content: 'Continue' }
      ],
      'Réponds en français.'
    )
    expect(prompt).toContain('INSTRUCTIONS SYSTEME AUTOWIN OS')
    expect(prompt).toContain('Réponds en français.')
    expect(prompt).toContain('UTILISATEUR:\nBonjour')
    expect(prompt).toContain('ASSISTANT:\nSalut')
    expect(prompt).not.toContain('ignoré côté historique')
  })

  it('extrait les variantes de texte JSONL sans inventer de sortie outil', () => {
    expect(kimiTextFromEvent({ delta: 'Bon' })).toBe('Bon')
    expect(kimiTextFromEvent({ message: { content: [{ text: 'jour' }] } })).toBe('jour')
    expect(kimiTextFromEvent({ tool_calls: [{ name: 'Read' }] })).toBe('')
  })

  it('respecte KIMI_BIN avant toute résolution PATH', () => {
    const before = process.env.KIMI_BIN
    process.env.KIMI_BIN = 'C:\\outils\\kimi.exe'
    expect(resolveKimiCommand()).toEqual({ executable: 'C:\\outils\\kimi.exe', prefix: [] })
    if (before === undefined) delete process.env.KIMI_BIN
    else process.env.KIMI_BIN = before
  })

  it('refuse un shim cmd afin de garder spawn sans shell sous Windows', () => {
    expect(() => resolveKimiCommand('C:\\outils\\kimi.cmd')).toThrow('shim kimi.cmd')
  })

  it('lance le CLI Kimi installe via son entrypoint Node, sans shell', async () => {
    await expect(new KimiCliAdapter().auth()).resolves.toBe(true)
  }, 15_000)
})
