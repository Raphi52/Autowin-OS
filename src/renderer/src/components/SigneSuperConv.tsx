import type { EtatDuSegment } from './signe-super-conv'
import './SigneSuperConv.css'

/**
 * La jauge fine d'une super conv, sous son titre dans la liste de gauche (conv-1395) : un segment
 * par lot, coloré par l'état de son fil. Décorative pour un lecteur d'écran : le compte « N/M » et
 * le raccourci « N ? » portent la même information en texte.
 */
export function JaugeSuperConv({
  segments
}: {
  segments: readonly EtatDuSegment[]
}): React.JSX.Element {
  return (
    <span className="conv-sc-jauge" aria-hidden="true" data-testid="conv-sc-jauge">
      {segments.map((etat, index) => (
        <span key={index} className={`conv-sc-seg is-${etat}`} />
      ))}
    </span>
  )
}
