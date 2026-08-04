import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from './providers/registry'
import { createFabricProductBindings } from './compute-fabric/product-bridge'
import type { ProviderAdapter } from './providers/types'

describe('Compute Fabric product bridge', () => {
  it('publishes local-tools resources as selectable models with no fallback', () => {
    const bridge = createFabricProductBindings({
      nodeId: 'node-a',
      trust: 'paired',
      availability: 'online',
      lastSequence: 3,
      lastManifestDigest: 'a'.repeat(64),
      resources: [
        {
          nodeId: 'node-a',
          id: 'resource-a',
          kind: 'model',
          adapterId: 'adapter-a',
          displayName: 'Resource A',
          runtimeVersion: '1.0.0',
          modes: ['local-tools'],
          capabilities: [],
          limits: { contextTokens: 32_000, maxConcurrentRuns: 1 }
        }
      ]
    })

    expect(bridge.models).toEqual([
      expect.objectContaining({
        id: 'fabric/node-a/resource-a',
        provider: 'fabric:node-a:resource-a',
        model: 'resource-a',
        dynamicallyLoaded: true,
        compute: expect.objectContaining({ fallback: { kind: 'none' } })
      })
    ])
  })

  it('allows registered Fabric chat but refuses execution instead of redirecting to Codex', async () => {
    const calls: string[] = []
    const fabric: ProviderAdapter = {
      id: 'fabric:node-a:resource-a',
      supportsExecution: false,
      auth: async () => true,
      async *send() {
        calls.push('fabric')
        yield { delta: '' }
        return { text: 'ok', provider: 'fabric:node-a:resource-a', systemInjected: false }
      }
    }
    const codex: ProviderAdapter = {
      id: 'codex',
      supportsExecution: true,
      auth: async () => true,
      async *send() {
        calls.push('codex')
        yield { delta: '' }
        return { text: 'fallback', provider: 'codex', systemInjected: false }
      }
    }
    const registry = new ProviderRegistry().register(codex).register(fabric)

    await expect(
      registry.send(fabric.id, [{ role: 'user', content: 'hello' }])
    ).resolves.toMatchObject({
      provider: fabric.id
    })
    await expect(
      registry.send(fabric.id, [{ role: 'user', content: 'execute' }], {
        execution: { cwd: 'C:\\workspace', sandbox: 'read-only' }
      })
    ).rejects.toThrow(/local-tools|Fabric/i)
    expect(calls).toEqual(['fabric'])
  })
})
