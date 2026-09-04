import { describe, expect, it } from 'vitest'
import { apercuDuRun, sectionBody } from './run-inspector-apercu'

const RUN = `status: green
session: conv-268

## Besoin
juger la skill curate

Critère de succès (DoD cochable) :
- [x] la sonde tourne
- [ ] le verdict est publié

## Journal
[2026-09-04] lecture de src/renderer/src/components/RunInspector.tsx

## Défauts
- ls <brainRoot>/inbox/*.md compte le README
- Aucun autre

## Reprise
continuer`

describe('apercuDuRun', () => {
  it('extrait le besoin, ce qui reste à cocher, les défauts réels et les fichiers touchés', () => {
    const a = apercuDuRun(RUN)
    expect(a.besoin).toBe('juger la skill curate')
    expect(a.dodRestants).toEqual(['le verdict est publié'])
    expect(a.defauts).toEqual(['ls <brainRoot>/inbox/*.md compte le README'])
    expect(a.fichiers).toContain('src/renderer/src/components/RunInspector.tsx')
  })

  it('ne rend rien plutôt que d’inventer quand les sections manquent', () => {
    const a = apercuDuRun('status: open')
    expect(a).toEqual({ besoin: '', dodRestants: [], defauts: [], fichiers: [] })
  })

  it('coupe une section au titre suivant', () => {
    expect(sectionBody(RUN, 'Reprise')).toBe('continuer')
    expect(sectionBody(RUN, 'Absente')).toBe('')
  })
})
