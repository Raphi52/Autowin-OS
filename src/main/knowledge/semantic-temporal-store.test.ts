import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { BrainTrace } from '../activity/brain-trace-spool'
import type { TraceEventV1 } from '../activity/trace-event'
import { semanticTemporalProjectionDigest } from './semantic-temporal-projection'
import {
  readSemanticTemporalProjection,
  rebuildSemanticTemporalProjection,
  semanticTemporalProjectionPath
} from './semantic-temporal-store'

const event: TraceEventV1 = {
  schema: 'autowin.trace/v1',
  id: 'evt-1',
  conversationId: 'conv-1',
  turnId: 'turn-1',
  timestamp: '2026-08-08T10:00:00.000Z',
  sequence: 0,
  type: 'gate',
  status: 'completed',
  actor: { id: 'system', kind: 'system', label: 'System' },
  channel: 'internal',
  payloads: [{ kind: 'app-state', content: 'not persisted' }],
  observation: { boundary: 'test', fidelity: 'exact' },
  execution: { runId: 'run-1', phase: 'judge' }
}

describe('semantic temporal projection store', () => {
  it('rebuilds byte-identically and never mutates its source', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-semantic-store-'))
    const brainRoot = mkdtempSync(join(tmpdir(), 'autowin-brain-canonical-'))
    const source = [structuredClone(event)]
    const before = JSON.stringify(source)
    const path = semanticTemporalProjectionPath(base)
    rebuildSemanticTemporalProjection({ events: source }, { base, brainRoot })
    const first = readFileSync(path, 'utf8')
    rmSync(path)
    rebuildSemanticTemporalProjection({ events: source }, { base, brainRoot })

    expect(readFileSync(path, 'utf8')).toBe(first)
    expect(JSON.stringify(source)).toBe(before)
    expect(readSemanticTemporalProjection({ base, brainRoot })?.nodes).toHaveLength(3)
  })

  it('saute la projection identique via une empreinte d entree sans reecrire le fichier', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-semantic-cache-'))
    const brainRoot = mkdtempSync(join(tmpdir(), 'autowin-brain-cache-'))
    const path = semanticTemporalProjectionPath(base)
    rebuildSemanticTemporalProjection({ events: [event] }, { base, brainRoot })
    const cached = JSON.parse(readFileSync(path, 'utf8')) as { inputDigest?: string }
    expect(cached.inputDigest).toMatch(/^[a-f0-9]{64}$/)
    utimesSync(path, new Date(1_000), new Date(1_000))

    rebuildSemanticTemporalProjection({ events: [event] }, { base, brainRoot })

    expect(statSync(path).mtimeMs).toBe(1_000)
  })

  it('reconstruit un cache derive altere qui conserve ses digests', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-semantic-tampered-'))
    const brainRoot = mkdtempSync(join(tmpdir(), 'autowin-brain-tampered-'))
    const path = semanticTemporalProjectionPath(base)
    const original = rebuildSemanticTemporalProjection({ events: [event] }, { base, brainRoot })
    const tampered = JSON.parse(readFileSync(path, 'utf8')) as typeof original
    tampered.nodes[0].label = 'cache altere'
    writeFileSync(path, JSON.stringify(tampered))

    const repaired = rebuildSemanticTemporalProjection({ events: [event] }, { base, brainRoot })

    expect(repaired.nodes.some((node) => node.label === 'cache altere')).toBe(false)
    expect(JSON.parse(readFileSync(path, 'utf8')).nodes).toEqual(original.nodes)
  })

  it('reconstruit un cache forge auto-coherent avec l ancien inputDigest', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-semantic-forged-'))
    const brainRoot = mkdtempSync(join(tmpdir(), 'autowin-brain-forged-'))
    const path = semanticTemporalProjectionPath(base)
    const original = rebuildSemanticTemporalProjection({ events: [event] }, { base, brainRoot })
    const forged = JSON.parse(readFileSync(path, 'utf8')) as typeof original
    forged.nodes[0].label = 'cache forge coherent'
    forged.sourceDigest = semanticTemporalProjectionDigest(forged.nodes, forged.edges)
    writeFileSync(path, JSON.stringify(forged))
    expect(
      readSemanticTemporalProjection({ base, brainRoot })?.nodes.some(
        (node) => node.label === 'cache forge coherent'
      )
    ).toBe(true)

    const repaired = rebuildSemanticTemporalProjection({ events: [event] }, { base, brainRoot })

    expect(repaired.nodes.some((node) => node.label === 'cache forge coherent')).toBe(false)
    expect(JSON.parse(readFileSync(path, 'utf8')).nodes).toEqual(original.nodes)
  })

  it('ne laisse pas un appelant muter la projection mise en cache', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-semantic-immutable-'))
    const brainRoot = mkdtempSync(join(tmpdir(), 'autowin-brain-immutable-'))
    const projection = rebuildSemanticTemporalProjection({ events: [event] }, { base, brainRoot })
    const originalLabel = projection.nodes[0].label

    expect(() => {
      projection.nodes[0].label = 'mutation memoire'
    }).toThrow()
    expect(readSemanticTemporalProjection({ base, brainRoot })?.nodes[0].label).toBe(originalLabel)
    expect(
      rebuildSemanticTemporalProjection({ events: [event] }, { base, brainRoot }).nodes[0].label
    ).toBe(originalLabel)
  })

  it('refuses to materialize inside the canonical Brain root', () => {
    const brainRoot = mkdtempSync(join(tmpdir(), 'autowin-brain-refuse-'))
    expect(() =>
      rebuildSemanticTemporalProjection(
        { events: [event] },
        { base: join(brainRoot, 'derived'), brainRoot }
      )
    ).toThrow(/Brain canonique/)
    expect(existsSync(join(brainRoot, 'derived'))).toBe(false)
  })

  it('refuse une junction qui redirige la projection vers le Brain canonique', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-semantic-junction-'))
    const brainRoot = mkdtempSync(join(tmpdir(), 'autowin-brain-junction-'))
    symlinkSync(brainRoot, join(base, 'semantic-timeline'), 'junction')

    expect(() =>
      rebuildSemanticTemporalProjection({ events: [event] }, { base, brainRoot })
    ).toThrow(/Brain canonique/)
    expect(existsSync(join(brainRoot, 'projection-v1.json'))).toBe(false)
  })

  it('refuse un temporaire prepositionne sans modifier sa cible', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-semantic-temp-link-'))
    const brainRoot = mkdtempSync(join(tmpdir(), 'autowin-brain-temp-link-'))
    const target = join(brainRoot, 'note.md')
    writeFileSync(target, 'brain intact')
    const projectionPath = semanticTemporalProjectionPath(base)
    const temporary = `${projectionPath}.known.tmp`
    mkdirSync(dirname(temporary), { recursive: true })
    linkSync(target, temporary)

    expect(() =>
      rebuildSemanticTemporalProjection(
        { events: [event] },
        { base, brainRoot, temporaryId: () => 'known' }
      )
    ).toThrow()
    expect(readFileSync(target, 'utf8')).toBe('brain intact')
  })

  it.each(['beforeTemporaryOpen', 'afterTemporaryOpen', 'beforePublish'] as const)(
    'refuse une substitution du parent pendant %s',
    (hookName) => {
      const base = mkdtempSync(join(tmpdir(), 'autowin-semantic-parent-race-'))
      const brainRoot = mkdtempSync(join(tmpdir(), 'autowin-brain-parent-race-'))
      const projectionPath = semanticTemporalProjectionPath(base)
      const projectionDirectory = dirname(projectionPath)
      const movedDirectory = `${projectionDirectory}-moved`
      const swapParent = vi.fn(() => {
        renameSync(projectionDirectory, movedDirectory)
        symlinkSync(brainRoot, projectionDirectory, 'junction')
      })

      expect(() =>
        rebuildSemanticTemporalProjection(
          { events: [event] },
          {
            base,
            brainRoot,
            temporaryId: () => 'race',
            testHooks: { [hookName]: swapParent }
          }
        )
      ).toThrow()
      expect(swapParent).toHaveBeenCalledOnce()
      expect(existsSync(join(brainRoot, 'projection-v1.json'))).toBe(false)
      expect(existsSync(join(brainRoot, 'projection-v1.json.race.tmp'))).toBe(false)
    }
  )

  it('materializes the valid subset when a Brain source is structurally corrupt', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-semantic-corrupt-'))
    const brainRoot = mkdtempSync(join(tmpdir(), 'autowin-brain-corrupt-'))
    const valid: BrainTrace = {
      timestamp: '2026-08-08T12:00:00.000Z',
      conversationId: 'conv-valid',
      query: 'private query',
      injectedChars: 12
    }
    const corrupt = {
      ...valid,
      conversationId: 'conv-corrupt',
      timestamp: null
    } as unknown as BrainTrace

    const projection = rebuildSemanticTemporalProjection(
      { events: [], brainTraces: [corrupt, valid] },
      { base, brainRoot }
    )

    expect(projection.nodes.some((node) => node.source.conversationId === 'conv-valid')).toBe(true)
    expect(projection.nodes.some((node) => node.source.conversationId === 'conv-corrupt')).toBe(
      false
    )
    expect(readSemanticTemporalProjection({ base, brainRoot })?.sourceDigest).toBe(
      projection.sourceDigest
    )
  })
})
