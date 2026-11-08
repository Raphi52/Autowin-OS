import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detachedCommit,
  git,
  manager,
  nettoyerRacines,
  tempRepo
} from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)
// Suites git REELLES : meme plafond que `worktree-manager.fusion-preservante.test.ts`.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

/**
 * Une copie partie d'un commit AMONT qui touche `a.txt`, fichier que l'utilisateur édite sans
 * commiter. La publication doit être refusée sans rien écrire dans son arbre : même quand la fusion
 * aurait pu tenir, l'édition de l'utilisateur reste la sienne.
 */
function scenarioAmont(editionUtilisateur: boolean): {
  repo: string
  path: string
  wm: ReturnType<typeof manager>
} {
  const repo = tempRepo()
  const wm = manager(repo)
  const base = git(repo, 'rev-parse', 'HEAD')
  // Le commit amont modifie `a.txt` en tête ; il n'est pas sur la branche de l'utilisateur.
  const amont = detachedCommit(repo, base, 'a.txt', 'ENTETE AMONT\nligne1\nligne2\nligne3\n')
  const path = wm.acquire('builder')
  // La copie part de ce commit amont, comme une copie partie d'une branche en avance.
  git(path, 'checkout', '-q', '--detach', amont)
  // Son propre travail ne touche pas `a.txt`.
  writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
  if (editionUtilisateur) {
    // L'utilisateur a modifié `a.txt` en queue, sans commiter.
    writeFileSync(join(repo, 'a.txt'), 'ligne1\nligne2\nligne3\nAJOUT UTILISATEUR\n')
  }
  return { repo, path, wm }
}

/**
 * L'ancienne forme d'appel : un drapeau d'écriture dans l'arbre de l'utilisateur. Il ne doit plus
 * rien écrire, même passé ici.
 */
const ancienneForme = { task: 'livrer le travail', preserverEditionLocale: true }

describe('WorktreeManager — collision avec un commit amont', () => {
  it('édition de l utilisateur sur le fichier amont : refusée, son fichier reste identique, la copie reste', () => {
    const { repo, path, wm } = scenarioAmont(true)
    const avant = readFileSync(join(repo, 'a.txt'))
    const teteAvant = git(repo, 'rev-parse', 'HEAD')

    const res = wm.finalize('builder', ancienneForme)

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-dirty' })
    expect(readFileSync(join(repo, 'a.txt')).equals(avant)).toBe(true)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(teteAvant)
    expect(git(repo, 'status', '--porcelain=v1')).toContain('a.txt')
    expect(git(repo, 'stash', 'list')).toBe('')
    expect(existsSync(path)).toBe(true)
  })

  it('jumeau accepté : sans édition de l utilisateur sur ce fichier, la publication passe', () => {
    const { repo, wm } = scenarioAmont(false)

    const res = wm.finalize('builder', ancienneForme)

    expect(res.outcome).toBe('merged')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail de la copie')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('ENTETE AMONT')
  })
})
