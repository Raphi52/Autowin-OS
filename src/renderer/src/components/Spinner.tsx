/**
 * Spinner « atome 5A · tempo Rapide » — SOURCE UNIQUE de l'indicateur « ça bosse ».
 * Le rendu exige une vraie hiérarchie DOM (3 plans × [traînée + tête] + étoile 3 couches) :
 * deux pseudo-éléments ne suffisaient pas, d'où le passage en composant React.
 * Taille : prop `size` (px) ou `lg`, sinon 18 px. Aucune autre variante à recopier.
 */
export type SpinnerProps = {
  /** Taille de l'atome en pixels (par défaut 18, ou 38 avec `lg`). */
  size?: number
  /** Raccourci pour les états de chargement pleine page. */
  lg?: boolean
  className?: string
  /** Libellé lu par les lecteurs d'écran ; sans lui, l'atome est purement décoratif. */
  label?: string
  /**
   * Info-bulle native au survol. `label` ne sert QUE les lecteurs d'écran : sans `title`, un
   * utilisateur à la souris n'a aucun moyen de savoir ce que l'atome signale.
   */
  title?: string
  /** Repris tel quel pour les tests de rendu existants. */
  'data-testid'?: string
}

export function Spinner({ size, lg, className, label, ...rest }: SpinnerProps): React.JSX.Element {
  const classes = ['aw-atom', lg ? 'aw-atom--lg' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <span
      className={classes}
      style={size ? { ['--aw-atom-size' as string]: `${size}px` } : undefined}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      <span className="aw-atom__plane aw-atom__plane--1">
        <span className="aw-atom__rot aw-atom__rot--1">
          <span className="aw-atom__trail aw-atom__trail--1" />
          <span className="aw-atom__head aw-atom__head--1" />
        </span>
      </span>
      <span className="aw-atom__plane aw-atom__plane--2">
        <span className="aw-atom__rot aw-atom__rot--2">
          <span className="aw-atom__trail aw-atom__trail--2" />
          <span className="aw-atom__head aw-atom__head--2" />
        </span>
      </span>
      <span className="aw-atom__plane aw-atom__plane--3">
        <span className="aw-atom__rot aw-atom__rot--3">
          <span className="aw-atom__trail aw-atom__trail--3" />
          <span className="aw-atom__head aw-atom__head--3" />
        </span>
      </span>
      <span className="aw-atom__star aw-atom__star--edge" />
      <span className="aw-atom__star aw-atom__star--core" />
      <span className="aw-atom__star aw-atom__star--hot" />
    </span>
  )
}

export default Spinner
