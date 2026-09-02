import { describe, expect, it } from 'vitest'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'

function handlerBody(source: string, channel: string, nextChannel?: string): string {
  const start = source.indexOf(`ipcMain.handle('${channel}'`)
  // Borne de fin ROBUSTE : le canal suivant, quel qu'il soit. L'ancien repere
  // (`function rendererLocation`) a quitte `index.ts` pour `window.ts` le 2026-09-02 et
  // rendait ce contrat rouge sans qu'aucun cablage n'ait change.
  const end = nextChannel
    ? source.indexOf(`ipcMain.handle('${nextChannel}'`, start)
    : source.indexOf('ipcMain.handle(', start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Native prompt trace read contract', () => {
  it('keeps causal trace consultation read-only and migrates legacy data before handlers', () => {
    const source = sourceProcessPrincipal()
    const body = handlerBody(source, 'os:causalTrace')

    expect(body).not.toContain('causalTrace.append')
    expect(body).not.toContain('causalTrace.nextSequence')
    expect(source).toContain('migrateLegacyCausalTraces()')
  })
})
