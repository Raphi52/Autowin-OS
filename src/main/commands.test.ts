import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { AppCommandBus } from './commands'
import { AuthoritySas } from './authority/sas'
import { APP_DESTINATIONS } from '../shared/navigation'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readConversationFilePaths,
  readCurrentConversationPathOwnership
} from './activity/conversation-file-trace-spool'
import { readBrainTraces } from './activity/brain-trace-spool'
import { WorktreeManager } from './store/worktree-manager'
import { RunWorktreeCoordinator } from './store/run-worktree-coordinator'
import { TraceStore } from './activity/trace-store'

function fakeOs(): any {
  const conversations = new Map<
    string,
    {
      id: string
      title: string
      category: string
      provider: string
      messages: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>
      runPaths: string[]
    }
  >()
  const calls: { setRole: number; attachRun: number; runTask: number; lastTask?: string } = {
    setRole: 0,
    attachRun: 0,
    runTask: 0
  }
  conversations.set('conv-1', {
    id: 'conv-1',
    title: 'A garder',
    category: 'claude',
    provider: 'claude',
    messages: [{ role: 'user', content: 'le worktree est resté ouvert', ts: 1 }],
    runPaths: []
  })
  return {
    executionWorkspace: process.cwd(),
    conversations: {
      get: (id: string) => conversations.get(id),
      remove: (id: string) => conversations.delete(id),
      list: () => [...conversations.values()],
      attachRun: () => {
        calls.attachRun += 1
        return { id: 'conv-1', runPaths: [] }
      }
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}) },
    authority: new AuthoritySas(),
    runsWithGate: () => [],
    budget: () => ({ spent: 0 }),
    setRole: () => {
      calls.setRole += 1
      return {}
    },
    listBrains: () => [],
    loadBrainGraph: () => ({ nodes: [], links: [] }),
    runTask: async (task: string) => {
      calls.runTask += 1
      calls.lastTask = task
      return { gateBlocked: false, valid: true, costUsd: 0, result: '' }
    },
    chat: async () => ({ text: '', provider: 'claude', systemInjected: false }),
    calls
  }
}

