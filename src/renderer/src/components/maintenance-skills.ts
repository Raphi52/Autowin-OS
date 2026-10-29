/**
 * Les skills d'ENTRETIEN d'Autowin OS, lançables d'un clic depuis la vue Maintenance.
 *
 * Demande du 2026-10-22 (conv-1101) : « la view tests est nulle, appelle-la maintenance et mets des
 * boutons pour faire toutes nos skills de maintenance d'autowin ». La procédure de chaque entretien
 * vit dans `skills/<nom>/SKILL.md` : un bouton ne fait que l'INVOQUER, il ne la réécrit pas — deux
 * procédures concurrentes, c'est la moins tenue qui gagne.
 *
 * L'INVOCATION EST EN TÊTE de chaque consigne : `invokedSkillId` (src/main/skill-pipeline.ts) ne
 * reconnaît une skill qu'en début de message. La consigne n'ajoute que ce que la skill ne peut pas
 * deviner : qu'elle part d'un clic, et sur quelle fenêtre de temps.
 *
 * Chaque `role` dit ce que la skill FAIT, y compris quand elle écrit ou publie (kaizen applique ses
 * éditions, salvage publie ce qu'il récupère) : le clic doit savoir ce qu'il déclenche.
 */

import { langueCourante } from '../langue'
import {
  traduireBoardEtMaintenance,
  type CleBoardEtMaintenance
} from '../textes-ecrans/board-et-maintenance'

export type GroupeMaintenance = 'routine' | 'analyse' | 'depannage'

/**
 * Titres, rôles et libellés de groupe sont lus dans la langue COURANTE à chaque lecture (getters,
 * conv-1170). Le `prompt` reste en français : c'est la consigne envoyée à l'agent, et sa tête
 * `/<nom>` est relue par `invokedSkillId` ; l'agent reçoit la langue de l'utilisateur à part.
 */
const enLangue = (cle: CleBoardEtMaintenance): string =>
  traduireBoardEtMaintenance(cle, langueCourante())

export interface SkillMaintenance {
  /** Nom du dossier `skills/<nom>/` — vérifié par le test contre le disque. */
  nom: string
  /** Libellé court du bouton. */
  titre: string
  /** Ce que fait la skill, en une ligne. */
  role: string
  groupe: GroupeMaintenance
  /** Message envoyé dans la conversation neuve ; commence TOUJOURS par `/<nom>`. */
  prompt: string
}

export const GROUPES_MAINTENANCE: ReadonlyArray<{ id: GroupeMaintenance; libelle: string }> = [
  // « Routine » : même mot en anglais, il reste en dur.
  { id: 'routine', libelle: 'Routine' },
  {
    id: 'analyse',
    get libelle() {
      return enLangue('skills.groupe.analyse')
    }
  },
  {
    id: 'depannage',
    get libelle() {
      return enLangue('skills.groupe.depannage')
    }
  }
]

