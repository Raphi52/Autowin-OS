// @vitest-environment happy-dom
/**
 * REPRENDRE LES CONVERSATIONS COUPÉES PAR LE QUOTA.
 *
 * Demande du 2026-09-05 : « travaille pour reprendre les convers à pastille rouge qui viennent de
 * perdre leur quota ». Deux comportements se verrouillent ici, parce qu'ils sont exactement ce qui
 * distingue ce bouton d'un bouton « relancer tout » inutilisable :
 *  1. il ne s'affiche PAS quand aucune conversation n'est coupée par le quota ;
 *  2. il ne relance QUE celles-là — une pastille rouge tombée sur une vraie erreur ne bouge pas.
 */
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat } from './ChatView.harness'

installRafShim()

const coupee = (id: string, erreur?: string): Record<string, unknown> => ({
  ...conversation(id),
  lastMessageRole: 'assistant',
  lastAssistantStatus: 'failed',
  ...(erreur ? { lastAssistantError: erreur } : {})
})

const bouton = (c: HTMLElement): HTMLButtonElement | null =>
  c.querySelector('[data-testid="conv-reprise-quota-bouton"]')

describe('bouton « Reprendre les conversations coupées par le quota »', () => {
  it("n'existe pas quand aucune conversation n'est coupée par le quota", async () => {
    const vue = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([conversation('A'), coupee('B', 'TypeError: boom')])
      })
    )
    expect(bouton(vue.container)).toBeNull()
    await vue.unmount()
  })

  it('compte et relance UNIQUEMENT les fils dont le tour est mort sur le quota', async () => {
    const resumePilotChat = vi.fn().mockResolvedValue({ ok: true, cancelled: false, turnId: 't' })
    const vue = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([
            conversation('A'),
            coupee('B', 'Claude usage limit reached'),
            coupee('C', 'TypeError: boom'),
            coupee('D', 'insufficient_quota')
          ]),
        resumePilotChat
      })
    )
    expect(bouton(vue.container)?.textContent).toContain('(2)')

    await vue.click('[data-testid="conv-reprise-quota-bouton"]')
    // La reprise est SÉQUENTIELLE (un fil à la fois, pour ne pas retomber sur le même mur) : le
    // second départ n'a lieu qu'après le retour du premier.
    await vi.waitFor(() => expect(resumePilotChat).toHaveBeenCalledTimes(2))
    expect(resumePilotChat.mock.calls.map(([id]) => id)).toEqual(['B', 'D'])
    await vue.unmount()
  })

  it('la croix masque le bloc', async () => {
    const vue = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([coupee('B', 'insufficient_quota')])
      })
    )
    expect(bouton(vue.container)).not.toBeNull()
    await vue.click('[data-testid="conv-reprise-quota-fermer"]')
    await vi.waitFor(() =>
      expect(vue.container.querySelector('[data-testid="conv-reprise-quota"]')).toBeNull()
    )
    await vue.unmount()
  })

  /**
   * DEFAUT VECU le 2026-09-05 : « j'ai cliqué, ça n'en a repris qu'une sur 3 ». Les trois etaient
   * bien en file, mais un fil repris passe OCCUPE et sort aussitot de la liste des coupes : le bloc
   * entier disparaissait au premier clic, emportant toute trace de la file. Deux fils attendaient
   * leur tour sans que rien ne le dise.
   */
  it('reste visible pendant la file et annonce ou elle en est', async () => {
    let libererLePremier!: (v: unknown) => void
    const resumePilotChat = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (libererLePremier = resolve)))
      .mockResolvedValue({ ok: true, cancelled: false, turnId: 't' })
    const vue = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([
            coupee('B', 'You’ve hit your session limit · resets 2am'),
            coupee('D', 'insufficient_quota')
          ]),
        resumePilotChat
      })
    )
    await vue.click('[data-testid="conv-reprise-quota-bouton"]')
    // Le premier fil tourne encore : le bouton ne doit NI disparaitre, NI taire la file.
    await vi.waitFor(() => expect(bouton(vue.container)?.textContent).toContain('1/2'))
    expect(bouton(vue.container)?.textContent).toContain('1 en attente')
    libererLePremier({ ok: true, cancelled: false, turnId: 't' })
    await vi.waitFor(() => expect(resumePilotChat).toHaveBeenCalledTimes(2))
    await vue.unmount()
  })

  /**
   * LA LIGNE D'ÉTAT (conv-1423). Depuis qu'un fil repart seul, un fil coupé peut attendre son heure,
   * ou ne jamais repartir : à l'écran, les deux se confondaient. La ligne dit laquelle, et le bouton
   * reste dans tous les cas : c'est lui qui rend la main avant l'heure ou après un essai raté.
   */
  describe('la ligne d’état des fils coupés', () => {
    const etats = (c: HTMLElement): string[] =>
      [...c.querySelectorAll('[data-testid="conv-reprise-quota-etat"]')].map(
        (ligne) => ligne.textContent ?? ''
      )
    const MUR = "You've hit your session limit"
    const fil = (id: string, repriseQuota: unknown): Record<string, unknown> => ({
      ...coupee(id, MUR),
      repriseQuota
    })
    const heure = (ms: number): string =>
      new Date(ms).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    // Relatifs : une heure passée s'écrit autrement, et une date fixe finit toujours par l'être.
    const A_11H = Date.now() + 60 * 60_000
    const A_12H = Date.now() + 150 * 60_000

    /*
     * Objection du contrôle final (conv-1423) : une coupure à 06:30 annoncée pour le surlendemain 2 h
     * donnait « repart seule à 02:02 », 44 h à l'avance. Sous 24 h, une heure ne désigne qu'un instant.
     * fix-ok: `texteDeLaSituation` n'écrivait que l'heure, quelle que soit l'attente (conv-1403 : 44 h).
     */
    const HEURE_MS = 3_600_000
    const jour = (ms: number): string =>
      new Date(ms).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

    /*
     * Objection du contrôle final (conv-1423) : un départ écarté à l'heure, puis redevenu possible,
     * affichait « repart seule à 02:02 » avec une heure déjà passée. Il part à la relecture suivante.
     */
    it('heure passée : le fil repart sous peu, sans heure à contredire', async () => {
      const vue = await mountChat(
        chatApi({
          conversations: vi
            .fn()
            .mockResolvedValue([fil('B', { etat: 'attente', reprendA: Date.now() - 60_000 })])
        })
      )
      expect(etats(vue.container)).toEqual(['1 conversation repart seule sous peu.'])
      await vue.unmount()
    })

    it('heure passée, plusieurs fils : même lecture, au pluriel', async () => {
      const vue = await mountChat(
        chatApi({
          conversations: vi
            .fn()
            .mockResolvedValue([
              fil('B', { etat: 'attente', reprendA: Date.now() - 60_000 }),
              fil('D', { etat: 'attente', reprendA: A_11H })
            ])
        })
      )
      // Le second part dans une heure : « sous peu » ne vaut que pour le premier.
      expect(etats(vue.container)).toEqual([
        '2 conversations repartent seules, la première sous peu.'
      ])
      await vue.unmount()
    })

    it('au-delà de 24 h, le jour s’ajoute à l’heure', async () => {
      const depart = Date.now() + 44 * HEURE_MS
      const vue = await mountChat(
        chatApi({
          conversations: vi
            .fn()
            .mockResolvedValue([fil('B', { etat: 'attente', reprendA: depart })])
        })
      )
      expect(etats(vue.container)).toEqual([
        `1 conversation repart seule le ${jour(depart)} à ${heure(depart)}.`
      ])
      await vue.unmount()
    })

    it('au-delà de 24 h, plusieurs fils : le jour du premier départ', async () => {
      const depart = Date.now() + 24 * HEURE_MS + 60_000
      const vue = await mountChat(
        chatApi({
          conversations: vi
            .fn()
            .mockResolvedValue([
              fil('B', { etat: 'attente', reprendA: depart + HEURE_MS }),
              fil('D', { etat: 'attente', reprendA: depart })
            ])
        })
      )
      expect(etats(vue.container)).toEqual([
        `2 conversations repartent seules, à partir du ${jour(depart)} à ${heure(depart)}.`
      ])
      await vue.unmount()
    })

    it('juste sous 24 h, l’heure seule suffit', async () => {
      const depart = Date.now() + 24 * HEURE_MS - 60_000
      const vue = await mountChat(
        chatApi({
          conversations: vi
            .fn()
            .mockResolvedValue([fil('B', { etat: 'attente', reprendA: depart })])
        })
      )
      expect(etats(vue.container)).toEqual([`1 conversation repart seule à ${heure(depart)}.`])
      await vue.unmount()
    })

    it('« repart seule à HH:MM », et le bouton reste', async () => {
      const vue = await mountChat(
        chatApi({
          conversations: vi.fn().mockResolvedValue([fil('B', { etat: 'attente', reprendA: A_11H })])
        })
      )
      expect(etats(vue.container)).toEqual([`1 conversation repart seule à ${heure(A_11H)}.`])
      expect(bouton(vue.container)).not.toBeNull()
      await vue.unmount()
    })

    it('plusieurs fils en attente : le compte, et l’heure du premier départ', async () => {
      const vue = await mountChat(
        chatApi({
          conversations: vi
            .fn()
            .mockResolvedValue([
              fil('B', { etat: 'attente', reprendA: A_12H }),
              fil('D', { etat: 'attente', reprendA: A_11H })
            ])
        })
      )
      expect(etats(vue.container)).toEqual([
        `2 conversations repartent seules, à partir de ${heure(A_11H)}.`
      ])
      await vue.unmount()
    })

    it.each([
      ['aucune-heure', 'aucune heure de retour annoncée'],
      ['coupure-ancienne', 'coupure trop ancienne'],
      ['run', 'un run attend sa propre reprise'],
      ['plan-de-lots', 'plan de lots, jamais relancé seul'],
      ['inactive', 'conversation marquée inactive'],
      ['hors-du-chat', 'tour lancé hors du chat, ou d’origine inconnue'],
      ['branche', 'branche d’une conversation coupée']
    ])('à la main, avec sa raison : %s', async (raison, texte) => {
      const vue = await mountChat(
        chatApi({
          conversations: vi.fn().mockResolvedValue([fil('B', { etat: 'manuelle', raison })])
        })
      )
      expect(etats(vue.container)).toEqual([`À relancer à la main (1) : ${texte}.`])
      expect(bouton(vue.container)).not.toBeNull()
      await vue.unmount()
    })

    it('l’essai raté se distingue de l’attente', async () => {
      const vue = await mountChat(
        chatApi({ conversations: vi.fn().mockResolvedValue([fil('B', { etat: 'essai-rate' })]) })
      )
      expect(etats(vue.container)).toEqual(['Reprise automatique ratée : 1 à relancer à la main.'])
      expect(bouton(vue.container)).not.toBeNull()
      await vue.unmount()
    })

    it('une ligne par situation, pas une par fil', async () => {
      const vue = await mountChat(
        chatApi({
          conversations: vi
            .fn()
            .mockResolvedValue([
              fil('B', { etat: 'manuelle', raison: 'run' }),
              fil('D', { etat: 'manuelle', raison: 'run' }),
              fil('E', { etat: 'essai-rate' }),
              fil('F', { etat: 'attente', reprendA: A_11H })
            ])
        })
      )
      expect(etats(vue.container)).toEqual([
        `1 conversation repart seule à ${heure(A_11H)}.`,
        'Reprise automatique ratée : 1 à relancer à la main.',
        'À relancer à la main (2) : un run attend sa propre reprise.'
      ])
      await vue.unmount()
    })

    it('sans état reçu (vieille liste) : le bloc reste celui d’avant, sans ligne', async () => {
      const vue = await mountChat(
        chatApi({ conversations: vi.fn().mockResolvedValue([coupee('B', MUR)]) })
      )
      expect(bouton(vue.container)).not.toBeNull()
      expect(etats(vue.container)).toEqual([])
      await vue.unmount()
    })

    it('masqué par la croix, le bloc revient quand un fil passe à « bloqué »', async () => {
      let etat: unknown = { etat: 'attente', reprendA: A_11H }
      let emettre: ((e: Record<string, unknown>) => void) | null = null
      const vue = await mountChat(
        chatApi({
          conversations: vi.fn().mockImplementation(async () => [fil('B', etat)]),
          onAppEvent: vi.fn((cb: (e: Record<string, unknown>) => void) => {
            emettre = cb
            return vi.fn()
          })
        })
      )
      await vue.click('[data-testid="conv-reprise-quota-fermer"]')
      await vi.waitFor(() =>
        expect(vue.container.querySelector('[data-testid="conv-reprise-quota"]')).toBeNull()
      )
      etat = { etat: 'essai-rate' }
      await act(async () => emettre?.({ type: 'refresh', scope: 'conversations' }))
      await vi.waitFor(() =>
        expect(etats(vue.container)).toEqual([
          'Reprise automatique ratée : 1 à relancer à la main.'
        ])
      )
      await vue.unmount()
    })

    it('jumeau : la croix tient tant que rien ne change', async () => {
      let emettre: ((e: Record<string, unknown>) => void) | null = null
      const vue = await mountChat(
        chatApi({
          conversations: vi
            .fn()
            .mockImplementation(async () => [fil('B', { etat: 'attente', reprendA: A_11H })]),
          onAppEvent: vi.fn((cb: (e: Record<string, unknown>) => void) => {
            emettre = cb
            return vi.fn()
          })
        })
      )
      await vue.click('[data-testid="conv-reprise-quota-fermer"]')
      await act(async () => emettre?.({ type: 'refresh', scope: 'conversations' }))
      expect(vue.container.querySelector('[data-testid="conv-reprise-quota"]')).toBeNull()
      await vue.unmount()
    })
  })

  /**
   * DEFAUT VECU le 2026-09-09 (capture utilisateur) : « quand ya 0 convers a reprendre faut pas
   * afficher le msg ». Le compte-rendu de reprise gardait le bloc ouvert, et avec lui un bouton
   * « (0) » qui n'offrait plus rien a cliquer.
   */
  it('ne montre plus le bouton « (0) » quand la file est vidée', async () => {
    // La conversation reprise cesse d'etre coupee : c'est l'etat de la capture — file vide, mais
    // compte-rendu encore affiche.
    let reprise = false
    const resumePilotChat = vi.fn().mockImplementation(async () => {
      reprise = true
      return { ok: true, cancelled: false, turnId: 't' }
    })
    let emettre: ((e: Record<string, unknown>) => void) | null = null
    const vue = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockImplementation(async () => [
            reprise ? conversation('B') : coupee('B', 'insufficient_quota')
          ]),
        onAppEvent: vi.fn((cb: (e: Record<string, unknown>) => void) => {
          emettre = cb
          return vi.fn()
        }),
        resumePilotChat
      })
    )
    await vue.click('[data-testid="conv-reprise-quota-bouton"]')
    await vi.waitFor(() =>
      expect(
        vue.container.querySelector('[data-testid="conv-reprise-quota-notice"]')?.textContent
      ).toContain('reprise')
    )
    // La liste se rafraichit comme en vrai : B n'est plus coupee.
    await act(async () => emettre?.({ type: 'refresh', scope: 'conversations' }))
    await vi.waitFor(() => expect(bouton(vue.container)).toBeNull())
    await vue.unmount()
  })
})