describe('AppCommandBus orchestration cancel (#2)', () => {
  it('persiste lifecycle et démarrage live dans le TraceStore de cette instance', async () => {
    const os = fakeOs()
    const root = mkdtempSync(join(tmpdir(), 'autowin-command-trace-'))
    const traceStore = new TraceStore(root)
    os.runTask = async (...args: unknown[]) => {
      const onStep = args[1] as (step: unknown) => void
      const onPhase = args[2] as (phase: unknown) => void
      const onLifecycle = args[11] as (event: unknown) => void
      onLifecycle({
        runId: 'run-live',
        timestampMs: 1,
        stage: 'workspace',
        workspace: { mode: 'base', repositoryPath: 'C:\\repo', path: 'C:\\repo' }
      })
      const execution = {
        phase: 'build',
        agentId: 'builder',
        taskId: 'task-build',
        groupId: 'build:single',
        dependencyIds: [],
        attemptId: 'attempt-live'
      }
      onPhase({ step: 'exec', role: 'subagent', provider: 'codex', execution })
      onStep({ step: 'exec', role: 'subagent', provider: 'codex', status: 'completed', execution })
      onLifecycle({
        runId: 'run-live',
        timestampMs: 2,
        stage: 'closure',
        closure: { status: 'green', totalDurationMs: 1, totalCostUsd: 0 }
      })
      return {
        gateBlocked: false,
        gateReasons: [],
        valid: true,
        costUsd: 0,
        result: '',
        phaseOutputs: []
      }
    }
    const bus = new AppCommandBus(os, () => {})
    try {
      bus.setTraceStore(traceStore)
      await bus.exec('orchestrate', { task: '/build corrige la typo' }, 'conv-1', 'auto')
      const events = traceStore.readConversation('conv-1')
      expect(events.some((event) => event.run?.stage === 'workspace')).toBe(true)
      expect(
        events.some(
          (event) => event.status === 'running' && event.execution?.attemptId === 'attempt-live'
        )
      ).toBe(true)
      expect(events.some((event) => event.run?.stage === 'closure')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('transmet le binding par tour au pipeline orchestré', async () => {
    const os = fakeOs()
    let receivedBinding: unknown
    os.runTask = async (...args: unknown[]) => {
      receivedBinding = args[8]
      return {
        gateBlocked: false,
        gateReasons: [],
        valid: true,
        costUsd: 0,
        result: '',
        phaseOutputs: []
      }
    }
    const binding = { provider: 'claude', model: 'claude-sonnet', reasoningEffort: 'high' as const }

    await new AppCommandBus(os, () => {}).exec(
      'orchestrate',
      { task: '/build corrige puis teste' },
      'conv-1',
      'auto',
      binding
    )

    expect(receivedBinding).toEqual(binding)
  })

  it('collecte le contexte substantiel avant de déléguer au pipeline', async () => {
    const os = fakeOs()
    let collected = ''
    os.runTask = async (...args: unknown[]) => {
      // args inclut `task` -> collectedContext est en args[5] (cf. AutowinOS.runTask). Lire depuis
      // la FIN cassait des que la signature s'etendait — arrive avec resumeOutputs + conversationId.
      collected = String(args[5] ?? '')
      return {
        gateBlocked: false,
        gateReasons: [],
        valid: true,
        costUsd: 0,
        result: '',
        phaseOutputs: []
      }
    }
    const result = await new AppCommandBus(os, () => {}).exec(
      'orchestrate',
      { task: 'implémenter une évolution de workflow' },
      'conv-1',
      'auto'
    )
    expect(result.ok).toBe(true)
    expect(collected).toMatch(/^\[COLLECTE DE CONTEXTE — effectuée avant RUN.md et délégation\]/)
    expect(collected).toContain('Conversation: conv-1 — A garder')
  })

  it('réutilise une orchestration équivalente déjà en cours', async () => {
    const os = fakeOs()
    let release!: (value: {
      gateBlocked: boolean
      gateReasons: string[]
      valid: boolean
      costUsd: number
      result: string
      phaseOutputs: []
    }) => void
    os.runTask = () =>
      new Promise((resolve) => {
        os.calls.runTask += 1
        release = resolve
      })
    const bus = new AppCommandBus(os, () => {})
    const first = bus.exec('orchestrate', { task: 'corrige puis teste' }, 'conv-1', 'auto')
    await vi.waitFor(() => expect(os.calls.runTask).toBe(1), { timeout: 10_000 })

    const second = await bus.exec('orchestrate', { task: 'corrige puis teste' }, 'conv-1', 'auto')

    expect(second).toMatchObject({ ok: true, data: { reused: true, status: 'running' } })
    expect(os.calls.runTask).toBe(1)
    release({
      gateBlocked: false,
      gateReasons: [],
      valid: true,
      costUsd: 0,
      result: '',
      phaseOutputs: []
    })
    await first
  })

  it('ne déduplique pas deux mêmes prompts dont les modèles diffèrent', async () => {
    const os = fakeOs()
    const receivedBindings: unknown[] = []
    const releases: Array<() => void> = []
    os.runTask = (...args: unknown[]) =>
      new Promise((resolve) => {
        os.calls.runTask += 1
        receivedBindings.push(args[8])
        releases.push(() =>
          resolve({
            gateBlocked: false,
            gateReasons: [],
            valid: true,
            costUsd: 0,
            result: '',
            phaseOutputs: []
          })
        )
      })
    const bus = new AppCommandBus(os, () => {})
    const claude = { provider: 'claude', model: 'claude-sonnet' }
    const codex = { provider: 'codex', model: 'gpt-5.6-sol' }

    const first = bus.exec('orchestrate', { task: 'corrige puis teste' }, 'conv-1', 'auto', claude)
    await vi.waitFor(() => expect(os.calls.runTask).toBe(1), { timeout: 5_000 })
    const second = bus.exec('orchestrate', { task: 'corrige puis teste' }, 'conv-1', 'auto', codex)

    let waitFailure: unknown
    try {
      await vi.waitFor(() => expect(os.calls.runTask).toBe(2), { timeout: 5_000 })
    } catch (error) {
      waitFailure = error
    } finally {
      releases.forEach((release) => release())
      await Promise.all([first, second])
    }
    if (waitFailure) throw waitFailure

    expect(os.calls.runTask).toBe(2)
    expect(receivedBindings).toEqual(expect.arrayContaining([claude, codex]))
  })

  it('le finally d’un ancien chemin bus ne désarme pas Stop pour le nouveau run', async () => {
    type RunResult = {
      gateBlocked: boolean
      gateReasons: string[]
      valid: boolean
      costUsd: number
      result: string
      phaseOutputs: []
    }
    const deferred = () => {
      let resolve!: (value: RunResult) => void
      const promise = new Promise<RunResult>((done) => {
        resolve = done
      })
      return { promise, resolve }
    }
    const first = deferred()
    const second = deferred()
    // Indexé par TÂCHE, pas par ordre d'appel : `exec` peut atteindre `runTask` dans l'ordre
    // inverse. Avec un appariement positionnel, les deux promesses différées s'intervertissaient et
    // le test s'interbloquait (`await oldRun` attendant une promesse résolue plus bas) — c'était la
    // cause du rouge aléatoire, pas la lenteur.
    const signals = new Map<string, AbortSignal>()
    const os = fakeOs()
    os.runTask = (task: string, ...args: unknown[]) => {
      // 5e argument = signal (cf. AutowinOS.runTask), indexe par RANG et non depuis la fin.
      signals.set(task, args[3] as AbortSignal)
      return task === 'ancien' ? first.promise : second.promise
    }
    const bus = new AppCommandBus(os, () => {})

    const oldRun = bus.exec('orchestrate', { task: 'ancien' }, 'conv-1', 'auto')
    const newRun = bus.exec('orchestrate', { task: 'nouveau' }, 'conv-1', 'auto')
    await vi.waitFor(() => expect(signals.size).toBe(2), { timeout: 10_000 })

    first.resolve({
      gateBlocked: false,
      gateReasons: [],
      valid: true,
      costUsd: 0,
      result: '',
      phaseOutputs: []
    })
    await oldRun

    expect(bus.abortOrchestration('conv-1')).toBe(true)
    expect(signals.get('nouveau')!.aborted).toBe(true)

    second.resolve({
      gateBlocked: false,
      gateReasons: [],
      valid: true,
      costUsd: 0,
      result: '',
      phaseOutputs: []
    })
    await newRun
  })

  it('register → abort coupe le signal ; clear le retire (le chemin direct devient stoppable)', () => {
    const bus = new AppCommandBus(fakeOs(), () => {})
    // Avant : aucune orchestration → abort est un no-op honnête.
    expect(bus.abortOrchestration('conv-1')).toBe(false)
    // register arme un AbortController dans le MÊME registre que le chemin interne.
    const controller = bus.registerOrchestration('conv-1')
    expect(controller.signal.aborted).toBe(false)
    // abort le coupe réellement.
    expect(bus.abortOrchestration('conv-1')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    // clear le retire → un nouvel abort ne trouve plus rien.
    bus.clearOrchestration('conv-1')
    expect(bus.abortOrchestration('conv-1')).toBe(false)
  })

  it('register coupe une orchestration précédente pendante sur la même conversation', () => {
    const bus = new AppCommandBus(fakeOs(), () => {})
    const first = bus.registerOrchestration('conv-1')
    const second = bus.registerOrchestration('conv-1')
    expect(first.signal.aborted).toBe(true) // l'ancienne est coupée
    expect(second.signal.aborted).toBe(false)
  })

  it('abortAllOrchestrations coupe et vide tout le registre (filet de crash, Faithful minor)', () => {
    const bus = new AppCommandBus(fakeOs(), () => {})
    const a = bus.registerOrchestration('conv-1')
    const b = bus.registerOrchestration('conv-2')
    bus.abortAllOrchestrations()
    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
    // Registre vidé → plus rien à couper.
    expect(bus.abortOrchestration('conv-1')).toBe(false)
    expect(bus.abortOrchestration('conv-2')).toBe(false)
  })

  it('clearOrchestration par IDENTITÉ : le finally d’un run écrasé n’efface pas le run courant (Corrector #2)', () => {
    const bus = new AppCommandBus(fakeOs(), () => {})
    const a = bus.registerOrchestration('conv-1') // run A
    const b = bus.registerOrchestration('conv-1') // run B écrase A (A.abort())
    // Le finally de A arrive APRÈS et ne doit PAS supprimer l'entrée de B.
    bus.clearOrchestration('conv-1', a)
    // Le cancel doit toujours couper B (entrée préservée).
    expect(bus.abortOrchestration('conv-1')).toBe(true)
    expect(b.signal.aborted).toBe(true)
  })
})

describe('AppCommandBus authority policy', () => {
  it('trace aussi une recherche Brain automatique sans résultat', async () => {
    const previousAppData = process.env.APPDATA
    const appData = mkdtempSync(join(tmpdir(), 'autowin-empty-brain-trace-'))
    process.env.APPDATA = appData
    try {
      const os = fakeOs()
      os.runTask = async (...args: unknown[]) => {
        const onBrainRetrieved = args[9] as
          | ((event: {
              timestamp: string
              query: string
              found: boolean
              injectedChars: number
            }) => void)
          | undefined
        onBrainRetrieved?.({
          timestamp: '2026-07-30T21:00:00.000Z',
          query: '',
          found: false,
          injectedChars: 0
        })
        return {
          gateBlocked: false,
          gateReasons: [],
          valid: true,
          costUsd: 0,
          result: '',
          phaseOutputs: []
        }
      }
      await new AppCommandBus(os, () => {}).exec('orchestrate', { task: 'ping' }, 'conv-1', 'auto')

      expect(readBrainTraces('conv-1')).toEqual([
        expect.objectContaining({
          conversationId: 'conv-1',
          kind: 'automatic',
          found: false,
          injectedChars: 0
        })
      ])
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA
      else process.env.APPDATA = previousAppData
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('conserve la trace Brain si une phase échoue après la récupération', async () => {
    const previousAppData = process.env.APPDATA
    const appData = mkdtempSync(join(tmpdir(), 'autowin-failed-brain-trace-'))
    process.env.APPDATA = appData
    try {
      const os = fakeOs()
      os.runTask = async (...args: unknown[]) => {
        const onBrainRetrieved = args[9] as
          | ((event: {
              timestamp: string
              query: string
              found: boolean
              injectedChars: number
            }) => void)
          | undefined
        onBrainRetrieved?.({
          timestamp: '2026-07-30T21:10:00.000Z',
          query: 'contexte avant échec',
          found: true,
          injectedChars: 42
        })
        throw new Error('phase injectée en échec')
      }

      const result = await new AppCommandBus(os, () => {}).exec(
        'orchestrate',
        { task: 'ping' },
        'conv-1',
        'auto',
        undefined,
        'turn-failed'
      )

      expect(result.ok).toBe(false)
      expect(readBrainTraces('conv-1')).toEqual([
        expect.objectContaining({
          turnId: 'turn-failed',
          query: 'contexte avant échec',
          injectedChars: 42
        })
      ])
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA
      else process.env.APPDATA = previousAppData
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('attribue edit_file et brain_query uniquement à la conversation qui les exécute', async () => {
    const previousAppData = process.env.APPDATA
    const appData = mkdtempSync(join(tmpdir(), 'autowin-conversation-scope-'))
    const workspace = mkdtempSync(join(tmpdir(), 'autowin-conversation-workspace-'))
    process.env.APPDATA = appData
    try {
      writeFileSync(join(workspace, 'target.txt'), 'avant\n', 'utf8')
      writeFileSync(
        join(workspace, 'package.json'),
        JSON.stringify({ scripts: { 'test:unit': 'node -e "process.exit(0)"' } }),
        'utf8'
      )
      const os = fakeOs()
      os.executionWorkspace = workspace
      os.worktrees = {
        begin: vi.fn(() => workspace),
        end: vi.fn(() => ({ outcome: 'nothing', agentId: 'command' }))
      }
      const bus = new AppCommandBus(os, () => {})

      const edit = await bus.exec(
        'edit_file',
        { path: 'target.txt', oldText: 'avant', newText: 'après' },
        'conv-1',
        'auto',
        undefined,
        'turn-1'
      )
      const brain = await bus.exec(
        'brain_query',
        { question: 'quelle décision ?' },
        'conv-1',
        'ask',
        undefined,
        'turn-1'
      )

      expect(edit).toMatchObject({ ok: true, data: { allowed: true, path: 'target.txt' } })
      expect(readFileSync(join(workspace, 'target.txt'), 'utf8')).toContain('après')
      expect(readConversationFilePaths('conv-1')).toEqual(['target.txt'])
      expect(readConversationFilePaths('conv-2')).toEqual([])
      expect(brain).toMatchObject({ ok: true, data: { allowed: true, found: false } })
      expect(readBrainTraces('conv-1')).toEqual([
        expect.objectContaining({
          conversationId: 'conv-1',
          turnId: 'turn-1',
          kind: 'query',
          query: 'quelle décision ?',
          found: false
        })
      ])
      expect(readBrainTraces('conv-2')).toEqual([])
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA
      else process.env.APPDATA = previousAppData
      rmSync(appData, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('sérialise deux edit_file réellement concurrents et conserve leur chaîne causale', async () => {
    const previousAppData = process.env.APPDATA
    const appData = mkdtempSync(join(tmpdir(), 'autowin-concurrent-edit-scope-'))
    const workspace = mkdtempSync(join(tmpdir(), 'autowin-concurrent-edit-workspace-'))
    process.env.APPDATA = appData
    try {
      writeFileSync(join(workspace, 'target.txt'), 'zéro\n', 'utf8')
      writeFileSync(
        join(workspace, 'package.json'),
        JSON.stringify({ scripts: { 'test:unit': 'node -e "process.exit(0)"' } }),
        'utf8'
      )
      execFileSync('git', ['init'], { cwd: workspace })
      execFileSync('git', ['config', 'user.email', 'test@autowin.local'], { cwd: workspace })
      execFileSync('git', ['config', 'user.name', 'Autowin Test'], { cwd: workspace })
      execFileSync('git', ['add', '.'], { cwd: workspace })
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: workspace })
      const os = fakeOs()
      os.executionWorkspace = workspace
      os.worktrees = {
        begin: vi.fn(() => workspace),
        end: vi.fn(() => ({ outcome: 'nothing', agentId: 'command' }))
      }
      const bus = new AppCommandBus(os, () => {})

      const [first, second] = await Promise.all([
        bus.exec(
          'edit_file',
          { path: 'target.txt', oldText: 'zéro', newText: 'un' },
          'conv-1',
          'auto',
          undefined,
          'turn-1'
        ),
        bus.exec(
          'edit_file',
          { path: 'target.txt', oldText: 'un', newText: 'deux' },
          'conv-2',
          'auto',
          undefined,
          'turn-2'
        )
      ])

      expect(first).toMatchObject({ ok: true, data: { allowed: true } })
      expect(second).toMatchObject({ ok: true, data: { allowed: true } })
      expect(readFileSync(join(workspace, 'target.txt'), 'utf8')).toBe('deux\n')
      expect(readCurrentConversationPathOwnership('conv-1')).toEqual([
        expect.objectContaining({ conversationId: 'conv-1', path: 'target.txt' })
      ])
      expect(readCurrentConversationPathOwnership('conv-2')).toEqual([
        expect.objectContaining({ conversationId: 'conv-2', path: 'target.txt' })
      ])
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA
      else process.env.APPDATA = previousAppData
      rmSync(appData, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('alimente /kaizen avec le dossier Autowin de la conversation ciblée', async () => {
    const previousAppData = process.env.APPDATA
    const appData = mkdtempSync(join(tmpdir(), 'autowin-kaizen-command-'))
    process.env.APPDATA = appData
    try {
      const os = fakeOs()
      const bus = new AppCommandBus(os, () => {})
      const result = await bus.exec('orchestrate', { task: '/kaizen' }, 'conv-1')

      expect(result).toMatchObject({ ok: true })
      expect(os.calls.lastTask).toContain('DOSSIER DE PREUVE AUTOWIN OS')
      expect(os.calls.lastTask).toContain('le worktree est resté ouvert')
      expect(os.calls.lastTask).toContain('"source":"autowin-os"')
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA
      else process.env.APPDATA = previousAppData
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('launches ordinary orchestration immediately even when the conversation is in Ask mode', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})

    const result = await bus.exec(
      'orchestrate',
      { task: 'corrige le clic extérieur puis teste' },
      'conv-1',
      'ask'
    )

    expect(result).toMatchObject({ ok: true })
    expect(os.calls.runTask).toBe(1)
    expect(os.authority.pending()).toHaveLength(0)
  })

  it('reuses the pending decision for an identical destructive action', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})

    const first = await bus.exec('remove_conversation', { id: 'conv-1' })
    const second = await bus.exec('remove_conversation', { id: 'conv-1' })

    expect((second.data as { decisionId: string }).decisionId).toBe(
      (first.data as { decisionId: string }).decisionId
    )
    expect(os.authority.pending()).toHaveLength(1)
  })

  it('does not merge destructive decisions whose targets differ', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})

    const first = await bus.exec('remove_conversation', { id: 'conv-1' })
    const second = await bus.exec('remove_conversation', { id: 'conv-2' })

    expect((second.data as { decisionId: string }).decisionId).not.toBe(
      (first.data as { decisionId: string }).decisionId
    )
    expect(os.authority.pending()).toHaveLength(2)
  })

  it('publie les destinations canoniques et autorise la navigation en mode Plan', async () => {
    const events: Array<{ type: string; tab?: string }> = []
    const bus = new AppCommandBus(fakeOs(), (event) => events.push(event))
    const navigate = bus.catalog().find((tool) => tool.name === 'navigate')

    expect(navigate?.args.tab).toBe(APP_DESTINATIONS.map(({ id }) => id).join('|'))
    expect(navigate?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })

    const result = await bus.exec('navigate', { tab: 'router' }, undefined, 'plan')
    expect(result).toMatchObject({
      ok: true,
      data: { tab: 'agent-studio', section: 'routing' }
    })
    expect(events).toContainEqual({ type: 'navigate', tab: 'router' })
    await expect(bus.snapshot()).resolves.toMatchObject({ tab: 'agent-studio' })
  })

  it('publie et exécute le tool Graphify avec un chemin borné au workspace', async () => {
    const graphify = vi.fn(async () => ({
      action: 'updated' as const,
      target: 'packages/api',
      graph: 'packages/api/graphify-out/graph.json',
      nodes: 42,
      links: 84,
      durationMs: 120
    }))
    const os = fakeOs()
    os.worktrees = {
      begin: vi.fn(() => process.cwd()),
      end: vi.fn(() => ({ outcome: 'nothing', agentId: 'command' }))
    }
    const bus = new AppCommandBus(os, () => {}, undefined, graphify)
    const specification = bus.catalog().find((tool) => tool.name === 'graphify')

    expect(specification).toMatchObject({
      args: { path: expect.stringContaining('facultatif') },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    })
    await expect(
      bus.exec('graphify', { path: 'packages/api' }, undefined, 'auto')
    ).resolves.toMatchObject({
      ok: true,
      data: { action: 'updated', nodes: 42, links: 84 }
    })
    expect(graphify).toHaveBeenCalledWith({
      workspaceRoot: process.cwd(),
      path: 'packages/api'
    })
  })

  it('isole edit_file dans un bureau puis publie seulement sa copie', async () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-command-base-'))
    const copy = mkdtempSync(join(tmpdir(), 'autowin-command-copy-'))
    try {
      writeFileSync(join(base, 'note.txt'), 'avant\n', 'utf8')
      writeFileSync(join(copy, 'note.txt'), 'avant\n', 'utf8')
      writeFileSync(
        join(copy, 'package.json'),
        JSON.stringify({ scripts: { 'test:unit': 'node -e "process.exit(0)"' } }),
        'utf8'
      )
      const os = fakeOs()
      os.executionWorkspace = base
      os.worktrees = {
        begin: vi.fn(() => copy),
        end: vi.fn(() => ({ outcome: 'merged', agentId: 'command', committed: true }))
      }
      const bus = new AppCommandBus(os, () => {})

      const result = await bus.exec(
        'edit_file',
        { path: 'note.txt', oldText: 'avant', newText: 'après' },
        'conv-1',
        'auto'
      )

      expect(result).toMatchObject({ ok: true, data: { allowed: true } })
      expect(readFileSync(join(base, 'note.txt'), 'utf8')).toBe('avant\n')
      expect(readFileSync(join(copy, 'note.txt'), 'utf8')).toBe('après\n')
      expect(os.worktrees.begin).toHaveBeenCalledWith(
        expect.stringMatching(/^command-edit-/),
        'Commande edit_file',
        true,
        expect.objectContaining({ conversationId: 'conv-1' })
      )
      expect(os.worktrees.end).toHaveBeenCalledWith(expect.any(String), { merge: true })
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(copy, { recursive: true, force: true })
    }
  })

  it('conserve edit_file sans publier quand la vérification du bureau échoue', async () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-command-base-'))
    const copy = mkdtempSync(join(tmpdir(), 'autowin-command-copy-'))
    try {
      writeFileSync(join(base, 'code.ts'), 'export const ok = 1\n', 'utf8')
      writeFileSync(join(copy, 'code.ts'), 'export const ok = 1\n', 'utf8')
      writeFileSync(
        join(copy, 'package.json'),
        JSON.stringify({ scripts: { 'test:unit': 'node check.mjs' } }),
        'utf8'
      )
      writeFileSync(
        join(copy, 'check.mjs'),
        "import { readFileSync } from 'node:fs'; process.exit(readFileSync('code.ts','utf8').includes('export const =') ? 1 : 0)\n",
        'utf8'
      )
      const os = fakeOs()
      os.executionWorkspace = base
      os.worktrees = {
        begin: vi.fn(() => copy),
        end: vi.fn((_id: string, options: { merge: boolean }) =>
          options.merge
            ? { outcome: 'merged', agentId: 'command', committed: true }
            : { outcome: 'nothing', agentId: 'command' }
        )
      }
      const bus = new AppCommandBus(os, () => {})

      const result = await bus.exec(
        'edit_file',
        { path: 'code.ts', oldText: 'export const ok = 1', newText: 'export const =' },
        'conv-1',
        'auto'
      )

      expect(result).toMatchObject({ ok: false })
      expect(readFileSync(join(base, 'code.ts'), 'utf8')).toBe('export const ok = 1\n')
      expect(readFileSync(join(copy, 'code.ts'), 'utf8')).toBe('export const =\n')
      expect(os.worktrees.end).toHaveBeenCalledWith(expect.any(String), { merge: false })
      expect(os.worktrees.end).not.toHaveBeenCalledWith(expect.any(String), { merge: true })
    } finally {
      rmSync(base, { recursive: true, force: true })
      rmSync(copy, { recursive: true, force: true })
    }
  })

  it('garde réellement la base intacte et le bureau rouge après un edit_file invalide', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'autowin-command-git-'))
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-command-wt-'))
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    try {
      git('init', '-q', '-b', 'main')
      git('config', 'user.email', 't@t')
      git('config', 'user.name', 'T')
      git('config', 'commit.gpgsign', 'false')
      writeFileSync(join(repo, 'code.ts'), 'export const ok = 1\n', 'utf8')
      writeFileSync(
        join(repo, 'package.json'),
        JSON.stringify({ scripts: { 'test:unit': 'node check.mjs' } }),
        'utf8'
      )
      writeFileSync(
        join(repo, 'check.mjs'),
        "import { readFileSync } from 'node:fs'; process.exit(readFileSync('code.ts','utf8').includes('export const =') ? 1 : 0)\n",
        'utf8'
      )
      git('add', '-A')
      git('commit', '-q', '-m', 'init')
      const baseHead = git('rev-parse', 'HEAD')
      const manager = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
      const coordinator = new RunWorktreeCoordinator({ manager })
      const os = fakeOs()
      os.executionWorkspace = repo
      os.worktrees = coordinator
      const bus = new AppCommandBus(os, () => {})

      const result = await bus.exec(
        'edit_file',
        { path: 'code.ts', oldText: 'export const ok = 1', newText: 'export const =' },
        'conv-1',
        'auto'
      )

      expect(result).toMatchObject({ ok: false })
      expect(git('rev-parse', 'HEAD')).toBe(baseHead)
      expect(git('status', '--porcelain')).toBe('')
      expect(readFileSync(join(repo, 'code.ts'), 'utf8')).toBe('export const ok = 1\n')
      const activity = coordinator.activity()[0]
      expect(activity).toMatchObject({
        state: 'ready',
        verdict: 'red',
        publication: 'not-requested'
      })
      expect(activity.worktreePath && existsSync(activity.worktreePath)).toBe(true)
      expect(readFileSync(join(activity.worktreePath!, 'code.ts'), 'utf8').trim()).toBe(
        'export const ='
      )
    } finally {
      rmSync(repo, { recursive: true, force: true })
      rmSync(wtRoot, { recursive: true, force: true })
    }
  })

  it('publie réellement une seule fois edit_file après vérification verte', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'autowin-command-git-'))
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-command-wt-'))
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    try {
      git('init', '-q', '-b', 'main')
      git('config', 'user.email', 't@t')
      git('config', 'user.name', 'T')
      git('config', 'commit.gpgsign', 'false')
      writeFileSync(join(repo, 'code.ts'), 'export const ok = 1\n', 'utf8')
      writeFileSync(
        join(repo, 'package.json'),
        JSON.stringify({ scripts: { 'test:unit': 'node check.mjs' } }),
        'utf8'
      )
      writeFileSync(
        join(repo, 'check.mjs'),
        "import { readFileSync } from 'node:fs'; process.exit(readFileSync('code.ts','utf8').includes('export const =') ? 1 : 0)\n",
        'utf8'
      )
      git('add', '-A')
      git('commit', '-q', '-m', 'init')
      const manager = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
      const coordinator = new RunWorktreeCoordinator({ manager })
      const os = fakeOs()
      os.executionWorkspace = repo
      os.worktrees = coordinator
      const bus = new AppCommandBus(os, () => {})

      const result = await bus.exec(
        'edit_file',
        { path: 'code.ts', oldText: 'export const ok = 1', newText: 'export const ok = 2' },
        'conv-1',
        'auto'
      )

      expect(result).toMatchObject({ ok: true, data: { allowed: true } })
      expect(readFileSync(join(repo, 'code.ts'), 'utf8').trim()).toBe('export const ok = 2')
      expect(git('log', '--format=%s')).toMatch(/^agent command-edit-/)
      expect(
        git('log', '--format=%s')
          .split('\n')
          .filter((line) => line.startsWith('agent command-edit-'))
      ).toHaveLength(1)
      expect(coordinator.activity()[0]).toMatchObject({
        state: 'merged',
        verdict: 'green',
        publication: 'complete'
      })
      expect(coordinator.activity()[0].worktreePath).toBeTruthy()
      expect(existsSync(coordinator.activity()[0].worktreePath!)).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
      rmSync(wtRoot, { recursive: true, force: true })
    }
  })

  it('bloque graphify avant exécution quand aucun bureau isolé n’est disponible', async () => {
    const graphify = vi.fn(async () => ({
      action: 'created' as const,
      target: '.',
      graph: 'graphify-out/graph.json',
      nodes: 0,
      links: 0,
      durationMs: 1
    }))
    const os = fakeOs()
    os.worktrees = undefined
    const bus = new AppCommandBus(os, () => {}, undefined, graphify)

    await expect(bus.exec('graphify', {}, 'conv-1', 'auto')).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('isolation')
    })
    expect(graphify).not.toHaveBeenCalled()
  })

  it('conserve le graphe dans le cache Autowin après rangement du bureau isolé', async () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-graph-base-'))
    const copy = mkdtempSync(join(tmpdir(), 'autowin-graph-copy-'))
    const appData = mkdtempSync(join(tmpdir(), 'autowin-graph-appdata-'))
    vi.stubEnv('APPDATA', appData)
    try {
      const graphify = vi.fn(async ({ workspaceRoot }: { workspaceRoot: string }) => {
        const graph = join(workspaceRoot, 'graphify-out', 'graph.json')
        mkdirSync(join(workspaceRoot, 'graphify-out'), { recursive: true })
        writeFileSync(graph, '{"nodes":[],"links":[]}', 'utf8')
        return {
          action: 'created' as const,
          target: '.',
          graph: 'graphify-out/graph.json',
          nodes: 0,
          links: 0,
          durationMs: 1
        }
      })
      const os = fakeOs()
      os.executionWorkspace = base
      os.worktrees = {
        begin: () => copy,
        end: () => {
          rmSync(copy, { recursive: true, force: true })
          return { outcome: 'nothing', agentId: 'command' }
        }
      }
      const bus = new AppCommandBus(os, () => {}, undefined, graphify)

      const result = await bus.exec('graphify', {}, 'conv-1', 'auto')
      const graphPath = (result.data as { graph: string }).graph

      expect(result.ok).toBe(true)
      expect(existsSync(graphPath)).toBe(true)
      expect(graphPath).toContain('graphify-cache')
      expect(existsSync(join(base, 'graphify-out', 'graph.json'))).toBe(false)
      expect(existsSync(copy)).toBe(false)
    } finally {
      vi.unstubAllEnvs()
      rmSync(base, { recursive: true, force: true })
      rmSync(copy, { recursive: true, force: true })
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('snapshotForPrompt : projection minimale — pas de conversations inline, runs bloqués seulement', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})
    const prompt = await bus.snapshotForPrompt()
    // Le poids (liste des conversations) n'est PAS injecté : seul le count.
    expect(prompt).not.toHaveProperty('conversations')
    expect(typeof prompt.conversationsCount).toBe('number')
    // Runs : uniquement les bloqués, et sans le champ `blocked` (redondant après filtre).
    expect(prompt.runsBlocked.every((r) => 'subject' in r && !('blocked' in r))).toBe(true)
    // Champs utiles conservés.
    expect(prompt).toMatchObject({ tab: expect.any(String), providers: expect.any(Array) })
  })

  it('enforces conversation Plan and Auto modes before any mutation', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})

    const planned = await bus.exec('remove_conversation', { id: 'conv-1' }, 'conv-1', 'plan')
    expect(planned).toMatchObject({ ok: false })
    expect(os.conversations.get('conv-1')).toBeTruthy()
    expect(os.authority.pending()).toHaveLength(0)

    const automatic = await bus.exec('remove_conversation', { id: 'conv-1' }, 'conv-1', 'auto')
    expect(automatic).toMatchObject({ ok: true, data: { pendingApproval: true } })
    expect(os.conversations.get('conv-1')).toBeTruthy()
  })

  it('defers deletion until human approval and consumes it once', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})
    const requested = await bus.exec('remove_conversation', { id: 'conv-1' })
    const decisionId = (requested.data as { decisionId: string }).decisionId

    expect(requested.ok).toBe(true)
    expect(os.conversations.get('conv-1')).toBeTruthy()
    await bus.resolveDecision(decisionId, 'approve')
    expect(os.conversations.get('conv-1')).toBeUndefined()
    await expect(bus.resolveDecision(decisionId, 'approve')).resolves.toMatchObject({
      id: decisionId,
      choice: 'approve'
    })
  })

  it('does not expose decision resolution to the model and annotates risk', () => {
    const catalogue = new AppCommandBus(fakeOs(), () => {}).catalog()
    expect(catalogue.some((tool) => tool.name === 'resolve_decision')).toBe(false)
    expect(
      catalogue.find((tool) => tool.name === 'remove_conversation')?.annotations
    ).toMatchObject({
      destructiveHint: true,
      readOnlyHint: false
    })
    expect(catalogue.every((tool) => tool.annotations !== undefined)).toBe(true)
    expect(catalogue.find((tool) => tool.name === 'get_state')?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false
    })
    expect(catalogue.find((tool) => tool.name === 'orchestrate')?.description).toMatch(
      /lire, modifier et tester le code/i
    )
  })

  it('runs reversible actions immediately and reserves approval for deletion', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})
    bus.activeConversationId = 'conv-1'
    await bus.exec('set_role', { role: 'judge', provider: 'codex', model: 'gpt-5' })
    await bus.exec('attach_run', { path: 'C:/private/RUN.md' })
    await bus.exec('orchestrate', { task: 'use token=top-secret' })
    const deletion = await bus.exec('remove_conversation', { id: 'conv-1' })

    expect(os.calls).toMatchObject({ setRole: 1, attachRun: 1, runTask: 1 })
    expect(os.authority.pending()).toHaveLength(1)
    expect(deletion).toMatchObject({ ok: true, data: { pendingApproval: true } })
    expect(os.conversations.get('conv-1')).toBeTruthy()
  })

  it('traces choice and redacted result, then cancels expiry without mutation', async () => {
    let now = 0
    const os = fakeOs()
    os.authority = new AuthoritySas(() => now)
    const entries: Array<{ name: string; args: Record<string, unknown>; ok: boolean }> = []
    const bus = new AppCommandBus(os, () => {})
    bus.trace = (name, args, ok) => entries.push({ name, args, ok })
    await bus.exec('orchestrate', { task: 'Bearer top-secret' })
    expect(entries).toContainEqual(
      expect.objectContaining({ name: 'orchestrate', args: { task: '[redacted]' }, ok: true })
    )
    const expired = await bus.exec('remove_conversation', { id: 'conv-1' })
    now = 15 * 60_000
    expect(bus.sweepExpired()).toHaveLength(1)
    expect(entries).toContainEqual(expect.objectContaining({ name: 'authority_decision' }))
    await expect(bus.resolveDecision((expired.data as any).decisionId, 'approve')).rejects.toThrow()
    expect(os.conversations.get('conv-1')).toBeTruthy()
  })
})
