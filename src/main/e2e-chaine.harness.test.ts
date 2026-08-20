import { existsSync } from 'node:fs'
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

  /**
   * LE RELACHEMENT DES COPIES, garde par une assertion et non par un commentaire.
   *
   * Defaut releve par un juge externe le 2026-08-20 : en VIDANT entierement la boucle de
   * relachement de `demonterOs`, les deux fichiers de test restaient VERTS pendant que 18
   * repertoires orphelins apparaissaient dans le store en moins de cinq minutes. La propriete etait
   * donc nommee dans un commentaire — « sans le relachement des copies, cinq worktrees ORPHELINS
   * sont restes dans le store » — et gardee par RIEN. C'est exactement la maladie que ce livrable
   * existe pour tuer : une garantie annoncee qu'aucune assertion ne tient.
   *
   * Ce cas appelle `demonterOs` LUI-MEME, au lieu de s'en remettre au `afterEach` : une propriete du
   * demontage ne peut pas etre observee par le mecanisme qui demonte.
   */
  it('le demontage relache la copie au lieu de la laisser orpheline', async () => {
    const depotJetable = creerDepotJetable('cible.txt', 'AVANT\n')
    const adaptateur = new AdaptateurSonde()
    const os = await monterOsReel(depotJetable.depot, adaptateur)

    // On acquiert par la porte VIVANTE — celle qu'emprunte un run de mutation.
    const copie = await os.worktrees?.beginAsync('terrain-relache', 'agent-relache', true)
    expect(copie).toBeDefined()
    if (!copie) throw new Error('copie non acquise : le reste du cas ne prouverait rien')
    expect(existsSync(copie)).toBe(true)
    expect(os.worktrees?.activity().length ?? 0).toBeGreaterThan(0)

    await demonterOs(os, depotJetable)

    /**
     * LA propriete, mesuree sur le DISQUE et non dans la comptabilite interne.
     *
     * `activity()` a ete essaye d'abord et rejete : il rend un registre HISTORIQUE des runs — apres
     * relachement, l'entree y demeure avec l'etat `merged`. Asserter sa longueur aurait verifie une
     * ecriture interne, pas la garantie qui compte. Le repertoire present ou absent sur le disque,
     * lui, EST la garantie.
     */
    expect(existsSync(copie)).toBe(false)
  }, 120000)

  it('provider simule selectionne, coordinateur reel present et acquerant', async () => {
    jetable = creerDepotJetable('cible.txt', 'AVANT\n')

    const adaptateur = new AdaptateurSonde()
    const os = await monterOsReel(jetable.depot, adaptateur)
    osCourant = os

    // 1. le binding pointe vraiment sur le simule, sur les quatre roles
    for (const role of ['orchestrator', 'subagent', 'judge', 'scout'] as const) {
      expect(os.roles.getBinding(role).provider).toBe(adaptateur.id)
    }

    // 2. le workspace resolu est bien le depot jetable
    expect(os.executionWorkspace).toBe(jetable.depot)

    /**
       * 3. le coordinateur REEL est la, et il ACQUIERT.
       *
       * On appelle `begin()` DIRECTEMENT ici, et il faut le dire : ce n'est pas la porte qu'emprunte
       * un run de mutation — celle-la est `beginAsync()`. Ce controle verifie donc que le
       * coordinateur du montage est fonctionnel, pas que le chemin de production l'atteint. C'est le
       * fichier e2e voisin qui prouve ce second point, et son sabotage porte sur `beginAsync()`.
       */
    expect(os.worktrees).toBeDefined()
    const copie = os.worktrees?.begin('terrain-seam', 'agent-terrain', true)
    expect(copie).toBeDefined()
    expect(copie).not.toBe(jetable.depot)
    os.worktrees?.end?.('terrain-seam')

    // 4. le provider simule est REELLEMENT joignable par le registre du vrai os
    const flux = os.registry.send(adaptateur.id, [{ role: 'user', content: 'ping' }], {}, () => {})
    await flux
    expect(adaptateur.appels).toBe(1)

  }, 120000)
})
