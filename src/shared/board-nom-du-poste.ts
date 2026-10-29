/**
 * LE NOM D'UN POSTE SUR LE BOARD (demande utilisateur du 2026-10-28, conv-1230).
 *
 * Constat : le Board affichait un surnom git pour ce poste et un compte Windows pour un collègue. Le
 * premier venait de l'identité git du dossier du fil (`journal-des-besoins.ts`), le second du nom
 * de son sous-dossier faute d'identité git chez lui. Demande : « nom windows par défaut et un
 * setting pour en choisir un autre ».
 *
 * Règle unique, la même sur tous les postes : le nom écrit sur les post-it d'un poste est celui
 * choisi dans Settings · Interface, sinon son compte Windows. Toutes les demandes calculées sur ce
 * poste portent ce nom — c'est la personne connectée qui prompte ici. Le journal des besoins garde
 * l'identité git relevée à chaque tour : seule la personne AFFICHÉE change.
 */
import type { CarteDesBesoins, DemandeurDeLaCarte } from './carte-des-besoins'

/** Au-delà, le nom déborde de la puce du filtre des personnes. */
export const NOM_DU_POSTE_MAX = 80

/**
 * Relit un nom reçu de la vue : `null` = revenir au compte Windows (saisie vide comprise), une
 * chaîne = le nom à garder, `undefined` = illisible (rien ne doit changer).
 */
export function nomDuPosteLisible(valeur: unknown): string | null | undefined {
  if (valeur === null) return null
  if (typeof valeur !== 'string') return undefined
  const propre = valeur
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!propre) return null
  return propre.length > NOM_DU_POSTE_MAX ? undefined : propre
}

/** La clé de la personne de ce poste : son compte Windows, qui ne change pas avec le nom choisi. */
export function cleDuPoste(compte: string): string {
  return `poste:${compte.trim().toLowerCase()}`
}

/**
 * La carte de ce poste, chaque demande au nom du poste. Une seule personne dans le filtre : un
 * poste qui avait plusieurs identités git (une par dépôt, ou aucune) n'en montre plus qu'une.
 */
export function carteAuNomDuPoste(
  carte: CarteDesBesoins,
  poste: { compte: string; nom: string }
): CarteDesBesoins {
  const demandeur: DemandeurDeLaCarte = {
    cle: cleDuPoste(poste.compte),
    nom: poste.nom,
    origine: 'poste'
  }
  let total = 0
  const projets = carte.projets.map((p) => ({
    ...p,
    demandes: p.demandes.map((d) => {
      total += 1
      return { ...d, demandeur }
    })
  }))
  return {
    ...carte,
    projets,
    demandeurs: total ? [{ cle: demandeur.cle, nom: demandeur.nom, demandes: total }] : []
  }
}
