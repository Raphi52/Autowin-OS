import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureAutowinAppDataBase, autowinAppDataRoot } from './app-data'
import { AppCommandBus } from './commands'
import { confReservationFichiers } from './providers/claude'
import { reserverOuRefuser } from '../shared/reservation-fichiers'

/*
 * LA COMMANDE `edit_file` DE L'APP CONSULTE LA RÉSERVATION DES FICHIERS (conv-1083, objection du
 * contrôle final du 2026-10-22).
 *
 * Avant : seul le hook des agents Claude (avant chaque Edit/Write) réservait et refusait. `edit_file`
 * — la commande de l'app, servie à tout modèle IA — écrivait sans regarder le registre.
 *
 * Entrée qui ferait échouer ce banc si le branchement était faux : conv-A a réservé `x.ts` (par
 * son hook, même registre), le fichier est modifié et non commité, puis conv-B lance `edit_file`
 * dessus → refus qui nomme conv-A, fichier intact. Jumeaux acceptés à la même borne : conv-A
 * elle-même, et conv-B une fois le fichier commité.
 *
 * Cible dans un AUTRE dépôt (voie directe, sans copie isolée) : la garde est posée AVANT la
 * bifurcation dépôt d'Autowin / autre dépôt, donc les deux voies la traversent.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- double minimal d'AutowinOS, comme dans edit-file-autre-depot.test.ts
function osMinimal(executionWorkspace: string): any {
  return {
    executionWorkspace,
    worktrees: {
      begin: vi.fn(() => undefined),
      end: vi.fn(() => ({ outcome: 'merged', agentId: 'command', committed: true }))
    },
    conversations: { get: () => undefined, list: () => [] },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
}

const dossiers: string[] = []
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

function banc() {
  const racine = mkdtempSync(join(tmpdir(), 'edit-file-reservation-'))
  dossiers.push(racine)
  configureAutowinAppDataBase(join(racine, 'appdata'))
  mkdirSync(autowinAppDataRoot(), { recursive: true })
  const autowin = mkdtempSync(join(racine, 'aos-'))
  const depot = mkdtempSync(join(racine, 'depot-'))
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: depot,
      encoding: 'utf8'
    })
  git('init', '-q')
  const x = join(depot, 'x.ts')
  writeFileSync(x, 'const a = 1\n', 'utf8')
  git('add', 'x.ts')
  git('commit', '-q', '-m', 'x')
  // conv-A modifie x.ts (son hook l'a réservé dans LE registre de l'app, celui du lancement).
  writeFileSync(x, 'const a = 2\n', 'utf8')
  const conf = confReservationFichiers({ conversationId: 'conv-A' }, autowinAppDataRoot())!
  expect(
    reserverOuRefuser(
      {
        lire: (p) => {
          try {
            return readFileSync(p, 'utf8')
          } catch {
            return undefined
          }
        },
        ecrire: (p, t) => writeFileSync(p, t, 'utf8'),
        estPropre: () => false
      },
      conf,
      x,
      Date.now(),
      process.platform === 'win32'
    )
  ).toBeUndefined()
  const bus = new AppCommandBus(osMinimal(autowin), () => {})
  const editer = (fil: string) =>
    bus.exec('edit_file', { path: x, oldText: 'const a = 2', newText: 'const a = 3' }, fil)
  return { x, git, editer }
}

describe('edit_file — réservation des fichiers entre fils', () => {
  it('conv-B est refusée sur le fichier que conv-A tient, et le refus nomme conv-A', async () => {
    const { x, editer } = banc()
    const resultat = await editer('conv-B')
    expect(resultat).toMatchObject({ ok: true, data: { allowed: false } })
    expect(String((resultat.data as { reason?: string }).reason)).toContain('conv-A')
    expect(readFileSync(x, 'utf8')).toBe('const a = 2\n')
  })

  it('jumeau accepté : conv-A, propriétaire, édite son fichier', async () => {
    const { x, editer } = banc()
    expect(await editer('conv-A')).toMatchObject({ ok: true, data: { allowed: true } })
    expect(readFileSync(x, 'utf8')).toBe('const a = 3\n')
  })

  it('jumeau accepté : une fois le fichier commité, conv-B le reprend', async () => {
    const { x, git, editer } = banc()
    git('commit', '-q', '-am', 'travail de conv-A')
    expect(await editer('conv-B')).toMatchObject({ ok: true, data: { allowed: true } })
    expect(readFileSync(x, 'utf8')).toBe('const a = 3\n')
  })
})
