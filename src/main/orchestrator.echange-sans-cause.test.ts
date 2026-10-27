import { mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Orchestrator } from './orchestrator'
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
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { HookBus } from './hooks/hook-bus'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { MARQUE_QUESTION_SANS_CAUSE } from './gates/echange-sans-cause'
import { messagesAAfficher } from './messages-entre-fils-app'

/*
 * ÉCHANGE AVANT RÉPARATION — refus « sans cause » seul (conv-1139, 2026-10-24, étape 1 de l'option A
 * du cadrage forum-agents-partie2-juge-build). Mesure du 24/10 : 18 refus du contrôle final faits du
 * SEUL fix-gate dans 14 runs ; chacun relançait build + nettoyage + juge, alors qu'une ligne
 * `CausalHypothesis: <chemin> — <cause>` dans le texte du run suffit à le lever.
 *
 * Fichier témoin SANS jeton (note Brain du 22/10, conv-1074) : `src/temoin-echange-sans-jeton.ts`
 * n'existe pas, donc la source 3 des jetons (dernier changement git) ne peut rien créditer.
 */
const TEMOIN = 'src/temoin-echange-sans-jeton.ts'

type Reponse = { text: string; evidence?: ExecutionEvidence[] }

class ProviderEchange implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  readonly honoursSessionResume: boolean
  builds = 0
  juges = 0
  questions: { texte: string; resume?: string; buildsAvant: number }[] = []
  constructor(
    private readonly repondre: (question: string, n: number) => Reponse,
    reprise = true
  ) {
    this.honoursSessionResume = reprise
  }
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(
    m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const dernier = String(m[m.length - 1]?.content ?? '')
    if (options.execution?.sandbox === 'read-only') {
      this.juges += 1
      return { text: 'VALIDE', provider: this.id, systemInjected: true }
    }
    if (dernier.includes(MARQUE_QUESTION_SANS_CAUSE)) {
      this.questions.push({
        texte: dernier,
        resume: options.resumeSessionId,
        buildsAvant: this.builds
      })
      const r = this.repondre(dernier, this.questions.length)
      return {
        text: r.text,
        provider: this.id,
        systemInjected: true,
        executionEvidence: r.evidence
      }
    }
    this.builds += 1
    const edit = (): ExecutionEvidence => ({
      type: 'file_change',
      kind: 'mutation',
      status: 'done',
      ok: true,
      summary: 'edit',
      paths: [TEMOIN]
    })
    return {
      text: 'livrable',
      provider: this.id,
      systemInjected: true,
      sessionId: `sess-build-${this.builds}`,
      executionEvidence: [
        edit(),
        edit(),
        edit(),
        {
          type: 'command_execution',
          kind: 'verification',
          status: 'done',
          ok: true,
          summary: 'test exit=0'
        }
      ]
    }
  }
}

function orchestrateur(provider: ProviderEchange, hooks?: HookBus, copie = 'C:\\ws'): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: copie,
    worktrees: makeTestWorktrees(copie),
    classifyPhases: () => ['build'],
    ...(hooks ? { hooks } : {})
  })
}

const lignesDeTrace = (r: { trace: { detail?: string }[] }): string =>
  r.trace.map((t) => t.detail ?? '').join('\n')

