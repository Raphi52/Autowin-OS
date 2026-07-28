import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildModelQuotaSnapshot,
  getModelQuotaSnapshot,
  parseClaudeUsage,
  parseLatestCodexRateLimits,
  parseLatestCodexRateLimitSample, aggregateClaudeLocalUsage, parseClaudeRateLimitHeaders, parseClaudePlanUsageHistory } from './model-quotas'

const temporaryHomes: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const path of temporaryHomes.splice(0)) rmSync(path, { recursive: true, force: true })
})

const models = [
  {
    id: 'claude/opus',
    provider: 'claude',
    model: 'opus',
    label: 'Claude Opus',
    reasoningEfforts: ['high' as const],
    defaultReasoningEffort: 'high' as const
  },
  {
    id: 'claude/haiku',
    provider: 'claude',
    model: 'haiku',
    label: 'Claude Haiku',
    reasoningEfforts: ['medium' as const],
    defaultReasoningEffort: 'medium' as const
  },
  {
    id: 'codex/terra',
    provider: 'codex',
    model: 'terra',
    label: 'GPT Terra',
    reasoningEfforts: ['medium' as const],
    defaultReasoningEffort: 'medium' as const
  },
  {
    id: 'kimi/code',
    provider: 'kimi',
    model: 'code',
    label: 'Kimi Code',
    reasoningEfforts: ['none' as const],
    defaultReasoningEffort: 'none' as const
  }
]

