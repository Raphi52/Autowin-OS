import { describe, expect, it, afterEach } from 'vitest'
import { creerDepotJetable, demonterOs, monterOsReel, type DepotJetable } from './e2e-chaine.harness'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'

/**
 * VERIFICATION DU TERRAIN — pas le e2e, juste : le harnais atteint-il ce qu'il pretend atteindre ?
 *
 * Trois choses a constater avant d'autoriser le build : le faux provider est REELLEMENT selectionne,
 * le coordinateur reel est present, et son `begin()` acquiert. Si l'une manque, le e2e serait
 * decoratif comme son predecesseur.
 */
class AdaptateurSonde implements ProviderAdapter {
  readonly id = 'e2e-chaine-sonde'
  readonly supportsExecution = true
  appels = 0
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(
    _m: Message[],
    _o: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.appels += 1
    return { text: 'sonde', provider: this.id, systemInjected: false }
  }
}

describe('TERRAIN — le harnais atteint le vrai code', () => {
  let jetable: DepotJetable | undefined
  let osCourant: Awaited<ReturnType<typeof monterOsReel>> | undefined
  afterEach(async () => {
    await demonterOs(osCourant, jetable)
    jetable = undefined
    osCourant = undefined
  })

  it('provider simule selectionne, coordinateur reel present et acquerant', async () => {
    const t0 = Date.now()
    jetable = creerDepotJetable('cible.txt', 'AVANT\n')
    const tDepot = Date.now() - t0

    const adaptateur = new AdaptateurSonde()
    const t1 = Date.now()
    const os = await monterOsReel(jetable.depot, adaptateur)
    osCourant = os
    const tOs = Date.now() - t1

    // 1. le binding pointe vraiment sur le simule, sur les quatre roles
    for (const role of ['orchestrator', 'subagent', 'judge', 'scout'] as const) {
      expect(os.roles.getBinding(role).provider).toBe(adaptateur.id)
    }

    // 2. le workspace resolu est bien le depot jetable
    expect(os.executionWorkspace).toBe(jetable.depot)

    // 3. le coordinateur REEL est la, et il ACQUIERT
    expect(os.worktrees).toBeDefined()
    const t2 = Date.now()
    const copie = os.worktrees?.begin('terrain-seam', 'agent-terrain', true)
    const tBegin = Date.now() - t2
    expect(copie).toBeDefined()
    expect(copie).not.toBe(jetable.depot)
    os.worktrees?.end?.('terrain-seam')

    // 4. le provider simule est REELLEMENT joignable par le registre du vrai os
    const flux = os.registry.send(adaptateur.id, [{ role: 'user', content: 'ping' }], {}, () => {})
    await flux
    expect(adaptateur.appels).toBe(1)

    console.log(
      `[TERRAIN] depot ${tDepot}ms | os ${tOs}ms | begin ${tBegin}ms | total ${Date.now() - t0}ms`
    )
  }, 120000)
})
