import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { nettoyerRacines, racineDe, roots } from './worktree-manager.test-helpers'

/**
 * Gel mesure le 2026-10-10 (`gels.jsonl`) : `git worktree add` en execFileSync depuis
 * `restaurerCopieDepuisSecours` a tenu le thread principal 6 416 ms. La version async doit
 * passer par l'executeur asynchrone, jamais par le runner synchrone.
 */

afterEach(nettoyerRacines)

/** Un dossier témoin sous le dossier temporaire ; le dépôt qu'il contient n'existe pas. */
function dossierTemoin(): string {
  const dossier = mkdtempSync(join(tmpdir(), 'restauration-'))
  roots.push(dossier)
  return dossier
}

describe('restaurerCopieDepuisSecoursAsync', () => {
  it("passe par l'executeur asynchrone et ne touche jamais au git synchrone", async () => {
    const depot = join(dossierTemoin(), 'depot-absent')
    const wt = join(depot, '.autowin-data', 'wt')
    let appelsSync = 0
    const git = () => {
      appelsSync += 1
      return ''
    }
    const wm = new WorktreeManager({
      racineCopiesDeTaches: racineDe(wt),
      baseRepo: depot,
      worktreeRoot: wt,
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
    const depot = join(dossierTemoin(), 'depot')
    const wt = join(depot, 'wt')
    const wm = new WorktreeManager({
      racineCopiesDeTaches: racineDe(wt),
      baseRepo: depot,
      worktreeRoot: wt,
      git: () => ''
    } as never)
    let appels = 0
    const ok = await wm.restaurerCopieDepuisSecoursAsync('../evil', async () => {
      appels += 1
      return { code: 0, stdout: '' }
    })
    expect(ok).toBe(false)
    expect(appels).toBe(0)
  })
})
