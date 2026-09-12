import { useEffect, useState } from 'react'
import { construireRetrospective, type TraceTour } from './trace-retrospective-model'

/**
 * Onglet « Trace » du panneau de droite : REND CONSULTABLE le raisonnement et les actions qu'une
 * conversation a déjà enregistrés sur le disque (`causal-trace/<conv>.jsonl`). Sans lui, ces
 * données existaient mais n'étaient lisibles nulle part dans l'app — le bloc « Actions » du fil
 * n'en montre qu'un résumé, et seulement pour les tours récents.
 */
export function TraceRetrospectivePane({
  conversationId
}: {
  conversationId?: string | null
}): React.JSX.Element {
  const [tours, setTours] = useState<TraceTour[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let vivant = true
    if (!conversationId) {
      setTours(null)
      setErreur(null)
      return
    }
    setTours(null)
    setErreur(null)
    window.api
      .causalTrace(conversationId)
      .then((events) => {
        if (vivant) setTours(construireRetrospective(events ?? []))
      })
      .catch((e: unknown) => {
        // L'échec de LECTURE est dit, jamais confondu avec « aucune trace » : une trace absente et
        // une trace illisible n'appellent pas la même action de l'utilisateur.
        if (vivant) setErreur(e instanceof Error ? e.message : String(e))
      })
    return () => {
      vivant = false
    }
  }, [conversationId])

  if (!conversationId)
    return <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>Aucune conversation ouverte.</div>

  if (erreur)
    return (
      <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }} data-testid="trace-erreur">
        Trace illisible : {erreur}
      </div>
    )

  if (tours === null)
    return (
      <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }} data-testid="trace-chargement">
        Lecture de la trace…
      </div>
    )

  if (tours.length === 0)
    return (
      <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }} data-testid="trace-vide">
        Aucune trace conservée pour cette conversation. Le ménage automatique efface les traces de
        plus de 7 jours.
      </div>
    )

  return (
    <div className="scroll-y col grow" style={{ gap: 'var(--s2)', minHeight: 0 }} data-testid="trace-retrospective">
      {tours.map((tour) => (
        <details key={tour.turnId} className="trace-tour" open={tour === tours[0]}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>
            <span style={{ color: 'var(--gold, #d4a94f)' }}>
              {new Date(tour.debut).toLocaleString()}
            </span>{' '}
            · {tour.actions.length} action{tour.actions.length > 1 ? 's' : ''}
            {tour.demande ? ` · ${tour.demande}` : ''}
          </summary>
          {tour.raisonnement.length > 0 && (
            <div style={{ fontSize: 12, opacity: 0.85, whiteSpace: 'pre-wrap', padding: 'var(--s1) 0' }}>
              {tour.raisonnement.join('\n\n')}
            </div>
          )}
          {tour.actions.map((action, i) => (
            <div key={i} style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', opacity: 0.9 }}>
              <b>{action.nom}</b>
              {action.detail ? ` · ${action.detail}` : ''}
              {action.statut === 'failed' ? ' — échec' : ''}
            </div>
          ))}
        </details>
      ))}
    </div>
  )
}
