import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverImportedModels, loadCachedImportedModels } from './models'

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
  /**
   * CONTRÔLE NÉGATIF DU RETRAIT — le catalogue ne SONDE plus le listing de l'App Server Codex : il
   * n'y a plus de source codex à injecter dans `discoverImportedModels`, et le module n'importe
   * plus `codex-model-source`. Auparavant le listing était appelé puis son résultat filtré à la
   * sortie : on payait un spawn du binaire codex à chaque démarrage pour rien.
   *
   * L'assertion porte sur la SOURCE parce que c'est là que vit le défaut : un `import` réintroduit
   * suffit à faire revenir le spawn, sans qu'aucun modèle codex ne ressorte du catalogue — donc
   * sans qu'aucune assertion de sortie ne le voie.
   */
  it('ne sonde plus AUCUNE source Codex (plus d’import, plus de spawn au démarrage)', () => {
    const source = readFileSync(join(__dirname, 'models.ts'), 'utf8')
    expect(source).not.toContain('codex-model-source')
    expect(source).not.toContain('listCodexAppServerModels')
    expect(source).not.toContain('discoverCodexModels')
    // Le filtre de sortie, lui, RESTE : c'est la seconde barrière.
    expect(source).toContain('ROUTED_PROVIDERS.includes')
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

    const models = await discoverImportedModels(deadFetch as unknown as typeof fetch, path, cliIds)

    expect(models.filter((model) => model.provider === 'codex')).toEqual([])
    expect(models.some((model) => model.provider === 'kimi')).toBe(false)
    expect(models.some((model) => model.provider === 'gemini')).toBe(false)
    // CONTRÔLE POSITIF : le cache Claude, lui, reste bien relu — le filtre ne casse pas le cache.
    expect(models.some((model) => model.model === 'claude-opus-5')).toBe(true)

    // MÊME garantie sur le catalogue du DÉMARRAGE (avant toute découverte), qui lit le même cache.
    const auDemarrage = loadCachedImportedModels(path)
    expect(auDemarrage.filter((model) => model.provider === 'codex')).toEqual([])
    expect(auDemarrage.some((model) => model.model === 'claude-opus-5')).toBe(true)
  })
})
