import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { bindingDePhaseValide, instantaneAssaini, Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  ExecutionEvidence,
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { compileExecutionQuote } from './execution-quote'
import { TrustLedger } from './trust/ledger'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { forgetEcho, noteRemembered } from './session-memory-echo'
import { retrieveBrainContext } from './brain-retrieval'

class CapturingProvider implements ProviderAdapter {
  readonly id = 'capture'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  readonly messages: Message[][] = []

  constructor(private readonly emitsEvidence = true) {}

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    this.messages.push(messages)
    return {
      text: this.calls.length === 1 ? 'travail exécuté' : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence:
        this.calls.length === 1 && this.emitsEvidence
          ? [
              {
                type: 'file_change',
                kind: 'mutation',
                status: 'completed',
                ok: true,
                summary: 'fichier modifié'
              },
              {
                type: 'command_execution',
                kind: 'verification',
                status: 'completed',
                ok: true,
                summary: 'vitest exit=0'
              }
            ]
          : undefined
    }
  }
}

class FailingProvider implements ProviderAdapter {
  readonly id = 'failing'
  readonly supportsExecution = true

  async auth(): Promise<boolean> {
    return true
  }

  async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
    throw new Error('échec provider après récupération Brain')
  }
}

describe('Orchestrator execution contract', () => {
  it('ne contacte pas le Brain avec un override corpus malformé', async () => {
    vi.stubEnv('AUTOWIN_BRAIN_CORPUS', '*,')
    try {
      const provider = new CapturingProvider()
      const retrieveBrain = vi.fn(async () => ({ context: 'INTERDIT', status: 'found' as const }))
      const brainEvents: Array<{ status: string; injectedChars: number }> = []
      const orchestrator = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id },
          judge: { provider: provider.id }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: process.cwd(),
        retrieveBrain
      })

      await orchestrator.run(
        'analyse sans mutation',
        undefined,
        undefined,
        undefined,
        undefined,
        '',
        [],
        undefined,
        undefined,
        (event) => brainEvents.push(event)
      )

      expect(retrieveBrain).not.toHaveBeenCalled()
      expect(brainEvents).toEqual([expect.objectContaining({ status: 'empty', injectedChars: 0 })])
      expect(
        provider.messages
          .flat()
          .map((message) => message.content)
          .join('\n')
      ).not.toContain('INTERDIT')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('transporte la memoire provisoire de la conversation jusqu au sous-agent', async () => {
    forgetEcho()
    noteRemembered('conv-memory', {
      title: 'Decision runtime',
      body: 'le code Python vient uniquement de installation locale',
      scope: 'autowin-os',
      workspace: process.cwd()
    })
    const provider = new CapturingProvider()
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: process.cwd()
    })

    await orchestrator.run(
      'analyse le projet sans le modifier',
      undefined,
      undefined,
      undefined,
      undefined,
      '',
      [],
      'conv-memory'
    )

    expect(provider.messages[0].map((message) => message.content).join('\n')).toContain(
      'le code Python vient uniquement de installation locale'
    )
  })

  it('injecte la memoire causale observee du meme fil dans un run ulterieur', async () => {
    const provider = new CapturingProvider()
    const causalMemoryFor = vi.fn(
      () => 'MEMOIRE CAUSALE OBSERVEE\n- build · claude/fable · issue failed'
    )
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: process.cwd(),
      causalMemoryFor
    })

    await orchestrator.run(
      'analyse la decision precedente en lecture seule',
      undefined,
      undefined,
      undefined,
      undefined,
      '',
      [],
      'conv-causal-memory'
    )

    expect(causalMemoryFor).toHaveBeenCalledWith('conv-causal-memory')
    expect(provider.messages[0].map((message) => message.content).join('\n')).toContain(
      'MEMOIRE CAUSALE OBSERVEE'
    )
  })

  it('n injecte pas au sous-agent la memoire du meme fil creee dans un autre workspace', async () => {
    forgetEcho()
    noteRemembered('conv-cross-workspace', {
      title: 'RIG prive',
      body: 'utiliser gacRig avant build',
      scope: 'RIG',
      workspace: 'D:\\DevSrc\\RigApplication'
    })
    noteRemembered('conv-cross-workspace', {
      title: 'Global explicite',
      body: 'conserver les preuves',
      scope: 'global',
      workspace: 'global'
    })
    const provider = new CapturingProvider()
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: process.cwd()
    })

    await orchestrator.run(
      'analyse Autowin sans le modifier',
      undefined,
      undefined,
      undefined,
      undefined,
      '',
      [],
      'conv-cross-workspace'
    )

    const prompt = provider.messages[0].map((message) => message.content).join('\n')
    expect(prompt).not.toContain('utiliser gacRig avant build')
    expect(prompt).toContain('conserver les preuves')
  })

  it('n impose plus aucun corpus derive du workspace (isolation RIG retiree)', async () => {
    const provider = new CapturingProvider()
    const seenCorpus: Array<readonly string[] | undefined> = []
    const preamble = '[AMITEL BRAIN REFERENCE DATA]\n\n'
    const sources = [
      {
        path: 'knowledge/domain/rigapplication-documentation/reference/proc.md',
        content:
          '### Source 1 — knowledge/domain/rigapplication-documentation/reference/proc.md\nRIG_SOURCE_AUTORISEE'
      },
      {
        path: 'knowledge/domain/autowin-os-realite-produit-v5.md',
        content:
          '### Source 2 — knowledge/domain/autowin-os-realite-produit-v5.md\nAUTOWIN_SOURCE_INTERDITE'
      }
    ]
    const mixedContext = preamble + sources.map(({ content }) => content).join('\n\n---\n\n')
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'D:\\DevSrc\\RigApplication',
      retrieveBrain: async (_query, options) => {
        seenCorpus.push(options?.corpus)
        return {
          context: mixedContext,
          status: 'found',
          corpus: options?.corpus,
          structuredContext: { preamble, sources }
        }
      }
    })

    await orchestrator.run('analyse RigApplication en lecture seule sans le modifier')

    const prompt = provider.messages[0].map((message) => message.content).join('\n')
    // JUMEAU de `commands.test.ts` (« brain_query … source Autowin adverse ») : même contrat, deux
    // chemins, et ils doivent bouger ENSEMBLE — les avoir mis à jour séparément est ce qui a laissé
    // une contradiction vivante. État final arbitré après audit : plus AUCUN filtrage dérivé du
    // workspace, donc les DEUX sources atteignent le prompt. Conséquence assumée, pas oubliée.
    expect(seenCorpus[0]).toBeUndefined()
    expect(prompt).toContain('RIG_SOURCE_AUTORISEE')
    expect(prompt).toContain('AUTOWIN_SOURCE_INTERDITE')
  })

  it('n injecte aucun caractère quand un contexte signé dépasse le budget', async () => {
    const token = 'orchestrator-brain-budget-token'.repeat(2)
    const context = `oversized-marker-${'x'.repeat(3_001)}`
    const authenticated = JSON.stringify({ context, navigation: null })
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            service: 'amitel-brain',
            protocol: 2,
            authenticated,
            signature: createHmac('sha256', token)
              .update(`amitel-brain\n2\n${authenticated}`, 'utf8')
              .digest('hex')
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch
    const provider = new CapturingProvider()
    const brainEvents: Array<{ status: string; injectedChars: number }> = []
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: process.cwd(),
      retrieveBrain: (query, options) =>
        retrieveBrainContext(query, {
          ...options,
          env: { AMITEL_BRAIN_TOKEN: token } as NodeJS.ProcessEnv,
          fetchFn
        })
    })

    await orchestrator.run(
      'analyse le budget Brain en lecture seule sans le modifier',
      undefined,
      undefined,
      undefined,
      undefined,
      '',
      [],
      'conv-brain-budget',
      undefined,
      (event) => brainEvents.push(event)
    )

    const prompt = provider.messages[0].map((message) => message.content).join('\n')
    expect(prompt).not.toContain('oversized-marker')
    expect(brainEvents).toHaveLength(1)
    expect(brainEvents[0]).toMatchObject({ status: 'invalid', injectedChars: 0 })
  })

  it('notifie la récupération Brain avant une erreur ultérieure du provider', async () => {
    const provider = new FailingProvider()
    const brainEvents: Array<{ query: string; injectedChars: number }> = []
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: process.cwd()
    })

    await expect(
      orchestrator.run(
        'analyse le projet sans le modifier',
        undefined,
        undefined,
        undefined,
        undefined,
        '',
        [],
        'conv-brain-failure',
        undefined,
        (event) => brainEvents.push(event)
      )
    ).rejects.toThrow('échec provider après récupération Brain')

    expect(brainEvents).toHaveLength(1)
    expect(brainEvents[0].injectedChars).toBeGreaterThanOrEqual(0)
  })

  it('injecte le vrai skill de chaque phase et nomme les blocs observables', async () => {
    const provider = new CapturingProvider()
    const foundations: Array<{ phase: string; withFoundation: boolean }> = []
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace'),
      execPhases: ['frame', 'build'],
      skillInstruction: (phase, options) => {
        foundations.push({ phase, withFoundation: options.withFoundation })
        return `INSTRUCTION_RÉELLE_${phase.toUpperCase()}`
      }
    })

    await orchestrator.run('modifie le bouton')

    expect(provider.calls[0].system).toContain('INSTRUCTION_RÉELLE_FRAME')
    expect(provider.calls[1].system).toContain('INSTRUCTION_RÉELLE_BUILD')
    expect(provider.calls[2].system).toContain('INSTRUCTION_RÉELLE_JUDGE')
    expect(provider.calls[0].systemBlocks?.some((block) => block.name === 'skill:frame')).toBe(true)
    expect(provider.calls[1].systemBlocks?.some((block) => block.name === 'skill:build')).toBe(true)
    expect(provider.calls[2].systemBlocks?.some((block) => block.name === 'skill:judge')).toBe(true)
    expect(foundations).toEqual([
      { phase: 'frame', withFoundation: true },
      { phase: 'build', withFoundation: true },
      { phase: 'judge', withFoundation: true }
    ])
  })

  it('utilise par defaut le contrat natif in-app, sans protocole RUN du kit externe', async () => {
    const provider = new CapturingProvider()
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace'),
      execPhases: ['terrain']
    })

    await orchestrator.run('prepare le terrain de verification')

    expect(provider.calls[0].systemBlocks?.map((block) => block.name)).toContain(
      'consigne:terrain'
    )
    expect(provider.calls[0].systemBlocks?.map((block) => block.name)).not.toContain(
      'skill:terrain'
    )
    expect(provider.calls[0].system).toContain('Livrable : ## SOP')
    expect(provider.calls[0].system).not.toMatch(/\.claude[\\/]runs/)
    expect(provider.calls[0].system).toContain(
      'Autowin OS crée et tient le RUN de la conversation'
    )
  })

  it('retombe sur la consigne embarquée lorsque le kit est absent', async () => {
    const provider = new CapturingProvider()
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace'),
      skillInstruction: () => ''
    })

    await orchestrator.run('analyse le bouton sans le modifier')

    expect(provider.calls[0].systemBlocks?.some((block) => block.name === 'consigne:build')).toBe(
      true
    )
    expect(provider.calls[1].systemBlocks?.some((block) => block.name === 'consigne:judge')).toBe(
      true
    )
  })

  it('donne l’écriture au sous-agent et une lecture outillée distincte au juge', async () => {
    const provider = new CapturingProvider()
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    })
    const orchestrator = new Orchestrator({
      registry,
      roles,
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace')
    })

    const result = await orchestrator.run('modifie le projet')

    expect(result.valid).toBe(true)
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[0].execution).toMatchObject({
      cwd: 'C:\\workspace',
      sandbox: 'danger-full-access'
    })
    expect(provider.calls[1].execution).toMatchObject({
      cwd: 'C:\\workspace',
      sandbox: 'read-only'
    })
    expect(provider.calls[0].system).toContain(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION)
    expect(provider.calls[1].system).toContain(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION)
  })

  it('garde le gate rouge si le worker prétend réussir sans preuve d’outil', async () => {
    const provider = new CapturingProvider(false)
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    })
    const orchestrator = new Orchestrator({
      registry,
      roles,
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace')
    })

    // Tâche de MUTATION revendiquée sans aucune preuve d'outil → le gate déterministe bloque
    // (B1 : le gate de preuve reste STRICT sur les mutations ; c'est le juge qui garde les autres).
    const result = await orchestrator.run('ajoute une fonctionnalité au projet')

    expect(result.valid).toBe(false)
    expect(result.gateBlocked).toBe(true)
    expect(result).not.toHaveProperty('pendingDecisionId')
  })

  it('B1 — une tâche NON-mutation sans preuve d’outil passe si le juge valide', async () => {
    const provider = new CapturingProvider(false) // aucune preuve d'outil émise
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id },
        judge: { provider: provider.id }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace')
    })

    const result = await orchestrator.run('analyse et cadre les pistes, ne modifie pas de code')

    expect(result.valid).toBe(true)
    expect(result.gateBlocked).toBe(false)
  })

  it('garde le gate rouge avec une simple inspection ou une commande en échec', async () => {
    const evidenceCases: ExecutionEvidence[][] = [
      [
        {
          type: 'command_execution',
          kind: 'inspection',
          status: 'completed',
          ok: true,
          summary: 'rg'
        }
      ],
      [
        {
          type: 'command_execution',
          kind: 'verification',
          status: 'failed',
          ok: false,
          summary: 'vitest exit=1'
        }
      ]
    ]
    for (const executionEvidence of evidenceCases) {
      const provider = new CapturingProvider()
      provider.send = async function* (_messages, options = {}) {
        this.calls.push(options)
        return {
          text: this.calls.length === 1 ? 'travail exécuté' : 'VALIDE',
          provider: this.id,
          systemInjected: false,
          executionEvidence: this.calls.length === 1 ? executionEvidence : undefined
        }
      }
      const orchestrator = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id },
          judge: { provider: provider.id }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: 'C:\\workspace',
        worktrees: makeTestWorktrees('C:\\workspace')
      })
      const result = await orchestrator.run('ajoute un sélecteur')
      expect(result.valid).toBe(false)
      expect(result.gateBlocked).toBe(true)
    }
  })

  it('plie le fichier de contexte projet du workspace dans les system (exec + juge)', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const ws = mkdtempSync(join(tmpdir(), 'orch-ctx-'))
    writeFileSync(join(ws, 'CLAUDE.md'), 'RÈGLE PROJET: préfixer les commits par TICKET-123')
    try {
      const provider = new CapturingProvider()
      const orchestrator = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id },
          judge: { provider: provider.id }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        executionWorkspace: ws,
        worktrees: makeTestWorktrees(ws)
      })
      await orchestrator.run('analyse le projet, ne modifie rien')
      // exec (calls[0]) ET juge (calls[1]) reçoivent le bloc contexte, étiqueté par le fichier gagnant
      expect(provider.calls[0].system).toContain('=== CONTEXTE PROJET (CLAUDE.md) ===')
      expect(provider.calls[0].system).toContain('TICKET-123')
      expect(provider.calls[1].system).toContain('=== CONTEXTE PROJET (CLAUDE.md) ===')
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  it('clôture rouge une mutation sans preuve au lieu de relancer implicitement — en mode bloquant', async () => {
    // En mesure seule (défaut, décision du 12/08), la réparation B5 rejouerait le build avec les
    // raisons du gate — comportement voulu (« 1 prompt = 1 réussite »). Le refus de relance testé
    // ici est la posture du mode `blocking`.
    let execCount = 0
    let providerCalls = 0
    const provider: ProviderAdapter = {
      id: 'repair',
      supportsExecution: true,
      auth: async () => true,
      async *send(_m, options: SendOptions = {}) {
        providerCalls += 1
        const isExec = options.execution?.sandbox === 'danger-full-access'
        if (isExec) execCount += 1
        const secondExec = isExec && execCount >= 2
        return {
          text: isExec ? (secondExec ? 'réparé' : 'tentative') : 'VALIDE',
          provider: 'repair',
          systemInjected: false,
          executionEvidence: secondExec
            ? [
                {
                  type: 'file_change',
                  kind: 'mutation',
                  status: 'completed',
                  ok: true,
                  summary: 'fix'
                },
                {
                  type: 'command_execution',
                  kind: 'verification',
                  status: 'completed',
                  ok: true,
                  summary: 'vitest exit=0'
                }
              ]
            : undefined
        }
      }
    } as ProviderAdapter

    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: 'repair' },
        judge: { provider: 'repair' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace'),
      currentExecutionQuote: () =>
        compileExecutionQuote('corrige le bug du sélecteur', { spendEnforcement: 'blocking' })
    })

    const result = await orchestrator.run('corrige le bug du sélecteur')

    expect(result.valid).toBe(false)
    expect(result.gateBlocked).toBe(true)
    expect(execCount).toBe(1)
    // Le pré-gate local bloque la tentative sans preuve AVANT de payer un premier juge.
    expect(providerCalls).toBe(1)
  })

  it('F3 (strict) — une mutation exige une VÉRIFICATION, pas une simple inspection', async () => {
    const { evidenceSatisfiesTask } = await import('./orchestrator')
    const mut = {
      type: 'file_change',
      kind: 'mutation' as const,
      status: 'done',
      ok: true,
      summary: 'add'
    }
    const inspection = {
      type: 'command_execution',
      kind: 'inspection' as const,
      status: 'done',
      ok: true,
      summary: 'Get-Content: valeur attendue'
    }
    const verification = {
      type: 'command_execution',
      kind: 'verification' as const,
      status: 'done',
      ok: true,
      summary: 'vitest exit=0'
    }
    // mutation + relecture (inspection) seule → NE suffit plus (F3)
    expect(evidenceSatisfiesTask('crée puis relis le fichier', [mut, inspection])).toBe(false)
    // mutation + vrai test (verification) → validé
    expect(evidenceSatisfiesTask('crée le fichier', [mut, verification])).toBe(true)
  })
})

