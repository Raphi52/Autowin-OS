import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildModelQuotaSnapshot,
  getModelQuotaSnapshot,
  parseClaudeUsage,
  parseLatestCodexRateLimits,
  parseLatestCodexRateLimitSample
} from './model-quotas'

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
      return new Response(
        JSON.stringify({
          five_hour: { utilization: 25, resets_at: '2026-07-24T05:00:00Z' }
        })
      )
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
})
