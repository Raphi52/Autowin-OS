import { describe, expect, it, vi } from 'vitest'
import { ModelCatalogRefresher, serveModelCatalog } from './model-refresh'

describe('ModelCatalogRefresher', () => {
  it('serves the cached catalog immediately during boot and only awaits forced refreshes', async () => {
    let resolveDiscovery!: (models: Array<{ id: string }>) => void
    const discovery = new Promise<Array<{ id: string }>>((resolve) => {
      resolveDiscovery = resolve
    })
    const refresher = new ModelCatalogRefresher([{ id: 'cached' }], () => discovery)
    void refresher.refresh(true)

    expect(serveModelCatalog(refresher, false)).toEqual([{ id: 'cached' }])
    const forced = serveModelCatalog(refresher, true)
    resolveDiscovery([{ id: 'live' }])
    await expect(forced).resolves.toEqual([{ id: 'live' }])
  })

  it('deduplicates concurrent supplier refreshes and publishes one non-empty result', async () => {
    let release!: (models: string[]) => void
    const discover = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          release = resolve
        })
    )
    const refresher = new ModelCatalogRefresher(['cached'], discover)

    const first = refresher.refresh(true)
    const second = refresher.refresh(true)
    release(['live-a', 'live-b'])

    await expect(Promise.all([first, second])).resolves.toEqual([
      ['live-a', 'live-b'],
      ['live-a', 'live-b']
    ])
    expect(discover).toHaveBeenCalledTimes(1)
    expect(refresher.current()).toEqual(['live-a', 'live-b'])
  })

  it('retains the last valid catalog on an empty result or supplier failure', async () => {
    const discover = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('supplier down'))
    const refresher = new ModelCatalogRefresher(['cached'], discover)

    await expect(refresher.refresh(true)).resolves.toEqual(['cached'])
    await expect(refresher.refresh(true)).resolves.toEqual(['cached'])
    expect(refresher.current()).toEqual(['cached'])
  })

  it('reuses a fresh catalog unless the caller explicitly forces discovery', async () => {
    let now = 1_000
    const discover = vi.fn(async () => ['live'])
    const refresher = new ModelCatalogRefresher(['cached'], discover, {
      now: () => now,
      freshnessMs: 60_000
    })

    await refresher.refresh()
    now += 10_000
    await refresher.refresh()
    await refresher.refresh(true)

    expect(discover).toHaveBeenCalledTimes(2)
  })
})
