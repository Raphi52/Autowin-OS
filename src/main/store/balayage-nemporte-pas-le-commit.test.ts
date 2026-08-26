import { readdirSync, rmSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { git, roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * LE SECOND CHEMIN DESTRUCTEUR, trouvé au cycle 2 de l'audit — à la couture de deux chantiers.
 *
 * Une session concurrente a livré `balayerLesCoquilles()`, branché EN PREMIER au démarrage, avant
 * toute mesure. Il supprime tout dossier de bureau ne portant aucun fichier hors `.git`. Sa
 * documentation affirme qu'« un bureau porteur de travail non repris n'est JAMAIS purgé par ce
 * chemin » — c'est vrai quand la valeur est dans les FICHIERS, faux quand elle est dans le COMMIT.
 *
 * Le résidu que ce balayage existe justement pour ramasser — un `git worktree remove` interrompu —
 * laisse précisément ça : plus de fichiers de travail, mais un `.git` et un HEAD sur un commit
 * orphelin. Le dossier est donc jugé coquille vide et effacé ; or le recensement des bureaux
 * détachés ne voit un commit que par `existsSync(bureau)` + `rev-parse HEAD`. Dossier parti, commit
 * invisible pour toujours — jusqu'au prochain `gc`, qui le détruit pour de bon.
 *
 * Les deux réparations de la perte de travail se détruisaient donc l'une l'autre à leur jonction.
 * `discard()` ancre avant de supprimer ; ce chemin-là ne le faisait pas.
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

describe('le balayage des coquilles n’emporte jamais un commit orphelin', () => {
  it('ancre le travail avant de retirer la coquille', () => {
    const repo = tempRepo()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-balayage-'))
    roots.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })

    const chemin = join(racine, 'agent__run-coquille')
    git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
    writeFileSync(join(chemin, 'apport.txt'), 'du vrai travail\n')
    git(chemin, 'add', '-A')
    git(chemin, 'commit', '-q', '-m', 'agent run-coquille')
    const sha = git(chemin, 'rev-parse', 'HEAD')
    // Le résidu d'un `worktree remove` interrompu : les fichiers de travail sont partis, le commit
    // reste. C'est exactement l'état que ce balayage cible.
    unlinkSync(join(chemin, 'apport.txt'))
    for (const nom of readdirSync(chemin)) {
      if (nom !== '.git') rmSync(join(chemin, nom), { recursive: true, force: true })
    }

    wm.balayerLesCoquilles()

    // Le travail doit rester ATTEIGNABLE — par une branche de secours, comme le fait `discard`.
    const refs = git(repo, 'for-each-ref', '--contains', sha, '--format=%(refname)')
    expect(refs).toContain('autowin/recovery/run-coquille')
  })

  it('retire quand même une coquille qui ne porte AUCUN commit propre', () => {
    // L'autre bord : ancrer tout ferait grossir le stock de branches pour rien, et ce balayage
    // existe pour libérer du disque.
    const repo = tempRepo()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-balayage-'))
    roots.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })

    const chemin = join(racine, 'agent__run-vraiment-vide')
    git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
    for (const nom of readdirSync(chemin)) {
      if (nom !== '.git') rmSync(join(chemin, nom), { recursive: true, force: true })
    }

    expect(wm.balayerLesCoquilles()).toContain('agent__run-vraiment-vide')
  })
})
