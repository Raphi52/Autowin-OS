/**
 * Nom de la balise qui encadre les mots de l'utilisateur dans un tour compose (conv-889, 2026-09-30).
 *
 * Partage entre le processus principal, qui POSE la balise (`main/chat-turn-messages.ts`,
 * `motsUtilisateur`), et l'interface, qui la RETIRE pour afficher la demande
 * (`renderer/src/components/human-message.ts`). Une seule definition : si l'un changeait le nom sans
 * l'autre, l'interface afficherait les balises dans chaque libelle de tour.
 */
export const BALISE_MESSAGE_UTILISATEUR = 'message_utilisateur'

const BALISES = new RegExp(`</?${BALISE_MESSAGE_UTILISATEUR}>`, 'gi')

/** Le texte sans ses balises d'encadrement. */
export function sansBaliseMessageUtilisateur(texte: string): string {
  return texte.replace(BALISES, '')
}

const BLOC_DEMANDE = new RegExp(
  `<${BALISE_MESSAGE_UTILISATEUR}>([\\s\\S]*?)</${BALISE_MESSAGE_UTILISATEUR}>`,
  'gi'
)
const MARQUE_UTILISATEUR = /(^|\n)\s*UTILISATEUR\s*:/
const SEGMENT_UTILISATEUR = /^\s*UTILISATEUR\s*:/

/**
 * LA DEMANDE HUMAINE ENTIÈRE d'un contenu de tour composé, paragraphes et sauts de ligne compris —
 * pour être LUE (détail de la brique Demande du graphe, demande du 2026-10-12), pas pour un libellé.
 *
 * Le libellé coupe au premier paragraphe : `extractHumanMessage` et `extraitDemandeUtilisateur`
 * découpent sur les lignes vides. Une demande de plusieurs paragraphes n'y gardait que le premier.
 * Ici, le DERNIER bloc balisé gagne (le plus récent, comme pour le libellé) : la balise est
 * neutralisée dans les mots de l'utilisateur (`motsUtilisateur`), donc son bloc ne se coupe jamais
 * trop tôt. Sans balise (trace d'avant conv-889, extrait borné), même découpe que le libellé.
 *
 * Vide sans marqueur `UTILISATEUR:` : seul lui identifie une demande humaine sans ambiguïté.
 */
export function demandeHumaineEntiere(contenu: string): string {
  const texte = contenu ?? ''
  if (!MARQUE_UTILISATEUR.test(texte)) return ''
  const blocs = [...texte.matchAll(BLOC_DEMANDE)]
  if (blocs.length > 0) return blocs[blocs.length - 1][1].trim()
  const dernier = texte
    .split('\n\n')
    .filter((segment) => SEGMENT_UTILISATEUR.test(segment))
    .at(-1)
  return dernier
    ? sansBaliseMessageUtilisateur(dernier.replace(/^\s*UTILISATEUR\s*:\s*/, '')).trim()
    : ''
}
