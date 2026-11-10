import { useMemo, type ReactNode } from 'react'
import { useLignesDessinees } from './liste-progressive'

/**
 * LA ZONE DES CONVERSATIONS, QUI SE DÉROULE PAR TRANCHES (gel `renderer:vue-chat-liste`).
 *
 * Le nombre de lignes dessinées vit DANS cette zone, pas dans ChatView : une tranche ne relance que
 * cette zone. Avec l'état dans ChatView, chaque tranche relançait tout le chat (son rendu entier et la
 * liste recalculée).
 */
export function ConvListeProgressive({
  total,
  rendre,
  children
}: {
  /** Lignes à dessiner au total, groupes repliés exclus. */
  total: number
  /** Les lignes des premiers fils, dans l'ordre d'affichage. Mémorisée par le parent. */
  rendre: (dessinees: number) => ReactNode
  /** Messages de liste vide ou sans résultat : ils restent au-dessus des lignes. */
  children?: ReactNode
}): React.JSX.Element {
  // La ref de la zone revient à ce composant : c'est lui qui mesure la hauteur réelle au premier passage.
  // fix-ok: cause mesurée — la mesure ne se fait que si la ref est posée sur .conv-list, rendu ici (test « au démarrage, une zone de 1 800 px ⇒ le premier passage pose ce qui y tient, plus la marge »).
  const { dessinees, refZone } = useLignesDessinees(total)
  // Une tranche ne refait que ce rendu ; un rendu du chat sans nouvelle donnée le garde en mémoire.
  const lignes = useMemo(() => rendre(dessinees), [rendre, dessinees])
  return (
    <div className="conv-list scroll-y" ref={refZone}>
      {children}
      {lignes}
    </div>
  )
}
