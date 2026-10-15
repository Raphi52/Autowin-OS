import { useEffect, useState } from 'react'
import type { AgentStudioSection } from '../tabs'
import { workflowIssues, type ExecutabilityInput } from './workflow-executability'
import { useSkillsInventory } from './useSkillsInventory'
import { ViewTopBar } from './ViewTopBar'
// Importe DIRECTEMENT le composant : `RolesView` n'etait qu'un alias d'une ligne re-exportant
// `AgentsTopologyView`, avec ce fichier pour unique appelant. Deux noms pour un seul composant, c'est
// un renommage laisse a moitie fait — et un lecteur qui cherche `RolesView` ne trouve pas le code.
import { AgentsTopologyView } from './AgentsTopologyView'
import { WorkflowProfilesView } from './WorkflowProfilesView'
import './ViewPage.css'
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
   * Une anomalie n'était visible qu'en OUVRANT l'onglet concerné : un workflow injouable partait donc
   * au prompt suivant sans que rien ne l'annonce depuis l'onglet voisin. La sonde est en LECTURE
   * seule et ne tourne que si Agent Studio est ouvert. (Celle des providers expirés a suivi l'onglet
   * Routage dans Settings — conv-963.)
   */
  const [workflowProfils, setWorkflowProfils] = useState<ExecutabilityInput[]>([])
  /**
   * MEME inventaire que la vue Workflows : sans lui, la sonde accusait un workflow a brique skill
   * d'etre injouable. Indetermine (`null`) = la sonde reste muette, elle n'invente pas d'alerte.
   */
  const skills = useSkillsInventory()
  /**
   * L'anomalie se DERIVE des profils lus et de l'inventaire, elle n'est pas figee dans un etat : sinon
   * l'arrivee de l'inventaire devrait relancer la sonde IPC, et chaque montage lirait deux fois.
   * Inventaire encore en vol (`null`) = aucune alerte, plutot qu'un faux positif clignotant.
   */
  const workflowsCasses = skills
    ? workflowProfils.filter((p) => workflowIssues(p, skills).length > 0).map((p) => p.name)
    : []

  useEffect(() => {
    if (!active) return
    let annule = false
    let workflowGeneration = 0
    const refreshWorkflows = (): void => {
      const generation = ++workflowGeneration
      void Promise.resolve(window.api.workflowProfiles?.())
        .then((fichier) => {
          if (annule || generation !== workflowGeneration) return
          const profils = ((fichier as { profiles?: ExecutabilityInput[] } | undefined)?.profiles ??
            []) as ExecutabilityInput[]
          setWorkflowProfils(profils)
        })
        // Un onglet ne doit pas casser parce que sa SONDE a échoué : l'indicateur reste simplement muet.
        .catch(() => undefined)
    }
    refreshWorkflows()
    const off = window.api.onAppEvent((event) => {
      if (event.type === 'refresh' && event.scope === 'workflows') refreshWorkflows()
    })
    return () => {
      annule = true
      off()
    }
  }, [active])

  return (
    <section className="view-page domain-shell" data-testid="agent-studio-view">
      <ViewTopBar
        eyebrow="ORCHESTRATION"
        title="Agent Studio"
        description="Quels modèles jouent quels rôles, et quels workflows les enchaînent."
        ariaLabel="Sections Agent Studio"
        active={section}
        onSelect={onSectionChange}
        tabs={[
          { id: 'topology', label: 'Modèles & topologie' },
          {
            id: 'workflows',
            label: 'Workflows',
            anomaly: {
              count: workflowsCasses.length,
              title: `Workflow(s) non exécutable(s) : ${workflowsCasses.join(', ')}`,
              testId: 'studio-anomaly-workflows'
            }
          }
        ]}
      />
      <div className="domain-content">
        {section === 'workflows' ? (
          <WorkflowProfilesView active={active} />
        ) : (
          <AgentsTopologyView active={active} />
        )}
      </div>
    </section>
  )
}
