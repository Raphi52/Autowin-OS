import { describe, it, expect } from 'vitest'
import { formatCrashLine, makeCrashHandlers } from './crash-handlers'

const NOW = () => '2026-07-22T00:00:00.000Z'

describe('formatCrashLine', () => {
  it('inclut horodatage, kind, message et stack pour une Error', () => {
    const line = formatCrashLine('uncaughtException', new Error('boom'), NOW)
    expect(line).toContain('[2026-07-22T00:00:00.000Z]')
    expect(line).toContain('uncaughtException: boom')
    expect(line).toMatch(/Error: boom/) // stack
  })
  it('sérialise une valeur rejetée non-Error', () => {
    expect(formatCrashLine('unhandledRejection', { code: 42 }, NOW)).toContain('{"code":42}')
    expect(formatCrashLine('unhandledRejection', 'str', NOW)).toContain('unhandledRejection: str')
  })
})

describe('makeCrashHandlers (le process SURVIT)', () => {
  it('loggue au lieu de relancer : le handler ne throw JAMAIS', () => {
    const logged: string[] = []
    const h = makeCrashHandlers({ logDir: 'C:\\nope', sink: (l) => logged.push(l), now: NOW })
    // Simule une exception non-catchée + une rejection non gérée.
    expect(() => h.onUncaughtException(new Error('crash1'))).not.toThrow()
    expect(() => h.onUnhandledRejection('rejet2')).not.toThrow()
    expect(logged).toHaveLength(2)
    expect(logged[0]).toContain('uncaughtException: crash1')
    expect(logged[1]).toContain('unhandledRejection: rejet2')
  })

  it('inviolable : même un sink qui throw ne fait PAS propager (le process survit)', () => {
    const h = makeCrashHandlers({
      logDir: 'C:\\nope',
      sink: () => {
        throw new Error('sink cassé')
      },
      now: NOW
    })
    // Contrat dur : le handler global ne doit JAMAIS relancer, sinon il tuerait le process protégé.
    expect(() => h.onUncaughtException(new Error('x'))).not.toThrow()
    expect(() => h.onUnhandledRejection('y')).not.toThrow()
  })
})
