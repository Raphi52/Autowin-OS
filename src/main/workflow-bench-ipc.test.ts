import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { registerWorkflowBenchIpc, unappliedDeviations } from './workflow-bench-ipc'
import type { OrchestrationResult } from './orchestrator'
import type { WorkflowProfile } from './workflow-profiles'

const ok = (costUsd: number): OrchestrationResult =>
  ({
    task: 'o',
    result: 'fait',
    valid: true,
    gateBlocked: false,
    gateReasons: [],
    costUsd,
    phaseOutputs: [],
    trace: []
  }) as OrchestrationResult

const vif: WorkflowProfile = {
  id: 'vif',
  name: 'Vif',
  roles: { subagent: { provider: 'claude', model: 'petit', reasoningEffort: 'low' } }
}
const lent: WorkflowProfile = {
  id: 'lent',
  name: 'Lent',
  roles: { subagent: { provider: 'claude', model: 'gros' } }
}

function harness(
  overrides: {
    runOrchestration?: ReturnType<typeof vi.fn>
    profiles?: WorkflowProfile[]
  } = {}
) {
  const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
  const send = vi.fn()
  const event = { sender: { isDestroyed: () => false, send } }
  const runOrchestration = overrides.runOrchestration ?? vi.fn().mockResolvedValue(ok(1))
  registerWorkflowBenchIpc({
    ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) } as never,
    assertTrusted: vi.fn(),
    runOrchestration: runOrchestration as never,
    loadProfiles: () => ({ profiles: overrides.profiles ?? [vif, lent], activeId: null })
  })
  const invoke = (raw: unknown): Promise<unknown> =>
    handlers.get('os:workflowBench:run')!(event, raw)
  return { invoke, runOrchestration, send, handlers }
}

describe('canal de confrontation', () => {
  it('expose le canal — sans lui, tout le moteur est injoignable', () => {
    expect(harness().handlers.has('os:workflowBench:run')).toBe(true)
  })

  it('refuse un renderer non fiable AVANT de dépenser quoi que ce soit', async () => {
    const assertTrusted = vi.fn(() => {
      throw new Error('renderer inconnu')
    })
    const runOrchestration = vi.fn()
    const handlers = new Map<string, (e: unknown, r: unknown) => Promise<unknown>>()
    registerWorkflowBenchIpc({
      ipcMain: { handle: (c: string, f: never) => handlers.set(c, f) } as never,
      assertTrusted,
      runOrchestration: runOrchestration as never,
      loadProfiles: () => ({ profiles: [vif, lent], activeId: null })
    })
    await expect(handlers.get('os:workflowBench:run')!({}, {})).rejects.toThrow('renderer inconnu')
    expect(runOrchestration).not.toHaveBeenCalled()
  })

  it('injecte le binding du workflow dans le run — sinon les runs seraient identiques', async () => {
    const { invoke, runOrchestration } = harness()
    await invoke({ objective: 'ranger', profileIds: ['vif', 'lent'] })
    expect(runOrchestration.mock.calls[0][1]).toMatchObject({ model: 'petit', reasoningEffort: 'low' })
    expect(runOrchestration.mock.calls[1][1]).toMatchObject({ model: 'gros' })
  })

  it('la configuration courante tourne SANS binding imposé', async () => {
    const { invoke, runOrchestration } = harness()
    await invoke({ objective: 'ranger', profileIds: [null, 'vif'] })
    expect(runOrchestration.mock.calls[0][1]).toBeUndefined()
  })

  it('renvoie le verdict classé', async () => {
    const runOrchestration = vi.fn().mockResolvedValueOnce(ok(4)).mockResolvedValueOnce(ok(1))
    const { invoke } = harness({ runOrchestration })
    const report = (await invoke({ objective: 'ranger', profileIds: ['vif', 'lent'] })) as {
      recommendedProfileId?: string
      objective: string
    }
    expect(report.recommendedProfileId).toBe('lent')
    expect(report.objective).toBe('ranger')
  })

  it('un id inconnu est SIGNALÉ, pas remplacé en douce par la config courante', async () => {
    const { invoke, runOrchestration } = harness()
    await expect(invoke({ objective: 'o', profileIds: ['vif', 'fantome'] })).rejects.toThrow(
      'Workflow inconnu : fantome'
    )
    expect(runOrchestration).not.toHaveBeenCalled()
  })

  it('refuse de « comparer » un seul workflow', async () => {
    await expect(harness().invoke({ objective: 'o', profileIds: ['vif'] })).rejects.toThrow(
      'au moins deux'
    )
  })

  it('refuse un objectif vide', async () => {
    await expect(harness().invoke({ objective: '   ', profileIds: ['vif', 'lent'] })).rejects.toThrow(
      'Objectif manquant'
    )
  })

  it('pousse la progression pour que l’attente ne soit pas aveugle', async () => {
    const { invoke, send } = harness()
    await invoke({ objective: 'o', profileIds: ['vif', 'lent'] })
    expect(send).toHaveBeenCalledWith('os:workflowBench:progress', {
      done: 0,
      total: 2,
      label: 'Vif'
    })
  })
})

describe('le canal est réellement branché à l’application', () => {
  // Un module parfait que personne n'enregistre n'existe pas pour l'utilisateur : ce test lit la
  // source du point d'entrée, seul endroit où le branchement peut être constaté sans lancer Electron.
  const entree = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

  it('index.ts importe et appelle registerWorkflowBenchIpc', () => {
    expect(entree).toMatch(/import \{ registerWorkflowBenchIpc \} from '\.\/workflow-bench-ipc'/)
    expect(entree).toMatch(/registerWorkflowBenchIpc\(\{/)
  })

  it('le preload expose le lancement ET la progression', () => {
    const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8')
    expect(preload).toContain("ipcRenderer.invoke('os:workflowBench:run'")
    expect(preload).toContain("ipcRenderer.on('os:workflowBench:progress'")
  })
})

describe('ce que la comparaison ne fait PAS varier', () => {
  it('rapporte les écarts calculés mais non transmis à l’orchestrateur', async () => {
    const bavard: WorkflowProfile = {
      id: 'bavard',
      name: 'Bavard',
      phases: ['build'],
      instructions: { mode: 'append', text: 'sois bref' }
    }
    const { invoke } = harness({ profiles: [vif, bavard] })
    const report = (await invoke({ objective: 'o', profileIds: ['vif', 'bavard'] })) as {
      unapplied: { profileId: string; deviations: string[] }[]
    }
    // Sans cette réserve, le verdict laisserait croire qu'on a comparé des consignes différentes.
    expect(report.unapplied).toEqual([{ profileId: 'bavard', deviations: ['phases', 'consignes'] }])
  })

  it('un workflow qui ne change que le rôle n’a rien à réserver', () => {
    expect(unappliedDeviations(vif)).toEqual([])
    expect(unappliedDeviations(null)).toEqual([])
  })
})
