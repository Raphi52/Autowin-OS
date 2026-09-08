/**
 * Les PIECES JOINTES d'un message Outlook envoyé depuis la tuile Interlocuteurs.
 *
 * Demande de l'utilisateur du 2026-09-08 : glisser un PDF dans l'écran « nouveau message ». Ce
 * fichier tient la partie qui n'a pas besoin de React — les plafonds, le refus NOMMÉ, et la lecture
 * du fichier lâché — pour qu'elle soit vérifiable sans monter d'interface.
 *
 * On lit le CONTENU du fichier, pas son chemin. Deux raisons :
 *  - un fichier glissé depuis Outlook ou depuis une archive n'existe pas sur le disque, il n'a donc
 *    aucun chemin à donner ;
 *  - Electron ne rend plus `File.path` : le chemin réel demanderait `webUtils.getPathForFile`, que
 *    ce dépôt n'expose nulle part.
 *
 * Les plafonds sont ceux du chat (`ChatView.addFiles`) : mêmes ordres de grandeur, mêmes phrases,
 * pour que l'utilisateur n'ait pas deux règles à retenir selon l'endroit où il lâche son fichier.
 */
import { bytesToBase64, formatFileSize } from './chat-attachments'

/** Ce qui traverse l'IPC pour UNE pièce jointe : son nom, sa taille, son contenu en base64. */
export interface PieceJointeMessage {
  nom: string
  taille: number
  contenuBase64: string
}

/** Assez pour un devis et ses annexes, assez peu pour rester un widget. */
export const MAX_PIECES = 5
export const MAX_PIECE_OCTETS = 10 * 1024 * 1024
export const MAX_PIECES_OCTETS = 20 * 1024 * 1024

/**
 * Lit les fichiers lâchés et les rend prêts à partir — ou dit POURQUOI ils ne partiront pas.
 *
 * Aucun refus muet : un fichier écarté sans un mot ferait croire à l'utilisateur que sa pièce est
 * jointe, et le message partirait sans elle. Un envoi ne se rattrape pas.
 */
export async function preparerPiecesLachees(
  dejaLa: readonly PieceJointeMessage[],
  fichiers: readonly File[]
): Promise<{ pieces: PieceJointeMessage[] } | { erreur: string }> {
  // Le même fichier lâché deux fois est le même fichier : on l'ignore plutôt que de le joindre deux
  // fois, comme le compositeur du chat.
  const vus = new Set(dejaLa.map((piece) => JSON.stringify([piece.nom, piece.taille])))
  const retenus = fichiers.filter((fichier) => {
    const cle = JSON.stringify([fichier.name, fichier.size])
    if (vus.has(cle)) return false
    vus.add(cle)
    return true
  })
  if (retenus.length === 0) return { pieces: [] }
  if (dejaLa.length + retenus.length > MAX_PIECES) {
    return { erreur: `Pas plus de ${MAX_PIECES} pièces jointes par message.` }
  }
  const tropGros = retenus.find((fichier) => fichier.size > MAX_PIECE_OCTETS)
  if (tropGros) {
    return { erreur: `${tropGros.name} dépasse la limite de 10 Mo.` }
  }
  const total =
    dejaLa.reduce((somme, piece) => somme + piece.taille, 0) +
    retenus.reduce((somme, fichier) => somme + fichier.size, 0)
  if (total > MAX_PIECES_OCTETS) {
    return { erreur: 'Le total des pièces jointes dépasse 20 Mo.' }
  }
  try {
    const pieces = await Promise.all(
      retenus.map(async (fichier) => ({
        nom: fichier.name,
        taille: fichier.size,
        contenuBase64: bytesToBase64(new Uint8Array(await fichier.arrayBuffer()))
      }))
    )
    return { pieces }
  } catch (error) {
    return {
      erreur: `Lecture impossible : ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/** La taille d'une pièce, dans les mêmes mots que le compositeur du chat. */
export function tailleLisible(octets: number): string {
  return formatFileSize(octets)
}
