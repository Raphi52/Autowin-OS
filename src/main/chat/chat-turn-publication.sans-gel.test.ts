import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationFileTrace } from '../activity/conversation-file-trace-spool'
import { exactLineFingerprint } from '../fichiers/exact-line-fingerprint'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import type { GitRunner } from '../runs/run-autoclose'
import { photographierDebutDeTour, publierTourDeChat } from './chat-turn-publication'

/**
 * GELS MESURÉS le 06/11/2026, après le correctif du journal des traces : six gels de 31 à 58 s de
 * la fenêtre en deux heures. Profil CPU de chacun : `publierTourDeChat`, la boucle sur les traces
 * (`cle` et `absoluDeTrace`, 96 à 98 % des relevés de pile), à chaque fin de tour d'un fil. Pour
 * chaque chemin d'une trace, ses empreintes étaient cherchées parmi tous les chemins de la même
 * trace, trois fois, avec deux `resolve` par comparaison : chemins². Le journal récent porte un
 * lot de 2 344 chemins.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const realGit: GitRunner = async (args, cwd) => (await run('git', args, { cwd })).stdout

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) supprimerArbre(d)
})

async function depot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'autowin-chat-pub-gel-'))
  dirs.push(root)
  const repo = join(root, 'work')
  const remote = join(root, 'remote.git')
  mkdirSync(repo)
  await run('git', ['init', '--bare', remote])
  await run('git', ['init', '-b', 'travail'], { cwd: repo })
  await run('git', ['config', 'user.email', 't@t.t'], { cwd: repo })
  await run('git', ['config', 'user.name', 'T'], { cwd: repo })
  writeFileSync(join(repo, 'base.txt'), 'base\n')
  await run('git', ['add', '-A'], { cwd: repo })
  await run('git', ['commit', '-m', 'base'], { cwd: repo })
  await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
  await run('git', ['push', 'origin', 'travail'], { cwd: repo })
  return repo
}

const DEBUT = 1_000_000

/** Un lot de `n` chemins avec empreintes avant/après et lignes, comme une publication de run. */
function gros(
  repo: string,
  conversationId: string,
  timestamp: string,
  n: number
): ConversationFileTrace {
  const chemins = Array.from({ length: n }, (_, i) => `src/dossier-${i % 50}/fichier-${i}.ts`)
  const parChemin = <T>(valeur: (i: number) => T): Record<string, T> =>
    Object.fromEntries(chemins.map((chemin, i) => [chemin, valeur(i)]))
  return {
    timestamp,
    conversationId,
    turnId: `tour-${conversationId}`,
    workspaceRoot: repo,
    source: 'subagent',
    paths: chemins,
    pathFingerprints: parChemin((i) => `apres-${i}`),
    pathBaseFingerprints: parChemin(() => null),
    pathLineFingerprints: parChemin((i) => [`ligne-${i}`])
  }
}

describe('enchaînement auto du chat — publier sans tenir la fenêtre', () => {
  it('deux lots de 3 000 chemins dans le journal : le tour publie le sien en moins de 10 s', async () => {
    const repo = await depot()
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    writeFileSync(join(repo, 'mine.ts'), 'export const a = 1\n')

    const depart = performance.now()
    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A',
      request: 'ajoute la constante a',
      debut,
      runGit: realGit,
      traces: [
        // Un lot d'un autre fil AVANT le tour, et un autre PENDANT : les deux cas de la boucle.
        gros(repo, 'conv-B', new Date(DEBUT - 5_000).toISOString(), 3_000),
        gros(repo, 'conv-C', new Date(DEBUT + 5_000).toISOString(), 3_000),
        {
          timestamp: new Date(DEBUT + 6_000).toISOString(),
          conversationId: 'conv-A',
          turnId: 'tour-A',
          workspaceRoot: repo,
          source: 'chat_tool',
          paths: ['mine.ts'],
          pathLineFingerprints: { 'mine.ts': [exactLineFingerprint('export const a = 1')] }
        }
      ]
    })
    const dureeMs = performance.now() - depart

    expect(report).toMatchObject({ project: { status: 'pushed', files: 1 } })
    expect(dureeMs, `publication du tour : ${Math.round(dureeMs)} ms`).toBeLessThan(10_000)
  })
})
