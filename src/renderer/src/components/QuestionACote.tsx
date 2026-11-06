/**
 * QUESTION À CÔTÉ — le panneau au-dessus de la saisie (lot 1/3, 2026-10-31).
 *
 * Une question qui s'appuie sur tout le fil, et dont rien n'y est ajouté : pas de message, pas de
 * journal de tour, rien au Board. Elle marche pendant qu'un tour tourne. Le moteur est dans
 * `src/main/chat/question-a-cote.ts`.
 *
 * Tout l'état vit ICI et non dans `ChatView` : taper dans ce champ ne doit pas re-rendre la vue du chat.
 * Les échanges vivent en mémoire seulement, dans `question-a-cote-outils.ts`.
 */
import { useEffect, useRef, useState } from 'react'
import {
  QUESTION_A_COTE_MAX,
  type IssueQuestionACote,
  type MotifSansReponse
} from '../../../shared/question-a-cote'
import { useTextesChatFil } from '../textes-ecrans/chat-fil'
import { Markdown } from './Markdown'
import {
  ajouterEchange,
  apiQuestionACote,
  echangesDuFil,
  type EchangeQuestionACote
} from './question-a-cote-outils'
import './QuestionACote.css'

type CleMotif = Exclude<MotifSansReponse, 'annulee'>

export function BoutonQuestionACote({
  ouvert,
  onBasculer
}: {
  ouvert: boolean
  onBasculer: () => void
}): React.JSX.Element {
  const { t } = useTextesChatFil()
  return (
    <button
      type="button"
      className={`btn composer-question-a-cote${ouvert ? ' actif' : ''}`}
      data-testid="composer-question-a-cote"
      aria-pressed={ouvert}
      aria-label={t('question.ouvrir')}
      title={t('question.ouvrir')}
      onClick={onBasculer}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 5h16v11H10l-5 4v-4H4z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

export function QuestionACote({
  conversationId,
  onFermer
}: {
  conversationId: string
  onFermer: () => void
}): React.JSX.Element {
  const { t } = useTextesChatFil()
  const [texte, setTexte] = useState('')
  const [enCours, setEnCours] = useState<string | null>(null)
  const [echanges, setEchanges] = useState<EchangeQuestionACote[]>(() =>
    echangesDuFil(conversationId)
  )
  /** L'échange montré, quand on en revoit un plus ancien ; `null` = le dernier. */
  const [revu, setRevu] = useState<number | null>(null)
  const champ = useRef<HTMLInputElement | null>(null)
  const questionEnCours = useRef(false)
  const fermeture = useRef(onFermer)

  useEffect(() => {
    fermeture.current = onFermer
  })

  useEffect(() => {
    champ.current?.focus()
  }, [])

  // Fermer le panneau arrête la question en cours : son processus à elle, rien d'autre.
  useEffect(
    () => () => {
      if (questionEnCours.current) void apiQuestionACote()?.annuler(conversationId)
    },
    [conversationId]
  )

  useEffect(() => {
    const surTouche = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // En capture : la saisie du chat et ses palettes ne reçoivent pas ce geste-là.
      event.preventDefault()
      event.stopPropagation()
      fermeture.current()
    }
    document.addEventListener('keydown', surTouche, true)
    return () => document.removeEventListener('keydown', surTouche, true)
  }, [])

  const poser = async (): Promise<void> => {
    const question = texte.trim()
    const api = apiQuestionACote()
    if (!question || !api || questionEnCours.current) return
    questionEnCours.current = true
    setEnCours(question)
    setTexte('')
    setRevu(null)
    let issue: IssueQuestionACote
    try {
      issue = await api.poser(conversationId, question)
    } catch (error) {
      issue = {
        ok: false,
        motif: 'echec',
        detail: error instanceof Error ? error.message : String(error)
      }
    }
    questionEnCours.current = false
    // Annulée : le panneau est fermé, ou la question remplacée. Rien à montrer ni à garder.
    if (!issue.ok && issue.motif === 'annulee') return
    setEchanges(ajouterEchange(conversationId, question, issue))
    setEnCours(null)
  }

  const montre = enCours
    ? undefined
    : (echanges.find((echange) => echange.id === revu) ?? echanges[0])
  const precedentes = echanges.filter((echange) => echange !== montre).slice(0, 5)

  return (
    <section className="question-a-cote" aria-label={t('question.titre')}>
      <div className="question-a-cote-entete">
        <span className="question-a-cote-titre">{t('question.titre')}</span>
        <span className="question-a-cote-note">{t('question.note')}</span>
        <button
          type="button"
          className="question-a-cote-fermer"
          aria-label={t('question.fermer')}
          title={t('question.fermer')}
          onClick={onFermer}
        >
          ×
        </button>
      </div>
      <form
        className="question-a-cote-saisie"
        onSubmit={(event) => {
          event.preventDefault()
          void poser()
        }}
      >
        <input
          ref={champ}
          className="question-a-cote-champ"
          data-testid="question-a-cote-champ"
          value={texte}
          maxLength={QUESTION_A_COTE_MAX}
          placeholder={t('question.champ')}
          aria-label={t('question.champ')}
          onChange={(event) => setTexte(event.target.value)}
        />
        <button
          type="submit"
          className="btn question-a-cote-envoyer"
          disabled={!texte.trim() || enCours !== null}
        >
          {t('question.envoyer')}
        </button>
      </form>
      {enCours !== null ? (
        <div className="question-a-cote-reponse" aria-live="polite">
          <p className="question-a-cote-question">{enCours}</p>
          <p className="question-a-cote-attente" role="status">
            {t('question.enCours')}
          </p>
        </div>
      ) : montre ? (
        <div className="question-a-cote-reponse" aria-live="polite">
          <p className="question-a-cote-question">{montre.question}</p>
          {montre.issue.ok ? (
            <>
              <Markdown text={montre.issue.reponse} />
              {montre.issue.outilRefuse ? (
                <p className="question-a-cote-avis">{t('question.outilRefuse')}</p>
              ) : null}
            </>
          ) : (
            <p className="question-a-cote-erreur" role="alert">
              {t(`question.motif.${montre.issue.motif as CleMotif}`, {
                detail: montre.issue.detail ?? ''
              })}
            </p>
          )}
        </div>
      ) : null}
      {precedentes.length > 0 ? (
        <ol className="question-a-cote-precedentes" aria-label={t('question.precedentes')}>
          {precedentes.map((echange) => (
            <li key={echange.id}>
              <button
                type="button"
                title={t('question.revoir')}
                disabled={enCours !== null}
                onClick={() => setRevu(echange.id)}
              >
                {echange.question}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}
