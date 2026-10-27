// @vitest-environment happy-dom
/**
 * « LANCER EN N FILS » CLIQUÉ DANS UNE FENÊTRE DE MOSAÏQUE, DE BOUT EN BOUT (conv-1147, 2026-10-25).
 *
 * Le scénario exact de la 2e relecture externe (note 74) : un tour se joue dans une fenêtre de
 * mosaïque qui n'est PAS le fil affiché en plein. Rien ne relit ce fil du disque
 * (`chat-event-routing.ts`) : à l'écran, la demande et la réponse qui porte la carte n'ont AUCUN
 * identifiant de message. Seul leur TOUR est connu.
 *
 * Rien n'est simulé entre la carte et le lancement : le vrai Markdown dessine la vraie carte dans
 * la vraie fenêtre, le clic part du bouton. Ce qui ferait échouer une version fausse :
 * - la carte grisée faute d'identifiant de message (régression vue à la note 74) ;
 * - le fil lu ailleurs que sur la fenêtre (le fil affiché en plein, A) ;
 * - le point de départ cherché dans la copie à l'écran : elle n'a d'identifiant que pour les
 *   messages ANCIENS, la branche partirait de B-m1 au lieu de B-m3.
 *
 * LE DISQUE N'EST PAS PRÉPARÉ D'AVANCE (4e relecture externe). Le faux processus principal ci-dessous
 * fait ce que fait le vrai : il tire un tour au hasard à l'envoi, enregistre la demande et la réponse
 * sous ce tour, puis ENREGISTRE chaque morceau AVANT de le diffuser à l'écran, avec ce même tour.
 * Que le vrai processus principal tienne ce contrat est prouvé à part, en faisant tourner le vrai tour
 * de chat : `main/chat/run-pilot-chat.tour-enregistre.test.ts`.
 *
 * AUCUNE ATTENTE À TEMPS FIXE : chaque étape attend un état précis (`attendreQue`), avec un plafond
 * qui ne sert qu'à échouer en nommant l'état qui n'est pas venu.
 */
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { CLE_DERNIERE_CONVERSATION } from './derniere-conversation'
import { EVT_LANCER_EN_FILS, type DemandeDeLancement } from './proposition-fils-evenements'

type Ecouteur = (event: unknown) => void
type MessageStocke = Record<string, unknown> & { role: string; messageId?: string; turnId?: string }

const CARTE =
  'Deux tâches indépendantes.\n\n```aw-fils\n' +
  JSON.stringify({
    taches: [
      { titre: 'T1', demande: 'fais T1', fichiers: ['src/a.ts'] },
      { titre: 'T2', demande: 'fais T2', fichiers: ['src/b.ts'] }
    ]
  }) +
  '\n```\n'

const ANCIENS: MessageStocke[] = [
  { role: 'user', content: 'fais autre chose', ts: 1, messageId: 'B-m1' },
  {
    role: 'assistant',
    content: 'ok',
    ts: 2,
    messageId: 'B-m2',
    turnId: 'B-t1',
    status: 'completed',
    parts: [{ kind: 'text', text: 'ok' }]
  }
]

const fil = (id: string, messages: unknown[]): Record<string, unknown> => ({
  id,
  title: `Fil ${id}`,
  provider: 'codex',
  updatedAt: 1,
  messages
})

