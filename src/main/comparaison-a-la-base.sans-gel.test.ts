import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from './fs-supprimer'
import { ouvrirCopieDeBase } from './comparaison-a-la-base'

/**
 * GEL MESURÉ (/gel conv-1118, 2026-10-23, `gels.jsonl`) : 320 s de fenêtre figée en 5 gels du 21 au
 * 23/10, pire 153,8 s, encore 35 s le 23/10 à 09:45 UTC (866 `unlinkSync` d'un bloc). Les fichiers
 * lents étaient tous sur C:, dans `%TEMP%\aw-base-*` : la copie propre du dépôt (~3 970 fichiers)
 * que chaque publication de tour ouvre, puis efface par `fermer()` avec `supprimerArbre`, SYNCHRONE.
 * Rejoué sur ce dépôt, disque sain : 3 919 ms de boucle tenue d'un seul bloc pendant `fermer()`.
 *
 * Ce test rejoue `fermer()` sur une vraie copie (git worktree) d'un dépôt de 4 000 fichiers, avec
 * un battement `setImmediate` : il mesure le plus long silence de la boucle pendant la fermeture.
 */
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    unlinkSync: vi.fn(original.unlinkSync),
    rmdirSync: vi.fn(original.rmdirSync)
  }
})

const FICHIERS = 4000
/** Plafond du plus long silence de la boucle : la forme synchrone en tient trois fois plus. */
const SILENCE_MAX_MS = 100

const aNettoyer: string[] = []
afterEach(() => {
  for (const dossier of aNettoyer.splice(0)) supprimerArbre(dossier)
})

function git(depot: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'core.autocrlf=false',
      ...args
    ],
    { cwd: depot, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  )
}

/** Dépôt de FICHIERS fichiers commités, plus un `node_modules` non suivi (relié par jonction). */
function depotVolumineux(): { depot: string; modules: string } {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'aw-sans-gel-base-')))
  aNettoyer.push(parent)
  const depot = join(parent, 'depot')
  for (let i = 0; i < FICHIERS; i += 1) {
    const dossier = join(depot, `d${i % 40}`, `s${i % 7}`)
    mkdirSync(dossier, { recursive: true })
    writeFileSync(join(dossier, `f${i}.txt`), `fichier ${i}\n`)
  }
  writeFileSync(join(depot, '.gitignore'), 'node_modules\n')
  const modules = join(depot, 'node_modules', 'paquet')
  mkdirSync(modules, { recursive: true })
  writeFileSync(join(modules, 'index.js'), 'module.exports = 1\n')
  git(depot, 'init', '-q')
  git(depot, 'add', '-A')
  git(depot, 'commit', '-q', '-m', 'base')
  return { depot, modules }
}

/** Battement de la boucle : rend le plus long silence observé et le nombre de tours. */
function battement(): { arreter: () => { silenceMaxMs: number; tours: number } } {
  let actif = true
  let dernier = performance.now()
  let silenceMaxMs = 0
  let tours = 0
  const tic = (): void => {
    if (!actif) return
    const maintenant = performance.now()
    silenceMaxMs = Math.max(silenceMaxMs, maintenant - dernier)
    dernier = maintenant
    tours += 1
    setImmediate(tic)
  }
  setImmediate(tic)
  return {
    arreter: () => {
      actif = false
      return { silenceMaxMs, tours }
    }
  }
}

describe('ouvrirCopieDeBase — fermer() ne tient pas la boucle', () => {
  it(`retire une copie de ${FICHIERS} fichiers sans silence de boucle > ${SILENCE_MAX_MS} ms`, async () => {
    const { depot, modules } = depotVolumineux()
    const copie = await ouvrirCopieDeBase(depot)
    expect(readdirSync(join(copie.chemin, 'd0')).length).toBeGreaterThan(0)

    vi.mocked(fs.unlinkSync).mockClear()
    vi.mocked(fs.rmdirSync).mockClear()
    const mesure = battement()
    await copie.fermer()
    const { silenceMaxMs, tours } = mesure.arreter()

    // La copie est partie, et la cible de la jonction des modules est intacte.
    expect(existsSync(copie.chemin)).toBe(false)
    expect(existsSync(join(modules, 'index.js'))).toBe(true)
    expect(git(depot, 'worktree', 'list')).not.toContain(basename(join(copie.chemin, '..')))

    // La mesure elle-même. Le battement a bien tourné (sinon un silence nul ne prouverait rien),
    // et la boucle n'est jamais restée muette longtemps : 300 ms d'un bloc avec la forme synchrone
    // sur ce poste (4 000 fichiers, disque sain), 3 à 4 ms avec la forme asynchrone.
    expect(tours, `${tours} tours de boucle`).toBeGreaterThan(FICHIERS)
    expect(silenceMaxMs, `plus long silence : ${Math.round(silenceMaxMs)} ms`).toBeLessThan(
      SILENCE_MAX_MS
    )

    // Aucun retrait synchrone dans la copie : seul le lien des modules (un appel) l'est.
    const retraitsSynchrones = [
      ...vi.mocked(fs.unlinkSync).mock.calls,
      ...vi.mocked(fs.rmdirSync).mock.calls
    ]
      .map(([chemin]) => String(chemin))
      .filter((chemin) => basename(chemin) !== 'node_modules')
    expect(retraitsSynchrones.length, `ex. ${retraitsSynchrones.slice(0, 2).join(' · ')}`).toBe(0)
  }, 120_000)
})
