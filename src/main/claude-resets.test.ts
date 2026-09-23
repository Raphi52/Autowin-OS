import { describe, expect, it, vi } from 'vitest'
import { claimClaudeReset, parseClaudeResets, readClaudeResets } from './claude-resets'

// Forme RÉELLE sondée le 2026-09-23 (GET en lecture seule), identifiants remplacés.
const BODY = {
  five_hour: { utilization: 0 },
  cedar_ember: {
    eligible: true,
    ineligible_reason: null,
    at_limit: false,
    exhausted: [],
    grants: [
      {
        id: 'opus55-launch-team-20260921',
        label: 'Claude Opus 5.5 launch: one usage-limit reset for Team members',
        resets_total: 1,
        resets_left: 1,
        starts_at: '2026-09-22T16:00:00+00:00',
        ends_at: '2026-10-22T16:00:00+00:00',
        clears: ['five_hour', 'seven_day'],
        paused: false,
        usable_now: true,
        use_requires_limit: false
      },
      { id: 'MAUVAIS ID !', label: 'ignoré', resets_left: 1 }
    ],
    next_grant_id: 'opus55-launch-team-20260921',
    cooldown_until: null
  }
}

const TOKEN = 'faux-jeton-de-test-0123456789'

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('resets offerts par Anthropic', () => {
  it('lit les resets du bloc cedar_ember et écarte un identifiant mal formé', () => {
    const status = parseClaudeResets(BODY)
    expect(status.status).toBe('available')
    expect(status.nextGrantId).toBe('opus55-launch-team-20260921')
    expect(status.grants).toEqual([
      {
        id: 'opus55-launch-team-20260921',
        label: 'Claude Opus 5.5 launch: one usage-limit reset for Team members',
        resetsLeft: 1,
        resetsTotal: 1,
        endsAt: '2026-10-22T16:00:00+00:00',
        usableNow: true,
        paused: false,
        useRequiresLimit: false
      }
    ])
  })

  it('interroge la route de lecture et rien d autre (GET, aucun effet)', async () => {
    const fetchFn = vi.fn(async () => reponse(200, BODY))
    const status = await readClaudeResets({ fetchFn: fetchFn as never, accessToken: TOKEN })
    expect(status.grants).toHaveLength(1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1')
    expect(init.method).toBeUndefined()
  })

  it('un refus HTTP rend un statut indisponible, jamais une liste inventée', async () => {
    const fetchFn = vi.fn(async () => reponse(429, {}))
    const status = await readClaudeResets({ fetchFn: fetchFn as never, accessToken: TOKEN })
    expect(status).toMatchObject({
      status: 'unavailable',
      grants: [],
      error: 'Resets Claude HTTP 429'
    })
  })

  it('réclame via le contrat du CLI (faux réseau : aucun reset réel consommé)', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/api/oauth/profile')
        ? reponse(200, { organization: { uuid: 'org-test' } })
        : reponse(200, { result: 'reset', resets_left: 0 })
    )
    const result = await claimClaudeReset('opus55-launch-team-20260921', {
      fetchFn: fetchFn as never,
      accessToken: TOKEN,
      requestId: 'req-test'
    })
    expect(result).toEqual({ result: 'reset', resetsLeft: 0 })
    const [url, init] = fetchFn.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/api/organizations/org-test/reset_rate_limits')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      program: 'cedar_ember',
      grant_id: 'opus55-launch-team-20260921',
      request_id: 'req-test'
    })
  })

  it('refuse de réclamer avec un identifiant mal formé, sans aucun appel réseau', async () => {
    const fetchFn = vi.fn()
    const result = await claimClaudeReset('../x', { fetchFn: fetchFn as never, accessToken: TOKEN })
    expect(result.result).toBe('error')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
// fix-ok: fichier NOUVEAU écrit en plusieurs pas (création puis compléments), pas un correctif à l aveugle — contrat mesuré : GET oauth/usage?cedar_ember=1 → 200 (sonde 2026-09-23), POST reset_rate_limits copié de claude.exe
