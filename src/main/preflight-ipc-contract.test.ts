import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function handlerBody(source: string, channel: string, nextChannel: string): string {
  const start = source.indexOf(`ipcMain.handle('${channel}'`)
  const end = source.indexOf(`ipcMain.handle('${nextChannel}'`, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('preflight IPC trust contract', () => {
  it('garde le recheck et la lecture courante avant toute dépendance', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const recheck = handlerBody(source, 'preflight:recheck', 'preflight:current')
    const current = handlerBody(source, 'preflight:current', 'os:roles')

    expect(recheck).toContain("assertTrustedRendererSender(event, 'Preflight')")
    expect(recheck.indexOf('assertTrustedRendererSender')).toBeLessThan(
      recheck.indexOf('runAppPreflight')
    )
    expect(current).toContain("assertTrustedRendererSender(event, 'Preflight')")
    expect(current.indexOf('assertTrustedRendererSender')).toBeLessThan(
      current.indexOf('getLastAppPreflightResult')
    )
  })
})
