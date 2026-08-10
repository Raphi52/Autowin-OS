import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function handlerBody(source: string, channel: string, nextChannel?: string): string {
  const start = source.indexOf(`ipcMain.handle('${channel}'`)
  const end = nextChannel
    ? source.indexOf(`ipcMain.handle('${nextChannel}'`, start)
    : source.indexOf('function rendererLocation', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Native prompt trace read contract', () => {
  it('keeps causal trace consultation read-only and migrates legacy data before handlers', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const body = handlerBody(source, 'os:causalTrace')

    expect(body).not.toContain('causalTrace.append')
    expect(body).not.toContain('causalTrace.nextSequence')
    expect(source).toContain('migrateLegacyCausalTraces()')
  })
})
