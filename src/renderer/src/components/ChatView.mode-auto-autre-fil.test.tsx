// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/** Une clôture réelle d'Autowin : c'est le texte qui a été mesuré le 2026-09-02 dans conv-131. */
const cloture = (suite: string): string =>
  [
    '✅ Fait',
    '1. Le livrable de la phase frame a été produit et validé.',
    "📍 Maintenant : cette phase est rendue — le besoin lui-même n'est PAS réalisé.",
    '⏳ Reste à faire : terrain → build → clean → judge.',
    `👉 Recommandé : ${suite}`
  ].join('\n')

const fil = (suite: string): unknown[] => [
  { role: 'user', content: 'salut' },
  { role: 'assistant', content: cloture(suite) }
]

/**
 * DÉFAUT VÉCU le 2026-09-02 : « j'étais en mode auto et t'as pas enchaîné le workflow ».
 *
 * Les journaux de tours le datent : conv-131 a fini à 11:53:59 pendant que conv-133 était à
 * l'écran depuis 11:53:17. La boucle ne suivait que le fil AFFICHÉ — la suite n'est jamais partie,
 * et au retour dans le fil le tour était marqué « déjà traité », donc perdu pour toujours.
 *
 * La borne qui protège l'argent reste testée juste à côté (`ChatView.mode-auto-allumage.test.tsx`,
 * « ouvrir un AUTRE fil ne relance pas sa vieille réponse ») : ici le tour se termine SOUS l'oeil du
 * mode auto, ce qui n'est pas la même chose qu'une vieille réponse qu'on rouvre.
 */
describe('ChatView — le mode auto enchaîne aussi un fil qui n’est pas à l’écran', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('un tour terminé dans B pendant qu’on regarde A envoie la suite de B', async () => {
    const filA = fil('lancer terrain sur A.')
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        pilotChat,
        conversations: vi.fn().mockResolvedValue([conversation('A', filA), conversation('B', [])]),
        conversation: vi.fn(async (id: string) => conversation(id, id === 'A' ? filA : [])),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    // On travaille dans A, mode auto armé.
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="conv-auto-toggle"]')
    const avant = pilotChat.mock.calls.length

    // B tourne en arrière-plan et TERMINE, l'écran restant sur A.
    await act(async () =>
      pilote({
        conversationId: 'B',
        kind: 'delta',
        text: cloture('lancer terrain sur B.'),
        streamId: 's1'
      })
    )
    await act(async () => pilote({ conversationId: 'B', kind: 'done' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const suite = pilotChat.mock.calls
      .slice(avant)
      .map((appel) => JSON.stringify(appel))
      .join('\n')
    expect(suite).toContain('lancer terrain sur B.')
  })
})
