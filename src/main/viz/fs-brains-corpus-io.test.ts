import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const observedReads = vi.hoisted(() => ({ sync: [] as string[], async: [] as string[] }))

vi.mock('./brain-file-reader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brain-file-reader')>()
  return {
    ...actual,
    readVaultNoteSync: (path: string) => {
      observedReads.sync.push(path)
      return actual.readVaultNoteSync(path)
    },
    readVaultNote: (path: string) => {
      observedReads.async.push(path)
      return actual.readVaultNote(path)
    }
  }
})

import {
  loadBrainThemes,
  loadVaultBrainGraphAsync,
  loadVaultBrainNeighborhood,
  searchVaultBrainNotesAsync
} from './fs-brains'

describe('I/O du corpus Brain', () => {
  let roots: string[] = []

  beforeEach(() => {
    roots = []
    observedReads.sync.length = 0
    observedReads.async.length = 0
  })

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  it('ne lit aucune note hors corpus à froid pour graphe, recherche, thèmes et voisinage', async () => {
    roots = Array.from({ length: 4 }, (_, index) =>
      mkdtempSync(join(tmpdir(), `autowin-os-corpus-io-${index}-`))
    )
    for (const root of roots) {
      const autowin = join(root, 'knowledge/domain/autowin-os-guide.md')
      const contoso = join(root, 'knowledge/domain/contosoapp-documentation/proc.md')
      mkdirSync(dirname(autowin), { recursive: true })
      mkdirSync(dirname(contoso), { recursive: true })
      writeFileSync(autowin, '# Guide Autowin\narchitecture autowin\n', 'utf8')
      writeFileSync(contoso, '# Procédure CONTOSO\narchitecture contoso\n', 'utf8')
    }

    const corpus = ['knowledge/domain/autowin-os-']
    await loadVaultBrainGraphAsync(roots[0], 300, corpus)
    await searchVaultBrainNotesAsync(roots[1], 'architecture', {
      corpus,
      allowedRoot: roots[1]
    })
    await loadBrainThemes(roots[2], corpus, roots[2])
    loadVaultBrainNeighborhood(roots[3], 'knowledge/domain/autowin-os-guide', corpus)

    // Les thèmes lisent en PARALLÈLE (conv-1219) : une lecture bloquante des 1931 notes du partage
    // réseau prenait 13,7 à 16,3 s et figeait le worker, l'aperçu du graphe attendant derrière.
    expect(observedReads.sync).toHaveLength(1)
    expect(observedReads.async).toHaveLength(3)
    const readsInsideFixtures = [...observedReads.sync, ...observedReads.async]
    expect(readsInsideFixtures).toHaveLength(4)
    expect(readsInsideFixtures.every((path) => path.includes('autowin-os-guide.md'))).toBe(true)
    expect(readsInsideFixtures.some((path) => path.includes('contosoapp-documentation'))).toBe(
      false
    )
  })
})
