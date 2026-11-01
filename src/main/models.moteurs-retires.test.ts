import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverImportedModels, loadCachedImportedModels } from './models'

// Aucun de ces tests ne doit lancer le vrai CLI Codex du poste.
vi.mock('./codex-model-source', () => ({ listCodexAppServerModels: async () => [] }))

/**
 * Kimi et Gemini sont retirés du produit. Le catalogue ne doit plus JAMAIS en proposer — ni depuis
 * une source vivante, ni depuis le cache disque du dernier catalogue vu.
 *
 * Le cache est le piège réel : il a pu être écrit AVANT le retrait, et contenir ces moteurs. Sans
 * filtre à la relecture, ils réapparaissent dans Agent Studio au prochain démarrage, et
 * l'utilisateur peut de nouveau y router un rôle. Codex, retiré avec eux, est revenu le 2026-10-31
 * (conv-1414) : `models.chatgpt.test.ts`.
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
  it('garde le filtre de sortie : la seconde barrière contre un moteur retiré', () => {
    const source = readFileSync(join(__dirname, 'models.ts'), 'utf8')
    expect(source).toContain('ROUTED_PROVIDERS.includes')
  })

  it('ne ressuscite pas les moteurs retirés depuis le cache disque écrit avant le retrait', async () => {
    const path = cachePath()
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        discoveredAt: Date.now(),
        kimi: [
          {
            id: 'kimi/k2',
            provider: 'kimi',
            model: 'k2',
            label: 'Kimi K2',
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

    const models = await discoverImportedModels(deadFetch as unknown as typeof fetch, path, cliIds)

    expect(models.some((model) => model.provider === 'kimi')).toBe(false)
    expect(models.some((model) => model.provider === 'gemini')).toBe(false)
    // CONTRÔLE POSITIF : le cache Claude, lui, reste bien relu — le filtre ne casse pas le cache.
    expect(models.some((model) => model.model === 'claude-opus-5')).toBe(true)

    // MÊME garantie sur le catalogue du DÉMARRAGE (avant toute découverte), qui lit le même cache.
    const auDemarrage = loadCachedImportedModels(path)
    expect(auDemarrage.some((model) => model.provider === 'kimi')).toBe(false)
    expect(auDemarrage.some((model) => model.model === 'claude-opus-5')).toBe(true)
  })
})
