import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { DOSSIER_DES_FICHES_DE_SUPPRESSION } from './worktree-manager-copies'
import { git, roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * UN RETRAIT À MOITIÉ N'EST PAS UNE FUSION REFUSÉE.
 *
 * Mesuré le 2026-11-27 (conv-2192, copie `run-25e43b1371c2-1`, un dépôt de l'utilisateur) : l'agent
 * avait déjà réuni et poussé son travail sur `main`. Au rangement, `git worktree remove` a
 * retiré le lien git et les fichiers suivis, mais des fichiers tenus par un processus (`web/`,
 * `tests/`, `wwwroot/` : 190 Mo) sont restés. La copie a été remise à sa place SANS `.git`, puis
 * `unpublishedFiles` y a lancé `git ls-files` : git est remonté jusqu'au dépôt parent (le dossier
 * d'Autowin, qui ignore ses copies) et a planté (« internal error - directory entry not superset of
 * prefix »). L'exception est devenue `merge-failed`, le run a été annoncé « fusion refusée, republie
 * à la main », et la clôture a ajouté « commit demandé sans identité publiée ». 9 runs dans 8 fils
 * portent cette cause dans leur RUN.md.
 *
 * Le décor reproduit ce cas : le dossier des copies vit DANS un dépôt parent qui l'ignore.
 */

afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // Un verrou Windows sur un dossier de test ne doit pas faire échouer la suite.
    }
  }
})

const monter = (): { repo: string; parent: string; wm: WorktreeManager } => {
  const repo = tempRepo()
  // Le dépôt parent, comme le dossier d'Autowin : il contient le dossier des copies et l'ignore.
  const parent = mkdtempSync(join(tmpdir(), 'autowin-parent-'))
  roots.push(parent)
  git(parent, 'init', '-q', '-b', 'main')
  git(parent, 'config', 'user.email', 't@t')
  git(parent, 'config', 'user.name', 'T')
  writeFileSync(join(parent, '.gitignore'), 'copies*/\n')
  git(parent, 'add', '-A')
  git(parent, 'commit', '-q', '-m', 'parent')
  const racine = join(parent, 'copies')
  mkdirSync(racine)
  return {
    repo,
    parent,
    wm: new WorktreeManager({
      racineCopiesDeTaches: join(parent, 'copies-de-taches'),
      baseRepo: repo,
      worktreeRoot: racine
    })
  }
}

/** Une copie dont l'agent a commité, puis réuni lui-même son commit sur `main` (la base). */
const copiePublieeParLAgent = (
  repo: string,
  wm: WorktreeManager,
  agentId: string
): { chemin: string; sha: string } => {
  const chemin = wm.pathFor(agentId)
  git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
  writeFileSync(join(chemin, 'travail.txt'), 'travail de l’agent')
  git(chemin, 'add', '-A')
  git(chemin, 'commit', '-q', '-m', `agent ${agentId}`)
  const sha = git(chemin, 'rev-parse', 'HEAD')
  git(repo, 'merge', '-q', '--ff-only', sha)
  return { chemin, sha }
}

type Retrait = (chemin: string) => { ok: boolean; detail?: string }

/**
 * Le rangement réel : git retire la copie (lien compris), mais un fichier tenu par un processus
 * survit. C'est exactement l'état laissé par `cleanupWorktree` sur la copie de quarantaine.
 */
const retraitQuiLaisseUnVerrou =
  (repo: string): Retrait =>
  (chemin) => {
    git(repo, 'worktree', 'remove', '--force', chemin)
    mkdirSync(join(chemin, 'web', 'node_modules'), { recursive: true })
    writeFileSync(join(chemin, 'web', 'node_modules', 'esbuild.exe'), 'tenu par un processus')
    return { ok: false, detail: 'le dossier survit au retrait' }
  }

const poserRetrait = (wm: WorktreeManager, retrait: Retrait | undefined): void => {
  const instance = wm as unknown as { cleanupWorktree?: Retrait }
  if (retrait) instance.cleanupWorktree = retrait
  else delete instance.cleanupWorktree
}

