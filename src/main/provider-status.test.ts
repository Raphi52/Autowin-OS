import { describe, expect, it } from 'vitest'
import {
  codexTokenStatus,
  presenceStatus,
  probeResultStatus,
  buildProviderStatuses
} from './provider-status'

const NOW = 1_000_000_000_000

describe('codexTokenStatus (exact, cheap)', () => {
  it('absent si pas de token', () => {
    expect(codexTokenStatus(null, NOW)).toBe('absent')
  })
  it('authenticated si non expiré', () => {
    expect(codexTokenStatus({ obtainedAt: NOW - 1000, expiresInSec: 3600 }, NOW)).toBe('authenticated')
  })
  it('expired si dépassé', () => {
    expect(codexTokenStatus({ obtainedAt: NOW - 7200_000, expiresInSec: 3600 }, NOW)).toBe('expired')
  })
  it('authenticated si aucune expiry déclarée', () => {
    expect(codexTokenStatus({ obtainedAt: NOW }, NOW)).toBe('authenticated')
  })
})

describe('presenceStatus (claude/kimi au chargement — jamais authenticated)', () => {
  it('installed-untested si le CLI répond', () => {
    expect(presenceStatus(true)).toBe('installed-untested')
  })
  it('absent si le CLI ne répond pas', () => {
    expect(presenceStatus(false)).toBe('absent')
  })
  it('ne renvoie JAMAIS authenticated (anti-mensonge)', () => {
    expect(presenceStatus(true)).not.toBe('authenticated')
  })
})

describe('probeResultStatus (test réel à la demande)', () => {
  it('CONTRÔLE NÉGATIF : un probe qui timeout/jette → unknown, JAMAIS authenticated', () => {
    expect(probeResultStatus({ errored: true })).toBe('unknown')
    expect(probeResultStatus({ errored: true, ok: true })).toBe('unknown') // errored prime
  })
  it('expired si le probe révèle une expiration', () => {
    expect(probeResultStatus({ expired: true })).toBe('expired')
  })
  it('authenticated seulement sur un probe réussi', () => {
    expect(probeResultStatus({ ok: true })).toBe('authenticated')
  })
  it('expired si le probe échoue sans être une erreur d’infra', () => {
    expect(probeResultStatus({ ok: false })).toBe('expired')
  })
})

describe('buildProviderStatuses (chargement)', () => {
  it('codex exact + claude/kimi présence, avec testable correct', () => {
    const out = buildProviderStatuses({
      codexTokens: { obtainedAt: NOW - 7200_000, expiresInSec: 3600 }, // expiré
      claudeResponds: true,
      kimiResponds: false,
      now: NOW
    })
    expect(out).toEqual([
      { provider: 'codex', status: 'expired', testable: false },
      { provider: 'claude', status: 'installed-untested', testable: true },
      { provider: 'kimi', status: 'absent', testable: false }
    ])
  })
})
