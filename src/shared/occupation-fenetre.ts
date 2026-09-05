/**
 * CE QUE LA FENETRE PORTE — extrait d'un usage de provider, jamais recalcule.
 *
 * Un usage de provider transporte DEUX grandeurs que rien ne distingue a l'oeil :
 * `inputTokens`, le CUMUL de tous les appels au modele d'un meme tour, et `derniereEntree`,
 * l'entree du DERNIER appel — la seule qui dise l'occupation reelle de la fenetre.
 *
 * Lire la premiere la ou la seconde est attendue ne casse rien de visible : les deux sont des
 * nombres de tokens plausibles. La jauge se contente d'etre FAUSSE. Mesure du 2026-09-05 sur les
 * 435 enregistrements `chat-usage` de `.autowin-data` : 423 (97 %) portaient
 * `derniereEntree === inputTokens`, jusqu'a 18 904 589 tokens pour une fenetre de 200 000 — une
 * barre collee a 100 % sur des fils qui tenaient largement dedans.
 *
 * La confusion se rejouait a CHAQUE point de recopie (`providers/claude.ts`, `agent-pilot.ts`,
 * `chat/run-pilot-chat.ts`), chacun repliant sur le cumul de son cote. Cette fonction est le seul
 * endroit qui tranche, pour que le prochain point de recopie n'ait plus a choisir.
 */
export interface UsageOccupable {
  readonly inputTokens: number
  readonly cacheReadTokens?: number
  readonly derniereEntree?: number
  readonly derniereEntreeCache?: number
}

export interface OccupationFenetre {
  /** Entree du DERNIER appel — l'occupation. */
  readonly entree: number
  /** Part de cette entree relue depuis le cache : occupe la fenetre sans etre repayee. */
  readonly cache?: number
  /**
   * `true` quand le provider n'a PAS desagrege et qu'on a du replier sur le cumul. La valeur est
   * alors un MAJORANT, pas une occupation : un consommateur qui peint une jauge doit pouvoir le
   * dire au lieu d'afficher une saturation inventee.
   */
  readonly replicumul: boolean
}

/** Extrait l'occupation de fenetre d'un usage, en disant si elle a du replier sur le cumul. */
export function occupationDeFenetre(usage: UsageOccupable): OccupationFenetre {
  const desagrege = usage.derniereEntree !== undefined
  return {
    entree: desagrege ? usage.derniereEntree! : usage.inputTokens,
    cache: desagrege ? usage.derniereEntreeCache : usage.cacheReadTokens,
    replicumul: !desagrege
  }
}
