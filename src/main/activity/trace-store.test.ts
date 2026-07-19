import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { TraceStore } from './trace-store'
import type { TraceEventV1 } from './trace-event'

function event(id: string, sequence: number, content = id): TraceEventV1 {
  return {
    schema: 'autowin.trace/v1',
    id,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    parentId: sequence ? `evt-${sequence - 1}` : undefined,
    timestamp: new Date(1_000 + sequence).toISOString(),
    sequence,
    type: 'message',
    status: 'completed',
    actor: { id: 'human', kind: 'human', label: 'Vous' },
    recipient: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
    channel: 'user',
    payloads: [{ kind: 'user-message', content }],
    observation: { boundary: 'renderer', fidelity: 'exact' }
  }
}

describe('TraceStore append-only', () => {
  it('persiste et relit dans l’ordre après une nouvelle instance', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-'))
    new TraceStore(root).append(event('evt-0', 0)).append(event('evt-1', 1, 'x'.repeat(12_000)))

    const reloaded = new TraceStore(root).readConversation('conv-1')
    expect(reloaded.map((item) => item.id)).toEqual(['evt-0', 'evt-1'])
    expect(reloaded[1].payloads[0].content).toHaveLength(12_000)
    expect(readFileSync(join(root, 'conv-1.jsonl'), 'utf8').split('\n').filter(Boolean)).toHaveLength(2)
  })

  it('refuse un identifiant dupliqué sans modifier le journal', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-'))
    const store = new TraceStore(root).append(event('evt-0', 0))
    expect(() => store.append(event('evt-0', 0))).toThrow(/dupliqué/)
    expect(store.readConversation('conv-1')).toHaveLength(1)
  })

  it('refuse une sequence non monotone et un parent orphelin', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-integrity-'))
    const store = new TraceStore(root).append(event('evt-0', 0))
    expect(() => store.append({ ...event('evt-other', 0), parentId: undefined })).toThrow(/sequence non monotone/)
    expect(() => store.append({ ...event('evt-1', 1), parentId: 'absent' })).toThrow(/parent causal introuvable/)
    expect(store.readConversation('conv-1')).toHaveLength(1)
  })

  it('exporte, importe et supprime explicitement une conversation', () => {
    const source = mkdtempSync(join(tmpdir(), 'autowin-trace-source-'))
    const target = mkdtempSync(join(tmpdir(), 'autowin-trace-target-'))
    const exported = new TraceStore(source).append(event('evt-0', 0)).exportConversation('conv-1')
    const imported = new TraceStore(target)
    imported.importConversation(exported)
    expect(imported.readConversation('conv-1')).toEqual([event('evt-0', 0)])
    expect(imported.deleteConversation('conv-1')).toBe(true)
    expect(imported.readConversation('conv-1')).toEqual([])
  })

  it('ignore une dernière ligne incomplète après crash mais pas un événement invalide', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-'))
    const store = new TraceStore(root).append(event('evt-0', 0))
    appendFileSync(join(root, 'conv-1.jsonl'), '{"schema":"autowin.trace/v1"', 'utf8')
    expect(store.readConversation('conv-1')).toEqual([event('evt-0', 0)])
  })
  it('signale une corruption au milieu du journal au lieu de supprimer une etape', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-corrupt-'))
    const path = join(root, 'conv-1.jsonl')
    appendFileSync(path, `${JSON.stringify(event('evt-0', 0))}\n{invalide}\n${JSON.stringify(event('evt-1', 1))}\n`, 'utf8')
    expect(() => new TraceStore(root).readConversation('conv-1')).toThrow(/trace corrompue ligne 2/)
  })
  it('absorbe 1 000 evenements sans bloquer une interaction', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-volume-'))
    const store = new TraceStore(root)
    const durations: number[] = []

    for (let index = 0; index < 1_000; index += 1) {
      const startedAt = performance.now()
      store.append(event(`evt-${index}`, index, `payload-${index}`))
      durations.push(performance.now() - startedAt)
    }

    durations.sort((a, b) => a - b)
    const p95 = durations[Math.floor(durations.length * 0.95)]
    const readStartedAt = performance.now()
    const reloaded = new TraceStore(root).readConversation('conv-1')
    const readDuration = performance.now() - readStartedAt

    expect(reloaded).toHaveLength(1_000)
    expect(reloaded[999].payloads[0].content).toBe('payload-999')
    expect(p95).toBeLessThan(50)
    expect(readDuration).toBeLessThan(100)
  })

  it('conserve un payload exact de 10 Mo', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-large-'))
    const payload = 'x'.repeat(10 * 1024 * 1024)
    const store = new TraceStore(root).append(event('evt-0', 0, payload))

    expect(store.readConversation('conv-1')[0].payloads[0].content).toBe(payload)
  })
  it('reprend la prochaine sequence apres reouverture', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-trace-next-'))
    new TraceStore(root).append({ ...event('evt-0', 7), parentId: undefined })
    expect(new TraceStore(root).nextSequence('conv-1')).toBe(8)
  })
})
