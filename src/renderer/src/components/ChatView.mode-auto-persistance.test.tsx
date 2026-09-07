// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/** Clôture réelle d'Autowin ; `suite` = la rubrique « 👉 Recommandé ». */
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
 * DEUX DÉFAUTS VÉCUS le 2026-09-02 (« le mode auto se désactive tout seul ») :
 *
 * 1. L'interrupteur ne vivait qu'en mémoire d'écran : un redémarrage / rafraîchissement de
 *    l'interface l'éteignait EN SILENCE.
 * 2. Un fil d'ARRIÈRE-PLAN qui finissait par « Recommandé : rien » coupait l'interrupteur GLOBAL,
 *    donc le fil affiché s'arrêtait sans raison visible.
 */
describe('ChatView — mode auto : survit au redémarrage, insensible aux autres fils', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('l’interrupteur est retrouvé ALLUMÉ au démarrage suivant, sans dépenser de tour', async () => {
    window.localStorage.setItem('autowin.chat.modeAuto', '1')
    const filA = fil('lancer terrain sur A.')
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        pilotChat,
        conversations: vi.fn().mockResolvedValue([conversation('A', filA)]),
        conversation: vi.fn(async (id: string) => conversation(id, filA))
      })
    )
    await h.click('.conv-item .conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    // L'ancien réglage global est hérité : le bouton ∞ de la barre de saisie le montre allumé
    // (c'est désormais le SEUL interrupteur — celui de la liste a été retiré).
    const bouton = document.querySelector('[data-testid="composer-auto-toggle"]')
    expect(bouton?.getAttribute('aria-pressed')).toBe('true')
    // La vieille réponse déjà à l'écran n'est PAS relancée : aucun tour payant à la reprise.
    expect(pilotChat.mock.calls.length).toBe(0)
  })

  it('un « rien » dans un fil d’ARRIÈRE-PLAN laisse l’interrupteur allumé', async () => {
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
    await h.click('.conv-item .conv-pick')
    // Le mode auto de CE fil vit dans la barre de saisie (le bouton de la liste est le global).
    await h.click('[data-testid="composer-auto-toggle"]')

    // B termine en arrière-plan en disant qu'il n'y a plus rien à faire.
    await act(async () =>
      pilote({ conversationId: 'B', kind: 'delta', text: cloture('rien'), streamId: 's1' })
    )
    await act(async () => pilote({ conversationId: 'B', kind: 'done' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const bouton = document.querySelector('[data-testid="composer-auto-toggle"]')
    expect(bouton?.getAttribute('aria-pressed')).toBe('true')
    expect(JSON.parse(window.localStorage.getItem('autowin.chat.modeAuto.convs') ?? '[]')).toContain(
      'A'
    )
  })

  it('le réglage est PAR conversation : armer A laisse B éteint', async () => {
    const filA = fil('lancer terrain sur A.')
    h = await mountChat(
      chatApi({
        pilotChat: vi.fn().mockResolvedValue({ ok: true }),
        conversations: vi.fn().mockResolvedValue([conversation('A', filA), conversation('B', [])]),
        conversation: vi.fn(async (id: string) => conversation(id, id === 'A' ? filA : []))
      })
    )
    const items = document.querySelectorAll('.conv-item .conv-pick')
    await h.click('.conv-item .conv-pick') // A
    await h.click('[data-testid="composer-auto-toggle"]')
    const armé = document.querySelector('[data-testid="composer-auto-toggle"]')
    expect(armé?.getAttribute('aria-pressed')).toBe('true')
    // LIBELLÉ : le rond ne porte qu'un glyphe — l'état se lit dans l'infobulle accessible.
    expect(armé?.getAttribute('aria-label')).toContain('Arrêter le mode auto de cette conversation')
    expect(items.length).toBeGreaterThan(1)
    await act(async () => (items[1] as HTMLElement).click()) // B
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const eteint = document.querySelector('[data-testid="composer-auto-toggle"]')
    expect(eteint?.getAttribute('aria-pressed')).toBe('false')
    expect(eteint?.getAttribute('aria-label')).toBe('Mode auto de cette conversation')
    expect(JSON.parse(window.localStorage.getItem('autowin.chat.modeAuto.convs') ?? '[]')).toEqual([
      'A'
    ])
  })
})
