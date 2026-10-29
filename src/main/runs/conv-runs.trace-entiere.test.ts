import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createConvRun, loadConvRunTrace, saveConvRunTrace } from './conv-runs'

/**
 * PLAFOND MUET n°3 (conv-1228, 2026-10-28) : le fil des sous-agents d'un run (`trace.json`) gardait
 * 4 000 caractères par étape, suivis d'un simple « … ». En direct on lisait la sortie entière ; après
 * un rechargement ou une reprise, la même étape était amputée — et la reprise réécrivait la version
 * coupée. Même défaut que le raisonnement : le texte rétrécissait sous les yeux de l'utilisateur.
 */
const root = mkdtempSync(join(tmpdir(), 'aos-trace-entiere-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('le fil des sous-agents d’un run se relit entier', () => {
  it('une sortie de plusieurs milliers de caractères revient intacte', () => {
    const run = createConvRun('conv-1228', 'trace longue', root, () => 1)
    const sortie = `## Cadrage\n${'Une ligne de cadrage utile. '.repeat(600)}\n## Confiance\nvérifié`
    expect(sortie.length).toBeGreaterThan(4_000)
    saveConvRunTrace(run, [{ step: 'exec', text: sortie }])
    expect(loadConvRunTrace(run)?.[0].text).toBe(sortie)
  })

  it('une sortie démesurée est bornée EN LE DISANT', () => {
    const run = createConvRun('conv-1228', 'trace démesurée', root, () => 2)
    const enorme = `debut ${'x'.repeat(500_000)}`
    saveConvRunTrace(run, [{ step: 'exec', text: enorme }])
    const relu = loadConvRunTrace(run)?.[0].text ?? ''
    expect(relu.startsWith('debut ')).toBe(true)
    expect(relu.length).toBeLessThan(enorme.length)
    expect(relu).toMatch(/caractères coupés/)
  })
})