/** Attend un ÉTAT, pas une durée. Le plafond ne sert qu'à échouer en nommant ce qui manque. */
async function attendreQue(
  quoi: string,
  condition: () => boolean,
  plafondMs = 5000
): Promise<void> {
  const limite = Date.now() + plafondMs
  while (!condition()) {
    if (Date.now() > limite) throw new Error(`état jamais atteint : ${quoi}`)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
}

describe('ChatView — « Lancer en N fils » cliqué dans une fenêtre de mosaïque', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  const demandes: DemandeDeLancement[] = []
  const noter = (event: Event): void => {
    demandes.push((event as CustomEvent<DemandeDeLancement>).detail)
  }
  afterEach(async () => {
    window.removeEventListener(EVT_LANCER_EN_FILS, noter)
    await h?.unmount()
    h = null
    window.localStorage.clear()
    demandes.length = 0
  })

  it('réponse peinte en direct, sans identifiant : la branche part de la demande, lue sur disque', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '["A","B"]')
    // A est le fil affiché en plein : c'est le seul que la vue relit du disque. B ne l'est pas.
    window.localStorage.setItem(CLE_DERNIERE_CONVERSATION, 'A')
    window.addEventListener(EVT_LANCER_EN_FILS, noter)

    // ── Le faux processus principal : le DISQUE de B, et le tour qu'il tire à l'envoi. ──
    const disqueB: MessageStocke[] = ANCIENS.map((m) => ({ ...m }))
    let tourEnCours: string | undefined
    const ecouteurs: Ecouteur[] = []
    const finDesTours: Array<() => void> = []
    const branches = new Set<string>()
    /** Enregistre d'abord, diffuse ensuite — et avec le MÊME tour (contrat prouvé côté main). */
    const diffuser = (evenement: { kind: string; text?: string }): void => {
      const reponse = disqueB.find((m) => m.role === 'assistant' && m.turnId === tourEnCours)!
      if (evenement.kind === 'delta') {
        reponse.content = `${String(reponse.content)}${evenement.text}`
        reponse.parts = [{ kind: 'text', text: reponse.content }]
      }
      if (evenement.kind === 'done') reponse.status = 'completed'
      for (const ecouteur of ecouteurs)
        ecouteur({ ...evenement, streamId: '0:0', conversationId: 'B', turnId: tourEnCours })
    }
    const disqueDe = (id: string): Record<string, unknown> => {
      if (id === 'A') return fil('A', [{ role: 'user', content: 'rien', ts: 1, messageId: 'A-m1' }])
      if (id === 'B') return fil('B', disqueB)
      return fil(id, disqueB.slice(0, 3))
    }
    const api = chatApi({
      conversations: vi.fn(async () => ['A', 'B', ...branches].map((id) => disqueDe(id))),
      conversation: vi.fn(async (id: string) => disqueDe(id)),
      onPilotEvent: vi.fn((ecouteur: Ecouteur) => {
        ecouteurs.push(ecouteur)
        return vi.fn()
      }),
      pilotChat: vi.fn((payload: Array<{ content: string }>, convId: string) => {
        if (convId === 'B' && !tourEnCours) {
          // Comme `beginTurn` : la demande et la réponse en cours entrent sur disque, sous un
          // tour tiré ICI — le test ne le choisit pas.
          tourEnCours = `tour-${crypto.randomUUID()}`
          disqueB.push(
            { role: 'user', content: payload.at(-1)?.content, ts: 3, messageId: 'B-m3' },
            {
              role: 'assistant',
              content: '',
              ts: 4,
              messageId: 'B-m4',
              turnId: tourEnCours,
              status: 'streaming',
              parts: []
            }
          )
        }
        return new Promise((resolve) => finDesTours.push(() => resolve({ ok: true, messages: [] })))
      }),
      conversationsFork: vi.fn(async () => {
        const id = `B-${branches.size + 1}`
        branches.add(id)
        return fil(id, disqueB.slice(0, 3))
      }),
      conversationsRename: vi.fn(async (id: string, title: string) => ({ id, title }))
    })
    h = await mountChat(api)
    const fenetre = (id: string): HTMLElement | null =>
      h!.container.querySelector<HTMLElement>(`[data-testid="chat-mosaic"] [data-conv-id="${id}"]`)
    await attendreQue('fenêtre B ouverte avec sa saisie', () =>
      Boolean(fenetre('B')?.querySelector('textarea'))
    )

    // 1) L'utilisateur tape sa demande dans la fenêtre B et l'envoie.
    const saisie = fenetre('B')!.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        saisie,
        'fais T1 et T2'
      )
      saisie.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      saisie.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await attendreQue('tour parti dans B', () => tourEnCours !== undefined)

    // 2) Le tour se joue EN DIRECT dans B.
    await act(async () => diffuser({ kind: 'delta', text: CARTE }))
    await act(async () => {
      diffuser({ kind: 'done' })
      for (const fin of finDesTours.splice(0)) fin()
    })
    const boutonLancer = (): HTMLButtonElement | undefined =>
      [
        ...(fenetre('B')?.querySelectorAll<HTMLButtonElement>(
          '[data-testid="proposition-fils"] button'
        ) ?? [])
      ].find((b) => /Lancer en 2 fils/u.test(b.textContent ?? ''))
    await attendreQue('carte de B active', () => boutonLancer()?.disabled === false)

    // Le décor est bien celui du défaut : à l'écran, la réponse n'a que son tour — celui que le
    // faux processus principal a tiré, pas une valeur du test.
    const ligne = boutonLancer()!.closest('[data-turn-id]')
    expect(ligne?.getAttribute('data-turn-id')).toBe(tourEnCours)
    expect(ligne?.getAttribute('data-message-id') ?? null).toBeNull()

    // 3) Le clic sur la vraie carte.
    await act(async () => boutonLancer()!.click())
    const envois = (): Array<{ fil: string; texte: string }> =>
      (api.pilotChat as ReturnType<typeof vi.fn>).mock.calls.map((appel) => ({
        fil: appel[1] as string,
        texte: (appel[0] as Array<{ content: string }>).at(-1)?.content ?? ''
      }))
    await attendreQue('une tâche partie dans chaque branche', () =>
      ['B-1', 'B-2'].every((id) => envois().some((envoi) => envoi.fil === id))
    )
    const recu = (): string =>
      fenetre('B')?.querySelector('[data-testid="proposition-fils"]')?.textContent ?? ''
    await attendreQue('reçu sur la carte de B', () => /Lancé/u.test(recu()))

    expect(demandes).toHaveLength(1)
    expect(demandes[0]).toMatchObject({ conversationId: 'B', turnId: tourEnCours })
    expect(demandes[0]!.messageId).toBeUndefined()

    // Le point de départ vient du DISQUE : la demande B-m3, pas B-m1 (dernière à avoir un
    // identifiant dans la copie à l'écran).
    expect((api.conversationsFork as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['B', 'B-m3'],
      ['B', 'B-m3']
    ])
    expect(
      envois()
        .find((envoi) => envoi.fil === 'B-1')
        ?.texte.startsWith('fais T1')
    ).toBe(true)
    expect(
      envois()
        .find((envoi) => envoi.fil === 'B-2')
        ?.texte.startsWith('fais T2')
    ).toBe(true)

    // B reste à sa place, les branches s'ajoutent ; la carte de B nomme les deux fils.
    const fenetres = [
      ...h!.container.querySelectorAll('[data-testid="chat-mosaic"] [data-conv-id]')
    ].map((f) => f.getAttribute('data-conv-id'))
    expect(fenetres).toEqual(['A', 'B', 'B-1', 'B-2'])
    expect(recu()).toContain('B-1')
    expect(recu()).toContain('B-2')
  })
})
