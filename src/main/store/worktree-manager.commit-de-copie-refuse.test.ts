import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'
import { formatOrchestrationOutcome } from '../../shared/orchestration-outcome'
import { raisonDeBlocageIntegration } from '../../shared/raison-de-blocage'

/** Remet une variable d'environnement dans l'état où on l'a trouvée (absente ou valeur). */
function restaurerEnv(cle: string, valeur: string | undefined): void {
  if (valeur === undefined) delete process.env[cle]
  else process.env[cle] = valeur
}

/**
 * LE COMMIT D'UNE COPIE REFUSÉ NE FAIT PAS LEVER LA FINALISATION.
 *
 * Le commit de la copie passe par le crochet `pre-commit` du dépôt. Quand ce crochet refuse
 * (contrôle de séparation, identité absente), `git commit` sort en erreur. La finalisation doit
 * alors rendre une issue « bloqué » qui porte la cause, et non une exception : l'utilisateur doit
 * lire pourquoi rien n'est publié, et la base ne doit pas bouger.
 *
 * Vrai dépôt git en tmp, avec un crochet qui refuse : même forme de refus que le contrôle réel.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

afterEach(nettoyerRacines)

describe('WorktreeManager — commit de copie refusé par le crochet', () => {
  it('finalize rend « bloqué » avec la cause de git, sans lever, et la base reste intacte', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const copie = wm.acquire('builder')
    const dossierCrochets = join(repo, 'crochets-refus')
    mkdirSync(dossierCrochets, { recursive: true })
    writeFileSync(
      join(dossierCrochets, 'pre-commit'),
      '#!/bin/sh\necho "Commit refusé : test de refus par le crochet" >&2\nexit 1\n'
    )
    git(repo, 'config', 'core.hooksPath', dossierCrochets)
    const tete = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(copie, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({
      outcome: 'blocked',
      agentId: 'builder',
      reason: 'commit-refused'
    })
    expect(res.outcome === 'blocked' && res.detail).toContain('Commit refusé : test de refus')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tete)
    expect(existsSync(join(copie, 'b.txt'))).toBe(true)
  })

  it('un échec de git add (verrou d’index) n’est pas pris pour un refus du crochet : il remonte tel quel', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const copie = wm.acquire('builder')
    const tete = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(copie, 'b.txt'), 'travail de la copie\n')
    const dossierGit = resolve(copie, git(copie, 'rev-parse', '--git-dir'))
    writeFileSync(join(dossierGit, 'index.lock'), '')

    expect(() => wm.finalize('builder')).toThrow(/index\.lock/)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tete)
    expect(existsSync(join(copie, 'b.txt'))).toBe(true)
  })

  it('une identité Git absente rend « bloqué » sans accuser le contrôle du dépôt', () => {
    // fix-ok: src/main/store/worktree-manager.commit-de-copie-refuse.test.ts — cas ajouté : le libellé visible disait « refusé par le contrôle du dépôt » pour tout échec du git commit.
    const repo = tempRepo()
    const wm = manager(repo)
    const copie = wm.acquire('builder')
    const tete = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(copie, 'b.txt'), 'travail de la copie\n')
    // Un nom d'auteur vide : Git refuse le commit (« empty ident name »), sans aucun crochet.
    const auteurAvant = process.env.GIT_AUTHOR_NAME
    const validantAvant = process.env.GIT_COMMITTER_NAME
    const res = (() => {
      process.env.GIT_AUTHOR_NAME = ''
      process.env.GIT_COMMITTER_NAME = ''
      try {
        return wm.finalize('builder')
      } finally {
        restaurerEnv('GIT_AUTHOR_NAME', auteurAvant)
        restaurerEnv('GIT_COMMITTER_NAME', validantAvant)
      }
    })()

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'commit-refused' })
    const texte = formatOrchestrationOutcome(true, {
      gateBlocked: true,
      status: 'failed',
      gateReasons: ['intégration locale non terminée', raisonDeBlocageIntegration(res)]
    })
    expect(texte).not.toContain('contrôle du dépôt')
    expect(texte).toContain('Git n’a pas enregistré le commit de la copie')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tete)
    expect(existsSync(join(copie, 'b.txt'))).toBe(true)
  })
})
