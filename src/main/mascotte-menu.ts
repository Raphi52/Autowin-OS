/**
 * LE CLIC DROIT SUR LA MASCOTTE : la liste des fils qui t'attendent (conv-1196, 2026-10-28 — scout
 * « à quoi pourrait servir la mascotte », ligne 12 retenue par l'utilisateur).
 *
 * Le clic gauche n'ouvre que le fil le plus RÉCENT de l'état montré (`etatDeLaMascotte`,
 * `filsEnAttente.at(-1)`) : avec trois réponses prêtes, la pastille dit « 3 » mais deux restent hors
 * de portée sans ouvrir Autowin et les chercher. Le menu les donne toutes.
 *
 * Ordre : les échecs d'abord, puis les réponses prêtes — la même priorité que la bille (un échec
 * l'emporte) — et, dans chaque groupe, le plus récent en haut, celui qu'ouvre le clic gauche.
 * Libellés : ceux de la bulle de fin de tour (`finDeTour.titreEchec` / `finDeTour.titrePret`), pour
 * que le menu dise la même chose que la notification qu'on vient de voir.
 * Module sans Electron : `mascotte-fenetre.ts` traduit ces entrées en `Menu`.
 */
import { traduireCoeur } from './textes-coeur'

export type EntreeMenuMascotte =
  | { type: 'fil'; conversationId: string; libelle: string }
  | { type: 'info'; libelle: string }
  | { type: 'separateur' }
  | { type: 'autowin'; libelle: string }

/** Au-delà, le titre est coupé : un menu natif ne passe pas à la ligne. */
const LONGUEUR_TITRE = 60

/**
 * Un titre lisible dans un menu Windows : coupé, et `&` doublé — seul, il soulignerait la lettre
 * suivante comme raccourci clavier au lieu de s'afficher.
 */
function titreDeMenu(brut: string | null | undefined, conversationId: string): string {
  const titre = (brut ?? '').replace(/\s+/gu, ' ').trim() || conversationId
  const coupe =
    titre.length > LONGUEUR_TITRE ? `${titre.slice(0, LONGUEUR_TITRE - 1).trimEnd()}…` : titre
  return coupe.replace(/&/gu, '&&')
}

export function entreesDuMenuMascotte(entrees: {
  filsEnAttente: readonly string[]
  filsEnEchec: readonly string[]
  titreDuFil: (conversationId: string) => string | null | undefined
}): EntreeMenuMascotte[] {
  const fils = (
    ids: readonly string[],
    cle: 'finDeTour.titreEchec' | 'finDeTour.titrePret'
  ): EntreeMenuMascotte[] =>
    [...ids].reverse().map((conversationId): EntreeMenuMascotte => ({
      type: 'fil',
      conversationId,
      libelle: traduireCoeur(cle, {
        fil: titreDeMenu(entrees.titreDuFil(conversationId), conversationId)
      })
    }))
  const liste = [
    ...fils(entrees.filsEnEchec, 'finDeTour.titreEchec'),
    ...fils(entrees.filsEnAttente, 'finDeTour.titrePret')
  ]
  return [
    ...(liste.length
      ? liste
      : [{ type: 'info', libelle: traduireCoeur('mascotte.menu.aucunFil') } as const]),
    { type: 'separateur' },
    { type: 'autowin', libelle: traduireCoeur('mascotte.menu.ouvrirAutowin') }
  ]
}
