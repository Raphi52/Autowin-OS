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
