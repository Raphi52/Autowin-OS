import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { overrideFor, registerWorkflowBenchIpc } from './workflow-bench-ipc'
import type { OrchestrationResult } from './orchestrator'
import type { WorkflowProfile } from './workflow-profiles'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'
import { TEST_MODEL_CATALOG } from './models.fixture'
import { assertRuntimeBindingAvailable } from './runtime-topology'

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
const robuste: WorkflowProfile = { id: 'robuste', name: 'Robuste' }
const currentRoles = () => ({
  subagent: {
    provider: 'claude',
    model: 'claude-fable-5',
    reasoningEffort: 'high' as const
  }
})

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
    assertBindingAvailable: vi.fn(),
    currentRoles,
    captureCheckpoint: vi.fn(async (objective: string) => ({
      id: 'checkpoint-before-run',
      runId: 'counterfactual-parent',
      createdAt: '2026-08-08T12:00:00.000Z',
      sourceSnapshot: {
        workspaceId: 'C:/repo',
        baseSha: 'base-sha',
        contentHash: 'sha256:workspace-before-run'
      },
      state: { objective, dirty: false }
    })),
    runOrchestration: runOrchestration as never,
    loadProfiles: () => ({ profiles: overrides.profiles ?? [vif, lent, robuste], activeId: null })
  })
  const invoke = (raw: unknown): Promise<unknown> =>
    handlers.get('os:workflowBench:run')!(event, raw)
  return { invoke, runOrchestration, send, handlers }
}

