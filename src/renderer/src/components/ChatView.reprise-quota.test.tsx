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
   * DEFAUT VECU le 2026-09-09 (capture utilisateur) : « quand ya 0 convers a reprendre faut pas
   * afficher le msg ». Le compte-rendu de reprise gardait le bloc ouvert, et avec lui un bouton
   * « (0) » qui n'offrait plus rien a cliquer.
   */
  it("ne montre plus le bouton « (0) » quand la file est vidée", async () => {
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
