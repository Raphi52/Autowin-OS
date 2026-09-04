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

/**
 * CONTRAT INVERSÉ depuis le retrait de Codex (2026-09-04). Ce banc garantissait que `gpt-5.6-sol`
 * apparaisse toujours au catalogue — c'était une exception assumée, demandée par l'utilisateur.
 * Codex étant retiré du produit, la garantie devient son contraire : Sol ne doit PLUS ressortir,
 * y compris quand le listing de l'App Server l'expose lui-même.
 */
describe('catalogue codex — GPT-5.6 Sol retiré', () => {
  it('n’expose plus gpt-5.6-sol, même via le supplément nommé', async () => {
    const models = await discoverImportedModels(
      fetchKo,
      undefined,
      listingLive as never,
      sansCli as never
    )
    expect(models.filter((m) => m.model === 'gpt-5.6-sol')).toHaveLength(0)
    expect(models.filter((m) => m.provider === 'codex')).toHaveLength(0)
  })

  it('n’expose pas sol non plus quand le listing live l’expose', async () => {
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
    expect(models.filter((m) => m.model === 'gpt-5.6-sol')).toHaveLength(0)
  })
})
