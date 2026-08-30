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

import { canonicalProjectPath } from '../../../shared/project-path'

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
  kind: 'kaizen' | 'dossier' | 'divers'
  /** Niveau visuel dans l'arborescence des dossiers réellement présents. */
  depth: number
  /** Dossier parent le plus proche parmi les dossiers réellement présents. */
  parentKey?: string
  items: T[]
}

/**
 * Le nom lisible d'un dossier : son dernier segment.
 *
 * `C:\Amitel\Autowin OS` → `Autowin OS`. Afficher le chemin entier ferait déborder la barre latérale
 * et noierait le seul mot qui distingue deux dossiers. Le chemin complet reste la CLÉ, donc deux
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
  if (chemin) {
    const key = chemin.replace(/[\\/]+$/, '') || chemin
    return { key, label: nomDeDossier(key), kind: 'dossier' }
  }
  return { key: GROUPE_DIVERS, label: 'Divers', kind: 'divers' }
}

/**
 * Les groupes, dans l'ordre d'affichage.
 *
 * Les dossiers d'abord, par ordre alphabétique — ce que l'utilisateur cherche. Puis « Divers », puis
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

  const dossiers = [...par.values()].filter((g) => g.kind === 'dossier')
  const parCheminNormalise = new Map(
    dossiers.map((g) => [g.key.replace(/[\\/]+$/, '').toLocaleLowerCase('fr'), g])
  )
  for (const groupe of dossiers) {
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
  for (const groupe of dossiers) groupe.depth = profondeur(groupe)

  const rang = (g: ConversationGroup<T>): number =>
    g.kind === 'dossier' ? 0 : g.kind === 'divers' ? 1 : 2

  return [...par.values()].sort((a, b) => {
    const delta = rang(a) - rang(b)
    if (delta !== 0) return delta
    if (a.kind === 'dossier' && b.kind === 'dossier') {
      return a.key.localeCompare(b.key, 'fr', { sensitivity: 'base' })
    }
    return a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })
  })
}

/**
 * Ordonne les groupes par DATE sans casser ce que `grouperConversations` garantit.
 *
 * Le tri par date a d'abord ete applique en aval, directement sur la liste rendue — un `.sort()` par
 * `items[0]` qui ecrasait les deux invariants de ce module : le RANG par nature (dossiers, puis
 * « Divers », puis « Auto-kaizen » en DERNIER) et l'ordre PARENT-AVANT-ENFANT. Consequences vues :
 * le groupe de bruit remontait en tete des qu'il contenait la conversation la plus recente, et un
 * sous-dossier recent s'affichait au-dessus de son parent tout en gardant son indentation — une
 * arborescence rendue qui n'en etait plus une. Les tests du module continuaient de passer : ils
 * portent sur la fonction pure, une couche SOUS la vue ou le tri etait fait.
 *
 * La date n'arbitre donc qu'entre FRERES, a l'interieur d'un rang : les dossiers sont emis en
 * pre-ordre (un parent, puis ses descendants), et les rangs restent dans leur ordre.
 *
 * `dateDe` appartient a l'appelant : ce module ne sait pas ce qui date une conversation.
 */
export function ordonnerGroupes<T extends ConversationLike>(
  groupes: readonly ConversationGroup<T>[],
  dateDe: (groupe: ConversationGroup<T>) => number,
  ordre: 'asc' | 'desc'
): ConversationGroup<T>[] {
  const presentes = new Set(groupes.map((groupe) => groupe.key))
  const parDate = (a: ConversationGroup<T>, b: ConversationGroup<T>): number => {
    const delta = dateDe(a) - dateDe(b)
    if (delta !== 0) return ordre === 'asc' ? delta : -delta
    // Egalite de date : on retombe sur la cle, pour que l'ordre reste STABLE d'un rendu a l'autre.
    return a.key.localeCompare(b.key, 'fr', { sensitivity: 'base' })
  }

  // Un parent absent de la liste (replie, donc ses descendants filtres) ne peut pas ancrer : le
  // groupe est alors traite comme une racine plutot que disparaitre du rendu.
  const enfants = new Map<string, ConversationGroup<T>[]>()
  const racines: ConversationGroup<T>[] = []
  for (const groupe of groupes) {
    const parent =
      groupe.kind === 'dossier' && groupe.parentKey && presentes.has(groupe.parentKey)
        ? groupe.parentKey
        : undefined
    if (parent) enfants.set(parent, [...(enfants.get(parent) ?? []), groupe])
    else racines.push(groupe)
  }

  // Seul « Auto-kaizen » garde un rang : c'est du BRUIT automatique, il descend toujours. Entre un
  // dossier et « Divers », c'est la DATE qui tranche — demande utilisateur du 2026-08-30 : « la ou
  // j'ai ecrit le dernier message ca la remonte en tete de liste ». Une conversation sans dossier
  // tombait derriere TOUT le contenu des dossiers, ce qui avait impose une categorie « Recentes »
  // en doublon ; la categorie est retiree, la regle de tri corrigee a sa source.
  const rang = (g: ConversationGroup<T>): number => (g.kind === 'kaizen' ? 1 : 0)

  const sortie: ConversationGroup<T>[] = []
  const emettre = (groupe: ConversationGroup<T>): void => {
    sortie.push(groupe)
    for (const enfant of [...(enfants.get(groupe.key) ?? [])].sort(parDate)) emettre(enfant)
  }
  for (const racine of [...racines].sort((a, b) => rang(a) - rang(b) || parDate(a, b))) {
    emettre(racine)
  }
  return sortie
}

/**
 * Canonise les CLES d'un etat plie/deplie relu du stockage.
 *
 * La cle d'un groupe de dossier EST son `projectPath`, et l'hydratation du store canonise
 * desormais ce chemin (`C:/Organisation/...` -> `C:\Organisation\...`). Sans cette passe, un etat
 * enregistre sous l'ANCIENNE forme ne correspond plus a aucun groupe : tous les dossiers de la
 * barre laterale se deplient au premier lancement, silencieusement.
 *
 * Les cles sentinelles (`auto-kaizen`, `divers`) ne portent ni separateur ni lettre de lecteur :
 * la canonisation les laisse telles quelles.
 */
export function canoniserReplis(brut: Readonly<Record<string, boolean>>): Record<string, boolean> {
  const sortie: Record<string, boolean> = {}
  for (const [cle, replie] of Object.entries(brut)) {
    sortie[canonicalProjectPath(cle) ?? cle] = replie
  }
  return sortie
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

/**
 * Retire les descendants d'une catégorie repliée.
 *
 * L'indentation seule ne suffit pas à former une arborescence : sans ce filtre, fermer un parent
 * laissait toutes ses sous-catégories affichées comme si elles étaient indépendantes.
 */
export function groupesVisibles<T extends ConversationLike>(
  groupes: readonly ConversationGroup<T>[],
  replies: Readonly<Record<string, boolean>>
): ConversationGroup<T>[] {
  const parCle = new Map(groupes.map((groupe) => [groupe.key, groupe]))

  return groupes.filter((groupe) => {
    let parentKey = groupe.parentKey
    while (parentKey) {
      if (estReplie(parentKey, replies)) return false
      parentKey = parCle.get(parentKey)?.parentKey
    }
    return true
  })
}
