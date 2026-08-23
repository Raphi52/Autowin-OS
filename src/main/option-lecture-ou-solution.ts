/**
 * UNE OPTION CLIQUABLE EST-ELLE UNE LECTURE DU BESOIN, OU UNE SOLUTION DEJA CHOISIE ?
 *
 * Defaut mesure le 2026-08-23 sur conv-1376. L'utilisateur ecrit un SYMPTOME (« je vois plu
 * l'historique »). L'assistant lui propose des options redigees comme des SOLUTIONS techniques
 * (« Corrige ChatView.tsx piste A : amorce le cache… »). Il clique — c'est le chemin le plus court —
 * et ce texte devient son message, puis l'objectif du run. La machine execute alors fidelement un
 * choix technique que personne n'a vraiment fait.
 *
 * CE MODULE NE BLOQUE JAMAIS. Precedent mesure le 2026-08-18 (`conversation-task-contract.ts`) :
 * une heuristique locale qui BLOQUAIT a produit onze faux blocages sur du travail legitime. La
 * lecon retenue y est ecrite noir sur blanc — le contrat ne se devine pas, et une garde qui se
 * trompe coute plus cher que le defaut qu'elle attrape. Ici on SIGNALE, un point c'est tout.
 *
 * CE QU'ON REGARDE : `envoi ?? libelle`. C'est `envoi` qui part au clic et devient l'objectif du
 * run — juger le libelle affiche laisserait passer exactement le cas qui nous occupe.
 */

/** Une demande est un SYMPTOME quand elle decrit ce que l'utilisateur CONSTATE, sans nommer de cible. */
export function demandeEstUnSymptome(demande: string): boolean {
  const t = demande.toLowerCase()
  if (CIBLE_NOMMEE.test(demande)) return false // il a deja nomme le fichier : son choix, pas le notre
  return SYMPTOME.test(t)
}

/**
 * Un chemin de fichier, une extension, un identifiant en casse chameau/serpent, une « piste » nommee.
 * Volontairement CONSERVATEUR : on prefere rater un cas que crier sur une option legitime.
 */
const CIBLE_NOMMEE =
  /\b[\w./\\-]+\.(?:ts|tsx|js|jsx|css|json|ps1|md)\b|\b[a-z]+[A-Z]\w*\(|\bpiste [A-Z]\b|\bsrc\/[\w./-]+/

/** Formes par lesquelles un utilisateur DECRIT ce qu'il observe, sans savoir pourquoi. */
const SYMPTOME =
  /\b(je vois|j'ai|ca (ne )?marche|ne marche pas|marche plus|plus (d'|de )|disparu|disparait|vide|bloque|plante|lent|bug|bizarre|rien ne|impossible de|quand je)\b/

/**
 * Le FIL part-il d'un symptome, sans que l'utilisateur ait jamais nomme sa cible ?
 *
 * Regarder le seul DERNIER message ne suffit pas, et le cas d'ancrage le prouve : au moment ou
 * l'option fautive « Corrige ChatView.tsx piste A » a ete PROPOSEE, le dernier message de
 * l'utilisateur etait « Diagnostiquer d'abord… » — pas un symptome. Une garde branchee sur le
 * dernier message serait passee a cote du seul cas qu'elle devait attraper.
 *
 * Le critere tient donc sur le fil : quelqu'un a decrit un symptome, et personne n'a encore nomme
 * de fichier. Des que l'utilisateur nomme sa cible, il a tranche — on se tait.
 */
export function filEstUnSymptome(messagesUtilisateur: string[]): boolean {
  if (messagesUtilisateur.some((message) => CIBLE_NOMMEE.test(message))) return false
  return messagesUtilisateur.some((message) => SYMPTOME.test(message.toLowerCase()))
}

export interface SignalOption {
  /** Index de l'option en cause, pour que le signal soit traçable a une reponse precise. */
  index: number
  /** Le texte fautif, borne. */
  extrait: string
}

/**
 * Rend la liste des options qui nomment une cible technique alors que la demande est un symptome.
 * Vide = rien a signaler. N'a AUCUN effet de bord et ne jette jamais.
 */
export function optionsQuiPresupposentUneSolution(
  demande: string | string[],
  options: Array<{ libelle: string; envoi?: string }>
): SignalOption[] {
  const fil = Array.isArray(demande) ? demande : [demande]
  if (!filEstUnSymptome(fil)) return []
  return options
    .map((option, index) => ({ index, texte: option.envoi ?? option.libelle }))
    .filter(({ texte }) => CIBLE_NOMMEE.test(texte))
    .map(({ index, texte }) => ({ index, extrait: texte.slice(0, 160) }))
}
