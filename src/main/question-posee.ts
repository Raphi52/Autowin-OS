/**
 * La question à l'utilisateur qu'un message a posée (commande `ask`), ou `undefined`.
 *
 * conv-1144 : un tour qui finit par une question se relisait par `conversation_read` comme une
 * réponse ordinaire — un script qui attend la fin du tour le prenait pour un succès, alors que le
 * fil ATTEND l'utilisateur. La question est rangée dans le message comme une part `action` nommée
 * `ask` (`src/shared/chat-turn.ts`, évènement `command`) ; vérifié sur les données réelles du
 * journal des conversations le 2026-10-25.
 */
export interface QuestionPosee {
  question: string
  options: string[]
}

export function questionPoseeDuMessage(message: { parts?: unknown }): QuestionPosee | undefined {
  if (!Array.isArray(message.parts)) return undefined
  const ask = message.parts.find(
    (part): part is { args?: unknown } =>
      typeof part === 'object' &&
      part !== null &&
      (part as { kind?: unknown }).kind === 'action' &&
      (part as { name?: unknown }).name === 'ask'
  )
  if (!ask) return undefined
  const args = (typeof ask.args === 'object' && ask.args !== null ? ask.args : {}) as {
    question?: unknown
    options?: unknown
  }
  return {
    question: typeof args.question === 'string' ? args.question : '',
    options: Array.isArray(args.options)
      ? args.options.filter((o): o is string => typeof o === 'string')
      : []
  }
}
