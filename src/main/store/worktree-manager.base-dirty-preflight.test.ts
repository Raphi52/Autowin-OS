import { afterEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)

/**
 * Empreinte git COMPLÈTE de la base. Toute mutation que le pré-vol se permettrait la déplace :
 * un `stash` (la rustine évidente pour « nettoyer la base ») change `status` ET `stash list` ;
 * un `checkout -- .` change `status` ; un `commit`/`update-ref` change `HEAD` ou les refs.
 */
function empreinte(repo: string): Record<string, string> {
  return {
    status: git(repo, 'status', '--porcelain=v1', '--untracked-files=all'),
    head: git(repo, 'rev-parse', 'HEAD'),
    branche: git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'),
    stash: git(repo, 'stash', 'list'),
    refs: git(repo, 'for-each-ref', '--format=%(refname) %(objectname)'),
    reflog: git(repo, 'reflog', '--format=%H %gs')
  }
}

describe('WorktreeManager — pré-vol base-dirty en LECTURE SEULE', () => {
  it('liste les fichiers non committés sans muter quoi que ce soit dans git', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    // Base SALE : un suivi modifié, un non suivi. C'est l'entrée qui doit produire une liste.
    writeFileSync(join(repo, 'a.txt'), 'travail non committé de l’utilisateur\n')
    writeFileSync(join(repo, 'brouillon.md'), 'note perso\n')

    const avant = empreinte(repo)
    const files = wm.baseDirtyFiles()
    const apres = empreinte(repo)

    expect(files).toEqual(expect.arrayContaining(['a.txt', 'brouillon.md']))
    // ZÉRO MUTATION : ni stash, ni checkout, ni ref, ni HEAD, ni même le contenu de l'arbre.
    expect(apres).toEqual(avant)
    expect(apres.stash).toBe('')
    expect(git(repo, 'show', ':a.txt')).toBe('ligne1\nligne2\nligne3')
  })

  it('base propre : liste vide, empreinte intacte', () => {
    const repo = tempRepo()
    const wm = manager(repo)

    const avant = empreinte(repo)
    expect(wm.baseDirtyFiles()).toEqual([])
    expect(empreinte(repo)).toEqual(avant)
  })

  it('base illisible : liste vide plutôt qu’une exception (le pré-vol ne casse pas le run)', () => {
    const wm = manager(join(tempRepo(), 'dossier-inexistant'))
    expect(wm.baseDirtyFiles()).toEqual([])
  })
})
