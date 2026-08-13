/**
 * Un `done` conversationnel reprend souvent le texte deja streame : on ne le duplique pas. Une
 * cloture d'orchestration porte au contraire un outcome structure distinct du preambule ; elle doit
 * toujours rester visible et durable.
 */
export function shouldPersistClosingText(
  durableResponseTextSeen: boolean,
  outcome: Record<string, unknown> | undefined
): boolean {
  return !durableResponseTextSeen || Boolean(outcome && Object.keys(outcome).length > 0)
}
