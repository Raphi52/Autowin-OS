import { describe, expect, it } from 'vitest'
import { recapMessage, summarizeJournal } from './journal-replay'

/**
 * Le journal d'un CLI détaché existait sur le disque mais n'était jamais relu : au retour de l'app,
 * le travail était invisible, donc réputé perdu, donc relancé. On en extrait ce qui répond à
 * « qu'est-ce qui s'est passé ? ».
 */
const claude = (text: string): string =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const codex = (text: string): string =>
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } })

describe('récapitulatif d’un journal', () => {
  it('extrait le texte d’un journal Claude', () => {
    const recap = summarizeJournal([claude('module écrit'), claude('tests verts')])
    expect(recap.text).toBe('module écrit\n\ntests verts')
    expect(recap.events).toBe(2)
  })

  it('extrait le texte d’un journal Codex — même fonction, deux formats', () => {
    const recap = summarizeJournal([codex('correctif appliqué')])
    expect(recap.text).toBe('correctif appliqué')
  })

  it('compte les étapes sans texte : « il a travaillé » reste une information', () => {
    const recap = summarizeJournal([
      JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }),
      JSON.stringify({ type: 'thread.started', thread_id: 'x' })
    ])
    expect(recap.text).toBe('')
    expect(recap.events).toBe(2)
  })

  it('une ligne illisible est COMPTÉE, jamais devinée', () => {
    const recap = summarizeJournal([claude('ok'), 'ceci n’est pas du json', '   '])
    expect(recap.text).toBe('ok')
    expect(recap.events).toBe(1)
    expect(recap.unreadable).toBe(1)
  })

  it('un journal vide ne produit aucun récapitulatif — on ne parle pas pour rien', () => {
    expect(recapMessage(summarizeJournal([]), false)).toBeUndefined()
  })

  it('dit si l’agent travaille ENCORE — ce n’est pas la même nouvelle', () => {
    const recap = summarizeJournal([claude('avancement')])
    expect(recapMessage(recap, true)).toContain('travaille encore')
    expect(recapMessage(recap, false)).toContain('a produit')
  })

  /*
   * Mesure du 2026-09-03 (conv-18). L'utilisateur relit sa conversation et y trouve un message
   * « Reprise du fil … » suivi de « Couverture structurée : 100 % (222/222) · 0 diagnostic(s) ·
   * 0 blocage(s) · 0 bruit(s) · 0 perte(s) de preuve. » — quatre compteurs internes tous à zéro,
   * dans SON fil, au milieu du travail. Un journal intégralement relu n'a RIEN à signaler : la
   * réserve reste due quand une ligne est perdue, jamais quand tout a été lu.
   */
  it('ne colle aucun compteur interne quand tout le journal a été relu', () => {
    const message = recapMessage(summarizeJournal([claude('module écrit')]), true)
    expect(message).toContain('module écrit')
    expect(message).not.toContain('Couverture structurée')
  })

  it('annonce la preuve non structurée plutôt que de la qualifier à tort', () => {
    const message = recapMessage(summarizeJournal([claude('ok'), 'bruit']), false)
    expect(message).toContain('non structurée(s)')
    expect(message).toContain('1 perte(s) de preuve')
  })

  it('sans message final, dit le nombre d’étapes au lieu de rester muet', () => {
    const recap = summarizeJournal([JSON.stringify({ type: 'thread.started' })])
    expect(recapMessage(recap, false)).toContain('1 étape(s)')
  })
})

describe('diagnostics Auto-Kaizen du journal mixte', () => {
  it('conserve un test rouge structuré dans un événement Codex JSONL', () => {
    const recap = summarizeJournal([
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'npx vitest run src/main/example.test.ts',
          aggregated_output: 'Tests 1 failed | 10 passed',
          exit_code: 1,
          status: 'failed'
        }
      })
    ])

    expect(recap.events).toBe(1)
    expect(recap.diagnostics).toEqual([
      expect.objectContaining({
        kind: 'command-failed',
        summary: expect.stringContaining('vitest'),
        detail: expect.stringContaining('1 failed')
      })
    ])
  })

  it('conserve les erreurs stderr Codex au lieu de les ignorer', () => {
    const recap = summarizeJournal([
      '2026-08-01T17:43:54.448133Z ERROR codex_core::tools::router: error=quota proche du seuil',
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'npx vitest run',
          aggregated_output: '1 failed',
          exit_code: 1,
          status: 'failed'
        }
      }),
      'Wall time: 0.4 seconds',
      'sortie métier non classée'
    ])

    expect(recap.diagnostics).toHaveLength(2)
    expect(recap.diagnostics[0]).toMatchObject({
      kind: 'stderr-error',
      classification: 'diagnostic',
      summary: expect.stringContaining('quota proche')
    })
    expect(recap.diagnostics[1]).toMatchObject({
      kind: 'command-failed',
      classification: 'blockage'
    })
    expect(recap.unreadable).toBe(3)
    expect(recap.coverage).toMatchObject({
      total: 4,
      structured: 1,
      diagnostics: 1,
      blockages: 1,
      noise: 1,
      lostProof: 1
    })
    expect(recapMessage(recap, false)).toContain('2 erreur(s) exploitable(s)')
    expect(recapMessage(recap, false)).toContain('Couverture structurée : 25 %')
    expect(recapMessage(recap, false)).toContain('1 perte(s) de preuve')
    expect(recapMessage(recap, false)).not.toContain('ignorées')
  })

  it('distingue le bruit connu de la perte de preuve', () => {
    const recap = summarizeJournal(['Wall time: 0.4 seconds', 'sortie métier non classée'])
    const message = recapMessage(recap, false)

    expect(recap.coverage.noise).toBe(1)
    expect(recap.coverage.lostProof).toBe(1)
    expect(message).toContain('2 ligne(s) non structurée(s)')
    expect(message).toContain('1 bruit(s)')
    expect(message).toContain('1 perte(s) de preuve')
    expect(message).not.toContain('conservées comme diagnostics')
  })
})
