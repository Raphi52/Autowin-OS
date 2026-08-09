import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { AppCommandBus, isolateWatchdogPromptPaths } from './commands'
import { APP_DESTINATIONS } from '../shared/navigation'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readConversationFilePaths,
  readConversationTurnFileMutations,
  readCurrentConversationPathOwnership
} from './activity/conversation-file-trace-spool'
import { exactLineFingerprint } from './exact-line-fingerprint'
import { readBrainTraces } from './activity/brain-trace-spool'
import { WorktreeManager } from './store/worktree-manager'
import { RunWorktreeCoordinator } from './store/run-worktree-coordinator'
import { TraceStore } from './activity/trace-store'
import type { BrainRetrievalOptions } from './brain-retrieval'
import type { OrchestrationStep } from './orchestrator'

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

describe('isolation du prompt watchdog', () => {
  it('retire le chemin absolu de la base et interdit de modifier la source', () => {
    const root = 'C:\\repo'
    const watched = 'C:\\repo\\logs\\app.log'
    const prompt = `Source : fichier surveillé ${watched}\nERROR initiale`

    const isolated = isolateWatchdogPromptPaths(prompt, [watched], root)

    expect(isolated).not.toContain(watched)
    expect(isolated).toContain('logs/app.log')
    expect(isolated).toContain('preuve en lecture seule')
    expect(isolated).toContain('ne la recrée jamais')
  })
})

