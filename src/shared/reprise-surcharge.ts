/**
 * REPRISE APRÈS SURCHARGE DU MODÈLE (529).
 *
 * Demande utilisateur du 2026-09-03 : « quand le modèle renvoie une erreur 529, forke la
 * conversation et reprends (max 3 tentatives) ». Un tour coupé par une surcharge du fournisseur
 * n'est pas un échec de la demande : c'est le serveur d'en face qui refuse. Jusqu'ici l'utilisateur
 * devait renvoyer sa demande à la main.
 *
 * Ce module ne fait QUE décider. Il ne forke rien, n'appelle rien : la vue applique sa décision.
 * Les motifs de reconnaissance reprennent ceux de `isUpstreamOutage`
 * (src/main/task-manager/watchdog-suppression.ts), qui vit côté processus principal et n'est donc
 * pas importable depuis l'interface.
 */

/** Nombre maximal de reprises automatiques, APRÈS l'échec initial. */
export const MAX_REPRISES_SURCHARGE = 3

/**
 * Attente avant chaque reprise. Le CLI a déjà retenté ~10 fois en interne pendant 2-3 min : repartir
 * dans la seconde retomberait sur la même surcharge. L'attente croît d'une reprise à l'autre.
 */
const ATTENTES_MS: readonly number[] = [30_000, 60_000, 120_000]

/**
 * Le message d'erreur décrit-il une SURCHARGE / indisponibilité du fournisseur ?
 *
 * Volontairement conservateur : un nombre 5xx isolé ne suffit JAMAIS (« ligne 529 » n'est pas une
 * panne). Il faut un contexte qui dit qu'il s'agit d'un statut ou d'une erreur d'API.
 */
export function estSurchargeFournisseur(texte: string | undefined | null): boolean {
  const t = (texte ?? '').toLowerCase()
  if (!t.trim()) return false
  return (
    // Vocabulaire explicite des fournisseurs : aucune ambiguïté possible.
    /\boverloaded(?:_error)?\b/.test(t) ||
    /\bapi_error\b/.test(t) ||
    /\brate[ _-]?limit/.test(t) ||
    /\binternal server error\b/.test(t) ||
    /\bservice[ _]unavailable\b/.test(t) ||
    /\bbad gateway\b/.test(t) ||
    /\bgateway time-?out\b/.test(t) ||
    /\bupstream connect error\b/.test(t) ||
    // Le message d'abandon écrit par notre propre adaptateur : « API Claude surchargée (529) — … ».
    /\bapi\b[^\n]{0,60}\bsurcharg/.test(t) ||
    /\bsurcharg[^\n]{0,60}\b5\d{2}\b/.test(t) ||
    // Codes 5xx, uniquement quand le contexte dit qu'il s'agit d'un statut ou d'une erreur.
    /\bhttp\s?5\d{2}\b/.test(t) ||
    /\bstatus(?:\s?code)?\s?5\d{2}\b/.test(t) ||
    /\b(?:erreur|error)\s+5\d{2}\b/.test(t) ||
    /\bapi error\b[^\n]{0,40}\b5\d{2}\b/.test(t) ||
    /\b5\d{2}\b[^\n]{0,40}\bapi error\b/.test(t) ||
    // Couche réseau : la requête n'a même pas abouti.
    /\b(?:econnreset|etimedout|enotfound|eai_again|econnrefused)\b/.test(t) ||
    /\bsocket hang up\b/.test(t) ||
    /\bfetch failed\b/.test(t)
  )
}

export interface EntreeRepriseSurcharge {
  /** Le tour a-t-il réussi ? */
  ok: boolean
  /** Le tour a-t-il été arrêté par l'utilisateur ? Un arrêt volontaire ne se reprend JAMAIS. */
  cancelled: boolean
  /** Message d'erreur du tour, tel que rendu par le processus principal. */
  erreur?: string
  /**
   * Texte RENDU par le tour. Mesuré le 2026-09-03 (conv-28) : un fournisseur surchargé ne fait pas
   * toujours ECHOUER le tour — il « répond » le texte de l'incident (« API Error: 529 Overloaded…
   * try again in a moment »). Le tour comptait alors pour un succès et aucune reprise ne partait.
   */
  texteRendu?: string
  /** Reprises DÉJÀ faites pour cette même demande (0 au premier échec). */
  tentativesDejaFaites: number
  /** Plafond, pour les tests et un réglage éventuel. */
  max?: number
}

