import { describe, expect, it } from 'vitest'
import { extractRunSections } from './run-inspector-model'

describe('extractRunSections', () => {
  it('keeps the standard RUN sections in document order and marks missing ones', () => {
    const sections = extractRunSections(`status: open

## Besoin

Le besoin.

## Journal

[2026-07-21] Cadrage.

## Reprise

Continuer.`)

    expect(sections.map((section) => [section.id, section.present])).toEqual([
      ['besoin', true],
      ['contraintes', false],
      ['options', false],
      ['sop', false],
      ['journal', true],
      ['defauts', false],
      ['reprise', true]
    ])
    expect(sections.find((section) => section.id === 'journal')?.content).toContain('Cadrage')
  })
})
