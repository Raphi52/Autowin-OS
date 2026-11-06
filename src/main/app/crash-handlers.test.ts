import { describe, it, expect } from 'vitest'
import { formatCrashLine, makeCrashHandlers, redactSecrets } from './crash-handlers'

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

  it('invoque onFatal après le log (récupération best-effort) sans propager si elle jette', () => {
    let called = 0
    const h = makeCrashHandlers({
      logDir: 'C:\\nope',
      sink: () => {},
      now: NOW,
      onFatal: () => {
        called++
        throw new Error('onFatal cassé')
      }
    })
    expect(() => h.onUncaughtException(new Error('x'))).not.toThrow()
    expect(called).toBe(1)
  })

  it('inviolable sur une valeur CIRCULAIRE (JSON.stringify throw) — le handler ne propage pas', () => {
    // Régression Corrector #1 : formatCrashLine était hors du try → une rejection circulaire crashait.
    const logged: string[] = []
    const h = makeCrashHandlers({ logDir: 'C:\\nope', sink: (l) => logged.push(l), now: NOW })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => h.onUnhandledRejection(circular)).not.toThrow()
    expect(logged[0]).toContain('[Circular]')
  })

  it('redacte les secrets courants avant écriture (crash.log)', () => {
    expect(redactSecrets('Authorization: Bearer sk-abc123XYZ')).not.toContain('sk-abc123XYZ')
    expect(redactSecrets('token=supersecret')).not.toContain('supersecret')
    expect(redactSecrets('https://user:p@ss@host')).toContain('***')
    const line = formatCrashLine('uncaughtException', new Error('leak Bearer sk-zzz'), NOW)
    expect(line).not.toContain('sk-zzz')
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
