// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (texte: string): string | null => {
    const m = texte.match(/👉\s*Recommandé\s*\n([^\n]+)/u)
    return m ? m[1] : null
  }
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * DEFAUT MESURE — conv-19 -> conv-23, 2026-09-27 13:10:21.853 (journal d'activite de conv-19).
 *
 * Le mode auto a envoye la suite proposee par l'agent de conv-19 (« Crée une démo pour les agences
 * immobilières… », ancree sur la tache initiale DE CE FIL). Le routeur de conversations l'a jugee
 * « new-topic » a 0,92 et l'a partie dans un fil NEUF, conv-23 :
 *  - sans dossier de travail (le fil cree ne recoit que titre + fournisseur) : le tour de 3,26 $
 *    a tourne dans D:\Autowin, avec le contexte d'Autowin au lieu de celui du projet ;
 *  - sans mode auto (l'interrupteur est arme PAR fil ; conv-23 n'etait pas dans la liste) : la
 *    chaine s'est arretee la, et conv-19 n'a plus rien recu.
 * Une suite du mode auto est, par construction, l'etape suivante de CE fil : elle ne se re-route pas.
 */
const SUITE =
  "Crée une démo pour les agences immobilières (qualification automatique des demandes reçues sur les annonces) sur le modèle de demo-relance-devis.html, ajoute-la à la fiche d'appel et vérifie-la avec verifier-kit.js dans le bureau caché, sans rien envoyer."

const filConv19 = [
  { role: 'user', content: 'Programmer un bilan automatique chaque soir à 18 h' },
  {
    role: 'assistant',
    content: `✅ Fait\nbilan programmé\n\n👉 Recommandé\nla démo des agences\n\nAUTOWIN_PROMPT_V1: ${SUITE}`
  }
]

/** Le routeur tel qu'il a repondu a 13:10:21.853 : nouveau sujet, nouveau fil. */
const routeurQuiScinde = (): ReturnType<typeof vi.fn> =>
  vi.fn(async (conversationId: string) => ({
    sourceConversationId: conversationId,
    conversationId: conversationId === 'A' ? 'N' : conversationId,
    routed: conversationId === 'A',
    decision: { route: 'new', confidence: 0.92, reason: 'new-topic' }
  }))

describe('ChatView — la suite du mode auto reste dans son fil', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('le routeur ne detourne pas la suite vers un fil neuf', async () => {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const routeConversationMessage = routeurQuiScinde()
    h = await mountChat(
      chatApi({
        pilotChat,
        routeConversationMessage,
        conversations: vi.fn().mockResolvedValue([conversation('A', filConv19), conversation('N')]),
        conversation: vi.fn(async (id: string) => conversation(id, id === 'A' ? filConv19 : []))
      })
    )
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="composer-auto-toggle"]')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const envoi = pilotChat.mock.calls.find((c) =>
      JSON.stringify(c[0]).includes('agences immobili')
    )
    expect(envoi, 'la suite proposee est bien partie').toBeDefined()
    expect(envoi?.[1]).toBe('A')
    expect(routeConversationMessage).not.toHaveBeenCalled()
  })

  /*
   * DEFAUT MESURE — conv-961 -> conv-968, 2026-10-15 09:58:10-13 (trace du routeur, session
   * 913f0706 ; messages des deux fils). La suite proposee (« Lance /arena /frame sur une
   * modification de code existant… ») est acceptee par Tab : elle reste en BROUILLON, et le mode
   * auto, arme, patiente (porte « brouillon »). Entree l'envoie A LA MAIN : le routeur la juge
   * « new-topic » a 0,9 et l'emporte dans un fil neuf, conv-968 (texte nu, sans l'en-tete du mode
   * auto). conv-961 redevient libre, brouillon vide, dernier tour INCHANGE — et le mode auto, qui
   * ne retient comme « traite » que ce qu'il a envoye lui-meme, renvoie la MEME suite dans conv-961
   * 32 ms plus tard. Deux bancs identiques sont partis sur le meme Bureau.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : retirer de `send` la ligne qui marque le tour du fil
   * source comme traite quand l'envoi vient de l'utilisateur.
   */
  it('une suite envoyee A LA MAIN puis detournee par le routeur n est pas renvoyee par le mode auto', async () => {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const routeConversationMessage = routeurQuiScinde()
    h = await mountChat(
      chatApi({
        pilotChat,
        routeConversationMessage,
        conversations: vi.fn().mockResolvedValue([conversation('A', filConv19), conversation('N')]),
        conversation: vi.fn(async (id: string) => conversation(id, id === 'A' ? filConv19 : []))
      })
    )
    await h.click('.conv-item .conv-pick')
    // La suggestion acceptee par Tab : un brouillon present, que le mode auto respecte.
    await h.type(SUITE)
    await h.click('[data-testid="composer-auto-toggle"]')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(pilotChat, 'le brouillon fait patienter le mode auto').not.toHaveBeenCalled()
    await h.click('[data-testid="composer-send"]')
    for (let i = 0; i < 6; i++)
      await act(async () => {
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 0))
      })
    const destinations = pilotChat.mock.calls.map((c) => c[1])
    expect(destinations, 'un seul envoi, dans le fil choisi par le routeur').toEqual(['N'])
  })

  it('un message TAPE par l utilisateur passe toujours par le routeur', async () => {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const routeConversationMessage = routeurQuiScinde()
    h = await mountChat(
      chatApi({
        pilotChat,
        routeConversationMessage,
        conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('N')])
      })
    )
    await h.click('.conv-item .conv-pick')
    await h.type('Parlons maintenant de ma recherche d emploi a Lyon, rien a voir avec ce fil.')
    await h.click('[data-testid="composer-send"]')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(routeConversationMessage).toHaveBeenCalled()
    expect(pilotChat.mock.calls[0]?.[1]).toBe('N')
  })
})
