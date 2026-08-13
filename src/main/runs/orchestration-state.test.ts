import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { compileExecutionQuote } from '../execution-quote'
import {
  clearOrchestrationState,
  admitAutomaticResumeRuntime,
  admitLiveReattachment,
  electStartupOrchestrationResumes,
  loadOrchestrationStates,
  pickResumeForTask,
  pickOrchestrationsToResume,
  pickOrchestrationToResume,
  resolveResumableRuntime,
  saveOrchestrationAgentCheckpoint,
  saveOrchestrationState,
  suppressOrchestrationPipeline,
  type OrchestrationRunState
} from './orchestration-state'

let root: string
const state = (runId: string, updatedAt: number, phases: string[]): OrchestrationRunState => ({
  runId,
  task: 'ajoute un bouton',
  phaseOutputs: phases.map((phase) => ({ phase: phase as never, text: `livrable ${phase}` })),
  startedAt: updatedAt - 1000,
  updatedAt
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orch-state-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('état reprenable d’orchestration (survie niveau 3)', () => {
  it('persiste puis relit un run, et l’efface à la clôture', () => {
    saveOrchestrationState(root, state('run-a-1', 1000, ['frame']))
    expect(loadOrchestrationStates(root).map((s) => s.runId)).toEqual(['run-a-1'])
    clearOrchestrationState(root, 'run-a-1')
    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it('persiste le modèle figé et le restaure au redémarrage', () => {
    saveOrchestrationState(root, {
      ...state('run-bound', 1000, ['frame']),
      bindingOverride: {
        provider: 'claude',
        model: 'claude-sonnet',
        reasoningEffort: 'high'
      }
    })

    expect(loadOrchestrationStates(root)[0].bindingOverride).toEqual({
      provider: 'claude',
      model: 'claude-sonnet',
      reasoningEffort: 'high'
    })
    expect(readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')).toContain(
      'resumableRun.bindingOverride'
    )
  })

  it('persiste puis restaure la topologie runtime complete du run', () => {
    const binding = { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'low' as const }
    const runtimeSnapshot = {
      roles: {
        orchestrator: binding,
        subagent: binding,
        judge: binding,
        scout: binding
      },
      phaseFanOut: { scout: [binding], frame: [], terrain: [] },
      judgeFanOut: [binding]
    }
    saveOrchestrationState(root, {
      ...state('run-runtime', 1000, ['frame']),
      runtimeSnapshot
    })

    expect(loadOrchestrationStates(root)[0].runtimeSnapshot).toEqual(runtimeSnapshot)
  })

  it('ignore un runtimeSnapshot present mais structurellement invalide', () => {
    writeFileSync(
      join(root, 'invalid-runtime.json'),
      JSON.stringify({ ...state('invalid-runtime', 1000, ['frame']), runtimeSnapshot: {} }),
      'utf8'
    )

    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it.each([
    ['modele vide', { model: '' }],
    ['provider non canonique', { provider: ' codex ', model: 'gpt-5.6-sol' }],
    ['modele non canonique', { provider: 'codex', model: ' gpt-5.6-sol ' }],
    ['effort inconnu', { reasoningEffort: 'turbo' }],
    ['override de phase vide', { phaseModel: { build: { model: '' } } }]
  ])('ignore un binding runtime invalide : %s', (_label, invalidBinding) => {
    const validBinding = { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'low' }
    const runtimeSnapshot = {
      roles: {
        orchestrator: invalidBinding,
        subagent: validBinding,
        judge: validBinding,
        scout: validBinding
      },
      phaseFanOut: { scout: [], frame: [], terrain: [] },
      judgeFanOut: []
    }
    writeFileSync(
      join(root, `invalid-binding-${readdirSync(root).length}.json`),
      JSON.stringify({ ...state('invalid-binding', 1000, ['frame']), runtimeSnapshot }),
      'utf8'
    )

    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it('ignore un executionQuote present mais structurellement invalide', () => {
    writeFileSync(
      join(root, 'invalid-quote.json'),
      JSON.stringify({ ...state('invalid-quote', 1000, ['frame']), executionQuote: {} }),
      'utf8'
    )

    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it('conserve un executionQuote valide et rejette un usage incomplet', () => {
    saveOrchestrationState(root, {
      ...state('valid-quote', 1000, ['frame']),
      executionQuote: compileExecutionQuote('corrige le checkpoint')
    })
    writeFileSync(
      join(root, 'invalid-usage.json'),
      JSON.stringify({ ...state('invalid-usage', 2000, ['frame']), usage: {} }),
      'utf8'
    )

    expect(loadOrchestrationStates(root).map((entry) => entry.runId)).toEqual(['valid-quote'])
  })

  it('rejette une réservation active liée à une occurrence historique plutôt qu’à l’agent actif', () => {
    const usage = {
      quoteId: 'quote-reservations',
      startedCalls: 1,
      completedCalls: 0,
      failedCalls: 0,
      activeCalls: 1,
      activeReservationIds: ['reservation-historique'],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      freshTokens: 0,
      knownCostUsd: null,
      unpricedCalls: 0,
      unmeteredCalls: 0,
      tokenCoverage: 'complete'
    }
    writeFileSync(
      join(root, 'invalid-reservations.json'),
      JSON.stringify({
        ...state('invalid-reservations', 1000, ['frame']),
        usage,
        agents: [
          { token: 'agent-actif', active: true, reservationId: 'reservation-active' },
          {
            token: 'agent-historique',
            active: false,
            reservationId: 'reservation-historique'
          }
        ]
      }),
      'utf8'
    )

    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it('rejette une collection agents invalide avant le rattachement', () => {
    writeFileSync(
      join(root, 'invalid-agents.json'),
      JSON.stringify({ ...state('invalid-agents', 1000, ['frame']), agents: {} }),
      'utf8'
    )
    writeFileSync(
      join(root, 'invalid-agent-entry.json'),
      JSON.stringify({ ...state('invalid-agent-entry', 1000, ['frame']), agents: [{}] }),
      'utf8'
    )
    writeFileSync(
      join(root, 'invalid-agent-phase.json'),
      JSON.stringify({
        ...state('invalid-agent-phase', 1000, ['frame']),
        agents: [{ token: 'agent-1', phase: 'inconnue' }]
      }),
      'utf8'
    )
    writeFileSync(
      join(root, 'invalid-agent-active.json'),
      JSON.stringify({
        ...state('invalid-agent-active', 1000, ['frame']),
        agents: [{ token: 'agent-1', active: 'oui' }]
      }),
      'utf8'
    )
    writeFileSync(
      join(root, 'invalid-agent-fanout.json'),
      JSON.stringify({
        ...state('invalid-agent-fanout', 1000, ['frame']),
        agents: [{ token: 'agent-1', fanOut: 1 }]
      }),
      'utf8'
    )

    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it.each([
    ['conversationId objet', { conversationId: {} }],
    ['conversationId vide', { conversationId: '   ' }],
    ['turnId tableau', { turnId: [] }],
    ['forkedFrom incomplet', { forkedFrom: {} }],
    [
      'forkedFrom date invalide',
      {
        forkedFrom: {
          checkpointId: 'checkpoint-1',
          runId: 'source-run',
          checkpointCreatedAt: 'jamais',
          contentHash: 'source-hash'
        }
      }
    ],
    ['runId traversal', { runId: '../escape' }],
    ['startedAt non numerique', { startedAt: 'hier' }],
    ['updatedAt nul', { updatedAt: null }]
  ])('ignore le checkpoint hostile : %s', (_label, mutation) => {
    writeFileSync(
      join(root, `hostile-${readdirSync(root).length}.json`),
      JSON.stringify({ ...state('hostile', 1000, ['frame']), ...mutation }),
      'utf8'
    )

    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it('conserve tous les champs optionnels valides du schema checkpoint', () => {
    const complete = {
      ...state('complete-run', 1000, ['frame']),
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      forkedFrom: {
        checkpointId: 'checkpoint-1',
        runId: 'source-run',
        checkpointCreatedAt: '2026-08-08T16:00:00.000Z',
        contentHash: 'source-hash'
      },
      agents: [
        {
          token: 'agent-1',
          phase: 'frame' as const,
          active: true,
          fanOut: false,
          reservationId: 'reservation-tok-1',
          pid: 42,
          identity: 'pid:42',
          journalPath: 'run.jsonl',
          offset: 0
        }
      ]
    }
    saveOrchestrationState(root, complete)

    expect(loadOrchestrationStates(root)).toEqual([complete])
  })

  it('ignore un checkpoint dont le nom de fichier contredit le runId interne', () => {
    writeFileSync(join(root, 'foo.json'), JSON.stringify(state('bar', 1000, ['frame'])), 'utf8')

    expect(loadOrchestrationStates(root)).toEqual([])
  })

  it('reprend le snapshot persiste et migre explicitement un checkpoint historique', () => {
    const codex = { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'low' as const }
    const current = {
      roles: { orchestrator: codex, subagent: codex, judge: codex, scout: codex },
      phaseFanOut: { scout: [], frame: [], terrain: [] },
      judgeFanOut: []
    }
    const claude = { provider: 'claude', model: 'claude-fable-5' }
    const persisted = {
      roles: { orchestrator: claude, subagent: claude, judge: claude, scout: claude },
      phaseFanOut: { scout: [], frame: [], terrain: [] },
      judgeFanOut: []
    }

    expect(
      resolveResumableRuntime(
        { ...state('new', 1, ['frame']), runtimeSnapshot: persisted },
        current
      )
    ).toEqual({ runtimeSnapshot: persisted, migratedLegacyCheckpoint: false })
    expect(resolveResumableRuntime(state('legacy', 1, ['frame']), current)).toEqual({
      runtimeSnapshot: current,
      migratedLegacyCheckpoint: true
    })
  })

  it('admet la meme identite pour la carte et le provider apres un changement Studio A vers B', async () => {
    const snapshot = (provider: string, model: string) => {
      const selected = { provider, model }
      return {
        roles: {
          orchestrator: selected,
          subagent: selected,
          judge: selected,
          scout: selected
        },
        phaseFanOut: { scout: [], frame: [], terrain: [] },
        judgeFanOut: []
      }
    }
    const persisted = snapshot('claude', 'claude-fable-5')
    const current = snapshot('codex', 'gpt-5.6-sol')
    const admission = admitAutomaticResumeRuntime(
      {
        ...state('run-restart-a-b', 1, ['frame']),
        turnId: 'turn-a',
        runtimeSnapshot: persisted
      },
      current,
      'turn-migration',
      persisted.roles.orchestrator
    )
    const calledProviders: string[] = []

    await admission.run(async (runtimeSnapshot) => {
      calledProviders.push(runtimeSnapshot.roles.judge.provider)
    })

    expect(admission).toMatchObject({
      turnId: 'turn-a',
      resumeExisting: true,
      turnBinding: persisted.roles.orchestrator,
      task: 'ajoute un bouton'
    })
    expect(calledProviders).toEqual(['claude'])
  })

  it('ouvre un nouveau tour legacy avec la meme identite que le provider admis', async () => {
    const codex = { provider: 'codex', model: 'gpt-5.6-sol' }
    const current = {
      roles: { orchestrator: codex, subagent: codex, judge: codex, scout: codex },
      phaseFanOut: { scout: [], frame: [], terrain: [] },
      judgeFanOut: []
    }
    const admission = admitAutomaticResumeRuntime(
      { ...state('legacy-restart', 1, ['frame']), turnId: 'turn-historique' },
      current,
      'turn-migration'
    )
    let provider = ''

    await admission.run(async (runtimeSnapshot) => {
      provider = runtimeSnapshot.roles.judge.provider
    })

    expect(admission).toMatchObject({
      turnId: 'turn-migration',
      resumeExisting: false,
      turnBinding: codex,
      task: '[Reprise automatique] ajoute un bouton'
    })
    expect(provider).toBe('codex')
  })

  it('ne réactive pas une carte dont l’identité contredit le snapshot de reprise', () => {
    const codex = { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'low' as const }
    const runtimeSnapshot = {
      roles: { orchestrator: codex, subagent: codex, judge: codex, scout: codex },
      phaseFanOut: { scout: [], frame: [], terrain: [] },
      judgeFanOut: []
    }

    expect(
      admitAutomaticResumeRuntime(
        { ...state('known-relaunch', 1, ['frame']), turnId: 'turn-gemini', runtimeSnapshot },
        runtimeSnapshot,
        'turn-codex',
        { provider: 'gemini', model: 'gemini-2.5-pro' }
      )
    ).toMatchObject({
      resumeExisting: false,
      turnId: 'turn-codex',
      turnBinding: codex,
      task: '[Reprise automatique] ajoute un bouton'
    })
  })

  it('ne reactive jamais une ancienne carte Gemini pour un agent legacy encore vivant', () => {
    const admission = admitLiveReattachment(
      { ...state('legacy-live', 1, ['frame']), turnId: 'turn-gemini' },
      { provider: 'gemini', model: 'gemini-2.5-pro' },
      'turn-rattachement-inconnu'
    )

    expect(admission).toEqual({
      identityKnown: false,
      resumeExisting: false,
      turnId: 'turn-rattachement-inconnu',
      task: '[Rattachement — identité provider inconnue] ajoute un bouton'
    })
  })

  it('ouvre une carte conforme au snapshot si la carte historique porte une autre identite', () => {
    const codex = { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'low' as const }
    const runtimeSnapshot = {
      roles: { orchestrator: codex, subagent: codex, judge: codex, scout: codex },
      phaseFanOut: { scout: [], frame: [], terrain: [] },
      judgeFanOut: []
    }

    expect(
      admitLiveReattachment(
        { ...state('known-live', 1, ['frame']), turnId: 'turn-gemini', runtimeSnapshot },
        { provider: 'gemini', model: 'gemini-2.5-pro' },
        'turn-codex'
      )
    ).toEqual({
      identityKnown: true,
      resumeExisting: false,
      turnId: 'turn-codex',
      turnBinding: codex,
      task: '[Rattachement automatique] ajoute un bouton'
    })
  })

  it('reprend le tour existant seulement si sa carte porte deja le snapshot du run vivant', () => {
    const codex = { provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'low' as const }
    const runtimeSnapshot = {
      roles: { orchestrator: codex, subagent: codex, judge: codex, scout: codex },
      phaseFanOut: { scout: [], frame: [], terrain: [] },
      judgeFanOut: []
    }

    expect(
      admitLiveReattachment(
        { ...state('known-live', 1, ['frame']), turnId: 'turn-codex', runtimeSnapshot },
        codex,
        'turn-inutile'
      )
    ).toMatchObject({
      identityKnown: true,
      resumeExisting: true,
      turnId: 'turn-codex',
      turnBinding: codex,
      task: 'ajoute un bouton'
    })
  })

  it('persiste le vrai tour Chat pour la reprise', () => {
    saveOrchestrationState(root, {
      ...state('run-turn', 1000, ['frame']),
      conversationId: 'conv-1',
      turnId: 'turn-chat-originel'
    })

    expect(loadOrchestrationStates(root)[0]).toMatchObject({
      conversationId: 'conv-1',
      turnId: 'turn-chat-originel'
    })
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    expect(indexSource).toContain('const resumeTurnId = liveReattachment.turnId')
    expect(indexSource).toContain('resumeExisting: liveReattachment.resumeExisting')
    expect(indexSource).toContain('durableResumeTurn.begin(')
  })

  it('n’écrit pas de fichier temporaire résiduel (écriture atomique)', () => {
    saveOrchestrationState(root, state('run-a-1', 1000, ['frame']))
    saveOrchestrationState(root, state('run-a-1', 2000, ['frame', 'terrain']))
    expect(readdirSync(root)).toEqual(['run-a-1.json'])
    expect(loadOrchestrationStates(root)[0].phaseOutputs).toHaveLength(2)
  })

  it('remplace le JSON sans fenêtre destructive avant le rename atomique', () => {
    const source = readFileSync(new URL('./orchestration-state.ts', import.meta.url), 'utf8')
    const saveBlock = source.slice(
      source.indexOf('export function saveOrchestrationState'),
      source.indexOf('export function clearOrchestrationState')
    )

    expect(saveBlock).toContain('renameSync(temporary, target)')
    expect(saveBlock).not.toContain('rmSync(target')
  })

  it("persiste avec l'agent le snapshot actif deja reserve", () => {
    saveOrchestrationState(root, state('run-active', 1000, []))
    const usage = {
      quoteId: 'quote-active',
      startedAgents: 1,
      startedCalls: 1,
      completedCalls: 0,
      failedCalls: 0,
      activeCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      freshTokens: 0,
      knownCostUsd: null,
      unpricedCalls: 0,
      unmeteredCalls: 0,
      tokenCoverage: 'complete' as const
    }

    saveOrchestrationAgentCheckpoint(
      root,
      'run-active',
      [{ token: 'agent-1', pid: 4242 }],
      usage,
      2000
    )

    expect(loadOrchestrationStates(root)[0]).toMatchObject({
      agents: [{ token: 'agent-1', pid: 4242 }],
      usage: { startedAgents: 1, startedCalls: 1, activeCalls: 1 },
      updatedAt: 2000
    })
  })

  it('refuse une sauvegarde agent si le checkpoint courant a disparu', () => {
    expect(() =>
      saveOrchestrationAgentCheckpoint(
        root,
        'run-absent',
        [{ token: 'agent-non-lance' }],
        undefined,
        2000
      )
    ).toThrow('checkpoint orchestration absent')
  })

  it('branche le callback de spawn sur le snapshot actif du superviseur', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/os.ts'), 'utf8')
    const start = source.indexOf('onAgentsChanged:')
    const end = source.indexOf('onRunSettled:', start)
    const callback = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(callback).toContain('saveOrchestrationAgentCheckpoint(')
    expect(callback).toContain('this.executionSupervisor.currentSnapshot()')
  })

  it('reprend le run le PLUS RÉCENT qui a déjà produit une phase', () => {
    saveOrchestrationState(root, state('run-a-1', 1000, ['frame']))
    saveOrchestrationState(root, state('run-a-2', 5000, ['frame', 'terrain']))
    saveOrchestrationState(root, state('run-a-3', 9000, [])) // aucun acquis → non reprenable
    expect(pickOrchestrationToResume(loadOrchestrationStates(root))?.runId).toBe('run-a-2')
  })

  it('reprend TOUS les runs éligibles en priorisant le travail déjà produit', () => {
    const paidOlder = { ...state('run-paid-old', 1000, ['frame']), task: 'tache payee A' }
    const paidNewer = { ...state('run-paid-new', 3000, ['frame']), task: 'tache payee B' }
    const neverStarted = { ...state('run-zero', 9000, []), task: 'tache neuve C' }
    const emptyOutput: OrchestrationRunState = {
      ...state('run-empty-output', 12000, []),
      phaseOutputs: [{ phase: 'frame' as never, text: '   ' }]
    }

    expect(
      pickOrchestrationsToResume([neverStarted, emptyOutput, paidOlder, paidNewer]).map(
        (candidate) => candidate.runId
      )
    ).toEqual(['run-paid-new', 'run-paid-old', 'run-zero'])
  })

  it('conserve un run interrompu pour diagnostic mais ne le reprend jamais', () => {
    const interrupted: OrchestrationRunState = {
      ...state('run-interrupted', 9000, ['frame']),
      conversationId: 'conv-interrupted',
      terminal: {
        status: 'interrupted',
        reason: 'provider disparu',
        decidedAt: 9000
      }
    }
    saveOrchestrationState(root, interrupted)
    const loaded = loadOrchestrationStates(root)

    expect(loaded).toHaveLength(1)
    expect(pickOrchestrationsToResume(loaded)).toEqual([])
    expect(
      pickResumeForTask(loaded, {
        task: 'ajoute un bouton',
        conversationId: 'conv-interrupted',
        nowMs: 9001
      })
    ).toBeNull()
  })

  it('elit un seul workflow pour deux checkpoints de la meme demande canonique', () => {
    const older: OrchestrationRunState = {
      ...state('run-duplicate-old', 1000, ['frame']),
      task: 'Corrig\u00e9 le bouton',
      conversationId: 'conv-duplicate'
    }
    const activeNewer: OrchestrationRunState = {
      ...state('run-duplicate-new', 2000, []),
      task: 'Corrige\u0301   le bouton',
      conversationId: 'conv-duplicate',
      usage: {
        quoteId: 'quote-duplicate',
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      }
    }

    const election = electStartupOrchestrationResumes([older, activeNewer])

    expect(election.elected.map((candidate) => candidate.runId)).toEqual(['run-duplicate-new'])
    expect(election.suppressed).toEqual([{ state: older, electedRunId: 'run-duplicate-new' }])
  })

  it('ne remet jamais un checkpoint doublon dans la file de relance', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const branchStart = indexSource.indexOf('const electedDuplicateRunId =')
    const branchEnd = indexSource.indexOf("\n    if (reprise === 'bloquer') {", branchStart)
    const duplicateBranch = indexSource.slice(branchStart, branchEnd)

    expect(branchStart).toBeGreaterThanOrEqual(0)
    expect(branchEnd).toBeGreaterThan(branchStart)
    expect(duplicateBranch).toContain('waitUntilRunCanResume(')
    expect(duplicateBranch).toContain('os.forgetResumableOrchestration(latest.runId)')
    expect(duplicateBranch).not.toContain('startupResumeQueue.enqueue(')
  })

  it('ne reelit pas le doublon apres un second crash quand le workflow elu a disparu', () => {
    const suppressed: OrchestrationRunState = {
      ...state('run-suppressed-two-boots', 1000, []),
      conversationId: 'conv-two-boots',
      usage: {
        quoteId: 'quote-two-boots',
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      }
    }
    saveOrchestrationState(root, suppressed)
    suppressOrchestrationPipeline(root, suppressed.runId, 'run-elected-gone', 2000)

    const [persisted] = loadOrchestrationStates(root)
    const secondBoot = electStartupOrchestrationResumes([persisted])

    expect(persisted.resumeDisposition).toEqual({
      kind: 'superseded-duplicate',
      electedRunId: 'run-elected-gone',
      decidedAt: 2000
    })
    expect(secondBoot.elected).toEqual([])
    expect(secondBoot.suppressed).toEqual([{ state: persisted, electedRunId: 'run-elected-gone' }])
  })

  it('persiste les suppressions de pipeline avant de parcourir la file de demarrage', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const electionAt = indexSource.indexOf('const resumeElection =')
    const persistenceAt = indexSource.indexOf(
      'os.suppressDuplicateOrchestrationPipeline(',
      electionAt
    )
    const loopAt = indexSource.indexOf('for (const resumableRun of resumableRuns)', electionAt)

    expect(electionAt).toBeGreaterThanOrEqual(0)
    expect(persistenceAt).toBeGreaterThan(electionAt)
    expect(persistenceAt).toBeLessThan(loopAt)
  })

  it('reserve aussi en dev la racine userData avant toute reprise automatique', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const lockAt = indexSource.indexOf('const ownsInstanceLock =')
    const rejectionAt = indexSource.indexOf('if (!ownsInstanceLock)', lockAt)
    const hardStopAt = indexSource.indexOf('process.exit(0)', rejectionAt)
    const osConstructionAt = indexSource.indexOf('const os = new AutowinOS()', lockAt)
    const appDataAt = indexSource.indexOf('const appDataRoot =', 0)
    const createIdentityAt = indexSource.indexOf('createAutowinAppDataRoot(appDataRoot)', appDataAt)
    const setIdentityAt = indexSource.indexOf(
      "app.setPath('userData', canonicalAppDataRoot)",
      appDataAt
    )
    const configureBaseAt = indexSource.indexOf('configureAutowinAppDataBase(', appDataAt)
    const configureMemoryAt = indexSource.indexOf('configureSessionMemoryEcho(', appDataAt)
    const configureRememberAt = indexSource.indexOf('configureRememberDepositStore(', appDataAt)
    const ensureDataAt = indexSource.indexOf('ensureAutowinAppData(', appDataAt)
    const recoveryAt = indexSource.indexOf('const resumableRuns = os.resumableOrchestrations()')
    const lockBranch = indexSource.slice(lockAt, recoveryAt)

    expect(lockAt).toBeGreaterThanOrEqual(0)
    expect(createIdentityAt).toBeGreaterThan(appDataAt)
    expect(createIdentityAt).toBeLessThan(setIdentityAt)
    expect(setIdentityAt).toBeLessThan(lockAt)
    expect(rejectionAt).toBeGreaterThan(lockAt)
    expect(hardStopAt).toBeGreaterThan(rejectionAt)
    expect(hardStopAt).toBeLessThan(osConstructionAt)
    expect(configureBaseAt).toBeGreaterThan(hardStopAt)
    expect(configureMemoryAt).toBeGreaterThan(hardStopAt)
    expect(configureRememberAt).toBeGreaterThan(hardStopAt)
    expect(ensureDataAt).toBeGreaterThan(hardStopAt)
    expect(lockAt).toBeLessThan(recoveryAt)
    expect(lockBranch).toContain('app.requestSingleInstanceLock(')
    expect(lockBranch).not.toContain("if (!explicitUserDataDir) app.setPath('userData'")
    expect(lockBranch).not.toMatch(/!app\.isPackaged\s*\|\|/)
  })

  it('observe un doublon supprime sans ouvrir de tour ni publier une fausse cloture verte', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const loopAt = indexSource.indexOf('for (const resumableRun of resumableRuns)')
    const duplicateAt = indexSource.indexOf('if (electedDuplicateRunId) {', loopAt)
    const liveTurnAt = indexSource.indexOf(
      "if ((reprise === 'rattacher' || reprise === 'bloquer')",
      loopAt
    )
    const duplicateBranch = indexSource.slice(duplicateAt, liveTurnAt)

    expect(duplicateAt).toBeGreaterThan(loopAt)
    expect(duplicateAt).toBeLessThan(liveTurnAt)
    expect(duplicateBranch).toContain('waitUntilRunCanResume(')
    expect(duplicateBranch).not.toContain('admitLiveReattachment(')
    expect(duplicateBranch).not.toContain('createOrchestrateTurnPersistence(')
    expect(duplicateBranch).not.toContain("status: 'green'")
    expect(duplicateBranch).not.toContain('durableLiveReattachment')
  })

  it('ignore un état tronqué par un crash sans perdre les autres', () => {
    saveOrchestrationState(root, state('run-a-1', 1000, ['frame']))
    writeFileSync(join(root, 'run-corrompu.json'), '{"runId":"run-corrompu","task":', 'utf8')
    expect(loadOrchestrationStates(root).map((s) => s.runId)).toEqual(['run-a-1'])
  })

  it.each([
    ['sortie nulle', [null]],
    ['phase inconnue', [{ phase: 'unknown', text: 'livrable' }]],
    ['texte non chaîne', [{ phase: 'frame', text: 42 }]]
  ])('ignore un JSON valide mais structurellement hostile : %s', (_label, phaseOutputs) => {
    writeFileSync(
      join(root, 'run-structurellement-hostile.json'),
      JSON.stringify({
        runId: 'run-structurellement-hostile',
        task: 'reprendre sans planter',
        phaseOutputs,
        startedAt: 1,
        updatedAt: 2
      }),
      'utf8'
    )

    const loaded = loadOrchestrationStates(root)
    expect(loaded).toEqual([])
    expect(() => pickOrchestrationsToResume(loaded)).not.toThrow()
  })

  it('refuse un runId qui sortirait du dossier (traversée de chemin)', () => {
    expect(() => saveOrchestrationState(root, state('../evasion', 1000, ['frame']))).toThrow(
      /runId invalide/
    )
  })

  it('rien à reprendre → null (démarrage normal inchangé)', () => {
    expect(pickOrchestrationToResume([])).toBeNull()
    expect(pickOrchestrationToResume(loadOrchestrationStates(join(root, 'absent')))).toBeNull()
  })
})

describe('garde-fou acquis vide (constaté en réel)', () => {
  it('ne propose PAS de reprendre un run dont les phases n’ont aucun livrable', () => {
    // Cas observé : un run interrompu avait persisté `frame` avec 0 caractère. Le reprendre
    // ferait SAUTER frame sans avoir son travail → pire que de tout rejouer.
    const empty: OrchestrationRunState = {
      runId: 'run-vide-1',
      task: 'ajoute un bouton',
      phaseOutputs: [{ phase: 'frame' as never, text: '   ' }],
      startedAt: 1,
      updatedAt: 2
    }
    expect(pickOrchestrationToResume([empty])).toBeNull()
  })

  it('un run mort AVANT sa première phase reste reprenable (sinon la tâche est perdue)', () => {
    // Cas constaté : le run est tué pendant la phase 1 — la plus longue. Rien n'était persisté, donc
    // la reprise automatique n'avait aucune prise et il fallait retaper la demande. Aucune phase
    // enregistrée = rien à sauter : on relance simplement depuis le début.
    const neuf: OrchestrationRunState = {
      runId: 'run-tue-tot',
      task: 'trouve le composant concerné',
      phaseOutputs: [],
      startedAt: 1,
      updatedAt: 2
    }
    expect(pickOrchestrationToResume([neuf])?.runId).toBe('run-tue-tot')
  })

  it('reprend dès qu’au moins une phase porte un livrable réel', () => {
    const mixed: OrchestrationRunState = {
      runId: 'run-mixte-1',
      task: 'ajoute un bouton',
      phaseOutputs: [
        { phase: 'frame' as never, text: 'besoin cadré' },
        { phase: 'terrain' as never, text: '' }
      ],
      startedAt: 1,
      updatedAt: 2
    }
    expect(pickOrchestrationToResume([mixed])?.runId).toBe('run-mixte-1')
  })
})

describe('identité du modèle lors d’une reprise de conversation', () => {
  it('un pipeline supprime ne redevient pas un acquis, mais son appel actif reste un verrou', () => {
    const suppressed: OrchestrationRunState = {
      ...state('run-suppressed-manual', 1000, ['frame']),
      conversationId: 'conv-suppressed-manual',
      resumeDisposition: {
        kind: 'superseded-duplicate',
        electedRunId: 'run-elected-manual',
        decidedAt: 900
      }
    }
    const lookup = {
      task: suppressed.task,
      conversationId: suppressed.conversationId,
      nowMs: 1100
    }

    expect(pickResumeForTask([suppressed], lookup)).toBeNull()
    expect(
      pickResumeForTask(
        [
          {
            ...suppressed,
            usage: {
              quoteId: 'quote-suppressed-manual',
              startedAgents: 1,
              startedCalls: 1,
              completedCalls: 0,
              failedCalls: 0,
              activeCalls: 1,
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              totalTokens: 0,
              freshTokens: 0,
              knownCostUsd: null,
              unpricedCalls: 0,
              unmeteredCalls: 0,
              tokenCoverage: 'complete'
            }
          }
        ],
        lookup
      )?.runId
    ).toBe('run-suppressed-manual')
  })

  it('un libelle Unicode decompose retrouve le verrou actif canonique', () => {
    const active: OrchestrationRunState = {
      ...state('run-active-unicode', 1000, []),
      task: 'Corrig\u00e9 le bouton',
      conversationId: 'conv-unicode',
      usage: {
        quoteId: 'quote-active-unicode',
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      }
    }

    expect(
      pickResumeForTask([active], {
        task: 'Corrige\u0301 le bouton',
        conversationId: 'conv-unicode',
        nowMs: 2000
      })?.runId
    ).toBe('run-active-unicode')
  })

  it('retourne aussi un checkpoint actif sans livrable pour verrouiller la relance identique', () => {
    const active: OrchestrationRunState = {
      ...state('run-active-empty', 1000, []),
      conversationId: 'conv-1',
      bindingOverride: { provider: 'claude', model: 'claude-fable-5' },
      usage: {
        quoteId: 'quote-active-empty',
        startedAgents: 1,
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      }
    }

    expect(
      pickResumeForTask([active], {
        task: active.task,
        conversationId: 'conv-1',
        // Un verrou actif ne devient pas réessayable parce que le modèle a changé ou que le
        // checkpoint a vieilli : ce sont des critères de réutilisation de livrable, pas de sécurité.
        nowMs: 50 * 24 * 60 * 60_000,
        bindingOverride: { provider: 'codex', model: 'gpt-5.6-sol' }
      })?.runId
    ).toBe('run-active-empty')
  })

  it('priorise le verrou actif sur un livrable plus récent de la même tâche', () => {
    const active: OrchestrationRunState = {
      ...state('run-active-older', 1000, []),
      conversationId: 'conv-1',
      usage: {
        quoteId: 'quote-active-older',
        startedCalls: 1,
        completedCalls: 0,
        failedCalls: 0,
        activeCalls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        freshTokens: 0,
        knownCostUsd: null,
        unpricedCalls: 0,
        unmeteredCalls: 0,
        tokenCoverage: 'complete'
      }
    }
    const completed: OrchestrationRunState = {
      ...state('run-completed-newer', 2000, ['frame']),
      conversationId: 'conv-1'
    }

    expect(
      pickResumeForTask([active, completed], {
        task: active.task,
        conversationId: 'conv-1',
        nowMs: 2500
      })?.runId
    ).toBe('run-active-older')
  })

  it('ne réutilise pas un acquis produit par un autre modèle', () => {
    const saved: OrchestrationRunState = {
      ...state('run-claude', 1000, ['frame']),
      conversationId: 'conv-1',
      bindingOverride: { provider: 'claude', model: 'claude-sonnet' }
    }

    expect(
      pickResumeForTask([saved], {
        task: saved.task,
        conversationId: 'conv-1',
        nowMs: 1500,
        bindingOverride: { provider: 'codex', model: 'gpt-5.6-sol' }
      })
    ).toBeNull()
  })

  it('ne reutilise pas un acquis sans override si la topologie du run a change', () => {
    const binding = (provider: string, model: string) => ({ provider, model })
    const snapshot = (provider: string, model: string) => {
      const selected = binding(provider, model)
      return {
        roles: {
          orchestrator: selected,
          subagent: selected,
          judge: selected,
          scout: selected
        },
        phaseFanOut: { scout: [], frame: [], terrain: [] },
        judgeFanOut: []
      }
    }
    const saved: OrchestrationRunState = {
      ...state('run-claude-topology', 1000, ['frame']),
      conversationId: 'conv-1',
      runtimeSnapshot: snapshot('claude', 'claude-fable-5')
    }

    expect(
      pickResumeForTask([saved], {
        task: saved.task,
        conversationId: 'conv-1',
        nowMs: 1500,
        runtimeSnapshot: snapshot('codex', 'gpt-5.6-sol')
      })
    ).toBeNull()
  })
})

describe('admission de la reprise automatique au démarrage', () => {
  it('restaure la topologie persistee et isole la migration des anciens tours', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const relaunchStart = indexSource.indexOf('const relaunchResumableRun =')
    const relaunchEnd = indexSource.indexOf("if (reprise === 'bloquer')", relaunchStart)
    const relaunchSource = indexSource.slice(relaunchStart, relaunchEnd)
    const osSource = readFileSync(join(process.cwd(), 'src/main/os.ts'), 'utf8')

    expect(relaunchSource).toContain('admitAutomaticResumeRuntime(')
    expect(relaunchSource).toContain('runtime: {')
    expect(relaunchSource).toMatch(/resumedRuntime\s*\.run\(\(runtimeSnapshot\) =>/)
    const runTaskSource = relaunchSource.slice(relaunchSource.indexOf('.runTask('))
    expect(runTaskSource).toContain('runtimeSnapshot')
    expect(runTaskSource).not.toContain('os.captureOrchestrationRuntime()')
    expect(osSource).toMatch(
      /onPhaseCompleted:[\s\S]*runtimeSnapshot,[\s\S]*saveOrchestrationState/
    )
  })

  it('fait aussi passer le rattachement vivant par une admission d’identité', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const attachStart = indexSource.indexOf(
      "if ((reprise === 'rattacher' || reprise === 'bloquer')"
    )
    const attachEnd = indexSource.indexOf('const relaunchResumableRun =', attachStart)
    const attachSource = indexSource.slice(attachStart, attachEnd)

    expect(attachSource).toContain('admitLiveReattachment(')
    expect(attachSource).toContain('resumeExisting: liveReattachment.resumeExisting')
    expect(attachSource).toContain('runtime: liveReattachment.turnBinding')
    expect(attachSource).toContain('liveReattachment.task')
  })

  it('clôture le tour de rattachement inconnu avant d’ouvrir le tour de relance', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const attachStart = indexSource.indexOf(
      "if ((reprise === 'rattacher' || reprise === 'bloquer')"
    )
    const continuationEnd = indexSource.indexOf("if (reprise === 'relancer') {", attachStart)
    const continuationSource = indexSource.slice(attachStart, continuationEnd)

    expect(continuationSource).toContain(
      'durableLiveReattachment = createOrchestrateTurnPersistence('
    )
    const newTurnBranchAt = continuationSource.indexOf('if (!liveReattachment?.resumeExisting)')
    const closeAt = continuationSource.indexOf('durableLiveReattachment?.succeed(', newTurnBranchAt)
    const relaunchAt = continuationSource.indexOf(
      'await startupResumeQueue.enqueue(() => relaunchResumableRun(latest))',
      newTurnBranchAt
    )
    expect(closeAt).toBeGreaterThan(newTurnBranchAt)
    expect(closeAt).toBeLessThan(relaunchAt)
  })

  it('ne supprime le checkpoint historique qu’après le premier lifecycle admis', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const relaunchStart = indexSource.indexOf('const relaunchResumableRun =')
    const relaunchEnd = indexSource.indexOf("if (reprise === 'bloquer')", relaunchStart)
    const relaunchSource = indexSource.slice(relaunchStart, relaunchEnd)
    const runTaskAt = relaunchSource.indexOf('.runTask(')
    const lifecycleAt = relaunchSource.indexOf('(lifecycle) =>')
    const forgetAt = relaunchSource.indexOf('os.forgetResumableOrchestration')

    expect(relaunchStart).toBeGreaterThanOrEqual(0)
    expect(relaunchEnd).toBeGreaterThan(relaunchStart)
    expect(runTaskAt).toBeGreaterThanOrEqual(0)
    expect(lifecycleAt).toBeGreaterThan(runTaskAt)
    expect(forgetAt).toBeGreaterThan(lifecycleAt)
    expect(relaunchSource).toContain('resumedCurrentRunId !== resumableRun.runId')
  })

  it('repersiste un règlement tardif sur la reprise automatique', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const relaunchStart = indexSource.indexOf('const relaunchResumableRun =')
    const relaunchEnd = indexSource.indexOf("if (reprise === 'bloquer')", relaunchStart)
    const relaunchSource = indexSource.slice(relaunchStart, relaunchEnd)

    expect(relaunchSource).toContain('reconcileLateRunLifecycle(')
    expect(relaunchSource).toContain(
      "broadcast({ type: 'orchestrate-usage', convId: conversationId })"
    )
  })
})

/**
 * RATTACHEMENT. Un CLI détaché survit à la mort de l'app et continue d'écrire dans son journal.
 * Sans ces références persistées, l'app qui revient ne sait ni s'il vit encore, ni où lire ce qu'il
 * a produit pendant son absence — elle relance donc un travail déjà fait, ou attend un clic.
 */
describe('références d’agents — ce qui rend un run rattachable', () => {
  it('persiste provider, phase, état, jeton, pid, journal et offset à l’identique', () => {
    saveOrchestrationState(root, {
      runId: 'run-attach',
      task: 'longue tâche',
      phaseOutputs: [],
      agents: [
        {
          token: 'tok-1',
          provider: 'codex',
          phase: 'build',
          active: true,
          fanOut: false,
          reservationId: 'reservation-tok-1',
          pid: 4242,
          journalPath: 'C:/j/tok-1.stdout.jsonl',
          offset: 128
        }
      ],
      startedAt: 1,
      updatedAt: 2
    })

    const [relu] = loadOrchestrationStates(root)
    expect(relu.agents).toEqual([
      {
        token: 'tok-1',
        provider: 'codex',
        phase: 'build',
        active: true,
        fanOut: false,
        reservationId: 'reservation-tok-1',
        pid: 4242,
        journalPath: 'C:/j/tok-1.stdout.jsonl',
        offset: 128
      }
    ])
  })

  it('un run sans agent reste valide — tout run n’en lance pas', () => {
    saveOrchestrationState(root, {
      runId: 'run-sans-agent',
      task: 'tâche',
      phaseOutputs: [],
      startedAt: 1,
      updatedAt: 2
    })
    expect(loadOrchestrationStates(root)[0].agents).toBeUndefined()
  })
})
