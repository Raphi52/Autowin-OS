import type { AgentStudioSection } from '../tabs'
import { RolesView } from './RolesView'
import { RouterView } from './RouterView'
import './DomainShell.css'

export function AgentStudioView({
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
        {section === 'routing' ? <RouterView /> : <RolesView />}
      </div>
    </section>
  )
}
