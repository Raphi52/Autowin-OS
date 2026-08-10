import { useCallback, useEffect, useState } from 'react'

/**
 * BOÎTE DE RÉCEPTION du savoir, dans la vue Knowledge.
 *
 * Pourquoi (2026-08-10) : `brain_remember` dépose TOUJOURS en `inbox/`, jamais en `knowledge/`, parce
 * que « la promotion reste HUMAINE ». Sauf qu'aucun écran ne la permettait : les candidats se
 * confondaient avec le reste du graphe et personne ne pouvait ni les valider ni les refuser. La revue
 * s'accumulait donc indéfiniment.
 *
 * Ce panneau affiche, PAR FICHE, ce dont la décision a besoin :
 *  - la source normalisée (`git:<chemin>@<sha>`) et son problème de traçabilité s'il y en a un ;
 *  - l'âge du dépôt, et un signal quand le sha cité n'est PLUS le dernier commit du fichier ;
 *  - le quasi-jumeau éventuel — `inbox/` n'étant pas dédoublonnée côté serveur, deux dépôts du même
 *    fait y coexistent silencieusement.
 *
 * Promouvoir et Rejeter déplacent le fichier côté main, puis la réindexation est demandée par
 * `onIndexChanged` : sans elle, le graphe continuerait d'afficher l'ancien emplacement.
 */

export interface InboxCandidateView {
  id: string
  file: string
  title: string
  type?: string
  scope?: string
  body: string
  depositedAt?: string
  ageDays?: number
  source?: {
    locator: string
    problem?: string
    scheme?: string
    path?: string
    sha?: string
    shaState: 'current' | 'stale' | 'unknown' | 'absent'
  }
  nearDuplicates: Array<{ id: string; similarity: number; zone: 'inbox' | 'knowledge' }>
}

/**
 * Ce que dit chaque état de sha — « non vérifié » n'est PAS « à jour ». Non exporté : ce fichier
 * n'exporte qu'un composant (`react-refresh/only-export-components`).
 */
const SHA_STATE_LABELS: Record<NonNullable<InboxCandidateView['source']>['shaState'], string> = {
  current: 'sha à jour',
  stale: 'sha obsolète — le fichier a changé depuis',
  unknown: 'sha non vérifié (dépôt introuvable ici)',
  absent: 'sans sha'
}

function ageLabel(candidate: InboxCandidateView): string {
  if (candidate.ageDays === undefined) return 'âge inconnu'
  if (candidate.ageDays === 0) return 'déposé aujourd’hui'
  return `déposé il y a ${candidate.ageDays} jour${candidate.ageDays === 1 ? '' : 's'}`
}

