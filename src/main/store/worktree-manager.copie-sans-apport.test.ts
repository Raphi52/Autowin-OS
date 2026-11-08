import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'

/**
 * UNE COPIE QUI N'APPORTE RIEN NE PASSE PAS PAR LA PUBLICATION.
 *
 * Refus mesurés du 05 au 07/11 (13 sur 40 « intégration locale non terminée ») : l'agent avait
 * écrit directement dans le dépôt de base, sa copie n'avait donc aucun changement. Pendant ce
 * temps la base avait avancé : le commit de la copie n'était plus égal à HEAD, seulement contenu
 * dedans. La finalisation ne reconnaissait « rien à fusionner » que pour `sha === baseSha`, elle
 * allait donc jusqu'à la publication. Le garde de publication y vérifie l'état des fichiers de
 * l'agent par `git status -- <fichiers>` ; liste vide = aucun chemin = TOUT l'arbre pour git.
 * Le moindre fichier non commité d'un autre fil faisait refuser la transaction :
 * `base-in-progress — fatal: in 'prepared' phase, update aborted by the reference-transaction
 * hook — fichiers en cause: <tous les fichiers sales de la base>`, identique à chaque reprise.
 *
 * Vrais dépôts git en tmp : même budget que les autres fichiers `worktree-manager.*`.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

afterEach(nettoyerRacines)

function ecrire(repo: string, chemin: string, contenu: string): void {
  const complet = join(repo, chemin)
  mkdirSync(dirname(complet), { recursive: true })
  writeFileSync(complet, contenu)
}

/** La base avance d'un commit après le lancement de la copie (publication d'un autre fil). */
function faireAvancerLaBase(repo: string): string {
  ecrire(repo, 'src/autre-fil.ts', 'export const publie = 1\n')
  git(repo, 'add', 'src/autre-fil.ts')
  git(repo, 'commit', '-q', '-m', 'publication d’un autre fil')
  return git(repo, 'rev-parse', 'HEAD')
}

describe('WorktreeManager — copie sans apport', () => {
  it('base avancée + fichiers non commités ailleurs → « rien à fusionner », base intacte', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('builder')
    const tete = faireAvancerLaBase(repo)
    // L'état de la base au moment du refus : le travail de l'agent posé à la main, non commité,
    // et celui d'autres fils (fichiers suivis modifiés et nouveaux fichiers).
    ecrire(repo, 'a.txt', 'édition directe de l’agent, non commitée\n')
    ecrire(repo, 'src/agent-pilot/etat-du-tour.ts', 'export const etat = {}\n')
    ecrire(repo, 'scripts/avec-instance-headless.mjs', '// autre fil\n')
    const statutAvant = git(repo, 'status', '--porcelain', '--untracked-files=all')

    const res = wm.finalize('builder')

    expect(res).toEqual({ outcome: 'nothing', agentId: 'builder' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tete)
    expect(git(repo, 'status', '--porcelain', '--untracked-files=all')).toBe(statutAvant)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('édition directe')
    // Aucune transaction de publication ouverte pour un travail qui n'existe pas.
    expect(git(repo, 'for-each-ref', 'refs/autowin/publications/')).toBe('')
    expect(existsSync(wm.pathFor('builder'))).toBe(false)
  })

  it('contrôle : une copie qui apporte un fichier est toujours publiée, base sale ailleurs', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const copie = wm.acquire('builder')
    faireAvancerLaBase(repo)
    ecrire(repo, 'scripts/avec-instance-headless.mjs', '// autre fil\n')
    ecrire(copie, 'b.txt', 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res.outcome).toBe('merged')
    expect(git(repo, 'show', 'HEAD:b.txt')).toBe('travail de la copie')
    expect(existsSync(join(repo, 'scripts/avec-instance-headless.mjs'))).toBe(true)
  })

  it('contrôle : la garde base-dirty mord toujours sur un fichier de l’agent', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const copie = wm.acquire('builder')
    faireAvancerLaBase(repo)
    ecrire(repo, 'a.txt', 'travail local non committé\n')
    ecrire(copie, 'a.txt', 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', files: ['a.txt'], reason: 'base-dirty' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail local non committé')
  })
})
