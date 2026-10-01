import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTRAT_OBJECTIONS, verdictAvecObjectionsPortees } from './objections-juge'
import { lireVerdictJuge, Orchestrator } from './orchestrator'
import { PHASE_BRIEFS } from './phase-briefs'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * LE JUGE LIT LA MÊME RÈGLE QUE CELLE QUI LE LIT.
 *
 * Mesuré sur run-85d8e7f57af2-1 (conv-892, 2026-10-01) : trois verdicts VALIDE (84, 86, 88) ont
 * relancé une réparation chacun. On leur avait écrit « MINEUR: <réserve non bloquante> » à quatre
 * endroits (phase-briefs.ts et trois prompts d'orchestrator.ts), alors que depuis la décision
 * utilisateur de conv-844 (2026-09-24) `objectionsDuJuge` bloque sur TOUT MINEUR. Ils y rangeaient
 * donc des réserves qu'aucune réparation ne pouvait lever : la publication, faite par l'app APRÈS
 * le VALIDE ; une mesure qui attend 10 runs après la fusion.
 */

const NON_BLOQUANTE = /MINEUR:\s*<r[ée]serve non bloquante>/u

class JugeEnregistre implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  readonly honoursSessionResume = true
  readonly promptsDuJuge: string[] = []
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const isJudge = options.execution?.sandbox === 'read-only'
    if (isJudge) this.promptsDuJuge.push(String(messages[messages.length - 1]?.content ?? ''))
    const isExec = options.execution?.sandbox === 'danger-full-access'
    return {
      text: isJudge ? 'VALIDE' : 'livrable',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: isExec
        ? [
            { type: 'file_change', kind: 'mutation', status: 'done', ok: true, summary: 'edit' },
            {
              type: 'command_execution',
              kind: 'verification',
              status: 'done',
              ok: true,
              summary: 'test exit=0'
            }
          ]
        : undefined
    }
  }
}

function orchestrateur(provider: ProviderAdapter, phases: Array<'build' | 'clean'>): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    classifyPhases: () => phases
  })
}

/** Verdict réel de la reprise de 12:54 (run-stdout/51baad51…), puces raccourcies. */
const VALIDE_88_TEL_QUEL = `VALIDE
SCORE: 88
OBJECTIONS:
- OK: Les fichiers visés par la tâche ont bien été traités.
- OK: 11 fichiers de tests : 195 sur 195, code de sortie 0.
- MINEUR: La tâche disait « jusqu'au commit publié ». Rien n'est poussé : c'est l'application qui publie un run validé. La publication réelle reste donc à constater après ce contrôle.
- MINEUR: Piste 2. La mesure affiche 0 run sur 10, et elle ne démarre qu'à la fusion.`

const VALIDE_88_SELON_LE_CONTRAT = `VALIDE
SCORE: 88
OBJECTIONS:
- OK: Les fichiers visés par la tâche ont bien été traités.
- OK: 11 fichiers de tests : 195 sur 195, code de sortie 0.
- OK: hors run — rien n'est poussé : l'application publie après ce VALIDE ; à constater ensuite.
- OK: hors run — piste 2 : la mesure attend 10 runs après la fusion.`

describe('contrat des objections du juge', () => {
  it('le contrat dit que MINEUR bloque et range en OK ce qu’aucune réparation ne lève', () => {
    expect(CONTRAT_OBJECTIONS).not.toMatch(NON_BLOQUANTE)
    expect(CONTRAT_OBJECTIONS).toMatch(/MINEUR: <[^>]*BLOQUE la clôture/u)
    expect(CONTRAT_OBJECTIONS).toMatch(/OK: hors run/u)
    expect(CONTRAT_OBJECTIONS).toMatch(/jamais OK/u)
  })

  it('la consigne de phase du juge porte ce contrat', () => {
    expect(PHASE_BRIEFS.judge).toContain(CONTRAT_OBJECTIONS)
    expect(PHASE_BRIEFS.judge).not.toMatch(NON_BLOQUANTE)
  })

  it('le prompt du juge d’un run à plusieurs phases porte ce contrat', async () => {
    const provider = new JugeEnregistre()
    await orchestrateur(provider, ['build', 'clean']).run('corrige le bug')
    expect(provider.promptsDuJuge.length).toBeGreaterThan(0)
    for (const prompt of provider.promptsDuJuge) {
      expect(prompt).toContain(CONTRAT_OBJECTIONS)
      expect(prompt).not.toMatch(NON_BLOQUANTE)
    }
  })

  it('le prompt du juge seul (`/judge`, aucune phase) porte ce contrat', async () => {
    const provider = new JugeEnregistre()
    await orchestrateur(provider, []).run('/judge le livrable')
    expect(provider.promptsDuJuge.length).toBeGreaterThan(0)
    for (const prompt of provider.promptsDuJuge) expect(prompt).toContain(CONTRAT_OBJECTIONS)
  })

  it('aucun fichier du processus principal ne redéfinit MINEUR comme non bloquant', () => {
    const racine = join(__dirname)
    const fautifs = readdirSync(racine, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !/\.test\.ts$/u.test(f))
      .filter((f) => NON_BLOQUANTE.test(readFileSync(join(racine, f), 'utf8')))
    expect(fautifs).toEqual([])
  })

  it('cas conv-892 : le VALIDE 88 tel quel bloque ; classé selon le contrat, il clôt', () => {
    expect(lireVerdictJuge(verdictAvecObjectionsPortees(VALIDE_88_TEL_QUEL))).toBe(false)
    expect(lireVerdictJuge(verdictAvecObjectionsPortees(VALIDE_88_SELON_LE_CONTRAT))).toBe(true)
  })
})