describe('canal de confrontation', () => {
  it('expose le canal — sans lui, tout le moteur est injoignable', () => {
    expect(harness().handlers.has('os:workflowBench:run')).toBe(true)
    expect(harness().handlers.has('os:workflowBench:cancel')).toBe(true)
  })

  it('annule réellement le run actif du renderer', async () => {
    let observedSignal: AbortSignal | undefined
    const runOrchestration = vi.fn(
      (_objective, _binding, signal: AbortSignal) =>
        new Promise<OrchestrationResult>((_resolve, reject) => {
          observedSignal = signal
          signal.addEventListener('abort', () => reject(new Error('annulé')), { once: true })
        })
    )
    const { handlers } = harness({ runOrchestration })
    const sender = { isDestroyed: () => false, send: vi.fn() }
    const running = handlers.get('os:workflowBench:run')!(
      { sender },
      { objective: 'ranger', profileIds: ['vif', 'lent'] }
    )
    await vi.waitFor(() => expect(runOrchestration).toHaveBeenCalledTimes(1))

    await expect(handlers.get('os:workflowBench:cancel')!({ sender }, undefined)).resolves.toBe(true)
    await running
    expect(observedSignal?.aborted).toBe(true)
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
      assertBindingAvailable: vi.fn(),
      currentRoles,
      runOrchestration: runOrchestration as never,
      loadProfiles: () => ({ profiles: [vif, lent], activeId: null })
    })
    await expect(handlers.get('os:workflowBench:run')!({}, {})).rejects.toThrow('renderer inconnu')
    expect(runOrchestration).not.toHaveBeenCalled()
  })

  it('injecte le binding du workflow dans le run — sinon les runs seraient identiques', async () => {
    const { invoke, runOrchestration } = harness()
    await invoke({ objective: 'ranger', profileIds: ['vif', 'lent'] })
    expect(runOrchestration.mock.calls[0][1]).toMatchObject({
      model: 'petit',
      reasoningEffort: 'low'
    })
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

  it('bloque un modèle de workflow hors catalogue avant tout appel provider', async () => {
    const handlers = new Map<string, (e: unknown, r: unknown) => Promise<unknown>>()
    const runOrchestration = vi.fn().mockResolvedValue(ok(1))
    const fantome: WorkflowProfile = {
      id: 'fantome',
      name: 'Fantôme',
      roles: { subagent: { model: 'modele-fantome' } }
    }
    registerWorkflowBenchIpc({
      ipcMain: { handle: (c: string, f: never) => handlers.set(c, f) } as never,
      assertTrusted: vi.fn(),
      assertBindingAvailable: (binding) =>
        assertRuntimeBindingAvailable(binding, TEST_MODEL_CATALOG),
      currentRoles,
      runOrchestration: runOrchestration as never,
      loadProfiles: () => ({ profiles: [fantome, robuste], activeId: null })
    })

    const report = (await handlers.get('os:workflowBench:run')!(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { objective: 'o', profileIds: ['fantome', 'robuste'] }
    )) as { rows: { profileId: string | null; green: boolean; caveat?: string }[] }
    expect(report.rows.find((row) => row.profileId === 'fantome')).toMatchObject({
      green: false,
      caveat: expect.stringContaining('non vert')
    })
    expect(runOrchestration).toHaveBeenCalledTimes(1)
    expect(runOrchestration.mock.calls[0][1]).toBeUndefined()
  })

  it('résout un delta modèle valide sur le binding runtime courant', async () => {
    const handlers = new Map<string, (e: unknown, r: unknown) => Promise<unknown>>()
    const runOrchestration = vi.fn().mockResolvedValue(ok(1))
    const delta: WorkflowProfile = {
      id: 'delta-valide',
      name: 'Delta valide',
      roles: { subagent: { model: 'claude-fable-5' } }
    }
    registerWorkflowBenchIpc({
      ipcMain: { handle: (c: string, f: never) => handlers.set(c, f) } as never,
      assertTrusted: vi.fn(),
      assertBindingAvailable: (binding) =>
        assertRuntimeBindingAvailable(binding, TEST_MODEL_CATALOG),
      currentRoles,
      runOrchestration: runOrchestration as never,
      loadProfiles: () => ({ profiles: [delta, robuste], activeId: null })
    })

    await handlers.get('os:workflowBench:run')!(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { objective: 'o', profileIds: ['delta-valide', 'robuste'] }
    )
    expect(runOrchestration.mock.calls[0][1]).toEqual({
      provider: 'claude',
      model: 'claude-fable-5',
      reasoningEffort: 'high'
    })
  })

  it('refuse de « comparer » un seul workflow', async () => {
    await expect(harness().invoke({ objective: 'o', profileIds: ['vif'] })).rejects.toThrow(
      'au moins deux'
    )
  })

  it('le tournoi est facultatif et exige exactement trois workflows', async () => {
    const { invoke, runOrchestration } = harness()
    await expect(
      invoke({ objective: 'o', profileIds: ['vif', 'lent'], mode: 'tournament' })
    ).rejects.toThrow('exactement trois')
    expect(runOrchestration).not.toHaveBeenCalled()

    await invoke({ objective: 'o', profileIds: ['vif', 'lent', 'robuste'], mode: 'tournament' })
    expect(runOrchestration).toHaveBeenCalledTimes(3)
    expect(runOrchestration.mock.calls.every((call) => call[4] === 'hold')).toBe(true)
  })

  it('transmet chaque workflow au run sans état global en mode tournoi', async () => {
    const handlers = new Map<string, (e: unknown, r: unknown) => Promise<unknown>>()
    const runOrchestration = vi.fn().mockResolvedValue(ok(1))
    registerWorkflowBenchIpc({
      ipcMain: { handle: (c: string, f: never) => handlers.set(c, f) } as never,
      assertTrusted: vi.fn(),
      assertBindingAvailable: vi.fn(),
      currentRoles,
      runOrchestration: runOrchestration as never,
      loadProfiles: () => ({ profiles: [vif, lent, robuste], activeId: null })
    })
    await handlers.get('os:workflowBench:run')!(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { objective: 'o', profileIds: ['vif', 'lent', 'robuste'], mode: 'tournament' }
    )
    expect(runOrchestration.mock.calls[0][3]).toMatchObject({ identity: { name: 'Vif' } })
    expect(runOrchestration.mock.calls[1][3]).toMatchObject({ identity: { name: 'Lent' } })
  })

  it('le contrefactuel exige exactement deux workflows, fige le checkpoint avant les runs et retient les deux bureaux', async () => {
    const captureCheckpoint = vi.fn(async (objective: string) => ({
      id: 'checkpoint-before-run',
      runId: 'counterfactual-parent',
      createdAt: '2026-08-08T12:00:00.000Z',
      sourceSnapshot: {
        workspaceId: 'C:/repo',
        baseSha: 'base-sha',
        contentHash: 'sha256:workspace-before-run'
      },
      state: { objective, dirty: false }
    }))
    const handlers = new Map<string, (e: unknown, r: unknown) => Promise<unknown>>()
    const runOrchestration = vi.fn().mockResolvedValue(ok(1))
    registerWorkflowBenchIpc({
      ipcMain: { handle: (c: string, f: never) => handlers.set(c, f) } as never,
      assertTrusted: vi.fn(),
      assertBindingAvailable: vi.fn(),
      currentRoles,
      captureCheckpoint,
      runOrchestration: runOrchestration as never,
      loadProfiles: () => ({ profiles: [vif, lent, robuste], activeId: null })
    })
    const invoke = (profileIds: string[]) =>
      handlers.get('os:workflowBench:run')!(
        { sender: { isDestroyed: () => false, send: vi.fn() } },
        { objective: 'o', profileIds, mode: 'counterfactual' }
      )

    await expect(invoke(['vif', 'lent', 'robuste'])).rejects.toThrow('exactement deux')
    await invoke(['vif', 'lent'])

    expect(captureCheckpoint).toHaveBeenCalledWith('o')
    expect(runOrchestration).toHaveBeenCalledTimes(2)
    expect(runOrchestration.mock.calls.every((call) => call[4] === 'hold')).toBe(true)
    expect(runOrchestration.mock.calls.every((call) => call[5]?.baseSha === 'base-sha')).toBe(true)
    expect(captureCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(
      runOrchestration.mock.invocationCallOrder[0]
    )
  })

  it('refuse un objectif vide', async () => {
    await expect(
      harness().invoke({ objective: '   ', profileIds: ['vif', 'lent'] })
    ).rejects.toThrow('Objectif manquant')
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
    expect(entree).toContain('assertRuntimeBindingAvailable(binding, agentModels)')
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

  it('index.ts relie un override run-scoped à l’OS — sans ça, phases et consignes n’arrivent nulle part', () => {
    expect(entree).toContain('{ workflowOverride, publication, sourceSnapshot }')
    const os = readFileSync(new URL('./os.ts', import.meta.url), 'utf8')
    // L'etat partage a disparu : chaque run construit son orchestrateur avec SA closure.
    expect(os).toContain('currentWorkflow: () => workflow')
  })

  it('le preload expose le lancement ET la progression', () => {
    const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8')
    expect(preload).toContain("ipcRenderer.invoke('os:workflowBench:run'")
    expect(preload).toContain("ipcRenderer.invoke('os:workflowBench:cancel'")
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

  it('transmet aussi le graphe et ses retours bornés au moteur', () => {
    const graph = {
      entry: 'scout-1',
      nodes: [
        { id: 'scout-1', phase: 'scout' as const },
        { id: 'build-1', phase: 'build' as const },
        { id: 'judge-1', phase: 'judge' as const }
      ],
      edges: [
        { from: 'scout-1', to: 'build-1', when: 'always' as const },
        { from: 'build-1', to: 'judge-1', when: 'always' as const },
        { from: 'judge-1', to: 'build-1', when: 'red' as const, maxTraversals: 2 }
      ]
    }

    expect(overrideFor({ id: 'graphe', name: 'Graphe', graph })?.graph).toEqual(graph)
  })

  it('la configuration courante n’impose aucun écart', () => {
    expect(overrideFor(null)).toBeUndefined()
  })

  it('transmet le workflow dans le run sans pose globale', async () => {
    const runOrchestration = vi.fn().mockResolvedValue(ok(1))
    const handlers = new Map<string, (e: unknown, r: unknown) => Promise<unknown>>()
    registerWorkflowBenchIpc({
      ipcMain: { handle: (c: string, f: never) => handlers.set(c, f) } as never,
      assertTrusted: vi.fn(),
      assertBindingAvailable: vi.fn(),
      currentRoles,
      runOrchestration: runOrchestration as never,
      loadProfiles: () => ({ profiles: [vif, bavard], activeId: null })
    })
    await handlers.get('os:workflowBench:run')!(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { objective: 'o', profileIds: ['bavard', 'vif'] }
    )
    expect(runOrchestration).toHaveBeenNthCalledWith(
      1,
      'o',
      undefined,
      expect.any(AbortSignal),
      expect.objectContaining({ phases: ['build'] }),
      'auto',
      undefined
    )
  })

  it('un run qui ÉCHOUE ne laisse pas ses réglages au workflow suivant', async () => {
    const runOrchestration = vi
      .fn()
      .mockRejectedValueOnce(new Error('mort'))
      .mockResolvedValueOnce(ok(1))
    const handlers = new Map<string, (e: unknown, r: unknown) => Promise<unknown>>()
    registerWorkflowBenchIpc({
      ipcMain: { handle: (c: string, f: never) => handlers.set(c, f) } as never,
      assertTrusted: vi.fn(),
      assertBindingAvailable: vi.fn(),
      currentRoles,
      runOrchestration: runOrchestration as never,
      loadProfiles: () => ({ profiles: [vif, bavard], activeId: null })
    })
    await handlers.get('os:workflowBench:run')!(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { objective: 'o', profileIds: ['bavard', 'vif'] }
    )
    // Sinon le verdict comparerait deux fois le même réglage sans le dire.
    expect(runOrchestration.mock.calls[0][3]).toMatchObject({ identity: { name: 'Bavard' } })
    expect(runOrchestration.mock.calls[1][3]).toMatchObject({ identity: { name: 'Vif' } })
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

/**
 * Régression sur le workflow RÉELLEMENT livré, pas sur un profil de test.
 *
 * Les cas ci-dessus utilisent des profils fabriqués : ils prouvent la mécanique de conversion, pas
 * que le pipeline embarqué survit à la traversée. Si `DEFAULT_WORKFLOWS` dérive (une phase perdue,
 * un ordre inversé, un retour rouge dé-borné), le moteur jouerait autre chose sans qu'un test bouge.
 */
describe('overrideFor — le workflow livré « Chantier Autowin » arrive intact au moteur', () => {
  const chantier = DEFAULT_WORKFLOWS.find((profile) => profile.id === 'chantier-autowin')!

  it('le profil livré existe — sans lui, la régression testerait du vide', () => {
    expect(chantier).toBeDefined()
  })

  it('transmet ses SEPT phases dans l’ordre du profil', () => {
    // `think` en tete depuis le 2026-08-25 : le contexte de la tache est charge avant de decouvrir.
    // Pas de `learn` ici — lui donner une arete depuis le juge priverait celui-ci de son statut
    // terminal, et le marcheur remangerait le budget de retour (mesure : 3 passages build au lieu
    // de 1). Voir `workflow-defaults.think-learn.test.ts`.
    const graphe = overrideFor(chantier)?.graph
    expect(graphe?.nodes.map((node) => node.phase)).toEqual([
      'think',
      'scout',
      'frame',
      'terrain',
      'build',
      'clean',
      'judge'
    ])
    expect(graphe?.entry).toBe('think-1')
  })

  it('un juge ROUGE borne la boucle de build à 2 itérations', () => {
    const graphe = overrideFor(chantier)?.graph
    const retours = (graphe?.edges ?? []).filter((edge) => edge.when === 'red')
    // Un seul retour rouge : deux arêtes rouges cumuleraient leurs plafonds sans le dire.
    expect(retours).toHaveLength(1)
    expect(retours[0]).toMatchObject({ from: 'judge-1', to: 'build-1', maxTraversals: 2 })
  })
})
