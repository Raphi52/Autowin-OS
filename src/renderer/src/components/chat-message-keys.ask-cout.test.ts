import { describe, expect, it, vi } from 'vitest'

/*
 * GEL DE LA VUE CHAT (heal du 2026-09-18, `gels.jsonl` : `renderer:vue-chat` 1,3 a 2,8 s, conv-680).
 * Mesure au profileur CPU, 591 conversations reelles, 30 deltas de flux : `askDejaRepondu` est
 * appele pour CHAQUE message assistant a CHAQUE delta (le fil est recalcule quand `messages`
 * change), et passait par `groupAssistantActivity` -> `coalesceAssistantParts` ->
 * `markdownCodeContinuationPrefixes`, c'est-a-dire une analyse Markdown COMPLETE de tout le texte
 * du fil par delta. Or une question `ask` ne vient JAMAIS d'une partie texte : cette analyse ne
 * pouvait rien changer au resultat. Compteur hors-modele : aucune analyse Markdown ici.
 */
const analyses = { n: 0 }
vi.mock('../../../shared/orchestration-outcome', async (io) => {
  const reel = await io<typeof import('../../../shared/orchestration-outcome')>()
  return {
    ...reel,
    markdownCodeContinuationPrefixes: (...a: Parameters<typeof reel.markdownCodeContinuationPrefixes>) => {
      analyses.n += 1
      return reel.markdownCodeContinuationPrefixes(...a)
    }
  }
})

const { askDejaRepondu } = await import('./chat-message-keys')
import type { Msg } from './chat-view-types'

const question = {
  kind: 'action',
  name: 'ask',
  ok: true,
  actionId: 'a1',
  data: { question: 'On garde lequel ?', options: [{ libelle: 'Le premier' }, { libelle: 'Le second' }] }
}
const tour = (avecQuestion: boolean): Msg =>
  ({
    role: 'assistant',
    content: '',
    done: true,
    status: 'completed',
    parts: [
      { kind: 'text', text: '```ts\nconst a = 1\n```\nun long texte **markdown**' },
      ...(avecQuestion ? [question] : [])
    ]
  }) as unknown as Msg
const utilisateur = (content: string): Msg => ({ role: 'user', content }) as unknown as Msg

describe('askDejaRepondu — ne ré-analyse pas le Markdown du fil', () => {
  it('rend le même verdict sans aucune analyse Markdown', () => {
    const fil = [tour(true), utilisateur('Le second'), tour(false), utilisateur('autre'), tour(true)]
    analyses.n = 0
    expect(askDejaRepondu(fil, 0)).toBe(true)
    expect(askDejaRepondu(fil, 2)).toBe(false)
    expect(askDejaRepondu(fil, 4)).toBe(false)
    expect(analyses.n).toBe(0)
  })
})
