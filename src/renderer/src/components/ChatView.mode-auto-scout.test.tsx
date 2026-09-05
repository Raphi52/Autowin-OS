// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (texte: string): string | null => {
    const m = texte.match(/👉\s*Recommandé\s*\n([^\n]+)/u)
    return m ? m[1] : null
  }
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * LE SITE D'APPEL de la porte « un scout engage une cible » (`chat-auto-mode.ts`).
 *
 * La porte peut etre verte dans son module et branchee NULLE PART : ce test-ci echoue si la vue
 * cesse de transmettre `tourEstUnScout`, parce qu'il regarde ce qui PART reellement.
 */
const tourDeScout = (texte: string): unknown[] => [
  { role: 'user', content: 'scout sur le mode auto' },
  {
    role: 'assistant',
    parts: [
      { kind: 'action', id: 'a1', label: 'orchestration', pipeline: [{ phase: 'scout' }] },
      { kind: 'text', text: `${texte}\n\n👉 Recommandé\nenchaîne sur le tableau ci-dessus` }
    ]
  }
]

describe('ChatView — le mode auto n’enchaine pas un scout sans cible', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  const allumer = async (messages: unknown[]): Promise<ReturnType<typeof vi.fn>> => {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        pilotChat,
        conversations: vi.fn().mockResolvedValue([conversation('A', messages)]),
        conversation: vi.fn(async (id: string) => conversation(id, messages))
      })
    )
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="conv-auto-toggle"]')
    return pilotChat
  }

  it('scout SANS ligne CIBLE: aucun tour payant ne part', async () => {
    const pilotChat = await allumer(tourDeScout('| 1 | durcir la porte | faible |'))
    expect(pilotChat).not.toHaveBeenCalled()
  })

  it('LE TEST SYMETRIQUE — avec une cible nommee, la suite part et la porte le dit', async () => {
    const pilotChat = await allumer(tourDeScout('CIBLE: durcir la porte anti-boucle'))
    const envoyes = pilotChat.mock.calls.map((c) => JSON.stringify(c[0])).join('\n')
    expect(envoyes).toContain('durcir la porte anti-boucle')
  })
})
