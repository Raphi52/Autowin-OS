import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendTurnEvent, type TurnJournalEvent } from './turn-journal'
import { listRecoverableChatProviderCallsAsync, reglagesDeReprise } from './chat-provider-recovery'

/**
 * UN TOUR REPRIS NE FIGE PAS LES RUNS QU'IL LANCE (conv-955, 2026-10-15).
 *
 * Le contrôle final de « un effort par étape » l'a trouvé : la reprise d'un tour coupé par un
 * redémarrage rejouait le modèle et l'effort DU CHAT comme réglage IMPOSÉ au tour. Ce réglage
 * descendait jusqu'à `orchestrate`, qui le prenait pour un run figé : toutes les étapes partaient à
 * l'effort du chat (`xhigh`) et la règle par étape était sautée — alors qu'il faut justement
 * redémarrer l'app pour l'activer.
 *
 * Deux réglages distincts, rejoués chacun pour ce qu'il est :
 *  - le modèle du chat (ce que le tour d'origine a répondu avec) → rejoué pour le CHAT seulement ;
 *  - le réglage imposé aux commandes (tâche planifiée avec modèle choisi, modèle du fil) → rejoué
 *    seulement s'il existait, lu dans le journal du tour.
 */
let root = ''

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = ''
})

const lienProvider = (extra: Record<string, unknown> = {}): TurnJournalEvent => ({
  kind: 'provider-journal',
  provider: 'claude',
  token: 'provider-1',
  journalPath: join(root, 'provider.stdout.jsonl'),
  iteration: 0,
  attempt: 0,
  streamId: '0:0',
  requestId: 'request-1',
  ...extra
})

describe('reprise d’un tour de chat : réglage du chat ≠ réglage imposé aux runs', () => {
  it('un tour ordinaire repris rejoue le modèle du chat SANS l’imposer aux commandes', () => {
    const runtime = { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'xhigh' }
    const reglages = reglagesDeReprise({}, runtime)
    expect(reglages.bindingOverride).toBeUndefined()
    expect(reglages.runtimeBinding).toEqual({
      provider: 'claude',
      model: 'claude-opus-5-5',
      reasoningEffort: 'xhigh'
    })
  })

  it('un réglage réellement imposé au tour d’origine est rejoué tel quel', () => {
    const bindingFige = {
      provider: 'claude',
      model: 'claude-fable-5',
      reasoningEffort: 'low' as const
    }
    const reglages = reglagesDeReprise(
      { bindingFige },
      { provider: 'claude', model: 'claude-fable-5', reasoningEffort: 'low' }
    )
    expect(reglages.bindingOverride).toEqual(bindingFige)
  })

  it('un effort illisible dans le modèle du chat est retiré, pas transmis', () => {
    const reglages = reglagesDeReprise({}, { provider: 'claude', reasoningEffort: 'défaut' })
    expect(reglages.runtimeBinding).toEqual({ provider: 'claude' })
  })

  it('sans modèle du chat connu, la reprise ne fabrique aucun réglage', () => {
    expect(reglagesDeReprise({}, undefined)).toEqual({})
  })

  it('le journal du tour rend le réglage imposé qu’il a enregistré', async () => {
    root = mkdtempSync(join(tmpdir(), 'autowin-reprise-fige-'))
    appendTurnEvent(
      root,
      'conv-1',
      'turn-1',
      lienProvider({
        bindingFige: { provider: 'claude', model: 'claude-fable-5', reasoningEffort: 'low' }
      })
    )
    const [appel] = await listRecoverableChatProviderCallsAsync(root)
    expect(appel?.bindingFige).toEqual({
      provider: 'claude',
      model: 'claude-fable-5',
      reasoningEffort: 'low'
    })
  })

  it('un journal sans réglage imposé n’en invente aucun (anciens journaux compris)', async () => {
    root = mkdtempSync(join(tmpdir(), 'autowin-reprise-libre-'))
    appendTurnEvent(root, 'conv-1', 'turn-1', lienProvider())
    const [appel] = await listRecoverableChatProviderCallsAsync(root)
    expect(appel).toBeDefined()
    expect(appel).not.toHaveProperty('bindingFige')
  })

  it('un réglage imposé illisible refuse la reprise plutôt que de lâcher le gel (fail-closed)', async () => {
    root = mkdtempSync(join(tmpdir(), 'autowin-reprise-illisible-'))
    appendTurnEvent(
      root,
      'conv-1',
      'turn-1',
      lienProvider({ bindingFige: { model: 'sans-provider' } })
    )
    expect(await listRecoverableChatProviderCallsAsync(root)).toEqual([])
  })
})

describe('câblage : la reprise et le tour passent chaque réglage à sa place', () => {
  const index = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
  const tour = readFileSync(join(__dirname, '..', 'chat', 'run-pilot-chat.ts'), 'utf8')

  it('index.ts confie le choix à reglagesDeReprise et passe le modèle du chat dans la reprise', () => {
    const debut = index.indexOf('const reglages = reglagesDeReprise(call, assistant.runtime)')
    expect(debut, 'reglagesDeReprise non appelé à la reprise').toBeGreaterThanOrEqual(0)
    const appel = index.slice(debut, index.indexOf('call.policy', debut))
    expect(appel).toContain('reglages.bindingOverride,')
    expect(appel).toContain('runtimeBinding: reglages.runtimeBinding')
  })

  it('le tour prend le modèle du chat de la reprise, et journalise le réglage imposé', () => {
    expect(tour).toMatch(
      /const turnRuntimeBinding =\s*bindingOverride \?\? recovery\?\.runtimeBinding \?\? os\.roles\.getBinding\('orchestrator'\)/
    )
    const journal = tour.slice(tour.indexOf("kind: 'provider-journal'"))
    expect(journal.slice(0, 300)).toContain(
      '...(bindingOverride ? { bindingFige: bindingOverride } : {})'
    )
  })
})
