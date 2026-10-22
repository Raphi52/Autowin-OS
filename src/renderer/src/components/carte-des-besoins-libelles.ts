/**
 * Les libellés de la vue « Besoins » (lot 2, conv-1089, 2026-10-22), hors du fichier de composant :
 * un module de composants qui exporte aussi des fonctions casse le rafraîchissement à chaud (voir
 * `markdown-recommandation.ts`).
 */
import type { BesoinDeLaCarte, DemandeurDeLaCarte } from '../../../shared/carte-des-besoins'

/** Ce que l'agent a déclaré, en mots : jamais un état — l'état reste celui des preuves. */
export function libelleDuBesoin(besoin: BesoinDeLaCarte): string {
  if (besoin.nature === 'nouveau') return 'nouveau besoin'
  if (besoin.nature === 'aucun') return 'pas un besoin'
  return besoin.de ? `suite de ${besoin.de}` : 'suite'
}

export function titreDuDemandeur(demandeur: DemandeurDeLaCarte): string {
  const qui = demandeur.email ? `${demandeur.nom} <${demandeur.email}>` : demandeur.nom
  return demandeur.origine === 'journal'
    ? `${qui} — identité git relevée au moment du prompt`
    : `${qui} — déduit : identité git actuelle du dossier du fil (demande antérieure au journal)`
}