export function KnowledgeInboxPanel({
  brainPath,
  onIndexChanged
}: {
  brainPath: string
  onIndexChanged?: () => void
}): React.JSX.Element {
  const [candidates, setCandidates] = useState<InboxCandidateView[]>([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback((): void => {
    if (!brainPath) {
      setCandidates([])
      return
    }
    setLoading(true)
    window.api
      .listInbox(brainPath)
      .then((found) => {
        setCandidates(found as unknown as InboxCandidateView[])
        setError('')
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false))
  }, [brainPath])

  // Le montage doit LIRE la boîte : `reload` pose un état de chargement puis résout hors du rendu.
  // Même dérogation que la recherche de GraphView, pour la même raison — la donnée vit côté main.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => reload(), [reload])

  const decide = useCallback(
    async (candidate: InboxCandidateView, action: 'promote' | 'reject'): Promise<void> => {
      setBusyId(candidate.id)
      try {
        if (action === 'promote') await window.api.promoteInbox(brainPath, candidate.id)
        else await window.api.rejectInbox(brainPath, candidate.id)
        setError('')
        // Le fichier a bougé : la liste ET l'index du graphe sont périmés.
        reload()
        onIndexChanged?.()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusyId(null)
      }
    },
    [brainPath, onIndexChanged, reload]
  )

  return (
    <section className="knowledge-inbox" aria-label="Boîte de réception du savoir">
      <header className="knowledge-inbox__head">
        <span>Boîte de réception</span>
        <strong>
          {candidates.length} candidat{candidates.length === 1 ? '' : 's'}
        </strong>
        <button onClick={reload} disabled={!brainPath || loading}>
          {loading ? 'lecture…' : 'Actualiser'}
        </button>
      </header>

      {error && (
        <p className="knowledge-inbox__error" role="alert">
          {error}
        </p>
      )}

      {!error && candidates.length === 0 && !loading && (
        <p className="knowledge-inbox__empty">
          Aucun candidat en attente — tout ce qui a été déposé a été tranché.
        </p>
      )}

      <ul className="knowledge-inbox__list">
        {candidates.map((candidate) => {
          const twin = candidate.nearDuplicates[0]
          return (
            <li key={candidate.id} data-candidate-id={candidate.id}>
              <details>
                <summary>
                  <strong>{candidate.title}</strong>
                  {candidate.type && (
                    <span className="knowledge-inbox__type">{candidate.type}</span>
                  )}
                  <small>{ageLabel(candidate)}</small>
                  {twin && (
                    <span className="knowledge-inbox__dup" title={`proche de ${twin.id}`}>
                      doublon probable {Math.round(twin.similarity * 100)} %
                    </span>
                  )}
                </summary>

                <dl className="knowledge-inbox__meta">
                  <dt>Source</dt>
                  <dd data-sha-state={candidate.source?.shaState ?? 'absent'}>
                    {candidate.source ? (
                      <>
                        <code>{candidate.source.locator}</code>
                        <span className="knowledge-inbox__sha">
                          {SHA_STATE_LABELS[candidate.source.shaState]}
                        </span>
                        {candidate.source.problem && (
                          <em className="knowledge-inbox__source-problem">
                            {candidate.source.problem}
                          </em>
                        )}
                      </>
                    ) : (
                      <em className="knowledge-inbox__source-problem">
                        aucune source déclarée — fait non traçable
                      </em>
                    )}
                  </dd>
                  {candidate.scope && (
                    <>
                      <dt>Portée</dt>
                      <dd>{candidate.scope}</dd>
                    </>
                  )}
                  <dt>Déposé</dt>
                  <dd>{candidate.depositedAt ?? 'date inconnue'}</dd>
                </dl>

                {candidate.nearDuplicates.length > 0 && (
                  <div className="knowledge-inbox__twins" role="note">
                    <strong>Quasi-jumeaux</strong>
                    <ul>
                      {candidate.nearDuplicates.map((duplicate) => (
                        <li key={duplicate.id}>
                          {duplicate.id}
                          <span>
                            {' — '}
                            {Math.round(duplicate.similarity * 100)} %
                            {duplicate.zone === 'knowledge'
                              ? ' · DÉJÀ dans le savoir canonique'
                              : ' · autre candidat en attente'}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <small>
                      Similarité lexicale, calculée hors du serveur : un signal pour la revue, pas
                      un verdict. Rien n’est fusionné automatiquement.
                    </small>
                  </div>
                )}

                <pre className="knowledge-inbox__body">{candidate.body}</pre>

                <div className="knowledge-inbox__actions">
                  <button
                    className="is-promote"
                    disabled={busyId === candidate.id}
                    onClick={() => void decide(candidate, 'promote')}
                  >
                    Promouvoir
                  </button>
                  <button
                    className="is-reject"
                    disabled={busyId === candidate.id}
                    onClick={() => void decide(candidate, 'reject')}
                  >
                    Rejeter
                  </button>
                  <small>
                    Promouvoir déplace la fiche dans <code>knowledge/</code> ; rejeter l’envoie dans{' '}
                    <code>.trash/</code> — réversible, rien n’est supprimé.
                  </small>
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
