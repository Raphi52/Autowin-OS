import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { WorktreeOperationClient } from './worktree-operation-client'

describe('WorktreeOperationClient', () => {
  it('garde l event loop reactive et borne une operation worker bloquee', async () => {
    const client = new WorktreeOperationClient('unused', {
      timeoutMs: 40,
      workerFactory: () =>
        new Worker(
          `
            const { parentPort } = require('node:worker_threads')
            parentPort.on('message', () => {
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
            })
          `,
          { eval: true }
        )
    })
    let heartbeats = 0
    const heartbeat = setInterval(() => {
      heartbeats += 1
    }, 5)

    await expect(
      client.run({ operation: 'changedFiles', agentId: 'blocked-fixture' })
    ).rejects.toThrow(/40 ms/)
    clearInterval(heartbeat)

    expect(heartbeats).toBeGreaterThanOrEqual(2)
    expect(client.pendingCount).toBe(0)
  })
})

describe('budget par opération', () => {
  /**
   * MESURÉ : l'inventaire de récupération balaie 52 copies, chacune avec plusieurs sous-processus git.
   * Avec le budget d'UNE commande git (32 s) il était interrompu à mi-course — « Opération worktree
   * interrompue après 32000 ms » — et la récupération repartait en échec avec UN run au lieu de 215.
   * La mesure disait vrai ; c'est la limite qui était de la mauvaise catégorie.
   */
  it('un `timeoutMs` par appel remplace le budget par défaut', async () => {
    const worker = {
      on: () => undefined,
      postMessage: () => undefined,
      terminate: async () => 0
    }
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 20,
      workerFactory: () => worker
    })
    // Le défaut expirerait en 20 ms ; l'appel demande 10 000 ms, donc rien ne doit expirer ici.
    let regle = false
    const promesse = client.run({ operation: 'recoveryInventory' }, {}, { timeoutMs: 10_000 }).then(
      () => {
        regle = true
      },
      () => {
        regle = true
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(regle).toBe(false)
    void promesse
  })

  it('sans surcharge, le budget par défaut s’applique toujours', async () => {
    const worker = {
      on: () => undefined,
      postMessage: () => undefined,
      terminate: async () => 0
    }
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 20,
      workerFactory: () => worker
    })
    // La garde qui compte : la surcharge ne doit pas devenir un budget infini par accident.
    await expect(client.run({ operation: 'recoveryInventory' })).rejects.toThrow(/20 ms/)
  })
})
