import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * TROU NOIR MESURÉ le 2026-09-07 sur conv-42 : entre 09:06 et 09:27 le fil n'a reçu AUCUNE ligne.
 * Journal du tour (`turn-journals/conv-42/0cea1626….jsonl`) : `action-progress` à 1788764779503
 * (fin de `frame`) puis plus rien jusqu'à 1788766075667 (fin de `build`) — 21 min 36 s de silence.
 *
 * Le fournisseur BAT pourtant toutes les 30 s : `claude.ts` traduit `tool_progress` en
 * `chunk.status` (« Bash en cours - 2 min 30 s - vitest run »). Le pilote de chat lit ce champ
 * (`agent-pilot.ts`, événement `provider-status`) ; le flux de phase de l'orchestrateur ne le
 * lisait pas. Le battement existait donc et était jeté — ce test le rattrape.
 */
class ProviderQuiBat implements ProviderAdapter {
  readonly id = 'sub'
  readonly supportsExecution = true
  async auth(): Promise<boolean> {
    return true
  }
  async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
    yield { delta: '', status: 'Bash en cours - 2 min 30 s - vitest run' }
    yield { delta: 'VALIDE' }
    return {
      text: 'VALIDE',
      provider: this.id,
      model: 'claude-opus',
      systemInjected: true,
      usage: { inputTokens: 1, outputTokens: 1 }
    }
  }
}

function orchestrateur(provider: ProviderAdapter): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'claude-opus' },
      subagent: { provider: provider.id, model: 'claude-opus' },
      judge: { provider: provider.id, model: 'claude-opus' },
      scout: { provider: provider.id, model: 'claude-opus' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    execPhases: ['build'],
    sleep: async () => undefined
  })
}

describe("Orchestrateur — le battement d'outil d'une phase atteint le fil", () => {
  it('relaie chunk.status sur le canal de note, au lieu de le jeter', async () => {
    const notes: string[] = []
    await orchestrateur(new ProviderQuiBat()).run(
      'corrige le défaut nommé',
      undefined,
      undefined,
      (_step, _delta, note) => {
        if (note) notes.push(note)
      }
    )
    expect(notes).toContain('Bash en cours - 2 min 30 s - vitest run')
  })
})

/**
 * LE MÊME TROU, SUR LES DEUX AUTRES CHEMINS DE L'ÉTAPE (conv-1085, 2026-10-22).
 *
 * Le correctif de conv-42 ne couvrait que le chemin « binding du rôle ». Sur ce poste, `build` a un
 * modèle attitré (bloc topology) : elle passe par le chemin fan-out, dont le rappel de flux ne lisait
 * que `delta` et `reasoning`. Mesuré sur conv-1069, conv-1070 et conv-1077 : 0 ligne d'outil au fil
 * pendant 46 à 53 min de build, contre 63 à 110 pendant think et clean. Le fil n'affichait plus que
 * « réfléchit… » et l'utilisateur concluait à un gel. Le chemin des sous-tâches avait le même trou.
 */
function orchestrateurAvecTopologie(
  provider: ProviderAdapter,
  modeles: string[],
  extra: Partial<ConstructorParameters<typeof Orchestrator>[0]> = {}
): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'claude-opus' },
      subagent: { provider: provider.id, model: 'claude-opus' },
      judge: { provider: provider.id, model: 'claude-opus' },
      scout: { provider: provider.id, model: 'claude-opus' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    sleep: async () => undefined,
    phaseFanOut: (phase) =>
      phase === 'build' ? modeles.map((model) => ({ provider: provider.id, model })) : [],
    ...extra
  })
}

async function notesDuRun(orchestrateur: Orchestrator): Promise<string[]> {
  const notes: string[] = []
  await orchestrateur.run(
    'corrige le défaut nommé',
    undefined,
    undefined,
    (_step, _delta, note) => {
      if (note) notes.push(note)
    }
  )
  return notes
}

describe("Orchestrateur — le battement d'outil atteint le fil sur TOUS les chemins de build", () => {
  it('build à modèle attitré (un seul membre) : la ligne part telle quelle', async () => {
    const notes = await notesDuRun(
      orchestrateurAvecTopologie(new ProviderQuiBat(), ['opus-attitre'], { execPhases: ['build'] })
    )
    expect(notes).toContain('Bash en cours - 2 min 30 s - vitest run')
  })

  it('build à plusieurs modèles en parallèle : chaque ligne dit QUEL modèle agit', async () => {
    const notes = await notesDuRun(
      orchestrateurAvecTopologie(new ProviderQuiBat(), ['m1', 'm2'], { execPhases: ['build'] })
    )
    expect(notes).toContain('m1 · Bash en cours - 2 min 30 s - vitest run')
    expect(notes).toContain('m2 · Bash en cours - 2 min 30 s - vitest run')
  })

  it('build découpé en sous-tâches : chaque ligne dit QUELLE sous-tâche agit', async () => {
    const notes = await notesDuRun(
      orchestrateurAvecTopologie(new ProviderQuiBat(), [], {
        greedyConcurrency: 2,
        classifyPhases: () => ['build'],
        decompose: async () => [
          { id: 'A', deps: [], prompt: 'volet A' },
          { id: 'B', deps: [], prompt: 'volet B' }
        ]
      })
    )
    expect(notes).toContain('A · Bash en cours - 2 min 30 s - vitest run')
    expect(notes).toContain('B · Bash en cours - 2 min 30 s - vitest run')
  })
})
