/**
 * LE GUET DU REÇU DE SORTIE `.exit.json` NE GÈLE PLUS LA FENÊTRE.
 *
 * Mesure (`gels.jsonl`, 2026-10-10 et 2026-10-11) : 50 gels en deux jours, jusqu'à 3,1 s chacun,
 * tous en `readFileSync …stdout.jsonl.exit.json` via `survivableExitCode`, appelé par deux guets
 * périodiques du processus principal :
 *  - le guet du relais de `claude.ts` (toutes les 80 ms, par appel Claude en cours) ;
 *  - la boucle `waitForRecoverableChatProviderExit` (toutes les 250 ms, + un `statSync`).
 * Sur un disque saturé, chaque lecture synchrone tient la boucle d'événements pendant toute
 * l'attente du disque. Les deux guets doivent lire SANS aucune E/S synchrone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    readFileSync: vi.fn(real.readFileSync),
    statSync: vi.fn(real.statSync),
    openSync: vi.fn(real.openSync),
    existsSync: vi.fn(real.existsSync)
  }
})

const fs = await import('node:fs')
const { guetterSortieCertifiee } = await import('./stdout-journal')
const { waitForRecoverableChatProviderExit } = await import('./chat-provider-recovery')

const SYNCHRONES = [fs.readFileSync, fs.statSync, fs.openSync, fs.existsSync]
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let root = ''
let journal = ''
function certifierSortie(exitCode: number): void {
  writeFileSync(
    `${journal}.exit.json`,
    JSON.stringify({ type: 'autowin.survivable-exit', exit_code: exitCode }),
    'utf8'
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'guet-sortie-async-'))
  journal = join(root, 'appel.stdout.jsonl')
  writeFileSync(journal, '{"type":"assistant"}\n', 'utf8')
  for (const f of SYNCHRONES) vi.mocked(f).mockClear()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('guet du relais (claude.ts) — guetterSortieCertifiee', () => {
  it('signale la sortie certifiée UNE fois, sans aucune lecture synchrone', async () => {
    const sorties: number[] = []
    const arreter = guetterSortieCertifiee(journal, (code) => sorties.push(code), 5)
    await pause(40)
    expect(sorties).toEqual([])

    certifierSortie(3)
    await pause(60)
    arreter()

    expect(sorties).toEqual([3])
    for (const f of SYNCHRONES) expect(f).not.toHaveBeenCalled()
  })

  it("n'empile jamais deux lectures quand le disque rame", async () => {
    let lectures = 0
    let liberer!: () => void
    const lenteur = new Promise<void>((r) => (liberer = r))
    const arreter = guetterSortieCertifiee(
      journal,
      () => undefined,
      5,
      async () => {
        lectures += 1
        await lenteur
        return undefined
      }
    )
    await pause(50)
    expect(lectures).toBe(1)

    liberer()
    await pause(30)
    arreter()
    expect(lectures).toBeGreaterThan(1)
  })

  it('ne signale plus rien une fois arrêté', async () => {
    const sorties: number[] = []
    const arreter = guetterSortieCertifiee(journal, (code) => sorties.push(code), 5)
    arreter()
    certifierSortie(0)
    await pause(40)
    expect(sorties).toEqual([])
  })
})

describe('boucle de reprise — waitForRecoverableChatProviderExit', () => {
  it('rend le code certifié sans aucune E/S synchrone', async () => {
    const attente = waitForRecoverableChatProviderExit(journal, {
      signal: new AbortController().signal,
      pollMs: 5
    })
    await pause(30)
    certifierSortie(0)

    expect(await attente).toEqual({ kind: 'exit', exitCode: 0 })
    for (const f of SYNCHRONES) expect(f).not.toHaveBeenCalled()
  })
})
