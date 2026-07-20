import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createHermesPromptTraceReader,
  type HermesPreflightTrace
} from './activity/hermes-prompt-trace'

function handlerBody(source: string, channel: string, nextChannel: string): string {
  const start = source.indexOf(`ipcMain.handle('${channel}'`)
  const end = source.indexOf(`ipcMain.handle('${nextChannel}'`, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Hermes prompt trace read contract', () => {
  it('keeps os:hermesPromptTraces free of causal reads and writes', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const body = handlerBody(source, 'os:hermesPromptTraces', 'os:hermesPromptTraceSummary')

    expect(body).not.toContain('causalTrace.readConversation')
    expect(body).not.toContain('causalTrace.nextSequence')
    expect(body).not.toContain('causalTrace.append')
    expect(body).toContain('readHermesPromptTraces')
  })

  it('loads once per invocation without any causal-store dependency', () => {
    let loads = 0
    const fixture = [{ conversationId: 'conv-1' }] as HermesPreflightTrace[]
    const read = createHermesPromptTraceReader(() => {
      loads += 1
      return fixture
    })

    expect(read('conv-1')).toEqual(fixture)
    expect(read('conv-2')).toEqual([])
    expect(loads).toBe(2)
  })

  it('keeps causal trace consultation read-only and migrates legacy data before handlers', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const body = handlerBody(source, 'os:causalTrace', 'os:activity:sessions')

    expect(body).not.toContain('causalTrace.append')
    expect(body).not.toContain('causalTrace.nextSequence')
    expect(source).toContain('migrateLegacyCausalTraces()')
  })
})
