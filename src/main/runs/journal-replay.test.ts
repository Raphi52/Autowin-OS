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

  it('annonce ce qu’il n’a pas pu lire plutôt que de le taire', () => {
    const message = recapMessage(summarizeJournal([claude('ok'), 'bruit']), false)
    expect(message).toContain('illisibles')
  })

  it('sans message final, dit le nombre d’étapes au lieu de rester muet', () => {
    const recap = summarizeJournal([JSON.stringify({ type: 'thread.started' })])
    expect(recapMessage(recap, false)).toContain('1 étape(s)')
  })
})
