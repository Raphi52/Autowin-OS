/**
 * LE RAPPORT D'UN BALAYAGE DE RETENTION, tel que la FENETRE le lit.
 *
 * Pourquoi ce type vit dans `shared/` et pas a cote du balayage : le plan cote main porte des
 * entrees completes (`EntreeBalayage`), utiles au calcul et sans interet a l'ecran. Ce qui traverse
 * vers l'interface est volontairement PLUS PAUVRE — des noms et des comptes — pour qu'aucune
 * decision ne puisse etre prise cote fenetre a partir de donnees a demi lues.
 *
 * Ne porte AUCUN geste : le balayage signale, il ne supprime rien (voir `balayage-retention.ts`).
 */
export interface RapportRetention {
  /** Horodatage ISO de la passe qui l'a produit. */
  faitLe: string
  /** Combien d'objets (branches + refs) la passe a examines. */
  examines: number
  /** Contenu deja en base : leur suppression ne peut rien couter. Noms complets. */
  sansPerte: string[]
  /** Porteurs mais perimes : une perte REELLE, que seul l'humain tranche. Noms complets. */
  aTrancher: string[]
  /** Combien ont depasse le plafond du passage et attendent le suivant. */
  reportees: number
}
