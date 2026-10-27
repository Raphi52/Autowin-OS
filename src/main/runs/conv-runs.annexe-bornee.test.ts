import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createConvRun, populateConvRunSections } from './conv-runs'

const root = mkdtempSync(join(tmpdir(), 'aos-annexe-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

// conv-1150 : RUN.md de conv-1146 à 497 Mo → OOM au démarrage, l'app se fermait seule.
describe("annexe « Livrable des phases » — taille bornée", () => {
  it('une phase qui recopie un `## Reprise` ne fait pas enfler le RUN.md', () => {
    const p = createConvRun('conv-1', 'Tâche', root, () => 1000)
    const recopie = `voici le RUN.md\n## Reprise\nx\n## Checks\n${'y'.repeat(500)}`
    const sorties: { phase: string; text: string }[] = []
    const tailles: number[] = []
    for (let i = 0; i < 20; i++) {
      sorties.push({ phase: i % 2 ? 'clean' : 'build', text: recopie })
      populateConvRunSections(p, sorties.slice(-4))
      tailles.push(readFileSync(p, 'utf8').length)
    }
    // Quatre sorties à chaque passage : la taille se stabilise au lieu de croître sans fin.
    expect(tailles[19]).toBe(tailles[10])
    expect(readFileSync(p, 'utf8').match(/^## Reprise/gm)).toHaveLength(1)
  })
})
