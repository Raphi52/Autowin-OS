import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { overrideFor, registerWorkflowBenchIpc } from './workflow-bench-ipc'
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
    // L'import est groupé depuis que `overrideFor` sert AUSSI à poser le workflow actif du chat :
    // on vérifie le symbole, pas la forme exacte de la ligne d'import.
    expect(entree).toMatch(/registerWorkflowBenchIpc[^\n]*from '\.\/workflow-bench-ipc'/)
    expect(entree).toMatch(/registerWorkflowBenchIpc\(\{/)
  })

  /**
   * Le défaut que ce test ferme : `activeId` n'était qu'une préférence écrite sur disque. Personne
   * ne la lisait — `setActiveWorkflow` n'était appelé QUE par le banc, qui le pose puis le retire.
   * Le graphe composé, ses personas et ses retours bornés n'avaient donc aucun effet sur un tour de
   * chat. Une feature entièrement décorative, invisible à tous les autres tests.
   */
  it('le workflow ACTIF est porté jusqu’au moteur — à l’ouverture et à chaque changement', () => {
    // La pose passe par une variable depuis que le choix EXPLICITE est marqué (`explicit: true`) :
    // on vérifie les deux maillons, pas la forme d'une ligne unique.
    expect(entree).toMatch(/activeWorkflowProfile\(/)
    expect(entree).toMatch(/overrideFor\(/)
    expect(entree).toMatch(/os\.setActiveWorkflow\(/)
    // Le choix venu de la vue est marqué EXPLICITE : sans ce drapeau, l'heuristique de
    // proportionnalité le désactivait en silence sur une demande jugée légère.
    expect(entree).toMatch(/explicit: true/)
    // Les trois chemins qui changent l'actif doivent le republier, sinon l'un d'eux ment.
    const applications = entree.match(/appliquerWorkflowActif\(/g) ?? []
    expect(applications.length).toBeGreaterThanOrEqual(4) // définition + ouverture + select + upsert + remove
  })

  it('index.ts relie la pose du workflow à l’OS — sans ça, phases et consignes n’arrivent nulle part', () => {
    expect(entree).toMatch(/setActiveWorkflow: \(workflow\) => os\.setActiveWorkflow\(workflow\)/)
    const os = readFileSync(new URL('./os.ts', import.meta.url), 'utf8')
    // L'etat partage a disparu : chaque run construit son orchestrateur avec SA closure.
    expect(os).toContain('currentWorkflow: () => workflow')
  })

  it('le preload expose le lancement ET la progression', () => {
    const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8')
    expect(preload).toContain("ipcRenderer.invoke('os:workflowBench:run'")
    expect(preload).toContain("ipcRenderer.on('os:workflowBench:progress'")
  })
})

describe('phases, allocation et consignes atteignent l’orchestrateur', () => {
  const bavard: WorkflowProfile = {
    id: 'bavard',
    name: 'Bavard',
    phases: ['build'],
    allocation: { judgeMembers: 4 },
    instructions: { mode: 'replace', perPhase: { build: 'ma méthode' } }
  }

  it('traduit le workflow en écarts que l’orchestrateur sait recevoir', () => {
    const over = overrideFor(bavard)!
    expect(over.phases).toEqual(['build'])
    expect(over.allocation).toMatchObject({ judgeMembers: 4 })
    expect(over.instructionFor?.('build')).toEqual({ mode: 'replace', text: 'ma méthode' })
  })

  it('la configuration courante n’impose aucun écart', () => {
    expect(overrideFor(null)).toBeUndefined()
  })

  it('POSE le workflow avant le run et le RETIRE après', async () => {
    const poses: (string | undefined)[] = []
    const setActiveWorkflow = vi.fn((w?: { phases?: string[] }) =>
      poses.push(w?.phases?.[0] ?? (w ? 'sans-phase' : undefined))
    )
    const handlers = new Map<string, (e: unknown, r: unknown) => Promise<unknown>>()
    registerWorkflowBenchIpc({
      ipcMain: { handle: (c: string, f: never) => handlers.set(c, f) } as never,
      assertTrusted: vi.fn(),
      runOrchestration: (async () => ok(1)) as never,
      setActiveWorkflow: setActiveWorkflow as never,
      loadProfiles: () => ({ profiles: [vif, bavard], activeId: null })
    })
    await handlers.get('os:workflowBench:run')!(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { objective: 'o', profileIds: ['bavard', 'vif'] }
    )
    expect(poses).toEqual(['build', undefined, 'sans-phase', undefined])
  })

  it('un run qui ÉCHOUE ne laisse pas ses réglages au workflow suivant', async () => {
    const poses: unknown[] = []
    const runOrchestration = vi
      .fn()
      .mockRejectedValueOnce(new Error('mort'))
      .mockResolvedValueOnce(ok(1))
    const handlers = new Map<string, (e: unknown, r: unknown) => Promise<unknown>>()
    registerWorkflowBenchIpc({
      ipcMain: { handle: (c: string, f: never) => handlers.set(c, f) } as never,
      assertTrusted: vi.fn(),
      runOrchestration: runOrchestration as never,
      setActiveWorkflow: ((w: unknown) => poses.push(w)) as never,
      loadProfiles: () => ({ profiles: [vif, bavard], activeId: null })
    })
    await handlers.get('os:workflowBench:run')!(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { objective: 'o', profileIds: ['bavard', 'vif'] }
    )
    // Sinon le verdict comparerait deux fois le même réglage sans le dire.
    expect(poses[1]).toBeUndefined()
  })
})

/**
 * L'identité du workflow doit SURVIVRE à la conversion profil → override.
 *
 * Elle était détruite à cette frontière : `overrideFor` recevait un profil portant `id` et `name` et
 * n'en transmettait que la topologie. Le devis affichait donc des plafonds sans pouvoir nommer ce
 * qui les cause — alors que les plafonds en découlent.
 */
describe('overrideFor — l’identité du workflow survit à la conversion', () => {
  it('transmet le NOM du profil, pas seulement sa topologie', () => {
    const o = overrideFor({ id: 'correctif', name: 'Correctif', phases: ['build', 'judge'] })
    expect(o?.identity).toEqual({ name: 'Correctif', source: 'manuel' })
  })

  it('un profil absent ne fabrique pas une identité fantôme', () => {
    expect(overrideFor(null)).toBeUndefined()
  })

  it('l’identité n’altère PAS la topologie transmise', () => {
    // C'est un ajout d'observabilité : si elle changeait ce que le moteur joue, elle serait un bug.
    const o = overrideFor({ id: 'x', name: 'X', phases: ['build'] })
    expect(o?.phases).toEqual(['build'])
  })
})
