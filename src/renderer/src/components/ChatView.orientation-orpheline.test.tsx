// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * UNE ORIENTATION ARRIVEE TROP TARD NE DOIT PLUS DISPARAITRE.
 *
 * Rapporte le 2026-09-11 : « quand j'oriente ca oublie parfois ». Cause : une directive n'est lue
 * qu'aux points d'iteration de la boucle pilote ; celle qui arrive pendant la redaction de la
 * reponse finale n'en rencontre aucun, et le `finally` du tour la SUPPRIMAIT en la qualifiant
 * d'obsolete. Le texte restait visible dans le fil alors que le modele ne l'avait jamais vu.
 *
 * Le tour la renvoie desormais a l'ecran (`directives-orphelines`), qui la remet en file : elle
 * repart comme un tour normal, et une mention le dit.
 */
describe('ChatView — orientation non lue en fin de tour', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(): Promise<{
    app: (event: Record<string, unknown>) => void
    chat: ReturnType<typeof vi.fn>
  }> {
    let app!: (event: Record<string, unknown>) => void
    const chat = vi.fn().mockResolvedValue({ ok: true, text: 'ok' })
    harness = await mountChat(
      chatApi({
        pilotChat: chat,
        // La conversation A doit etre OUVERTE : le drain ne vise que le fil actif.
        appState: vi.fn().mockResolvedValue({ activeConversationId: 'A' }),
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onAppEvent: vi.fn((listener) => {
          app = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return { app, chat }
  }

  it('elle repart comme un vrai message au lieu d’être jetée', async () => {
    const { app, chat } = await monter()
    await act(async () =>
      app({ type: 'directives-orphelines', convId: 'A', textes: ['décale les icônes de 4 px'] })
    )
    await act(async () => {})
    const envoyes = chat.mock.calls.map((call) => JSON.stringify(call))
    expect(envoyes.some((appel) => appel.includes('décale les icônes de 4 px'))).toBe(true)
  })

  it('le fil le DIT — l’oubli silencieux est ce qu’on corrige', async () => {
    const { app } = await monter()
    await act(async () => app({ type: 'directives-orphelines', convId: 'A', textes: ['fais X'] }))
    await act(async () => {})
    expect(harness!.container.textContent ?? '').toContain('après la fin du tour')
  })

  /**
   * L'ORDRE REEL DU PROCESSUS PRINCIPAL, que les tests ci-dessus ne jouaient pas : il n'y avait
   * aucun tour en vol. Dans l'app, `run-pilot-chat.ts` relaie `done` pendant le tour, diffuse
   * `directives-orphelines` dans son `finally`, et SEULEMENT ENSUITE rend la reponse de `pilotChat`.
   * Le verrou d'envoi de la vue tient jusqu'a cette reponse : l'orientation sortie de la file
   * butait dessus, et `send` la jetait sans un mot (la mention disait pourtant « renvoyée »).
   *
   * Perte reelle, conv-996, 2026-10-16 : orientation « basé sur les axes que t'as généré tour 1
   * scout des améliorations » (saisie ts 1792149113401) pendant le tour 77143889, jamais lue par
   * son unique appel au modele, jamais renvoyee ; a sa place, la suite du mode auto est partie
   * 22 ms apres le `done` (saisie ts 1792149190716).
   */
  it('rendue AVANT la réponse de pilotChat, elle part quand même — après cette réponse', async () => {
    let app!: (event: Record<string, unknown>) => void
    let pilote!: (event: Record<string, unknown>) => void
    let tourEnVol = false
    let rendreLaReponse: (() => void) | undefined
    const chat = vi.fn(() => {
      tourEnVol = true
      if (chat.mock.calls.length === 1)
        return new Promise((resolve) => {
          rendreLaReponse = () => {
            tourEnVol = false
            resolve({ ok: true })
          }
        })
      return new Promise(() => {})
    })
    harness = await mountChat(
      chatApi({
        pilotChat: chat,
        pilotChatActive: vi.fn(async () => ({ active: tourEnVol })),
        appState: vi.fn().mockResolvedValue({ activeConversationId: 'A' }),
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        }),
        onAppEvent: vi.fn((listener) => {
          app = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await harness.type('trust le pouvoir du mode auto')
    await harness.click('[data-testid="composer-send"]')
    expect(chat).toHaveBeenCalledTimes(1)
    const fil = String((chat.mock.calls[0] as unknown[])[1])

    // Trois messages distincts du main, dans CET ordre ; la vue se redessine entre chacun.
    await act(async () => {
      pilote({ conversationId: fil, kind: 'done' })
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {
      app({ type: 'directives-orphelines', convId: fil, textes: ['basé sur les axes du tour 1'] })
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(
      chat,
      'rien ne part tant que le tour précédent n’a pas rendu sa réponse'
    ).toHaveBeenCalledTimes(1)
    // Elle ne repart qu'à la fin de la clôture de l'envoi : attente bornée (2 s) jusqu'au 2e appel.
    await act(async () => {
      rendreLaReponse?.()
      for (let attente = 0; attente < 200 && chat.mock.calls.length < 2; attente++)
        await new Promise((r) => setTimeout(r, 10))
    })

    const envoyes = chat.mock.calls.map((call) => JSON.stringify(call))
    expect(envoyes, 'l’orientation rendue doit repartir, pas disparaître').toHaveLength(2)
    expect(envoyes[1]).toContain('basé sur les axes du tour 1')
  })

  it('une liste vide ne relance RIEN', async () => {
    const { app, chat } = await monter()
    await act(async () => app({ type: 'directives-orphelines', convId: 'A', textes: [] }))
    await act(async () => {})
    expect(chat).not.toHaveBeenCalled()
  })
})
