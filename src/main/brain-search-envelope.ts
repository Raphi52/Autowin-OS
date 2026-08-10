/**
 * ENVELOPPE de `os:searchBrain` — arrêter de JETER ce que le retrieval sait déjà.
 *
 * Constat (2026-08-10) : le handler `os:searchBrain` appelait bien `retrieveBrainContext()`, qui
 * distingue quatre états (`found | empty | invalid | unavailable`, brain-retrieval.ts) et expose une
 * `navigation` complète (rang, dense_cos, retenu/écarté, tranche d'octets du chunk injecté). Mais il
 * ne recopiait que quatre scores sur les nœuds locaux : le statut et la navigation n'atteignaient
 * JAMAIS le renderer. La vue Knowledge aplatissait donc une PANNE et un « rien trouvé » en un même
 * tableau vide, et les plafonds d'injection restaient invisibles.
 *
 * Ce module est pur : il compose l'enveloppe rendue au renderer. Les plafonds ne sont pas recopiés en
 * littéral, ils sont IMPORTÉS de `brain-query-command.ts` — seule source de vérité de l'injection.
 */
import {
  BRAIN_QUERY_MAX_CHARS,
  BRAIN_RESULT_CAP,
  capBrainResult,
  decideBrainQuery
} from './brain-query-command'
import type { BrainNavigation, BrainRetrievalResult, BrainRetrievalStatus } from './brain-retrieval'

/** Nœud local rendu par la recherche du vault — inchangé, seulement transporté. */
export interface BrainSearchLocalResult {
  id: string
  label: string
  file: string
  themes: string[]
  score: number
  denseScore?: number
  lexicalScore?: number
  graphScore?: number
  fusedScore?: number
  relations?: Array<{ type: string; target: string }>
}

/** État du retrieval, y compris le cas « on n'a pas interrogé » (question vide). */
export type BrainSearchStatus = BrainRetrievalStatus | 'not-requested'

/**
 * Notes affichables, une par état. Elles existent pour que l'UI ne puisse PAS rendre les quatre états
 * avec le même message : c'est exactement la confusion qu'on corrige.
 */
export const BRAIN_RETRIEVAL_NOTES: Record<BrainSearchStatus, string> = {
  found: 'savoir trouvé — passages retenus injectés dans le budget ci-dessous',
  empty: 'aucun passage au-dessus du seuil : le savoir ne couvre pas cette question',
  invalid: 'réponse du Brain non vérifiable (signature ou format) — écartée par prudence',
  unavailable: 'serveur Brain injoignable — seule la recherche locale du vault a répondu',
  'not-requested': 'question vide — le Brain n’a pas été interrogé'
}

/** Ce que l'injection consomme réellement, et ce qu'elle a coupé. */
export interface BrainInjectionBudget {
  /** Longueur de la question telle que soumise par l'humain, avant bornage. */
  questionSubmittedChars: number
  /** Longueur réellement envoyée au Brain. */
  questionChars: number
  questionMax: number
  questionTruncated: boolean
  /** Savoir disponible avant plafonnement. */
  knowledgeAvailableChars: number
  /** Savoir réellement transmis. */
  knowledgeChars: number
  knowledgeMax: number
  knowledgeTruncated: boolean
  /** Caractères de savoir perdus au plafond — le chiffre que l'UI doit montrer. */
  knowledgeDroppedChars: number
}

export interface BrainSearchEnvelope {
  status: BrainSearchStatus
  note: string
  /** Question effectivement soumise (normalisée + bornée), pas la saisie brute. */
  query: string
  results: BrainSearchLocalResult[]
  navigation?: BrainNavigation
  budget: BrainInjectionBudget
}

export interface BuildBrainSearchEnvelopeArgs {
  rawQuery: string
  results: BrainSearchLocalResult[]
  /** Absent quand la question n'était pas soumissible : l'appel n'a pas eu lieu. */
  retrieval: BrainRetrievalResult | undefined
}

export function buildBrainSearchEnvelope({
  rawQuery,
  results,
  retrieval
}: BuildBrainSearchEnvelopeArgs): BrainSearchEnvelope {
  const decision = decideBrainQuery(rawQuery)
  const normalized = typeof rawQuery === 'string' ? rawQuery.replace(/\s+/g, ' ').trim() : ''
  const query = decision.allowed ? decision.query : ''
  const knowledgeAvailable = (retrieval?.context ?? '').trim()
  const capped = knowledgeAvailable ? capBrainResult(knowledgeAvailable) : ''
  const status: BrainSearchStatus = retrieval ? retrieval.status : 'not-requested'
  return {
    status,
    note: BRAIN_RETRIEVAL_NOTES[status],
    query,
    results,
    ...(retrieval?.navigation ? { navigation: retrieval.navigation } : {}),
    budget: {
      questionSubmittedChars: normalized.length,
      questionChars: query.length,
      questionMax: BRAIN_QUERY_MAX_CHARS,
      questionTruncated: normalized.length > BRAIN_QUERY_MAX_CHARS,
      knowledgeAvailableChars: knowledgeAvailable.length,
      knowledgeChars: capped.length,
      knowledgeMax: BRAIN_RESULT_CAP,
      knowledgeTruncated: knowledgeAvailable.length > BRAIN_RESULT_CAP,
      knowledgeDroppedChars: Math.max(0, knowledgeAvailable.length - capped.length)
    }
  }
}
