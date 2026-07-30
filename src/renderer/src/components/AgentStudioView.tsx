import type { AgentStudioSection } from '../tabs'
// Importe DIRECTEMENT le composant : `RolesView` n'etait qu'un alias d'une ligne re-exportant
// `AgentsTopologyView`, avec ce fichier pour unique appelant. Deux noms pour un seul composant, c'est
// un renommage laisse a moitie fait — et un lecteur qui cherche `RolesView` ne trouve pas le code.
import { AgentsTopologyView } from './AgentsTopologyView'
import { RouterView } from './RouterView'
import './DomainShell.css'

export function AgentStudioView({
  active,
  section,
  onSectionChange
}: {
  active: boolean
  section: AgentStudioSection
  onSectionChange: (section: AgentStudioSection) => void
}): React.JSX.Element {
  return (
    <section className="domain-shell" data-testid="agent-studio-view">
      <nav className="domain-tabs" aria-label="Sections Agent Studio">
        <button
          type="button"
          className={section === 'topology' ? 'is-active' : ''}
          aria-pressed={section === 'topology'}
          onClick={() => onSectionChange('topology')}
        >
          Modèles & topologie
        </button>
        <button
          type="button"
          className={section === 'routing' ? 'is-active' : ''}
          aria-pressed={section === 'routing'}
          onClick={() => onSectionChange('routing')}
        >
          Routage
        </button>
      </nav>
      <div className="domain-content">
        {section === 'routing' ? <RouterView /> : <AgentsTopologyView active={active} />}
      </div>
    </section>
  )
}
