import { afterEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'

/**
 * « JE PASSE MA VIE A /SALVAGE » (2026-09-04).
 *
 * L'outil `edit_file` travaille dans une copie isolee `command-edit-<...>` et ne publie QUE si la
 * verification passe. Une copie `command-edit-*` qui survit est donc une edition REFUSEE par le
 * test : la fusionner remettrait du rouge dans la base. Le recensement la comptait pourtant comme
 * « travail termine jamais publie ».
 *
 * Mesure sur l'installation ce jour-la : 30 branches de secours, 23 sauvetages, 134 marqueurs
 * `refs/autowin/trie/`. L'outil qui ecrit le code alimentait lui-meme la file qu'il demandait de
 * trier — le bandeau ne pouvait pas se vider.
 *
 * Ce qui doit rester vrai : un travail de RUN continue de crier. C'est le seul qui porte du travail
 * acheve non publie.
 */
describe('WorktreeManager — une edition d’outil refusee ne remplit plus la file de tri', () => {
  afterEach(() => nettoyerRacines())

  function brancheDeSecours(repo: string, agentId: string, fichier: string): string {
    const base = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'branch', `autowin/recovery/${agentId}`, base)
    writeFileSync(join(repo, fichier), 'contenu du travail\n')
    git(repo, 'add', fichier)
    git(repo, 'commit', '-q', '-m', `travail ${agentId}`)
    const sha = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'update-ref', `refs/heads/autowin/recovery/${agentId}`, sha)
    git(repo, 'reset', '-q', '--hard', base)
    return sha
  }

  it('une copie `command-edit-*` se tait, un `run-*` crie toujours', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const shaEdition = brancheDeSecours(repo, 'command-edit-conv-9-chatview-css-1ktkiqs', 'edit.txt')
    brancheDeSecours(repo, 'command-verify-conv-9', 'verif.txt')
    brancheDeSecours(repo, 'run-abc123-1', 'run.txt')

    const releve = wm.travauxNonPublies()

    expect(releve).not.toContain('command-edit-conv-9-chatview-css-1ktkiqs')
    expect(releve).not.toContain('command-verify-conv-9')
    expect(releve).toContain('run-abc123-1')
    // Rien n'est detruit : la branche de secours de l'edition repond toujours.
    expect(git(repo, 'rev-parse', 'autowin/recovery/command-edit-conv-9-chatview-css-1ktkiqs')).toBe(
      shaEdition
    )
  })
})
