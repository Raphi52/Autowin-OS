import type { BrainRetrievalStatus, BrainUnavailableReason } from './brain-retrieval'

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
  /** LAQUELLE des causes d'indisponibilité s'est produite — pour ne pas rediagnostiquer à l'aveugle. */
  unavailableReason?: BrainUnavailableReason
}

/**
 * LAQUELLE des causes, pas six hypotheses. `retrieveBrain` sait deja laquelle s'est produite
 * (brain-retrieval.ts) ; sans ce relais la note restait generique et l'agent rediagnostiquait a
 * l'aveugle un serveur parfois SAIN (mesure du 2026-09-23 : `npm run brain:doctor` repondait
 * « CANAL UTILISABLE » pendant que `brain_query` annoncait une panne).
 */
const CAUSES_INDISPONIBLE: Record<BrainUnavailableReason, string> = {
  'no-token':
    "cause exacte : aucun jeton de service lisible, aucun jeton n'a ete lu donc aucune requete n'est partie " +
    "- le reglage BRAIN_TOKEN manque a l'app (le recharger a chaud plutot que redemarrer)",
  'empty-query': 'cause exacte : la requete etait vide, rien n’a ete envoye',
  'challenge-refused':
    'cause exacte : le serveur est vivant mais a refuse d’ouvrir la session (GET /challenge non-ok)',
  'query-refused':
    'cause exacte : le serveur a refuse la requete (POST /query-secure non-ok : jeton rejete ou index degrade)',
  network: 'cause exacte : rien n’a repondu (serveur arrete, delai depasse ou reseau)',
  'test-mode':
    'neutralisation sous test : ce n’est PAS une panne reelle, aucune reparation n’est attendue ici'
}

const PANNE_GENERIQUE =
  'service Brain indisponible - ne pas conclure que la reponse est negative. ' +
  "C'est une PANNE a reparer, pas une reponse : relancer la MEME question a l'identique " +
  'ne servira a rien. Diagnostique le serveur Brain (process, port, protocole, journal), ' +
  'repare-le, puis rejoue la question - et ne rends la main sur une autre source ' +
  "qu'apres avoir dit ce que tu as essaye."

function noteIndisponible(reason?: BrainUnavailableReason): string {
  if (reason === 'test-mode') return CAUSES_INDISPONIBLE['test-mode']
  if (!reason) return PANNE_GENERIQUE
  return `${CAUSES_INDISPONIBLE[reason]}. ${PANNE_GENERIQUE}`
}

/** Compose la réponse, en distinguant « rien trouvé » d'une panne (l'agent doit pouvoir le dire). */
export function buildBrainOutcome(
  query: string,
  context: string,
  status: BrainRetrievalStatus = context.trim() ? 'found' : 'unavailable',
  unavailableReason?: BrainUnavailableReason
): BrainQueryOutcome {
  const knowledge = capBrainResult(context)
  const effectiveStatus: BrainRetrievalStatus = knowledge || status !== 'found' ? status : 'empty'
  if (!knowledge) {
    const note =
      effectiveStatus === 'invalid'
        ? "reponse Brain rejetee : identite ou integrite invalide - aucune connaissance n'a ete utilisee"
        : effectiveStatus === 'empty'
          ? 'aucun savoir cure sur cette question - ne pas conclure que la reponse est negative'
          : // PANNE = TACHE, PAS FIN DE ROUTE (kaizen conv-151, saisie ts=1788375174361 :
            // « t'aurais du reparer le brain »). La note disait seulement « ne conclus pas au
            // negatif » : le modele a relance SIX fois la meme question entre 18:57:46 et 19:04:52
            // (traces status=unavailable), puis s'est rabattu sur d'autres sources et a rendu la
            // main. Il a fallu que l'utilisateur ordonne la reparation. La note porte desormais le
            // geste attendu.
            noteIndisponible(unavailableReason)
    return {
      found: false,
      query,
      knowledge: '',
      status: effectiveStatus,
      note,
      ...(unavailableReason ? { unavailableReason } : {})
    }
  }
  return { found: true, query, knowledge, status: 'found' }
}
