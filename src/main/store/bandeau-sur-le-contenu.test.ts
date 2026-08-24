import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { git, roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * LE DÉFAUT, vécu le 2026-08-24. Le bandeau « travail non publié » jugeait sur l'ASCENDANCE seule
 * (`for-each-ref --no-merged`). Une branche dont le contenu était DÉJÀ dans la base — republié,
 * repris à la main, ou passé par un cherry-pick — restait donc signalée pour toujours. L'utilisateur
 * l'a vu sur un travail bel et bien publié, et le seul moyen de l'éteindre était une fusion de
 * scellement dont le diff était vide : on modifiait l'historique pour faire taire un affichage.
 *
 * `git cherry` répond à la vraie question, parce qu'il compare par `patch-id` : il reconnaît un
 * commit réappliqué sous un autre SHA. C'est exactement ce que produit un cherry-pick — et c'est la
 * méthode de publication qui a créé le problème.
 *
 * LES DEUX BORDS COMPTENT AUTANT. Se taire sur un travail publié, oui. Mais ne JAMAIS taire un
 * travail qui n'est pas publié : ce bandeau existe parce que trois travaux finis ont été perdus de
 * vue en une journée.
 *
 * RESERVE HONNETE SUR CES TESTS. Le sabotage a ete mesure sur trois tirages : retirer le filtre fait
 * tomber au moins un test a chaque fois (2, 1, 1), et avec le filtre les quatre passent 3 fois sur 3.
 * La discrimination est donc reelle. Mais le NOMBRE d'echecs varie d'un tirage a l'autre, ce qui
 * trahit une sensibilite a l'ordre -- ces tests partagent `roots` et manipulent de vrais depots git.
 * A resserrer si un jour ils deviennent le signal d'un run, plutot que la preuve d'un correctif.
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

const monter = (): { repo: string; wm: WorktreeManager } => {
  const repo = tempRepo()
  const racine = mkdtempSync(join(tmpdir(), 'autowin-bandeau-'))
  roots.push(racine)
  return { repo, wm: new WorktreeManager({ baseRepo: repo, worktreeRoot: racine }) }
}

/** Une branche de secours portant un vrai commit, comme en produit `preserverEtLiberer`. */
const brancheDeSecours = (repo: string, agentId: string, fichier: string, contenu: string): void => {
  const depart = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'branch', `autowin/recovery/${agentId}`, depart)
  const wt = mkdtempSync(join(tmpdir(), 'autowin-br-'))
  roots.push(wt)
  const chemin = join(wt, 'copie')
  git(repo, 'worktree', 'add', '-q', chemin, `autowin/recovery/${agentId}`)
  writeFileSync(join(chemin, fichier), contenu)
  git(chemin, 'add', '-A')
  git(chemin, 'commit', '-q', '-m', `travail de ${agentId}`)
  execFileSync('git', ['worktree', 'remove', '--force', chemin], { cwd: repo })
}

describe('le bandeau juge sur le CONTENU, plus sur la seule ascendance', () => {
  it('SIGNALE une branche qui apporte du travail que la base n’a pas', () => {
    // Le bord qui compte le plus : ce bandeau existe parce que des travaux finis ont été perdus.
    const { repo, wm } = monter()
    brancheDeSecours(repo, 'run-neuf', 'apport.txt', 'du vrai travail\n')

    expect(wm.travauxNonPublies()).toContain('run-neuf')
  })

  it('SE TAIT quand le contenu a été REPRIS sous un autre SHA — le cas du cherry-pick', () => {
    // Exactement ce qui a produit le défaut : publier par cherry-pick recrée un commit avec un
    // nouveau SHA, donc l'ascendance ne voit rien, alors que le contenu est là.
    const { repo, wm } = monter()
    brancheDeSecours(repo, 'run-repris', 'apport.txt', 'du vrai travail\n')
    const commit = git(repo, 'rev-parse', 'autowin/recovery/run-repris')
    git(repo, 'cherry-pick', commit)

    expect(wm.travauxNonPublies()).not.toContain('run-repris')
  })

  it('se tait aussi quand la branche est fusionnée — comportement d’avant, préservé', () => {
    const { repo, wm } = monter()
    brancheDeSecours(repo, 'run-fusionne', 'apport.txt', 'du vrai travail\n')
    git(repo, 'merge', '--no-ff', '--no-edit', 'autowin/recovery/run-fusionne')

    expect(wm.travauxNonPublies()).not.toContain('run-fusionne')
  })

  it('signale CHACUNE des branches qui apportent, sans se laisser distraire par une reprise', () => {
    const { repo, wm } = monter()
    brancheDeSecours(repo, 'run-a', 'a.txt', 'travail A\n')
    brancheDeSecours(repo, 'run-b', 'b.txt', 'travail B\n')
    git(repo, 'cherry-pick', git(repo, 'rev-parse', 'autowin/recovery/run-a'))

    const signales = wm.travauxNonPublies()

    expect(signales).toContain('run-b')
    expect(signales).not.toContain('run-a')
  })
})