describe('un rangement coupé par un verrou, après publication', () => {
  it('cleanupPublished conclut la publication et confie le reste au balayage, sans git dans le reste ni dans le dépôt parent', () => {
    const { repo, parent, wm } = monter()
    const agentId = 'run-retrait-moitie-1'
    const { chemin, sha } = copiePublieeParLAgent(repo, wm, agentId)
    const headParent = git(parent, 'rev-parse', '--abbrev-ref', 'HEAD')
    poserRetrait(wm, retraitQuiLaisseUnVerrou(repo))

    const issue = wm.cleanupPublished(agentId, sha, 'main')

    expect(issue.outcome).toBe('merged')
    // Le dépôt parent n'a rien reçu : ni bascule de branche, ni branche de secours.
    expect(git(parent, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(headParent)
    expect(git(parent, 'branch', '--list', 'autowin/*')).toBe('')
    // Le commit reste dans la base.
    expect(git(repo, 'merge-base', '--is-ancestor', sha, 'main')).toBe('')
    // Le reste est désigné au balayage : la fiche « retrait commencé » est posée.
    expect(existsSync(join(chemin, 'web', 'node_modules', 'esbuild.exe'))).toBe(true)
    expect(
      existsSync(join(wm.worktreeRoot, DOSSIER_DES_FICHES_DE_SUPPRESSION, `${agentId}.json`))
    ).toBe(true)

    // Le verrou tombe : le passage suivant finit le retrait, et la reprise conclut la publication.
    poserRetrait(wm, undefined)
    expect(wm.reprendreSuppressionsCommencees()).toContain(agentId)
    expect(existsSync(chemin)).toBe(false)
    expect(wm.cleanupPublished(agentId, sha, 'main').outcome).toBe('merged')
  })

  it('finalize d’une copie que l’agent a déjà réunie sur la base : pas de « fusion refusée »', () => {
    const { repo, wm } = monter()
    const agentId = 'run-retrait-moitie-2'
    const { sha } = copiePublieeParLAgent(repo, wm, agentId)
    poserRetrait(wm, retraitQuiLaisseUnVerrou(repo))

    const issue = wm.finalize(agentId, { baseBranch: 'main' })

    // L'issue d'un rangement réussi sur une copie sans apport : « rien à fusionner ».
    expect(issue.outcome).toBe('nothing')
    expect(git(repo, 'rev-parse', 'main')).toBe(sha)
  })

  it('reprise par finalize avec le commit attendu, quand le reste sans lien est encore là', () => {
    const { repo, wm } = monter()
    const agentId = 'run-retrait-moitie-3'
    const { sha } = copiePublieeParLAgent(repo, wm, agentId)
    poserRetrait(wm, retraitQuiLaisseUnVerrou(repo))
    wm.cleanupPublished(agentId, sha, 'main')

    const reprise = wm.finalize(agentId, { baseBranch: 'main', expectedAgentSha: sha })

    expect(reprise.outcome).toBe('cleanup-pending')
  })

  it('contrôle : un rangement refusé avant tout geste remet la copie intacte, sans fiche de retrait', () => {
    const { repo, wm } = monter()
    const agentId = 'run-retrait-refuse'
    const { chemin, sha } = copiePublieeParLAgent(repo, wm, agentId)
    poserRetrait(wm, () => ({ ok: false, detail: 'refusé avant tout geste' }))

    const issue = wm.cleanupPublished(agentId, sha, 'main')

    expect(issue.outcome).toBe('cleanup-pending')
    expect(existsSync(join(chemin, '.git'))).toBe(true)
    expect(git(chemin, 'rev-parse', 'HEAD')).toBe(sha)
    expect(
      existsSync(join(wm.worktreeRoot, DOSSIER_DES_FICHES_DE_SUPPRESSION, `${agentId}.json`))
    ).toBe(false)
  })
})
