import { describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { sourceProcessPrincipal } from '../source-process-principal.test-helpers'

/**
 * LE GEL DE 11,7 s AU DEMARRAGE (mesure du 2026-09-08, `gels.jsonl` a 10:23:55).
 *
 * Le premier passage du balayage de retention posait UN `git cherry` par ref de secours -- 97 ce
 * jour-la -- en `execFileSync`, sur le thread principal, pendant la construction de la fenetre.
 * Ces controles verrouillent les deux moities du correctif : le recensement sait repondre sans
 * appel synchrone, ET le demarrage appelle bien cette voie-la.
 */
function managerDeTest(
  reponses: (repo: string, args: string[]) => { code: number; stdout: string }
) {
  return new WorktreeManager({
    baseRepo: 'D:/depot',
    worktreeRoot: 'D:/depot/.worktrees',
    tryGitFn: (repo, args) => ({ ...reponses(repo, args), stderr: '' })
  })
}

const REFS = [
  'refs/autowin/salvage/aaa 1111111 1700000000',
  'refs/autowin/trie/bbb 2222222 1700000000',
  'refs/heads/autowin/ccc 3333333 1700000000'
].join('\n')

describe('recensement de retention', () => {
  it('rend le MEME verdict en asynchrone qu en synchrone', async () => {
    const repondre = (_repo: string, args: string[]): { code: number; stdout: string } =>
      args[0] === 'cherry' ? { code: 0, stdout: '+ abc123\n' } : { code: 0, stdout: REFS }
    const manager = managerDeTest(repondre)

    const sync = manager.recenserRetention(() => false)
    const async = await manager.recenserRetentionAsync(
      () => false,
      async (repo, args) => repondre(repo, args)
    )

    // `ageMs` est calcule depuis l'horloge a chaque appel : les deux recensements sont pris a
    // quelques millisecondes d'ecart, donc on compare le VERDICT et on controle l'age a part.
    const sansAge = (entrees: typeof sync): unknown =>
      entrees.map(({ ageMs: _ageMs, ...reste }) => reste)

    expect(sansAge(async)).toEqual(sansAge(sync))
    expect(async.map((entree) => entree.apporteQuelqueChose)).toEqual([true, false, true])
    for (const [index, entree] of async.entries()) {
      expect(Math.abs((entree.ageMs ?? 0) - (sync[index].ageMs ?? 0))).toBeLessThan(5_000)
    }
  })

  it('n appelle AUCUN git synchrone par la voie asynchrone', async () => {
    const appelsSynchrones: string[][] = []
    const manager = managerDeTest((_repo, args) => {
      appelsSynchrones.push(args)
      return { code: 0, stdout: args[0] === 'cherry' ? '+ abc123\n' : REFS }
    })

    await manager.recenserRetentionAsync(
      () => false,
      async (_repo, args) => ({
        code: 0,
        stdout: args[0] === 'cherry' ? '+ abc123\n' : REFS
      })
    )

    // C'est LA propriété qui a gelé la fenêtre : un seul appel synchrone de trop la reproduit.
    expect(appelsSynchrones).toEqual([])
  })

  it('le passage de demarrage emprunte la voie asynchrone', () => {
    const source = sourceProcessPrincipal()

    expect(source).toContain('await worktrees.recenserRetentionAsync(')
    expect(source).not.toMatch(/planifierBalayage\(\s*worktrees\.recenserRetention\(/)
  })
})
