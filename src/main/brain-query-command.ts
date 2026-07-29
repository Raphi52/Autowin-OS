/**
 * COMMANDE `brain_query` — interroger le savoir CURE a la demande.
 *
 * Pourquoi (2026-07-28) : `retrieveBrainContext(task)` n'etait appele qu'UNE FOIS par run, sur la
 * tache initiale. C'etait un pre-chargement, pas un acces. Un agent qui decouvrait un besoin en cours
 * de route brute-forcait le repo au lieu d'interroger le Brain — alors que la connaissance y est deja
 * curee. Meme mouvement que la lecture seule et `verify` livrees le meme jour : passer d'un contexte
 * pousse a une capacite disponible.
 *
 * Ici, contrairement a `verify`, l'argument du modele est LEGITIME : une recherche a besoin de sa
 * question. Le bornage porte donc sur la FORME (longueur, non-vide) et sur la TAILLE du resultat,
 * jamais sur une liste blanche.
 */

export const BRAIN_QUERY_MAX_CHARS = 500
export const BRAIN_RESULT_CAP = 6_000

export type BrainQueryDecision =
  | { allowed: true; query: string }
  | { allowed: false; reason: string }

/**
 * Valide et NORMALISE la question. Une requete vide n'a rien a chercher ; une requete demesuree est
 * tronquee plutot que refusee (le modele n'a pas a deviner une limite pour obtenir une reponse).
 */
export function decideBrainQuery(raw: unknown): BrainQueryDecision {
  if (typeof raw !== 'string') {
    return { allowed: false, reason: 'question manquante ou invalide' }
  }
  const query = raw.replace(/\s+/g, ' ').trim()
  if (!query) return { allowed: false, reason: 'question vide — rien à chercher' }
  return { allowed: true, query: query.slice(0, BRAIN_QUERY_MAX_CHARS) }
}

/**
 * Borne le savoir rendu a l'agent. Le Brain peut renvoyer beaucoup : sans plafond, une seule question
 * gonflerait le tour de plusieurs milliers de tokens — exactement le cout qu'on passe la journee a
 * reduire. On garde le DEBUT (le retriever classe par pertinence, le plus utile est en tete).
 */
export function capBrainResult(raw: string, cap: number = BRAIN_RESULT_CAP): string {
  const text = raw.trim()
  if (text.length <= cap) return text
  const marker = '\n…[tronqué — suite du savoir non transmise]'
  return `${text.slice(0, Math.max(0, cap - marker.length))}${marker}`
}

/** Réponse rendue à l'agent : jamais une erreur brute de transport. */
export interface BrainQueryOutcome {
  found: boolean
  query: string
  knowledge: string
  /** Renseigné quand rien n'est rendu : le serveur est absent, ou le savoir ne couvre pas la question. */
  note?: string
}

/** Compose la réponse, en distinguant « rien trouvé » d'une panne (l'agent doit pouvoir le dire). */
export function buildBrainOutcome(query: string, context: string): BrainQueryOutcome {
  const knowledge = capBrainResult(context)
  if (!knowledge) {
    return {
      found: false,
      query,
      knowledge: '',
      note: 'aucun savoir curé sur cette question (ou service Brain indisponible) — ne pas conclure que la réponse est négative'
    }
  }
  return { found: true, query, knowledge }
}