export type DecisionRepriseSurcharge =
  | { action: 'forker-et-reprendre'; tentative: number; attenteMs: number }
  | {
      action: 'renoncer'
      raison: 'succes' | 'annule' | 'pas-une-surcharge' | 'plafond-atteint'
    }

/**
 * Le texte s'ouvre-t-il sur une ÉTIQUETTE d'erreur brute, comme un outil qui recrache un incident
 * (« API Error: … », « Error: … », un corps JSON d'erreur) ? Une réponse rédigée commence par une
 * phrase, jamais par ça : c'est ce qui sépare l'incident du DISCOURS sur l'incident.
 */
const ETIQUETTE_ERREUR_BRUTE =
  /^(?:\{|\[|api[ _-]?error\b|error\b|erreur\b|api\s+claude\s+surcharg|request\s+failed\b|http\b|status\b|overloaded\b|\d{3}\b)/i

/**
 * La réponse rendue EST-ELLE l'incident du fournisseur, plutôt qu'une réponse ?
 */
export function estReponseDeSurcharge(texte: string | undefined | null): boolean {
  const t = (texte ?? '').trim()
  // TROIS conditions, car rejouer à tort DÉTRUIRAIT une réponse produite. Une réponse rédigée peut
  // très bien PARLER d'une surcharge (un diagnostic, ce commentaire même) ; deux critères plus
  // faibles ont été essayés et pris en défaut : le seuil de longueur seul laissait passer un
  // diagnostic de 330 caractères, et « les 80 premiers caractères » laissait passer une phrase
  // d'analyse qui s'ouvrait sur « … une erreur 529 arrivée dans le texte ». Le marqueur fiable est
  // STRUCTUREL : un tour perdu ne contient QUE l'incident, donc il est court ET il s'ouvre sur une
  // ÉTIQUETTE d'erreur brute — ce qu'une phrase rédigée ne fait jamais.
  if (!t || t.length > 400) return false
  if (!ETIQUETTE_ERREUR_BRUTE.test(t)) return false
  return estSurchargeFournisseur(t)
}

/** La SEULE porte qui autorise une reprise automatique après surcharge. */
export function deciderRepriseSurcharge(entree: EntreeRepriseSurcharge): DecisionRepriseSurcharge {
  const surchargeRendue = !entree.cancelled && estReponseDeSurcharge(entree.texteRendu)
  if (entree.ok && !entree.cancelled && !surchargeRendue)
    return { action: 'renoncer', raison: 'succes' }
  // L'arrêt volontaire passe AVANT la lecture du message : couper soi-même n'est pas une panne.
  if (entree.cancelled) return { action: 'renoncer', raison: 'annule' }
  if (!surchargeRendue && !estSurchargeFournisseur(entree.erreur))
    return { action: 'renoncer', raison: 'pas-une-surcharge' }
  const max = entree.max ?? MAX_REPRISES_SURCHARGE
  const faites = Math.max(0, Math.trunc(entree.tentativesDejaFaites))
  if (faites >= max) return { action: 'renoncer', raison: 'plafond-atteint' }
  const tentative = faites + 1
  return {
    action: 'forker-et-reprendre',
    tentative,
    attenteMs: ATTENTES_MS[Math.min(tentative, ATTENTES_MS.length) - 1]
  }
}

/**
 * L'attente elle-même. Isolée dans une fonction exportée pour que les tests la remplacent : une
 * suite qui patiente 30 s pour de vrai n'est pas une suite, c'est un blocage.
 */
export function attendreAvantReprise(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Ce qui s'affiche dans le fil au moment où une reprise part. */
export function libelleReprise(tentative: number, max = MAX_REPRISES_SURCHARGE): string {
  return `Reprise ${tentative}/${max} après surcharge du modèle.`
}

/** Ce qui s'affiche quand les reprises sont épuisées. */
export function libelleRenoncement(max = MAX_REPRISES_SURCHARGE): string {
  return (
    `Modèle surchargé : ${max} reprise${max > 1 ? 's' : ''} automatique${max > 1 ? 's' : ''} ` +
    `ont échoué. Relance quand tu veux.`
  )
}
