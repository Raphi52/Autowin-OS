import { describe, it, expect } from 'vitest'
import {
  claudeToolResultText,
  claudeToolEvidenceKind,
  claudeWrittenLineFingerprints
} from './claude'
import { exactLineFingerprint } from '../exact-line-fingerprint'

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

describe('claudeWrittenLineFingerprints', () => {
  it('extrait les contenus exacts des outils Write, Edit et MultiEdit', () => {
    expect(
      claudeWrittenLineFingerprints({
        content: 'premiere\ndeuxieme',
        new_string: 'remplacement',
        edits: [{ new_string: 'multi un\nmulti deux' }]
      })
    ).toEqual(
      ['premiere', 'deuxieme', 'remplacement', 'multi un', 'multi deux'].map(exactLineFingerprint)
    )
  })

  it('ignore les champs de lecture et borne une ligne revendiquee', () => {
    const fingerprints = claudeWrittenLineFingerprints({
      old_string: 'ne pas attribuer',
      content: 'x'.repeat(10_000)
    })
    expect(fingerprints).toEqual([exactLineFingerprint('x'.repeat(10_000))])
    expect(fingerprints[0]).toHaveLength(64)
  })

  it('ne revendique pas le contexte inchange transporte par Edit', () => {
    expect(
      claudeWrittenLineFingerprints({
        old_string: 'contexte conserve\nancienne valeur',
        new_string: 'contexte conserve\nnouvelle valeur'
      })
    ).toEqual([exactLineFingerprint('nouvelle valeur')])
  })
})
