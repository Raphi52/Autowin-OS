import { mkdirSync, mkdtempSync, rmSync, existsSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Les trois ménages de démarrage tournent désormais APRÈS l'affichage de la fenêtre, en lectures non
 * bloquantes (conv-359) : entre l'inventaire et la suppression, l'app vit — une conversation rouverte
 * réécrit sa trace, un run repris réécrit son journal ou son RUN.md. Chaque ménage relit donc le
 * fichier juste avant de le supprimer. Ces tests jouent exactement ce moment : la DEUXIÈME lecture
 * d'un fichier (la relecture) déclenche d'abord une écriture concurrente.
 */
const concurrent = vi.hoisted(() => ({
  chemin: '',
  ecrire: undefined as undefined | ((chemin: string) => void),
  lectures: new Map<string, number>()
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...vrai,
    stat: async (chemin: Parameters<typeof vrai.stat>[0]) => {
      const cle = String(chemin)
      const n = (concurrent.lectures.get(cle) ?? 0) + 1
      concurrent.lectures.set(cle, n)
      if (n === 2 && cle === concurrent.chemin) concurrent.ecrire?.(cle)
      return vrai.stat(chemin)
    }
  }
})

const { collectCausalTraces } = await import('./causal-trace-gc')
const { collectStdoutJournals, DEFAULT_MAX_AGE_MS } = await import('../runs/journal-gc')
const { collectRunWorkspaces } = await import('../runs/workspace-gc')

const JOUR = 24 * 60 * 60 * 1000
let racine = ''

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'menages-relecture-'))
  concurrent.chemin = ''
  concurrent.ecrire = undefined
  concurrent.lectures.clear()
})
afterEach(() => rmSync(racine, { recursive: true, force: true }))

function vieillir(chemin: string, ageMs: number): void {
  const t = new Date(Date.now() - ageMs)
  utimesSync(chemin, t, t)
}

describe('relecture avant suppression', () => {
  it('une trace causale qui se remet à écrire pendant la passe est épargnée', async () => {
    const trace = join(racine, 'conv-rouverte.jsonl')
    writeFileSync(trace, '{"ancien":1}\n')
    vieillir(trace, 30 * JOUR)
    concurrent.chemin = trace
    concurrent.ecrire = (chemin) => writeFileSync(chemin, '{"ancien":1}\n{"nouveau":2}\n')

    const bilan = await collectCausalTraces(racine)

    expect(bilan.removed).toBe(0)
    expect(existsSync(trace)).toBe(true)
  })

  it('témoin : sans écriture concurrente, la même trace part', async () => {
    const trace = join(racine, 'conv-oubliee.jsonl')
    writeFileSync(trace, '{"ancien":1}\n')
    vieillir(trace, 30 * JOUR)

    expect((await collectCausalTraces(racine)).removed).toBe(1)
    expect(existsSync(trace)).toBe(false)
  })

  it('un journal de run repris pendant la passe est épargné', async () => {
    const journal = join(racine, 'run-repris.stdout.jsonl')
    writeFileSync(journal, 'x'.repeat(100))
    vieillir(journal, DEFAULT_MAX_AGE_MS + 60_000)
    concurrent.chemin = journal
    concurrent.ecrire = (chemin) => writeFileSync(chemin, 'x'.repeat(150))

    const bilan = await collectStdoutJournals(racine)

    expect(bilan.removed).toBe(0)
    expect(existsSync(journal)).toBe(true)
  })

  it('un workspace dont le RUN.md change de statut pendant la passe est épargné', async () => {
    const dossier = join(racine, 'conv-1', 'ancien-workspace')
    mkdirSync(dossier, { recursive: true })
    const runMd = join(dossier, 'RUN.md')
    writeFileSync(runMd, 'status: green\n')
    vieillir(runMd, 60 * JOUR)
    concurrent.chemin = runMd
    concurrent.ecrire = (chemin) => writeFileSync(chemin, 'status: open\n')

    const bilan = await collectRunWorkspaces(racine, { maxPerConversation: 0 })

    expect(bilan.removed).toBe(0)
    expect(existsSync(dossier)).toBe(true)
  })

  it('témoin : sans changement, le même workspace part', async () => {
    const dossier = join(racine, 'conv-1', 'ancien-workspace')
    mkdirSync(dossier, { recursive: true })
    const runMd = join(dossier, 'RUN.md')
    writeFileSync(runMd, 'status: green\n')
    vieillir(runMd, 60 * JOUR)

    expect((await collectRunWorkspaces(racine, { maxPerConversation: 0 })).removed).toBe(1)
    expect(existsSync(dossier)).toBe(false)
  })
})
