import { describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'

/**
 * Gel mesure le 2026-10-10 (`gels.jsonl`) : `git worktree add` en execFileSync depuis
 * `restaurerCopieDepuisSecours` a tenu le thread principal 6 416 ms. La version async doit
 * passer par l'executeur asynchrone, jamais par le runner synchrone.
 */
describe('restaurerCopieDepuisSecoursAsync', () => {
  it("passe par l'executeur asynchrone et ne touche jamais au git synchrone", async () => {
    let appelsSync = 0
    const git = () => {
      appelsSync += 1
      return ''
    }
    const wm = new WorktreeManager({
      baseRepo: 'C:/depot-inexistant',
      worktreeRoot: 'C:/depot-inexistant/.autowin-data/wt',
      git
    } as never)
    appelsSync = 0
    const recus: string[][] = []
    const ok = await wm.restaurerCopieDepuisSecoursAsync('run-1', async (_repo, args) => {
      recus.push(args)
      return { code: 0, stdout: '' }
    })
    expect(appelsSync).toBe(0)
    expect(recus).toHaveLength(1)
    expect(recus[0]).toContain('worktree')
    expect(recus[0]).toContain('autowin/recovery/run-1')
    // Le dossier n'existe pas (executeur factice) : la restauration est rapportee en echec.
    expect(ok).toBe(false)
  })

  it('refuse un identifiant non sur sans lancer git', async () => {
    const wm = new WorktreeManager({ baseRepo: 'C:/x', worktreeRoot: 'C:/x/wt', git: () => '' } as never)
    let appels = 0
    const ok = await wm.restaurerCopieDepuisSecoursAsync('../evil', async () => {
      appels += 1
      return { code: 0, stdout: '' }
    })
    expect(ok).toBe(false)
    expect(appels).toBe(0)
  })
})
