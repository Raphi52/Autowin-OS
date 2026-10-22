import { useCallback, useState } from 'react'
import {
  GROUPES_MAINTENANCE,
  SKILLS_MAINTENANCE,
  lancerSkillMaintenance,
  type SkillMaintenance
} from './maintenance-skills'
import './MaintenanceSkillsPanel.css'

/**
 * Les boutons d'entretien d'Autowin OS, en tête de la vue Maintenance (conv-1101, 2026-10-22).
 *
 * Un clic ouvre une conversation dédiée et y envoie la skill : la vue n'exécute rien elle-même, le
 * travail se suit dans le chat. Un échec d'envoi s'AFFICHE sous les boutons — un bouton muet paraît
 * mort, et l'utilisateur recliquerait en créant des conversations vides.
 */
export function MaintenanceSkillsPanel(): React.JSX.Element {
  const [enCours, setEnCours] = useState('')
  const [erreur, setErreur] = useState('')

  const lancer = useCallback(async (skill: SkillMaintenance) => {
    setEnCours(skill.nom)
    setErreur('')
    const raison = await lancerSkillMaintenance(skill)
    setEnCours('')
    if (raison) setErreur(`/${skill.nom} : ${raison}`)
  }, [])

  return (
    <section
      className="maint-skills"
      data-testid="maintenance-skills"
      aria-label="Skills de maintenance"
    >
      {GROUPES_MAINTENANCE.map((groupe) => (
        <div key={groupe.id} className="maint-groupe">
          <span className="maint-groupe-titre">{groupe.libelle}</span>
          <div className="maint-boutons">
            {SKILLS_MAINTENANCE.filter((s) => s.groupe === groupe.id).map((skill) => (
              <button
                key={skill.nom}
                type="button"
                className="maint-bouton"
                data-testid={`maintenance-skill-${skill.nom}`}
                title={`${skill.role}\n\nEnvoie : ${skill.prompt}`}
                disabled={Boolean(enCours)}
                onClick={() => void lancer(skill)}
              >
                <span className="maint-bouton-tete">
                  <span className="maint-bouton-titre">{skill.titre}</span>
                  <span className="maint-bouton-nom">
                    {enCours === skill.nom ? 'ouverture…' : `/${skill.nom}`}
                  </span>
                </span>
                <span className="maint-bouton-role">{skill.role}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {erreur && (
        <p className="maint-erreur" role="alert" data-testid="maintenance-skills-erreur">
          {erreur}
        </p>
      )}
    </section>
  )
}
