import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrainSearchEnvelope } from '../../../main/brain-search-envelope'
import { brainBusinessError } from './graph-view-model'
import { BrainNavigationCard, type BrainTraceView } from './BrainNavigationCard'

/**
 * BANC D'ESSAI DE RÉCUPÉRATION — poser une question au Brain DEPUIS la vue Knowledge et voir ce qu'il
 * aurait injecté.
 *
 * Pourquoi (2026-08-10) : la recherche de la vue rendait des NŒUDS. Ni le rang de fusion, ni le
 * `dense_cos`, ni le retenu/écarté, ni le passage réellement injecté — alors que le serveur les expose
 * et que `BrainNavigationCard` sait déjà tout afficher, passage surligné compris. On ne redessine donc
 * rien : on réutilise cette carte telle quelle, en lui construisant une trace à partir de l'enveloppe
 * de `os:searchBrain`.
 *
 * Deux choses de plus, invisibles jusqu'ici :
 *  - le BUDGET d'injection (question plafonnée à `questionMax`, savoir à `knowledgeMax`) et ce qui a
 *    été coupé, en caractères ;
 *  - les QUATRE états du retrieval, chacun avec sa note. Un serveur éteint et « le savoir ne couvre pas
 *    la question » ne se ressemblent pas et ne doivent plus s'afficher pareil.
 */

type BenchState =
  | { phase: 'idle' }
  | { phase: 'running'; scope: string }
  | { phase: 'done'; scope: string; envelope: BrainSearchEnvelopeView }
  | { phase: 'failed'; scope: string; message: string }

export type BrainSearchEnvelopeView = BrainSearchEnvelope

/**
 * Libellé court par état — le titre du verdict, la `note` en portant le détail. Volontairement NON
 * exporté : ce fichier n'exporte qu'un composant (règle `react-refresh/only-export-components`), et
 * les tests vérifient le rendu, pas la table.
 */
const RETRIEVAL_STATUS_LABELS: Record<BrainSearchEnvelopeView['status'], string> = {
  found: 'savoir trouvé',
  empty: 'aucun passage retenu',
  invalid: 'réponse écartée',
  unavailable: 'Brain indisponible',
  'not-requested': 'non interrogé'
}

const count = (value: number): string => value.toLocaleString('fr-FR')

/** Une jauge de plafond : ce qui est consommé, sur quoi, et ce qui a été coupé. */
function BudgetRow({
  label,
  used,
  max,
  dropped,
  truncated,
  available
}: {
  label: string
  used: number
  max: number
  dropped: number
  truncated: boolean
  available: number
}): React.JSX.Element {
  const ratio = max > 0 ? Math.min(1, used / max) : 0
  return (
    <li className={truncated ? 'is-truncated' : ''} data-truncated={truncated ? 'yes' : 'no'}>
      <span className="brain-budget-label">{label}</span>
      <span className="brain-budget-gauge" aria-hidden="true">
        <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
      <span className="brain-budget-figures">
        {count(used)} / {count(max)} car.
      </span>
      {truncated ? (
        <strong className="brain-budget-cut">
          tronqué — {count(dropped)} car. coupés sur {count(available)}
        </strong>
      ) : (
        <small className="brain-budget-ok">dans le budget</small>
      )}
    </li>
  )
}

