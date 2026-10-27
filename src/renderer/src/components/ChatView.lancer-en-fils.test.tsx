// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { cleDuLancement, planDesFils, type TacheDeFil } from '../../../shared/lancer-en-fils'
import {
  EVT_FILS_LANCES,
  EVT_LANCER_EN_FILS,
  type ConfirmationDeLancement,
  type DemandeDeLancement
} from './proposition-fils-evenements'

/**
 * « LANCER EN N FILS » DE BOUT EN BOUT (conv-1147, 2026-10-25). La carte ```aw-fils émet une
 * demande. ChatView ouvre une branche du fil par groupe de tâches, chacune à partir du message de
 * l'utilisateur. Chaque branche reçoit SA première tâche, et les tâches qui touchent les mêmes
 * fichiers attendent à la suite dans la même branche.
 *
 * Les entrées qui font échouer une version fausse :
 * - une tâche du même groupe envoyée en même temps que la première (deux tours sur un même fichier) ;
 * - une branche partie de la réponse de l'agent, qui recopierait la carte et ses boutons ;
 * - une branche refusée qui ferait taire les autres ;
 * - le mode « ici » qui ouvrirait des branches.
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const fil = (id: string, title = id, pieces?: unknown[]): Record<string, unknown> => ({
  id,
  title,
  provider: 'codex',
  updatedAt: 1,
  messages: [
    {
      role: 'user',
      content: 'fais T1, T2 et T3',
      ts: 1,
      messageId: `${id}-m1`,
      ...(pieces ? { attachments: pieces } : {})
    },
    {
      role: 'assistant',
      content: 'carte',
      ts: 1,
      messageId: `${id}-m2`,
      turnId: `${id}-t1`,
      status: 'completed',
      parts: [{ kind: 'text', text: 'carte' }]
    }
  ]
})

const tache = (n: number, fichier: string): TacheDeFil => ({
  titre: `T${n}`,
  demande: `fais T${n}`,
  fichiers: [fichier]
})
// T1 et T3 touchent le même fichier : un fil T1 puis T3 ; T2 part seul.
const TACHES = [tache(1, 'src/a.ts'), tache(2, 'src/b.ts'), tache(3, 'src/a.ts')]

describe('ChatView — « Lancer en N fils »', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let api: Record<string, unknown>
  let confirmations: ConfirmationDeLancement[]
  /** Les tours en cours : chaque appel au modèle IA reste ouvert jusqu'à `finirLesTours`. */
  let liberations: Array<() => void>
  const ecouter = (event: Event): void => {
    confirmations.push((event as CustomEvent<ConfirmationDeLancement>).detail)
  }

  /** Pannes simulées APRÈS le montage : la liste des fils, ou le renommage d'une branche. */
  let pannes: { liste?: boolean; renommage?: string; lecture?: boolean } = {}
  /** Le fil d'origine tel que STOCKÉ, quand un test le veut plus long que `fil()`. */
  let origineStockee: Record<string, unknown> | null = null

  async function monter(refuserLaBranche?: number, pieces?: unknown[]): Promise<void> {
    window.localStorage.clear()
    confirmations = []
    liberations = []
    pannes = {}
    window.addEventListener(EVT_FILS_LANCES, ecouter)
    const branches = ['A-1', 'A-2'].map((id) => fil(id, 'Copie', pieces))
    let rang = 0
    let listes = 0
    api = chatApi({
      conversations: vi.fn(async () => {
        if (pannes.liste) throw new Error('liste indisponible')
        listes += 1
        const origine = origineStockee ?? fil('A', 'Trois tâches')
        return listes === 1 ? [origine] : [origine, ...branches]
      }),
      conversation: vi.fn(async (id: string) => {
        if (id === 'A' && pannes.lecture) throw new Error('lecture impossible')
        if (id === 'A' && origineStockee) return origineStockee
        return fil(id, 'Copie', pieces)
      }),
      conversationsFork: vi.fn(async () => {
        rang += 1
        return rang === refuserLaBranche ? undefined : branches[rang - 1]
      }),
      conversationsRename: vi.fn(async (id: string, title: string) => {
        if (pannes.renommage === id) throw new Error('renommage refusé')
        return { id, title }
      }),
      pilotChat: vi.fn(
        () =>
          new Promise((resolve) => {
            liberations.push(() => resolve({ ok: true, messages: [] }))
          })
      )
    })
    h = await mountChat(api)
    await h.click('.conv-pick')
  }

  afterEach(async () => {
    window.removeEventListener(EVT_FILS_LANCES, ecouter)
    origineStockee = null
    await h?.unmount()
    h = null
  })

  async function demander(partiel: Partial<DemandeDeLancement> = {}): Promise<void> {
    const demande: DemandeDeLancement = {
      mode: 'fils',
      plan: planDesFils(TACHES),
      cle: cleDuLancement('source'),
      conversationId: 'A',
      messageId: 'A-m2',
      ...partiel
    }
    await act(async () => {
      window.dispatchEvent(new CustomEvent(EVT_LANCER_EN_FILS, { detail: demande }))
      for (let i = 0; i < 12; i += 1) await Promise.resolve()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }

  async function finirLesTours(): Promise<void> {
    for (let tour = 0; tour < 4; tour += 1) {
      await act(async () => {
        for (const liberer of liberations.splice(0)) liberer()
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
    }
  }

  const envois = (): Array<{ fil: string; texte: string }> =>
    (api.pilotChat as ReturnType<typeof vi.fn>).mock.calls.map((appel) => ({
      fil: appel[1] as string,
      texte: (appel[0] as Array<{ content: string }>).at(-1)?.content ?? ''
    }))

  it('un fil par groupe, depuis le message de l’utilisateur ; la tâche sur le même fichier attend', async () => {
    await monter()
    await demander()

    // Deux groupes = deux branches, toutes deux depuis le message de l'UTILISATEUR (A-m1).
    expect((api.conversationsFork as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['A', 'A-m1'],
      ['A', 'A-m1']
    ])
    expect(api.conversationsRename).toHaveBeenCalledWith('A-1', 'T1 + T3')
    expect(api.conversationsRename).toHaveBeenCalledWith('A-2', 'T2')

    const partis = envois()
    expect(partis.map((envoi) => envoi.fil).sort()).toEqual(['A-1', 'A-2'])
    const premier = partis.find((envoi) => envoi.fil === 'A-1')!.texte
    expect(premier.startsWith('fais T1')).toBe(true)
    expect(premier).toContain('« T2 »')
    expect(partis.find((envoi) => envoi.fil === 'A-2')!.texte.startsWith('fais T2')).toBe(true)
    // T3 touche le même fichier que T1 : pendant le tour de T1, elle attend.
    expect(partis.some((envoi) => envoi.texte.startsWith('fais T3'))).toBe(false)

    expect(h!.container.querySelector('[data-testid="chat-mosaic"]')).not.toBeNull()
    // Le fil d'ORIGINE reste ouvert à côté des branches : sa carte y montre le reçu (demande du
    // 2026-10-25, conv-1147 : « garde le fil d'origine visible dans la mosaïque »).
    const fenetres = [
      ...h!.container.querySelectorAll('[data-testid="chat-mosaic"] [data-conv-id]')
    ].map((fenetre) => fenetre.getAttribute('data-conv-id'))
    expect(fenetres).toEqual(['A', 'A-1', 'A-2'])
    // Le reçu est ÉCRIT par ChatView, pas seulement annoncé : la carte du chat plein est démontée
    // par le passage en mosaïque avant la confirmation, et celle de la fenêtre peut naître après.
    expect(JSON.parse(window.localStorage.getItem(cleDuLancement('source')) ?? 'null')).toEqual({
      mode: 'fils',
      fils: [
        { id: 'A-1', titre: 'T1 + T3' },
        { id: 'A-2', titre: 'T2' }
      ]
    })
    expect(confirmations).toEqual([
      {
        cle: cleDuLancement('source'),
        mode: 'fils',
        fils: [
          { id: 'A-1', titre: 'T1 + T3' },
          { id: 'A-2', titre: 'T2' }
        ]
      }
    ])
    expect(h!.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent).toMatch(
      /2 fils lancés.*Coût : 3 tours/u
    )

    // Le tour de T1 fini, T3 part à son tour, dans LA MÊME branche, et nulle part ailleurs.
    await finirLesTours()
    const apres = envois()
    const t3 = apres.filter((envoi) => envoi.texte.startsWith('fais T3'))
    expect(t3.map((envoi) => envoi.fil)).toEqual(['A-1'])
    expect(apres.findIndex((envoi) => envoi.texte.startsWith('fais T3'))).toBeGreaterThan(
      apres.findIndex((envoi) => envoi.texte.startsWith('fais T1'))
    )
  })

  it('une branche refusée ne fait pas taire l’autre, et le refus est dit', async () => {
    await monter(1)
    await demander()
    expect(envois().map((envoi) => envoi.fil)).toEqual(['A-2'])
    expect(confirmations[0]!.fils).toEqual([{ id: 'A-2', titre: 'T2' }])
    expect(confirmations[0]!.refus?.[0]).toMatch(/T1 \+ T3.*refusée/u)
    // Une branche est PARTIE : jamais « rien n'est parti ». Sinon la carte rendrait ses boutons, et
    // un nouvel essai recréerait la branche qui travaille déjà (4e relecture externe, conv-1147).
    expect(confirmations[0]!.rienNestParti).toBeUndefined()
    // L'avis ne compte que ce qui est parti : la branche refusée portait T1 et T3.
    const avis = h!.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent
    expect(avis).toMatch(/1 fil lancé/u)
    expect(avis).toMatch(/Coût : 1 tour\b/u)
  })

  it('« Tout ici » : aucune branche, la première tâche part dans le fil, les autres attendent', async () => {
    await monter()
    await demander({ mode: 'ici' })
    expect(api.conversationsFork).not.toHaveBeenCalled()
    expect(envois()).toEqual([{ fil: 'A', texte: 'fais T1' }])
    expect(confirmations.map((c) => c.mode)).toEqual(['ici'])
    // Des tours sont PARTIS : jamais « rien n'est parti » (un second clic relancerait N tours).
    expect(confirmations[0]!.rienNestParti).toBeUndefined()
    // Puis les autres, une par tour, dans l'ordre du plan (T1 et T3 groupées, puis T2).
    await finirLesTours()
    expect(envois().map((envoi) => envoi.texte)).toEqual(['fais T1', 'fais T3', 'fais T2'])
  })

  /*
   * PIÈCES JOINTES (conv-1147, 2e passe). Le processus principal retrouve les originaux d'un
   * message PASSÉ par son TEXTE exact dans le fil stocké de la branche (`run-pilot-chat.ts`, puis
   * `pieces-jointes-durables.ts` : image, journal, PDF). Il faut donc que le premier envoi de la
   * branche porte le message d'origine tel quel. Le renderer n'en transmet que la miniature
   * de l'image ; le journal est rajouté côté principal depuis le disque.
   */
  it('la branche transmet le message d’origine tel quel, avec la miniature de son image', async () => {
    const artefact = (nom: string, kind: string): Record<string, unknown> => ({
      id: `user-${nom}`,
      name: nom,
      mimeType: kind === 'image' ? 'image/png' : 'text/plain',
      kind,
      size: 10,
      createdAt: 1,
      path: `C:/donnees/chat-artifacts/A/A-t1/${nom}`,
      source: { provider: 'user' }
    })
    await monter(undefined, [
      {
        name: 'maquette.png',
        mimeType: 'image/png',
        size: 10,
        thumbnail: 'data:image/png;base64,bWluaQ==',
        turnId: 'A-t1',
        artifact: artefact('maquette.png', 'image')
      },
      {
        name: 'journal.log',
        mimeType: 'text/plain',
        size: 10,
        turnId: 'A-t1',
        artifact: artefact('journal.log', 'text')
      }
    ])
    await demander()
    const appel = (api.pilotChat as ReturnType<typeof vi.fn>).mock.calls.find(
      (envoi) => envoi[1] === 'A-1'
    )!
    const payload = appel[0] as Array<{
      role: string
      content: string
      attachments?: Array<{ name: string }>
    }>
    const origine = payload.find(
      (message) => message.role === 'user' && message.content === 'fais T1, T2 et T3'
    )
    expect(origine?.attachments?.map((piece) => piece.name)).toEqual(['maquette.png (miniature)'])
    // La tâche elle-même n'emporte aucune pièce : rien n'est pris au brouillon d'un autre fil.
    expect(payload.at(-1)?.content.startsWith('fais T1')).toBe(true)
    expect(payload.at(-1)?.attachments ?? []).toEqual([])
  })

  /*
   * DÉFAUTS 1, 3 ET 4 DU JUGE (conv-1147, 2e passe) — entrées qui faisaient échouer l'ancienne
   * version : un brouillon en cours dans le fil d'origine, la liste des fils en panne après la
   * création des branches, un renommage refusé.
   */
  it('« Tout ici » ne touche pas au brouillon que l’utilisateur est en train d’écrire', async () => {
    await monter()
    await h!.type('une autre idée, pas encore envoyée')
    await demander({ mode: 'ici' })
    expect(envois()).toEqual([{ fil: 'A', texte: 'fais T1' }])
    const saisie = h!.container.querySelector('textarea') as HTMLTextAreaElement
    expect(saisie.value).toBe('une autre idée, pas encore envoyée')
  })

  it('la liste des fils en panne n’empêche ni les envois ni la confirmation', async () => {
    await monter()
    pannes.liste = true
    await demander()
    expect(
      envois()
        .map((envoi) => envoi.fil)
        .sort()
    ).toEqual(['A-1', 'A-2'])
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]!.fils.map((f) => f.id)).toEqual(['A-1', 'A-2'])
  })

  it('un renommage refusé laisse la branche recevoir sa tâche', async () => {
    await monter()
    pannes.renommage = 'A-1'
    await demander()
    expect(
      envois()
        .find((envoi) => envoi.fil === 'A-1')
        ?.texte.startsWith('fais T1')
    ).toBe(true)
    expect(confirmations[0]!.fils.map((f) => f.id)).toEqual(['A-1', 'A-2'])
    expect(confirmations[0]!.refus).toBeUndefined()
  })

  /*
   * RELECTURE EXTERNE DU 2026-10-25 (conv-1147, score 74). Une réponse peinte en direct dans une
   * fenêtre non relue n'a pas d'identifiant de message : la demande ne porte que son TOUR. Le point
   * de départ se lit alors dans le fil STOCKÉ, où chaque message a le sien.
   */
  it('sans identifiant de réponse, la branche part du message qui précède le TOUR de la carte', async () => {
    origineStockee = {
      ...fil('A', 'Trois tâches'),
      messages: [
        { role: 'user', content: 'fais T1, T2 et T3', ts: 1, messageId: 'A-m1' },
        {
          role: 'assistant',
          content: 'carte',
          ts: 2,
          messageId: 'A-m2',
          turnId: 'A-t1',
          status: 'completed',
          parts: []
        },
        { role: 'user', content: 'autre chose', ts: 3, messageId: 'A-m3' },
        {
          role: 'assistant',
          content: 'réponse',
          ts: 4,
          messageId: 'A-m4',
          turnId: 'A-t2',
          status: 'completed',
          parts: []
        }
      ]
    }
    // Monté APRÈS : la copie à l’écran porte aussi le message plus récent (A-m3).
    await monter()
    await demander({ messageId: undefined, turnId: 'A-t1' })
    expect((api.conversationsFork as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(['A', 'A-m1'])
  })

  it('fil d’origine illisible au moment du clic : rien ne part, la carte le dit', async () => {
    await monter()
    pannes.lecture = true
    await demander()
    expect(api.conversationsFork).not.toHaveBeenCalled()
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]!.fils).toEqual([])
    expect(confirmations[0]!.refus?.[0]).toMatch(/lecture impossible/u)
    // Rien n'a coûté : la carte rend ses boutons.
    expect(confirmations[0]!.rienNestParti).toBe(true)
  })

  /*
   * RÉPONSE INTROUVABLE SUR DISQUE = RIEN NE PART (3e relecture externe, conv-1147, point bas).
   * Avant, le lancement repartait en silence du DERNIER message de l'utilisateur de tout le fil,
   * peut-être écrit après la carte (« attends, ne fais rien »). Rien n'étant dépensé, la carte le dit
   * et rend ses boutons (`rienNestParti`).
   */
  it('réponse de la carte introuvable sur disque : aucune branche, la carte le dit', async () => {
    await monter()
    await demander({ messageId: 'msg-inconnu', turnId: 'tour-inconnu' })
    expect(api.conversationsFork).not.toHaveBeenCalled()
    expect(api.pilotChat).not.toHaveBeenCalled()
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]).toMatchObject({ fils: [], rienNestParti: true })
    expect(confirmations[0]!.refus?.[0]).toMatch(/introuvable/u)
  })

  it('carte sans réponse repérée (ni message ni tour) : rien ne part non plus', async () => {
    await monter()
    await demander({ messageId: undefined })
    expect(api.conversationsFork).not.toHaveBeenCalled()
    expect(confirmations[0]).toMatchObject({ fils: [], rienNestParti: true })
  })

  it('le message de l’identifiant passe avant le tour', async () => {
    origineStockee = {
      ...fil('A', 'Trois tâches'),
      messages: [
        { role: 'user', content: 'premier', ts: 1, messageId: 'A-m1' },
        {
          role: 'assistant',
          content: 'carte',
          ts: 2,
          messageId: 'A-m2',
          turnId: 'A-t1',
          status: 'completed',
          parts: []
        },
        { role: 'user', content: 'second', ts: 3, messageId: 'A-m3' },
        {
          role: 'assistant',
          content: 'carte',
          ts: 4,
          messageId: 'A-m4',
          turnId: 'A-t2',
          status: 'completed',
          parts: []
        }
      ]
    }
    await monter()
    // Le tour désigne A-m2, l'identifiant A-m4 : l'identifiant gagne, la branche part de A-m3.
    await demander({ messageId: 'A-m4', turnId: 'A-t1' })
    expect((api.conversationsFork as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(['A', 'A-m3'])
  })

  it('aucune branche créée (toutes refusées) : rien n’est parti, la carte rend ses boutons', async () => {
    await monter(1)
    ;(api.conversationsFork as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    await demander()
    expect(confirmations[0]).toMatchObject({ fils: [], rienNestParti: true })
    // L'avis de l'app dit la même chose que la carte : rien n'est parti, aucun coût annoncé.
    const avis =
      h!.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent ?? ''
    expect(avis).toMatch(/Rien n’est parti/u)
    expect(avis).not.toMatch(/0 fil|Coût/u)
  })
})
