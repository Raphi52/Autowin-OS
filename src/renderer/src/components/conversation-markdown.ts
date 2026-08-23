/**
 * EXPORT MARKDOWN d'une conversation : fonction PURE, testable sans DOM.
 *
 * Ne sérialise QUE ce que l'utilisateur voit : le texte des tours, les erreurs citées telles
 * quelles, les actions résumées par leur nom. Jamais les `args`/`data` bruts d'une action — ils
 * portent des chemins, des payloads et parfois des secrets, et personne ne les lit dans un export.
 */
import type { Msg } from './chat-view-types'

export interface ConversationAExporter {
  titre: string
  id: string
  messages: readonly Msg[]
}

function bloc(message: Msg): string {
  if (message.role === 'user') {
    const lignes = ['## Utilisateur', '', message.content.trim() || '_(message vide)_']
    const jointes = message.attachments ?? []
    if (jointes.length > 0) {
      lignes.push('', 'Pièces jointes :')
      for (const piece of jointes) lignes.push(`- ${piece.name} (${piece.mimeType})`)
    }
    return lignes.join('\n')
  }
  const lignes = ['## Assistant']
  for (const part of message.parts) {
    if (part.kind === 'text') {
      const texte = part.text.trim()
      if (texte) lignes.push('', texte)
    } else if (part.kind === 'error') {
      lignes.push('', `> ⛔ Erreur (${part.cause}) : ${part.message}`)
    } else if (part.kind === 'action') {
      const issue = part.ok === undefined ? '…' : part.ok ? 'ok' : 'échec'
      lignes.push('', `- 🛠️ ${part.name} — ${issue}`)
    } else if (part.kind === 'artifact') {
      lignes.push('', `- 📎 ${part.artifact.name || 'artefact'}`)
    }
  }
  if (lignes.length === 1) lignes.push('', '_(aucun contenu)_')
  return lignes.join('\n')
}

export function conversationEnMarkdown(conversation: ConversationAExporter): string {
  const entete = [
    `# ${conversation.titre || 'Conversation'}`,
    '',
    `Conversation : ${conversation.id}`
  ]
  if (conversation.messages.length === 0) {
    return [...entete, '', '_(conversation vide)_', ''].join('\n')
  }
  return [...entete, '', conversation.messages.map(bloc).join('\n\n'), ''].join('\n')
}

export function nomFichierExportMarkdown(titre: string, id: string): string {
  const base = titre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
  return `${base || 'conversation'}-${id}.md`
}
