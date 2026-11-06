import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexAppServerModel } from '../providers/codex-model-source'

// Le catalogue lance `agy models` quand agy est installé : jamais dans ces tests.
vi.mock('../providers/agy-modeles', () => ({ catalogueAgy: async () => [] }))
import { discoverImportedModels, loadCachedImportedModels } from './models'
import { CodexCliIntrouvable } from '../providers/codex'

/**
 * LE CATALOGUE CHATGPT, rétabli le 2026-10-31 : ce que le CLI connecté déclare pour le
 * compte, rien d'autre. La forme du listing est celle mesurée ce jour-là avec le CLI 0.166.
 */
const modele = (
  model: string,
  extra: Partial<CodexAppServerModel> = {}
): CodexAppServerModel => ({
  id: model,
  model,
  displayName: model.toUpperCase(),
  hidden: false,
  isDefault: false,
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }],
  ...extra
})

const LISTING_DU_COMPTE: CodexAppServerModel[] = [
  modele('gpt-reserve', { hidden: true }),
  modele('gpt-6-luna', { displayName: 'GPT-6-Luna', isDefault: true }),
  modele('gpt-5.6-terra', {
    displayName: 'GPT-5.6-Terra',
    supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'ultra' }]
  }),
  modele('codex-auto-review', { hidden: true })
]

const dossiers: string[] = []
const cachePath = (): string => {
  const dossier = mkdtempSync(join(tmpdir(), 'autowin-catalogue-chatgpt-'))
  dossiers.push(dossier)
  return join(dossier, 'model-catalog.json')
}
const sansService = (async () => {
  throw new Error('service local absent')
}) as unknown as typeof fetch
const claudeDuCli = (): string[] => ['claude-opus-5']

afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true })
})

describe('catalogue ChatGPT', () => {
  it('propose les modèles visibles du compte, après ceux de Claude, sans les masqués', async () => {
    const modeles = await discoverImportedModels(
      sansService,
      undefined,
      claudeDuCli,
      async () => LISTING_DU_COMPTE
    )

    // Claude d'abord, ChatGPT ensuite, sans mélange : l'ordre voulu pour les listes de choix.
    const moteurs = modeles.map((m) => m.provider)
    expect(moteurs.lastIndexOf('claude')).toBeLessThan(moteurs.indexOf('codex'))
    const chatgpt = modeles.filter((m) => m.provider === 'codex')
    expect(chatgpt.map((m) => m.id)).toEqual(['codex/gpt-6-luna', 'codex/gpt-5.6-terra'])
    expect(chatgpt.map((m) => m.label)).toEqual(['GPT-6-Luna', 'GPT-5.6-Terra'])
  })

  it('garde les efforts annoncés par le listing, sans filtre global', async () => {
    // Mesuré le 2026-10-31 : `gpt-5.6-terra` + `ultra` répond par le CLI (code 0).
    const modeles = await discoverImportedModels(
      sansService,
      undefined,
      claudeDuCli,
      async () => LISTING_DU_COMPTE
    )
    const terra = modeles.find((m) => m.model === 'gpt-5.6-terra')
    expect(terra?.reasoningEfforts).toEqual(['medium', 'ultra'])
    expect(terra?.defaultReasoningEffort).toBe('medium')
  })

  it('CLI absent : aucun modèle ChatGPT, même si un ancien cache en contient', async () => {
    const chemin = cachePath()
    await discoverImportedModels(sansService, chemin, claudeDuCli, async () => LISTING_DU_COMPTE)
    expect(JSON.parse(readFileSync(chemin, 'utf8')).codex).toHaveLength(2)

    const modeles = await discoverImportedModels(sansService, chemin, claudeDuCli, async () => {
      throw new CodexCliIntrouvable('Codex CLI introuvable')
    })

    expect(modeles.filter((m) => m.provider === 'codex')).toEqual([])
    expect(modeles.some((m) => m.provider === 'claude')).toBe(true)
  })

  it('listing en panne passagère : retombe sur le dernier catalogue vu', async () => {
    const chemin = cachePath()
    await discoverImportedModels(sansService, chemin, claudeDuCli, async () => LISTING_DU_COMPTE)

    const modeles = await discoverImportedModels(sansService, chemin, claudeDuCli, async () => {
      throw new Error('Codex app-server silencieux après 10000 ms')
    })

    expect(modeles.filter((m) => m.provider === 'codex').map((m) => m.model)).toEqual([
      'gpt-6-luna',
      'gpt-5.6-terra'
    ])
  })

  it('le démarrage relit le dernier catalogue vu, sans les masqués d’un ancien cache', () => {
    const chemin = cachePath()
    const entree = (model: string, visibility: string): Record<string, unknown> => ({
      id: `codex/${model}`,
      provider: 'codex',
      model,
      label: model,
      reasoningEfforts: ['low'],
      defaultReasoningEffort: 'low',
      visibility
    })
    writeFileSync(
      chemin,
      JSON.stringify({
        version: 1,
        discoveredAt: Date.now(),
        codex: [entree('gpt-6-luna', 'list'), entree('codex-auto-review', 'hide')]
      }),
      'utf8'
    )

    expect(loadCachedImportedModels(chemin).map((m) => m.model)).toEqual(['gpt-6-luna'])
  })
})
