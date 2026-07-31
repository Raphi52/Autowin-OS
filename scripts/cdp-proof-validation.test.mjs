import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import {
  assertFrameBlockProof,
  assertHooksProof,
  assertModelCatalogProof,
  assertTerrainPanelProof
} from './cdp-proof-validation.mjs'

describe('CDP proof validation', () => {
  it('rejects an empty model catalog and accepts visible labels', () => {
    expect(() => assertModelCatalogProof({ labels: [], spacing: {} })).toThrow(/catalogue.*vide/i)
    expect(() =>
      assertModelCatalogProof({ labels: ['Claude Sonnet'], spacing: { rightGap: 12 } })
    ).not.toThrow()
  })

  it('rejects a missing Frame block and accepts a populated one', () => {
    expect(() => assertFrameBlockProof({ panels: [], frame: null })).toThrow(/frame.*absent/i)
    expect(() => assertFrameBlockProof({ frame: { target: 'frame', slots: 0 } })).toThrow(
      /frame.*sans slot/i
    )
    expect(() =>
      assertFrameBlockProof({
        panels: [{ target: 'frame', slots: 1 }],
        frame: { target: 'frame', slots: 1 }
      })
    ).not.toThrow()
  })

  it('rejette un panel Terrain absent, vide ou placé dans le mauvais ordre', () => {
    expect(() =>
      assertTerrainPanelProof({
        panels: [
          { target: 'frame', slots: 1 },
          { target: 'scout', slots: 1 },
          { target: 'judge', slots: 1 }
        ]
      })
    ).toThrow(/ordre|terrain/i)
    expect(() =>
      assertTerrainPanelProof({
        panels: [
          { target: 'scout', slots: 1 },
          { target: 'frame', slots: 1 },
          { target: 'terrain', slots: 0 },
          { target: 'judge', slots: 1 }
        ]
      })
    ).toThrow(/terrain.*sans slot/i)
    expect(() =>
      assertTerrainPanelProof({
        panels: [
          { target: 'scout', slots: 1 },
          { target: 'frame', slots: 1 },
          { target: 'terrain', slots: 1 },
          { target: 'judge', slots: 1 }
        ]
      })
    ).not.toThrow()
  })

  it('rejects zero hooks and accepts a selected non-empty Hooks view', () => {
    expect(() =>
      assertHooksProof({ selectedTab: 'Hooks · 0', selectedSource: 'Codex', hookCount: 0 })
    ).toThrow(/aucun hook/i)
    expect(() =>
      assertHooksProof({ selectedTab: 'Hooks · 2', selectedSource: 'Codex', hookCount: 2 })
    ).not.toThrow()
  })

  it.each([
    ['cdp-model-catalog.mjs', 'assertModelCatalogProof({ labels })'],
    ['cdp-frame-block-proof.mjs', 'assertTerrainPanelProof(dom)'],
    ['cdp-hooks.mjs', 'assertHooksProof(state)']
  ])('%s invokes its non-vacuity validator before reporting success', (script, call) => {
    const source = readFileSync(new URL(script, import.meta.url), 'utf8')
    expect(source).toContain(call)
    expect(source.indexOf(call)).toBeLessThan(source.indexOf('Page.captureScreenshot'))
  })

  it('routes every maintained viewport override through the restoring lease', () => {
    const scriptsDir = new URL('.', import.meta.url)
    const offenders = readdirSync(scriptsDir)
      .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
      .filter((name) => {
        const source = readFileSync(new URL(name, scriptsDir), 'utf8')
        return (
          source.includes('Emulation.setDeviceMetricsOverride') &&
          !source.includes('withDeviceMetricsOverride')
        )
      })

    expect(offenders).toEqual([])
  })
})
