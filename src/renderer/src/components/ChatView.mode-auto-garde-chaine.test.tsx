// @vitest-environment happy-dom
// fix-ok: fichier NOUVEAU écrit en plusieurs pas ; l'unique rouge venait d'une exécution lancée pendant l'édition de ChatView.tsx (relancé seul : vert), pas d'un défaut du test.
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * GARDE-FOU DE LA CHAÎNE ∞ AU SITE D'APPEL (demande du 2026-10-02, conv-38) : le quota hebdomadaire
 * Claude relevé par l'écran du chat doit atteindre la porte de décision. Quota à 85 % → la suite
 * proposée ne part pas, ∞ s'éteint sur ce fil, et l'arrêt est dit dans le fil avec le chiffre.
 */
const fil: unknown[] = [
  { role: 'user', content: 'répare le module de paiement' },
  {
    role: 'assistant',
    content: [
      '✅ Fait',
      '1. Test ajouté.',
      '👉 Recommandé : lance le test suivant sur src/main'
    ].join('\n')
  }
]

const quotas = (pct: number): unknown => ({
  observedAt: '2026-10-02T08:00:00.000Z',
  summary: { status: 'warning' },
  models: [
    {
      modelId: 'claude-opus',
      model: 'claude-opus',
      label: 'Claude',
      provider: 'claude',
      shared: false,
      status: 'available',
      source: 'en-têtes',
      windows: [{ id: 'seven-day', label: '7 j', usedPercent: pct, remainingPercent: 100 - pct }]
    }
  ]
})

describe('ChatView — la chaîne ∞ s’arrête au seuil du quota hebdomadaire Claude', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  async function allumer(pct: number): Promise<ReturnType<typeof vi.fn>> {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        pilotChat,
        modelQuotas: vi.fn(async () => quotas(pct)),
        conversations: vi.fn().mockResolvedValue([conversation('A', fil)]),
        conversation: vi.fn(async (id: string) => conversation(id, fil))
      })
    )
    await act(async () => (document.querySelector('.conv-item .conv-pick') as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    await h.click('[data-testid="composer-auto-toggle"]')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    return pilotChat
  }

  it('quota à 85 % : aucun tour ne part, l’arrêt est affiché dans le fil', async () => {
    const pilotChat = await allumer(85)
    expect(pilotChat).not.toHaveBeenCalled()
    const arret = document.querySelector('[data-testid="chat-auto-arret"]')?.textContent ?? ''
    expect(arret).toContain('quota hebdomadaire Claude est à 85 %')
    expect(
      document.querySelector('[data-testid="composer-auto-toggle"]')?.getAttribute('aria-pressed')
    ).toBe('false')
  })

  it('l’arrêt survit au redémarrage de l’app : il est relu dans le fil, sans nouveau déclenchement', async () => {
    await allumer(85)
    await h?.unmount()
    // Redémarrage : nouvel écran, quota redescendu, ∞ non rallumé — seul l'arrêt stocké peut s'afficher.
    h = await mountChat(
      chatApi({
        modelQuotas: vi.fn(async () => quotas(10)),
        conversations: vi.fn().mockResolvedValue([conversation('A', fil)]),
        conversation: vi.fn(async (id: string) => conversation(id, fil))
      })
    )
    await act(async () => (document.querySelector('.conv-item .conv-pick') as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const arret = document.querySelector('[data-testid="chat-auto-arret"]')?.textContent ?? ''
    expect(arret).toContain('quota hebdomadaire Claude est à 85 %')
    // × l'efface pour de bon : il ne revient pas au redémarrage suivant.
    await h.click('[aria-label="Fermer l’avertissement du mode auto"]')
    expect(window.localStorage.getItem('autowin.chat.modeAuto.arretsChaine') ?? '{}').toBe('{}')
  })

  it('le compte des tours automatiques survit au redémarrage de l’app', async () => {
    // Seuil à 1 tour : le premier tour automatique part, le compteur passe à 1.
    window.localStorage.setItem(
      'autowin.chat.modeAuto.seuils',
      JSON.stringify({ quotaHebdoPct: 80, toursAutoMax: 1 })
    )
    const premier = await allumer(10)
    expect(premier).toHaveBeenCalledTimes(1)
    await h?.unmount()
    // Redémarrage : le fil rechargé ne porte pas la mention du mode auto ; seul le compte gardé
    // sur le poste sait qu'un tour automatique est déjà parti. ∞ (resté armé et stocké) est éteint
    // puis rallumé à la main : ce rallumage relance d'habitude la suite — ici il ne doit rien envoyer.
    window.localStorage.removeItem('autowin.chat.modeAuto.arretsChaine')
    const second = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        pilotChat: second,
        modelQuotas: vi.fn(async () => quotas(10)),
        conversations: vi.fn().mockResolvedValue([conversation('A', fil)]),
        conversation: vi.fn(async (id: string) => conversation(id, fil))
      })
    )
    await act(async () => (document.querySelector('.conv-item .conv-pick') as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    await h.click('[data-testid="composer-auto-toggle"]')
    await h.click('[data-testid="composer-auto-toggle"]')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(second).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="chat-auto-arret"]')?.textContent ?? '').toContain(
      '1 tours automatiques'
    )
  })

  it('quota à 40 % : la suite part', async () => {
    const pilotChat = await allumer(40)
    expect(pilotChat).toHaveBeenCalled()
    expect(document.querySelector('[data-testid="chat-auto-arret"]')).toBeNull()
    expect(document.querySelector('[data-testid="chat-auto-quota-inconnu"]')).toBeNull()
  })

  it('quota illisible : ∞ allumé, le fil prévient que seul le seuil de tours peut arrêter la chaîne', async () => {
    h = await mountChat(
      chatApi({
        pilotChat: vi.fn().mockResolvedValue({ ok: true }),
        modelQuotas: vi.fn(async () => {
          throw new Error('relevé indisponible')
        }),
        conversations: vi.fn().mockResolvedValue([conversation('A', fil)]),
        conversation: vi.fn(async (id: string) => conversation(id, fil))
      })
    )
    await act(async () => (document.querySelector('.conv-item .conv-pick') as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    // ∞ éteint : rien à signaler.
    expect(document.querySelector('[data-testid="chat-auto-quota-inconnu"]')).toBeNull()
    await h.click('[data-testid="composer-auto-toggle"]')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const avis = document.querySelector('[data-testid="chat-auto-quota-inconnu"]')?.textContent ?? ''
    expect(avis).toContain('quota hebdomadaire Claude')
    expect(avis).toContain('6 tours')
  })
})
