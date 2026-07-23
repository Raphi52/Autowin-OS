import { GraphView } from './GraphView'
import './DomainShell.css'

export function KnowledgeView({
  onCleanMemory
}: {
  onCleanMemory: (brainLabel: string) => void
}): React.JSX.Element {
  return (
    <section className="domain-shell" data-testid="knowledge-view">
      <div className="domain-content">
        <GraphView onCleanMemory={onCleanMemory} />
      </div>
    </section>
  )
}
