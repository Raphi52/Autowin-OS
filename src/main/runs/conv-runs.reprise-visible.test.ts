import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createConvRun, populateConvRunSections } from './conv-runs'

const root = mkdtempSync(join(tmpdir(), 'aos-reprise-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/**
 * conv-597, 2026-09-16, turnId 4e502786-4887-4101-85b3-ea2dee304091.
 *
 * Le juge valide à 12:33:59, la clôture est autorisée, puis `salvage` rend à 12:35:13
 * « J'ai trouvé le jeu. Ma conclusion précédente était trop courte ». Le RUN.md est resté
 * `status: green` avec `## Défauts` vide : un run vert dont la conclusion avait été démentie,
 * sans trace dans le seul fichier que le panneau Workflows relit.
 */
describe('RUN.md — une reprise (salvage) est un défaut visible du run', () => {
  it('inscrit le livrable de salvage sous ## Défauts', () => {
    const chemin = createConvRun('conv-597-test', 'Corrige le module de facturation', root)
    populateConvRunSections(chemin, [
      { phase: 'judge', text: 'VALIDE\nSCORE: 84' },
      {
        phase: 'salvage',
        text: "J'ai trouvé le jeu.\nMa conclusion précédente était trop courte — je m'étais arrêté au dépôt AutoWinOS."
      }
    ])
    const md = readFileSync(chemin, 'utf8')
    const defauts = md.split('## Défauts')[1]?.split('\n## ')[0] ?? ''
    expect(defauts).toContain('Reprise (salvage)')
    expect(defauts).toContain('Ma conclusion précédente était trop courte')
    // Une ligne de Journal reste une ligne : la prose est repliée, jamais recopiée telle quelle.
    expect(defauts).not.toContain("J'ai trouvé le jeu.\nMa conclusion")
  })

  it('reste idempotent : le peuplement rejoué ne duplique pas la reprise', () => {
    const chemin = createConvRun('conv-597-idem', 'Corrige le module de facturation', root)
    const phases = [{ phase: 'salvage', text: 'Le vrai dépôt est ailleurs.' }]
    populateConvRunSections(chemin, phases)
    populateConvRunSections(chemin, phases)
    const md = readFileSync(chemin, 'utf8')
    expect(md.split('- Reprise (salvage) :').length - 1).toBe(1)
  })

  it('ne fabrique aucun défaut quand aucune reprise n’a eu lieu', () => {
    const chemin = createConvRun('conv-597-vierge', 'Corrige le module de facturation', root)
    populateConvRunSections(chemin, [{ phase: 'build', text: 'Corrigé, tests verts.' }])
    const md = readFileSync(chemin, 'utf8')
    expect(md).not.toContain('Reprise (salvage)')
  })
})
