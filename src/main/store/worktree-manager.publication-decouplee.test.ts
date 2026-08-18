import { afterEach, describe, expect, it, vi } from 'vitest'

/** Vrais dépôts git en tmp : mêmes contraintes d'I/O que la suite publication. */
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)

/**
 * DÉCOUPLER LA PUBLICATION DE L'ÉTAT DE L'ARBRE DE L'UTILISATEUR.
 *
 * Défaut mesuré le 2026-08-18 : 216 `base-in-progress` contre 86 `base-dirty` dans
 * `runs/**‍/trace.json`. La cause n'est PAS une course entre agents — `MERGE_HEAD` et `index` sont
 * par copie (`.git/worktrees/<id>/…`), donc aucun run ne peut bloquer un autre. Ce qui bloque, c'est
 * que la publication avance la branche CHECKOUTÉE par l'utilisateur, et exige donc son arbre au repos
 * à un instant qu'elle ne choisit pas — pendant qu'il y travaille en continu.
 *
 * Le refus arrivait AVANT que le travail de la copie soit committé : il restait en fichiers libres
 * dans un dossier de worktree, sans adresse, pendant que le rapport annonçait « rien n'est publié ».
 *
 * Deux pistes ont été écartées, et pour des raisons qui valent d'être écrites :
 *   1. réutiliser `refs/autowin/publications/<id>` — REFUSÉ : c'est le candidat d'une transaction
 *      dont la reprise exige `baseSha` ET `sha` pour ancêtres ; y écrire tôt transformerait un
 *      réessai réparable en `merge-failed` dur dès que la base avance ;
 *   2. desserrer `validate_initial_workspace` dans le hook `reference-transaction` pour ce ref —
 *      REFUSÉ : cette atomicité alimente le mécanisme de compensation, et la toucher pour un gain
 *      qu'un ref distinct offre gratuitement serait un risque sans contrepartie.
 *
 * D'où `refs/autowin/secours/<agentId>` : une adresse qui ne promet rien d'autre que « le travail est
 * là, atteignable, non publié ». Le chemin de publication et sa compensation restent INTACTS.
 *
 * Ce que ces tests exigent : sur une base occupée, le travail devient ATTEIGNABLE sans que la branche
 * de l'utilisateur ni son arbre ne bougent d'un octet — et la garde `base-dirty` continue de primer.
 */
describe('publication découplée de l’arbre utilisateur', () => {
  /** Met la base dans un état d'opération en cours, comme un `pull --rebase` humain à cet instant. */
  function baseEnOperation(repo: string): { head: string; status: string } {
    git(repo, 'checkout', '-q', '-b', 'cote-utilisateur')
    writeFileSync(join(repo, 'conflit.txt'), 'version utilisateur\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'côté utilisateur')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'conflit.txt'), 'version main\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'côté main')
    // Merge volontairement conflictuel, laissé EN COURS : c'est l'état réel d'un humain au travail.
    // `git()` lève sur code ≠ 0, et un merge en conflit sort en 1 : l'échec est ATTENDU, pas un raté.
    try {
      git(repo, 'merge', 'cote-utilisateur')
      throw new Error('le merge devait entrer en conflit — le décor du test ne tient plus')
    } catch (erreur) {
      const texte = erreur instanceof Error ? erreur.message : String(erreur)
      if (texte.includes('le décor du test')) throw erreur
    }
    // Le décor n'est valide QUE si la base est réellement en opération.
    expect(() => git(repo, 'rev-parse', 'MERGE_HEAD')).not.toThrow()
    return { head: git(repo, 'rev-parse', 'HEAD'), status: git(repo, 'status', '--porcelain') }
  }

  it('base occupée → le travail de l’agent est ATTEIGNABLE par le ref privé', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'livrable.txt'), 'travail de l’agent\n')
    baseEnOperation(repo)

    const res = wm.finalize('builder')

    // On n'exige PAS `merged` : la branche de l'utilisateur n'a pas avancé, et c'est normal.
    expect(res.outcome).not.toBe('merged')
    // Mais le travail doit être atteignable : le ref privé existe et porte le livrable.
    const ref = git(repo, 'rev-parse', '--verify', 'refs/autowin/secours/builder')
    expect(ref).toMatch(/^[0-9a-f]{40}$/)
    expect(git(repo, 'show', `${ref}:livrable.txt`)).toContain('travail de l’agent')
  })

  it('l’arbre et la branche de l’utilisateur ne bougent PAS d’un octet', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'livrable.txt'), 'travail de l’agent\n')
    const avant = baseEnOperation(repo)

    wm.finalize('builder')

    expect(git(repo, 'rev-parse', 'HEAD')).toBe(avant.head)
    expect(git(repo, 'status', '--porcelain')).toBe(avant.status)
    // Le merge humain en cours n'est ni terminé ni annulé par Autowin.
    expect(() => git(repo, 'rev-parse', 'MERGE_HEAD')).not.toThrow()
    expect(readFileSync(join(repo, 'conflit.txt'), 'utf8')).toContain('version main')
  })

  it('la garde base-dirty reste intacte : elle prime et n’écrit AUCUN ref', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    // Conflit RÉEL avec du travail non committé de l'utilisateur sur le même fichier.
    writeFileSync(join(repo, 'a.txt'), 'travail local non committé\n')
    writeFileSync(join(path, 'a.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-dirty' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail local non committé')
    // Découpler ne veut pas dire publier par-dessus le travail de l'utilisateur.
    expect(() => git(repo, 'rev-parse', '--verify', 'refs/autowin/secours/builder')).toThrow()
  })

  it('base au repos → le confort actuel ne régresse pas : ça fusionne pour de vrai', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'livrable.txt'), 'travail de l’agent\n')

    const res = wm.finalize('builder')

    expect(res.outcome).toBe('merged')
    expect(readFileSync(join(repo, 'livrable.txt'), 'utf8')).toContain('travail de l’agent')
  })
})
