/**
 * Un groupe d'actions a-t-il quelque chose a montrer DANS Workflows ?
 *
 * Constate en usage reel (2026-07-29) : sur « 1 action terminee · 1 action en cours — edit_file ·
 * verify », cliquer le bloc n'affichait RIEN. Cause : le bloc renvoie vers Workflows, mais seule une
 * ORCHESTRATION y produit une carte (`liveRunCardRef` n'est attache qu'aux runs). Les commandes
 * locales livrees le meme jour — `edit_file`, `verify`, `brain_query` — ne creent aucun run : le
 * scroll visait donc un element inexistant.
 *
 * Un bouton qui promet ce qu'il ne peut pas tenir est pire qu'un bloc inerte : l'utilisateur clique,
 * rien ne bouge, et il ne sait pas si c'est casse ou si c'est lui. D'ou cette decision explicite —
 * s'il n'y a pas de run, le detail doit s'afficher SUR PLACE, pas ailleurs.
 */

/** Commandes qui produisent un run consultable dans Workflows. */
const RUN_PRODUCING = new Set(['orchestrate'])

export interface ActionLike {
  name: string
  ok?: boolean
  interrupted?: boolean
  data?: unknown
}

/** Vrai si AU MOINS une action du groupe a produit (ou produit) un run consultable. */
export function hasConsultableRun(actions: readonly ActionLike[]): boolean {
  return actions.some((action) => {
    if (RUN_PRODUCING.has(action.name)) return true
    // Repli robuste : une action qui porte une reference de run est consultable, quel que soit son nom.
    const data = action.data
    if (!data || typeof data !== 'object') return false
    const reference = (data as { runPath?: unknown; runId?: unknown })
    return typeof reference.runPath === 'string' || typeof reference.runId === 'string'
  })
}

/** Detail lisible d'une action LOCALE, a montrer dans le fil faute de run. */
export interface LocalActionDetail {
  name: string
  /** Diff d'une edition, sortie d'une verification, ou raison d'un refus. */
  text: string
  ok: boolean
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

/**
 * Extrait ce qu'il y a d'utile a LIRE dans le resultat d'une commande locale. Rien d'exploitable →
 * l'action est ignoree plutot que rendue comme une ligne vide.
 */
export function localActionDetails(actions: readonly ActionLike[]): LocalActionDetail[] {
  const details: LocalActionDetail[] = []
  for (const action of actions) {
    const data = asRecord(action.data)
    if (!data) continue
    const ok = action.ok !== false && data.allowed !== false
    // Un refus explique POURQUOI : c'est l'information la plus utile du lot.
    const reason = typeof data.reason === 'string' ? data.reason : undefined
    const diff = typeof data.diff === 'string' ? data.diff : undefined
    const output = typeof data.output === 'string' ? data.output : undefined
    const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined
    const knowledge = typeof data.knowledge === 'string' ? data.knowledge : undefined
    /**
     * Une vérification qui PASSE n'a rien à raconter : son verdict est « exit 0 », et le reste est
     * la sortie de l'outil — souvent des milliers de lignes de bruit (avertissements git, worktrees
     * préparés) tronquées à leur queue la moins parlante. On ne montre donc la sortie que lorsqu'elle
     * sert : quand ça a ÉCHOUÉ. Constaté en usage : un pavé de 68 000 caractères sous un « exit 0 ».
     */
    const succeeded = ok && exitCode === 0
    const text =
      reason ??
      diff ??
      (output !== undefined || exitCode !== undefined
        ? [
            exitCode !== undefined ? `exit ${exitCode}` : '',
            succeeded ? '' : (output ?? '')
          ]
            .filter(Boolean)
            .join('\n')
        : undefined) ??
      knowledge
    if (!text || !text.trim()) continue
    details.push({ name: action.name, text: text.trim(), ok })
  }
  return details
}
