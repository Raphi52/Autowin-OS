import { EventEmitter } from 'node:events'
import { MessageChannel, Worker } from 'node:worker_threads'
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
   * L'inventaire de récupération balaie les copies, chacune avec plusieurs sous-processus git : son
   * budget n'est pas celui d'une commande unique. Un `timeoutMs` par appel le règle sans toucher aux
   * autres opérations.
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

// fix-ok: cause mesurée — le message de délai ne nommait pas l'opération (test rouge : « Opération worktree interrompue après 20 ms », sans libellé) ; le faux worker typait son listener en unknown (TS2322 au typecheck).
describe('le délai nomme l’opération interrompue', () => {
  /*
   * Refus d’origine (trois refus des 05 et 06/11) : « Opération worktree interrompue après 182000 ms »
   * ne disait ni QUELLE opération avait dépassé (création de la copie, inventaire, intégration…).
   * Les journaux ne permettaient donc pas de savoir ce qui attendait.
   */
  it('le message de délai nomme l’opération en clair', async () => {
    const worker = {
      on: () => undefined,
      postMessage: () => undefined,
      terminate: async () => 0
    }
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 20,
      workerFactory: () => worker
    })
    await expect(client.run({ operation: 'prepare', agentId: 'agent-test' })).rejects.toThrow(
      'interrompue après 20 ms (création de la copie de travail)'
    )
  })

  // Jumeau accepté : une opération qui répond à temps ne doit JAMAIS être déclarée interrompue.
  it('une opération qui répond avant le délai aboutit normalement', async () => {
    const emetteur = new EventEmitter()
    const worker = Object.assign(emetteur, {
      postMessage: () => {
        queueMicrotask(() => emetteur.emit('message', { type: 'result', value: 7 }))
      },
      terminate: async () => 0
    })
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 1_000,
      workerFactory: () => worker
    })
    await expect(client.run({ operation: 'prepare', agentId: 'agent-test' })).resolves.toBe(7)
  })

  // Un VRAI worker bloqué dans un appel synchrone : le délai tenu (50 ms ici, au lieu des 182 s du
  // refus) expire avant sa réponse, et le message nomme l'opération. Ce test ne rejoue PAS la durée
  // réelle : il prouve le mécanisme du délai sur un vrai thread, le rejeu à 182 s est hors dépôt.
  it('un vrai worker bloqué dans un appel synchrone est interrompu, et l’opération est nommée', async () => {
    const client = new WorktreeOperationClient('unused', {
      timeoutMs: 50,
      workerFactory: () =>
        new Worker(
          `
            const { parentPort } = require('node:worker_threads')
            parentPort.on('message', () => {
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
            })
          `,
          { eval: true }
        )
    })
    await expect(client.run({ operation: 'prepare', agentId: 'agent-replay' })).rejects.toThrow(
      'création de la copie de travail'
    )
    expect(client.pendingCount).toBe(0)
  })
})

/**
 * Un worker qui dit ce qu'il fait : chaque commande git signale son début puis sa fin. Au délai,
 * le message doit dire laquelle attendait et depuis quand — c'est la seule trace de l'étape bloquée.
 */
