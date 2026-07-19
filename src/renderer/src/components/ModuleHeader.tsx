type ModuleHeaderProps = {
  eyebrow: string
  title: string
}

/** Contrat visuel partagé par chaque vue produit. */
export function ModuleHeader({ eyebrow, title }: ModuleHeaderProps): React.JSX.Element {
  return (
    <div className="module-header">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
    </div>
  )
}
