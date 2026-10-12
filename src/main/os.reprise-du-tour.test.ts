import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AutowinOS } from './os'
import { saveOrchestrationState } from './runs/orchestration-state'
import type { OrchestrationRunState } from './runs/orchestration-state'

/**
 * LA REPRISE VUE DEPUIS `os.ts`, SUR DE VRAIS FICHIERS.
 *
 * Les regles de decision sont testees seules (`acquired-analysis.test.ts`, `think-briefing.test.ts`) ;
 * ce fichier teste le BRANCHEMENT : les etats lus sur le disque, le `git diff` reel des fichiers que
 * le briefing cite, et le run vivant d'un tour (conv-890, 2026-09-30 : run-3180eec71b06-1 repris au
 * redemarrage, puis run-66d6d5bdfc5a-1 lance sur le MEME tour et `think` repaye 1,94 $).
 */
const dossiers: string[] = []
const temporaire = (prefixe: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefixe))
  dossiers.push(d)
  return d
}
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

function osSur(racineEtats: string, vivants: string[] = []): AutowinOS {
  const os = Object.create(AutowinOS.prototype) as AutowinOS
  Object.defineProperty(os, 'orchestrationStateRoot', { value: racineEtats })
  Object.defineProperty(os, 'liveOrchestrationRunIds', { value: new Set(vivants) })
  return os
}

const etat = (patch: Partial<OrchestrationRunState>): OrchestrationRunState =>
  ({
    runId: 'run-a',
    task: 'Traite ENSEMBLE ces 8 candidats',
    conversationId: 'conv-890',
    turnId: 'tour-386f',
    phaseOutputs: [{ phase: 'frame', text: 'cadre' }],
    startedAt: 1,
    updatedAt: Date.now() - 1_000,
    ...patch
  }) as OrchestrationRunState

describe('le run vivant d’un tour (os.liveOrchestrationForTurn)', () => {
  it('rend le run que ce process exécute pour CE tour de CETTE conversation', () => {
    const racine = temporaire('etats-')
    saveOrchestrationState(racine, etat({ runId: 'run-3180' }))
    saveOrchestrationState(racine, etat({ runId: 'run-autre-tour', turnId: 'tour-suivant' }))
    const os = osSur(racine, ['run-3180', 'run-autre-tour'])

    expect(os.liveOrchestrationForTurn('conv-890', 'tour-386f')).toBe('run-3180')
    expect(os.liveOrchestrationForTurn('conv-890', 'tour-inconnu')).toBeUndefined()
    expect(os.liveOrchestrationForTurn('conv-999', 'tour-386f')).toBeUndefined()
    expect(os.liveOrchestrationForTurn('conv-890', undefined)).toBeUndefined()
  })

  it('ignore un état du même tour que ce process n’exécute pas', () => {
    const racine = temporaire('etats-')
    saveOrchestrationState(racine, etat({ runId: 'run-3180' }))
    expect(osSur(racine, []).liveOrchestrationForTurn('conv-890', 'tour-386f')).toBeUndefined()
  })
})

describe('reprise du briefing think (os.acquiredAnalysisForConversation)', () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd,
      encoding: 'utf8'
    }).trim()

  function depotAvecBriefing(): { depot: string; racine: string; sha: string } {
    const depot = temporaire('depot-')
    mkdirSync(join(depot, 'src'))
    writeFileSync(join(depot, 'src', 'cite.ts'), 'export const a = 1\n')
    writeFileSync(join(depot, 'src', 'autre.ts'), 'export const b = 1\n')
    git(depot, 'init', '-q')
    git(depot, 'add', '.')
    git(depot, 'commit', '-q', '-m', 'base')
    const sha = git(depot, 'rev-parse', 'HEAD')
    const racine = temporaire('etats-')
    saveOrchestrationState(
      racine,
      etat({
        runId: 'run-3180',
        phaseOutputs: [
          { phase: 'think', text: '## Localisation\n- `src/cite.ts:1` lecture', codeSha: sha },
          { phase: 'frame', text: 'cadre' }
        ]
      })
    )
    return { depot, racine, sha }
  }

  it('reprend think pour le même tour quand aucun fichier cité n’a changé', async () => {
    const { depot, racine } = depotAvecBriefing()
    writeFileSync(join(depot, 'src', 'autre.ts'), 'export const b = 2\n')
    git(depot, 'commit', '-qam', 'fichier non cite')

    const acquis = await osSur(racine).acquiredAnalysisForConversation(
      'Dépôt : D:\\AutoWinOS. Traite ENSEMBLE ces 8 candidats',
      'conv-890',
      Date.now(),
      { turnId: 'tour-386f', workspace: depot }
    )

    expect(acquis.map((o) => o.phase)).toEqual(['think', 'frame'])
  })

  it('rejoue think quand un fichier cité a changé depuis le commit du briefing', async () => {
    const { depot, racine } = depotAvecBriefing()
    writeFileSync(join(depot, 'src', 'cite.ts'), 'export const a = 2\n')
    git(depot, 'commit', '-qam', 'fichier cite modifie')

    const acquis = await osSur(racine).acquiredAnalysisForConversation(
      'Traite ENSEMBLE ces 8 candidats',
      'conv-890',
      Date.now(),
      { turnId: 'tour-386f', workspace: depot }
    )

    expect(acquis.map((o) => o.phase)).toEqual(['frame'])
  })

  it('rejoue think quand git ne peut pas répondre (dossier hors dépôt)', async () => {
    const { racine } = depotAvecBriefing()
    const acquis = await osSur(racine).acquiredAnalysisForConversation(
      'Traite ENSEMBLE ces 8 candidats',
      'conv-890',
      Date.now(),
      { turnId: 'tour-386f', workspace: temporaire('hors-depot-') }
    )

    expect(acquis.map((o) => o.phase)).toEqual(['frame'])
  })
})
