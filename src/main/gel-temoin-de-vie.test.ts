import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { demarrerDetecteurDeGel } from './gel-main'
import { resumerGels } from '../shared/gel-detector'
import type { Gel } from '../shared/gel-detector'

/*
 * DEFAUT VECU le 2026-09-05 (conv-303) : apres un redemarrage, `gels.jsonl` n'ecrit plus rien
 * pendant que l'application est sollicitee. « Plus aucun blocage » et « la mesure est morte »
 * produisent EXACTEMENT le meme journal vide : la preuve etait indecidable. Une ligne de vie posee
 * a chaque demarrage tranche.
 */
describe('temoin de vie du detecteur de gels', () => {
  it('pose une ligne de demarrage AVANT tout gel, par le meme chemin d’ecriture', () => {
    const captures: Gel[] = []
    const arreter = demarrerDetecteurDeGel(
      mkdtempSync(join(tmpdir(), 'gel-vie-')),
      20,
      (g) => captures.push(g),
      30
    )
    arreter()
    expect(captures[0]?.temoin).toBe('demarrage')
    expect(captures[0]?.operation).toBe('detecteur:demarre')
    expect(captures[0]?.blocageMs).toBe(0)
  })

  it('le temoin n’est PAS compte comme un gel, ni comme une ligne illisible', () => {
    const resume = resumerGels([
      JSON.stringify({
        ts: '2026-09-05T20:00:00.000Z',
        blocageMs: 0,
        operation: 'detecteur:demarre',
        temoin: 'demarrage'
      }),
      JSON.stringify({ ts: '2026-09-05T20:00:05.000Z', blocageMs: 1200, operation: 'inconnu' })
    ])
    expect(resume.demarrages).toBe(1)
    expect(resume.gels).toBe(1)
    expect(resume.lignesIllisibles).toBe(0)
  })

  it('CAS LIMITE — journal SANS aucun demarrage : le silence reste suspect, pas rassurant', () => {
    const resume = resumerGels([])
    expect(resume.demarrages).toBe(0)
    expect(resume.gels).toBe(0)
  })

  it('CAS LIMITE — une vraie ligne corrompue reste comptee comme illisible', () => {
    const resume = resumerGels(['{ ceci n est pas du json'])
    expect(resume.lignesIllisibles).toBe(1)
    expect(resume.demarrages).toBe(0)
  })
})
