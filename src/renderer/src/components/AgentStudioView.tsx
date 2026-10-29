import { useEffect, useState } from 'react'
import type { AgentStudioSection } from '../tabs'
import { useTextesAgentStudio } from '../textes-ecrans/agent-studio'
import { workflowIssues, type ExecutabilityInput } from './workflow-executability'
import { useSkillsInventory } from './useSkillsInventory'
import { ViewTopBar } from './ViewTopBar'
// Importe DIRECTEMENT le composant : `RolesView` n'etait qu'un alias d'une ligne re-exportant
// `AgentsTopologyView`, avec ce fichier pour unique appelant. Deux noms pour un seul composant, c'est
// un renommage laisse a moitie fait — et un lecteur qui cherche `RolesView` ne trouve pas le code.
import { AgentsTopologyView } from './AgentsTopologyView'
import { WorkflowProfilesView } from './WorkflowProfilesView'
import { PetitesTachesReglage } from './PetitesTachesReglage'
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
  const { t } = useTextesAgentStudio()
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
      {/* « ORCHESTRATION », « Agent Studio » et « Workflows » : les mêmes mots en anglais. */}
      <ViewTopBar
        eyebrow="ORCHESTRATION"
        title="Agent Studio"
        description={t('studio.description')}
        ariaLabel={t('studio.aria')}
        active={section}
        onSelect={onSectionChange}
        tabs={[
          { id: 'topology', label: t('studio.onglet.topologie') },
          {
            id: 'workflows',
            label: 'Workflows',
            anomaly: {
              count: workflowsCasses.length,
              title: t('studio.anomalie.workflows', { liste: workflowsCasses.join(', ') }),
              testId: 'studio-anomaly-workflows'
            }
          }
        ]}
      />
      <div className="domain-content">
        {section === 'workflows' ? (
          <WorkflowProfilesView active={active} />
        ) : (
          <>
            {/* Le modèle des petites tâches, aussi ici (conv-1240) : même bloc que Routage. */}
            <PetitesTachesReglage
              active={active}
              idBase="studio-petites-taches-modele"
              testId="studio-petites-taches"
            />
            <AgentsTopologyView active={active} />
          </>
        )}
      </div>
    </section>
  )
}
