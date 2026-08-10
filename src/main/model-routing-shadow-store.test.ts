import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createShadowRoutingRuntime,
  ShadowRoutingStore,
  type RoutingObservation
} from './model-routing-shadow'

const valid: RoutingObservation = {
  schema: 'autowin.routing-observation/v1',
  id: 'obs-1',
  timestamp: '2026-08-08T10:00:00.000Z',
  phase: 'build',
  provider: 'codex',
  model: 'gpt',
  outcome: 'verified-success',
  durationMs: 100
}

describe('shadow routing store', () => {
  it('reste OFF par defaut sans creer de fichier ni observateur', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-shadow-disabled-'))
    const path = join(root, 'observations-v1.jsonl')

    const runtime = createShadowRoutingRuntime(path, {})

    expect(runtime).toEqual({ enabled: false })
    expect(existsSync(path)).toBe(false)
  })

  it('construit explicitement le store et l observateur quand le pilote est active', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-shadow-enabled-'))
    const path = join(root, 'observations-v1.jsonl')

    const runtime = createShadowRoutingRuntime(path, {
      AUTOWIN_MODEL_ROUTING_SHADOW_ENABLED: '1'
    })

    expect(runtime.enabled).toBe(true)
    if (!runtime.enabled) throw new Error('runtime shadow attendu actif')
    expect(runtime.store).toBeInstanceOf(ShadowRoutingStore)
    expect(runtime.observer).toBeDefined()
    expect(existsSync(path)).toBe(false)
  })

  it('persists versioned observations and ignores malformed lines on reload', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-routing-shadow-'))
    const path = join(root, 'observations.jsonl')
    const store = new ShadowRoutingStore(path)
    expect(store.append(valid)).toBe(true)
    writeFileSync(path, `${readFileSync(path, 'utf8')}not-json\n{"schema":"wrong"}\n`, 'utf8')

    expect(new ShadowRoutingStore(path).read()).toEqual([valid])
  })

  it('rejects invalid observations without writing them', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-routing-shadow-invalid-'))
    const path = join(root, 'observations.jsonl')
    const store = new ShadowRoutingStore(path)
    expect(store.append({ ...valid, durationMs: -1 })).toBe(false)
    expect(store.read()).toEqual([])
  })

  it('borne le fichier, la fenetre de deduplication et la lecture demandee', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-routing-shadow-bounded-'))
    const path = join(root, 'observations.jsonl')
    const store = new ShadowRoutingStore(path, {
      maxObservations: 3,
      maxStoreBytes: 1_024,
      maxRecordBytes: 512
    })
    for (let index = 0; index < 10; index += 1) {
      expect(store.append({ ...valid, id: `obs-${index}` })).toBe(true)
    }

    expect(store.read(100).map((entry) => entry.id)).toEqual(['obs-7', 'obs-8', 'obs-9'])
    expect(statSync(path).size).toBeLessThanOrEqual(1_024)
    expect(store.stats().knownIds).toBeLessThanOrEqual(3)
  })

  it('lit seulement la queue bornee d un gros historique legacy', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-routing-shadow-tail-'))
    const path = join(root, 'observations.jsonl')
    const lines = Array.from({ length: 10_000 }, (_, index) =>
      JSON.stringify({ ...valid, id: `legacy-${index}` })
    )
    writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
    const store = new ShadowRoutingStore(path, { maxRecordBytes: 512 })

    expect(store.read(1).map((entry) => entry.id)).toEqual(['legacy-9999'])
    expect(store.stats().lastReadBytes).toBeLessThanOrEqual(1_024)
  })
})