describe('quotas modèles', () => {
  it('normalise les fenêtres Claude réellement exposées', () => {
    expect(
      parseClaudeUsage({
        five_hour: { utilization: 72, resets_at: '2026-07-24T05:00:00Z' },
        seven_day: { utilization: 31, resets_at: '2026-07-28T00:00:00Z' },
        seven_day_opus: { utilization: 84, resets_at: '2026-07-27T00:00:00Z' },
        seven_day_haiku: { utilization: 44, resets_at: '2026-07-29T00:00:00Z' },
        workspace_monthly: { utilization: 91, resets_at: '2026-08-01T00:00:00Z' },
        extra_usage: { utilization: 4, monthly_limit: 100 }
      })
    ).toEqual([
      {
        id: 'five-hour',
        label: '5 h',
        usedPercent: 72,
        remainingPercent: 28,
        resetsAt: '2026-07-24T05:00:00.000Z'
      },
      {
        id: 'seven-day',
        label: '7 j',
        usedPercent: 31,
        remainingPercent: 69,
        resetsAt: '2026-07-28T00:00:00.000Z'
      },
      {
        id: 'seven-day-opus',
        label: 'Opus · 7 j',
        usedPercent: 84,
        remainingPercent: 16,
        resetsAt: '2026-07-27T00:00:00.000Z',
        modelFamily: 'opus'
      },
      {
        id: 'seven-day-haiku',
        label: 'Haiku · 7 j',
        usedPercent: 44,
        remainingPercent: 56,
        resetsAt: '2026-07-29T00:00:00.000Z',
        modelFamily: 'haiku'
      },
      {
        id: 'workspace-monthly',
        label: 'Workspace monthly',
        usedPercent: 91,
        remainingPercent: 9,
        resetsAt: '2026-08-01T00:00:00.000Z'
      }
    ])
  })

  it('prend le dernier événement Codex non nul et classe ses fenêtres', () => {
    const jsonl = [
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'token_count', rate_limits: null }
      }),
      'ligne invalide',
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 12, window_minutes: 300, resets_at: 1784870000 },
            secondary: { used_percent: 47, window_minutes: 10080, resets_at: 1785261742 }
          }
        }
      })
    ].join('\n')

    expect(parseLatestCodexRateLimits(jsonl)).toEqual([
      expect.objectContaining({ id: 'five-hour', label: '5 h', remainingPercent: 88 }),
      expect.objectContaining({ id: 'seven-day', label: '7 j', remainingPercent: 53 })
    ])
  })

  it('conserve l’horodatage réel du dernier événement Codex', () => {
    expect(
      parseLatestCodexRateLimitSample(
        JSON.stringify({
          timestamp: '2026-07-23T18:00:00Z',
          payload: {
            type: 'token_count',
            rate_limits: {
              primary: { used_percent: 12, window_minutes: 300, resets_at: 1784870000 }
            }
          }
        })
      )
    ).toMatchObject({
      observedAt: '2026-07-23T18:00:00.000Z',
      windows: [expect.objectContaining({ remainingPercent: 88 })]
    })
  })

  it('liste tous les modèles, explicite le partage et conserve les providers sans métrique', () => {
    const snapshot = buildModelQuotaSnapshot(
      models,
      {
        claude: {
          status: 'available',
          source: 'Claude /usage',
          windows: [
            {
              id: 'five-hour',
              label: '5 h',
              usedPercent: 72,
              remainingPercent: 28,
              resetsAt: '2026-07-24T05:00:00.000Z'
            }
          ]
        },
        codex: {
          status: 'available',
          source: 'Codex local',
          windows: [
            {
              id: 'seven-day',
              label: '7 j',
              usedPercent: 47,
              remainingPercent: 53,
              resetsAt: '2026-07-28T00:00:00.000Z'
            }
          ]
        }
      },
      '2026-07-24T01:00:00.000Z'
    )

    expect(snapshot.models).toHaveLength(4)
    expect(snapshot.models.filter((model) => model.provider === 'claude')).toHaveLength(2)
    expect(snapshot.models.find((model) => model.provider === 'kimi')).toMatchObject({
      status: 'unavailable',
      windows: []
    })
    expect(snapshot.summary).toEqual({ remainingPercent: 28, status: 'warning' })
  })

  it('résume la fenêtre courte dans la wheel même si le weekly est plus bas', () => {
    const snapshot = buildModelQuotaSnapshot(models, {
      claude: {
        status: 'available',
        source: 'Claude /usage',
        windows: [
          {
            id: 'five-hour',
            label: '5 h',
            usedPercent: 36,
            remainingPercent: 64
          },
          {
            id: 'seven-day',
            label: '7 j',
            usedPercent: 82,
            remainingPercent: 18
          }
        ]
      }
    })

    expect(snapshot.summary).toEqual({ remainingPercent: 64, status: 'healthy' })
  })

  it('n’applique une future fenêtre Claude spécifique qu’à sa famille de modèle', () => {
    const windows = parseClaudeUsage({
      five_hour: { utilization: 10, resets_at: '2026-07-24T05:00:00Z' },
      seven_day_haiku: { utilization: 90, resets_at: '2026-07-29T00:00:00Z' }
    })
    const snapshot = buildModelQuotaSnapshot(models, {
      claude: { status: 'available', source: 'Claude /usage', windows }
    })

    expect(snapshot.models.find((model) => model.model === 'haiku')?.windows).toHaveLength(2)
    expect(snapshot.models.find((model) => model.model === 'opus')?.windows).toHaveLength(1)
  })

  it('lit les deux sources côté main sans renvoyer le jeton Claude au renderer', async () => {
    const home = mkdtempSync(join(tmpdir(), 'autowin-model-quotas-'))
    temporaryHomes.push(home)
    mkdirSync(join(home, '.claude'), { recursive: true })
    mkdirSync(join(home, '.codex', 'sessions', '2026', '07', '24'), { recursive: true })
    const token = 'secret-token-that-must-stay-main-only'
    writeFileSync(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: token } })
    )
    writeFileSync(
      join(home, '.codex', 'sessions', '2026', '07', '24', 'rollout-fixture.jsonl'),
      JSON.stringify({
        timestamp: '2026-07-24T00:59:00Z',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 20, window_minutes: 300, resets_at: 1784870000 }
          }
        }
      })
    )
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`)
      // Le quota Claude vient des EN-TÊTES d'un appel /v1/messages accepté (fraction, pas un %).
      return new Response('{}', {
        headers: {
          'anthropic-ratelimit-unified-5h-utilization': '0.25',
          'anthropic-ratelimit-unified-5h-reset': String(Date.parse('2026-07-24T05:00:00Z') / 1000)
        }
      })
    })

    const snapshot = await getModelQuotaSnapshot(models, {
      home,
      fetchFn,
      force: true,
      now: Date.parse('2026-07-24T01:00:00Z')
    })

    expect(fetchFn).toHaveBeenCalledOnce()
    expect(snapshot.models.find((model) => model.provider === 'claude')?.status).toBe('available')
    expect(snapshot.models.find((model) => model.provider === 'codex')?.status).toBe('available')
    expect(JSON.stringify(snapshot)).not.toContain(token)
    expect(JSON.stringify(snapshot)).not.toContain(home)
  })

  it('neutralise les chemins système lorsque les sources locales sont absentes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'autowin-model-quotas-missing-'))
    temporaryHomes.push(home)

    const snapshot = await getModelQuotaSnapshot(models, {
      home,
      fetchFn: vi.fn(),
      force: true,
      now: Date.parse('2026-07-24T01:00:00Z')
    })

    expect(JSON.stringify(snapshot)).not.toContain(home)
    expect(snapshot.models.find((model) => model.provider === 'codex')?.error).toBe(
      'Quota Codex indisponible'
    )
  })

  it('marque comme ancienne une mesure Codex dont l’événement date de plus de 15 minutes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'autowin-model-quotas-stale-'))
    temporaryHomes.push(home)
    const sessions = join(home, '.codex', 'sessions')
    mkdirSync(sessions, { recursive: true })
    writeFileSync(
      join(sessions, 'rollout-stale.jsonl'),
      JSON.stringify({
        timestamp: '2026-07-23T22:00:00Z',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 20, window_minutes: 300, resets_at: 1784870000 }
          }
        }
      })
    )

    const snapshot = await getModelQuotaSnapshot(models, {
      home,
      fetchFn: vi.fn(),
      force: true,
      now: Date.parse('2026-07-24T01:00:00Z')
    })

    expect(snapshot.models.find((model) => model.provider === 'codex')).toMatchObject({
      status: 'stale',
      observedAt: '2026-07-23T22:00:00.000Z'
    })
    expect(snapshot.summary).toEqual({ status: 'unknown' })
  })

  it('empêche une collecte ancienne de remplacer une collecte forcée plus récente', async () => {
    const home = mkdtempSync(join(tmpdir(), 'autowin-model-quotas-race-'))
    temporaryHomes.push(home)
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(
      join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'race-token-long-enough-for-the-test' } })
    )
    let resolveOld!: (value: Response) => void
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve
    })
    const fetchFn = vi
      .fn()
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValueOnce(
        new Response('{}', {
          headers: {
            'anthropic-ratelimit-unified-5h-utilization': '1',
            'anthropic-ratelimit-unified-5h-reset': String(Date.parse('2026-07-28T10:30:00Z') / 1000)
          }
        })
      )
    const now = Date.parse('2026-07-28T10:15:00Z')
    const oldCollection = getModelQuotaSnapshot(models, { home, fetchFn, force: true, now })
    const freshCollection = getModelQuotaSnapshot(models, { home, fetchFn, force: true, now: now + 1 })
    expect((await freshCollection).summary.remainingPercent).toBe(0)

    resolveOld(
      new Response('{}', {
        headers: {
          'anthropic-ratelimit-unified-5h-utilization': '0.11',
          'anthropic-ratelimit-unified-5h-reset': String(Date.parse('2026-07-28T10:30:00Z') / 1000)
        }
      })
    )
    expect((await oldCollection).summary.remainingPercent).toBe(89)

    const cached = await getModelQuotaSnapshot(models, {
      home,
      fetchFn,
      now: now + 2
    })
    expect(cached.summary.remainingPercent).toBe(0)
  })

  it('préfère la session active même si son chemin porte une date plus ancienne', async () => {
    const home = mkdtempSync(join(tmpdir(), 'autowin-model-quotas-order-'))
    temporaryHomes.push(home)
    const sessions = join(home, '.codex', 'sessions')
    const oldNamedActive = join(sessions, '2026', '07', '22', 'rollout-active.jsonl')
    const recentNamedStale = join(sessions, '2026', '07', '27', 'rollout-stale.jsonl')
    mkdirSync(join(sessions, '2026', '07', '22'), { recursive: true })
    mkdirSync(join(sessions, '2026', '07', '27'), { recursive: true })
    writeFileSync(
      oldNamedActive,
      JSON.stringify({
        timestamp: '2026-07-28T10:28:17Z',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 2, window_minutes: 10080, resets_at: 1785821486 }
          }
        }
      })
    )
    writeFileSync(
      recentNamedStale,
      JSON.stringify({
        timestamp: '2026-07-27T19:34:45Z',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 11, window_minutes: 10080, resets_at: 1785611902 }
          }
        }
      })
    )
    utimesSync(oldNamedActive, new Date('2026-07-28T10:28:18Z'), new Date('2026-07-28T10:28:18Z'))
    utimesSync(
      recentNamedStale,
      new Date('2026-07-27T19:34:46Z'),
      new Date('2026-07-27T19:34:46Z')
    )

    const snapshot = await getModelQuotaSnapshot(models, {
      home,
      fetchFn: vi.fn(),
      force: true,
      now: Date.parse('2026-07-28T10:29:00Z')
    })
    expect(snapshot.models.find((model) => model.provider === 'codex')).toMatchObject({
      status: 'available',
      observedAt: '2026-07-28T10:28:17.000Z',
      windows: [expect.objectContaining({ remainingPercent: 98 })]
    })
  })

  it('préfère un événement horodaté à un fichier plus récent sans timestamp', async () => {
    const home = mkdtempSync(join(tmpdir(), 'autowin-model-quotas-timestamp-'))
    temporaryHomes.push(home)
    const sessions = join(home, '.codex', 'sessions')
    const trusted = join(sessions, 'trusted', 'rollout-trusted.jsonl')
    const touched = join(sessions, 'touched', 'rollout-no-timestamp.jsonl')
    mkdirSync(join(sessions, 'trusted'), { recursive: true })
    mkdirSync(join(sessions, 'touched'), { recursive: true })
    writeFileSync(
      trusted,
      JSON.stringify({
        timestamp: '2026-07-28T11:59:00Z',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 2, window_minutes: 10080, resets_at: 1785821486 }
          }
        }
      })
    )
    writeFileSync(
      touched,
      JSON.stringify({
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: 11, window_minutes: 10080, resets_at: 1785821486 }
          }
        }
      })
    )
    utimesSync(trusted, new Date('2026-07-28T11:59:01Z'), new Date('2026-07-28T11:59:01Z'))
    utimesSync(touched, new Date('2026-07-28T12:00:00Z'), new Date('2026-07-28T12:00:00Z'))

    const snapshot = await getModelQuotaSnapshot(models, {
      home,
      fetchFn: vi.fn(),
      force: true,
      now: Date.parse('2026-07-28T12:00:30Z')
    })
    expect(snapshot.models.find((model) => model.provider === 'codex')).toMatchObject({
      status: 'available',
      observedAt: '2026-07-28T11:59:00.000Z',
      windows: [expect.objectContaining({ remainingPercent: 98 })]
    })
  })
})

describe('usage Claude mesuré localement (repli quand /usage est refusé)', () => {
  const now = Date.parse('2026-07-28T12:00:00.000Z')
  const line = (iso: string, tokens: number): string =>
    JSON.stringify({
      timestamp: iso,
      message: { model: 'claude-opus-5', usage: { input_tokens: tokens, output_tokens: 0 } }
    })

  it('somme les tokens par fenêtre et n’invente aucun pourcentage', () => {
    const entries = [
      {
        mtimeMs: now - 1_000,
        read: () =>
          [
            line('2026-07-28T11:30:00.000Z', 100), // dans 5 h ET 7 j
            line('2026-07-25T12:00:00.000Z', 40) // hors 5 h, dans 7 j
          ].join('\n')
      }
    ]
    const { windows, truncated } = aggregateClaudeLocalUsage(entries, now, [
      { id: 'local-5h', label: '5 h', ms: 5 * 3_600_000 },
      { id: 'local-7d', label: '7 j', ms: 7 * 24 * 3_600_000 }
    ])
    expect(truncated).toBe(false)
    expect(windows.map((w) => [w.id, w.usedTokens])).toEqual([
      ['local-5h', 100],
      ['local-7d', 140]
    ])
    // Honnêteté : aucun plafond connu → jamais présenté comme un quota.
    expect(windows.every((w) => w.limitKnown === false)).toBe(true)
  })

  it('ignore une ligne illisible (tail coupé) sans perdre les autres', () => {
    const entries = [
      { mtimeMs: now, read: () => ['{"partial":', line('2026-07-28T11:00:00.000Z', 7)].join('\n') }
    ]
    const { windows } = aggregateClaudeLocalUsage(entries, now, [
      { id: 'local-5h', label: '5 h', ms: 5 * 3_600_000 }
    ])
    expect(windows[0].usedTokens).toBe(7)
  })

  it('exclut une fenêtre sans plafond du résumé global (pas de faux « 100 % restant »)', () => {
    const snapshot = buildModelQuotaSnapshot(
      [{ id: 'm1', model: 'claude-opus-5', label: 'Opus', provider: 'claude' } as never],
      {
        claude: {
          status: 'available',
          source: 'Transcripts Claude Code (local)',
          windows: [
            { id: 'local-5h', label: '5 h', usedPercent: 0, remainingPercent: 100, limitKnown: false, usedTokens: 9 }
          ]
        }
      }
    )
    expect(snapshot.summary.remainingPercent).toBeUndefined()
    expect(snapshot.summary.status).toBe('unknown')
  })
})

describe('quota Claude réel (en-têtes API + repli client Desktop)', () => {
  it('convertit la FRACTION des en-têtes en pourcentage (0.34 → 34 %, pas 0,34 %)', () => {
    const headers = new Headers({
      'anthropic-ratelimit-unified-5h-utilization': '0.34',
      'anthropic-ratelimit-unified-5h-reset': '1785252600',
      'anthropic-ratelimit-unified-7d-utilization': '0.16'
    })
    const windows = parseClaudeRateLimitHeaders(headers)
    expect(windows.map((w) => [w.id, w.usedPercent, w.remainingPercent])).toEqual([
      ['five-hour', 34, 66],
      ['seven-day', 16, 84]
    ])
    expect(windows[0].resetsAt).toBe(new Date(1785252600 * 1000).toISOString())
    // Sans en-tête de reset, ne JAMAIS fabriquer une date (Number(null) = 0 → 1970).
    expect(windows[1].resetsAt).toBeUndefined()
  })

  it('lit le dernier échantillon du client Desktop (u.fh / u.sd en %)', () => {
    const now = Date.parse('2026-07-28T13:55:00Z')
    const raw = JSON.stringify({
      version: 2,
      samples: [
        { t: now - 600_000, u: { fh: 27, sd: 15 } },
        { t: now - 60_000, u: { fh: 33, sd: 16 } }
      ]
    })
    const parsed = parseClaudePlanUsageHistory(raw, now)
    expect(parsed?.windows.map((w) => [w.id, w.usedPercent])).toEqual([
      ['five-hour', 33],
      ['seven-day', 16]
    ])
    expect(parsed?.sampledAt).toBe(now - 60_000)
  })

  it('rejette un historique vide ou daté dans le futur', () => {
    const now = Date.parse('2026-07-28T13:55:00Z')
    expect(parseClaudePlanUsageHistory(JSON.stringify({ samples: [] }), now)).toBeUndefined()
    expect(
      parseClaudePlanUsageHistory(
        JSON.stringify({ samples: [{ t: now + 3_600_000, u: { fh: 5, sd: 5 } }] }),
        now
      )
    ).toBeUndefined()
  })
})
