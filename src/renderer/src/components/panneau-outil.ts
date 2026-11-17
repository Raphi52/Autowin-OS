/**
 * LE PANNEAU D'OUTIL À DROITE DU FIL : un seul à la fois, navigateur intégré ou Bureaux cachés —
 * à 1280 px les deux ensemble ne laissent plus de place au fil.
 *
 * LE NAVIGATEUR APPARTIENT AU FIL QUI L'A OUVERT. Ses onglets vivent par fil : un panneau ouvert
 * pour le fil A n'a rien à montrer dans le fil B. Tenu comme une simple valeur « navigateur » pour
 * toute la vue, il suivait l'utilisateur d'un fil à l'autre, et un fil neuf le voyait surgir, vide
 * (« Aucune page ouverte »), au moment où l'envoi du premier message lui donnait un identifiant.
 * Il porte donc l'identifiant de son fil : il se cache ailleurs et revient avec ce fil.
 * Les Bureaux cachés, eux, montrent tous les fils et restent ouverts d'un fil à l'autre.
 */
export type PanneauOutil =
  | { readonly outil: 'navigateur'; readonly conversationId: string }
  | { readonly outil: 'bureaux' }
  | null

export const PANNEAU_BUREAUX: PanneauOutil = { outil: 'bureaux' }

export function navigateurDuFil(conversationId: string): PanneauOutil {
  return { outil: 'navigateur', conversationId }
}

/** Le navigateur ne s'affiche que dans le fil qui l'a ouvert. */
export function navigateurOuvertDans(
  panneau: PanneauOutil,
  conversationId: string | null
): boolean {
  return (
    panneau?.outil === 'navigateur' &&
    conversationId !== null &&
    panneau.conversationId === conversationId
  )
}

export function sontBureauxOuverts(panneau: PanneauOutil): boolean {
  return panneau?.outil === 'bureaux'
}

/**
 * Bouton du globe et Ctrl+Shift+B : ferme le navigateur s'il est ouvert DANS CE FIL, l'y ouvre
 * sinon — y compris quand il était ouvert pour un autre fil, puisque l'utilisateur ne le voit pas.
 * Sans fil ouvert, il n'y a pas d'onglets à montrer : rien ne change.
 */
export function basculerNavigateurDans(
  panneau: PanneauOutil,
  conversationId: string | null
): PanneauOutil {
  if (conversationId === null) return panneau
  return navigateurOuvertDans(panneau, conversationId) ? null : navigateurDuFil(conversationId)
}

export function basculerBureaux(panneau: PanneauOutil): PanneauOutil {
  return sontBureauxOuverts(panneau) ? null : PANNEAU_BUREAUX
}
