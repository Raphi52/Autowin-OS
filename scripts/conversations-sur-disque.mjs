/**
 * LIRE LES CONVERSATIONS HORS DE L'APP, telles qu'elles sont réellement rangées sur le disque.
 *
 * Deux choses ont changé le 2026-10-14 dans `src/main/store/conversations-disk.ts`, et tout script
 * qui lit `conversations.json` à la main doit les connaître :
 *
 * 1. Le `content` d'un message à parties est écrit VIDE : il est dérivé de ses `parts` par
 *    `flattenChatParts`. `texteDuMessage` le reconstruit avec la MÊME fonction, importée de la
 *    source (Node 24 lit le TypeScript directement, comme `scripts/live-claude.mjs`) — aucune copie
 *    de la règle ne peut diverger.
 * 2. Les conversations inactives depuis 14 jours quittent le snapshot pour
 *    `conversations.json.archive/<id>.json`. Un script qui ne lit que le snapshot ne les voit plus ;
 *    pire, un ménage qui croirait leurs satellites orphelins les détruirait.
 *
 * La règle de priorité est celle de l'app : la copie ACTIVE (snapshot, journal) gagne toujours.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { flattenChatParts } from '../src/shared/chat-turn.ts'

/** Le texte lisible d'un message, qu'il soit écrit en entier ou dérivé de ses parties. */
export function texteDuMessage(message) {
  if (typeof message?.content === 'string' && message.content) return message.content
  if (Array.isArray(message?.parts) && message.parts.length > 0)
    return flattenChatParts(message.parts)
  return typeof message?.content === 'string' ? message.content : ''
}

/** Dossier d'archive d'un `conversations.json` donné. */
export function dossierArchive(fichierConversations) {
  return `${fichierConversations}.archive`
}

/** Les ids archivés, lus dans le nom des fichiers. */
export function idsArchives(fichierConversations) {
  const dossier = dossierArchive(fichierConversations)
  if (!existsSync(dossier)) return []
  const noms = readdirSync(dossier)
  // `<id>.supprime` : pierre tombale d'un fil supprimé dont l'archive n'a pas pu être retirée.
  const supprimes = new Set(
    noms.filter((nom) => nom.endsWith('.supprime')).map((nom) => nom.slice(0, -'.supprime'.length))
  )
  return noms
    .filter((nom) => nom.endsWith('.json'))
    .map((nom) => nom.slice(0, -'.json'.length))
    .filter((id) => !supprimes.has(id))
}

/** Les conversations archivées lisibles ; une archive abîmée est ignorée, jamais devinée. */
export function lireArchives(fichierConversations) {
  const sortie = []
  for (const id of idsArchives(fichierConversations)) {
    try {
      const conversation = JSON.parse(
        readFileSync(join(dossierArchive(fichierConversations), `${id}.json`), 'utf8')
      )
      if (conversation?.id === id) sortie.push(conversation)
    } catch {
      /* archive illisible : l'app la garde et la nomme, un script n'a rien à en déduire */
    }
  }
  return sortie
}

/** Complète `parId` avec les fils archivés qui n'y sont pas — la copie active reste prioritaire. */
export function ajouterArchives(parId, fichierConversations) {
  for (const conversation of lireArchives(fichierConversations)) {
    if (!parId.has(conversation.id)) parId.set(conversation.id, conversation)
  }
  return parId
}
