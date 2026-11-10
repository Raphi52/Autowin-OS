/**
 * LE RÉGLAGE DE DÉPART D'UN POSTE NEUF = LE PROFIL « DÉFAUT ».
 *
 * Un poste est « neuf » tant que son fichier de topologie n'existe pas : rien n'y a jamais été
 * réglé dans Agent Studio. À ce moment-là, et une seule fois, on y écrit le profil « Défaut »
 * (orchestrateur, sous-agents, petites tâches). Le fichier écrit sert de marque : dès qu'il existe,
 * le poste est réglé et cette fonction ne touche plus à rien.
 *
 * Seule une ABSENCE franche compte. Un fichier illisible (droit, verrou) est un poste réglé qu'on
 * n'arrive pas à lire : l'écraser ferait perdre ses réglages.
 */
import { statSync } from 'node:fs'
import type { ImportedModel } from '../modeles/models'
import { saveAgentTopology } from '../topologie/topology-disk'
import type { AgentTopology } from '../topologie/topology'
import { profilParDefaut } from './profil-defaut'
import type { Role, RoleBinding } from './roles'

function absent(chemin: string): boolean {
  try {
    statSync(chemin)
    return false
  } catch (erreur) {
    return (erreur as { code?: unknown } | null)?.code === 'ENOENT'
  }
}

export function amorcerReglageDeDepart(options: {
  cheminTopologie: string
  models: ImportedModel[]
  roles: Record<Role, RoleBinding>
  /** Un modèle des petites tâches déjà choisi sur ce poste n'est jamais remplacé. */
  petitesTachesDejaReglees: boolean
  poserPetitesTaches: (binding: RoleBinding) => void
}): AgentTopology | null {
  if (!absent(options.cheminTopologie)) return null
  const defaut = profilParDefaut(options.models, options.roles)
  // Catalogue sans les modèles voulus (pas encore découvert, poste sans Claude) : on réessaiera.
  if (!defaut) return null
  // Les petites tâches d'abord : si leur écriture échoue, la marque n'est pas posée et le
  // prochain passage reprend tout.
  if (!options.petitesTachesDejaReglees) options.poserPetitesTaches(defaut.petitesTaches)
  return saveAgentTopology(options.cheminTopologie, defaut.profile.topology, options.models)
}
