import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * L'ECHEC SILENCIEUX DE `balayerLeChemin`.
 *
 * Mesure conv-1483 : 10 copies residuelles, ~413 Mo. Le balayage tente `worktree remove` SANS
 * `--force` ; s'il echoue et que la copie est encore ENREGISTREE, la fonction rend `false` sans
 * rien tenter d'autre et sans laisser aucune trace. Le residu revient a chaque demarrage, invisible.
 *
 * Ce que la correction doit faire : escalader (remove --force, puis retrait direct du dossier) et,
 * si tout echoue, COMPTER l'echec par chemin et le remonter dans l'etat.
 */

afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* verrou Windows */
    }
  }
})

type AccesPrive = { balayerLeChemin(path: string): boolean }

function prive(wm: WorktreeManager): AccesPrive {
  return wm as unknown as AccesPrive
}

type Appel = { args: string[] }

function manager(opts: {
  repo: string
  racine: string
  chemin: string
  forceReussit: boolean
  disqueReussit: boolean
  appels: Appel[]
}): WorktreeManager {
  return new WorktreeManager({
    baseRepo: opts.repo,
    worktreeRoot: opts.racine,
    tryGitFn: (_repo, args) => {
      opts.appels.push({ args })
      if (args[0] === 'worktree' && args[1] === 'list') {
        return { code: 0, stdout: `worktree ${opts.chemin}\n`, stderr: '' }
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        const force = args.includes('--force')
        if (force && opts.forceReussit) {
          rmSync(opts.chemin, { recursive: true, force: true })
          return { code: 0, stdout: '', stderr: '' }
        }
        return { code: 1, stdout: '', stderr: 'contains modified or untracked files' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
    removeDirFn: (p) => {
      if (!opts.disqueReussit) throw new Error('EBUSY: verrou Windows')
      rmSync(p, { recursive: true, force: true })
    }
  })
}

function copie(racine: string, nom = 'agent__run-bloque'): string {
  const chemin = join(racine, nom)
  mkdirSync(chemin, { recursive: true })
  writeFileSync(join(chemin, 'reste.txt'), 'residu\n')
  return chemin
}

describe('balayerLeChemin escalade au lieu d’echouer en silence', () => {
  it('escalade en `remove --force` quand le retrait doux echoue', () => {
    const repo = tempRepo()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-escalade-'))
    roots.push(racine)
    const chemin = copie(racine)
    const appels: Appel[] = []
    const wm = manager({ repo, racine, chemin, forceReussit: true, disqueReussit: false, appels })

    const ok = prive(wm).balayerLeChemin(chemin)

    expect(appels.some((a) => a.args.includes('remove') && a.args.includes('--force'))).toBe(true)
    expect(ok).toBe(true)
    expect(existsSync(chemin)).toBe(false)
  })

  it('escalade en retrait direct du dossier quand git echoue meme en force', () => {
    const repo = tempRepo()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-escalade-'))
    roots.push(racine)
    const chemin = copie(racine)
    const appels: Appel[] = []
    const wm = manager({ repo, racine, chemin, forceReussit: false, disqueReussit: true, appels })

    const ok = prive(wm).balayerLeChemin(chemin)

    expect(ok).toBe(true)
    expect(existsSync(chemin)).toBe(false)
    expect(appels.some((a) => a.args.join(' ') === 'worktree prune')).toBe(true)
  })

  it('compte les echecs par chemin et remonte le blocage dans l’etat', () => {
    const repo = tempRepo()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-escalade-'))
    roots.push(racine)
    const chemin = copie(racine)
    const appels: Appel[] = []
    const wm = manager({ repo, racine, chemin, forceReussit: false, disqueReussit: false, appels })

    const priv = prive(wm)
    expect(priv.balayerLeChemin(chemin)).toBe(false)
    expect(priv.balayerLeChemin(chemin)).toBe(false)

    const blocages = wm.blocagesDeBalayage()
    expect(blocages).toHaveLength(1)
    expect(blocages[0].path).toBe(chemin)
    expect(blocages[0].echecs).toBe(2)
    expect(blocages[0].detail).toBeTruthy()

    // L'etat rendu au demarrage doit le PORTER : c'est ce qui manquait.
    const bilan = wm.reconcileResidues({ balayer: false })
    expect(bilan.blocked.some((b) => b.path === chemin)).toBe(true)
  })

  it('oublie le compteur du MEME manager des qu’un chemin est enfin balaye', () => {
    const repo = tempRepo()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-escalade-'))
    roots.push(racine)
    const chemin = copie(racine)
    const appels: Appel[] = []
    // opts est capture par reference : on bascule le comportement SANS changer d'instance,
    // sinon le compteur teste serait celui d'un autre manager (toujours vide) et la remise a
    // zero ne serait jamais reellement observee.
    const opts = { repo, racine, chemin, forceReussit: false, disqueReussit: false, appels }
    const wm = manager(opts)
    expect(prive(wm).balayerLeChemin(chemin)).toBe(false)
    expect(wm.blocagesDeBalayage()).toHaveLength(1)

    opts.forceReussit = true
    expect(prive(wm).balayerLeChemin(chemin)).toBe(true)
    expect(wm.blocagesDeBalayage()).toHaveLength(0)
  })
})
