import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { autowinAppDataRoot, configureAutowinAppDataBase } from './app-data'
import { AppCommandBus } from './commands'
import { refusReservationEdition } from './reservation-fichiers-app'

/*
 * LE `git commit` LANCÉ PAR LA COMMANDE `run` DE L'APP CONSULTE LA RÉSERVATION (conv-1083,
 * objection du contrôle final du 2026-10-22).
 *
 * Avant : seul le hook des agents Claude (avant chaque commande) refusait un commit qui emporterait
 * le fichier d'un autre fil. La commande `run`, servie à TOUT modèle IA et qui applique « les mêmes
 * gardes que le hook du CLI », passait à côté : un `git commit -am` y emportait le travail non
 * commité d'un autre fil sous un autre nom.
 *
 * Entrée qui ferait échouer ce banc si la correction était fausse : conv-A tient `x.ts` (réservé,
 * modifié, non commité) ; conv-B lance `git commit -am wip` dans ce dépôt → refus qui nomme conv-A,
 * et rien n'est lancé. Jumeaux acceptés à la même borne : conv-B qui ne commite que ses chemins
 * (`-- y.ts`), conv-A elle-même, et conv-B une fois `x.ts` commité.
 */
const dossiers: string[] = []
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

function banc() {
  const racine = mkdtempSync(join(tmpdir(), 'run-reservation-'))
  dossiers.push(racine)
  configureAutowinAppDataBase(join(racine, 'appdata'))
  mkdirSync(autowinAppDataRoot(), { recursive: true })
  // Nom LONG, comme celui que rend `git rev-parse --show-toplevel` : le dossier temporaire de
  // Windows est en nom court (forme 8.3, `NOMLON~1`, mesuré le 2026-10-22), et la règle compare les
  // chemins tels quels (même parade que reservation-fichiers.hook.test.ts).
  const depot = realpathSync.native(mkdtempSync(join(racine, 'depot-')))
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: depot,
      encoding: 'utf8'
    })
  git('init', '-q')
  const x = join(depot, 'x.ts')
  writeFileSync(x, 'const a = 1\n', 'utf8')
  writeFileSync(join(depot, 'y.ts'), 'const b = 1\n', 'utf8')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  // conv-A modifie x.ts : sa réservation passe par LE registre de l'app (même que `edit_file`).
  writeFileSync(x, 'const a = 2\n', 'utf8')
  expect(refusReservationEdition('conv-A', x)).toBeUndefined()

  const lances: string[] = []
  const os = {
    executionWorkspace: depot,
    conversations: {
      get: () => ({
        id: 'conv',
        messages: [{ role: 'user', content: 'Autorise les commandes git' }]
      }),
      list: () => [],
      attachRun: () => undefined
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
  const bus = new AppCommandBus(os as never, () => {})
  // Le lancement est intercepté : ce banc juge la DÉCISION, le commit réel est fait par `git`.
  ;(bus as unknown as { spawnVerify: unknown }).spawnVerify = async (argv: string[]) => {
    lances.push(argv.join(' '))
    return { allowed: true, output: 'ok', exitCode: 0 }
  }
  const lancer = async (fil: string, commande: string): Promise<string> => {
    const r = (await bus.exec('run', { commande }, fil)) as { detail?: unknown }
    return typeof r?.detail === 'string' ? r.detail : JSON.stringify(r)
  }
  return { depot, git, lances, lancer }
}

describe('run — un git commit consulte la réservation des fichiers entre fils', () => {
  it('conv-B : `git commit -am` emporterait x.ts de conv-A → refusé, conv-A nommée, rien lancé', async () => {
    const { lances, lancer } = banc()
    const r = await lancer('conv-B', 'git commit -am wip')
    expect(r).toMatch(/refusée/i)
    expect(r).toContain('conv-A')
    expect(lances).toEqual([])
  })

  it('conv-B : `git -C <dépôt> commit -a` depuis le dépôt → refusé aussi', async () => {
    const { depot, lances, lancer } = banc()
    const r = await lancer('conv-B', `git -C ${depot.replace(/\\/g, '/')} commit -a -m wip`)
    expect(r).toContain('conv-A')
    expect(lances).toEqual([])
  })

  it('jumeau accepté : conv-B ne commite que ses chemins (`-- y.ts`)', async () => {
    const { lances, lancer } = banc()
    const r = await lancer('conv-B', 'git commit -m wip -- y.ts')
    expect(r).not.toMatch(/refusée/i)
    expect(lances).toEqual(['git commit -m wip -- y.ts'])
  })

  it('jumeau accepté : conv-A, propriétaire, commite son fichier', async () => {
    const { lances, lancer } = banc()
    expect(await lancer('conv-A', 'git commit -am wip')).not.toMatch(/refusée/i)
    expect(lances).toEqual(['git commit -am wip'])
  })

  it('jumeau accepté : une fois x.ts commité, conv-B peut balayer', async () => {
    const { git, lances, lancer } = banc()
    git('commit', '-q', '-am', 'travail de conv-A')
    expect(await lancer('conv-B', 'git commit -am wip')).not.toMatch(/refusée/i)
    expect(lances).toEqual(['git commit -am wip'])
  })
})
