// @vitest-environment happy-dom
/**
 * « J'AI ORIENTÉ PENDANT LE TOUR ET LE PREMIER BLOC DE RAISONNEMENT A UN TIMER QUI CONTINUE DE
 * GRIMPER ALORS QUE PLUS RIEN NE S'ÉCRIT DANS LE BLOC » (2026-11-04, capture jointe :
 * deux capsules « Reasoning 1 min 20 s », l'une au-dessus de l'orientation, l'autre dessous).
 *
 * Une orientation écrite pendant le tour se pose SOUS la bulle du tour ; la suite du raisonnement
 * s'écrit dans une bulle NEUVE du même tour, sous l'orientation (`patchLast`). La première bulle
 * reste « en cours » (`done` faux) — exprès : les battements d'une orchestration ouverte la visent
 * encore. Mais son chrono du raisonnement suivait `done` seul : il comptait jusqu'à la
 * fin du tour, alors que sa pensée était passée dans la bulle d'en dessous.
 *
 * Règle tenue ici : le raisonnement d'une bulle RELAYÉE par une bulle suivante du même tour s'arrête
 * à l'heure où la relève a commencé ; la relève, elle, continue de compter.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const TOUR = 'tour-oriente-conv-1547'

describe('ChatView — chrono du raisonnement après une orientation', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  /** Tour lancé il y a 2 min ; orientation ; la pensée reprend dessous 30 s après le début. */
  async function tourOrienteAvecRelance(): Promise<{ debut: number }> {
    const debut = Date.now() - 120_000
    let pilote!: (event: Record<string, unknown>) => void
    const abonnes = new Set<(event: Record<string, unknown>) => void>()
    let avecConsigne = false
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        conversation: vi.fn(async () => ({
          id: 'A',
          title: 'A',
          messages: [
            { role: 'user', content: 'refais l’anneau', messageId: 'm1' },
            ...(avecConsigne
              ? [
                  {
                    role: 'assistant',
                    content: '',
                    messageId: 'm2',
                    turnId: TOUR,
                    ts: debut,
                    status: 'streaming',
                    reasoning: 'Je pense que le reflet doit être sa propre couche.',
                    parts: []
                  },
                  {
                    role: 'user',
                    content: 'dans la vidéo tu lui as donné du relief',
                    messageId: 'm3',
                    orientation: true
                  }
                ]
              : [])
          ]
        })),
        pilotChat: vi.fn(() => new Promise(() => {})),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        }),
        onAppEvent: vi.fn((listener) => {
          abonnes.add(listener as (event: Record<string, unknown>) => void)
          return () => abonnes.delete(listener as (event: Record<string, unknown>) => void)
        })
      })
    )
    await h.click('.conv-pick')
    await h.type('refais l’anneau')
    await h.click('.composer-send')
    await act(async () =>
      pilote({
        conversationId: 'A',
        turnId: TOUR,
        kind: 'reasoning',
        text: 'Je pense que le reflet doit être sa propre couche.',
        at: debut
      })
    )
    // Une frame passe avant l'orientation, comme dans l'app : le tampon du flux est vidé.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    avecConsigne = true
    await act(async () => {
      for (const abonne of [...abonnes]) abonne({ type: 'refresh', scope: 'chat', convId: 'A' })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () =>
      pilote({
        conversationId: 'A',
        turnId: TOUR,
        kind: 'reasoning',
        text: 'Je vérifie que ffmpeg est disponible.',
        at: debut + 30_000
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    return { debut }
  }

  const capsules = (): HTMLElement[] =>
    [...h!.container.querySelectorAll<HTMLElement>('.msg.assistant')].map((bulle) =>
      bulle.querySelector<HTMLElement>('[data-testid="thinking-block-capsule"]')!
    )

  it('le raisonnement de la bulle relayée s’arrête à l’heure de la relève', async () => {
    await tourOrienteAvecRelance()
    const bulles = h!.container.querySelectorAll('.msg.assistant')
    expect(bulles).toHaveLength(2)
    const [premiere] = capsules()
    // 30 s : de début du tour à la reprise sous l'orientation — pas les 2 min du tour entier.
    expect(premiere.querySelector('[data-testid="thinking-block-secondes"]')?.textContent).toBe(
      '30 s'
    )
    expect(premiere.textContent).toContain('Raisonnement terminé')
  })

  it('la bulle de relève, elle, continue de compter le tour', async () => {
    await tourOrienteAvecRelance()
    const [, releve] = capsules()
    expect(releve.querySelector('[data-testid="thinking-block-secondes"]')?.textContent).toBe(
      '2 min'
    )
    expect(releve.textContent).not.toContain('terminé')
  })
})
