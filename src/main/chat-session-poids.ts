/**
 * COUPE AUTOMATIQUE DE LA SESSION QUAND LE FIL DEVIENT TROP LOURD.
 *
 * Sur Claude CLI, Autowin REPREND la session (`--resume`) et n'envoie que le dernier message :
 * tout le transcript — raisonnement et appels d'outils compris — est rejoue par le CLI a chaque
 * tour. Mesure du 2026-09-17 (conv-632) : Autowin poussait 4 779 caracteres (~1,2 k tokens) et
 * l'appel etait facture 491 636 tokens d'entree. Mediane sur 8 891 appels journalises : 210 979
 * tokens d'entree par appel. Autowin ne voyait donc PAS 99 % de ce qu'il payait en reinjection.
 *
 * Le SEUL levier existant etait le bouton « Compacter », manuel (`compactionsAbouties`). Ici on
 * automatise le meme chemin : au-dela d'un seuil d'occupation, la cle de session change, la
 * session CLI est oubliee, et le tour repart sur le fil aplati d'Autowin — les bulles finales et
 * les resultats d'action resumes (`flattenChatPartsForModel`), borne a 40 messages / 60 k tokens.
 *
 * FRANCHISSEMENTS, PAS DEPASSEMENTS : on compte les passages sous -> au-dessus du seuil. Compter
 * les depassements bruts re-perimerait la session a chaque tour tant qu'une vieille ligne lourde
 * reste dans le journal.
 */

/** Ce que la coupe lit d'une entree du journal d'activite. */
export interface OccupationTour {
  readonly kind?: string
  /** Occupation de la fenetre au DERNIER appel du tour — jamais le cumul `inputTokens`. */
  readonly derniereEntree?: number
}

/**
 * SEUIL PAR DEFAUT — 200 000 tokens d'occupation.
 *
 * Choix de politique, pas une constante physique : c'est la fenetre entiere des modeles 200 k
 * (`shared/context-gauge.ts`) et un cinquieme de celle d'Opus. Au-dela, ce qui est rejoue n'est
 * plus le fil utile mais son historique d'outils.
 */
export const SEUIL_COUPE_SESSION_TOKENS = 200_000

/** Seuil effectif : surchargeable par `AUTOWIN_SESSION_RESET_TOKENS` (0 = coupe desactivee). */
export function seuilCoupeSession(env: NodeJS.ProcessEnv = process.env): number {
  const brut = env.AUTOWIN_SESSION_RESET_TOKENS
  if (brut === undefined || brut.trim() === '') return SEUIL_COUPE_SESSION_TOKENS
  const valeur = Number(brut)
  if (!Number.isFinite(valeur) || valeur < 0) return SEUIL_COUPE_SESSION_TOKENS
  return valeur
}

/**
 * Combien de fois ce fil a franchi le seuil d'occupation. Entre dans la cle de session : chaque
 * franchissement supplementaire perime la session du fournisseur.
 */
export function coupesParPoids(
  entrees: readonly OccupationTour[],
  seuil: number = seuilCoupeSession()
): number {
  if (!Number.isFinite(seuil) || seuil <= 0) return 0
  let coupes = 0
  let auDessus = false
  for (const entree of entrees) {
    if (entree.kind !== 'chat') continue
    const occupation = entree.derniereEntree
    if (typeof occupation !== 'number' || !Number.isFinite(occupation) || occupation <= 0) continue
    if (occupation > seuil) {
      if (!auDessus) coupes += 1
      auDessus = true
    } else {
      auDessus = false
    }
  }
  return coupes
}