// fix-ok: cause mesurée — le client ne connaît pas le message `etape` : il le prend pour un résultat et résout l'opération à undefined (test rouge : « promise resolved "undefined" instead of rejecting », « expected undefined to be 42 ») ; le délai ne nomme pas la commande git en cours (« aucune commande git en cours » absent).
describe('le délai nomme la commande git en cours', () => {
  function workerQui(messages: unknown[]) {
    const emetteur = new EventEmitter()
    return Object.assign(emetteur, {
      postMessage: () => {
        queueMicrotask(() => {
          for (const message of messages) emetteur.emit('message', message)
        })
      },
      terminate: async () => 0
    })
  }

  it('au délai, la commande git démarrée et jamais finie est nommée avec sa durée', async () => {
    const worker = workerQui([
      {
        type: 'etape',
        phase: 'debut',
        id: 1,
        commande: 'git fetch --no-tags --prune origin',
        ms: Date.now()
      }
    ])
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 50,
      workerFactory: () => worker
    })
    await expect(client.run({ operation: 'prepare', agentId: 'agent-test' })).rejects.toThrow(
      /commande git en cours : « git fetch --no-tags --prune origin » depuis \d+,\d s/
    )
  })

  // Jumeau : une commande déjà finie n'est PAS présentée comme celle qui attend.
  it('une commande git déjà terminée n’est pas présentée comme en cours', async () => {
    const maintenant = Date.now()
    const worker = workerQui([
      {
        type: 'etape',
        phase: 'debut',
        id: 1,
        commande: 'git rev-parse --verify origin/main',
        ms: maintenant
      },
      {
        type: 'etape',
        phase: 'fin',
        id: 1,
        commande: 'git rev-parse --verify origin/main',
        ms: maintenant,
        code: 0
      }
    ])
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 50,
      workerFactory: () => worker
    })
    const erreur = await client.run({ operation: 'prepare', agentId: 'agent-test' }).then(
      () => null,
      (e: Error) => e
    )
    expect(erreur?.message).toContain('aucune commande git en cours')
    expect(erreur?.message).toContain(
      'dernière terminée : « git rev-parse --verify origin/main » (code 0)'
    )
  })

  // fix-ok: cause mesurée — le client ne gardait qu'UNE commande en cours : la fin de la commande 1 effaçait la 2 (rouge : « Opération worktree interrompue après 50 ms », sans nom de commande, au lieu de « commande git en cours : « git fetch … » »).
  // Deux commandes en parallèle (le worker lance des commandes asynchrones sans les attendre) : la fin
  // de l'une ne doit PAS effacer l'autre. Au délai, c'est celle qui n'a pas fini qui est nommée.
  it('avec deux commandes en parallèle, au délai, on nomme celle qui n’a pas fini', async () => {
    const maintenant = Date.now()
    const worker = workerQui([
      {
        type: 'etape',
        phase: 'debut',
        id: 1,
        commande: 'git rev-parse --verify origin/main',
        ms: maintenant
      },
      {
        type: 'etape',
        phase: 'debut',
        id: 2,
        commande: 'git fetch --no-tags --prune origin',
        ms: maintenant + 1
      },
      {
        type: 'etape',
        phase: 'fin',
        id: 1,
        commande: 'git rev-parse --verify origin/main',
        ms: maintenant + 2,
        code: 0
      }
    ])
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 50,
      workerFactory: () => worker
    })
    await expect(client.run({ operation: 'prepare', agentId: 'agent-test' })).rejects.toThrow(
      /commande git en cours : « git fetch --no-tags --prune origin »/
    )
  })

  // Garde : un message d'étape n'est PAS un résultat. Sans cette garde, il terminerait l'opération.
  it('un message d’étape ne termine pas l’opération : la réponse qui suit est celle rendue', async () => {
    const worker = workerQui([
      { type: 'etape', phase: 'debut', id: 1, commande: 'git status', ms: Date.now() },
      { type: 'etape', phase: 'fin', id: 1, commande: 'git status', ms: Date.now(), code: 0 },
      { type: 'result', value: 42 }
    ])
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 1_000,
      workerFactory: () => worker
    })
    await expect(client.run({ operation: 'describe', agentId: 'agent-test' })).resolves.toBe(42)
  })
})

