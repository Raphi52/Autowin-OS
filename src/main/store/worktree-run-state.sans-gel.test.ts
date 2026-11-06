import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attendreFichier } from '../gel/ecriture-hors-fil'
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
    existsSync: vi.fn(real.existsSync),
    writeFileSync: vi.fn(real.writeFileSync),
    renameSync: vi.fn(real.renameSync),
    rmSync: vi.fn(real.rmSync)
  }
})

/** Les renommages hors du fil dont la DESTINATION existait déjà : le cas qui tient 20 à 28 s. */
const remplacements: string[] = []
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const { existsSync: existe } = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...real,
    default: real,
    rename: vi.fn(async (de: string, vers: string) => {
      if (existe(vers)) remplacements.push(vers)
      return real.rename(de, vers)
    })
  }
})

const lectureBloquante = vi.mocked(fs.readFileSync)
const existenceBloquante = vi.mocked(fs.existsSync)
const ecritureBloquante = vi.mocked(fs.writeFileSync)
const renommageBloquant = vi.mocked(fs.renameSync)
const suppressionBloquante = vi.mocked(fs.rmSync)
const appelsDEcritureBloquants = (): number =>
  ecritureBloquante.mock.calls.length +
  renommageBloquant.mock.calls.length +
  suppressionBloquante.mock.calls.length

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
  ecritureBloquante.mockClear()
  renommageBloquant.mockClear()
  suppressionBloquante.mockClear()
})
afterEach(async () => {
  // Une écriture encore en vol recréerait le dossier après son effacement.
  await attendreFichier()
  rmSync(racine, { recursive: true, force: true })
})

/**
 * L'ÉCRITURE DU MANIFESTE QUITTE AUSSI LE FIL PRINCIPAL (2026-11-05).
 *
 * `gels.jsonl`, matinée du 05/11 (05:00 → 09:10 UTC) : `save` a figé la fenêtre 119 s en 15 appels
 * sur `writeFileSync` (ligne du temporaire) et 55 s en 12 appels sur `rmSync` (ligne du `.bak`), pire
 * 24 s, toujours depuis `persist` (`run-worktree-coordinator.ts:2426`). Le SSD était inactif à 93 % :
 * le mur est au-dessus du disque (`scripts/trace-blocage-disque.ps1`), on ne peut que cesser de
 * l'attendre sur le fil qui dessine l'interface.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : un retour à `writeFileSync`, `renameSync` ou `rmSync` dans `save`
 * ou `remove` ; une relecture (`get`, `getAsync`, `list`) qui ne voit pas la valeur déposée et pas
 * encore posée ; un run retiré qui ressuscite.
 */
describe('save et remove — l’écriture du manifeste hors du fil principal', () => {
  it('save ne fait aucun appel bloquant, et toutes les relectures voient la valeur avant qu’elle soit posée', async () => {
    store.save(manifeste(racine, 'run-a'))

    expect(appelsDEcritureBloquants()).toBe(0)
    expect(store.get('run-a')?.verdict).toBe('green')
    expect((await store.getAsync('run-a'))?.verdict).toBe('green')
    expect(store.list().map((record) => record.runId)).toEqual(['run-a'])

    expect(await attendreFichier(store.pathFor('run-a'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(store.pathFor('run-a'), 'utf8')).runId).toBe('run-a')
    expect(appelsDEcritureBloquants()).toBe(0)
  })

  it('remove ne fait aucun appel bloquant, et le run retiré ne ressuscite ni en relecture ni sur le disque', async () => {
    store.save(manifeste(racine, 'run-a'))
    await attendreFichier()
    // Une copie de secours laissée par l'ancienne écriture (`.bak`) ne doit pas le faire revenir.
    writeFileSync(`${store.pathFor('run-a')}.bak`, fs.readFileSync(store.pathFor('run-a')))
    ecritureBloquante.mockClear()
    renommageBloquant.mockClear()
    suppressionBloquante.mockClear()

    store.remove('run-a')

    expect(appelsDEcritureBloquants()).toBe(0)
    expect(store.get('run-a')).toBeUndefined()
    expect(await store.getAsync('run-a')).toBeUndefined()
    expect(store.list()).toEqual([])
    await attendreFichier()
    expect(fs.existsSync(store.pathFor('run-a'))).toBe(false)
    expect(fs.existsSync(`${store.pathFor('run-a')}.bak`)).toBe(false)
  })

  it('ne renomme jamais par-dessus un manifeste existant : l’ancien est écarté en .bak, puis retiré', async () => {
    store.save({ ...manifeste(racine, 'run-a'), detail: 'créé' })
    await attendreFichier()
    remplacements.length = 0

    store.save({ ...manifeste(racine, 'run-a'), detail: 'mis à jour' })
    expect(await attendreFichier()).toBe(true)

    expect(remplacements).toEqual([])
    expect(JSON.parse(fs.readFileSync(store.pathFor('run-a'), 'utf8')).detail).toBe('mis à jour')
    expect(fs.existsSync(`${store.pathFor('run-a')}.bak`)).toBe(false)
  })

  it('une rafale save → remove → save pose la dernière valeur, jamais une ancienne', async () => {
    store.save({ ...manifeste(racine, 'run-a'), detail: 'premier' })
    store.remove('run-a')
    store.save({ ...manifeste(racine, 'run-a'), detail: 'dernier' })

    expect(store.get('run-a')?.detail).toBe('dernier')
    await attendreFichier()
    expect(JSON.parse(fs.readFileSync(store.pathFor('run-a'), 'utf8')).detail).toBe('dernier')
  })
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
    await attendreFichier()
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

  it('lit le disque quand ce processus ne connaît pas encore ce manifeste', async () => {
    store.save(manifeste(racine, 'run-a'))
    await attendreFichier()
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

  it('`get` reste la vérité du disque : un manifeste abîmé reste signalé', async () => {
    store.save(manifeste(racine, 'run-a'))
    await attendreFichier()
    writeFileSync(store.pathFor('run-a'), '{ pas du json', 'utf8')
    expect(store.get('run-a')?.attentionReason).toBe('state-unreadable')
  })
})
