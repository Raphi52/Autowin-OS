import { useEffect, useRef, useState } from 'react'
import { useTextesArtefactsEtBandeaux } from '../textes-ecrans/artefacts-et-bandeaux'
import './ModelQuestionPopup.css'

interface PendingQuestion {
  id: string
  source: 'chat' | 'loop'
  context?: string
  text: string
  options: string[]
}

export function ModelQuestionPopup(): React.JSX.Element | null {
  const { t } = useTextesArtefactsEtBandeaux()
  const [current, setCurrent] = useState<PendingQuestion | null>(null)
  /** Aucune question à afficher : on le dit, une fenêtre vide ne laisse rien à cliquer. */
  const [introuvable, setIntrouvable] = useState(false)
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  /** Échec d'envoi de la réponse (IPC) — affiché à l'utilisateur, la saisie est conservée. */
  const [sendError, setSendError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // La page va chercher SA question une fois montée : elle ne peut plus la manquer, et
  // un rechargement la retrouve. Le détour par une fonction async attrape aussi un pont sans cette
  // demande (preload plus ancien que l'interface en développement), qui lèverait une erreur directe.
  useEffect(() => {
    let actif = true
    async function chercherLaQuestion(): Promise<void> {
      try {
        const question = await window.api.pendingModelQuestion()
        if (!actif) return
        if (question) setCurrent(question)
        else setIntrouvable(true)
      } catch {
        if (actif) setIntrouvable(true)
      }
    }
    void chercherLaQuestion()
    return () => {
      actif = false
    }
  }, [])

  useEffect(() => {
    if (current) requestAnimationFrame(() => inputRef.current?.focus())
  }, [current])

  // Échappatoire : Escape ferme la fenêtre de question ; le main la résout
  // gracieusement ('attend pour l’instant') sur l'événement 'closed', ce qui
  // débloque le tour sans forcer l'utilisateur à répondre.
  useEffect(() => {
    if (!current && !introuvable) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current, introuvable])

  if (introuvable) {
    return (
      <div className="model-question-layer" role="presentation">
        <section className="model-question-popup" role="alertdialog" aria-modal="true">
          <h2>{t('question.introuvable')}</h2>
          <footer>
            <small>{t('question.introuvableAide')}</small>
            <div className="model-question-actions">
              <button type="button" className="model-question-skip" onClick={() => window.close()}>
                {t('question.passer')}
              </button>
            </div>
          </footer>
        </section>
      </div>
    )
  }

  if (!current) return null
  const { id: idQuestion } = current

  async function submit(value = answer): Promise<void> {
    const resolved = value.trim()
    if (!resolved || sending) return
    setSending(true)
    setSendError(null)
    try {
      await window.api.answerModelQuestion(idQuestion, resolved)
      setAnswer('')
      setCurrent(null)
    } catch (error) {
      // Sans ce retour, un échec d'IPC (main indisponible, tour déjà terminé) laissait l'utilisateur
      // croire que sa réponse était partie : le bouton se réactivait, rien ne s'affichait, et la
      // réponse saisie était perdue en silence. On garde la saisie ET on dit que ça a échoué.
      setSendError(
        t('question.echecEnvoi', {
          erreur: error instanceof Error ? error.message : String(error)
        })
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="model-question-layer" role="presentation">
      <section className="model-question-popup" role="dialog" aria-modal="true">
        <header>
          <span className={`model-question-source ${current.source}`}>
            {current.source === 'loop' ? 'Loop Builder' : 'Chat'}
          </span>
        </header>
        <h2>{t('question.titre')}</h2>
        {current.context && <div className="model-question-context">{current.context}</div>}
        <p>{current.text}</p>
        {current.options.length > 0 && (
          <div className="model-question-options">
            {current.options.map((option) => (
              <button key={option} disabled={sending} onClick={() => void submit(option)}>
                {option}
              </button>
            ))}
          </div>
        )}
        <label>
          {t('question.reponseLibre')}
          <textarea
            ref={inputRef}
            value={answer}
            disabled={sending}
            placeholder={t('question.placeholder')}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit()
            }}
          />
        </label>
        {sendError ? (
          <p className="model-question-error" role="alert" data-testid="model-question-error">
            {sendError}
          </p>
        ) : null}
        <footer>
          <small>{t('question.raccourcis')}</small>
          <div className="model-question-actions">
            <button
              type="button"
              className="model-question-skip"
              disabled={sending}
              onClick={() => window.close()}
            >
              {t('question.passer')}
            </button>
            <button disabled={!answer.trim() || sending} onClick={() => void submit()}>
              {sending ? t('question.transmission') : t('question.repondre')}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
