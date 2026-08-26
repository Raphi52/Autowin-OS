import { describe, expect, it } from 'vitest'
import { discoverImportedModels } from './models'

/** Listing App Server REEL du compte connecte (releve 2026-08-25) : « sol » n'y est PAS. */
const listingLive = async (): Promise<never[] | unknown[]> =>
  ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-mini'].map((model, i) => ({
    model,
    displayName: model,
    hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map((e) => ({
      reasoningEffort: e
    })),
    priority: i
  }))

const sansCli = (): string[] => []
const fetchKo = (async () => {
  throw new Error('pas de service local')
}) as unknown as typeof fetch

describe('catalogue codex — GPT-5.6 Sol', () => {
  it('expose gpt-5.6-sol meme quand le listing live ne le rend pas', async () => {
    const models = await discoverImportedModels(
      fetchKo,
      undefined,
      listingLive as never,
      sansCli as never
    )
    const sol = models.find((m) => m.model === 'gpt-5.6-sol')
    expect(sol).toBeDefined()
    expect(sol?.provider).toBe('codex')
    expect(sol?.id).toBe('codex/gpt-5.6-sol')
    // Le cran porteur de la pastille doit exister, sinon la matrice ne l'affichera pas.
    expect(sol?.reasoningEfforts).toContain('xhigh')
    // Entree qui ferait echouer une fausse correction : un listing qui expose DEJA sol ne doit
    // pas produire un doublon.
    const doubles = models.filter((m) => m.model === 'gpt-5.6-sol')
    expect(doubles).toHaveLength(1)
  })

  it('ne duplique pas sol quand le listing live l’expose', async () => {
    const avecSol = async (): Promise<unknown[]> => [
      ...(await listingLive()),
      {
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        hidden: false,
        defaultReasoningEffort: 'high',
        supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'xhigh' }]
      }
    ]
    const models = await discoverImportedModels(
      fetchKo,
      undefined,
      avecSol as never,
      sansCli as never
    )
    expect(models.filter((m) => m.model === 'gpt-5.6-sol')).toHaveLength(1)
  })
})
