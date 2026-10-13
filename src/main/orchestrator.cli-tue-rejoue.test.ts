import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { retryOnTransientOverload } from './transient-overload'

/**
 * CLI TUÉ DE L'EXTÉRIEUR → la phase est rejouée UNE fois au lieu de perdre le tour.
 *
 * Incident ak-8142df0fddd513bc : « Phase kaizen — le rôle subagent est bindé sur claude (opus) :
 * claude CLI exit 1073807364 ». 1073807364 = 0x40010004, un statut de TERMINAISON : l'hôte a arrêté
 * le process avant toute réponse, l'appel n'a rien dit de la tâche. Le tour entier mourait pourtant,
 * et `repairHint` conseillait à l'humain de « relancer la phase » — le geste que le code ne faisait pas.
 * Repris de la branche Azure `autowin/secours/copie-run-fd8d6412055b-1` (commit 323ad9e2, 2026-09-04),
 * adapté au code actuel : on ne rejoue que les statuts de TRANSPORT (`isTransportFailure`), jamais un
 * crash du CLI ni un `exit 1`, qui se reproduiraient à l'identique.
 */
const CLI_TUE =
  'claude CLI exit 1073807364 (0x40010004 arrêt du process demandé par l’hôte) — claude CLI ' +
  '(modèle claude-opus) s’est terminé : exit 1073807364 (0x40010004 arrêt du process demandé par l’hôte)'

async function compterAppels(
  echecs: string[],
  options: Parameters<typeof retryOnTransientOverload>[1] = {}
): Promise<{ appels: number; resultat?: string; erreur?: string }> {
  let appels = 0
  try {
    const resultat = await retryOnTransientOverload(
      async () => {
        appels += 1
        const echec = echecs[appels - 1]
        if (echec) throw new Error(echec)
        return 'ok'
      },
      { sleep: async () => undefined, ...options }
    )
    return { appels, resultat }
  } catch (error) {
    return { appels, erreur: error instanceof Error ? error.message : String(error) }
  }
}

describe('retryOnTransientOverload — CLI arrêté de l’extérieur', () => {
  it('rejoue UNE fois un CLI tué avant de répondre, et l’annonce', async () => {
    const annonces: Array<{ cause?: string; attempt: number }> = []
    const r = await compterAppels([CLI_TUE], {
      onRetry: (i) => annonces.push({ cause: i.cause, attempt: i.attempt })
    })
    expect(r).toEqual({ appels: 2, resultat: 'ok' })
    expect(annonces).toEqual([{ cause: 'cli-arrete', attempt: 2 }])
  })

  it('ne rejoue qu’une fois : un second arrêt remonte tel quel', async () => {
    const r = await compterAppels([CLI_TUE, CLI_TUE])
    expect(r.appels).toBe(2)
    expect(r.erreur).toBe(CLI_TUE)
  })

  it('les autres statuts de transport réellement vus sont rejoués aussi', async () => {
    // 0xc000026b (arrêt de session Windows, incident ak-820d7029b0c5e76d) ; forme codex `exit-code=`.
    expect((await compterAppels(['claude CLI exit 3221226091'])).appels).toBe(2)
    expect((await compterAppels(['codex exec a échoué exit-code=3221225786'])).appels).toBe(2)
  })

  it('ne rejoue PAS un exit applicatif ni un vrai crash du CLI', async () => {
    expect(await compterAppels(['claude CLI exit 1'])).toEqual({
      appels: 1,
      erreur: 'claude CLI exit 1'
    })
    // 0xc0000005, violation d’accès : un défaut du CLI, pas un canal coupé.
    expect((await compterAppels(['claude CLI exit 3221225477'])).appels).toBe(1)
  })

  it('ne rejoue PAS un appel que l’utilisateur a arrêté', async () => {
    const arret = new AbortController()
    arret.abort()
    expect((await compterAppels([CLI_TUE], { signal: arret.signal })).appels).toBe(1)
  })

  it('le rejeu du CLI tué ne consomme pas les tentatives de surcharge', async () => {
    const r = await compterAppels(
      [CLI_TUE, 'API Error: 529 Overloaded', '503 Service Unavailable'],
      {
        attempts: 3
      }
    )
    expect(r).toEqual({ appels: 4, resultat: 'ok' })
  })
})

class TueUneFois implements ProviderAdapter {
  readonly id = 'sub'
  readonly supportsExecution = true
  calls = 0
  constructor(private readonly echec: string) {}
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls += 1
    if (this.calls === 1) throw new Error(this.echec)
    return {
      text: 'VALIDE',
      provider: this.id,
      model: 'claude-opus',
      systemInjected: true,
      usage: { inputTokens: 1, outputTokens: 1 }
    }
  }
}

function orchestrateurSur(provider: ProviderAdapter): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'claude-opus' },
      subagent: { provider: provider.id, model: 'claude-opus' },
      judge: { provider: provider.id, model: 'claude-opus' },
      scout: { provider: provider.id, model: 'claude-opus' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    execPhases: ['build'],
    sleep: async () => undefined
  })
}

describe('Orchestrator — phase dont le CLI est tué', () => {
  it('rejoue la phase, termine le run et le dit dans le flux', async () => {
    const provider = new TueUneFois(CLI_TUE)
    const flux: string[] = []
    const result = await orchestrateurSur(provider).run(
      'corrige le défaut nommé',
      undefined,
      undefined,
      (_step, delta) => flux.push(delta)
    )
    expect(provider.calls).toBeGreaterThanOrEqual(2)
    expect(
      result.trace.filter((s) => s.step === 'exec' && s.status === 'completed').length
    ).toBeGreaterThan(0)
    expect(flux.join('')).toMatch(/CLI arrêté de l’extérieur/)
  })

  it('un exit applicatif reste un échec définitif, sans rejeu', async () => {
    const provider = new TueUneFois('claude CLI exit 1')
    await expect(orchestrateurSur(provider).run('corrige le défaut nommé')).rejects.toThrow(
      /claude CLI exit 1/
    )
    expect(provider.calls).toBe(1)
  })
})
