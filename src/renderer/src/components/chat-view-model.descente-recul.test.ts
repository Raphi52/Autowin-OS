import { describe, expect, it } from 'vitest'
import { scrollChatToBottom } from './chat-view-model'

/**
 * DEFAUT VECU le 2026-09-12 : « quand je clique sur mode auto ca envoie le message, mais ca ne
 * scrolle pas — je ne vois pas le message qui part ». Le bouton « derniere reponse » apparaissait :
 * c'est la signature d'une descente DEMANDEE qui n'a PAS atterri (`onSettled(false)`).
 *
 * Cause localisee : pendant la descente, un re-rendu repose le fil quelques pixels plus haut SANS
 * que la hauteur totale change (le message qui part remplace la carte du tour precedent). La
 * descente lisait ce recul comme un GESTE DE LECTURE et rendait la main en plein vol.
 *
 * Un vrai geste de lecture, lui, est connu de la vue (molette, doigt, clavier, barre de
 * defilement). La descente accepte donc une sonde : sans geste declare, un recul est un MOUVEMENT
 * DE L'APP et elle re-vise le bas.
 */
describe('scrollChatToBottom — un recul sans geste de lecture ne coupe pas la descente', () => {
  const filDe = (hauteur: number) => ({
    clientHeight: 500,
    scrollHeight: hauteur,
    scrollTop: 0,
    isConnected: true,
    scrollTo(options: ScrollToOptions): void {
      this.scrollTop = Math.max(0, Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight))
    }
  })

  it('atterrit malgre un re-rendu qui remonte le fil au milieu de la descente', () => {
    const element = filDe(5000)
    let atterri: boolean | null = null
    const files: (() => void)[] = []
    scrollChatToBottom(
      element,
      (cb) => files.push(cb),
      40,
      (landed) => {
        atterri = landed
      },
      // AUCUN geste de lecture : tout mouvement vient de l'app.
      () => false
    )
    let images = 0
    while (files.length > 0 && images < 200) {
      const suivante = files.shift()!
      images += 1
      // Au milieu du vol, un re-rendu repose le fil plus haut, hauteur INCHANGEE.
      if (images === 3) element.scrollTop = 1200
      suivante()
    }
    expect(atterri).toBe(true)
    expect(element.scrollTop).toBe(4500)
  })

  it('rend la main quand le recul vient d un VRAI geste du lecteur', () => {
    const element = filDe(5000)
    let atterri: boolean | null = null
    let geste = false
    const files: (() => void)[] = []
    scrollChatToBottom(
      element,
      (cb) => files.push(cb),
      40,
      (landed) => {
        atterri = landed
      },
      () => geste
    )
    let images = 0
    while (files.length > 0 && images < 200) {
      const suivante = files.shift()!
      images += 1
      if (images === 3) {
        geste = true
        element.scrollTop = 1200
      }
      suivante()
    }
    expect(atterri).toBe(false)
    expect(element.scrollTop).toBe(1200)
  })

  /**
   * DEFAUT VECU le 2026-09-13 (conv-518) : remonter a la molette PENDANT qu'une reponse s'ecrit
   * ramenait le fil en bas. Le fil grandit a chaque frame : le recul du lecteur tombait dans la
   * branche « hauteur qui bouge » et la descente re-visait le bas par-dessus son geste.
   */
  it('rend la main a un vrai geste du lecteur meme quand le fil grandit encore', () => {
    const element = filDe(5000)
    let atterri: boolean | null = null
    let geste = false
    const files: (() => void)[] = []
    scrollChatToBottom(
      element,
      (cb) => files.push(cb),
      40,
      (landed) => {
        atterri = landed
      },
      () => geste
    )
    let images = 0
    while (files.length > 0 && images < 200) {
      const suivante = files.shift()!
      images += 1
      element.scrollHeight += 50 // streaming : la hauteur bouge a chaque frame
      if (images === 3) {
        geste = true
        element.scrollTop = 1200
      }
      suivante()
    }
    expect(atterri).toBe(false)
    expect(element.scrollTop).toBe(1200)
  })
})
