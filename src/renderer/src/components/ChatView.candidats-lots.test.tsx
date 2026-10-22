// @vitest-environment happy-dom
/**
 * LES LOTS DU WORKFLOW INTELLIGENT, CÂBLÉS DANS LE FIL (conv-1080, 2026-10-22).
 *
 * Le panneau découpe une sélection mixte en lots ; ChatView doit envoyer le PREMIER tout de suite et
 * garder les suivants dans la file du fil, visibles (reçu « Lot suivant »), jusqu'à la fin du tour.
 * Entrées qui font échouer ce test si le câblage est faux : les deux lots partent ensemble (deux runs
 * en même temps sur le dépôt), le lot 2 se perd (jamais envoyé), ou il attend sans rien afficher.
 *
 * LIMITE DE QUOTA : un lot coupé par la limite d'abonnement (le tour échoue, ou son run bute dessus
 * et le tour se clôt quand même) RETIENT les suivants — ils partaient aussitôt dans le même mur et
 * la sélection se vidait en échecs. Ils attendent la reprise du fil et partent à sa fin.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

const TEXTE_SCOUT = [
  '| Score | Type | Quoi | Ancrage | Preuve |',
  '| ---: | --- | --- | --- | --- |',
  '| 92 | fix | Compteur jamais remis | src/a.ts:1 | reste à 3 |',
  '| 84 | new | Vue des couts | src/b.ts:2 | relus a la main |'
].join('\n')

const fil = (): unknown[] => [
  { role: 'user', content: 'scout' },
  { role: 'assistant', done: true, parts: [{ kind: 'text', text: TEXTE_SCOUT }] }
]

let h: Harness | null = null
beforeAll(installRafShim)
afterEach(async () => {
  await h?.unmount()
  h = null
  window.localStorage.clear()
  vi.restoreAllMocks()
})

/** Le DERNIER message utilisateur de chaque appel au pilote : ce qui est parti, appel par appel. */
const envois = (pilotChat: ReturnType<typeof vi.fn>): string[] =>
  pilotChat.mock.calls.map((appel) => {
    const messages = Array.isArray(appel[0])
      ? (appel[0] as { role: string; content?: string }[])
      : []
    return messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''
  })

/**
 * Un `pilotChat` SIMULÉ qui dit la vérité : un tour vit tant que sa réponse n'est pas rendue, et
 * `pilotChatActive` le confirme. Le faux qui répondait tout de suite clôturait le tour du lot 1
 * PENDANT le clic : sous charge, le lot 2 partait avec lui et le test tombait au hasard.
 */
