import type { Message } from './types'

/**
 * Le fil mis à plat pour un CLI qui ne reçoit qu'un texte : la consigne système, puis chaque
 * message (sous son rôle quand il y en a plusieurs), pièces jointes texte comprises.
 */
export function promptDuFil(messages: Message[], system?: string): string {
  const parties: string[] = []
  if (system) parties.push(system)
  for (const m of messages) {
    const joints = (m.attachments ?? [])
      .filter((a) => a.kind === 'text')
      .map((a) => `\n\n[Pièce jointe ${a.name}]\n${a.content}`)
      .join('')
    parties.push(messages.length > 1 ? `[${m.role}]\n${m.content}${joints}` : m.content + joints)
  }
  return parties.join('\n\n')
}
