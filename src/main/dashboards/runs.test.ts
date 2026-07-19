import { describe, expect, it } from 'vitest'
import { isBlocked, parseRun } from './runs'

const OPEN_RUN = `status: open
regime: standard

## Besoin
- [x] Étape 1 faite
- [ ] Étape 2 pas faite
- [ ] Étape 3 pas faite

## Journal
[2026-07-18T10:00:00] Démarrage
[2026-07-18T10:05:00] Progression
pas un event

## Défauts
<!-- rien pour l'instant -->
`

const GREEN_PARTIAL_RUN = `status: green
regime: critical

## Besoin
- [x] Étape 1
- [ ] Étape 2

## Journal
[2026-07-18T11:00:00] Clôture

## Défauts
`

const GREEN_FULL_RUN = `status: green
regime: disposable

## Besoin
- [x] Étape 1
- [x] Étape 2

## Journal
[2026-07-18T12:00:00] Clôture verte

## Défauts
`

const RUN_WITH_DEFAUTS = `status: red

## Besoin
- [ ] Étape unique

## Journal
[2026-07-18T13:00:00] Échec détecté

## Défauts
Défaut A : timeout sur X
Défaut B : mauvaise valeur Y
`

describe('parseRun', () => {
  it('lit status, regime, DoD, journal et défauts sur un run open', () => {
    const s = parseRun(OPEN_RUN, 'test-run-1')
    expect(s.status).toBe('open')
    expect(s.regime).toBe('standard')
    expect(s.dodTotal).toBe(3)
    expect(s.dodChecked).toBe(1)
    expect(s.journalEvents).toBe(2)
    expect(s.defauts).toBe(0)
    expect(s.subject).toBe('test-run-1')
  })

  it('défaut status = unknown si absent', () => {
    const s = parseRun('## Besoin\n- [ ] x\n')
    expect(s.status).toBe('unknown')
    expect(s.regime).toBeUndefined()
  })

  it('compte les défauts non vides sous ## Défauts', () => {
    const s = parseRun(RUN_WITH_DEFAUTS)
    expect(s.status).toBe('red')
    expect(s.defauts).toBe(2)
    expect(s.journalEvents).toBe(1)
    expect(s.dodTotal).toBe(1)
    expect(s.dodChecked).toBe(0)
  })

  it('ignore les commentaires sous ## Défauts', () => {
    const s = parseRun(GREEN_PARTIAL_RUN)
    expect(s.defauts).toBe(0)
  })

  it('borne la section ## Besoin au prochain heading', () => {
    const s = parseRun(GREEN_FULL_RUN)
    expect(s.dodTotal).toBe(2)
    expect(s.dodChecked).toBe(2)
  })
})

describe('isBlocked', () => {
  it('true sur open avec DoD partielle', () => {
    expect(isBlocked(parseRun(OPEN_RUN))).toBe(true)
  })

  it('true sur green avec DoD incomplète', () => {
    expect(isBlocked(parseRun(GREEN_PARTIAL_RUN))).toBe(true)
  })

  it('false sur green avec DoD pleine', () => {
    expect(isBlocked(parseRun(GREEN_FULL_RUN))).toBe(false)
  })

  it('true sur red même DoD pleine', () => {
    const redFull = `status: red\n\n## Besoin\n- [x] a\n`
    expect(isBlocked(parseRun(redFull))).toBe(true)
  })
})