describe('AppCommandBus orchestration cancel (#2)', () => {
  it('brain_query ne contacte pas le Brain avec un override corpus malformé', async () => {
    vi.stubEnv('AUTOWIN_BRAIN_CORPUS', ',')
    try {
      const retrieve = vi.fn(async () => ({ context: 'INTERDIT', status: 'found' as const }))
      const result = await new AppCommandBus(
        fakeOs(),
        () => {},
        undefined,
        undefined,
        undefined,
        retrieve
      ).exec('brain_query', { question: 'secret transverse' })

      expect(retrieve).not.toHaveBeenCalled()
      expect(result).toMatchObject({ ok: true, data: { found: false, status: 'empty' } })
      expect(JSON.stringify(result)).not.toContain('INTERDIT')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('brain_query isole le vrai workspace RigApplication d une source Autowin adverse', async () => {
    const os = fakeOs()
    os.executionWorkspace = 'D:\\DevSrc\\RigApplication'
    const preamble = '[AMITEL BRAIN REFERENCE DATA]\n\n'
    const sources = [
      {
        path: 'knowledge/domain/rigapplication-documentation/reference/proc.md',
        content:
          '### Source 1 — knowledge/domain/rigapplication-documentation/reference/proc.md\nRIG_COMMANDE_AUTORISEE'
      },
      {
        path: 'knowledge/domain/autowin-os-realite-produit-v5.md',
        content:
          '### Source 2 — knowledge/domain/autowin-os-realite-produit-v5.md\nAUTOWIN_COMMANDE_INTERDITE'
      }
    ]
    const mixedContext = preamble + sources.map(({ content }) => content).join('\n\n---\n\n')
    const seenCorpus: Array<readonly string[] | undefined> = []
    const retrieve = vi.fn(async (_query: string, options?: BrainRetrievalOptions) => {
      seenCorpus.push(options?.corpus)
      return {
        context: mixedContext,
        status: 'found' as const,
        corpus: options?.corpus,
        structuredContext: { preamble, sources }
      }
    })
    const bus = new AppCommandBus(os, () => {}, undefined, undefined, undefined, retrieve)

    const result = await bus.exec('brain_query', { question: 'architecture RIG' })

    expect(seenCorpus[0]).toContain('knowledge/domain/rigapplication-documentation/')
    expect(result).toMatchObject({ ok: true, data: { found: true } })
    expect(JSON.stringify(result)).toContain('RIG_COMMANDE_AUTORISEE')
    expect(JSON.stringify(result)).not.toContain('AUTOWIN_COMMANDE_INTERDITE')
  })

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
      await bus.exec('orchestrate', { task: '/build corrige la typo' }, 'conv-1')
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
      binding
    )

    expect(receivedBinding).toEqual(binding)
  })

  it("respecte la phase build choisie pour une correction bornée qui interdit le refactoring", async () => {
    const os = fakeOs()
    let receivedTask = ''
    os.runTask = async (...args: unknown[]) => {
      receivedTask = String(args[0] ?? '')
      return {
        gateBlocked: false,
        gateReasons: [],
        valid: true,
        costUsd: 0,
        result: '',
        phaseOutputs: []
      }
    }

    await new AppCommandBus(os, () => {}).exec(
      'orchestrate',
      {
        task: 'Implémente les trois corrections ciblées. Ne pas refactorer ChatView.',
        phase: 'build'
      },
      'conv-1'
    )

    expect(receivedTask).toMatch(/^\/build /)
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
      'conv-1'
    )
    expect(result.ok).toBe(true)
    expect(collected).toMatch(/^\[COLLECTE DE CONTEXTE — effectuée avant RUN.md et délégation\]/)
    expect(collected).toContain('Conversation: conv-1 — A garder')
  })

  it('propage la couverture du coût pour ne pas présenter un tarif inconnu comme zéro', async () => {
    const os = fakeOs()
    os.runTask = async () => ({
      gateBlocked: false,
      gateReasons: [],
      valid: true,
      costUsd: 0,
      usage: {
        startedCalls: 3,
        completedCalls: 3,
        failedCalls: 0,
        activeCalls: 0,
        startedAgents: 3,
        activeAgents: 0,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 80,
        totalTokens: 120,
        freshInputTokens: 20,
        knownCostUsd: null,
        unpricedCalls: 3
      },
      result: '',
      phaseOutputs: []
    })

    const result = await new AppCommandBus(os, () => {}).exec(
      'orchestrate',
      { task: '/build corrige la typo' },
      'conv-1'
    )

    expect(result).toMatchObject({
      ok: true,
      data: { costUsd: 0, knownCostUsd: null, unpricedCalls: 3 }
    })
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
    const first = bus.exec('orchestrate', { task: 'corrige puis teste' }, 'conv-1')
    await vi.waitFor(() => expect(os.calls.runTask).toBe(1), { timeout: 10_000 })

    const second = await bus.exec('orchestrate', { task: 'corrige puis teste' }, 'conv-1')

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

    const first = bus.exec('orchestrate', { task: 'corrige puis teste' }, 'conv-1', claude)
    await vi.waitFor(() => expect(os.calls.runTask).toBe(1), { timeout: 5_000 })
    const second = bus.exec('orchestrate', { task: 'corrige puis teste' }, 'conv-1', codex)

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

    const oldRun = bus.exec('orchestrate', { task: 'ancien' }, 'conv-1')
    const newRun = bus.exec('orchestrate', { task: 'nouveau' }, 'conv-1')
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

describe('AppCommandBus command execution policy', () => {
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
      await new AppCommandBus(os, () => {}).exec('orchestrate', { task: 'ping' }, 'conv-1')

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
        undefined,
        'turn-1'
      )
      const brain = await bus.exec(
        'brain_query',
        { question: 'quelle décision ?' },
        'conv-1',
        undefined,
        'turn-1'
      )

      expect(edit).toMatchObject({ ok: true, data: { allowed: true, path: 'target.txt' } })
      expect(readFileSync(join(workspace, 'target.txt'), 'utf8')).toContain('après')
      expect(readConversationFilePaths('conv-1')).toEqual(['target.txt'])
      expect(readConversationFilePaths('conv-2')).toEqual([])
      expect(readConversationTurnFileMutations('conv-1', 'turn-1').lineFingerprintsByPath).toEqual({
        [join(workspace, 'target.txt').replaceAll('\\', '/').toLowerCase()]: [
          exactLineFingerprint('après')
        ]
      })
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

  it('attribue les lignes finales du fichier, pas les fragments oldText/newText', async () => {
    const previousAppData = process.env.APPDATA
    const appData = mkdtempSync(join(tmpdir(), 'autowin-edit-final-lines-'))
    const workspace = mkdtempSync(join(tmpdir(), 'autowin-edit-final-workspace-'))
    process.env.APPDATA = appData
    try {
      writeFileSync(join(workspace, 'target.txt'), 'prefix needle suffix\n', 'utf8')
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

      await bus.exec(
        'edit_file',
        { path: 'target.txt', oldText: 'needle', newText: 'ERROR future' },
        'conv-final',
        undefined,
        'turn-final'
      )

      const claims = readConversationTurnFileMutations('conv-final', 'turn-final')
      expect(Object.values(claims.lineFingerprintsByPath)).toEqual([
        [exactLineFingerprint('prefix ERROR future suffix')]
      ])
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA
      else process.env.APPDATA = previousAppData
      rmSync(appData, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('publie la causalite orchestration sur la base et ignore les claims outil non valides', async () => {
    const previousAppData = process.env.APPDATA
    const appData = mkdtempSync(join(tmpdir(), 'autowin-orchestration-published-'))
    const workspace = mkdtempSync(join(tmpdir(), 'autowin-orchestration-base-'))
    const worktree = mkdtempSync(join(tmpdir(), 'autowin-orchestration-worktree-'))
    process.env.APPDATA = appData
    try {
      const os = fakeOs()
      os.executionWorkspace = workspace
      os.runTask = async (...args: unknown[]) => {
        const onStep = args[1] as (step: OrchestrationStep) => void
        onStep({
          step: 'exec',
          role: 'subagent',
          text: 'fait',
          status: 'completed',
          evidence: [
            {
              type: 'file_change',
              kind: 'mutation',
              status: 'completed',
              ok: true,
              summary: 'claim outil',
              paths: ['logs/app.log'],
              workspaceRoot: worktree,
              writtenLineFingerprints: [exactLineFingerprint('ERROR fantôme')]
            },
            {
              type: 'workspace_delta',
              kind: 'mutation',
              status: 'completed',
              ok: true,
              summary: 'delta publié',
              paths: ['logs/app.log'],
              workspaceRoot: worktree,
              writtenLineFingerprintsByPath: {
                'logs/app.log': [exactLineFingerprint('ERROR publiée')]
              }
            }
          ]
        })
        return {
          gateBlocked: false,
          gateReasons: [],
          valid: true,
          costUsd: 0,
          result: 'fait',
          phaseOutputs: [],
          causalMutationEvidence: [
            {
              type: 'workspace_delta',
              kind: 'mutation',
              status: 'completed',
              ok: true,
              summary: 'delta publié',
              paths: ['logs/app.log'],
              workspaceRoot: worktree,
              writtenLineFingerprintsByPath: {
                'logs/app.log': [exactLineFingerprint('ERROR publiée')]
              }
            }
          ]
        }
      }
      const bus = new AppCommandBus(os, () => {})

      const response = await bus.exec(
        'orchestrate',
        { task: 'corrige le log', causalWatchPaths: [join(workspace, 'logs/app.log')] },
        'conv-1'
      )
      const turnId = (response.data as { turnId: string }).turnId
      const mutations = readConversationTurnFileMutations('conv-1', turnId)
      const basePath = join(workspace, 'logs/app.log').replaceAll('\\', '/').toLowerCase()

      expect(mutations.lineFingerprintsByPath).toEqual({
        [basePath]: [exactLineFingerprint('ERROR publiée')]
      })
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA
      else process.env.APPDATA = previousAppData
      rmSync(appData, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
      rmSync(worktree, { recursive: true, force: true })
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
          undefined,
          'turn-1'
        ),
        bus.exec(
          'edit_file',
          { path: 'target.txt', oldText: 'un', newText: 'deux' },
          'conv-2',
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

  it('alimente un Auto-Kaizen avec les preuves de sa conversation source', async () => {
    const previousAppData = process.env.APPDATA
    const appData = mkdtempSync(join(tmpdir(), 'autowin-auto-kaizen-command-'))
    process.env.APPDATA = appData
    try {
      const os = fakeOs()
      const sourceGet = os.conversations.get
      os.conversations.get = (id: string) =>
        id === 'conv-analysis'
          ? {
              id,
              title: 'Auto-Kaizen',
              category: 'codex',
              provider: 'codex',
              messages: [{ role: 'user', content: '/kaizen incident figé', ts: 2 }],
              runPaths: [],
              autoKaizen: {
                incidentId: 'ak-1',
                sourceConversationId: 'conv-1',
                role: 'analysis',
                rootIncidentId: 'ak-1',
                depth: 0
              }
            }
          : sourceGet(id)
      const bus = new AppCommandBus(os, () => {})

      const result = await bus.exec(
        'orchestrate',
        { task: '/kaizen incident figé' },
        'conv-analysis'
      )

      expect(result).toMatchObject({ ok: true })
      expect(os.calls.lastTask).toContain('le worktree est resté ouvert')
      expect(os.calls.lastTask).not.toContain('"title":"Auto-Kaizen"')
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA
      else process.env.APPDATA = previousAppData
      rmSync(appData, { recursive: true, force: true })
    }
  })

  it('launches ordinary orchestration immediately', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})

    const result = await bus.exec(
      'orchestrate',
      { task: 'corrige le clic extérieur puis teste' },
      'conv-1'
    )

    expect(result).toMatchObject({ ok: true })
    expect(os.calls.runTask).toBe(1)
  })

  it('publie les destinations canoniques et autorise la navigation', async () => {
    const events: Array<{ type: string; tab?: string }> = []
    const bus = new AppCommandBus(fakeOs(), (event) => events.push(event))
    const navigate = bus.catalog().find((tool) => tool.name === 'navigate')

    expect(navigate?.args.tab).toBe(APP_DESTINATIONS.map(({ id }) => id).join('|'))
    expect(navigate?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })

    const result = await bus.exec('navigate', { tab: 'router' })
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
    await expect(bus.exec('graphify', { path: 'packages/api' })).resolves.toMatchObject({
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
        'conv-1'
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
        'conv-1'
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
        'conv-1'
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
        'conv-1'
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

    await expect(bus.exec('graphify', {}, 'conv-1')).resolves.toMatchObject({
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

      const result = await bus.exec('graphify', {}, 'conv-1')
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

  it('executes destructive commands immediately without an authority decision', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})

    const result = await bus.exec('remove_conversation', { id: 'conv-1' }, 'conv-1')

    expect(result).toMatchObject({ ok: true, data: { removed: true } })
    expect(os.conversations.get('conv-1')).toBeUndefined()
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
    expect(catalogue.find((tool) => tool.name === 'edit_file')?.annotations).toMatchObject({
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
    expect(catalogue.some((tool) => tool.name === 'set_role')).toBe(false)
  })

  it('runs reversible and destructive actions immediately', async () => {
    const os = fakeOs()
    const bus = new AppCommandBus(os, () => {})
    bus.activeConversationId = 'conv-1'
    await bus.exec('attach_run', { path: 'C:/private/RUN.md' })
    await bus.exec('orchestrate', { task: 'use token=top-secret' })
    const deletion = await bus.exec('remove_conversation', { id: 'conv-1' })

    expect(os.calls).toMatchObject({ setRole: 0, attachRun: 1, runTask: 1 })
    expect(deletion).toMatchObject({ ok: true, data: { removed: true } })
    expect(os.conversations.get('conv-1')).toBeUndefined()
  })

  it('redacts sensitive command arguments on success and failure without an approval layer', async () => {
    const traces: Array<{ name: string; args: Record<string, unknown>; ok: boolean }> = []
    const bus = new AppCommandBus(fakeOs(), () => {})
    bus.trace = (name, args, ok) => traces.push({ name, args, ok })

    await bus.exec('orchestrate', { task: 'use token=top-secret' })
    await bus.exec('edit_file', {
      path: 'missing.txt',
      oldText: 'password=before',
      newText: 'password=after'
    })

    expect(traces).toContainEqual({
      name: 'orchestrate',
      args: { task: '[redacted]' },
      ok: true
    })
    expect(traces).toContainEqual({
      name: 'edit_file',
      args: { path: 'missing.txt', oldText: '[REDACTED]', newText: '[REDACTED]' },
      ok: false
    })
    expect(JSON.stringify(traces)).not.toMatch(/top-secret|password=before|password=after/)
  })

  it('refuse la commande legacy set_role sans muter un rôle caché', async () => {
    const os = fakeOs()

    const result = await new AppCommandBus(os, () => {}).exec('set_role', {
      role: 'judge',
      provider: 'gemini',
      model: 'gemini-2.5-pro'
    })

    expect(result).toMatchObject({ ok: false, error: 'Commande inconnue: set_role' })
    expect(os.calls.setRole).toBe(0)
  })

  it('expose et execute directement observation et gestes desktop injectes', async () => {
    const image = {
      name: 'desktop.jpg',
      mimeType: 'image/jpeg',
      size: 3,
      kind: 'image' as const,
      content: 'YWJj'
    }
    const desktop = {
      observe: vi.fn().mockResolvedValue({
        data: { width: 1280, height: 720, originX: 0, originY: 0 },
        attachment: image
      }),
      act: vi.fn().mockResolvedValue({ executed: 1 })
    }
    const bus = new AppCommandBus(
      fakeOs(),
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      desktop as never
    )

    expect(bus.catalog().map(({ name }) => name)).toEqual(
      expect.arrayContaining(['desktop_observe', 'desktop_act'])
    )
    await expect(bus.exec('desktop_observe')).resolves.toMatchObject({
      ok: true,
      data: { width: 1280, height: 720 },
      attachments: [image]
    })
    await expect(
      bus.exec('desktop_act', { actions: [{ type: 'click', x: 10, y: 20 }] })
    ).resolves.toMatchObject({ ok: true, data: { executed: 1 } })
    expect(desktop.act).toHaveBeenCalledWith([{ type: 'click', x: 10, y: 20 }])
  })

  it('republie une fin provider tardive dans la trace et le graphe du run', async () => {
    const os = fakeOs()
    const root = mkdtempSync(join(tmpdir(), 'autowin-command-late-usage-'))
    const traceStore = new TraceStore(root)
    const broadcasts: Array<Record<string, unknown>> = []
    let publishLateUsage: ((usage: Record<string, unknown>) => void) | undefined
    os.runTask = async (...args: unknown[]) => {
      const onLifecycle = args[11] as (event: unknown) => void
      publishLateUsage = args[13] as (usage: Record<string, unknown>) => void
      onLifecycle({
        runId: 'run-late',
        timestampMs: 1,
        stage: 'workspace',
        workspace: { mode: 'base', repositoryPath: 'C:\\repo', path: 'C:\\repo' }
      })
      onLifecycle({
        runId: 'run-late',
        timestampMs: 2,
        stage: 'closure',
        closure: {
          status: 'red',
          totalDurationMs: 20,
          totalCostUsd: 0,
          usage: { startedCalls: 1, completedCalls: 0, failedCalls: 0, activeCalls: 1 }
        }
      })
      return {
        gateBlocked: true,
        gateReasons: ['watchdog coordination'],
        valid: false,
        costUsd: 0,
        result: '',
        phaseOutputs: []
      }
    }
    const bus = new AppCommandBus(os, (event) => broadcasts.push(event as Record<string, unknown>))
    try {
      bus.setTraceStore(traceStore)
      const result = await bus.exec(
        'orchestrate',
        { task: '/build refactorer le workflow de securite complet' },
        'conv-1'
      )
      const runPath = (result.data as { runPath?: string } | undefined)?.runPath
      expect(publishLateUsage).toBeTypeOf('function')

      publishLateUsage?.({
        quoteId: 'quote-late',
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 1,
        activeCalls: 0,
        inputTokens: 120,
        outputTokens: 8,
        cacheReadTokens: 20,
        totalTokens: 128,
        freshTokens: 108,
        knownCostUsd: null,
        unpricedCalls: 1,
        unmeteredCalls: 0,
        tokenCoverage: 'complete',
        stoppedReason: 'watchdog coordination'
      })

      const closures = traceStore
        .readConversation('conv-1')
        .filter((event) => event.run?.stage === 'closure')
      expect(closures.at(-1)?.run).toMatchObject({
        stage: 'closure',
        closure: { usage: { activeCalls: 0, failedCalls: 1, totalTokens: 128 } }
      })
      expect(runPath && readFileSync(runPath, 'utf8')).toContain(
        'Usage provider finalisee apres cloture'
      )
      expect(broadcasts).toContainEqual(
        expect.objectContaining({ type: 'orchestrate-usage', convId: 'conv-1' })
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("conserve le checkpoint si la reprise est refusee avant d'entrer dans l'orchestrateur", async () => {
    const os = fakeOs()
    const forget = vi.fn()
    os.resumableOrchestrationForTask = () => ({
      runId: 'run-active',
      task: '/build corrige la typo',
      conversationId: 'conv-1',
      phaseOutputs: [{ phase: 'frame', text: 'cadrage deja paye' }],
      executionQuote: { id: 'quote-active' },
      usage: { quoteId: 'quote-active', activeCalls: 1 },
      startedAt: 1,
      updatedAt: 2
    })
    os.forgetResumableOrchestration = forget
    os.runTask = async () => {
      throw new Error('Reprise refusee : 1 appel provider encore actif.')
    }

    const result = await new AppCommandBus(os, () => {}).exec(
      'orchestrate',
      { task: '/build corrige la typo' },
      'conv-1'
    )

    expect(result).toMatchObject({ ok: false })
    expect(forget).not.toHaveBeenCalled()
  })

  it("oublie l'ancien checkpoint seulement apres l'admission effective de la reprise", async () => {
    const os = fakeOs()
    const forget = vi.fn()
    os.resumableOrchestrationForTask = () => ({
      runId: 'run-admitted',
      task: '/build corrige la typo',
      conversationId: 'conv-1',
      phaseOutputs: [{ phase: 'frame', text: 'cadrage deja paye' }],
      startedAt: 1,
      updatedAt: 2
    })
    os.forgetResumableOrchestration = forget
    os.runTask = async (...args: unknown[]) => {
      const onLifecycle = args[11] as (event: unknown) => void
      onLifecycle({
        runId: 'run-new',
        timestampMs: 3,
        stage: 'workspace',
        workspace: { mode: 'base', repositoryPath: 'C:\\repo', path: 'C:\\repo' }
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

    await new AppCommandBus(os, () => {}).exec(
      'orchestrate',
      { task: '/build corrige la typo' },
      'conv-1'
    )

    expect(forget).toHaveBeenCalledTimes(1)
    expect(forget).toHaveBeenCalledWith('run-admitted')
  })
})
