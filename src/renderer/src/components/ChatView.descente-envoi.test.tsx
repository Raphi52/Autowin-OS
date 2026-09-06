// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

/**
 * Defaut vecu le 2026-09-06 : « quand je prompt ca met pas la vue sur le dernier message, je suis
 * oblige de scroll down ».
 *
 * Cause LOCALISEE le meme jour : entre l'envoi et la frame ou la descente s'execute, l'APP elle-meme
 * bouge le fil (le champ de saisie multi-ligne se vide et rend sa hauteur). Cet evenement `scroll`
 * arrivait avec le fil encore en haut, il etait lu comme un GESTE DE LECTURE loin du bas, le suivi
 * retombait, et la descente deja programmee sortait par sa garde : personne ne descendait.
 *
 * Ce test rejoue exactement cette sequence : fil long, lecteur REMONTE a la molette, envoi, puis
 * l'evenement `scroll` parasite de l'app. La vue doit finir EN BAS.
 */
describe('ChatView — envoyer ramene la vue sur le dernier message', () => {
  let harness: ChatHarness | undefined

  beforeAll(() => installRafShim())
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    localStorage.clear()
  })

  it('descend malgre un scroll parasite juste apres l envoi', async () => {
    harness = await mountChat(
      chatApi({
        conversations: async () => [
          { id: 'A', title: 'Conversation A', provider: 'codex', updatedAt: 1 }
        ],
        conversation: async () => conversation('A')
      })
    )

    const scroll = harness.container.querySelector('.chat-scroll') as HTMLElement
    expect(scroll).toBeTruthy()
    // happy-dom ne calcule aucune mise en page : on FABRIQUE un fil long.
    Object.defineProperty(scroll, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scroll, 'scrollHeight', { value: 5000, configurable: true })

    /*
     * ON LAISSE LE MONTAGE FINIR AVANT DE MESURER.
     *
     * Mesure du 2026-09-06 : la descente d'OUVERTURE du fil est une boucle de frames encore vivante
     * plus d'une seconde apres le montage (le shim de frames rejoue en `setTimeout`). Sans cette
     * pause, c'est ELLE qui posait le fil en bas — et le test restait vert meme quand la descente
     * D'ENVOI etait coupee net. C'etait le defaut du temoin recupere : il ne pouvait pas rougir.
     */
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200))
    })

    let cibleDemandee = 0
    scroll.scrollTo = ((options: ScrollToOptions) => {
      cibleDemandee = Math.max(cibleDemandee, options.top ?? 0)
      scroll.scrollTop = Math.max(0, (options.top ?? 0) - 500)
    }) as HTMLElement['scrollTo']
    scroll.scrollTop = 0

    /*
     * LE LECTEUR EST REMONTE, A LA MOLETTE. Poser `scrollTop` ne suffit pas : le composant
     * n'apprend la position que par l'evenement `scroll`, et il n'ecoute cet evenement que si un
     * geste (molette, doigt, clavier, pointeur) l'accompagne. Sans la molette, le suivi du bas
     * restait arme depuis l'ouverture et le test passait quoi qu'il arrive.
     */
    await act(async () => {
      scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
      scroll.dispatchEvent(new Event('scroll'))
    })

    await harness.type('un message court')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const envoyer = [...harness.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (bouton) => bouton.textContent?.trim() === 'Envoyer'
    )
    expect(envoyer).toBeTruthy()
    await act(async () => envoyer!.click())
    // Le mouvement PARASITE de l'app, celui qui coupait le suivi.
    await act(async () => {
      scroll.dispatchEvent(new Event('scroll'))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80))
    })

    /*
     * ON MESURE LA POSITION FINALE, PAS UNE INTENTION.
     *
     * L'assertion d'origine se contentait de « une descente a ete DEMANDEE » (cible > 0) : elle
     * survivait au sabotage du correctif qu'elle etait censee proteger. Ce qui compte pour
     * l'utilisateur, c'est OU LE FIL S'ARRETE. Le shim de `scrollTo` pose `scrollTop = cible - 500`
     * (la hauteur visible), donc atteindre le bas signifie `scrollHeight - clientHeight` = 4500.
     */
    expect(cibleDemandee).toBeGreaterThan(0)
    expect(scroll.scrollTop).toBeGreaterThanOrEqual(5000 - 500 - 1)
  })
})
