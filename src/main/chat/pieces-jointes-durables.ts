/**
 * LES PIÈCES JOINTES SURVIVENT À LEUR TOUR (conv-1147, 2026-10-25).
 *
 * Constat : « Lancer en N fils » fait le travail au tour SUIVANT celui qui a reçu le message. Une
 * image y arrivait (son original était écrit à l'envoi, puis rechargé), mais un fichier texte ou un
 * PDF joint ne gardait que son nom : `run-pilot-chat.ts` n'écrivait que les images
 * (`if (kind !== 'image') return metadata`), et le renderer ne retransmet d'un message passé que
 * la miniature d'une image (`chat-attachments.ts`, `pieceJointePasseePourLeFil`). L'agent d'une
 * branche ne pouvait donc pas lire le journal que l'utilisateur avait joint.
 *
 * Deux moitiés, sorties du tour de chat pour être testées ensemble
 * (`pieces-jointes-durables.test.ts`, du message d'origine jusqu'au modèle de la branche) :
 * - à l'ENVOI, l'original de CHAQUE pièce est écrit dans le stockage des artefacts ;
 * - à la RELECTURE d'un message passé, le stockage fait foi : l'original remplace la miniature, et
 *   une pièce que le renderer ne transmet pas (texte, PDF) est rajoutée depuis le disque.
 * Le message COURANT n'est pas complété : le renderer l'envoie déjà en entier. Un original effacé
 * laisse ce qui a été transmis, sans faire échouer le tour (même règle que
 * `rechargerContenuPieceJointe`). Le plafond de 8 pièces par tour reste celui de `agent-pilot.ts`.
 */
import type { AttachmentMeta } from '../store/conversations'
import {
  materializeUserAttachmentArtifact,
  materializeUserImageArtifact,
  rechargerContenuPieceJointe
} from '../store/chat-artifact-store'

interface PieceEnvoyee {
  name: string
  mimeType: string
  size: number
  kind?: string
  content?: string
  thumbnail?: string
}

/** Une pièce rendue au modèle : sa nature et son contenu sont connus (contrat `Attachment`). */
interface PieceRelue {
  name: string
  mimeType: string
  size: number
  kind: 'text' | 'image' | 'file'
  content: string
}

/** Le renderer suffixe « (miniature) » une image dont il n'a plus que la vignette. */
const nomNu = (nom: string): string => nom.replace(/\s*\(miniature\)\s*$/, '')

/**
 * À l'ENVOI : la métadonnée persistée de chaque pièce, avec le chemin de son original. Une image
 * qui ne s'écrit pas est marquée `originalUnavailable` (sa miniature ne doit pas passer pour la
 * source) ; un autre fichier qui ne s'écrit pas garde sa seule métadonnée, comme avant.
 */
export function metasDurablesDesPieces(
  pieces: readonly PieceEnvoyee[],
  conversationId: string,
  turnId: string,
  base?: string
): AttachmentMeta[] {
  return pieces.map(({ name, mimeType, size, kind, content, thumbnail }) => {
    const metadata = { name, mimeType, size, ...(thumbnail && { thumbnail }) }
    if (kind === 'image') {
      try {
        return {
          ...metadata,
          turnId,
          artifact: materializeUserImageArtifact(
            { name, mimeType, size, content: content as string },
            conversationId,
            turnId,
            base
          )
        }
      } catch {
        return { ...metadata, turnId, originalUnavailable: true }
      }
    }
    if ((kind !== 'text' && kind !== 'file') || typeof content !== 'string' || !content)
      return metadata
    try {
      return {
        ...metadata,
        turnId,
        artifact: materializeUserAttachmentArtifact(
          { name, mimeType, size, kind, content },
          conversationId,
          turnId,
          base
        )
      }
    } catch {
      return metadata
    }
  })
}

/** Relit l'original d'une pièce stockée, dans la forme que le modèle attend. */
function relire(meta: AttachmentMeta, base?: string): PieceRelue | undefined {
  const original = rechargerContenuPieceJointe(meta, base)
  if (!original) return undefined
  const nature = meta.artifact?.kind
  if (nature === 'text') {
    const texte = Buffer.from(original.content, 'base64').toString('utf8')
    return {
      name: meta.name,
      mimeType: original.mimeType,
      size: meta.size,
      kind: 'text',
      content: texte
    }
  }
  return {
    name: meta.name,
    mimeType: original.mimeType,
    size: Buffer.byteLength(original.content, 'base64'),
    kind: nature === 'image' ? 'image' : 'file',
    content: original.content
  }
}

/**
 * À la RELECTURE : les pièces d'un message de l'historique, telles que le modèle doit les lire.
 * `transmises` vient du renderer, `stockees` du fil persisté (même message, retrouvé par son texte).
 */
export function piecesJointesPourLeModele<T extends PieceEnvoyee>(
  transmises: readonly T[] | undefined,
  stockees: readonly AttachmentMeta[] | undefined,
  options: { messageCourant: boolean; base?: string }
): Array<T | PieceRelue> {
  const metas = stockees ?? []
  const rendues: Array<T | PieceRelue> = (transmises ?? []).map((piece) => {
    const nu = nomNu(piece.name)
    const meta =
      metas.find((candidate) => candidate.name === nu) ??
      metas.find((candidate) => candidate.name === piece.name)
    const original = meta ? relire(meta, options.base) : undefined
    return original ? { ...piece, ...original, name: nu } : piece
  })
  if (options.messageCourant) return rendues
  const dejaLa = new Set(rendues.map((piece) => nomNu(piece.name)))
  for (const meta of metas) {
    if (dejaLa.has(meta.name)) continue
    const original = relire(meta, options.base)
    if (!original) continue
    dejaLa.add(meta.name)
    rendues.push(original)
  }
  return rendues
}
