/**
 * Grouper les conversations de la liste du Chat.
 *
 * Repris de claude.exe, dont le mécanisme a été MESURÉ et non supposé : `~/.claude/projects/<cwd
 * échappé>/`, un dossier par répertoire de travail, une session par fichier dedans. Le groupe EST le
 * dossier — aucun modèle n'intervient, et aucun n'intervient ici non plus.
 *
 * Une seule règle s'y ajoute, née d'un besoin réel : les conversations Auto-Kaizen s'intercalaient au
 * milieu de celles de l'utilisateur, qui les subissait. Elles ont leur propre groupe, replié par
 * défaut.
 *
 * Logique PURE : testable sans Electron, sans DOM et sans store.
 */

/** Le groupe des analyses automatiques. Replié par défaut — c'est tout l'objet de sa séparation. */
export const GROUPE_KAIZEN = 'auto-kaizen'
/** Le groupe de ce qui n'a pas de dossier. Jamais deviné : l'absence est une réponse. */
export const GROUPE_DIVERS = 'divers'

/** Le strict nécessaire au groupement — pas le type complet, pour que ce module reste testable seul. */
export interface ConversationLike {
  id: string
  projectPath?: string
  autoKaizen?: unknown
}

export interface ConversationGroup<T extends ConversationLike> {
  /** Clé stable : sert d'identité au repli persisté. Un libellé changerait avec l'affichage. */
  key: string
  label: string
  kind: 'kaizen' | 'projet' | 'divers'
  /** Niveau visuel dans l'arborescence des dossiers réellement présents. */
  depth: number
  /** Catégorie parente la plus proche parmi les dossiers réellement présents. */
  parentKey?: string
  items: T[]
}

/**
 * Le nom lisible d'un dossier : son dernier segment.
 *
 * `C:\Amitel\Autowin OS` → `Autowin OS`. Afficher le chemin entier ferait déborder la barre latérale
 * et noierait le seul mot qui distingue deux projets. Le chemin complet reste la CLÉ, donc deux
 * dossiers homonymes ne fusionnent pas — ils s'affichent juste pareil, et l'infobulle les départage.
 */
export function nomDeDossier(chemin: string): string {
  const propre = chemin.replace(/[\\/]+$/, '')
  const segments = propre.split(/[\\/]/)
  return segments[segments.length - 1] || propre
}

/** À quel groupe appartient une conversation. L'ordre des tests EST la règle de priorité. */
export function groupeDe(conversation: ConversationLike): {
  key: string
  label: string
  kind: ConversationGroup<ConversationLike>['kind']
} {
  // Auto-Kaizen d'abord : une analyse automatique reste une analyse automatique, même si elle porte
  // un dossier. La ranger sous son projet la remettrait exactement là où elle dérange.
  if (conversation.autoKaizen) {
    return { key: GROUPE_KAIZEN, label: 'Auto-kaizen', kind: 'kaizen' }
  }
  const chemin = conversation.projectPath?.trim()
  if (chemin) return { key: chemin, label: nomDeDossier(chemin), kind: 'projet' }
  return { key: GROUPE_DIVERS, label: 'Divers', kind: 'divers' }
}

/**
 * Les groupes, dans l'ordre d'affichage.
 *
 * Les projets d'abord, par ordre alphabétique — ce que l'utilisateur cherche. Puis « Divers », puis
 * « Auto-kaizen » en dernier : le bruit descend, il ne s'intercale pas. L'ordre des conversations à
 * l'intérieur d'un groupe est celui reçu (déjà trié par pertinence ou par date), jamais retrié ici :
 * ce module groupe, il n'arbitre pas la pertinence.
 */
export function grouperConversations<T extends ConversationLike>(
  conversations: readonly T[]
): ConversationGroup<T>[] {
  const par = new Map<string, ConversationGroup<T>>()
  for (const conversation of conversations) {
    const { key, label, kind } = groupeDe(conversation)
    const existant = par.get(key)
    if (existant) existant.items.push(conversation)
    else par.set(key, { key, label, kind, depth: 0, items: [conversation] })
  }

  const projets = [...par.values()].filter((g) => g.kind === 'projet')
  const parCheminNormalise = new Map(
    projets.map((g) => [g.key.replace(/[\\/]+$/, '').toLocaleLowerCase('fr'), g])
  )
  for (const groupe of projets) {
    let candidat = groupe.key.replace(/[\\/]+$/, '')
    while (/[\\/]/.test(candidat)) {
      candidat = candidat.replace(/[\\/][^\\/]+$/, '')
      const parent = parCheminNormalise.get(candidat.toLocaleLowerCase('fr'))
      if (parent) {
        groupe.parentKey = parent.key
        break
      }
    }
  }

  const profondeur = (groupe: ConversationGroup<T>): number => {
    if (!groupe.parentKey) return 0
    const parent = par.get(groupe.parentKey)
    return parent ? profondeur(parent) + 1 : 0
  }
  for (const groupe of projets) groupe.depth = profondeur(groupe)

  const rang = (g: ConversationGroup<T>): number =>
    g.kind === 'projet' ? 0 : g.kind === 'divers' ? 1 : 2

  return [...par.values()].sort((a, b) => {
    const delta = rang(a) - rang(b)
    if (delta !== 0) return delta
    if (a.kind === 'projet' && b.kind === 'projet') {
      return a.key.localeCompare(b.key, 'fr', { sensitivity: 'base' })
    }
    return a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })
  })
}

/**
 * Un groupe est-il replié ?
 *
 * « Auto-kaizen » l'est par DÉFAUT, et c'est la raison d'être de la fonctionnalité : sans ce défaut,
 * il faudrait le replier à la main à chaque installation. Tous les autres sont ouverts par défaut —
 * un groupe fermé qu'on n'a pas fermé soi-même cache des conversations sans le dire.
 */
export function estReplie(key: string, replies: Readonly<Record<string, boolean>>): boolean {
  const choix = replies[key]
  if (typeof choix === 'boolean') return choix
  return key === GROUPE_KAIZEN
}
