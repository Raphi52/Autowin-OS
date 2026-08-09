import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AutoKaizenSupervisor,
  MAX_AUTO_KAIZEN_ARCHIVE_BYTES,
  type AutoKaizenIncident,
  type AutoKaizenRuntime
} from './auto-kaizen-supervisor'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function incident(id: string, updatedAt: number): AutoKaizenIncident {
  return {
    id,
    dedupeKey: `dedupe-${id}`,
    correlationKey: `correlation-${id}`,
    eventKeys: [`event-${id}`],
    rootIncidentId: id,
    depth: 0,
    sourceConversationId: 'source',
    kind: 'test',
    summary: id,
    detail: id,
    status: 'completed',
    occurrenceCount: 1,
    severity: 'warning',
    lastSeenAt: updatedAt,
    detectedAt: updatedAt,
    updatedAt
  }
}

const runtime: AutoKaizenRuntime = {
  createConversation: () => ({ id: 'unused' }),
  appendSourceUpdate: () => undefined,
  runAnalysis: async () => ({ ok: false }),
  runFix: async () => ({ ok: false })
}

describe('retention du ledger Auto-Kaizen', () => {
  it('borne le snapshot chaud, conserve les actifs et archive les terminaux retires', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-kaizen-retention-'))
    roots.push(root)
    const path = join(root, 'incidents.json')
    const terminals = Array.from({ length: 10_000 }, (_, index) =>
      incident(`terminal-${index}`, index)
    )
    const activeRoot = {
      ...incident('active-root-child', 10_001),
      rootIncidentId: 'terminal-0',
      parentIncidentId: 'terminal-0',
      status: 'fix-running' as const
    }
    const activeStandalone = {
      ...incident('active-standalone', 10_002),
      status: 'analysis-running' as const
    }
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 1, incidents: [...terminals, activeRoot, activeStandalone] })
    )

    const supervisor = new AutoKaizenSupervisor({
      path,
      runtime,
      limits: { maxRetainedTerminal: 100 }
    })
    const retained = supervisor.snapshot().incidents

    expect(retained).toHaveLength(102)
    expect(retained.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'active-root-child',
        'active-standalone',
        'terminal-0',
        'terminal-9999'
      ])
    )
    expect(JSON.parse(readFileSync(path, 'utf8')).incidents).toHaveLength(102)
    expect(readFileSync(`${path}.archive.jsonl`, 'utf8').trim().split(/\r?\n/)).toHaveLength(9_900)
    expect(existsSync(`${path}.archive`)).toBe(false)
  })

  it('borne l archive froide sans creer un segment par incident', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-kaizen-bounded-archive-'))
    roots.push(root)
    const path = join(root, 'incidents.json')
    const terminals = Array.from({ length: 240 }, (_, index) => ({
      ...incident(`large-${index}`, index),
      detail: `${index}:` + 'x'.repeat(100_000)
    }))
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, incidents: terminals }))

    new AutoKaizenSupervisor({ path, runtime, limits: { maxRetainedTerminal: 0 } })

    expect(statSync(`${path}.archive.jsonl`).size).toBeLessThanOrEqual(
      MAX_AUTO_KAIZEN_ARCHIVE_BYTES
    )
    expect(existsSync(`${path}.archive`)).toBe(false)
  })

  it('ne duplique pas une archive si la sauvegarde du snapshot doit etre reprise', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-kaizen-archive-retry-'))
    roots.push(root)
    const path = join(root, 'incidents.json')
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 1, incidents: [incident('x', 1), incident('y', 2)] })
    )
    mkdirSync(`${path}.tmp`)

    const load = (): AutoKaizenSupervisor =>
      new AutoKaizenSupervisor({ path, runtime, limits: { maxRetainedTerminal: 0 } })
    expect(load).toThrow()
    expect(load).toThrow()

    const archivedIds = readFileSync(`${path}.archive.jsonl`, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line).id)
    expect(archivedIds).toEqual(['x', 'y'])
  })

  it("conserve en memoire les incidents retires quand l'archivage echoue puis les archive au retry", () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-kaizen-archive-runtime-retry-'))
    roots.push(root)
    const path = join(root, 'incidents.json')
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, incidents: [incident('x', 1)] }))
    let timestamp = 10
    const supervisor = new AutoKaizenSupervisor({
      path,
      runtime,
      now: () => ++timestamp,
      limits: { maxRetainedTerminal: 1 }
    })
    mkdirSync(`${path}.archive.jsonl`)

    expect(() =>
      supervisor.report({
        dedupeKey: 'quota-y',
        sourceConversationId: 'source',
        kind: 'provider-error',
        summary: 'quota exceeded y',
        detail: 'quota exceeded'
      })
    ).toThrow()
    expect(supervisor.snapshot().incidents.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['x', expect.stringMatching(/^ak-/)])
    )

    rmSync(`${path}.archive.jsonl`, { recursive: true, force: true })
    supervisor.report({
      dedupeKey: 'quota-z',
      sourceConversationId: 'source',
      kind: 'provider-error',
      summary: 'quota exceeded z',
      detail: 'quota exceeded'
    })

    const archivedIds = readFileSync(`${path}.archive.jsonl`, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line).id)
    expect(archivedIds).toContain('x')
  })

  it('repersiste et reprend un incident actif quand la meme cle est rejouee apres un echec snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-kaizen-snapshot-runtime-retry-'))
    roots.push(root)
    const path = join(root, 'incidents.json')
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, incidents: [incident('x', 1)] }))
    const supervisor = new AutoKaizenSupervisor({ path, runtime })
    const input = {
      dedupeKey: 'active-retry',
      sourceConversationId: 'source',
      kind: 'execution-failed',
      summary: 'commande en echec',
      detail: 'exit code 1'
    }
    mkdirSync(`${path}.tmp`)

    expect(() => supervisor.report(input)).toThrow()
    const activeId = supervisor
      .snapshot()
      .incidents.find(({ dedupeKey }) => dedupeKey.includes('active-retry'))!.id
    rmSync(`${path}.tmp`, { recursive: true, force: true })

    expect(supervisor.report(input).id).toBe(activeId)
    await supervisor.drain()

    const diskIds = JSON.parse(readFileSync(path, 'utf8')).incidents.map(
      ({ id }: AutoKaizenIncident) => id
    )
    const restartedIds = new AutoKaizenSupervisor({ path, runtime })
      .snapshot()
      .incidents.map(({ id }) => id)
    expect(diskIds).toContain(activeId)
    expect(restartedIds).toContain(activeId)
  })

  it('reprend tous les incidents actifs oublies quand une autre cle repare la persistance', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-kaizen-snapshot-other-key-retry-'))
    roots.push(root)
    const path = join(root, 'incidents.json')
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, incidents: [] }))
    const supervisor = new AutoKaizenSupervisor({ path, runtime })
    const input = (dedupeKey: string) => ({
      dedupeKey,
      sourceConversationId: 'source',
      kind: 'execution-failed',
      summary: `commande en echec ${dedupeKey}`,
      detail: 'exit code 1'
    })
    mkdirSync(`${path}.tmp`)

    expect(() => supervisor.report(input('incident-a'))).toThrow()
    const first = supervisor
      .snapshot()
      .incidents.find(({ dedupeKey }) => dedupeKey.includes('incident-a'))!
    rmSync(`${path}.tmp`, { recursive: true, force: true })

    supervisor.report(input('incident-b'))
    await supervisor.drain()

    const memoryFirst = supervisor.snapshot().incidents.find(({ id }) => id === first.id)
    const restartedFirst = new AutoKaizenSupervisor({ path, runtime })
      .snapshot()
      .incidents.find(({ id }) => id === first.id)
    expect(memoryFirst?.status).toBe('failed')
    expect(restartedFirst?.status).toBe('failed')
  })

  it("n'archive pas deux fois le meme incident quand le lot grandit avant le retry", () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-kaizen-growing-archive-retry-'))
    roots.push(root)
    const path = join(root, 'incidents.json')
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, incidents: [incident('x', 1)] }))
    let timestamp = 10
    const supervisor = new AutoKaizenSupervisor({
      path,
      runtime,
      now: () => ++timestamp,
      limits: { maxRetainedTerminal: 1 }
    })
    const quota = (dedupeKey: string) => ({
      dedupeKey,
      sourceConversationId: 'source',
      kind: 'provider-error',
      summary: `quota exceeded ${dedupeKey}`,
      detail: 'quota exceeded'
    })
    mkdirSync(`${path}.tmp`)

    expect(() => supervisor.report(quota('quota-y'))).toThrow()
    rmSync(`${path}.tmp`, { recursive: true, force: true })
    supervisor.report(quota('quota-z'))

    const archivedIds = readFileSync(`${path}.archive.jsonl`, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line).id)
    expect(archivedIds.filter((id) => id === 'x')).toHaveLength(1)
  })

  it("ignore un temporaire d'archive abandonne par un ancien essai", () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-kaizen-stale-archive-temp-'))
    roots.push(root)
    const path = join(root, 'incidents.json')
    const archived = incident('x', 1)
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, incidents: [archived] }))
    const payload = `${JSON.stringify(archived)}\n`
    const batchId = createHash('sha256').update(payload).digest('hex')
    mkdirSync(`${path}.archive`)
    writeFileSync(join(`${path}.archive`, `${batchId}.jsonl.${process.pid}.tmp`), 'residu')

    expect(
      () => new AutoKaizenSupervisor({ path, runtime, limits: { maxRetainedTerminal: 0 } })
    ).not.toThrow()
    expect(readFileSync(`${path}.archive.jsonl`, 'utf8')).toContain('"id":"x"')
  })
})
