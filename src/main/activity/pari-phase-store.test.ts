import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PariPhaseStore } from './pari-phase-store'

const store = (): PariPhaseStore =>
  new PariPhaseStore(join(mkdtempSync(join(tmpdir(), 'autowin-paris-')), 'paris-v1.jsonl'))

const pari = {
  runId: 'run-1',
  phase: 'build',
  confiance: 0.8,
  refutateur: 'le juge trouve un défaut de correction',
  emisA: '2026-08-21T10:00:00.000Z'
}

describe('journal des paris de phase', () => {
  it('écrit puis relit un pari à l’identique', () => {
    const s = store()
    expect(s.deposer(pari)).toBe(true)
    expect(s.lire()).toEqual([pari])
  })

  it('REFUSE de réécrire le pari d’une phase déjà pariée — un pari ne se révise pas après coup', () => {
    const s = store()
    s.deposer(pari)
    expect(s.deposer({ ...pari, confiance: 0.1 })).toBe(false)
    expect(s.lire()).toEqual([pari])
  })

  it('distingue la même phase dans deux runs différents', () => {
    const s = store()
    s.deposer(pari)
    expect(s.deposer({ ...pari, runId: 'run-2' })).toBe(true)
    expect(s.lire()).toHaveLength(2)
  })

  it('refuse un pari sans réfutateur : un chiffre sans condition de démenti n’est qu’une humeur', () => {
    const s = store()
    expect(() => s.deposer({ ...pari, refutateur: '   ' })).toThrow(/réfutateur/i)
    expect(s.lire()).toEqual([])
  })

  it('refuse une confiance hors [0,1]', () => {
    const s = store()
    expect(() => s.deposer({ ...pari, confiance: 1.4 })).toThrow(/confiance/i)
  })

  it('IGNORE une ligne illisible au lieu de perdre tout l’historique de mesure', () => {
    const s = store()
    s.deposer(pari)
    writeFileSync(s.chemin, `${readFileSync(s.chemin, 'utf8')}{ceci n'est pas du json\n`, 'utf8')
    s.deposer({ ...pari, phase: 'clean' })
    expect(s.lire().map((p) => p.phase)).toEqual(['build', 'clean'])
    expect(s.lignesIllisibles()).toBe(1)
  })

  it('sur un journal absent, rend une liste vide sans jeter', () => {
    expect(store().lire()).toEqual([])
  })
})

describe('arbitrage inscrit au journal', () => {
  it('inscrit le verdict à côté des paris du run, et le relit', () => {
    const s = store()
    s.deposer(pari)
    s.deposer({ ...pari, phase: 'clean' })
    expect(s.arbitrer('run-1', true)).toBe(true)
    expect(s.lireIssues()).toEqual([
      { runId: 'run-1', phase: 'build', reussie: true, jugee: true },
      { runId: 'run-1', phase: 'clean', reussie: true, jugee: true }
    ])
  })

  it('n’altère PAS la liste des paris : un arbitrage n’est pas un pari', () => {
    const s = store()
    s.deposer(pari)
    s.arbitrer('run-1', false)
    expect(s.lire()).toEqual([pari])
  })

  it('REFUSE de réviser un arbitrage déjà inscrit', () => {
    const s = store()
    s.deposer(pari)
    s.arbitrer('run-1', true)
    expect(s.arbitrer('run-1', false)).toBe(false)
    expect(s.lireIssues()[0]?.reussie).toBe(true)
  })

  it('n’inscrit rien pour un run qui n’a jamais parié', () => {
    const s = store()
    expect(s.arbitrer('run-inconnu', true)).toBe(false)
    expect(s.lireIssues()).toEqual([])
  })
})
