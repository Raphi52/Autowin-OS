import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  agentVerdict,
  preparePersistedRunForRelaunch,
  resumeActionFor,
  runLiveness,
  waitUntilRunCanResume
} from './run-reattach'
import { loadOrchestrationStates, saveOrchestrationState } from './orchestration-state'
import { compileExecutionQuote } from '../execution-quote'
import { ExecutionSupervisor } from '../execution-supervisor'

/**
 * Le risque le plus grave de la survie des runs : au redémarrage, l'app relançait le travail SANS
 * vérifier qu'un agent tournait encore. Deux agents sur la même copie s'écrasent l'un l'autre.
 */
describe('un agent est-il encore au travail ?', () => {
  const vivant = () => 'demarre-a-100|C:/cli.exe'

  it('processus disparu → terminé', () => {
    expect(agentVerdict({ token: 't', pid: 42, identity: vivant() }, () => undefined).state).toBe(
      'termine'
    )
  })

  it('même pid, même empreinte → vivant', () => {
    expect(agentVerdict({ token: 't', pid: 42, identity: vivant() }, vivant).state).toBe('vivant')
  })

  it('même pid, empreinte DIFFÉRENTE → pid recyclé, pas notre agent', () => {
    // Sans ce contrôle, un processus étranger ayant hérité du numéro ferait croire que l'agent
    // travaille encore — et le run ne reprendrait jamais.
    const verdict = agentVerdict({ token: 't', pid: 42, identity: vivant() }, () => 'autre|X.exe')
    expect(verdict.state).toBe('pid-recycle')
  })

  it('sans pid connu → inconnu, on n’affirme rien', () => {
    expect(agentVerdict({ token: 't' }, vivant).state).toBe('inconnu')
  })

  it('sonde en échec → inconnu plutôt qu’un verdict inventé', () => {
    const verdict = agentVerdict({ token: 't', pid: 42 }, () => {
      throw new Error('sonde indisponible')
    })
    expect(verdict.state).toBe('inconnu')
  })

  it('pid vivant SANS empreinte capturée → on penche vers vivant', () => {
    // Relancer par-dessus un agent réel coûte plus cher qu'attendre : le doute profite à la prudence.
    expect(agentVerdict({ token: 't', pid: 42 }, vivant).state).toBe('vivant')
  })
})

describe('que faire du run au démarrage', () => {
  const mort = (): undefined => undefined
  const vivant = (): string => 'sig'

  it('un seul agent vivant suffit à INTERDIRE la relance', () => {
    const state = {
      agents: [
        { token: 'a', pid: 1, identity: 'sig' },
        { token: 'b', pid: 2, identity: 'autre' }
      ],
      phaseOutputs: []
    }
    const liveness = runLiveness(state, (pid) => (pid === 1 ? 'sig' : undefined))
    expect(liveness.working).toBe(true)
    expect(resumeActionFor(state, (pid) => (pid === 1 ? 'sig' : undefined))).toBe('rattacher')
  })

  it('tous les agents terminés → on relance, comportement historique', () => {
    const state = { agents: [{ token: 'a', pid: 1, identity: 'sig' }], phaseOutputs: [] }
    expect(resumeActionFor(state, mort)).toBe('relancer')
  })

  it('un run SANS agent connu se relance — rien ne prouve qu’il tourne', () => {
    expect(resumeActionFor({ agents: [], phaseOutputs: [] }, vivant)).toBe('relancer')
  })

  it('aucun run à reprendre → on ne fait rien', () => {
    expect(resumeActionFor(null, vivant)).toBe('ignorer')
  })
})

