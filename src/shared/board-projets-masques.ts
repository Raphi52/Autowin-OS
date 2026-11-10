/**
 * LES PROJETS MASQUÉS SUR CE POSTE (demande du 2026-11-10 : « masquer sur ce poste » dans le menu
 * « Projets » du Board). Un projet masqué sort de L'ÉCRAN de ce poste, et de lui seul : la case
 * « recopier dans le dossier » (`board-projets-partages.ts`) garde son sens, et le processus principal
 * ne reçoit jamais ce réglage. La copie partagée lit donc une autre carte que l'écran : cocher
 * « masquer » ne change pas ce qui part sur le partage.
 *
 * Le réglage vit sur ce poste, dans le stockage local de la vue (comme les états posés à la main sur la
 * rivière), pas dans le dossier du Board. Un projet masqué reste dans le menu, pour être revu d'une case.
 * Les post-it des collègues ne sont pas masqués ici : ils viennent d'autres postes.
 */
import type { CarteDesBesoins } from './carte-des-besoins'
import { cleDeDossier } from './board-dossiers-du-chat'
import { carteDesProjetsPartages } from './board-projets-partages'

/** La clé du réglage dans le stockage local du poste. */
export const CLE_PROJETS_MASQUES_DU_POSTE = 'autowin.board.projetsMasques'

/** Au-delà, le réglage relu est refusé : le menu n'a jamais autant de projets. */
export const PROJETS_MASQUES_MAX = 500

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * La clé de comparaison d'un projet : celle du dossier (casse et séparateurs), ou le libellé tel quel
 * quand ce n'est pas un chemin. Les deux côtés d'une comparaison passent par elle : un masque écrit
 * « d:\perso » couvre le projet « D:\Perso ».
 */
const cleDeProjet = (cle: string): string => cleDeDossier(cle) ?? cle

/** Les projets masqués relus d'un réglage : noms non vides, sans doublon. Illisible = aucun. */
export function projetsMasquesLisibles(valeur: unknown): string[] {
  if (!Array.isArray(valeur) || valeur.length > PROJETS_MASQUES_MAX) return []
  const vus = new Map<string, string>()
  for (const brut of valeur) {
    if (typeof brut !== 'string' || brut.trim() === '') continue
    const cle = brut.trim()
    if (!vus.has(cleDeProjet(cle))) vus.set(cleDeProjet(cle), cle)
  }
  return [...vus.values()]
}

/** Ce projet est-il masqué sur ce poste ? */
export function projetMasque(masques: readonly string[], cle: string): boolean {
  const voulue = cleDeProjet(cle)
  return masques.some((masque) => cleDeProjet(masque) === voulue)
}

/** Masquer ou démasquer un projet : rend une nouvelle liste, la liste reçue reste intacte. */
export function basculerProjetMasque(masques: readonly string[], cle: string): string[] {
  if (!projetMasque(masques, cle)) return [...masques, cle]
  const voulue = cleDeProjet(cle)
  return masques.filter((masque) => cleDeProjet(masque) !== voulue)
}

/**
 * La carte que l'écran montre : sans les projets masqués, comptes refaits. Rend la carte reçue telle
 * quelle quand rien n'est masqué. La carte reçue n'est jamais modifiée : la copie partagée la lit aussi.
 */
export function carteSansProjetsMasques(
  carte: CarteDesBesoins,
  masques: readonly string[]
): CarteDesBesoins {
  if (masques.length === 0) return carte
  const caches = new Set(masques.map(cleDeProjet))
  const gardes = carte.projets.map((p) => p.cle).filter((cle) => !caches.has(cleDeProjet(cle)))
  return carteDesProjetsPartages(carte, gardes)
}

/** Le réglage du poste, relu. Rien d'enregistré, ou un texte illisible : aucun projet masqué. */
export function lireProjetsMasques(stockage: Stockage): string[] {
  try {
    return projetsMasquesLisibles(
      JSON.parse(stockage.getItem(CLE_PROJETS_MASQUES_DU_POSTE) ?? '[]')
    )
  } catch {
    return []
  }
}

/** Écrit le réglage du poste ; rend l'erreur au lieu de la lever (stockage plein). */
export function ecrireProjetsMasques(masques: readonly string[], stockage: Stockage): unknown {
  try {
    stockage.setItem(CLE_PROJETS_MASQUES_DU_POSTE, JSON.stringify([...masques]))
    return null
  } catch (erreur) {
    return erreur
  }
}
