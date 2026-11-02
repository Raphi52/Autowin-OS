import { describe, expect, it, vi } from 'vitest'
import {
  buildProviderStatuses,
  presenceStatus,
  probePresenceUnlessStandby,
  probeResultStatus
} from './provider-status'

const NOW = 1_000_000_000_000

describe('presenceStatus (claude au chargement — jamais authenticated)', () => {
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
  it('publie Claude et ChatGPT, en présence, avec testable correct', () => {
    const out = buildProviderStatuses({
      claudeResponds: true,
      codexResponds: true,
      now: NOW
    })
    expect(out).toEqual([
      { provider: 'claude', status: 'installed-untested', testable: true },
      { provider: 'codex', status: 'installed-untested', testable: true }
    ])
  })

  it('ChatGPT non sondé ou absent sort « absent », jamais un statut inventé', () => {
    const out = buildProviderStatuses({ claudeResponds: true, now: NOW })
    expect(out.find((item) => item.provider === 'codex')).toEqual({
      provider: 'codex',
      status: 'absent',
      testable: false
    })
  })

  it('le dernier test réel et la veille de ChatGPT sont les siens, pas ceux de Claude', () => {
    const out = buildProviderStatuses({
      claudeResponds: true,
      codexResponds: true,
      now: NOW,
      states: {
        claude: { mode: 'standby' },
        codex: { mode: 'active', lastProbe: { status: 'authenticated', checkedAt: NOW - 1 } }
      }
    })
    expect(out.map((item) => [item.provider, item.status])).toEqual([
      ['claude', 'standby'],
      ['codex', 'authenticated']
    ])
  })

  it('restaure le dernier probe réel de Claude', () => {
    const statuses = buildProviderStatuses({
      claudeResponds: true,
      now: NOW + 500,
      states: {
        claude: {
          mode: 'active',
          lastProbe: { status: 'authenticated', checkedAt: NOW }
        }
      }
    })

    expect(statuses.find((item) => item.provider === 'claude')).toEqual(
      expect.objectContaining({ status: 'authenticated', testable: true, lastCheckedAt: NOW })
    )
  })

  it('honore le standby de Claude sans lancer de probe', () => {
    const statuses = buildProviderStatuses({
      claudeResponds: true,
      now: NOW,
      states: { claude: { mode: 'standby' } }
    })

    expect(statuses[0]).toEqual(
      expect.objectContaining({ provider: 'claude', status: 'standby', testable: false })
    )
  })

  it('CONTRÔLE NÉGATIF : aucun moteur retiré ne ressort, même avec un état enregistré', () => {
    const statuses = buildProviderStatuses({
      claudeResponds: false,
      now: NOW,
      states: {
        kimi: { mode: 'active', lastProbe: { status: 'authenticated', checkedAt: NOW - 500 } },
        gemini: { mode: 'standby' }
      }
    })

    expect(statuses.map((item) => item.provider)).toEqual(['claude', 'codex'])
  })
})
