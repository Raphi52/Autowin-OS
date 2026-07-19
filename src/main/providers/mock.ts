import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './types'

/**
 * Adaptateur MOCK — sert à valider le contrat + le routeur sans réseau ni OAuth.
 * Il « répond » en écho, et surtout il PROUVE l'injection système : si un bloc
 * `system` est fourni, il l'intègre à sa réponse (comme un vrai modèle citerait
 * une règle injectée), ce qui rend l'injection assertable en test unitaire.
 */
export class MockProvider implements ProviderAdapter {
  readonly id: string

  constructor(id = 'mock') {
    this.id = id
  }

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    messages: Message[],
    opts: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const systemInjected = typeof opts.system === 'string' && opts.system.length > 0
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''

    // Réponse simulée : écho +, si un système est injecté, une "citation" de sa
    // première ligne — l'équivalent mock du modèle qui applique une règle SOUL.
    const firstSystemLine = systemInjected ? opts.system!.split('\n')[0].trim() : ''
    const replyPieces = [
      `echo(${this.id}): ${lastUser}`,
      systemInjected ? ` [system-applied: ${firstSystemLine}]` : ''
    ]

    let text = ''
    for (const piece of replyPieces) {
      if (!piece) continue
      for (const word of piece.split(/(\s+)/)) {
        text += word
        if (word.trim()) yield { delta: word }
      }
    }

    return {
      text,
      provider: this.id,
      sessionId: opts.resumeSessionId ?? `${this.id}-session-1`,
      systemInjected
    }
  }
}
