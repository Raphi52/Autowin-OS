import { describe, expect, it } from 'vitest'
import { promptCallJournalEvents } from './turn-journal-enrich'
import type { PromptCallLike } from './turn-journal-enrich'

/**
 * LA DEMANDE DE L'UTILISATEUR DANS LE JOURNAL DU TOUR.
 *
 * Mesure du 2026-09-02 : ZERO occurrence de `"kind":"user"` sur les 394 journaux de tour reels.
 * `prompt-call` n'ecrivait que le NOMBRE de messages envoyes (`messages: prompt.messages.length`) ;
 * le texte tape vivait seulement dans `saisies-utilisateur.jsonl`, qui ne porte aucun identifiant de
 * tour. Impossible donc de repondre a « qu'est-ce qui a ete demande au tour X ? » a partir du
 * journal — la question premiere de toute retrospective.
 */
const prompt = (messages: unknown[], system = 'SOCLE'): PromptCallLike => ({
  iteration: 0,
  prompt: {
    provider: 'anthropic',
    model: 'claude',
    transport: 'sdk',
    system,
    messages,
    options: {},
    limitation: 'aucune'
  },
  response: 'ok',
  status: 'completed'
})

describe('journal de tour — la demande de l utilisateur y est ecrite', () => {
  it('ecrit un evenement `user` porteur du TEXTE demande, avant l appel', () => {
    const events = promptCallJournalEvents(
      prompt([
        { role: 'user', content: 'premiere demande' },
        { role: 'assistant', content: 'reponse' },
        { role: 'user', content: 'repare le journal de tour' }
      ]),
      {},
      42
    )
    expect(events.map((e) => e.kind)).toEqual(['user', 'prompt-system', 'prompt-call'])
    const user = events[0] as Record<string, unknown>
    expect(user.text).toBe('repare le journal de tour')
    expect(user.chars).toBe(25)
    expect(user.at).toBe(42)
  })

  it('borne une demande enorme au lieu de gonfler le journal', () => {
    const enorme = 'a'.repeat(20_000)
    const [user] = promptCallJournalEvents(prompt([{ role: 'user', content: enorme }]), {}, 1)
    // 12 000 signes + l'ellipse ajoutee par `sanitizePersistedValue` : le journal reste lisible,
    // et `chars` garde la taille REELLE de ce qui a ete demande.
    expect(String(user.text)).toHaveLength(12_001)
    expect(user.chars).toBe(20_000)
  })

  it('ne repete pas la meme demande a chaque iteration du tour', () => {
    const memory = {}
    const messages = [{ role: 'user', content: 'une seule demande' }]
    expect(promptCallJournalEvents(prompt(messages), memory, 1).map((e) => e.kind)).toContain(
      'user'
    )
    expect(promptCallJournalEvents(prompt(messages), memory, 2).map((e) => e.kind)).toEqual([
      'prompt-call'
    ])
  })

  it('n ecrit RIEN quand aucun message utilisateur ne porte de texte', () => {
    const events = promptCallJournalEvents(
      prompt([
        { role: 'assistant', content: 'je continue' },
        { role: 'user', content: '   ' }
      ]),
      {},
      1
    )
    expect(events.map((e) => e.kind)).not.toContain('user')
  })
})