const piloteFidele = (): {
  pilotChat: ReturnType<typeof vi.fn>
  pilotChatActive: ReturnType<typeof vi.fn>
  /** Rend la réponse du tour en vol, puis attend (2 s au plus) l'envoi suivant. */
  rendre: () => Promise<void>
} => {
  let tourEnVol = false
  let retour: ((reponse: unknown) => void) | undefined
  const pilotChat = vi.fn(
    () =>
      new Promise((resolve) => {
        tourEnVol = true
        retour = resolve
      })
  )
  const pilotChatActive = vi.fn(async () => ({ active: tourEnVol }))
  const rendre = async (): Promise<void> => {
    const avant = pilotChat.mock.calls.length
    await act(async () => {
      tourEnVol = false
      retour?.({ ok: true })
      for (let attente = 0; attente < 200 && pilotChat.mock.calls.length === avant; attente++)
        await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  return { pilotChat, pilotChatActive, rendre }
}

describe('ChatView — les lots d’une sélection scout', () => {
  it('lot 1 tout de suite, lot 2 en file et visible, puis envoyé à la fin du tour', async () => {
    let handler: ((event: unknown) => void) | undefined
    const { pilotChat, pilotChatActive, rendre } = piloteFidele()
    h = await mountChat(
      chatApi({
        pilotChat,
        pilotChatActive,
        onPilotEvent: vi.fn((cb: (event: unknown) => void) => {
          handler = cb
          return vi.fn()
        }),
        conversations: vi.fn().mockResolvedValue([conversation('A', fil())]),
        conversation: vi.fn(async (id: string) => conversation(id, fil()))
      })
    )
    await h.click('.conv-item .conv-pick')
    const bouton = h.container.querySelector<HTMLButtonElement>('[data-testid="cpick-lancer"]')
    expect(bouton?.textContent, 'la sélection mixte doit faire deux lots').toBe(
      'Lancer le workflow intelligent (2 lots)'
    )
    await h.click('[data-testid="cpick-lancer"]')

    const premiers = envois(pilotChat)
    expect(premiers, 'un seul run part : jamais deux lots en même temps').toHaveLength(1)
    expect(premiers[0]!.split('\n')[0]).toBe('/build')
    expect(premiers[0]).toContain('Compteur jamais remis')
    expect(premiers[0]).not.toContain('Vue des couts')
    expect(h.container.textContent, 'le lot en attente doit se voir dans le fil').toContain(
      'Lot suivant de la sélection'
    )

    await act(async () => {
      handler?.({ conversationId: 'A', kind: 'done' })
      await Promise.resolve()
      await Promise.resolve()
    })
    await rendre()
    const tous = envois(pilotChat)
    expect(tous, 'le lot 2 part à la fin du tour du lot 1').toHaveLength(2)
    expect(tous[1]).toContain('Vue des couts')
    expect(tous[1]).toContain('Lot 2 sur 2 de la sélection')
    expect(tous[1]).not.toMatch(/^\/build/u)
    expect(h.container.textContent, 'parti, son reçu d’attente disparaît').not.toContain(
      'Lot suivant de la sélection'
    )
  })

  it('le lot 2 part aussi quand on regarde un AUTRE fil à la fin du lot 1', async () => {
    let handler: ((event: unknown) => void) | undefined
    const { pilotChat, pilotChatActive, rendre } = piloteFidele()
    const fils: Record<string, unknown[]> = { A: fil(), B: [] }
    h = await mountChat(
      chatApi({
        pilotChat,
        pilotChatActive,
        onPilotEvent: vi.fn((cb: (event: unknown) => void) => {
          handler = cb
          return vi.fn()
        }),
        conversations: vi
          .fn()
          .mockResolvedValue([conversation('A', fils.A), conversation('B', fils.B)]),
        conversation: vi.fn(async (id: string) => conversation(id, fils[id] ?? []))
      })
    )
    const choisir = async (titre: string): Promise<void> => {
      const item = Array.from(h!.container.querySelectorAll<HTMLElement>('.conv-item')).find(
        (element) => element.textContent?.includes(titre)
      )
      expect(item, `fil « ${titre} » introuvable dans la barre`).toBeDefined()
      await act(async () => {
        item!.querySelector<HTMLElement>('.conv-pick')!.click()
        await Promise.resolve()
      })
    }
    await choisir('Conversation A')
    await h.click('[data-testid="cpick-lancer"]')
    expect(envois(pilotChat)).toHaveLength(1)

    await choisir('Conversation B')
    await act(async () => {
      handler?.({ conversationId: 'A', kind: 'done' })
      await Promise.resolve()
      await Promise.resolve()
    })
    await rendre()
    expect(
      pilotChat.mock.calls,
      'le lot 2 ne doit pas attendre le retour sur le fil A'
    ).toHaveLength(2)
    expect(envois(pilotChat)[1]).toContain('Lot 2 sur 2 de la sélection')
    expect(pilotChat.mock.calls[1]![1], 'il part dans le fil A, pas dans celui affiché').toBe('A')
  })

  /** Le refus RÉELLEMENT enregistré sur un tour coupé (conv-1055, tour de 11:01). */
  const REFUS_QUOTA =
    "Claude a interrompu l'appel : You've hit your session limit · resets 11:30am (Europe/Paris)"

  /**
   * Un processus principal SIMULÉ qui dit la vérité, comme `ChatView.stop-puis-message` : un tour vit
   * tant que sa promesse `pilotChat` n'est pas revenue, et `pilotChatActive` le confirme. Un faux qui
   * répondait tout de suite clôturait la reprise à son départ — elle semblait finie avant d'avoir
   * commencé, et relâchait le lot 2 avec elle.
   */
  const monterAvecLots = async (
    fils: Record<string, unknown[]> = { A: fil() }
  ): Promise<{
    pilotChat: ReturnType<typeof vi.fn>
    /** Un événement pilote du tour en cours, sans le finir. */
    emettre: (event: Record<string, unknown>) => Promise<void>
    /** Fin du tour : l'événement terminal, puis le retour de `pilotChat` (comme le main). */
    finir: (event: Record<string, unknown>) => Promise<void>
    /** Le seul retour de `pilotChat`, quand l'événement terminal a déjà été rendu à part. */
    repondre: () => Promise<void>
  }> => {
    let handler: ((event: unknown) => void) | undefined
    let tourEnVol = false
    let retourDuTour: ((reponse: unknown) => void) | undefined
    const pilotChat = vi.fn(
      () =>
        new Promise((resolve) => {
          tourEnVol = true
          retourDuTour = resolve
        })
    )
    h = await mountChat(
      chatApi({
        pilotChat,
        pilotChatActive: vi.fn(async () => ({ active: tourEnVol })),
        onPilotEvent: vi.fn((cb: (event: unknown) => void) => {
          handler = cb
          return vi.fn()
        }),
        conversations: vi
          .fn()
          .mockResolvedValue(
            Object.entries(fils).map(([id, messages]) => conversation(id, messages))
          ),
        conversation: vi.fn(async (id: string) => conversation(id, fils[id] ?? []))
      })
    )
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="cpick-lancer"]')
    expect(envois(pilotChat), 'le lot 1 part seul').toHaveLength(1)
    const emettre = async (event: Record<string, unknown>): Promise<void> => {
      await act(async () => {
        handler?.({ conversationId: 'A', ...event })
        await Promise.resolve()
        await Promise.resolve()
      })
    }
    // L'événement terminal et le retour de `pilotChat` partent l'un derrière l'autre du main, dans
    // CET ordre, et arrivent avant que la vue ne se redessine : un seul `act` les tient ensemble.
    const finir = async (event: Record<string, unknown>): Promise<void> => {
      await act(async () => {
        handler?.({ conversationId: 'A', ...event })
        tourEnVol = false
        retourDuTour?.(
          event.kind === 'error' ? { ok: false, error: String(event.text ?? '') } : { ok: true }
        )
        // La clôture de `send` attend deux images avant de relâcher le fil (rAF = setTimeout 0).
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
    }
    // La file ne repart qu'à la FIN de la clôture de `send` (deux images, sonde du main, réponse
    // affichée, puis deux images encore) : on attend jusqu'au prochain envoi, borné à 2 s, plutôt
    // qu'un délai deviné qui casse sous charge.
    const repondre = async (): Promise<void> => {
      const avant = pilotChat.mock.calls.length
      await act(async () => {
        tourEnVol = false
        retourDuTour?.({ ok: true })
        for (let attente = 0; attente < 200 && pilotChat.mock.calls.length === avant; attente++)
          await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
    return { pilotChat, emettre, finir, repondre }
  }

  /**
   * LA FIN DU TOUR S'AFFICHE AVANT LA RÉPONSE DE `pilotChat` — l'ordre où le main les envoie, chacun
   * dans son message : la vue peut se redessiner entre les deux. Le fil y redevient libre (`busy`
   * tombe au `done`) alors que le verrou d'envoi tient jusqu'à la réponse. Le lot 2 sortait de la
   * file, butait sur ce verrou et disparaissait sans un mot (même perte que conv-996, côté file).
   */
  it('fin du tour affichée avant la réponse de pilotChat : le lot 2 part quand même, après elle', async () => {
    const { pilotChat, emettre, repondre } = await monterAvecLots()

    await emettre({ kind: 'done' })
    expect(
      envois(pilotChat),
      'rien ne part tant que le lot 1 n’a pas rendu sa réponse'
    ).toHaveLength(1)
    expect(h!.container.textContent, 'le lot 2 attend, visible').toContain(
      'Lot suivant de la sélection'
    )

    await repondre()
    const tous = envois(pilotChat)
    expect(tous, 'le lot 2 doit partir, pas disparaître').toHaveLength(2)
    expect(tous[1]).toContain('Vue des couts')
  })

  it('lot coupé par la limite de quota : le suivant reste en file, et part à la fin de la reprise', async () => {
    const { pilotChat, finir } = await monterAvecLots()

    await finir({ kind: 'error', text: REFUS_QUOTA })
    expect(envois(pilotChat), 'le lot 2 ne doit pas partir dans le même mur').toHaveLength(1)
    expect(h!.container.textContent, 'le lot retenu dit pourquoi il attend').toContain(
      'retenu : le lot précédent a été coupé par la limite de quota'
    )

    // La reprise : l'utilisateur relance le fil. Le lot 2 attend encore — la fin de CE tour.
    await h!.type('Reprends le lot coupé')
    await h!.click('.composer-send')
    const pendantReprise = envois(pilotChat)
    expect(pendantReprise, 'seule la reprise part, pas le lot 2 avec elle').toHaveLength(2)
    expect(pendantReprise[1]).toBe('Reprends le lot coupé')
    expect(h!.container.textContent, 'pendant la reprise, il attend la fin du tour').toContain(
      'il partira tout seul à la fin du tour en cours'
    )

    await finir({ kind: 'done' })
    const tous = envois(pilotChat)
    expect(tous, 'la reprise finie sans mur, le lot 2 part').toHaveLength(3)
    expect(tous[2]).toContain('Lot 2 sur 2 de la sélection')
    expect(tous[2]).toContain('Vue des couts')
  })

  it('le RUN du lot bute sur la limite mais le tour se clôt : le suivant reste aussi en file', async () => {
    const { pilotChat, emettre, finir } = await monterAvecLots()

    // Forme réelle (agent-pilot.ts) : l'action `orchestrate` échoue sur le refus, puis le modèle
    // reprend la parole et clôt son tour normalement.
    await emettre({ kind: 'command', name: 'orchestrate', actionId: '0:0', args: {} })
    await emettre({
      kind: 'result',
      name: 'orchestrate',
      actionId: '0:0',
      ok: false,
      data: "Phase build — claude : You've hit your session limit · resets 1pm (Europe/Paris)"
    })
    await finir({ kind: 'done' })
    expect(envois(pilotChat), 'le run suspendu retient le lot 2').toHaveLength(1)
    expect(h!.container.textContent).toContain(
      'retenu : le lot précédent a été coupé par la limite de quota'
    )
  })

  it('fil quitté pendant le lot coupé : le lot 2 reste aussi en file, sur le fil A comme ailleurs', async () => {
    const { pilotChat, finir } = await monterAvecLots({ A: fil(), B: [] })
    const itemB = Array.from(h!.container.querySelectorAll<HTMLElement>('.conv-item')).find(
      (element) => element.textContent?.includes('Conversation B')
    )
    expect(itemB, 'fil B introuvable dans la barre').toBeDefined()
    await act(async () => {
      itemB!.querySelector<HTMLElement>('.conv-pick')!.click()
      await Promise.resolve()
    })

    await finir({ kind: 'error', text: REFUS_QUOTA })
    expect(envois(pilotChat), 'regardé ailleurs, le lot 2 ne part pas non plus').toHaveLength(1)

    // Retour sur A : l'ouverture du fil ne relâche pas non plus le lot retenu.
    const itemA = Array.from(h!.container.querySelectorAll<HTMLElement>('.conv-item')).find(
      (element) => element.textContent?.includes('Conversation A')
    )
    await act(async () => {
      itemA!.querySelector<HTMLElement>('.conv-pick')!.click()
      await Promise.resolve()
    })
    expect(envois(pilotChat), 'rouvrir le fil n’est pas une reprise').toHaveLength(1)
  })

  it('un tour en échec pour une autre raison relâche le lot suivant comme avant', async () => {
    const { pilotChat, finir } = await monterAvecLots()

    await finir({ kind: 'error', text: 'Le processus Claude s’est arrêté (code 1).' })
    const tous = envois(pilotChat)
    expect(
      tous,
      'seul le mur de quota retient : une autre erreur ne gèle pas la file'
    ).toHaveLength(2)
    expect(tous[1]).toContain('Lot 2 sur 2 de la sélection')
  })
})
