import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'
import { WorktreeManager } from './worktree-manager'

/**
 * LE QUATRIEME GISEMENT N'OBEISSAIT PAS AU VERDICT.
 *
 * `travauxNonPublies` recense aussi les bureaux SALIS — du travail jamais committe. Ce gisement-la
 * ignorait le verdict TRIE : marquer ne le refermait pas, et le bandeau repassait identique. La
 * cause : le marquage porte un SHA, or un bureau sali n'a pas de commit a lui — son HEAD est celui
 * de la base et il ne bouge pas.
 *
 * Le marquage porte donc l'EMPREINTE du diff non committe. Consequence exigee : un bureau trie
 * puis RE-MODIFIE ressort a nouveau, sinon on aurait remplace un bandeau qui crie par un bandeau
 * qui se tait.
 */
describe('WorktreeManager — un bureau SALI trie se tait, et ressort des qu’il rebouge', () => {
  afterEach(() => nettoyerRacines())

  function bureauSali(): { wm: WorktreeManager; bureau: string } {
    const repo = tempRepo()
    const racine = join(repo, '.autowin-data', 'worktrees')
    mkdirSync(racine, { recursive: true })
    const bureau = join(racine, 'agent__run-sali-1')
    git(repo, 'worktree', 'add', '-q', '--detach', bureau, 'HEAD')
    writeFileSync(join(bureau, 'livrable.txt'), 'travail jamais committé\n')
    return { wm: new WorktreeManager({ baseRepo: repo, worktreeRoot: racine }), bureau }
  }

  it('le marquage referme le bureau sali — et rien n’est supprime', () => {
    const { wm, bureau } = bureauSali()
    expect(wm.travauxNonPublies()).toContain('run-sali-1')

    expect(wm.marquerTravailTrie('run-sali-1')).toBe(true)

    expect(wm.travauxNonPublies()).not.toContain('run-sali-1')
    // Le travail existe toujours : marquer n'efface pas.
    expect(git(bureau, 'status', '--porcelain')).not.toBe('')
  })

  it('un bureau sali RE-MODIFIE apres le tri ressort de lui-meme', () => {
    const { wm, bureau } = bureauSali()
    wm.marquerTravailTrie('run-sali-1')
    expect(wm.travauxNonPublies()).not.toContain('run-sali-1')

    // Le HEAD n'a pas bouge : seul le diff change. C'est exactement ce que l'empreinte doit voir.
    writeFileSync(join(bureau, 'livrable.txt'), 'travail repris, plus complet\n')

    expect(wm.travauxNonPublies()).toContain('run-sali-1')
  })

  it('un fichier NON SUIVI reecrit change aussi l’empreinte', () => {
    const { wm, bureau } = bureauSali()
    const avant = wm.empreinteBureauSali('run-sali-1')
    writeFileSync(join(bureau, 'livrable.txt'), 'autre contenu, meme nom\n')
    expect(wm.empreinteBureauSali('run-sali-1')).not.toBe(avant)
    expect(avant).toMatch(/^[0-9a-f]{64}$/)
  })

  it('oublier le verdict fait ressortir le bureau sali', () => {
    const { wm } = bureauSali()
    wm.marquerTravailTrie('run-sali-1')
    expect(wm.travauxNonPublies()).not.toContain('run-sali-1')
    expect(wm.oublierTravailTrie('run-sali-1')).toBe(true)
    expect(wm.travauxNonPublies()).toContain('run-sali-1')
  })
})
