import { describe, expect, it } from 'vitest'
import { withDeviceMetricsOverride } from './cdp-device-metrics.mjs'

const metrics = {
  width: 1500,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false
}

describe('withDeviceMetricsOverride', () => {
  it('libère les métriques après une preuve réussie', async () => {
    const calls = []
    const send = async (method, params = {}) => {
      calls.push({ method, params })
    }

    const result = await withDeviceMetricsOverride(
      send,
      metrics,
      async () => 'preuve',
      async () => {
        calls.push({ method: 'restore-state', params: {} })
      }
    )

    expect(result).toBe('preuve')
    expect(calls).toEqual([
      { method: 'Emulation.setDeviceMetricsOverride', params: metrics },
      { method: 'Emulation.clearDeviceMetricsOverride', params: {} },
      { method: 'restore-state', params: {} },
      { method: 'Page.reload', params: { ignoreCache: false } }
    ])
  })

  it('libère les métriques même si la preuve échoue', async () => {
    const calls = []
    const send = async (method, params = {}) => {
      calls.push({ method, params })
    }

    await expect(
      withDeviceMetricsOverride(
        send,
        metrics,
        async () => {
          throw new Error('échec injecté')
        },
        async () => {
          calls.push({ method: 'restore-state', params: {} })
        }
      )
    ).rejects.toThrow('échec injecté')

    expect(calls).toEqual([
      { method: 'Emulation.setDeviceMetricsOverride', params: metrics },
      { method: 'Emulation.clearDeviceMetricsOverride', params: {} },
      { method: 'restore-state', params: {} },
      { method: 'Page.reload', params: { ignoreCache: false } }
    ])
  })
})
