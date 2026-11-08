import { useEffect, useState } from 'react'
import { riche } from '../textes'
import {
  EVENEMENT_BLOCS_REPLIES,
  lireBlocsReplies,
  noterBlocReplie,
  stockageLocal
} from './blocs-replies'
import './CeQueCaCouvre.css'

/**
 * BLOC « CE QUE ÇA COUVRE », REPLIABLE ET RETENU.
 *
 * Chaque rôle d'Agent Studio (et le modèle des petites tâches, aussi dans Réglages) explique ce qu'il
 * couvre. Déplié par défaut : quelqu'un qui découvre l'écran doit les voir ; replié, l'état est
 * retenu par bloc (`blocs-replies.ts`) et suivi en direct par l'autre écran qui montre le même.
 */
export interface LigneDeCouverture {
  /** Intitulé court (« Couvre », « Bloc vide »…). */
  intitule: string
  /** Explication ; `**mot**` passe en gras, le mot qui porte l'information. */
  explication: string
}

export function CeQueCaCouvre({
  id,
  titre,
  lignes,
  testId
}: {
  /** Clé de mémoire : deux écrans qui montrent le même bloc partagent le même `id`. */
  id: string
  titre: string
  lignes: readonly LigneDeCouverture[]
  testId?: string
}): React.JSX.Element {
  const [replie, setReplie] = useState(() => lireBlocsReplies(stockageLocal())[id] === true)

  useEffect(() => {
    const suivre = (): void => setReplie(lireBlocsReplies(stockageLocal())[id] === true)
    window.addEventListener(EVENEMENT_BLOCS_REPLIES, suivre)
    return () => window.removeEventListener(EVENEMENT_BLOCS_REPLIES, suivre)
  }, [id])

  const basculer = (): void => {
    const suivant = !replie
    setReplie(suivant)
    noterBlocReplie(stockageLocal(), id, suivant)
    window.dispatchEvent(new Event(EVENEMENT_BLOCS_REPLIES))
  }

  const corps = `${testId ?? `ce-que-ca-couvre-${id}`}-corps`
  return (
    <div className={`ce-que-ca-couvre${replie ? ' is-replie' : ''}`} data-testid={testId}>
      <button
        type="button"
        className="ce-que-ca-couvre-titre"
        aria-expanded={!replie}
        aria-controls={corps}
        onClick={basculer}
      >
        <span aria-hidden="true">{replie ? '▸' : '▾'}</span>
        {titre}
      </button>
      {!replie && (
        <dl id={corps}>
          {lignes.map((ligne) => (
            <div key={ligne.intitule}>
              <dt>{ligne.intitule}</dt>
              <dd>{riche(ligne.explication, 'b')}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