describe('instantané de rôles — opposable tant que sa cible existe', () => {
  // Vécu par l'utilisateur : instantané sur `codex`, configuration reconfigurée en `claude`, et le
  // run appelait quand même codex avant d'échouer sur un provider qu'il n'utilise plus. Le gel est
  // VOULU (un run doit être jugé par la famille qui l'a produit) ; ce qui ne l'était pas, c'est qu'il
  // survive à la disparition de sa cible, et qu'il le fasse en SILENCE.
  const claude = { provider: 'claude', model: 'claude-opus-5' } as const
  const codex = { provider: 'codex', model: 'gpt-5.6-sol' } as const

  it('provider de l’instantané DISPARU → repli sur la config courante, et il est DIT', () => {
    const r = bindingDePhaseValide(codex, claude, ['claude', 'gemini'])
    expect(r.binding).toEqual(claude)
    expect(r.note).toMatch(/instantané abandonné/)
    expect(r.note).toContain('codex')
    expect(r.note).toContain('claude')
  })

  it('instantané VALIDE mais divergent → il est conservé, la divergence est annoncée', () => {
    const r = bindingDePhaseValide(codex, claude, ['claude', 'codex'])
    // Conservé : c'est le gel, et il a une raison — le verdict doit rester comparable.
    expect(r.binding).toEqual(codex)
    expect(r.note).toMatch(/instantané du run/)
    expect(r.note).toContain('configuration courante')
  })

  it('instantané IDENTIQUE à la config → aucune note, pas de bruit', () => {
    const r = bindingDePhaseValide(claude, claude, ['claude'])
    expect(r.binding).toEqual(claude)
    expect(r.note).toBeUndefined()
  })

  it('rien à assainir → l’objet D’ORIGINE, pas une copie (identité préservée)', () => {
    // Un contrat existant vérifie que les points de reprise portent le MÊME instantané PAR IDENTITÉ.
    // Ma première version reconstruisait l’objet à chaque fois : contrat cassé, et copie gratuite
    // dans le cas courant. Trouvé par la suite complète, pas par mes propres tests.
    const instantane = {
      roles: { orchestrator: claude, subagent: claude, judge: claude, scout: claude },
      phaseFanOut: { build: [claude] },
      judgeFanOut: [claude]
    } as never
    const r = instantaneAssaini(instantane, { orchestrator: claude, subagent: claude, judge: claude, scout: claude } as never, ['claude'])
    expect(r.instantane).toBe(instantane)
    expect(r.notes).toEqual([])
  })

  it('un membre de fan-out injoignable est RETIRÉ, pas remplacé', () => {
    // Sa place n’a pas d’équivalent dans la configuration courante : un panel amputé vaut mieux
    // qu’un panel qui jette « Provider inconnu ».
    const instantane = {
      roles: { orchestrator: claude, subagent: claude, judge: claude, scout: claude },
      phaseFanOut: { build: [claude, codex] },
      judgeFanOut: [codex]
    } as never
    const r = instantaneAssaini(instantane, { orchestrator: claude, subagent: claude, judge: claude, scout: claude } as never, ['claude'])
    expect(r.instantane.phaseFanOut.build).toEqual([claude])
    expect(r.instantane.judgeFanOut).toEqual([])
    expect(r.notes.join(' ')).toMatch(/fan-out/)
  })

  it('aucun instantané → la config courante, sans note', () => {
    const r = bindingDePhaseValide(undefined, claude, ['claude'])
    expect(r.binding).toEqual(claude)
    expect(r.note).toBeUndefined()
  })

  it('un modèle change à provider égal est aussi une divergence', () => {
    const r = bindingDePhaseValide(
      { provider: 'claude', model: 'claude-sonnet-5' },
      claude,
      ['claude']
    )
    expect(r.note).toMatch(/instantané du run/)
    expect(r.binding.model).toBe('claude-sonnet-5')
  })
})

