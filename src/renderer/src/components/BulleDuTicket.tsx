import type { ButtonHTMLAttributes } from 'react'
import { useAtterrissage } from './anneau-activite-calcul'
import { eclatDuTicket, type TicketTreatmentStatus } from './ticket-treatment'

/**
 * LA BULLE DE CONVERSATION D'UN TICKET (conv-981, 2026-10-16) : sa teinte porte l'etat du traitement
 * (TicketsView.css) et changeait d'un coup. Elle glisse maintenant d'une teinte a l'autre, et lance
 * UN eclat quand le traitement passe d'en cours a traite (`eclatDuTicket`).
 *
 * Composant a part parce que l'eclat suit l'etat PRECEDENT de chaque ticket : un etat par ligne. La
 * marque tombe a la fin de l'eclat — une animation CSS repart a chaque retour sur l'onglet
 * (display:none -> flex), et un ticket deja traite a l'ouverture n'a rien a annoncer.
 */
export function BulleDuTicket({
  statut,
  ...bouton
}: { statut?: TicketTreatmentStatus } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'onAnimationEnd' | 'type'
>): React.JSX.Element {
  const [eclat, effacer] = useAtterrissage(statut ?? '', eclatDuTicket)
  return (
    <button
      {...bouton}
      type="button"
      className={`ticket-open-conversation${statut ? ` is-${statut}` : ''}${eclat ? ' is-eclat' : ''}`}
      onAnimationEnd={(e) => {
        if (e.animationName === 'ticket-eclat') effacer()
      }}
    />
  )
}
