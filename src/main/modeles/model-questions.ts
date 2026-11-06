export type ModelQuestionReason =
  | 'destructive'
  | 'irreversible'
  | 'secret-or-personal-data'
  | 'external-effect'
  | 'material-ambiguity'

export interface ModelQuestion {
  text: string
  options: string[]
  reason: ModelQuestionReason
}

export interface PendingModelQuestion extends ModelQuestion {
  id: string
  source: 'chat' | 'loop'
  context?: string
}

const QUESTION_RE = /<question>\s*(\{[\s\S]*?\})\s*<\/question>/i
export function parseModelQuestion(text: string): ModelQuestion | null {
  const match = QUESTION_RE.exec(text)
  if (!match) return null
  try {
    JSON.parse(match[1])
    // Disabled by default: the model cannot prove that a question is necessary,
    // and chat answers are part of observable prompts. Credentials are configured
    // through provider UI, never requested or transported in chat.
    return null
  } catch {
    return null
  }
}

// CONSIGNE « Avance de façon autonome » RETIRÉE du chat (2026-11-05) : ses 881
// caractères, payés à chaque tour, redisaient la CONSTITUTION injectée dans le même prompt
// (Autonomie (3), réflexes 1 et 10, limite destructive, secrets) — et l'avaient déjà contredite une
// fois (« les actions destructives s'exécutent directement »). Sa seule phrase propre,
// « ne demande pas un secret dans le chat », est passée dans la ligne Secrets de la constitution.
// Interdire la balise <question> au modèle n'avait plus d'objet : `parseModelQuestion` rend null
// quoi qu'il reçoive, et rien d'autre ne lui enseigne cette balise.

export class ModelQuestionHub {
  private nextId = 1
  private readonly waiting = new Map<
    string,
    { resolve: (answer: string) => void; reject: (reason: Error) => void }
  >()

  ask(
    source: PendingModelQuestion['source'],
    question: ModelQuestion,
    notify: (pending: PendingModelQuestion) => void,
    context?: string,
    signal?: AbortSignal
  ): Promise<string> {
    const id = `model-question-${this.nextId++}`
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        this.cancel(id, String(signal?.reason ?? 'Annulation demandée'))
      }
      const cleanup = (): void => signal?.removeEventListener('abort', abort)
      this.waiting.set(id, {
        resolve: (answer) => {
          cleanup()
          resolve(answer)
        },
        reject: (reason) => {
          cleanup()
          reject(reason)
        }
      })
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener('abort', abort, { once: true })
      notify({ id, source, context, ...question })
    })
  }

  resolve(id: string, answer: unknown): void {
    const pending = this.waiting.get(id)
    if (!pending) throw new Error(`Question modèle inconnue : ${id}`)
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 20_000) {
      throw new Error('Réponse modèle invalide')
    }
    this.waiting.delete(id)
    pending.resolve(answer.trim())
  }

  cancel(id: string, reason = 'Question annulée'): boolean {
    const pending = this.waiting.get(id)
    if (!pending) return false
    this.waiting.delete(id)
    pending.reject(new Error(reason))
    return true
  }

  cancelAll(reason = 'Fenêtre fermée'): void {
    for (const pending of this.waiting.values()) pending.reject(new Error(reason))
    this.waiting.clear()
  }
}
