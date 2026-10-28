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

import { isBlocked } from '../../../shared/run-blocked'
import type { SuggestionGroup } from './scout-suggestions'
import type { Langue } from '../../../shared/langue'
import { traduireChatFil } from '../textes-ecrans/chat-fil'

/** Le jeu historique, conservé à l'identique comme REPLI. */
export const STATIC_SUGGESTIONS = [
  'Crée une conversation « Revue archi » en catégorie codex',
  'Mets le juge sur codex',
  'Ouvre le graphe du brain',
  'Quel est l’état des workflows ?'
]

/**
 * Les mêmes phrases, par clé de la table des textes (conv-1170) : la puce cliquée part telle
 * qu'affichée, donc dans la langue de l'interface. Même ordre que `STATIC_SUGGESTIONS`.
 */
const CLES_STATIQUES = [
  'accueil.suggestion.revueArchi',
  'accueil.suggestion.jugeCodex',
  'accueil.suggestion.grapheBrain',
  'accueil.suggestion.etatWorkflows'
] as const

export interface HomeSuggestionState {
  /** Runs déjà chargés (panneau workflows), résumés par `parseRun` : statut ET compte de DoD. */
  runs?: Array<{
    subject: string
    summary: { status: string; dodTotal: number; dodChecked: number }
  }>
  /**
   * Brouillon repris (non envoyé) pour la conversation courante. Il n'est JAMAIS recopié en chip :
   * son texte vit déjà dans le composer, et l'afficher une seconde fois dans la zone de chat
   * dupliquait le brouillon à l'écran (régression attrapée par ChatView.behavior). Il sert
   * uniquement de signal : quand un brouillon est en cours, la home s'efface au lieu de proposer
   * des prompts sans rapport.
   */
  resumedDraft?: string | null
}

/**
 * Les groupes de chips à afficher sur la home. Vide en entrée → repli statique (jamais `[]`).
 * L'ordre traduit l'urgence : reprendre ce qui est en cours, puis débloquer, puis découvrir.
 */
export function buildHomeSuggestions(
  state: HomeSuggestionState,
  langue: Langue = 'fr'
): SuggestionGroup[] {
  const groups: SuggestionGroup[] = []

  // Un brouillon en cours = l'utilisateur sait déjà quoi écrire : aucune chip, pas même le repli.
  if (state.resumedDraft?.trim()) return []

  // LA règle unique (src/shared/run-blocked.ts), celle de get_state et de l'Observatoire. L'accueil
  // avait la sienne, par motif de texte sur le seul statut : elle ignorait `unknown`, les fossiles
  // `running`/`pending` et toute case de DoD non cochée (conv-861, 2026-09-25).
  // Compter AVANT de couper : le sous-titre coupait la liste à 3 puis la comptait, et 7 runs
  // bloqués s'affichaient « 3 » (conv-861, 2026-09-25). Seules les chips restent limitées à 3.
  const blocked = (state.runs ?? []).filter((r) => isBlocked(r.summary))
  if (blocked.length > 0)
    groups.push({
      key: '⛔',
      title: traduireChatFil('accueil.runsBloques', langue),
      subtitle: `${blocked.length}`,
      // `@run:` reste tel quel : c'est la mention que le chat relit pour joindre le run.
      items: blocked
        .slice(0, 3)
        .map((r) => ({ label: traduireChatFil('accueil.debloque', langue, { sujet: r.subject }) }))
    })

  if (groups.length === 0)
    return [
      {
        key: '·',
        title: traduireChatFil('accueil.pourDemarrer', langue),
        items: CLES_STATIQUES.map((cle) => ({ label: traduireChatFil(cle, langue) }))
      }
    ]

  return groups
}
