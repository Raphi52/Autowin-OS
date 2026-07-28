import { useEffect, useState } from 'react'
import './ResumedTurnsBanner.css'

interface UnfinishedTurn {
  conversationId: string
  turnId: string
  events: number
  updatedAt: number
}

/**
 * Survie niveau 2, visible : au démarrage, l'app demande les tours restés INACHEVÉS (elle a été
 * fermée pendant leur exécution) et le signale. « Reprendre » ouvre la conversation concernée pour
 * y relire ce que le CLI a produit (journal du tour). Silencieux si rien à reprendre.
 */
export function ResumedTurnsBanner({
  onResume
}: {
  onResume?: (conversationId: string) => void
}): React.JSX.Element | null {
  const [turns, setTurns] = useState<UnfinishedTurn[]>([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.unfinishedTurns?.().then((found) => {
      if (alive) setTurns(Array.isArray(found) ? found : [])
    })
    return () => {
      alive = false
    }
  }, [])

  if (dismissed || turns.length === 0) return null
  const first = turns[0]

  return (
    <div className="resumed-turns" data-testid="resumed-turns" role="status">
      <span className="resumed-turns-msg">
        ⏵ <strong>{turns.length}</strong> tour(s) interrompu(s) par la fermeture de l’app —{' '}
        {first.events} événement(s) récupéré(s).
      </span>
      <span className="resumed-turns-actions">
        <button
          className="resumed-turns-open"
          data-testid="resumed-turns-open"
          onClick={() => {
            onResume?.(first.conversationId)
            setDismissed(true)
          }}
        >
          Reprendre
        </button>
        <button
          className="resumed-turns-later"
          data-testid="resumed-turns-later"
          onClick={() => setDismissed(true)}
        >
          Ignorer
        </button>
      </span>
    </div>
  )
}
