/// <reference lib="webworker" />
/**
 * LE FOND AVENUE DESSINÉ HORS DU FIL DE L'INTERFACE.
 *
 * Mesure du 2026-10-18 (conv-323, instance cachée `--code-dev`) : une image de l'avenue coûtait 36 à
 * 45 ms au fil principal APRÈS la correction du reflet, 62 à 66 ms avant. À 30 images/s, c'est plus
 * que le fil entier : l'interface de l'Accueil (tuiles, glisser-déposer, Jarvis) partageait le peu
 * qui restait. Ici le décor a son propre fil ; la page ne fait plus que poster une demande d'image.
 *
 * Le Worker ne décide PAS du rythme : la page garde son horloge (cadence, fenêtre cachée) et
 * demande chaque image ; elle n'en demande pas de nouvelle tant que la précédente
 * n'est pas `rendue`, donc un Worker lent ralentit le décor sans jamais accumuler de retard.
 */
import { brancherMarquesAvenue, createAvenueScene } from './home-decor-avenue'
import type { MessageDuDecor, MessageVersDecor } from './decor-avenue-messages'
import type { DecorScene } from './home-decor-scene'

const portee = self as unknown as DedicatedWorkerGlobalScope
const envoyer = (m: MessageDuDecor): void => portee.postMessage(m)

let scene: DecorScene | null = null
let ratio = 1

portee.onmessage = (evenement: MessageEvent<MessageVersDecor>): void => {
  const m = evenement.data
  switch (m.type) {
    case 'monter': {
      ratio = m.ratio
      brancherMarquesAvenue((nom) => envoyer({ type: 'marque', nom }))
      try {
        scene = createAvenueScene({
          canvas: m.canvas,
          ratio: () => ratio,
          surApparition: () => envoyer({ type: 'apparue' })
        })
        envoyer(scene ? { type: 'montee', ok: true } : { type: 'montee', ok: false })
      } catch (erreur) {
        envoyer({ type: 'montee', ok: false, erreur: String(erreur) })
      }
      return
    }
    case 'taille':
      ratio = m.ratio
      scene?.resize(m.largeur, m.hauteur)
      return
    case 'image': {
      const debut = performance.now()
      scene?.render(m.temps, m.regard)
      envoyer({ type: 'rendue', ms: performance.now() - debut })
      return
    }
    case 'liberer':
      scene?.dispose()
      scene = null
      portee.close()
  }
}
