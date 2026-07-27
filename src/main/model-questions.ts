export const MODEL_QUESTION_REASONS = [
  'destructive',
  'irreversible',
  'secret-or-personal-data',
  'external-effect',
  'material-ambiguity'
] as const

export type ModelQuestionReason = (typeof MODEL_QUESTION_REASONS)[number]

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
    // and chat answers are part of observable prompts. Destructive/external
    // confirmations use the command authority layer; credentials are configured
    // through provider UI, never requested or transported in chat.
    return null
  } catch {
    return null
  }
}

export const MODEL_QUESTION_INSTRUCTION =
  'Avance de façon autonome : inspecte d’abord l’état disponible et choisis une hypothèse raisonnable ' +
  'par défaut pour toute décision ordinaire et réversible. Ne pose une question que si aucune progression ' +
  'sûre n’est possible faute d’une information indispensable, mais ne suspends pas le tour dans le chat. Les actions destructives ou à effet externe passent par le sas des commandes ; ' +
  'une ambiguïté ordinaire reçoit un choix par défaut. Ne demande jamais un secret ou une donnée personnelle ' +
  'dans le chat : indique en texte normal le provider ou réglage à configurer, sans valeur sensible. ' +
  'N’émets aucune balise <question> : ce canal est désactivé tant que l’application ne peut pas prouver le ' +
  'blocage et transporter la réponse hors des conversations et journaux.'

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
