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

export type GroupeMaintenance = 'routine' | 'analyse' | 'depannage'

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
  { id: 'routine', libelle: 'Routine' },
  { id: 'analyse', libelle: 'Analyse et amélioration' },
  { id: 'depannage', libelle: 'Dépannage' }
]

export const SKILLS_MAINTENANCE: readonly SkillMaintenance[] = [
  {
    nom: 'maintenance',
    titre: 'Bulletin de santé',
    role: 'Bugs, lenteurs, retard, travail inachevé — répare au plus un défaut prouvé.',
    groupe: 'routine',
    prompt:
      '/maintenance passe d’Autowin OS lancée à la main depuis la vue Maintenance : rends le bulletin du jour.'
  },
  {
    nom: 'gc',
    titre: 'Ménage des données',
    role: 'Déplace les déchets prouvés de .autowin-data en corbeille datée.',
    groupe: 'routine',
    prompt:
      '/gc passe sur .autowin-data lancée à la main depuis la vue Maintenance : rends le bilan.'
  },
  {
    nom: 'curate',
    titre: 'Trier le savoir',
    role: 'Promeut, fusionne ou rejette les candidats en attente du Brain.',
    groupe: 'routine',
    prompt: '/curate vide la file des candidats Brain et rends le bilan.'
  },
  {
    nom: 'rendement',
    titre: 'Coûts et lenteurs',
    role: 'Classe les conversations par gaspillage et remonte à la cause du détour.',
    groupe: 'analyse',
    prompt:
      '/rendement analyse les conversations des 7 derniers jours : les pires gaspillages, leur cause et le chemin minimal.'
  },
  {
    nom: 'residus',
    titre: 'Code mort',
    role: 'Repère fichiers morts et branches jamais atteintes — propose, ne supprime rien.',
    groupe: 'analyse',
    prompt:
      '/residus cherche le code résiduel inutile d’Autowin OS et rends la liste classée des candidats au nettoyage, sans rien supprimer.'
  },
  {
    nom: 'glean',
    titre: 'Récolter le savoir',
    role: 'Dépose comme candidats Brain les faits jamais retenus des conversations.',
    groupe: 'analyse',
    prompt:
      '/glean récolte dans les conversations des 7 derniers jours les faits durables jamais retenus et dépose-les comme candidats Brain.'
  },
  {
    nom: 'kaizen',
    titre: 'Corriger un comportement',
    role: 'Trouve un défaut de comportement des agents et applique le correctif à sa source.',
    groupe: 'analyse',
    prompt:
      '/kaizen sur les conversations Autowin des dernières 24 h : trouve le défaut de comportement le plus coûteux et corrige sa cause.'
  },
  // Ajout du 2026-10-23 (conv-1112) : « rajoute /heal dans la vue maintenance ».
  {
    nom: 'heal',
    titre: 'Corriger les défauts',
    role: 'Trouve les défauts prouvés du code (test rouge, lenteur mesurée) et les corrige un à un.',
    groupe: 'analyse',
    prompt:
      '/heal Autowin OS : trouve les défauts prouvés (tests rouges, lenteurs mesurées) et corrige-les un à la fois, jusqu’au vert.'
  },
  {
    nom: 'salvage',
    titre: 'Travail non publié',
    role: 'Retrouve le travail resté de côté, le trie par contenu, puis publie ce qu’il garde.',
    groupe: 'depannage',
    prompt:
      '/salvage cherche le travail non publié du dépôt Autowin OS (copies de travail, remises de côté, branches non fusionnées) et trie-le par contenu.'
  },
  {
    nom: 'gel',
    titre: 'Enquête sur un gel',
    role: 'Remonte un gel de l’app jusqu’à son fichier et sa ligne — désigne, ne corrige pas.',
    groupe: 'depannage',
    prompt: '/gel enquête sur les derniers gels enregistrés d’Autowin OS et désigne le coupable.'
  },
  {
    nom: 'maj',
    titre: 'Débloquer la mise à jour',
    role: 'Résout ce qui bloque la mise à jour sans perdre le travail local.',
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
      return 'Aucun modèle IA n’est attribué aux rôles : règle-le dans Settings › Routage.'
    }
    const conversation = await window.api.conversationsCreate?.({
      title: `/${skill.nom} — ${skill.titre}`,
      category: provider,
      provider
    })
    if (!conversation?.id) return 'La conversation n’a pas pu être créée.'
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
