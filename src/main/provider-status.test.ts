import { describe, expect, it, vi } from 'vitest'
import {
  buildProviderStatuses,
  codexTokenStatus,
  presenceStatus,
  probePresenceUnlessStandby,
  probeResultStatus,
  runStartupProviderProbes
} from './provider-status'

const NOW = 1_000_000_000_000

describe('codexTokenStatus (exact, cheap)', () => {
  it('absent si pas de token', () => {
    expect(codexTokenStatus(null, NOW)).toBe('absent')
  })
  it('authenticated si non expiré', () => {
    expect(codexTokenStatus({ obtainedAt: NOW - 1000, expiresInSec: 3600 }, NOW)).toBe(
      'authenticated'
    )
  })
  it('expired si dépassé', () => {
    expect(codexTokenStatus({ obtainedAt: NOW - 7200_000, expiresInSec: 3600 }, NOW)).toBe(
      'expired'
    )
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

describe('standby provider', () => {
  it('ne lance aucun probe pour un provider en standby', async () => {
    const probe = vi.fn(async () => true)

    expect(await probePresenceUnlessStandby({ mode: 'standby' }, probe)).toBe(false)
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('probeResultStatus (test réel à la demande)', () => {
  it('CONTRÔLE NÉGATIF : un probe qui timeout/jette → unknown, JAMAIS authenticated', () => {
    expect(probeResultStatus({ errored: true })).toBe('unknown')
    expect(probeResultStatus({ errored: true, ok: true })).toBe('unknown')
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
      codexTokens: { obtainedAt: NOW - 7200_000, expiresInSec: 3600 },
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

  it('restaure le dernier probe réel et distingue Kimi standby d’une erreur', () => {
    const statuses = buildProviderStatuses({
      codexTokens: null,
      claudeResponds: true,
      kimiResponds: false,
      now: NOW + 500,
      states: {
        claude: {
          mode: 'active',
          lastProbe: { status: 'authenticated', checkedAt: NOW }
        },
        kimi: { mode: 'standby' }
      }
    })

    expect(statuses.find((item) => item.provider === 'claude')).toEqual(
      expect.objectContaining({ status: 'authenticated', testable: true, lastCheckedAt: NOW })
    )
    expect(statuses.find((item) => item.provider === 'kimi')).toEqual(
      expect.objectContaining({ status: 'standby', testable: false })
    )
  })

  it('fait prévaloir un probe Codex frais sur le token local', () => {
    const unknown = buildProviderStatuses({
      codexTokens: { obtainedAt: NOW - 1000, expiresInSec: 3600 },
      claudeResponds: false,
      kimiResponds: false,
      now: NOW,
      states: {
        codex: { mode: 'active', lastProbe: { status: 'unknown', checkedAt: NOW - 500 } }
      }
    })
    const recovered = buildProviderStatuses({
      codexTokens: { obtainedAt: NOW - 7200_000, expiresInSec: 3600 },
      claudeResponds: false,
      kimiResponds: false,
      now: NOW,
      states: {
        codex: { mode: 'active', lastProbe: { status: 'authenticated', checkedAt: NOW - 500 } }
      }
    })

    expect(unknown[0]).toEqual(
      expect.objectContaining({ status: 'unknown', lastCheckedAt: NOW - 500 })
    )
    expect(recovered[0]).toEqual(
      expect.objectContaining({ status: 'authenticated', lastCheckedAt: NOW - 500 })
    )
  })

  it('ignore un ancien probe Codex au profit de l’expiration locale', () => {
    const statuses = buildProviderStatuses({
      codexTokens: { obtainedAt: NOW - 7200_000, expiresInSec: 3600 },
      claudeResponds: false,
      kimiResponds: false,
      now: NOW,
      states: {
        codex: {
          mode: 'active',
          lastProbe: { status: 'authenticated', checkedAt: NOW - 120_000 }
        }
      }
    })

    expect(statuses[0]).toEqual({ provider: 'codex', status: 'expired', testable: false })
  })
})

describe('startup provider probes', () => {
  it('teste tous les providers actifs en parallèle et ignore ceux en standby', async () => {
    const pending = new Map<string, () => void>()
    const probe = vi.fn(
      (provider: string) =>
        new Promise<void>((resolve) => {
          pending.set(provider, resolve)
        })
    )

    const batch = runStartupProviderProbes(
      ['codex', 'claude', 'kimi'],
      (provider) => ({ mode: provider === 'kimi' ? 'standby' : 'active' }),
      probe
    )

    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2))
    expect(probe.mock.calls.map(([provider]) => provider).sort()).toEqual(['claude', 'codex'])
    pending.get('claude')?.()
    pending.get('codex')?.()
    await batch
  })

  it('isole l’échec d’un provider pour tester les autres', async () => {
    let finishCodex!: () => void
    let failClaude!: (error: Error) => void
    const codex = new Promise<void>((resolve) => {
      finishCodex = resolve
    })
    const claude = new Promise<void>((_resolve, reject) => {
      failClaude = reject
    })
    const probe = vi.fn((provider: string) => (provider === 'codex' ? codex : claude))
    let settled = false

    const batch = runStartupProviderProbes(
      ['codex', 'claude'],
      () => ({ mode: 'active' }),
      probe
    ).then(() => {
      settled = true
    })
    failClaude(new Error('hors ligne'))
    await Promise.resolve()

    expect(settled).toBe(false)
    finishCodex()
    await expect(batch).resolves.toBeUndefined()
    expect(probe).toHaveBeenCalledTimes(2)
  })
})
