import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendConvActivity, effortEnvoyeDeLEnveloppe, loadConvActivity } from './conv-activity'

// 2026-10-16 : les lignes d'etape (exec/judge) n'avaient jamais l'effort que le chat, lui, journalise.
describe("journal d'activite — effort d'une etape d'orchestration", () => {
  it("lit la valeur passee en --effort dans l'argv envoye", () => {
    const prompt = { options: { argv: ['-p', '--model', 'opus', '--effort', 'xhigh', '--verbose'] } }
    expect(effortEnvoyeDeLEnveloppe(prompt)).toBe('xhigh')
  })

  it("reste absent quand rien n'a ete envoye (pas de devinette)", () => {
    expect(effortEnvoyeDeLEnveloppe(undefined)).toBeUndefined()
    expect(effortEnvoyeDeLEnveloppe({ options: { argv: ['-p', '--model', 'opus'] } })).toBeUndefined()
    expect(effortEnvoyeDeLEnveloppe({ options: { argv: ['--effort'] } })).toBeUndefined()
  })

  it("se rabat sur options.reasoningEffort d'un fournisseur sans argv", () => {
    expect(effortEnvoyeDeLEnveloppe({ options: { reasoningEffort: 'high' } })).toBe('high')
  })

  it("arrive dans la ligne d'activite sous le meme champ que le chat", () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-'))
    appendConvActivity(
      'conv-1',
      {
        kind: 'judge',
        label: 'judge',
        model: 'opus',
        reasoningEffort: effortEnvoyeDeLEnveloppe({ options: { argv: ['--effort', 'max'] } })
      },
      root
    )
    expect(loadConvActivity('conv-1', root)[0].reasoningEffort).toBe('max')
  })
})