describe('instantané divergent — OBSERVÉ sur le vrai chemin de run()', () => {
  // Les tests ci-dessus couvrent la fonction PURE. Celui-ci exerce l'orchestrateur REEL : c'est le
  // câblage qui n'était pas observé, et le cas divergent ne se produit pas sur une configuration
  // saine — donc il ne s'observerait jamais en usage normal sans le provoquer.
  it('un provider d’instantané INCONNU du registre est abandonné, et la note SORT dans le flux', async () => {
    const provider = new CapturingProvider()
    const roles = new RoleModelConfig({
      subagent: { provider: provider.id },
      judge: { provider: provider.id }
    })
    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles,
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: process.cwd()
    })

    const deltas: string[] = []
    // Instantané dont le juge pointe sur un provider JAMAIS enregistré : exactement le cas vécu
    // (instantané sur codex, codex absent de la configuration courante).
    const instantane = {
      roles: {
        orchestrator: { provider: provider.id },
        subagent: { provider: provider.id },
        judge: { provider: 'fantome', model: 'modele-disparu' },
        scout: { provider: provider.id }
      },
      phaseFanOut: {},
      judgeFanOut: []
    } as never

    await orchestrator.run(
      'analyse le projet en lecture seule sans le modifier',
      undefined,
      undefined,
      (_step, delta) => deltas.push(delta),
      undefined,
      '',
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      instantane
    )

    const note = deltas.find((d) => d.includes('[binding]'))
    expect(note, `aucune note [binding] dans ${deltas.length} deltas`).toBeDefined()
    expect(note).toMatch(/instantané abandonné/)
    expect(note).toContain('fantome')
    expect(note).toContain(provider.id)
  })
})
