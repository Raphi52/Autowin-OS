/**
 * La scene ```threejs d'un /draft, montee DANS la place que son carrousel lui laisse (voir
 * `draft-scene-3d.ts` : demande conv-318, « le bloc 3d doit etre dans le bloc draft »).
 *
 * Le carrousel est du HTML du fil, sans script : il choisit sa proposition par des cases radio. Ce
 * composant lit la case cochee et envoie son rang a la scene — apres chaque lancement (une scene
 * sortie de l'ecran est demontee, puis relancee) et a chaque changement de proposition.
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Bloc3D } from './Bloc3D'
import { TYPE_MESSAGE_SCENE_3D } from '../../../shared/scene-3d'
import { codeSceneDuCarrousel, rangChoisi } from './draft-scene-3d'

export function SceneDuCarrousel({
  hote,
  place,
  code
}: {
  /** Le bloc du carrousel, ou vivent ses cases radio. */
  hote: HTMLElement
  /** La place vide `.dkc-3d` du carrousel. */
  place: HTMLElement
  code: string
}): React.JSX.Element {
  useEffect(() => {
    const cadre = (): Window | null =>
      place.querySelector<HTMLIFrameElement>('iframe')?.contentWindow ?? null
    const envoyer = (): void => {
      // Origine opaque (cadre isole) : aucune cible plus precise que '*'. Le destinataire est fixe
      // par la reference du cadre, comme dans Bloc3D.tsx.
      cadre()?.postMessage({ type: TYPE_MESSAGE_SCENE_3D, choix: rangChoisi(hote) }, '*')
    }
    const surMessage = (event: MessageEvent): void => {
      const donnees = event.data as { type?: unknown; etat?: unknown } | null
      if (!donnees || donnees.type !== TYPE_MESSAGE_SCENE_3D || donnees.etat !== 'lancee') return
      if (event.source !== cadre()) return
      envoyer()
    }
    window.addEventListener('message', surMessage)
    hote.addEventListener('change', envoyer)
    return () => {
      window.removeEventListener('message', surMessage)
      hote.removeEventListener('change', envoyer)
    }
  }, [hote, place])

  return createPortal(<Bloc3D code={codeSceneDuCarrousel(code)} />, place)
}
