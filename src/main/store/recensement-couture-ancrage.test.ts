import { rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { git, roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * LA COUTURE ENTRE DEUX CHANTIERS MENÉS EN PARALLÈLE, le 2026-08-26.
 *
 * Deux sessions ont attaqué la même perte de travail par deux bouts :
 *   - l'ancrage avant suppression (`ancrerAvantSuppression`) pose une branche de secours AVANT de
 *     détruire un bureau — il tarit la production d'orphelins ;
 *   - le recensement des HEAD détachés voit les bureaux vivants dont le commit n'a aucune ref.
 *
 * Elles sont complémentaires, pas rivales : l'ancrage ferme même la limite que l'audit avait
 * relevée sur le recensement (un commit ayant perdu ET sa ref ET son dossier). Mais leur COUTURE
 * n'était couverte par aucun test : un bureau à la fois ANCRÉ et encore SUR DISQUE est vu par les
 * deux chemins à la fois.
 *
 * Les deux dangers symétriques, et c'est pour ça que ce test existe :
 *   - le compter DEUX FOIS ferait un bandeau qui ment sur le volume ;
 *   - le compter ZÉRO fois (chaque chemin croyant que l'autre s'en charge) reperdrait le travail —
 *     exactement le défaut d'origine, recréé par la jonction de ses deux réparations.
 *
 * CE QUE LE SABOTAGE A APPRIS. Retirer le seul déduplicateur ne fait PAS tomber ce test : le filtre
 * d'orphelinat écarte déjà le bureau ancré du chemin détaché, puisqu'une ref le contient. Deux
 * mécanismes indépendants protègent donc la même propriété, et aucun ne se laisse retirer seul.
 * Les sabotages qui mordent vraiment sont ceux qui cassent un BORD :
 *   - retirer le chemin des branches → `[]` (le travail disparaît) ;
 *   - retirer déduplicateur ET orphelinat → deux entrées.
 * Ce test verrouille la propriété, pas une ligne : c'est ce qu'on veut d'une couture entre deux
 * chantiers qui vont continuer à bouger séparément.
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

describe('un bureau à la fois ancré et vivant est compté UNE fois', () => {
  it('exactement une entrée, jamais deux, jamais zéro', () => {
    const repo = tempRepo()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-couture-'))
    roots.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })

    // Un bureau vivant qui a produit du travail…
    const chemin = join(racine, 'agent__run-double')
    git(repo, 'worktree', 'add', '-q', '--detach', chemin, 'HEAD')
    writeFileSync(join(chemin, 'apport.txt'), 'du vrai travail\n')
    git(chemin, 'add', '-A')
    git(chemin, 'commit', '-q', '-m', 'agent run-double')
    const sha = git(chemin, 'rev-parse', 'HEAD')

    // …et qui a AUSSI été ancré, comme le fait l'autre chantier avant toute suppression.
    git(repo, 'branch', '-f', 'autowin/recovery/run-double', sha)

    const recense = wm.travauxNonPublies()

    expect(recense.filter((id) => id === 'run-double')).toHaveLength(1)
  })
})
