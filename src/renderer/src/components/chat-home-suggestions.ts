/**
 * Suggestions d'accueil DÉRIVÉES de l'état réel plutôt que quatre phrases figées.
 *
 * Pourquoi : la home affichait 4 prompts constants pendant que l'écran montrait, juste à côté,
 * « 2 runs bloqués ». La première action utile était donc invisible. Ici, chaque chip provient d'un
 * fait observé (un run bloqué ou un brouillon repris) ; sans aucun fait, on retombe
 * sur le jeu statique historique — jamais d'écran vide.
 *
 * PUR (aucun React, aucun IPC) → testable directement. Rendu par le `SuggestionGrid` existant.
 */

import type { SuggestionGroup } from './scout-suggestions'

/** Le jeu historique, conservé à l'identique comme REPLI. */
export const STATIC_SUGGESTIONS = [
  'Crée une conversation « Revue archi » en catégorie codex',
  'Mets le juge sur codex',
  'Ouvre le graphe du brain rig-tv',
  'Quel est l’état des workflows ?'
]

export interface HomeSuggestionState {
  /** Runs déjà chargés (panneau workflows). */
  runs?: Array<{ subject: string; summary?: { status?: string } }>
  /**
   * Brouillon repris (non envoyé) pour la conversation courante. Il n'est JAMAIS recopié en chip :
   * son texte vit déjà dans le composer, et l'afficher une seconde fois dans la zone de chat
   * dupliquait le brouillon à l'écran (régression attrapée par ChatView.behavior). Il sert
   * uniquement de signal : quand un brouillon est en cours, la home s'efface au lieu de proposer
   * des prompts sans rapport.
   */
  resumedDraft?: string | null
}

/** Un run est « à débloquer » si son statut n'est ni vert ni clos. */
export function isBlockedRun(status?: string): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  if (/(green|vert|done|clos|closed|termin)/.test(s)) return false
  return /(bloqu|blocked|open|red|rouge|fail|échec|echec)/.test(s)
}

/**
 * Les groupes de chips à afficher sur la home. Vide en entrée → repli statique (jamais `[]`).
 * L'ordre traduit l'urgence : reprendre ce qui est en cours, puis débloquer, puis découvrir.
 */
export function buildHomeSuggestions(state: HomeSuggestionState): SuggestionGroup[] {
  const groups: SuggestionGroup[] = []

  // Un brouillon en cours = l'utilisateur sait déjà quoi écrire : aucune chip, pas même le repli.
  if (state.resumedDraft?.trim()) return []

  const blocked = (state.runs ?? []).filter((r) => isBlockedRun(r.summary?.status)).slice(0, 3)
  if (blocked.length > 0)
    groups.push({
      key: '⛔',
      title: 'Runs bloqués',
      subtitle: `${blocked.length}`,
      items: blocked.map((r) => ({ label: `Débloque @run:${r.subject}` }))
    })

  if (groups.length === 0)
    return [
      {
        key: '·',
        title: 'Pour démarrer',
        items: STATIC_SUGGESTIONS.map((label) => ({ label }))
      }
    ]

  return groups
}
