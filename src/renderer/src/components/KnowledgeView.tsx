import { GraphView } from './GraphView'
import './DomainShell.css'

export function KnowledgeView({
  active,
  onCleanMemory
}: {
  active: boolean
  onCleanMemory: (brainLabel: string) => void
}): React.JSX.Element {
  return (
    <section className="domain-shell" data-testid="knowledge-view">
      <div className="domain-content">
        <GraphView active={active} onCleanMemory={onCleanMemory} />
      </div>
    </section>
  )
}
