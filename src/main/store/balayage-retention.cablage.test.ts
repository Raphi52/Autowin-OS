import { afterEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'
import { planifierBalayage } from './balayage-retention'

/**
 * LE RECENSEMENT QUI ALIMENTE LE BALAYAGE — sur un VRAI depot, pas sur un faux git.
 *
 * Ce qui doit rester vrai, et que la mesure du 2026-09-08 a rendu concret :
 *  - un marqueur `trie/` est vu mais jamais agi (152 sur le depot reel) ;
 *  - une branche dont le contenu est deja en base est reconnue par EMPREINTE, pas par ascendance :
 *    publier par cherry-pick recree le commit sous un autre SHA, et l'ascendance seule signalait
 *    donc pour toujours un travail deja publie ;
 *  - un SHA non consigne n'est JAMAIS propose a la suppression -- c'est ce qui a protege les 208
 *    refs du depot tant qu'aucun registre ne les portait ;
 *  - le recensement ne SUPPRIME rien : les refs sont toutes encore la apres l'appel.
 */
describe('recenserRetention — lecture seule, et le plan qui en decoule', () => {
  afterEach(() => nettoyerRacines())

  function commitSur(repo: string, ref: string, fichier: string): string {
    const base = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(repo, fichier), `contenu ${fichier}\n`)
    git(repo, 'add', fichier)
    git(repo, 'commit', '-q', '-m', `travail ${fichier}`)
    const sha = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'update-ref', ref, sha)
    git(repo, 'reset', '-q', '--hard', base)
    return sha
  }

  it('recense branches et refs, sans jamais rien supprimer', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const shaTravail = commitSur(repo, 'refs/heads/autowin/recovery/run-1', 'a.txt')
    const shaTrie = commitSur(repo, 'refs/autowin/trie/run-2', 'b.txt')

    const avant = git(repo, 'for-each-ref', '--format=%(refname)', 'refs/autowin/', 'refs/heads/autowin/')
    const entrees = wm.recenserRetention(() => true)
    const apres = git(repo, 'for-each-ref', '--format=%(refname)', 'refs/autowin/', 'refs/heads/autowin/')
    expect(apres).toBe(avant)

    const parNom = new Map(entrees.map((e) => [e.nom, e]))
    expect(parNom.get('refs/heads/autowin/recovery/run-1')?.famille).toBe('branche')
    expect(parNom.get('refs/autowin/trie/run-2')?.famille).toBe('trie')
    // Un marqueur n'est jamais interroge : il annote, il ne porte pas de travail.
    expect(parNom.get('refs/autowin/trie/run-2')?.apporteQuelqueChose).toBe(false)
    expect(shaTravail).not.toBe(shaTrie)
  })

  it('un travail REELLEMENT porteur est vu comme tel, et le plan le GARDE (recent)', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    commitSur(repo, 'refs/heads/autowin/recovery/run-porteur', 'neuf.txt')

    const entrees = wm.recenserRetention(() => true)
    const porteur = entrees.find((e) => e.nom.endsWith('run-porteur'))
    expect(porteur?.apporteQuelqueChose).toBe(true)

    const plan = planifierBalayage(entrees)
    expect(plan.aSupprimer).toEqual([])
    expect(plan.aSignaler).toEqual([])
  })

  it('un SHA NON consigne n’est jamais propose a la suppression, meme sans apport', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    // Une ref posee sur HEAD n'apporte rien : son contenu est deja la base.
    git(repo, 'update-ref', 'refs/autowin/rescue/run-vide', git(repo, 'rev-parse', 'HEAD'))

    const nonConsigne = planifierBalayage(wm.recenserRetention(() => false))
    expect(nonConsigne.aSupprimer).toEqual([])

    const consigne = planifierBalayage(wm.recenserRetention(() => true))
    expect(consigne.aSupprimer.map((e) => e.nom)).toEqual(['refs/autowin/rescue/run-vide'])
  })
})
