import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'
import { nettoyerRacines, racineDe, roots } from './worktree-manager.test-helpers'

/**
 * Mesure (gels.jsonl, 2026-09-23/24) : `execFileSync git rev-parse` ×3 par appel, depuis
 * `ownershipIssue` (timer:balayage:retention, ipc:os:pilotChat:active) — jusqu'à 2 353 ms.
 * Cause : `--git-common-dir` de la copie était demandé DEUX fois (foreignCopyDetail puis le
 * contrôle final). Contrat : une seule sonde `--git-common-dir` par copie et par vérification.
 */

afterEach(nettoyerRacines)

const echappe = (texte: string): string => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Un dépôt témoin sous le dossier temporaire. Seuls les appels git sont simulés : le disque n'est
 * jamais lu ni écrit à ces chemins.
 */
function depotTemoin(): {
  base: string
  wt: string
  copie: string
  commun: string
  autre: string
} {
  const dossier = mkdtempSync(join(tmpdir(), 'appartenance-'))
  roots.push(dossier)
  const base = join(dossier, 'depot')
  const wt = join(base, '.autowin-data', 'wt')
  return {
    base,
    wt,
    copie: join(wt, 'agent__x'),
    commun: join(base, '.git'),
    autre: join(dossier, 'ailleurs', '.git')
  }
}

describe('ownershipIssue — un seul sondage git-common-dir par copie', () => {
  it('ne relance pas git pour une valeur déjà obtenue', () => {
    const { base, wt, copie, commun } = depotTemoin()
    const appels: string[] = []
    const tryGitFn = (dir: string, args: string[]) => {
      appels.push(`${dir} ${args.join(' ')}`)
      if (args.includes('--git-common-dir') && args.includes('--show-toplevel'))
        return { code: 0, stdout: `${commun}\n${dir}\n`, stderr: '' }
      if (args.includes('--git-common-dir')) return { code: 0, stdout: `${commun}\n`, stderr: '' }
      if (args.includes('--show-toplevel')) return { code: 0, stdout: `${dir}\n`, stderr: '' }
      return { code: 1, stdout: '', stderr: '' }
    }
    const wm = new WorktreeManager({
      racineCopiesDeTaches: racineDe(wt),
      baseRepo: base,
      worktreeRoot: wt,
      tryGitFn
    } as never)
    const issue = (
      wm as unknown as { ownershipIssue(p: string): string | undefined }
    ).ownershipIssue(copie)
    expect(issue).toBeUndefined()
    expect(
      appels.filter((a) => a.startsWith(copie) && a.includes('--git-common-dir'))
    ).toHaveLength(1)
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
  type Sortie = { code: number; stdout: string; stderr: string }
  type Forme = {
    ownershipIssue(p: string): string | undefined
    ownershipIssueAsync(p: string): Promise<string | undefined>
  }

  const { base, wt, copie, commun, autre } = depotTemoin()
  const cas: Array<{ nom: string; sonde: Sortie; attendu: RegExp | undefined }> = [
    {
      nom: 'copie légitime (accepté)',
      sonde: { code: 0, stdout: `${commun}\n${copie}\n`, stderr: '' },
      attendu: undefined
    },
    {
      nom: 'copie d’un autre dépôt',
      sonde: { code: 0, stdout: `${autre}\n${copie}\n`, stderr: '' },
      attendu: new RegExp(`^La copie appartient à un autre dépôt \\(${echappe(autre)}\\)`)
    },
    {
      nom: 'dossier amputé : git remonte sur la base',
      sonde: { code: 0, stdout: `${commun}\n${base}\n`, stderr: '' },
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
          return { code: 0, stdout: `${commun}\n`, stderr: '' }
        if (dir === copie) return sonde
        return { code: 1, stdout: '', stderr: '' }
      }
      const synchrone = new WorktreeManager({
        racineCopiesDeTaches: racineDe(wt),
        baseRepo: base,
        worktreeRoot: wt,
        tryGitFn: repondre
      } as never) as unknown as Forme
      const appelsSynchrones: string[] = []
      const asynchrone = new WorktreeManager({
        racineCopiesDeTaches: racineDe(wt),
        baseRepo: base,
        worktreeRoot: wt,
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