describe('le délai tranche sur ce qui est déjà reçu', () => {
  /*
   * Mesuré sur Node 24.19.0 : quand le fil principal est tenu au-delà du délai, le délai échu passe
   * AVANT les messages déjà en file, et la réponse du worker est jetée. Le refus est alors faux : le
   * travail a répondu à temps. Ce test tient le fil principal 150 ms, pour un délai de 50 ms.
   * fix-ok: cause mesurée — sonde Node 24.19.0 : un délai échu pendant un blocage du fil principal part avant la réponse déjà en file (« délai déclenché à 2502 ms », réponse jamais livrée).
   */
  it('une réponse déjà en file gagne sur le délai quand le fil principal a été tenu au-delà de lui', async () => {
    // Le départ se fait dans la phase « check » de la boucle : c'est là qu'un gestionnaire tient le
    // fil principal. La réponse passe par un vrai port (phase « poll »), comme celle d'un worker.
    await new Promise<void>((resolve) => setImmediate(resolve))
    const canal = new MessageChannel()
    const emetteur = new EventEmitter()
    canal.port1.on('message', (message) => emetteur.emit('message', message))
    const worker = Object.assign(emetteur, {
      postMessage: () => {
        // La réponse est postée pendant l'appel : elle attend dans la file du port.
        // Travail fini pendant l'appel, donc avant l'échéance : seule sa réception est en retard.
        canal.port2.postMessage({ type: 'result', value: 42, termineA: Date.now() })
      },
      terminate: async () => 0
    })
    try {
      const client = new WorktreeOperationClient('worker.js', {
        timeoutMs: 50,
        workerFactory: () => worker
      })
      const promesse = client.run({ operation: 'prepare', agentId: 'agent-test' })
      const fin = Date.now() + 150
      while (Date.now() < fin) {
        // Fil principal tenu, comme pendant une création de processus bloquante.
      }
      await expect(promesse).resolves.toBe(42)
    } finally {
      canal.port1.close()
      canal.port2.close()
    }
  })

  // Rouge avant la règle : le travail se dit terminé 1 s après l'échéance. Le délai doit le refuser,
  // même si la réponse attend dans la file pendant le blocage : le verdict suit l'heure de fin du
  // travail, pas l'heure où ce fil la voit. Sans cette règle, la réponse est acceptée.
  it('une réponse terminée après l’échéance est refusée, même reçue dans la file pendant un blocage', async () => {
    await new Promise<void>((resolve) => setImmediate(resolve))
    const canal = new MessageChannel()
    const emetteur = new EventEmitter()
    canal.port1.on('message', (message) => emetteur.emit('message', message))
    const worker = Object.assign(emetteur, {
      postMessage: () => {
        canal.port2.postMessage({ type: 'result', value: 42, termineA: Date.now() + 1_000 })
      },
      terminate: async () => 0
    })
    try {
      const client = new WorktreeOperationClient('worker.js', {
        timeoutMs: 50,
        workerFactory: () => worker
      })
      const promesse = client.run({ operation: 'prepare', agentId: 'agent-test' })
      const fin = Date.now() + 150
      while (Date.now() < fin) {
        // Fil principal tenu : la réponse, terminée après l'échéance, attend dans la file.
      }
      await expect(promesse).rejects.toThrow('interrompue après 50 ms')
    } finally {
      canal.port1.close()
      canal.port2.close()
    }
  })

  // Jumeau accepté : sans réponse, le même blocage reste un délai nommé.
  it('sans réponse, le même blocage du fil principal reste un délai nommé', async () => {
    const worker = {
      on: () => undefined,
      postMessage: () => undefined,
      terminate: async () => 0
    }
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 50,
      workerFactory: () => worker
    })
    const promesse = client.run({ operation: 'prepare', agentId: 'agent-test' })
    const fin = Date.now() + 150
    while (Date.now() < fin) {
      // Fil principal tenu, comme pendant une création de processus bloquante.
    }
    await expect(promesse).rejects.toThrow(
      'interrompue après 50 ms (création de la copie de travail)'
    )
  })

  // Jumeau accepté : une réponse qui arrive après le délai, fil principal libre, reste refusée.
  it('une réponse qui arrive après le délai, fil principal libre, reste refusée', async () => {
    const emetteur = new EventEmitter()
    const worker = Object.assign(emetteur, {
      postMessage: () => {
        setTimeout(() => emetteur.emit('message', { type: 'result', value: 42 }), 120)
      },
      terminate: async () => 0
    })
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 50,
      workerFactory: () => worker
    })
    await expect(client.run({ operation: 'prepare', agentId: 'agent-test' })).rejects.toThrow(
      'interrompue après 50 ms'
    )
  })
})

describe('le délai dit quand l’opération a été appelée et de combien le verdict a tardé', () => {
  /*
   * Refus d’origine : l’heure de départ de l’opération n’était écrite nulle part. Un refus ne se
   * datait que par déduction (heure du refus moins le budget), sans savoir si le verdict était
   * tombé à l’heure ou après un blocage du fil principal.
   */
  it('le message de délai porte l’heure d’appel et le retard du verdict', async () => {
    const worker = {
      on: () => undefined,
      postMessage: () => undefined,
      terminate: async () => 0
    }
    const client = new WorktreeOperationClient('worker.js', {
      timeoutMs: 20,
      workerFactory: () => worker
    })
    const avant = Date.now()
    const erreur = await client.run({ operation: 'prepare', agentId: 'agent-test' }).then(
      () => undefined,
      (e: unknown) => e as Error
    )
    const apres = Date.now()
    // fix-ok: cause mesurée — l'assertion attendait « démarrée à », libellé qui affirmait un départ non mesuré ; elle porte désormais « heure d’appel » (rouge avant le changement de worktree-operation-client.ts, vert après).
    expect(erreur?.message).toMatch(
      /heure d’appel \d{4}-\d{2}-\d{2}T[\d:.]+Z ; verdict à \d{4}-\d{2}-\d{2}T[\d:.]+Z \(retard du verdict : \d+ ms\)/
    )
    const depart = /heure d’appel (\S+) ;/.exec(erreur?.message ?? '')?.[1]
    expect(depart).toBeDefined()
    expect(Date.parse(depart ?? '')).toBeGreaterThanOrEqual(avant)
    expect(Date.parse(depart ?? '')).toBeLessThanOrEqual(apres)
  })
})
