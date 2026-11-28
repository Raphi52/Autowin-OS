import * as fs from 'node:fs'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { nettoyerRacines, racineDe, roots } from './worktree-manager.test-helpers'

/**
 * LE BAIL D'UN CLI QUI DÉMARRE NE TIENT PLUS LE FIL PRINCIPAL.
 *
 * Mesure `gels.jsonl` du 21 au 28/11/2026 (`node scripts/gels-classement.mjs --jours 7 --json
 * --top 200`) : `writeFileSync` de `confirmSpawn` (`worktree-manager-copies.ts`), appelé par
 * `RunWorktreeCoordinator.spawned`, a figé la fenêtre 16 fois, 26,7 s en tout, jusqu'à 3,2 s d'un
 * coup : le fichier tout juste renommé met des secondes à se laisser réécrire.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER :
 *  - `writeFileSync` remis dans `confirmSpawn` → le premier test voit l'écriture bloquante ;
 *  - un complément écrit en fond qui CRÉE le fichier (`writeFile` en `w`, `deposerFichier`) → le
 *    second test voit renaître le bail d'un CLI déjà fini ;
 *  - le renommage reporté lui aussi → le premier test trouve encore l'intention sur le disque.
 */
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    writeFileSync: vi.fn(real.writeFileSync),
    appendFileSync: vi.fn(real.appendFileSync),
    openSync: vi.fn(real.openSync)
  }
})
// Toute écriture qui tient le fil, même cachée dans une fonction « async » de façade.
const ecrituresBloquantes = [
  vi.mocked(fs.writeFileSync),
  vi.mocked(fs.appendFileSync),
  vi.mocked(fs.openSync)
]

const AGENT = 'run-bail'
let racine = ''
let wm: WorktreeManager
const dossierDesBaux = (): string => join(racine, '.leases', AGENT)
const bail = (): string => join(dossierDesBaux(), String(process.pid))
const ecrituresBloquantesDuBail = (): unknown[] =>
  ecrituresBloquantes.flatMap((espion) =>
    espion.mock.calls.filter(([chemin]) => String(chemin) === bail())
  )

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'autowin-bail-'))
  roots.push(racine)
  wm = new WorktreeManager({
    racineCopiesDeTaches: racineDe(racine),
    baseRepo: racine,
    worktreeRoot: racine,
    processIdentityFn: (pid) => `empreinte-${pid}`
  })
  for (const espion of ecrituresBloquantes) espion.mockClear()
})
afterEach(async () => {
  await wm.attendreBauxEnCours()
  nettoyerRacines()
})

describe('confirmSpawn — le bail se complète hors du fil principal', () => {
  it('renomme l’intention tout de suite, puis complète le bail sans writeFileSync', async () => {
    wm.markSpawnIntent(AGENT, 'essai', true)
    for (const espion of ecrituresBloquantes) espion.mockClear()

    wm.confirmSpawn(AGENT, 'essai', process.pid)

    // Le transfert reste synchrone : aucune fenêtre sans bail, l'intention n'existe plus.
    expect(existsSync(join(dossierDesBaux(), 'spawn-pending-essai'))).toBe(false)
    expect(existsSync(bail())).toBe(true)
    expect(wm.hasActiveProcesses(AGENT)).toBe(true)
    expect(ecrituresBloquantesDuBail()).toEqual([])

    await wm.attendreBauxEnCours()
    expect(JSON.parse(readFileSync(bail(), 'utf8'))).toMatchObject({
      identity: `empreinte-${process.pid}`
    })
    expect(ecrituresBloquantesDuBail()).toEqual([])
  })

  it('un bail rendu avant la fin du complément ne renaît pas', async () => {
    // Un membre voisin du même run démarre encore : le dossier des baux survit au retrait.
    wm.markSpawnIntent(AGENT, 'voisin', true)
    wm.markSpawnIntent(AGENT, 'essai', true)
    wm.confirmSpawn(AGENT, 'essai', process.pid)
    // Le CLI finit dans le même tour de boucle : sa sortie retire le bail.
    wm.markProcess(AGENT, process.pid, false)

    await wm.attendreBauxEnCours()

    expect(existsSync(bail())).toBe(false)
    wm.markSpawnIntent(AGENT, 'voisin', false)
    expect(wm.hasActiveProcesses(AGENT)).toBe(false)
  })
})
