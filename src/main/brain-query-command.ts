import type { BrainRetrievalStatus } from './brain-retrieval'

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
export const BRAIN_RESULT_TRUNCATION_MARKER = '\n…[tronqué — suite du savoir non transmise]'

/** Compte des caractères Unicode complets (points de code), jamais des demi-paires UTF-16. */
export function countBrainCharacters(value: string): number {
  let count = 0
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    const nextCodeUnit = value.charCodeAt(index + 1)
    if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      nextCodeUnit >= 0xdc00 &&
      nextCodeUnit <= 0xdfff
    ) {
      index += 1
    }
    count += 1
  }
  return count
}

/** Coupe à une frontière Unicode valide sans matérialiser tout le texte dans un tableau. */
function sliceBrainCharacters(value: string, max: number): string {
  if (max <= 0) return ''
  let count = 0
  let end = 0
  for (const character of value) {
    if (count >= max) break
    end += character.length
    count += 1
  }
  return end >= value.length ? value : value.slice(0, end)
}

export type BrainQueryDecision =
  { allowed: true; query: string } | { allowed: false; reason: string }

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
  return { allowed: true, query: sliceBrainCharacters(query, BRAIN_QUERY_MAX_CHARS) }
}

/**
 * Borne le savoir rendu a l'agent. Le Brain peut renvoyer beaucoup : sans plafond, une seule question
 * gonflerait le tour de plusieurs milliers de tokens — exactement le cout qu'on passe la journee a
 * reduire. On garde le DEBUT (le retriever classe par pertinence, le plus utile est en tete).
 */
export function capBrainResult(raw: string, cap: number = BRAIN_RESULT_CAP): string {
  const text = raw.trim()
  if (countBrainCharacters(text) <= cap) return text
  return `${sliceBrainCharacters(
    text,
    Math.max(0, cap - countBrainCharacters(BRAIN_RESULT_TRUNCATION_MARKER))
  )}${BRAIN_RESULT_TRUNCATION_MARKER}`
}

/** Réponse rendue à l'agent : jamais une erreur brute de transport. */
export interface BrainQueryOutcome {
  found: boolean
  query: string
  knowledge: string
  status: BrainRetrievalStatus | 'not-requested'
  /** Renseigné quand rien n'est rendu : le serveur est absent, ou le savoir ne couvre pas la question. */
  note?: string
}

/** Compose la réponse, en distinguant « rien trouvé » d'une panne (l'agent doit pouvoir le dire). */
export function buildBrainOutcome(
  query: string,
  context: string,
  status: BrainRetrievalStatus = context.trim() ? 'found' : 'unavailable'
): BrainQueryOutcome {
  const knowledge = capBrainResult(context)
  const effectiveStatus: BrainRetrievalStatus = knowledge || status !== 'found' ? status : 'empty'
  if (!knowledge) {
    const note =
      effectiveStatus === 'invalid'
        ? "reponse Brain rejetee : identite ou integrite invalide - aucune connaissance n'a ete utilisee"
        : effectiveStatus === 'empty'
          ? 'aucun savoir cure sur cette question - ne pas conclure que la reponse est negative'
          : 'service Brain indisponible - ne pas conclure que la reponse est negative'
    return {
      found: false,
      query,
      knowledge: '',
      status: effectiveStatus,
      note
    }
  }
  return { found: true, query, knowledge, status: 'found' }
}
