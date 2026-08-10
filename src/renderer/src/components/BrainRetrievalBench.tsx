import { useCallback, useState } from 'react'
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
  | { phase: 'running' }
  | { phase: 'done'; envelope: BrainSearchEnvelopeView }
  | { phase: 'failed'; message: string }

/** Forme LUE de l'enveloppe — le renderer n'en consomme que ce qu'il affiche. */
export interface BrainSearchEnvelopeView {
  status: 'found' | 'empty' | 'invalid' | 'unavailable' | 'not-requested'
  note: string
  query: string
  results: Array<{ id: string }>
  navigation?: BrainTraceView['navigation']
  budget: {
    questionSubmittedChars: number
    questionChars: number
    questionMax: number
    questionTruncated: boolean
    knowledgeAvailableChars: number
    knowledgeChars: number
    knowledgeMax: number
    knowledgeTruncated: boolean
    knowledgeDroppedChars: number
  }
}

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
  disabled
}: {
  brainPath: string
  disabled?: boolean
}): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const [state, setState] = useState<BenchState>({ phase: 'idle' })

  const run = useCallback(async (): Promise<void> => {
    const asked = question.trim()
    if (!asked || !brainPath) return
    setState({ phase: 'running' })
    try {
      const envelope = (await window.api.searchBrain(
        brainPath,
        asked
      )) as unknown as BrainSearchEnvelopeView
      setState({ phase: 'done', envelope })
    } catch (error) {
      // Une panne du canal reste une PANNE : on ne la déguise pas en « 0 résultat ».
      setState({
        phase: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }, [brainPath, question])

  const envelope = state.phase === 'done' ? state.envelope : undefined

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
          disabled={disabled || !brainPath || !question.trim() || state.phase === 'running'}
        >
          {state.phase === 'running' ? 'recherche…' : 'Tester'}
        </button>
      </div>

      {state.phase === 'failed' && (
        <p className="brain-bench__status is-failed" data-retrieval-status="failed" role="alert">
          <strong>Recherche impossible</strong>
          <span>{state.message}</span>
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
          <BrainNavigationCard
            trace={{
              timestamp: new Date().toISOString(),
              conversationId: 'knowledge-bench',
              kind: 'query',
              query: envelope.query,
              injectedChars: envelope.budget.knowledgeChars,
              navigation: envelope.navigation
            }}
          />

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