describe('réconciliation persistée avant relance', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('classe l’appel actif comme échoué seulement après preuve que son PID est mort', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-dead-'))
    roots.push(root)
    saveOrchestrationState(root, {
      runId: 'run-dead-provider',
      task: 'reprendre sans doubler',
      phaseOutputs: [{ phase: 'build', text: 'acquis' }],
      usage: {
        quoteId: 'quote-1',
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
      },
      agents: [{ token: 'agent-1', pid: 42, identity: 'ancienne-identité' }],
      startedAt: 1,
      updatedAt: 2
    })

    const reconciled = preparePersistedRunForRelaunch(root, 'run-dead-provider', () => undefined, 9)

    expect(reconciled?.usage).toMatchObject({
      activeCalls: 0,
      failedCalls: 1,
      unpricedCalls: 1,
      unmeteredCalls: 1,
      tokenCoverage: 'partial'
    })
    expect(loadOrchestrationStates(root)[0]).toEqual(reconciled)
    expect(reconciled?.updatedAt).toBe(9)
  })

  it('ne touche pas au compteur si la preuve de mort est incomplète', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-unknown-'))
    roots.push(root)
    saveOrchestrationState(root, {
      runId: 'run-unknown-provider',
      task: 'ne pas doubler',
      phaseOutputs: [],
      usage: {
        quoteId: 'quote-1',
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
      },
      agents: [{ token: 'agent-1' }],
      startedAt: 1,
      updatedAt: 2
    })

    const reconciled = preparePersistedRunForRelaunch(
      root,
      'run-unknown-provider',
      () => undefined,
      9
    )

    expect(reconciled?.usage?.activeCalls).toBe(1)
    expect(reconciled?.updatedAt).toBe(2)
  })

  it('rend réellement le snapshot admissible au supervisor après disparition du PID', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-supervisor-'))
    roots.push(root)
    const quote = compileExecutionQuote('reprendre le build interrompu')
    saveOrchestrationState(root, {
      runId: 'run-supervisor-retry',
      task: 'reprendre le build interrompu',
      phaseOutputs: [{ phase: 'build', text: 'acquis' }],
      executionQuote: quote,
      usage: {
        quoteId: quote.id,
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
      },
      agents: [{ token: 'agent-1', pid: 42, identity: 'ancienne-identité' }],
      startedAt: 1,
      updatedAt: 2
    })

    const reconciled = preparePersistedRunForRelaunch(root, 'run-supervisor-retry', () => undefined)
    expect(reconciled?.usage).toMatchObject({
      totalTokens: 500_000,
      freshTokens: 62_500,
      unpricedCalls: 1,
      unmeteredCalls: 1
    })
    let executeCalled = false

    await expect(
      new ExecutionSupervisor().run(
        quote,
        undefined,
        async () => {
          executeCalled = true
          return 'repris'
        },
        reconciled?.usage
      )
    ).resolves.toBe('repris')
    expect(executeCalled).toBe(true)
  })
})

/**
 * CÂBLAGE. La logique de vivacité ne sert à rien si le démarrage ne la consulte pas — c'était
 * précisément le défaut : la reprise relançait sans jamais poser la question.
 */
describe('câblage — le démarrage consulte la garde avant de relancer', () => {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')

  it('parcourt TOUS les runs reprenables plutôt qu’un seul', () => {
    expect(source).toContain('const resumableRuns = os.resumableOrchestrations()')
    expect(source).toContain('for (const resumableRun of resumableRuns)')
    expect(source).not.toContain('const resumableRun = os.resumableOrchestration()')
  })

  it('la reprise au démarrage passe par resumeActionFor', () => {
    expect(source).toContain(
      'const reprise = resumeActionFor(resumableRun, defaultProcessIdentity)'
    )
  })

  it('elle ne relance QUE si le verdict est « relancer »', () => {
    expect(source).toContain("if (reprise === 'relancer') void relaunchResumableRun(resumableRun)")
  })

  it('réconcilie et persiste les appels morts avant de passer le snapshot au superviseur', () => {
    expect(source).toContain('os.reconcileResumableOrchestrationForRelaunch(')
  })

  it('un agent encore au travail est SIGNALÉ, pas passé sous silence', () => {
    expect(source).toContain('un agent travaille ENCORE')
  })
})

/**
 * CÂBLAGE DU REJEU. Détecter l'agent vivant ne suffit pas : sans relecture de son journal, le
 * travail produit pendant l'absence reste invisible — donc réputé perdu, donc relancé à la main.
 */
