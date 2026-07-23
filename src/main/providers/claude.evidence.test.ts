import { describe, it, expect } from 'vitest'
import { claudeToolResultText, claudeToolEvidenceKind } from './claude'

describe('claudeToolResultText', () => {
  it('string brute → retournée telle quelle', () => {
    expect(claudeToolResultText('exit 0\n12 passed')).toBe('exit 0\n12 passed')
  })
  it('tableau de blocs text → concaténé', () => {
    expect(
      claudeToolResultText([
        { type: 'text', text: 'ligne 1' },
        { type: 'text', text: 'ligne 2' }
      ])
    ).toBe('ligne 1\nligne 2')
  })
  it('contenu non exploitable → chaîne vide', () => {
    expect(claudeToolResultText(undefined)).toBe('')
    expect(claudeToolResultText(42)).toBe('')
    expect(claudeToolResultText([{ type: 'image' }])).toBe('')
  })
})

describe('claudeToolEvidenceKind', () => {
  it('Edit/Write → mutation ; Bash test → verification ; Bash autre → inspection', () => {
    expect(claudeToolEvidenceKind('Edit', 'src/a.ts')).toBe('mutation')
    expect(claudeToolEvidenceKind('Bash', 'npx vitest run')).toBe('verification')
    expect(claudeToolEvidenceKind('Bash', 'ls -la')).toBe('inspection')
  })
})
