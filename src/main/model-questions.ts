export interface ModelQuestion {
  text: string
  options: string[]
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
    const value = JSON.parse(match[1]) as { text?: unknown; options?: unknown }
    if (typeof value.text !== 'string' || !value.text.trim()) return null
    const options = Array.isArray(value.options)
      ? value.options.filter((option): option is string => typeof option === 'string').slice(0, 8)
      : []
    return { text: value.text.trim().slice(0, 4_000), options }
  } catch {
    return null
  }
}

export const MODEL_QUESTION_INSTRUCTION =
  'Si une information humaine est indispensable pour continuer, réponds UNIQUEMENT avec ' +
  '<question>{"text":"question précise","options":["option 1","option 2"]}</question>. ' +
  'N’utilise pas ce format pour une question rhétorique ou facultative.'

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
    context?: string
  ): Promise<string> {
    const id = `model-question-${this.nextId++}`
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
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

  cancelAll(reason = 'Fenêtre fermée'): void {
    for (const pending of this.waiting.values()) pending.reject(new Error(reason))
    this.waiting.clear()
  }
}
