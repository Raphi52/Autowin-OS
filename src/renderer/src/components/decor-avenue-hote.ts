import { createAvenueScene, FONDU_ENTREE_MS } from './home-decor-avenue'
import type { MessageDuDecor, MessageVersDecor } from './decor-avenue-messages'
import type { DecorScene } from './home-decor-scene'

/**
 * LE CÔTÉ PAGE DU FOND AVENUE QUI TOURNE DANS UN WORKER (decor-avenue.worker.ts).
 *
 * Rend un `DecorScene` ordinaire : `DecorDeFond` le monte, le redimensionne et l'anime comme
 * avant, sans savoir où il se dessine. Chaque appel devient un message ; `render` ne coûte plus au
 * fil de l'interface qu'un `postMessage`, et n'en envoie pas de nouveau tant que le Worker n'a pas
 * rendu le précédent (un Worker lent ralentit le décor, il n'accumule pas de retard).
 *
 * REPLI : sans Worker, sans OffscreenCanvas (happy-dom en test), ou si le Worker ne peut pas monter
 * la scène (WebGL refusé hors de la page, script introuvable), la rue se dessine dans la page comme
 * avant (`createAvenueScene`) — un décor plus lent vaut mieux qu'aucun décor. L'échec est écrit.
 */

/** La densité de pixels de l'écran, transmise au Worker ; l'avenue y applique son propre plafond. */
const ratioEcran = (): number => window.devicePixelRatio || 1

/** Le dernier coût d'image du Worker, lisible par les sondes en développement seulement. */
interface StatsDecor {
  images: number
  couts: number[]
}

export function createAvenueEnArrierePlan(): DecorScene | null {
  const surPage = (): DecorScene | null => createAvenueScene()
  if (
    typeof Worker !== 'function' ||
    typeof OffscreenCanvas !== 'function' ||
    typeof document === 'undefined'
  )
    return surPage()
  const canevas = document.createElement('canvas')
  if (typeof canevas.transferControlToOffscreen !== 'function') return surPage()

  let worker: Worker
  try {
    worker = new Worker(new URL('./decor-avenue.worker.ts', import.meta.url), { type: 'module' })
  } catch (erreur) {
    console.error("[decor] le Worker de l'avenue ne démarre pas, dessin dans la page :", erreur)
    return surPage()
  }
  const envoyer = (m: MessageVersDecor, transfert: Transferable[] = []): void =>
    worker.postMessage(m, transfert)

  canevas.style.opacity = '0'
  const horsPage = canevas.transferControlToOffscreen()
  envoyer({ type: 'monter', canvas: horsPage, ratio: ratioEcran() }, [horsPage])

  /** La scène de repli, dessinée dans la page, si le Worker n'a pas pu monter la rue. */
  let repli: DecorScene | null = null
  let canvasCourant: HTMLCanvasElement = canevas
  let taille: { largeur: number; hauteur: number } | null = null
  let enVol = false
  let libere = false
  const stats: StatsDecor | null = import.meta.env?.DEV ? { images: 0, couts: [] } : null
  if (stats) (globalThis as { __autowinDecor?: StatsDecor }).__autowinDecor = stats

  const passerSurLaPage = (raison: string): void => {
    if (libere || repli) return
    console.error(
      `[decor] l'avenue ne peut pas tourner dans un Worker (${raison}) : dessin dans la page`
    )
    worker.terminate()
    repli = surPage()
    if (!repli) return
    canevas.replaceWith(repli.canvas)
    canvasCourant = repli.canvas
    if (taille) repli.resize(taille.largeur, taille.hauteur)
  }

  worker.onmessage = (evenement: MessageEvent<MessageDuDecor>): void => {
    const m = evenement.data
    switch (m.type) {
      case 'rendue':
        enVol = false
        if (stats) {
          stats.images++
          stats.couts.push(m.ms)
          if (stats.couts.length > 240) stats.couts.shift()
        }
        return
      case 'apparue':
        // Le même fondu que dans la page (home-decor-avenue.ts, `apparaitre`) : sur le compositeur.
        canevas.style.opacity = '1'
        if (typeof canevas.animate === 'function')
          canevas.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: FONDU_ENTREE_MS,
            easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)'
          })
        return
      case 'marque':
        globalThis.performance?.mark?.(m.nom)
        return
      case 'montee':
        if (!m.ok) passerSurLaPage(m.erreur ?? 'scène non montée')
    }
  }
  worker.onerror = (evenement: ErrorEvent): void => {
    passerSurLaPage(evenement.message || 'script du Worker introuvable')
  }

  return {
    get canvas() {
      return canvasCourant
    },
    resize(largeur, hauteur) {
      if (!(largeur > 0 && hauteur > 0)) return
      taille = { largeur, hauteur }
      if (repli) return repli.resize(largeur, hauteur)
      envoyer({ type: 'taille', largeur, hauteur, ratio: ratioEcran() })
    },
    render(temps, regard) {
      if (repli) return repli.render(temps, regard)
      if (enVol || libere) return
      enVol = true
      envoyer({ type: 'image', temps, regard: { x: regard.x, y: regard.y } })
    },
    dispose() {
      libere = true
      if (repli) repli.dispose()
      else envoyer({ type: 'liberer' })
      // Le Worker libère sa scène puis se ferme lui-même ; s'il est bloqué, on le coupe.
      setTimeout(() => worker.terminate(), 2000)
      canvasCourant.remove()
    }
  }
}
