import { useEffect, useState } from 'react'
import type { AgentStudioSection } from '../tabs'
import { workflowIssues, type ExecutabilityInput } from './workflow-executability'
// Importe DIRECTEMENT le composant : `RolesView` n'etait qu'un alias d'une ligne re-exportant
// `AgentsTopologyView`, avec ce fichier pour unique appelant. Deux noms pour un seul composant, c'est
// un renommage laisse a moitie fait — et un lecteur qui cherche `RolesView` ne trouve pas le code.
import { AgentsTopologyView } from './AgentsTopologyView'
import { RouterView } from './RouterView'
import { WorkflowProfilesView } from './WorkflowProfilesView'
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
  /**
   * Une anomalie n'était visible qu'en OUVRANT l'onglet concerné : un provider expiré ou un workflow
   * injouable partait donc au prompt suivant sans que rien ne l'annonce depuis l'onglet voisin. Les
   * deux sondes sont en LECTURE seule et ne tournent que si Agent Studio est ouvert.
   */
  const [providersExpires, setProvidersExpires] = useState<string[]>([])
  const [workflowsCasses, setWorkflowsCasses] = useState<string[]>([])

  useEffect(() => {
    if (!active) return
    let annule = false
    let providerGeneration = 0
    let workflowGeneration = 0
    const refreshProviders = (): void => {
      const generation = ++providerGeneration
      void Promise.resolve(window.api.providerStatus?.())
        .then((statuts) => {
          if (annule || generation !== providerGeneration) return
          const liste = (statuts ?? []) as { provider: string; status: string }[]
          setProvidersExpires(liste.filter((s) => s.status === 'expired').map((s) => s.provider))
        })
        // Un onglet ne doit pas casser parce que sa SONDE a échoué : l'indicateur reste simplement muet.
        .catch(() => undefined)
    }
    const refreshWorkflows = (): void => {
      const generation = ++workflowGeneration
      void Promise.resolve(window.api.workflowProfiles?.())
        .then((fichier) => {
          if (annule || generation !== workflowGeneration) return
          const profils = ((fichier as { profiles?: ExecutabilityInput[] } | undefined)?.profiles ??
            []) as ExecutabilityInput[]
          setWorkflowsCasses(profils.filter((p) => workflowIssues(p).length > 0).map((p) => p.name))
        })
        .catch(() => undefined)
    }
    refreshProviders()
    refreshWorkflows()
    const off = window.api.onAppEvent((event) => {
      if (event.type !== 'refresh') return
      if (event.scope === 'roles') refreshProviders()
      if (event.scope === 'workflows') refreshWorkflows()
    })
    return () => {
      annule = true
      off()
    }
  }, [active])

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
          {providersExpires.length > 0 && (
            <span
              className="domain-tab-anomaly"
              data-testid="studio-anomaly-routing"
              title={`Provider(s) à reconnecter : ${providersExpires.join(', ')}`}
              aria-label={`${providersExpires.length} provider(s) expiré(s)`}
            >
              {providersExpires.length}
            </span>
          )}
        </button>
        <button
          type="button"
          className={section === 'workflows' ? 'is-active' : ''}
          aria-pressed={section === 'workflows'}
          onClick={() => onSectionChange('workflows')}
        >
          Workflows
          {workflowsCasses.length > 0 && (
            <span
              className="domain-tab-anomaly"
              data-testid="studio-anomaly-workflows"
              title={`Workflow(s) non exécutable(s) : ${workflowsCasses.join(', ')}`}
              aria-label={`${workflowsCasses.length} workflow(s) non exécutable(s)`}
            >
              {workflowsCasses.length}
            </span>
          )}
        </button>
      </nav>
      <div className="domain-content">
        {section === 'routing' ? (
          <RouterView active={active} />
        ) : section === 'workflows' ? (
          <WorkflowProfilesView active={active} />
        ) : (
          <AgentsTopologyView active={active} />
        )}
      </div>
    </section>
  )
}
