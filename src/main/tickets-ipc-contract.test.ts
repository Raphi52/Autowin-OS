import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const TICKET_CHANNELS = [
  'tickets:sources',
  'tickets:source:save',
  'tickets:list',
  'tickets:cancel'
] as const

describe('Tickets IPC main contract', () => {
  it('enregistre les quatre handlers consommés par le preload', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

    for (const channel of TICKET_CHANNELS) {
      expect(source, `handler main manquant: ${channel}`).toMatch(
        new RegExp(`ipcMain\\.handle\\(\\s*['"]${channel}['"]`)
      )
    }
  })

  it('relie la liste et l’annulation au même requestId', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const listStart = source.indexOf("ipcMain.handle('tickets:list'")
    const cancelStart = source.indexOf("ipcMain.handle('tickets:cancel'")

    expect(listStart).toBeGreaterThanOrEqual(0)
    expect(cancelStart).toBeGreaterThan(listStart)
    expect(source.slice(listStart, cancelStart)).toContain('requestId')
    expect(source.slice(cancelStart, cancelStart + 800)).toContain('requestId')
  })
})
