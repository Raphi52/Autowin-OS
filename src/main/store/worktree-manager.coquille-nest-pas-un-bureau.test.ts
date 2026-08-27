import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { git, roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * LE DÉFAUT, vécu le 2026-08-27 (conv-1428).
 *
 * Un salvage retire un bureau par `git worktree remove`. Git supprime les fichiers VERSIONNÉS, mais
 * pas `node_modules` — ignoré, donc jamais à lui. Le dossier `agent__<id>` survit ainsi sans son
 * `.git`, et `listAgentIds()` le scanne toujours : c'est un nom de bureau sous la racine.
 *
 * `bureauPorteDuTravailNonCommitte` interrogeait alors git DANS cette coquille. Git ne refuse pas :
 * il REMONTE au dépôt parent. `rev-parse HEAD` rend le HEAD de la base — un sha valide, donc le
 * garde-fou du HEAD non né ne mord pas — et `status --porcelain` rend les modifications de l'ARBRE
 * PRINCIPAL. Résultat mesuré : les quatre fichiers en cours de l'utilisateur dans `main` annoncés
 * comme « travail non publié » d'un bureau qui n'existait plus, et un bandeau que rien ne pouvait
 * éteindre — supprimer la branche de secours n'y changeait rien, la cause était ailleurs.
 *
 * Les deux bords comptent, et c'est pourquoi la garde est une PRÉSENCE de `.git` et non un
 * balayage : taire un vrai travail non committé le fait refaire, mais crier sur le travail de
 * l'arbre principal fabrique le bandeau qu'on n'écoute plus.
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

describe('recensement — une coquille de bureau ne parle pas pour l’arbre principal', () => {
  it('reste MUET sur un dossier agent__ qui ne porte que node_modules, même si la base est sale', () => {
    const repo = tempRepo()
    // La racine des bureaux vit SOUS le dépôt, comme `.autowin-data` en production : c'est cette
    // imbrication qui permet à git de remonter au parent depuis une coquille.
    const racine = join(repo, '.autowin-data', 'worktrees')
    mkdirSync(racine, { recursive: true })

    // La coquille : un dossier de bureau sans `.git`, portant son seul `node_modules`.
    const coquille = join(racine, 'agent__run-coquille-1')
    mkdirSync(join(coquille, 'node_modules'), { recursive: true })
    writeFileSync(join(coquille, 'node_modules', 'index.js'), 'module.exports = {}\n')

    // L'ARBRE PRINCIPAL est sale — c'est ce que la coquille faisait remonter à tort.
    writeFileSync(join(repo, 'travail-en-cours.txt'), 'modification de l’utilisateur\n')
    expect(git(repo, 'status', '--porcelain')).not.toBe('')

    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })
    expect(wm.travauxNonPublies()).toEqual([])
  })

  it('parle encore d’un VRAI bureau sale — la garde ne rend pas le recensement aveugle', () => {
    const repo = tempRepo()
    const racine = join(repo, '.autowin-data', 'worktrees')
    mkdirSync(racine, { recursive: true })

    const bureau = join(racine, 'agent__run-vrai-1')
    git(repo, 'worktree', 'add', '-q', '--detach', bureau, 'HEAD')
    writeFileSync(join(bureau, 'livrable.txt'), 'travail jamais committé\n')

    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })
    expect(wm.travauxNonPublies()).toContain('run-vrai-1')
  })
})
