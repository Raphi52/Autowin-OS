import { useEffect, useRef, useState } from 'react'
import './ModelQuestionPopup.css'

interface PendingQuestion {
  id: string
  source: 'chat' | 'loop'
  context?: string
  text: string
  options: string[]
}

export function ModelQuestionPopup(): React.JSX.Element | null {
  const [queue, setQueue] = useState<PendingQuestion[]>([])
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const current = queue[0]

  useEffect(
    () =>
      window.api.onModelQuestion((question) =>
        setQueue((pending) =>
          pending.some((item) => item.id === question.id) ? pending : [...pending, question]
        )
      ),
    []
  )

  useEffect(() => {
    if (current) requestAnimationFrame(() => inputRef.current?.focus())
  }, [current])

  // Échappatoire : Escape ferme la fenêtre de question ; le main la résout
  // gracieusement ('attend pour l’instant') sur l'événement 'closed', ce qui
  // débloque le tour sans forcer l'utilisateur à répondre.
  useEffect(() => {
    if (!current) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current])

  if (!current) return null

  async function submit(value = answer): Promise<void> {
    const resolved = value.trim()
    if (!resolved || sending) return
    setSending(true)
    try {
      await window.api.answerModelQuestion(current.id, resolved)
      setAnswer('')
      setQueue((pending) => pending.slice(1))
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
          {queue.length > 1 && <small>{queue.length} questions en attente</small>}
        </header>
        <h2>Le modèle a besoin de toi</h2>
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
          Réponse libre
          <textarea
            ref={inputRef}
            value={answer}
            disabled={sending}
            placeholder="Répondre au modèle…"
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit()
            }}
          />
        </label>
        <footer>
          <small>Ctrl + Entrée pour envoyer · Échap pour passer</small>
          <div className="model-question-actions">
            <button
              type="button"
              className="model-question-skip"
              disabled={sending}
              onClick={() => window.close()}
            >
              Passer
            </button>
            <button disabled={!answer.trim() || sending} onClick={() => void submit()}>
              {sending ? 'Transmission…' : 'Répondre et reprendre'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
