type ModuleHeaderProps = {
  eyebrow: string
  title: string
  description?: React.ReactNode
  detail?: React.ReactNode
  /** Commandes posées A DROITE du titre (switch de vue, filtre…). */
  actions?: React.ReactNode
}

/** Contrat visuel partagé par chaque vue produit. */
export function ModuleHeader({
  title,
  description,
  detail,
  actions
}: ModuleHeaderProps): React.JSX.Element {
  return (
    <div className="module-header">
      {/* Sans actions, le titre reste ENFANT DIRECT de .module-header : contrat verrouille par
          ViewTopBar.test.tsx et par le selecteur CSS '.module-header > h1'. */}
      {actions ? (
        <div className="module-header-line">
          <h1>{title}</h1>
          <div className="module-header-actions">{actions}</div>
        </div>
      ) : (
        <h1>{title}</h1>
      )}
      {description && <p className="module-header-description">{description}</p>}
      {detail && <p className="module-header-detail">{detail}</p>}
    </div>
  )
}
