import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorktreeRunStateStore, type WorktreeRunRecord } from './worktree-run-state'

/**
 * LE MANIFESTE D'UNE COPIE DE TRAVAIL NE TIENT PLUS LE FIL PRINCIPAL (conv-1368, 2026-10-31).
 *
 * Mesure `gels.jsonl` sur 7 jours : `readFileSync` de `worktree-run-state.ts:267` a figé la fenêtre
 * 23 s, dont deux fois 10 s de suite sur le même `run-4fa7b0c653ab-1.json` (30/10, 14:09:18 et
 * 14:09:28 UTC) : `finalizeRecoveredAsync` le lisait, puis `persist` le relisait aussitôt.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : `getAsync` qui repasse par une lecture bloquante, ou un manifeste
 * que `persist` relit alors que ce processus vient de le lire ou de l'écrire.
 */
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    readFileSync: vi.fn(real.readFileSync),
    existsSync: vi.fn(real.existsSync)
  }
})

const lectureBloquante = vi.mocked(fs.readFileSync)
const existenceBloquante = vi.mocked(fs.existsSync)

const SHA = 'a'.repeat(40)
const manifeste = (racine: string, runId: string): WorktreeRunRecord => ({
  version: 1,
  repoId: 'depot-test',
  runId,
  agentName: 'agent',
  worktreePath: join(racine, `agent__${runId}`),
  baseBranch: 'main',
  baseSha: SHA,
  verdict: 'green',
  publication: 'blocked',
  files: [],
  attentionReason: 'merge-failed',
  createdAtMs: 1,
  updatedAtMs: 2
})

let racine = ''
let store: WorktreeRunStateStore
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'wt-sans-gel-'))
  store = new WorktreeRunStateStore(racine, 'depot-test')
  lectureBloquante.mockClear()
  existenceBloquante.mockClear()
})
afterEach(() => {
  rmSync(racine, { recursive: true, force: true })
})

describe('getAsync — la lecture du manifeste hors du fil principal', () => {
  it('relit le manifeste, à froid, sans un seul appel bloquant', async () => {
    store.save(manifeste(racine, 'run-a'))
    const froid = new WorktreeRunStateStore(racine, 'depot-test')
    lectureBloquante.mockClear()
    existenceBloquante.mockClear()

    const lu = await froid.getAsync('run-a')

    expect(lu?.runId).toBe('run-a')
    expect(lectureBloquante).not.toHaveBeenCalled()
    expect(existenceBloquante).not.toHaveBeenCalled()
  })

  it('rend la même chose que `get` : absent, copie de secours, illisible, étranger', async () => {
    expect(await store.getAsync('run-absent')).toBeUndefined()

    store.save(manifeste(racine, 'run-b'))
    const chemin = store.pathFor('run-b')
    const contenu = fs.readFileSync(chemin, 'utf8')
    rmSync(chemin)
    writeFileSync(`${chemin}.bak`, contenu, 'utf8')
    expect((await store.getAsync('run-b'))?.verdict).toBe('green')

    writeFileSync(`${chemin}.bak`, '{ pas du json', 'utf8')
    expect(await store.getAsync('run-b')).toEqual({
      ...store.get('run-b')!,
      createdAtMs: expect.any(Number),
      updatedAtMs: expect.any(Number)
    })
    expect((await store.getAsync('run-b'))?.attentionReason).toBe('state-unreadable')

    const etranger = new WorktreeRunStateStore(racine, 'autre-depot')
    store.save(manifeste(racine, 'run-c'))
    expect((await etranger.getAsync('run-c'))?.attentionReason).toBe('state-unreadable')
  })

  it('refuse un identifiant dangereux, comme `get`', async () => {
    await expect(store.getAsync('../echappe')).rejects.toThrow(/runId invalide/)
  })
})

describe('dernierConnu — la relecture que `persist` n’a plus à payer', () => {
  it('ne relit pas le disque juste après un `save`', () => {
    store.save(manifeste(racine, 'run-a'))
    lectureBloquante.mockClear()

    expect(store.dernierConnu('run-a')?.runId).toBe('run-a')

    expect(lectureBloquante).not.toHaveBeenCalled()
  })

  it('ne relit pas le disque juste après un `getAsync` : la double lecture du gel mesuré', async () => {
    store.save(manifeste(racine, 'run-a'))
    const froid = new WorktreeRunStateStore(racine, 'depot-test')
    await froid.getAsync('run-a')
    lectureBloquante.mockClear()

    expect(froid.dernierConnu('run-a')?.runId).toBe('run-a')

    expect(lectureBloquante).not.toHaveBeenCalled()
  })

  it('lit le disque quand ce processus ne connaît pas encore ce manifeste', () => {
    store.save(manifeste(racine, 'run-a'))
    const froid = new WorktreeRunStateStore(racine, 'depot-test')
    lectureBloquante.mockClear()

    expect(froid.dernierConnu('run-a')?.runId).toBe('run-a')

    expect(lectureBloquante).toHaveBeenCalledTimes(1)
  })

  it('oublie un manifeste retiré : un run supprimé ne ressuscite pas', () => {
    store.save(manifeste(racine, 'run-a'))
    store.remove('run-a')
    expect(store.dernierConnu('run-a')).toBeUndefined()
  })

  it('`get` reste la vérité du disque : un manifeste abîmé reste signalé', () => {
    store.save(manifeste(racine, 'run-a'))
    writeFileSync(store.pathFor('run-a'), '{ pas du json', 'utf8')
    expect(store.get('run-a')?.attentionReason).toBe('state-unreadable')
  })
})
