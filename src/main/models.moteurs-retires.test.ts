import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverImportedModels } from './models'

/**
 * Codex, Kimi et Gemini sont retirés du produit. Le catalogue ne doit plus JAMAIS en proposer —
 * ni depuis une source vivante, ni depuis le cache disque du dernier catalogue vu.
 *
 * Le cache est le piège réel : il a été écrit AVANT le retrait, il contient donc des entrées Codex.
 * Sans filtre à la relecture, ces moteurs morts réapparaissent dans Agent Studio au prochain
 * démarrage, et l'utilisateur peut de nouveau y router un rôle.
 */
const tempDirs: string[] = []
const cachePath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-moteurs-retires-'))
  tempDirs.push(dir)
  return join(dir, 'model-catalog.json')
}
const cliIds = (): string[] => ['claude-opus-5']
const deadFetch = async (): Promise<never> => {
  throw new Error('service local absent')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('catalogue — moteurs retirés', () => {
  it('ignore un listing Codex vivant : plus aucun modèle codex proposé', async () => {
    const listCodex = vi.fn(async () => [
      {
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        supportedReasoningEfforts: [{ reasoningEffort: 'low' }]
      }
    ])

    const models = await discoverImportedModels(
      deadFetch as unknown as typeof fetch,
      cachePath(),
      listCodex as never,
      cliIds
    )

    expect(models.filter((model) => model.provider === 'codex')).toEqual([])
    expect(models.some((model) => model.provider === 'claude')).toBe(true)
  })

  it('ne ressuscite pas les moteurs retirés depuis le cache disque écrit avant le retrait', async () => {
    const path = cachePath()
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        discoveredAt: Date.now(),
        codex: [
          {
            id: 'codex/gpt-5.6-sol',
            provider: 'codex',
            model: 'gpt-5.6-sol',
            label: 'GPT-5.6-Sol · ChatGPT',
            reasoningEfforts: ['low'],
            defaultReasoningEffort: 'low'
          }
        ],
        claude: [
          {
            id: 'claude/claude-opus-5',
            provider: 'claude',
            model: 'claude-opus-5',
            label: 'Claude Opus 5 · CLI',
            reasoningEfforts: ['high'],
            defaultReasoningEffort: 'high'
          }
        ]
      }),
      'utf8'
    )

    const models = await discoverImportedModels(
      deadFetch as unknown as typeof fetch,
      path,
      async () => [],
      cliIds
    )

    expect(models.filter((model) => model.provider === 'codex')).toEqual([])
    expect(models.some((model) => model.provider === 'kimi')).toBe(false)
    expect(models.some((model) => model.provider === 'gemini')).toBe(false)
    // CONTRÔLE POSITIF : le cache Claude, lui, reste bien relu — le filtre ne casse pas le cache.
    expect(models.some((model) => model.model === 'claude-opus-5')).toBe(true)
  })
})