describe('refus « sans cause » seul : une question au build avant toute réparation', () => {
  it('réponse avec la cause sur le chemin exact → refus levé, le juge statue, aucun nouveau build', async () => {
    const provider = new ProviderEchange(() => ({
      text: `Le fichier a été écrit en trois passes.\nCausalHypothesis: ${TEMOIN} — fichier neuf rédigé en trois passes, pas un bug corrigé à l'aveugle`
    }))
    const r = await orchestrateur(provider).run('corrige le bug')
    expect(provider.builds).toBe(1)
    expect(provider.questions).toHaveLength(1)
    // La question vise la session du build et recopie le chemin tel que le refus le donne.
    expect(provider.questions[0].resume).toBe('sess-build-1')
    expect(provider.questions[0].texte).toContain(`- ${TEMOIN}`)
    expect(provider.juges).toBeGreaterThanOrEqual(1)
    expect(r.gateBlocked).toBe(false)
    expect(lignesDeTrace(r)).toMatch(/Échange 1 — tenté/)
    expect(lignesDeTrace(r)).toMatch(/Échange 1 — refus levé/)
  })

  it('réponse sans ligne de cause → refus maintenu, réparation normale ; 1 échange par refus, aucun plafond par run', async () => {
    const provider = new ProviderEchange(() => ({ text: 'Je ne sais pas.' }))
    const r = await orchestrateur(provider).run('corrige le bug')
    expect(provider.builds).toBeGreaterThan(2)
    expect(lignesDeTrace(r)).toMatch(
      /Échange 1 — refus maintenu : la réponse ne donne aucune ligne de cause/
    )
    // Un seul échange par refus : la 2e question suit un NOUVEAU build, jamais la 1re dans le même passage.
    expect(provider.questions[1].resume).toBe('sess-build-2')
    // Plus de plafond par run (conv-1139, 2026-10-25) : un échange après CHAQUE build refusé, et le run
    // s'arrête quand même, au plafond dur des passages de réparation.
    expect(provider.questions.length).toBeGreaterThan(2)
    expect(provider.questions.map((q) => q.buildsAvant)).toEqual(
      Array.from({ length: provider.questions.length }, (_v, i) => i + 1)
    )
    expect(r.gateBlocked).toBe(true)
    expect(lignesDeTrace(r)).not.toMatch(/plafond de d+ échanges par run/)
  })

  it('réponse de plus de 6 000 caractères : la ligne de cause en fin de réponse lève le refus', async () => {
    const longue = 'explication longue '.repeat(500)
    expect(longue.length).toBeGreaterThan(6000)
    const provider = new ProviderEchange(() => ({
      text: [longue, `CausalHypothesis: ${TEMOIN} — fichier neuf écrit en trois passes`].join('\n')
    }))
    const r = await orchestrateur(provider).run('corrige le bug')
    expect(provider.builds).toBe(1)
    expect(r.gateBlocked).toBe(false)
    expect(lignesDeTrace(r)).toMatch(/Échange 1 — refus levé/)
  })

  const copieGit = (): string => {
    const copie = mkdtempSync(join(tmpdir(), 'echange-sans-cause-'))
    const git = (...args: string[]): string =>
      execFileSync('git', ['-C', copie, ...args], { encoding: 'utf8', windowsHide: true })
    git('init', '-q')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'test')
    writeFileSync(join(copie, 'a.txt'), 'a')
    git('add', 'a.txt')
    git('commit', '-q', '-m', 'base')
    return copie
  }

  it('copie git réelle modifiée par la réponse SANS preuve déclarée → l’empreinte annule l’échange', async () => {
    const copie = copieGit()
    const provider = new ProviderEchange(() => {
      writeFileSync(join(copie, 'a.txt'), 'a modifié par la réponse')
      return { text: `CausalHypothesis: ${TEMOIN} — cause` }
    })
    const r = await orchestrateur(provider, undefined, copie).run('corrige le bug')
    expect(provider.builds).toBeGreaterThan(1)
    expect(lignesDeTrace(r)).toMatch(
      /Échange 1 — annulé : la réponse a modifié la copie de travail/
    )
  })

  it('jumeau : copie git réelle NON modifiée → refus levé (l’empreinte ne refuse pas à tort)', async () => {
    const copie = copieGit()
    const provider = new ProviderEchange(() => ({ text: `CausalHypothesis: ${TEMOIN} — cause` }))
    const r = await orchestrateur(provider, undefined, copie).run('corrige le bug')
    expect(provider.builds).toBe(1)
    expect(lignesDeTrace(r)).toMatch(/Échange 1 — refus levé/)
  })

  it('le fil du run voit la question et la réponse dans le journal commun', async () => {
    const fil = `conv-echange-${Date.now()}`
    const provider = new ProviderEchange(() => ({ text: `CausalHypothesis: ${TEMOIN} — cause` }))
    await orchestrateur(provider).run(
      'corrige le bug',
      undefined,
      undefined,
      undefined,
      undefined,
      '',
      [],
      fil
    )
    const vus = messagesAAfficher(fil)
    expect(vus.map((m) => m.nature)).toEqual(['question', 'reponse'])
    expect(vus[0].autreFil).toMatch(/^build du run /)
    expect(vus[0].texte).toContain(`- ${TEMOIN}`)
    expect(vus[1].texte).toContain(`CausalHypothesis: ${TEMOIN}`)
  })

  it('chemin différent de celui du refus → refus maintenu, la règle du chemin exact ne s’assouplit pas', async () => {
    const provider = new ProviderEchange(() => ({
      text: 'CausalHypothesis: src/autre-fichier.ts — sans rapport'
    }))
    const r = await orchestrateur(provider).run('corrige le bug')
    expect(provider.builds).toBeGreaterThan(1)
    expect(lignesDeTrace(r)).toMatch(/Échange 1 — refus maintenu : le contrôle refuse encore/)
  })

  it('réponse qui modifie la copie → échange annulé, réparation normale', async () => {
    const provider = new ProviderEchange(() => ({
      text: `CausalHypothesis: ${TEMOIN} — corrigé au passage`,
      evidence: [
        {
          type: 'file_change',
          kind: 'mutation',
          status: 'done',
          ok: true,
          summary: 'edit',
          paths: [TEMOIN]
        }
      ]
    }))
    const r = await orchestrateur(provider).run('corrige le bug')
    expect(provider.builds).toBeGreaterThan(1)
    expect(lignesDeTrace(r)).toMatch(
      /Échange 1 — annulé : la réponse a modifié la copie de travail/
    )
  })

  it('modèle sans reprise de session → aucun échange, réparation normale, motif dans la trace', async () => {
    const provider = new ProviderEchange(() => ({ text: `CausalHypothesis: ${TEMOIN} — x` }), false)
    const r = await orchestrateur(provider).run('corrige le bug')
    expect(provider.questions).toHaveLength(0)
    expect(provider.builds).toBeGreaterThan(1)
    expect(lignesDeTrace(r)).toMatch(/Échange impossible : aucune session du build à reprendre/)
  })

  it('refus mêlé (« sans cause » + autre motif) → aucun échange, réparation comme aujourd’hui', async () => {
    const provider = new ProviderEchange(() => ({ text: `CausalHypothesis: ${TEMOIN} — x` }))
    const bus = new HookBus().register('pre-green', () => ({
      block: true,
      reason: `hook fix-gate: 3 édits de ${TEMOIN} sans cause vérifiée (CausalHypothesis/fix-ok/check:); hook verify-replay: commande en échec`
    }))
    const r = await orchestrateur(provider, bus).run('corrige le bug')
    expect(provider.questions).toHaveLength(0)
    expect(provider.builds).toBeGreaterThan(1)
    expect(lignesDeTrace(r)).not.toMatch(/Échange/)
  })

  it('panne pendant la réponse → réparation normale, motif nommé, jamais un tour perdu', async () => {
    const provider = new ProviderEchange(() => {
      throw new Error('quota atteint')
    })
    const r = await orchestrateur(provider).run('corrige le bug')
    expect(provider.builds).toBeGreaterThan(1)
    expect(lignesDeTrace(r)).toMatch(
      /Échange 1 — refus maintenu : panne pendant la réponse \(quota atteint\)/
    )
  })
})
