import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * UN REFUS TRANSITOIRE NE CONSOMME PAS LE DROIT D'ORCHESTRER DU TOUR (mesure conv-489, 2026-09-12).
 *
 * `orchestrationIssued` est posé AVANT l'exécution : il empêche une SECONDE orchestration payante
 * dans le même tour. Mais « Reprise refusee : N appel(s) provider encore actif(s) » est jeté par
 * `execution-supervisor.ts` AVANT tout appel provider — rien n'a démarré, rien n'a coûté. Le
 * verrou restait pourtant posé : le modèle lisait « aucune autre orchestration ne sera acceptée
 * dans ce tour », rendait la main sans rien livrer, et l'utilisateur payait un tour entier pour
 * zéro ligne de code avant de devoir relancer lui-même.
 *
 * Le refus dit lui-même « la suite correcte est de relancer la MEME demande ». Ce test exige que
 * cette relance soit possible DANS LE MÊME TOUR, et que le garde-fou reste entier pour les autres
 * échecs (voir le second `it`).
 */
const REFUS_TRANSITOIRE =
  'Reprise refusee : 1 appel(s) provider encore actif(s). ' +
  "Refus transitoire : l'appel en cours se regle seul."

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

function pilote(premiereErreur: string): {
  exec: ReturnType<typeof vi.fn>
  run: () => Promise<void>
} {
  const responses = [
    '<cmd>{"name":"orchestrate","args":{"task":"deux onglets Code et Projet"}}</cmd>',
    '<cmd>{"name":"orchestrate","args":{"task":"deux onglets Code et Projet"}}</cmd>',
    'Onglets livrés.'
  ]
  const send = vi.fn(async () => ({ text: responses.shift() ?? '', provider: 'codex' }))
  const registry = {
    send,
    describePrompt: () => ({
      provider: 'codex',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  let appels = 0
  const exec = vi.fn(async () => {
    appels += 1
    if (appels === 1) return { ok: false, error: premiereErreur }
    return {
      ok: true,
      data: {
        status: 'succeeded',
        valid: true,
        gateBlocked: false,
        reused: false,
        runPath: 'C:/runs/conv-489/RUN.md',
        result: 'Onglets Code et Projet ajoutés.'
      }
    }
  })
  const bus = {
    catalog: () => [{ name: 'orchestrate', args: {}, description: 'workflow complet' }],
    snapshotForPrompt,
    exec
  }
  return {
    exec,
    run: () =>
      new AgentPilot(
        registry as never,
        { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
        bus as never
        // maxIter fini : le harnais est borné, pas le produit (cf. cloture-ecrite-par-le-modele).
      ).chat([{ role: 'user', content: 'mets les deux onglets' }], () => {}, undefined, 4)
  }
}

describe('verrou d’orchestration — refus transitoire', () => {
  it('laisse relancer la MÊME demande dans le tour quand le refus est transitoire', async () => {
    const p = pilote(REFUS_TRANSITOIRE)
    await p.run()
    const orchestrations = p.exec.mock.calls.filter(
      (call) => call[0] === 'orchestrate'
    )
    expect(orchestrations.length).toBeGreaterThanOrEqual(2)
  })

  it('garde le verrou intact sur un échec NON transitoire — pas de second run payant', async () => {
    const p = pilote('Phase build — le rôle subagent a échoué.')
    await p.run()
    const orchestrations = p.exec.mock.calls.filter(
      (call) => call[0] === 'orchestrate'
    )
    expect(orchestrations.length).toBe(1)
  })
})
