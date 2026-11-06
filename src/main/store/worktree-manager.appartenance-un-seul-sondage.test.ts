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

/**
 * LA FORME ASYNCHRONE DU BALAYAGE HORAIRE (2026-11-06) : `gels.jsonl` porte 4 465 et 4 900 ms
 * de fenêtre figée par la sonde synchrone d'`ownershipIssue`. `ownershipIssueAsync` doit rendre le
 * MÊME verdict, refus compris, sans jamais passer par `tryGitFn`. Chaque refus a son jumeau accepté :
 * la copie légitime, seule à rendre `undefined`.
 */
describe('ownershipIssueAsync — même verdict que la forme synchrone, sans git synchrone', () => {
  const base = 'C:/depot'
  const copie = 'C:/depot/.autowin-data/wt/agent__x'
  type Sortie = { code: number; stdout: string; stderr: string }
  type Forme = {
    ownershipIssue(p: string): string | undefined
    ownershipIssueAsync(p: string): Promise<string | undefined>
  }
  const cas: Array<{ nom: string; sonde: Sortie; attendu: RegExp | undefined }> = [
    {
      nom: 'copie légitime (accepté)',
      sonde: { code: 0, stdout: `C:/depot/.git\n${copie}\n`, stderr: '' },
      attendu: undefined
    },
    {
      nom: 'copie d’un autre dépôt',
      sonde: { code: 0, stdout: `C:/ailleurs/.git\n${copie}\n`, stderr: '' },
      attendu: /^La copie appartient à un autre dépôt \(C:\/ailleurs\/\.git\)/
    },
    {
      nom: 'dossier amputé : git remonte sur la base',
      sonde: { code: 0, stdout: `C:/depot/.git\n${base}\n`, stderr: '' },
      attendu: /n’est pas une racine de travail : git remonte sur/
    },
    {
      nom: 'git muet sur la copie',
      sonde: { code: 128, stdout: '', stderr: 'fatal: not a git repository' },
      attendu: /^Impossible de prouver la racine de travail de la copie/
    }
  ]

  for (const { nom, sonde, attendu } of cas) {
    it(nom, async () => {
      const repondre = (dir: string, args: string[]): Sortie => {
        if (dir === base && args.join(' ') === 'rev-parse --git-common-dir')
          return { code: 0, stdout: 'C:/depot/.git\n', stderr: '' }
        if (dir === copie) return sonde
        return { code: 1, stdout: '', stderr: '' }
      }
      const synchrone = new WorktreeManager({
        baseRepo: base,
        worktreeRoot: 'C:/depot/.autowin-data/wt',
        tryGitFn: repondre
      } as never) as unknown as Forme
      const appelsSynchrones: string[] = []
      const asynchrone = new WorktreeManager({
        baseRepo: base,
        worktreeRoot: 'C:/depot/.autowin-data/wt',
        tryGitFn: (dir: string, args: string[]) => {
          appelsSynchrones.push(`${dir} ${args.join(' ')}`)
          return repondre(dir, args)
        },
        tryGitAsyncFn: async (dir: string, args: string[]) => repondre(dir, args)
      } as never) as unknown as Forme

      const verdictSynchrone = synchrone.ownershipIssue(copie)
      const verdictAsynchrone = await asynchrone.ownershipIssueAsync(copie)

      if (attendu) expect(verdictAsynchrone).toMatch(attendu)
      else expect(verdictAsynchrone).toBeUndefined()
      expect(verdictAsynchrone).toBe(verdictSynchrone)
      expect(appelsSynchrones).toEqual([])
    })
  }
})
