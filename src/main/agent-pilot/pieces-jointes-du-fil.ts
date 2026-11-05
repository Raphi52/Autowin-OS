// Pièces jointes reprises du fil : binaire lisible, ou repli sur la miniature. Sorties telles
// quelles de agent-pilot.ts (conv-1580, lot 1).
import type { Message } from '../providers/types'

type PieceJointeDuFil = NonNullable<Message['attachments']>[number] & { thumbnail?: string }

/** Le binaire est-il REELLEMENT la ? Un `content` vide produirait un fichier vide chez le provider. */
export function aPieceJointeLisible(piece: PieceJointeDuFil | undefined): boolean {
  return typeof piece?.content === 'string' && piece.content.length > 0
}

/**
 * Repli sur la MINIATURE persistee quand l'original n'a pas survecu a la relecture du fil.
 *
 * Le fil ne persiste que `AttachmentMeta` : nom, type, taille, miniature. Rouvrir une conversation
 * perd donc le binaire d'origine. La miniature, elle, est une vraie image (data URL) : degradee mais
 * LISIBLE. Le nom porte la mention pour que le modele ne prenne jamais la reduction pour la source.
 */
export function replierSurLaMiniature(
  piece: PieceJointeDuFil | undefined
): PieceJointeDuFil | undefined {
  const thumbnail = piece?.thumbnail
  if (!piece || typeof thumbnail !== 'string' || !thumbnail.startsWith('data:image/'))
    return undefined
  const virgule = thumbnail.indexOf(',')
  const mimeType = thumbnail.slice(5, thumbnail.indexOf(';')) || 'image/png'
  const content = virgule >= 0 ? thumbnail.slice(virgule + 1) : ''
  if (!content) return undefined
  return {
    ...piece,
    name: `${piece.name} (miniature — original non conserve)`,
    mimeType,
    kind: 'image',
    size: content.length,
    content
  }
}

const MAX_PIECES_JOINTES_DU_FIL = 8

// Sortie de AgentPilot.chat(), où elle était calculée en place (conv-1580, lot 2).
/**
 * LES PIECES JOINTES DE TOUT LE FIL, PAS SEULEMENT DU DERNIER MESSAGE.
 *
 * Avant : `history.at(-1)?.attachments`. Une image jointe a un tour ANTERIEUR n'atteignait
 * jamais le modele — vecu par l'utilisateur le 2026-08-27 : il joint une image, en reparle au
 * tour suivant, et l'orchestrateur repond qu'aucune image ne lui est parvenue. Elle etait bien
 * stockee, affichee, et remise dans `history` par `index.ts` ; elle mourait ici.
 *
 * Le plus RECENT d'abord, puis on borne : les gardes IPC plafonnent a 8 pieces jointes, et la
 * question du tour porte presque toujours sur la derniere image. Sacrifier la plus ancienne est
 * une perte bornee et lisible ; jeter la courante serait reconduire le defaut.
 *
 * Dedoublonnage par (nom, contenu) : un fil ou l'utilisateur renvoie la meme capture deux fois
 * ne doit pas payer deux fois le meme binaire, ni consommer deux places sur les 8.
 */
export function piecesJointesDuFil(history: Message[]): NonNullable<Message['attachments']> {
  const vues = new Set<string>()
  const retenues: NonNullable<Message['attachments']> = []
  for (let index = history.length - 1; index >= 0; index--) {
    for (const brute of history[index]?.attachments ?? []) {
      /*
       * UNE PIECE JOINTE SANS BINAIRE N'EST PAS UNE PIECE JOINTE.
       *
       * Le fil PERSISTE `AttachmentMeta` (nom, type, taille, miniature) — le contenu original
       * n'y est PAS. Un fil rehydrate apres relecture rend donc des pieces jointes sans
       * `content` ; les envoyer telles quelles ferait ecrire un fichier vide au provider
       * (`materializeClaudeAttachments` fait `Buffer.from(content, 'base64')`). On les
       * remplace par leur MINIATURE quand elle existe -- degradee, mais lisible et NOMMEE
       * comme telle, jamais presentee comme l'original.
       */
      const lisible = aPieceJointeLisible(brute) ? brute : replierSurLaMiniature(brute)
      if (!lisible) continue
      /*
       * DIRE D'OU ELLE VIENT, sinon elle passe pour une piece jointe du message COURANT.
       *
       * Mesure du 2026-08-27 : le binaire arrivait bien au tour 2 (trace de prompt : chemin
       * present), et le modele repondait pourtant « AUCUNE IMAGE ». Sur une session reprise, le
       * fil textuel n'est pas renvoye — rien ne reliait donc le fichier remis au message
       * precedent, et l'entete du provider l'annonce comme « fournie par l'utilisateur »,
       * comprendre : maintenant. Le nom porte desormais la provenance.
       */
      const piece =
        index === history.length - 1
          ? lisible
          : {
              ...lisible,
              name: `${lisible.name} (jointe a un message precedent)`,
              // Le provider range les pieces par CE champ, pas par le nom (conv-150, tour 1bf1ae63).
              provenance: 'message-precedent' as const
            }
      // Cle calculee sur la piece AVANT renommage : sinon la meme image, jointe au message
      // courant ET a un message passe, produit deux cles et part deux fois (attrape par le test).
      const cle = `${lisible.name}|${lisible.content}`
      if (vues.has(cle)) continue
      vues.add(cle)
      retenues.push(piece)
      if (retenues.length >= MAX_PIECES_JOINTES_DU_FIL) return retenues
    }
  }
  return retenues
}
