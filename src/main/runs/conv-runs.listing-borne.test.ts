import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ce que ce test attrape et qu'un test de RENDU ne peut PAS attraper.
 *
 * `listConvRuns` rendait déjà la bonne liste avant ce correctif : il scannait l'arbre ENTIER puis
 * filtrait par conversation. La sortie était juste, le COÛT ne l'était pas — 11 784 fichiers lus
 * et parsés pour en afficher quelques dizaines (mesuré le 2026-08-18 sur la racine dev, ~15 s à
 * froid). Le défaut n'est donc observable que sur le NOMBRE DE LECTURES, pas sur le résultat.
 */
const lectures = vi.hoisted(() => ({ readFile: 0 }))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    default: actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      lectures.readFile += 1
      return actual.readFile(...args)
    }
  }
})

const { CONV_RUNS_READ_LIMIT, listConvRuns } = await import('./conv-runs')

let root: string

/** N conversations × M workspaces : l'arborescence synthétique que le listage doit NE PAS lire. */
function arborescence(conversations: number, runsParConv: number): void {
  for (let c = 0; c < conversations; c++) {
    for (let r = 0; r < runsParConv; r++) {
      const ws = join(root, `conv-${c}`, `sujet-${r}-workspace`)
      mkdirSync(ws, { recursive: true })
      writeFileSync(join(ws, 'RUN.md'), `status: green\n\n## Besoin\n- [x] fait ${c}/${r}\n`)
    }
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'autowin-conv-borne-'))
  lectures.readFile = 0
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listConvRuns — le listage est BORNÉ', () => {
  it('ne lit pas les RUN.md des autres conversations', async () => {
    arborescence(20, 10) // 200 RUN.md au total, 10 dans la conversation demandée

    const runs = await listConvRuns('conv-3', [], root)

    expect(runs).toHaveLength(10)
    // AVANT le correctif : 200 lectures (tout l'arbre). APRÈS : 10, celles de la conversation.
    expect(lectures.readFile).toBe(10)
    expect(lectures.readFile).toBeLessThan(20)
  })

  it('borne les lectures au plafond PAR CONVERSATION quand elle est énorme', async () => {
    arborescence(2, CONV_RUNS_READ_LIMIT + 40)

    const runs = await listConvRuns('conv-0', [], root)

    expect(runs).toHaveLength(CONV_RUNS_READ_LIMIT)
    expect(lectures.readFile).toBe(CONV_RUNS_READ_LIMIT)
  })

  it('journalise la troncature au lieu de la taire', async () => {
    arborescence(1, CONV_RUNS_READ_LIMIT + 7)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await listConvRuns('conv-0', [], root)

    expect(warn).toHaveBeenCalledWith('[conv-runs]', 'conv-0', expect.stringContaining('7 plus anciens non lus'))
    warn.mockRestore()
  })
})
