import { afterEach, describe, expect, it } from 'vitest'
/**
 * LE DÉFAUT, mesuré le 2026-11-20 (conv-2055) : le dossier partagé d'un projet avait été sorti de sa
 * branche par erreur (`git checkout --detach`, conv-2041). Le lancement suivant lisait « HEAD » comme
 * nom de branche et mourait sur `git rev-parse refs/heads/HEAD` — un message que personne ne peut
 * lire, et un lot de plan perdu sans qu'aucun agent ne puisse réparer (le garde-fou des copies leur
 * interdit, à juste titre, d'écrire dans le dossier partagé).
 *
 * Ce qui est attendu :
 *  - tête détachée SUR la pointe de main : le dossier est remis sur main (aucun fichier ne bouge) et
 *    le lancement part ;
 *  - tête détachée AILLEURS : refus qui dit, en clair, où est le dossier et quoi faire, sans rien
 *    toucher.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'
import { racineDe, git, roots, tempRepo } from './worktree-manager.test-helpers'

afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* verrou windows */
    }
  }
})

function gestionnaire(repo: string): WorktreeManager {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-detache-'))
  roots.push(racine)
  return new WorktreeManager({ racineCopiesDeTaches: racineDe(racine), baseRepo: repo, worktreeRoot: racine })
}

describe('lancer quand le dossier partagé n’est sur aucune branche', () => {
  it('tête détachée sur la pointe de main : remis sur main, sans toucher aux fichiers, et le lancement part', () => {
    const repo = tempRepo()
    const pointe = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'checkout', '-q', '--detach', pointe)
    // Un fichier en cours d'écriture chez l'utilisateur : il doit rester tel quel.
    writeFileSync(join(repo, 'a.txt'), 'travail en cours\n')

    const contexte = gestionnaire(repo).describe('conv-1')

    expect(contexte).toMatchObject({ baseBranch: 'main', baseSha: pointe })
    expect(git(repo, 'symbolic-ref', '--short', 'HEAD')).toBe('main')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('travail en cours\n')
  })

  it('tête détachée ailleurs (le cas de conv-2055 : un commit au-delà de main) : refus en clair, rien ne bouge', () => {
    const repo = tempRepo()
    git(repo, 'checkout', '-q', '--detach')
    writeFileSync(join(repo, 'b.txt'), 'x\n')
    git(repo, 'add', 'b.txt')
    git(repo, 'commit', '-q', '-m', 'hors branche')
    const tete = git(repo, 'rev-parse', 'HEAD')

    let message = ''
    try {
      gestionnaire(repo).describe('conv-1')
    } catch (e) {
      message = String((e as Error).message)
    }

    expect(message).not.toContain('refs/heads/HEAD')
    expect(message).toContain('aucune branche')
    expect(message).toContain(tete.slice(0, 7))
    expect(message).toContain('1 commit')
    expect(message).toContain('switch main')
    // Rien n'a bougé : toujours détaché, au même endroit.
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(tete)
    expect(() => git(repo, 'symbolic-ref', '-q', 'HEAD')).toThrow()
  })

  it('contrôle négatif : sur sa branche, le lancement est inchangé', () => {
    const repo = tempRepo()
    const pointe = git(repo, 'rev-parse', 'HEAD')

    expect(gestionnaire(repo).describe('conv-1')).toMatchObject({
      baseBranch: 'main',
      baseSha: pointe
    })
  })
})