export const SKILLS_MAINTENANCE: readonly SkillMaintenance[] = [
  {
    nom: 'maintenance',
    get titre() {
      return enLangue('skills.maintenance.titre')
    },
    get role() {
      return enLangue('skills.maintenance.role')
    },
    groupe: 'routine',
    prompt:
      '/maintenance passe d’Autowin OS lancée à la main depuis la vue Maintenance : rends le bulletin du jour.'
  },
  {
    nom: 'gc',
    get titre() {
      return enLangue('skills.gc.titre')
    },
    get role() {
      return enLangue('skills.gc.role')
    },
    groupe: 'routine',
    prompt:
      '/gc passe sur .autowin-data lancée à la main depuis la vue Maintenance : rends le bilan.'
  },
  {
    nom: 'curate',
    get titre() {
      return enLangue('skills.curate.titre')
    },
    get role() {
      return enLangue('skills.curate.role')
    },
    groupe: 'routine',
    prompt: '/curate vide la file des candidats Brain et rends le bilan.'
  },
  {
    nom: 'rendement',
    get titre() {
      return enLangue('skills.rendement.titre')
    },
    get role() {
      return enLangue('skills.rendement.role')
    },
    groupe: 'analyse',
    prompt:
      '/rendement analyse les conversations des 7 derniers jours : les pires gaspillages, leur cause et le chemin minimal.'
  },
  {
    nom: 'residus',
    get titre() {
      return enLangue('skills.residus.titre')
    },
    get role() {
      return enLangue('skills.residus.role')
    },
    groupe: 'analyse',
    prompt:
      '/residus cherche le code résiduel inutile d’Autowin OS et rends la liste classée des candidats au nettoyage, sans rien supprimer.'
  },
  {
    nom: 'glean',
    get titre() {
      return enLangue('skills.glean.titre')
    },
    get role() {
      return enLangue('skills.glean.role')
    },
    groupe: 'analyse',
    prompt:
      '/glean récolte dans les conversations des 7 derniers jours les faits durables jamais retenus et dépose-les comme candidats Brain.'
  },
  {
    nom: 'kaizen',
    get titre() {
      return enLangue('skills.kaizen.titre')
    },
    get role() {
      return enLangue('skills.kaizen.role')
    },
    groupe: 'analyse',
    prompt:
      '/kaizen sur les conversations Autowin des dernières 24 h : trouve le défaut de comportement le plus coûteux et corrige sa cause.'
  },
  // Ajout du 2026-10-23 (conv-1112) : « rajoute /heal dans la vue maintenance ».
  {
    nom: 'heal',
    get titre() {
      return enLangue('skills.heal.titre')
    },
    get role() {
      return enLangue('skills.heal.role')
    },
    groupe: 'analyse',
    prompt:
      '/heal Autowin OS : trouve les défauts prouvés (tests rouges, lenteurs mesurées) et corrige-les un à la fois, jusqu’au vert.'
  },
  {
    nom: 'git',
    get titre() {
      return enLangue('skills.git.titre')
    },
    get role() {
      return enLangue('skills.git.role')
    },
    groupe: 'depannage',
    prompt:
      '/git sur le dépôt Autowin OS : trie par contenu le travail non publié (copies de travail, remises de côté, branches non fusionnées), publie-le et range ce qui traîne.'
  },
  {
    nom: 'gel',
    get titre() {
      return enLangue('skills.gel.titre')
    },
    get role() {
      return enLangue('skills.gel.role')
    },
    groupe: 'depannage',
    prompt: '/gel enquête sur les derniers gels enregistrés d’Autowin OS et désigne le coupable.'
  },
  {
    nom: 'maj',
    get titre() {
      return enLangue('skills.maj.titre')
    },
    get role() {
      return enLangue('skills.maj.role')
    },
    groupe: 'depannage',
    prompt:
      '/maj vérifie la mise à jour d’Autowin OS : si elle est bloquée, résous le blocage puis relance-la ; sinon dis qu’elle passe.'
  }
]

/**
 * Ouvre une conversation dédiée et y ENVOIE la skill (`send: true`) : le clic EST la validation,
 * comme « Trier avec /curate » (KnowledgeInboxPanel) et « Réparer la mise à jour » (UpdateBanner).
 *
 * Rend `null` si l'envoi est parti, sinon la RAISON lisible : un bouton qui ne fait rien en silence
 * paraît mort. Le modèle IA vient des RÔLES, jamais d'un défaut inventé ; sans lui on n'ouvre rien.
 */
export async function lancerSkillMaintenance(skill: SkillMaintenance): Promise<string | null> {
  try {
    const roleMap = await window.api.roles?.()
    const provider =
      roleMap?.orchestrator?.provider ??
      roleMap?.subagent?.provider ??
      (roleMap ? Object.values(roleMap)[0]?.provider : undefined)
    if (!provider) {
      return enLangue('skills.aucunModele')
    }
    const conversation = await window.api.conversationsCreate?.({
      title: `/${skill.nom} — ${skill.titre}`,
      category: provider,
      provider
    })
    if (!conversation?.id) return enLangue('skills.conversationNonCreee')
    try {
      await window.api.appCommand?.('navigate', { tab: 'chat' })
    } catch {
      /* navigation refusée : le message reste préparé dans la conversation */
    }
    window.dispatchEvent(
      new CustomEvent('autowin:prefill-conversation', {
        detail: { conversationId: conversation.id, prompt: skill.prompt, send: true }
      })
    )
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
