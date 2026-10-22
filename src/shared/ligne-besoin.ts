/**
 * LA LIGNE DE BESOIN — `AUTOWIN_BESOIN_V1` (carte des besoins, lot 2, conv-1089, 2026-10-22).
 *
 * Demande : « une ligne invisible AUTOWIN_BESOIN_V1 que l'agent écrit pour dire si un message est un
 * nouveau besoin ou la suite d'un besoin existant ». Le modèle a le contexte du fil chargé au moment
 * où il répond : c'est le seul instant où ce lien coûte zéro appel de plus. Même canal que
 * `AUTOWIN_PROMPT_V1` : une ligne, un marqueur, retirée de l'affichage.
 *
 * Le modèle dit DE QUEL besoin il s'agit, jamais S'IL EST FINI : l'état d'une demande reste celui des
 * preuves (carte du fil). Sinon la carte deviendrait une liste de faux verts déclarés.
 *
 * Formes lues :
 *   AUTOWIN_BESOIN_V1: nouveau          — changement ou livrable pas encore demandé
 *   AUTOWIN_BESOIN_V1: suite            — poursuit la demande précédente de CE fil
 *   AUTOWIN_BESOIN_V1: suite conv-1059  — reprend la demande d'un AUTRE fil
 *   AUTOWIN_BESOIN_V1: aucun            — question, avis, conversation : pas un besoin
 * FAIL-OPEN : une ligne absente ou illisible ne range rien, elle ne casse rien.
 */

import { suivreBlocsDeCode } from './bloc-de-code'

export const MARQUEUR_BESOIN = 'AUTOWIN_BESOIN_V1:'

export type NatureDuBesoin = 'nouveau' | 'suite' | 'aucun'

export interface LigneBesoin {
  nature: NatureDuBesoin
  /** Le fil dont la demande est reprise (`suite conv-NNN`) ; absent = le fil courant. */
  de?: string
}

const SAUT = String.fromCharCode(10)

/** Début de ligne technique : borne une rubrique de clôture comme `AUTOWIN_PROMPT_V1`. */
export const DEBUT_LIGNE_BESOIN = /^\s*AUTOWIN_BESOIN_V1\s*:/u

/** Un préfixe du marqueur suffit à masquer la ligne pendant le streaming, caractère par caractère. */
const PREFIXES_PARTIELS = Array.from({ length: MARQUEUR_BESOIN.length }, (_, index) =>
  MARQUEUR_BESOIN.slice(0, index + 1)
)

const VALEUR = /^(nouveau|suite|aucun)(?:\s+(?:de\s+)?(conv-\d+))?\s*[.!]?$/iu

/** Lit la valeur d'UNE ligne (sans bloc de code) ; `null` si ce n'est pas une ligne de besoin lisible. */
function lireUneLigne(ligne: string): LigneBesoin | null {
  const nu = ligne.trim().replace(/\*\*/g, '').replace(/`/g, '')
  if (!nu.startsWith(MARQUEUR_BESOIN)) return null
  const m = VALEUR.exec(nu.slice(MARQUEUR_BESOIN.length).trim())
  if (!m) return null
  const nature = m[1].toLowerCase() as NatureDuBesoin
  // « nouveau conv-12 » ou « aucun conv-12 » n'ont pas de sens : la référence n'accompagne que `suite`.
  if (m[2] && nature !== 'suite') return null
  return m[2] ? { nature, de: m[2].toLowerCase() } : { nature }
}

/** La ligne de besoin de la réponse, hors bloc de code. Plusieurs lignes : la DERNIÈRE lisible gagne. */
export function lireLigneBesoin(texte: string | undefined | null): LigneBesoin | null {
  if (!texte) return null
  const bloc = suivreBlocsDeCode()
  let lue: LigneBesoin | null = null
  for (const ligne of texte.split(SAUT)) {
    if (bloc.delimiteur(ligne)) continue
    // Un exemple du format cité dans un bloc de code n'est pas une déclaration.
    if (bloc.dansUnBloc) continue
    lue = lireUneLigne(ligne) ?? lue
  }
  return lue
}

/**
 * Vrai si la ligne (déjà hors bloc de code) doit disparaître de l'affichage : la ligne complète, même
 * mal formée, ou un préfixe du marqueur en cours de streaming.
 */
export function estLigneBesoinAMasquer(ligneNue: string): boolean {
  return (
    ligneNue.replace(/`/g, '').startsWith(MARQUEUR_BESOIN) || PREFIXES_PARTIELS.includes(ligneNue)
  )
}
