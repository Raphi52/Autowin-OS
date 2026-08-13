type ModuleHeaderProps = {
  eyebrow: string
  title: string
  description?: React.ReactNode
  detail?: React.ReactNode
}

/** Contrat visuel partagé par chaque vue produit. */
export function ModuleHeader({ title, description, detail }: ModuleHeaderProps): React.JSX.Element {
  return (
    <div className="module-header">
      <h1>{title}</h1>
      {description && <p className="module-header-description">{description}</p>}
      {detail && <p className="module-header-detail">{detail}</p>}
    </div>
  )
}
