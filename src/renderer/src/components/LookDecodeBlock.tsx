import type { JSX } from 'react'
import { useTextesChatDecisions } from '../textes-ecrans/chat-decisions'
import './LookDecodeBlock.css'

/**
 * Ce que le modèle a pensé en lisant une image avec la skill look : le bloc « Décodage de l'image ».
 *
 * Bloc À PART du bloc « Raisonnement », qui ne change pas : ce décodage n'est jamais renvoyé au modèle,
 * c'est de l'affichage. Le texte sort tel quel, sans traduction : le modèle l'écrit en anglais. Ouvert
 * par défaut ; un clic sur le titre le replie (élément natif, comme le bloc « Raisonnement »).
 */
export function LookDecodeBlock({ text }: { text: string }): JSX.Element {
  const { t } = useTextesChatDecisions()
  return (
    <details className="look-decode-block" open data-testid="look-decode-block">
      <summary className="look-decode-titre">{t('decodageImage.titre')}</summary>
      <div className="look-decode-texte" data-testid="look-decode-block-body">
        {text}
      </div>
    </details>
  )
}
