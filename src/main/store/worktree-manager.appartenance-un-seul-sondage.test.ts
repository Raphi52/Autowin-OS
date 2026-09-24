import { describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'

/**
 * Mesure (gels.jsonl, 2026-09-23/24) : `execFileSync git rev-parse` ×3 par appel, depuis
 * `ownershipIssue` (timer:balayage:retention, ipc:os:pilotChat:active) — jusqu'à 2 353 ms.
 * Cause : `--git-common-dir` de la copie était demandé DEUX fois (foreignCopyDetail puis le
 * contrôle final). Contrat : une seule sonde `--git-common-dir` par copie et par vérification.
 */
describe('ownershipIssue — un seul sondage git-common-dir par copie', () => {
  it('ne relance pas git pour une valeur déjà obtenue', () => {
    const base = 'C:/depot'
    const copie = 'C:/depot/.autowin-data/wt/agent__x'
    const appels: string[] = []
    const tryGitFn = (dir: string, args: string[]) => {
      appels.push(`${dir} ${args.join(' ')}`)
      if (args.includes('--git-common-dir') && args.includes('--show-toplevel'))
        return { code: 0, stdout: `C:/depot/.git\n${dir}\n`, stderr: '' }
      if (args.includes('--git-common-dir')) return { code: 0, stdout: 'C:/depot/.git\n', stderr: '' }
      if (args.includes('--show-toplevel')) return { code: 0, stdout: `${dir}\n`, stderr: '' }
      return { code: 1, stdout: '', stderr: '' }
    }
    const wm = new WorktreeManager({ baseRepo: base, worktreeRoot: 'C:/depot/.autowin-data/wt', tryGitFn } as never)
    const issue = (wm as unknown as { ownershipIssue(p: string): string | undefined }).ownershipIssue(copie)
    expect(issue).toBeUndefined()
    expect(appels.filter((a) => a.startsWith(copie) && a.includes('--git-common-dir'))).toHaveLength(1)
    // Un seul lancement git sur la copie par verification (etait 3 : gels.jsonl 2026-09-24).
    expect(appels.filter((a) => a.startsWith(copie))).toHaveLength(1)
  })
})
