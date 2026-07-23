import { describe, expect, it } from 'vitest'
import { HookBus } from './hook-bus'

describe('HookBus', () => {
  it('exécute les handlers d’un event et agrège les blocages', async () => {
    const bus = new HookBus()
    bus.register('pre-green', () => ({ block: false }))
    bus.register('pre-green', () => ({ block: true, reason: 'vérif échouée' }))
    const out = await bus.run('pre-green', { task: 't' })
    expect(out.blocked).toBe(true)
    expect(out.reasons).toContain('vérif échouée')
  })

  it('aucun blocage → outcome vert', async () => {
    const bus = new HookBus()
    bus.register('pre-green', () => ({ block: false }))
    const out = await bus.run('pre-green', { task: 't' })
    expect(out).toEqual({ blocked: false, reasons: [] })
  })

  it('event sans handler → vert (rétrocompat)', async () => {
    const out = await new HookBus().run('post-exec', { task: 't' })
    expect(out.blocked).toBe(false)
  })

  it('fail-closed : un handler qui jette BLOQUE (jamais avalé)', async () => {
    const bus = new HookBus()
    bus.register('pre-green', () => {
      throw new Error('boom')
    })
    const out = await bus.run('pre-green', { task: 't' })
    expect(out.blocked).toBe(true)
    expect(out.reasons[0]).toContain('boom')
  })

  it('supporte les handlers async', async () => {
    const bus = new HookBus()
    bus.register('pre-green', async () => ({ block: true, reason: 'async deny' }))
    const out = await bus.run('pre-green', { task: 't' })
    expect(out.blocked).toBe(true)
    expect(out.reasons).toEqual(['async deny'])
  })
})
