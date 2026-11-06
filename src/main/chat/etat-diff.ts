/**
 * L'ÉTAT DE L'APP, REPAYÉ À CHAQUE ITÉRATION.
 *
 * Le pilote repousse `ÉTAT MAINTENANT: <json complet>` après CHAQUE commande d'un tour. Or ce bloc
 * est presque toujours identique au précédent : le catalogue des skills, la liste des providers, le
 * recensement des travaux non fusionnés ne bougent pas parce qu'on vient de lire un fichier. Mesuré
 * le 2026-08-31 sur conv-1 : le même état sérialisé réapparaissait HUIT fois dans un seul tour,
 * pour un contenu utile d'une ligne (`exitCode: 0`).
 *
 * On n'envoie donc l'état ENTIER qu'une fois — celui du premier message —, puis seulement ce qui a
 * CHANGÉ. Le modèle garde l'état complet en contexte : le diff s'y applique, il ne le remplace pas.
 */

/** Tout objet sérialisable : le snapshot du prompt en est un, sa forme exacte n'importe pas. */
export type EtatPrompt = object | null | undefined

/** Ce qui a bougé entre deux relevés. `null` = strictement rien. */
export function diffEtat(
  precedent: EtatPrompt,
  courant: EtatPrompt
): Record<string, unknown> | null {
  if (!courant || typeof courant !== 'object') return null
  const apres = courant as Record<string, unknown>
  if (!precedent || typeof precedent !== 'object') return { ...apres }
  const avant = precedent as Record<string, unknown>
  const change: Record<string, unknown> = {}
  for (const [cle, valeur] of Object.entries(apres)) {
    // Comparaison par forme sérialisée : les valeurs du snapshot sont du JSON pur, et une égalité
    // référentielle rendrait « changé » un objet reconstruit à l'identique à chaque lecture.
    if (JSON.stringify(valeur) !== JSON.stringify(avant[cle])) {
      change[cle] = valeur
    }
  }
  // Une clé DISPARUE est un changement : la taire laisserait le modèle croire qu'elle vaut encore.
  for (const cle of Object.keys(avant)) {
    if (!(cle in apres)) change[cle] = null
  }
  return Object.keys(change).length === 0 ? null : change
}

/**
 * Le bloc à pousser dans la conversation. Nommé « DEPUIS LE DERNIER ÉTAT » et non « ÉTAT » : un
 * fragment présenté comme un état complet ferait lire les clés absentes comme disparues.
 */
export function blocEtatSuivant(precedent: EtatPrompt, courant: EtatPrompt): string {
  const change = diffEtat(precedent, courant)
  if (change === null) return 'ÉTAT DE L’APP : inchangé'
  return `CHANGÉ DEPUIS LE DERNIER ÉTAT:\n${JSON.stringify(change)}`
}