export function BrainRetrievalBench({
  brainPath,
  disabled,
  resetToken = 0,
  reloadToken = 0
}: {
  brainPath: string
  disabled?: boolean
  resetToken?: number
  reloadToken?: number
}): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const [state, setState] = useState<BenchState>({ phase: 'idle' })
  const requestGenerationRef = useRef(0)
  const observedReloadRef = useRef(reloadToken)
  const requestScope = `${brainPath}\u0000${resetToken}`

  const run = useCallback(async (): Promise<void> => {
    const asked = question.trim()
    if (!asked || !brainPath) return
    const requestGeneration = ++requestGenerationRef.current
    setState({ phase: 'running', scope: requestScope })
    try {
      const envelope = await window.api.searchBrain(brainPath, asked)
      if (requestGeneration !== requestGenerationRef.current) return
      setState({ phase: 'done', scope: requestScope, envelope })
    } catch (error) {
      if (requestGeneration !== requestGenerationRef.current) return
      // Une panne du canal reste une PANNE : on ne la déguise pas en « 0 résultat ».
      setState({
        phase: 'failed',
        scope: requestScope,
        message: brainBusinessError("Impossible d'exécuter le banc d'essai.", error)
      })
    }
  }, [brainPath, question, requestScope])

  useEffect(() => {
    if (observedReloadRef.current === reloadToken) return
    observedReloadRef.current = reloadToken
    let current = true
    void Promise.resolve().then(() => {
      if (current) return run()
      return undefined
    })
    return () => {
      current = false
    }
  }, [reloadToken, run])

  const running = state.phase === 'running' && state.scope === requestScope
  const failed = state.phase === 'failed' && state.scope === requestScope ? state : undefined
  const envelope =
    state.phase === 'done' && state.scope === requestScope ? state.envelope : undefined
  const navigationTrace = useMemo<BrainTraceView | undefined>(
    () =>
      envelope
        ? {
            // Stable pendant toute la vie de CETTE enveloppe : les rerenders du champ question ne
            // doivent ni remonter les candidats ni fermer une note dépliée.
            timestamp: new Date().toISOString(),
            conversationId: 'knowledge-bench',
            kind: 'query',
            query: envelope.query,
            injectedChars: envelope.budget.knowledgeChars,
            navigation: envelope.navigation
          }
        : undefined,
    [envelope]
  )
  /**
   * Une invalidation efface l'affichage mais la RELANCE peut ne jamais venir (réindexation en échec) :
   * le banc redevenait alors muet, question tapée mais verdict disparu sans un mot. On le DIT.
   */
  const stale = state.phase !== 'idle' && state.scope !== requestScope && Boolean(question.trim())

  return (
    <section className="brain-bench" aria-label="Banc d’essai de récupération">
      <header className="brain-bench__head">
        <span>Banc d’essai de récupération</span>
        <small>ce que le Brain aurait réellement injecté pour cette question</small>
      </header>
      <div className="brain-bench__ask">
        <input
          aria-label="Question posée au Brain"
          placeholder="Poser une question au savoir…"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void run()
          }}
        />
        <button
          onClick={() => void run()}
          disabled={disabled || !brainPath || !question.trim() || running}
        >
          {running ? 'recherche…' : 'Tester'}
        </button>
      </div>

      {stale && !running && (
        <p className="brain-bench__status is-stale" data-bench-state="stale" role="status">
          <strong>Résultat périmé</strong>
          <span>
            Le savoir a été réindexé depuis cette réponse : elle a été retirée plutôt que de mentir.
          </span>
          <button type="button" className="brain-bench__relaunch" onClick={() => void run()}>
            Relancer la question
          </button>
        </p>
      )}

      {failed && (
        <p className="brain-bench__status is-failed" data-retrieval-status="failed" role="alert">
          <strong>Recherche impossible</strong>
          <span>{failed.message}</span>
          <button type="button" className="brain-bench__retry" onClick={() => void run()}>
            Réessayer
          </button>
        </p>
      )}

      {envelope && (
        <>
          <p
            className={`brain-bench__status is-${envelope.status}`}
            data-retrieval-status={envelope.status}
          >
            <strong>{RETRIEVAL_STATUS_LABELS[envelope.status]}</strong>
            <span>{envelope.note}</span>
          </p>

          <ul className="brain-budget" aria-label="Budget d’injection">
            <BudgetRow
              label="Question"
              used={envelope.budget.questionChars}
              max={envelope.budget.questionMax}
              dropped={envelope.budget.questionSubmittedChars - envelope.budget.questionChars}
              truncated={envelope.budget.questionTruncated}
              available={envelope.budget.questionSubmittedChars}
            />
            <BudgetRow
              label="Savoir injecté"
              used={envelope.budget.knowledgeChars}
              max={envelope.budget.knowledgeMax}
              dropped={envelope.budget.knowledgeDroppedChars}
              truncated={envelope.budget.knowledgeTruncated}
              available={envelope.budget.knowledgeAvailableChars}
            />
          </ul>

          {envelope.budget.questionTruncated && (
            <p className="brain-bench__cut" role="note">
              La question a été tronquée à {count(envelope.budget.questionMax)} caractères avant
              l’envoi : la fin n’a pas été cherchée.
            </p>
          )}

          {/* La carte de navigation n'est PAS réécrite ici : c'est le composant existant, alimenté
              par une trace construite depuis l'enveloppe. */}
          {navigationTrace && <BrainNavigationCard trace={navigationTrace} />}

          <p className="brain-bench__local">
            Recherche locale du vault : <strong>{count(envelope.results.length)}</strong> fiche
            {envelope.results.length === 1 ? '' : 's'} — indépendante du serveur, donc toujours
            rendue.
          </p>
        </>
      )}
    </section>
  )
}