describe('câblage — le démarrage rejoue le journal et mémorise où il s’est arrêté', () => {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
  const bloc = source.slice(source.indexOf("if (reprise === 'rattacher'"))

  it('il relit chaque journal DEPUIS l’offset déjà lu', () => {
    expect(bloc).toContain('tailJournalOnce(agent.journalPath, agent.offset ?? 0')
  })

  it('il remet le récapitulatif dans la conversation', () => {
    expect(bloc).toContain('os.conversations.append(conversationId')
  })

  it('il repersiste l’offset atteint — sinon le même texte serait remontré', () => {
    expect(bloc).toContain('os.rememberAgentOffsets(resumableRun.runId, agentsApres)')
  })

  it('un échec de rattachement ne casse pas le démarrage', () => {
    expect(bloc).toContain('rattachement impossible')
  })
})

describe('surveillance continue apres rattachement', () => {
  it("relance des la sortie de l'agent sans exiger un nouveau redemarrage", async () => {
    const actions = ['rattacher', 'rattacher', 'relancer'] as const
    let reads = 0
    let waits = 0

    const result = await waitUntilRunCanResume(
      () => actions[Math.min(reads++, actions.length - 1)],
      async () => {
        waits += 1
      }
    )

    expect(result).toBe('relancer')
    expect(reads).toBe(3)
    expect(waits).toBe(2)
  })
})

/**
 * LA CAUSE RACINE DU RUN ZOMBIE — l'empreinte n'était JAMAIS capturée.
 *
 * `agentVerdict` ne peut distinguer « notre agent vit encore » de « un inconnu a hérité du pid »
 * que si l'empreinte a été relevée AU LANCEMENT (`orchestrator.ts` : `this.deps.processIdentity`).
 * Or `os.ts` ne fournissait pas cette sonde : aucun agent persisté ne portait d'`identity`, donc
 * `agentVerdict` retombait sur son défaut prudent « vivant » — À VIE.
 *
 * Constaté sur l'état réel le 2026-08-07 : `run-state/run-135d936755f8-1.json` porte
 * `{"token":…,"journalPath":…,"pid":5396}` — sans `identity`. Conséquence dans conv-1056 : le
 * démarrage concluait « rattacher » à chaque fois, rouvrait le tour en `streaming` et empilait
 * quatre fois « l'agent … travaille encore ». Le run ne pouvait JAMAIS être déclaré terminé.
 */
describe('câblage — l’empreinte du processus est réellement capturée au lancement', () => {
  const source = readFileSync(join(__dirname, '..', 'os.ts'), 'utf8')

  it('os.ts fournit la sonde d’empreinte à l’orchestrateur', () => {
    expect(source).toContain('processIdentity: defaultProcessIdentity')
  })

  it('sans empreinte capturée, un pid vivant reste présumé vivant — le défaut à ne pas subir', () => {
    // Le comportement lui-même est correct et volontaire ; ce qui manquait, c'est la capture.
    expect(agentVerdict({ token: 'a', pid: 42 }, () => 'inconnu|autre.exe').state).toBe('vivant')
    // Avec l'empreinte, le pid recyclé est démasqué et le run peut enfin être déclaré terminé.
    expect(
      agentVerdict({ token: 'a', pid: 42, identity: 'nous' }, () => 'inconnu|autre.exe').state
    ).toBe('pid-recycle')
  })
})

/**
 * CÂBLAGE DE LA SORTIE D'ATTENTE. Clore le tour au chargement ne sert à rien si le démarrage ne
 * dit pas QUELS tours vont réellement reprendre : sans ce discriminant, un run repris serait
 * annoncé interrompu, ou — le défaut mesuré — aucun tour ne serait annoncé du tout.
 */
describe('câblage — le chargement des conversations connaît les runs reprenables', () => {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')

  it('persistConversations reçoit les tours des checkpoints encore sur disque', () => {
    expect(source).toContain('resumableTurnIds')
    expect(source).toMatch(/persistConversations\(\s*os\.conversations/)
  })
})
