// @vitest-environment happy-dom
/**
 * « CETTE CONV A PLANTÉ » ALORS QUE LE RUN TOURNAIT (conv-955, 2026-10-15).
 *
 * Tour `33bc18ab-a9f3-4bac-8058-ec4838c647b8` : une orchestration (action `0:0`) lancée à 08:28:37.
 * Orientations tapées pendant le run à 08:53:16 et 08:53:27 (saisies ts 1792054396405 et
 * 1792054407546). Le main les écrit dans le fil et diffuse `refresh/chat` : l'écran relit le fil du
 * disque, qui pose l'orientation APRÈS la bulle du tour. Dès l'évènement suivant, `patchLast` ne
 * trouvait plus de bulle « en fin de fil » et en ouvrait une VIDE sous l'orientation. Les battements
 * de l'orchestration (« 52 min 10 s · clean · Bash en cours - npx vitest run… ») visaient l'action
 * `0:0`, absente de cette bulle neuve : ils étaient jetés. L'utilisateur a vu 29 minutes d'un bloc
 * « Raisonnement » vide (capture jointe à la saisie ts 1792056140576), a conclu au plantage et a
 * arrêté le run en pleine étape de nettoyage, 11,44 $ dépensés.
 *
 * Règle tenue ici : un évènement qui vise une action DÉJÀ posée (battement, résultat, ligne de
 * pipeline) rejoint la bulle qui la porte, même au-dessus d'une orientation ; le TEXTE nouveau
 * continue de s'écrire sous l'orientation (ChatView.consigne-pendant-tour-ordre.test.tsx).
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const TOUR = '33bc18ab-a9f3-4bac-8058-ec4838c647b8'

describe('ChatView — progression d’une orchestration après une orientation', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  async function tourOrchestreAvecOrientation(): Promise<{
    pilote: (event: Record<string, unknown>) => void
    appEvent: (event: Record<string, unknown>) => void
  }> {
    let pilote!: (event: Record<string, unknown>) => void
    const abonnes = new Set<(event: Record<string, unknown>) => void>()
    const appEvent = (event: Record<string, unknown>): void => {
      for (const abonne of [...abonnes]) abonne(event)
    }
    let avecConsigne = false
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        // Ce que le disque rend APRÈS l'écriture de l'orientation : la bulle du tour, encore en
        // cours, puis l'orientation — exactement le fil de conv-955 à 08:53:27.
        conversation: vi.fn(async () => ({
          id: 'A',
          title: 'A',
          messages: [
            { role: 'user', content: 'traite le candidat effort', messageId: 'm1' },
            ...(avecConsigne
              ? [
                  {
                    role: 'assistant',
                    content: '',
                    messageId: 'm2',
                    turnId: TOUR,
                    status: 'streaming',
                    parts: [
                      { kind: 'text', text: 'Je lance le travail complet.' },
                      {
                        kind: 'action',
                        actionId: '0:0',
                        name: 'orchestrate',
                        args: { task: 'effort par étape' }
                      }
                    ]
                  },
                  {
                    role: 'user',
                    content: 'enleve le titre conversations',
                    messageId: 'm3',
                    orientation: true,
                    coupeLaReponse: 2
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
        // TOUS les abonnés reçoivent l'événement, comme le vrai preload (`ipcRenderer.on`). Garder
        // le seul DERNIER abonné rendait ce test faux dès qu'un composant monté dans le chat
        // s'abonnait après ChatView : le `refresh` n'atteignait plus le fil (conv-1056).
        onAppEvent: vi.fn((listener) => {
          abonnes.add(listener as (event: Record<string, unknown>) => void)
          return () => abonnes.delete(listener as (event: Record<string, unknown>) => void)
        })
      })
    )
    await h.click('.conv-pick')
    await h.type('traite le candidat effort')
    await h.click('.composer-send')
    await act(async () => {
      pilote({
        conversationId: 'A',
        turnId: TOUR,
        kind: 'delta',
        text: 'Je lance le travail complet.',
        streamId: 's1'
      })
      pilote({
        conversationId: 'A',
        turnId: TOUR,
        kind: 'command',
        actionId: '0:0',
        name: 'orchestrate',
        args: { task: 'effort par étape' }
      })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    // L'orientation est acceptée : le main l'écrit dans le fil et demande une relecture.
    avecConsigne = true
    await act(async () => appEvent({ type: 'refresh', scope: 'chat', convId: 'A' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    return { pilote, appEvent }
  }

  it('le battement du run reste visible après l’orientation, sans bulle vide sous elle', async () => {
    const { pilote } = await tourOrchestreAvecOrientation()

    await act(async () =>
      pilote({
        conversationId: 'A',
        turnId: TOUR,
        kind: 'action-progress',
        actionId: '0:0',
        text: '52 min 10 s · clean · Bash en cours - npx vitest run src/renderer'
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const texte = h!.container.textContent ?? ''
    // Ce que l'utilisateur n'a pas vu : la preuve que le run avançait.
    expect(texte).toContain('npx vitest run src/renderer')
    // Et aucune bulle vide ouverte sous l'orientation par un battement qui ne la concerne pas.
    expect(h!.container.querySelectorAll('.msg.assistant')).toHaveLength(1)
    expect(texte.indexOf('enleve le titre conversations')).toBeGreaterThan(
      texte.indexOf('Je lance le travail complet.')
    )
  })

  it('le texte NOUVEAU de l’agent s’écrit toujours sous l’orientation', async () => {
    const { pilote } = await tourOrchestreAvecOrientation()

    await act(async () =>
      pilote({
        conversationId: 'A',
        turnId: TOUR,
        kind: 'delta',
        text: 'Orientation prise en compte.',
        streamId: 's2'
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })

    const texte = h!.container.textContent ?? ''
    expect(texte.indexOf('enleve le titre conversations')).toBeLessThan(
      texte.indexOf('Orientation prise en compte.')
    )
  })

  it('le verdict de l’orchestration clôt l’action dans SA bulle, au-dessus de l’orientation', async () => {
    const { pilote } = await tourOrchestreAvecOrientation()

    await act(async () =>
      pilote({
        conversationId: 'A',
        turnId: TOUR,
        kind: 'action-progress',
        actionId: '0:0',
        text: '52 min 50 s · clean · Bash en cours'
      })
    )
    await act(async () =>
      pilote({
        conversationId: 'A',
        turnId: TOUR,
        kind: 'result',
        actionId: '0:0',
        name: 'orchestrate',
        ok: false,
        data: { valid: false }
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const texte = h!.container.textContent ?? ''
    // Le battement disparaît au verdict : l'action a bien été close là où elle vivait.
    expect(texte).not.toContain('52 min 50 s')
    expect(h!.container.querySelectorAll('.msg.assistant')).toHaveLength(1)
  })
})
