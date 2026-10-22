import type { ModelQuotaWindow } from '../shared/model-quotas'

/**
 * BASCULER DE COMPTE CLAUDE AVANT LE LANCEMENT, PAS APRÈS LE REFUS (conv-1069, 2026-10-22).
 *
 * Cas réel conv-1065 : cinq tours Opus partis en parallèle ont épuisé la session du compte actif
 * entre 11:01 et 11:04, alors qu'un autre compte avait de la marge. La rotation du registre ne jouait
 * qu'APRÈS le refus du fournisseur — trop tard pour un tour déjà lancé, et Claude Code v2.1.301 ne
 * relance plus sur une limite d'usage. Le relevé de quota existait, seul l'affichage le lisait.
 *
 * Choix de l'utilisateur (conv-1069) : « rien plafonner, juste basculer ». Donc ni file d'attente ni
 * plafond de tours simultanés : quand aucun compte n'a de marge, l'appel part sur le compte actif,
 * exactement comme avant, et la rotation après refus reste le filet.
 */
export const SEUIL_BASCULE_POURCENT = 85

/**
 * Au-delà, la sonde ne retient plus le lancement : l'appel part sur le compte actif. Une sonde de
 * quota répond d'ordinaire en moins d'une seconde ; elle a elle-même un plafond de 10 s.
 */
const BUDGET_SONDE_MS = 4_000

/**
 * Utilisation la plus haute d'un compte, toutes fenêtres confondues. Le 7 j compte autant que le 5 h :
 * un 7 j épuisé refuse l'appel aussi sûrement (refus réel du 2026-10-21, `7d-status: rejected`).
 * Une fenêtre sans plafond connu (tokens mesurés localement) n'a pas de pourcentage : elle est ignorée.
 */
export function utilisationDuCompte(fenetres: readonly ModelQuotaWindow[]): number | undefined {
  const connues = fenetres.filter((fenetre) => fenetre.limitKnown !== false)
  return connues.length > 0 ? Math.max(...connues.map((fenetre) => fenetre.usedPercent)) : undefined
}

export interface ChoixDeCompte {
  actifId: string
  /** Les comptes du pool, dans l'ordre stable du store. */
  comptes: readonly string[]
  /** Utilisation du compte (0 à 100), ou `undefined` quand elle n'est pas mesurable. */
  mesurer: (compteId: string) => Promise<number | undefined>
  seuil?: number
}

/**
 * Le compte vers lequel partir, ou `undefined` pour rester. On ne quitte l'actif que s'il est MESURÉ
 * au-dessus du seuil, et seulement vers un compte MESURÉ en dessous — jamais à l'aveugle : un compte
 * non connecté ou dont la sonde échoue n'est pas un refuge. Les autres comptes ne sont sondés que si
 * l'actif est presque plein, et jamais avec un seul compte : zéro coût ajouté dans le cas courant.
 */
export async function compteAvecMarge(choix: ChoixDeCompte): Promise<string | undefined> {
  const seuil = choix.seuil ?? SEUIL_BASCULE_POURCENT
  const position = choix.comptes.indexOf(choix.actifId)
  if (choix.comptes.length < 2 || position < 0) return undefined
  const mesurer = (id: string): Promise<number | undefined> =>
    choix.mesurer(id).catch(() => undefined)
  const actif = await mesurer(choix.actifId)
  if (actif === undefined || actif < seuil) return undefined
  const autres = [...choix.comptes.slice(position + 1), ...choix.comptes.slice(0, position)]
  const mesures = await Promise.all(
    autres.map(async (id) => ({ id, utilisation: await mesurer(id) }))
  )
  let meilleur: { id: string; utilisation: number } | undefined
  for (const { id, utilisation } of mesures) {
    if (utilisation === undefined || utilisation >= seuil) continue
    if (!meilleur || utilisation < meilleur.utilisation) meilleur = { id, utilisation }
  }
  return meilleur?.id
}

export interface BasculeAvantLancement extends ChoixDeCompte {
  /** Le compte actif AU MOMENT de basculer : un autre appel a pu en changer pendant la sonde. */
  actifCourant: () => string
  basculer: (compteId: string) => void
  budgetMs?: number
}

/**
 * Décide puis bascule. Ne retient jamais le lancement plus que le budget, et n'écrase pas une bascule
 * faite entre-temps par un autre appel (ou à la main) : elle est plus récente que notre mesure.
 */
export async function basculerAvantLancement(
  demande: BasculeAvantLancement
): Promise<string | undefined> {
  let minuteur: ReturnType<typeof setTimeout> | undefined
  const horsDelai = new Promise<undefined>((resolve) => {
    minuteur = setTimeout(() => resolve(undefined), demande.budgetMs ?? BUDGET_SONDE_MS)
  })
  try {
    const cible = await Promise.race([compteAvecMarge(demande), horsDelai])
    if (!cible || demande.actifCourant() !== demande.actifId) return undefined
    demande.basculer(cible)
    return cible
  } finally {
    clearTimeout(minuteur)
  }
}
