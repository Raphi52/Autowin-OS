/**
 * Bloc « Réflexion » du fil : le raisonnement LIVE du modèle, repliable, écrit EN TEMPS RÉEL.
 *
 * Le raisonnement était accumulé par `chat-view-model` (`message.reasoning`) mais n'était rendu
 * NULLE PART depuis le retrait du panneau latéral : la pensée existait et restait invisible.
 * Il revient ici, dans la bulle, au-dessus de la réponse — comme chez Kimi.
 *
 * Ouverture : ouvert tant que le tour n'est pas terminé, replié ensuite ; un clic de
 * l'utilisateur reprend TOUJOURS la main (l'état manuel gagne sur l'automatique).
 */
import React, { useEffect, useRef, useState } from 'react'
import { Spinner } from './Spinner'

export function ThinkingBlock({
  text,
  done
}: {
  text: string
  done: boolean
}): React.JSX.Element {
  const [manuel, setManuel] = useState<boolean | null>(null)
  const ouvert = manuel ?? !done
  const corps = useRef<HTMLPreElement | null>(null)
  // Le flux s'écrit vers le BAS : sans cela, la pensée défile hors du cadre et on regarde le début.
  useEffect(() => {
    const el = corps.current
    if (el && ouvert) el.scrollTop = el.scrollHeight
  }, [text, ouvert])
  return (
    <details
      className={`thinking-block${done ? ' is-done' : ' is-live'}`}
      data-testid="thinking-block"
      open={ouvert}
      onToggle={(event) => setManuel(event.currentTarget.open)}
    >
      <summary>
        {done ? <span aria-hidden="true">✻</span> : <Spinner />}
        <span className="thinking-label">{done ? 'Réflexion terminée' : 'Réflexion…'}</span>
      </summary>
      <pre className="thinking-body" ref={corps} data-testid="thinking-body">
        {text}
      </pre>
    </details>
  )
}
