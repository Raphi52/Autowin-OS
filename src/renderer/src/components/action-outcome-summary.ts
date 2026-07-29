/**
 * RÉSUMÉ DE PREUVE d'une action, affiché directement dans le fil.
 *
 * Constaté sur conv-76 (2026-07-29) : la commande `verify` a été appelée trois fois, et le fil
 * n'affichait que « 1 action terminée verify ». L'exit code — la seule chose qui PROUVE quoi que ce
 * soit — restait invisible. On donne à l'agent le moyen de prouver, puis on cache la preuve.
 *
 * Ce module ne déplie rien : le détail complet reste dans Workflows (choix de design existant). Il
 * extrait la seule ligne qui porte le verdict, pour qu'on la lise sans quitter la conversation.
 */

export interface ActionLike {
  name: string
  ok?: boolean
  data?: unknown
}

export interface OutcomeSummary {
  /** Texte court affiché à côté de l'action (ex. « npm test → exit 0 »). */
  label: string
  /** Verdict pour la coloration : une vérification qui échoue doit se voir. */
  state: 'ok' | 'failed' | 'refused'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

/**
 * Résumé du résultat d'une commande `verify` — la seule action dont le verdict est la valeur.
 * Rend `undefined` si l'action n'est pas une vérification ou n'a pas encore de résultat : l'appelant
 * n'affiche alors rien de plus qu'avant (aucune régression visuelle).
 */
export function verifyOutcomeSummary(action: ActionLike): OutcomeSummary | undefined {
  if (action.name !== 'verify') return undefined
  const data = asRecord(action.data)
  if (!data) return undefined

  // Refus explicite : aucune commande n'a été lancée (projet sans script de test, workspace absent).
  if (data.allowed === false) {
    const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason : 'refusée'
    return { label: `vérification impossible — ${reason}`, state: 'refused' }
  }

  const command = typeof data.command === 'string' && data.command ? data.command : 'vérification'
  const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined
  const ok = data.ok === true

  if (exitCode === undefined) {
    // Lancement impossible : pas d'exit code du tout, mais ce n'est pas un succès pour autant.
    return { label: `${command} → aucun code de sortie`, state: ok ? 'ok' : 'failed' }
  }
  return { label: `${command} → exit ${exitCode}`, state: ok ? 'ok' : 'failed' }
}

/**
 * Résumé d'une ORCHESTRATION : c'est là que part l'essentiel de l'argent (conv-76 : 10,05 $ sur
 * 10,94 $) et le fil n'en montrait rien. On affiche le verdict et le coût, jamais un succès prétendu :
 * un gate bloqué ou un juge qui refuse compte comme un échec de livraison.
 */
export function orchestrateOutcomeSummary(action: ActionLike): OutcomeSummary | undefined {
  if (action.name !== 'orchestrate') return undefined
  const data = asRecord(action.data)
  if (!data) return undefined
  const cost = typeof data.costUsd === 'number' && Number.isFinite(data.costUsd) ? data.costUsd : undefined
  const suffix = cost !== undefined ? ` · ${cost.toFixed(2)} $` : ''
  if (data.gateBlocked === true) return { label: `bloqué par le gate${suffix}`, state: 'failed' }
  if (data.valid === false) return { label: `livrable refusé${suffix}`, state: 'failed' }
  if (data.reused === true) return { label: `run réutilisé${suffix}`, state: 'refused' }
  const status = typeof data.status === 'string' && data.status ? data.status : 'terminé'
  return { label: `${status}${suffix}`, state: 'ok' }
}

/**
 * Premier résumé de preuve d'un groupe d'actions. Une vérification en ÉCHEC est prioritaire sur une
 * réussie : c'est elle qu'il faut voir quand un tour en contient plusieurs.
 */
export function groupOutcomeSummary(
  actions: readonly ActionLike[]
): OutcomeSummary | undefined {
  const summaries = actions
    .map((action) => verifyOutcomeSummary(action) ?? orchestrateOutcomeSummary(action))
    .filter((summary): summary is OutcomeSummary => summary !== undefined)
  return (
    summaries.find((summary) => summary.state === 'failed') ??
    summaries.find((summary) => summary.state === 'refused') ??
    summaries[0]
  )
}
