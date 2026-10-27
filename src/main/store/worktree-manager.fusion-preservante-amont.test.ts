import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'
import {
  detachedCommit,
  git,
  nettoyerRacines,
  roots,
  tempRepo
} from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)
// Suites git REELLES : meme plafond que `worktree-manager.fusion-preservante.test.ts`.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

/** Le vrai git, sans jeter : meme contrat que le `tryGit` interne du gestionnaire. */
function vraiGit(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * LE CAS DU 2026-10-24 (conv-1139, run run-58bfc90f8f7b-1) : le fichier en collision n'est PAS
 * touche par le travail de la copie, mais par un commit AMONT que la copie embarque.
 *
 * Ce soir-la, la copie etait partie d'`origin/main` (2c043d98, retrait de Graphify), en avance
 * d'un commit sur le main local (8ab2cbc3). Ce commit amont modifiait `claude.ts` et
 * `worktree-manager.ts`, deux fichiers que l'utilisateur avait modifies sans les commiter. La
 * publication a avance main par avance rapide, puis ces deux fichiers sont restes dans
 * `stash@{0}` — revenus a la version commitee, sans les modifications de l'utilisateur — et le
 * compte rendu disait seulement « integre ».
 *
 * `apresAvance` simule ce qu'un AUTRE geste git du dossier partage peut faire juste apres
 * l'avance rapide (tenir `index.lock`, tenir la pile, reecrire le fichier) : c'est la seule
 * fenetre ou la remise peut echouer, puisque la fusion a blanc l'a deja jugee propre.
 */
function casDu24(apresAvance?: (repo: string) => void): {
  repo: string
  res: ReturnType<WorktreeManager['finalize']>
} {
  const repo = tempRepo()
  const racine = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
  roots.push(racine)
  let declenche = false
  const wm = new WorktreeManager({
    baseRepo: repo,
    worktreeRoot: racine,
    tryGitFn: (dir, args) => {
      const r = vraiGit(dir, args)
      if (apresAvance && !declenche && dir === repo && args.includes('--ff-only') && r.code === 0) {
        declenche = true
        apresAvance(repo)
      }
      return r
    }
  })
  const base = git(repo, 'rev-parse', 'HEAD')
  // Le commit AMONT (l'equivalent de 2c043d98) : il touche `a.txt` en tete, hors de main.
  const amont = detachedCommit(repo, base, 'a.txt', 'ENTETE AMONT\nligne1\nligne2\nligne3\n')
  const path = wm.acquire('builder')
  // La copie part de ce commit amont, comme une copie partie d'`origin/main` en avance.
  git(path, 'checkout', '-q', '--detach', amont)
  // Son PROPRE travail ne touche pas `a.txt`.
  writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
  // L'utilisateur, lui, a modifie `a.txt` en queue, sans commiter.
  writeFileSync(join(repo, 'a.txt'), 'ligne1\nligne2\nligne3\nAJOUT UTILISATEUR\n')
  const res = wm.finalize('builder', { preserverEditionLocale: true })
  // Les verrous simules sont rendus avant les constats, comme un autre geste qui se termine.
  rmSync(join(repo, '.git', 'index.lock'), { force: true })
  rmSync(join(repo, '.git', 'refs', 'stash.lock'), { force: true })
  return { repo, res }
}

const tenirLIndex = (repo: string): void => writeFileSync(join(repo, '.git', 'index.lock'), '')

describe('WorktreeManager — fusion preservante, collision venue d un commit amont (cas du 24/10)', () => {
  it('nominal : le travail atterrit ET la modification de l utilisateur revient dans son fichier', () => {
    const { repo, res } = casDu24()

    expect(res.outcome).toBe('merged')
    // `toContain` : la config git du poste (core.autocrlf=true) rend le fichier en CRLF.
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail de la copie')
    const contenu = readFileSync(join(repo, 'a.txt'), 'utf8')
    expect(contenu).toContain('ENTETE AMONT')
    expect(contenu).toContain('AJOUT UTILISATEUR')
    // Son apport reste NON commite, comme il l'avait laisse.
    expect(git(repo, 'status', '--porcelain=v1')).toContain('a.txt')
    // Et rien ne reste range dans la pile partagee des remises de cote.
    expect(git(repo, 'stash', 'list')).toBe('')
    expect(res).not.toHaveProperty('editionLocaleNonRemise')
  })

  it('index verrouille par un autre geste pendant le retour : publie, rendu « merged », editions remises', () => {
    // Avant le correctif : « blocked/base-dirty » pour un travail publie, a.txt sans l'ajout de
    // l'utilisateur, et la remise de cote JETEE (`stash drop` n'a pas besoin de l'index).
    const { repo, res } = casDu24(tenirLIndex)

    expect(res.outcome).toBe('merged')
    const contenu = readFileSync(join(repo, 'a.txt'), 'utf8')
    expect(contenu).toContain('ENTETE AMONT')
    expect(contenu).toContain('AJOUT UTILISATEUR')
    expect(git(repo, 'show', 'HEAD:a.txt')).not.toContain('AJOUT UTILISATEUR')
    expect(git(repo, 'status', '--porcelain=v1')).toContain('a.txt')
    expect(git(repo, 'stash', 'list')).toBe('')
    expect(res).not.toHaveProperty('editionLocaleNonRemise')
  })

  it('pile aussi verrouillee : fichiers remis, et la remise restee dans la pile est ANNONCEE', () => {
    const { repo, res } = casDu24((r) => {
      tenirLIndex(r)
      writeFileSync(join(r, '.git', 'refs', 'stash.lock'), '')
    })

    expect(res.outcome).toBe('merged')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('AJOUT UTILISATEUR')
    const remise = git(repo, 'rev-parse', 'refs/stash')
    expect(res).toMatchObject({
      editionLocaleNonRemise: {
        fichiers: [],
        remise,
        sauvegarde: 'refs/autowin/safety/builder'
      }
    })
  })

  it('fichier reecrit par un autre geste apres la publication : rien n est ecrase, tout est ANNONCE', () => {
    const { repo, res } = casDu24((r) => {
      tenirLIndex(r)
      writeFileSync(join(r, 'a.txt'), 'ECRITURE D UN AUTRE FIL\n')
    })

    expect(res.outcome).toBe('merged')
    // Le fichier de l'autre n'est pas ecrase par notre retour.
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('ECRITURE D UN AUTRE FIL\n')
    const remise = git(repo, 'rev-parse', 'refs/stash')
    expect(res).toMatchObject({
      editionLocaleNonRemise: {
        fichiers: ['a.txt'],
        remise,
        sauvegarde: 'refs/autowin/safety/builder'
      }
    })
    // Sa version reste atteignable a l'adresse annoncee.
    expect(git(repo, 'show', `${remise}:a.txt`)).toContain('AJOUT UTILISATEUR')
    expect(
      (res as { editionLocaleNonRemise: { cause: string } }).editionLocaleNonRemise.cause
    ).toMatch(/a\.txt : modifié depuis la publication/)
  })
})
