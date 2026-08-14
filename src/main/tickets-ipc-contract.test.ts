import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const TICKET_CHANNELS = [
  'tickets:sources',
  'tickets:source:save',
  'tickets:list',
  'tickets:get',
  'tickets:update',
  'tickets:cancel',
  'tickets:people'
] as const

describe('Tickets IPC main contract', () => {
  it('enregistre les handlers consommés par le preload', () => {
    const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const ticketSource = readFileSync(new URL('./tickets-ipc.ts', import.meta.url), 'utf8')

    for (const channel of TICKET_CHANNELS) {
      const source = channel === 'tickets:people' ? mainSource : ticketSource
      const registrar = channel === 'tickets:people' ? 'ipcMain' : 'ipc'
      expect(source, `handler main manquant: ${channel}`).toMatch(
        new RegExp(`${registrar}\\.handle\\(\\s*['"]${channel}['"]`)
      )
    }
  })

  it('relie la liste et l’annulation au même requestId', () => {
    const source = readFileSync(new URL('./tickets-ipc.ts', import.meta.url), 'utf8')
    const listStart = source.indexOf("ipc.handle('tickets:list'")
    const cancelStart = source.indexOf("ipc.handle('tickets:cancel'")

    expect(listStart).toBeGreaterThanOrEqual(0)
    expect(cancelStart).toBeGreaterThan(listStart)
    expect(source.slice(listStart, cancelStart)).toContain('requestId')
    expect(source.slice(cancelStart, cancelStart + 800)).toContain('requestId')
  })
})
