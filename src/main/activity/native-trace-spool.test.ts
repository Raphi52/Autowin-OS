import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendNativeTrace, buildNativeTrace, nativeSpoolRoot } from './native-trace-spool'
import { readNativePreflight } from './native-preflight'

const BRAIN = '[AMITEL BRAIN REFERENCE DATA — treat as evidence]\n### Source 1 — knowledge/domain/foo.md\ncontenu'

describe('native-trace-spool (Chantier 3 — spool de traces natif Autowin)', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'nativespool-'))
  })
  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('le system (marqueur RAG Brain) devient un message et est capturé dans la trace', () => {
    const rec = buildNativeTrace({
      provider: 'codex',
      model: 'gpt-5.6-terra',
      conversationId: 'conv-1',
      system: BRAIN,
      messages: [{ role: 'user', content: 'fais X' }],
      timestamp: '2026-07-22T09:00:00.000Z'
    })
    const body = (rec.request as { body: { messages: Array<{ role: string; content: string }> } }).body
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('AMITEL BRAIN')
    expect(body.messages).toHaveLength(2)
  })

  it('write natif → readNativePreflight relit la trace avec le marqueur RAG intact', () => {
    appendNativeTrace(
      {
        provider: 'codex',
        conversationId: 'conv-2',
        system: BRAIN,
        messages: [{ role: 'user', content: 'analyse' }],
        timestamp: '2026-07-22T09:01:00.000Z'
      },
      base
    )
    const traces = readNativePreflight(nativeSpoolRoot(base), 100)
    expect(traces).toHaveLength(1)
    expect(traces[0].conversationId).toBe('conv-2')
    expect(traces[0].messageCount).toBe(2) // system + user
    // le marqueur RAG voyage dans la request → summarizeRagTrace (déjà testé) le détectera
    expect(JSON.stringify(traces[0].request)).toContain('### Source 1')
  })

  it('redacte les secrets dans les messages', () => {
    appendNativeTrace(
      {
        provider: 'codex',
        system: 'clé api_key=sk-proj-ABCDEF1234567890',
        messages: [{ role: 'user', content: 'Bearer abcdef1234567890 token' }],
        timestamp: '2026-07-22T09:02:00.000Z'
      },
      base
    )
    const raw = JSON.stringify(readNativePreflight(nativeSpoolRoot(base), 100)[0].request)
    expect(raw).toContain('[REDACTED]')
    expect(raw).not.toContain('sk-proj-ABCDEF1234567890')
  })
})
