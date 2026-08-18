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

/** Premier motif de gate lisible, borné : la pastille doit rester une ligne. */
function gateReasonLabel(reasons: unknown): string | undefined {
  const first = (Array.isArray(reasons) ? reasons : [reasons]).find(
    (reason): reason is string => typeof reason === 'string' && reason.trim().length > 0
  )
  if (!first) return undefined
  const text = first.trim().replace(/\s+/gu, ' ')
  return text.length > 90 ? `${text.slice(0, 87)}…` : text
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
  // Certains refus arrivent en CHAÎNE brute, pas en objet (mesuré conv-1178, 14/08 : data =
  // « Lancement bloqué : main et origin/main ont divergé » et la barre restait opaque).
  if (typeof action.data === 'string' && action.data.trim() && action.ok === false) {
    const raison = action.data.trim()
    const short = raison.length > 120 ? raison.slice(0, 117) + '…' : raison
    return { label: `échec : ${short}`, state: 'failed' }
  }
  const data = asRecord(action.data)
  if (!data) return undefined
  const cost = formatExecutionCostCoverage(data)
  const suffix = cost ? ` · ${cost}` : ''
  if (data.gateBlocked === true) {
    // Le MOTIF du blocage vit dans `gateReasons` depuis l'origine et n'était pas affiché : la
    // pastille disait seulement « bloqué par le gate · <coût> », si bien que la mention comptable
    // qui suit se lisait comme la cause. Un correctif d'une ligne a été abandonné pour ce
    // malentendu (voir `dev-sans-watch.test.ts`).
    const reason = gateReasonLabel(data.gateReasons)
    return {
      label: `bloqué par le gate${reason ? ` — ${reason}` : ''}${suffix}`,
      state: 'failed'
    }
  }
  // Une orchestration qui a JETÉ porte sa raison dans `error` (failedOrchestrationOutcome). Sans ce
  // branchement elle tombait sur le générique « livrable refusé » et la CAUSE — la seule chose qui dit
  // à l'utilisateur QUOI/POURQUOI — disparaissait (« 1 action avec erreur » opaque, conv veille 2026-08-14).
  const errorReason =
    typeof data.error === 'string' && data.error.trim() ? data.error.trim() : undefined
  if (errorReason) {
    const short = errorReason.length > 120 ? errorReason.slice(0, 117) + '…' : errorReason
    return { label: `échec : ${short}${suffix}`, state: 'failed' }
  }
  if (data.valid === false) return { label: `livrable refusé${suffix}`, state: 'failed' }
  if (data.reused === true) return { label: `run réutilisé${suffix}`, state: 'refused' }
  const status = typeof data.status === 'string' && data.status ? data.status : 'terminé'
  return { label: `${status}${suffix}`, state: 'ok' }
}

/**
 * Résumé de preuve d'un groupe d'actions. Une vérification en ÉCHEC est prioritaire sur une réussie :
 * c'est elle qu'il faut voir quand un tour en contient plusieurs.
 *
 * Mais un échec REPRIS n'est plus un échec. Défaut vécu (conv-1302, 2026-08-18) : le groupe retenait
 * son premier incident, si bien qu'un tour « orchestration bloquée → relance réussie » s'affichait
 * `échec` alors que l'état terminal était le succès — l'utilisateur relançait une demande déjà
 * satisfaite. On ne compare donc que les états TERMINAUX : pour chaque action, le DERNIER verdict
 * observé remplace les précédents ; la priorité à l'échec s'applique ensuite, sur ces seuls
 * terminaux. Deux actions de nature différente gardent chacune le leur — un `verify` rouge reste
 * visible face à une orchestration verte, ce n'est pas une reprise du même geste.
 */
export function groupOutcomeSummary(actions: readonly ActionLike[]): OutcomeSummary | undefined {
  const terminals = new Map<string, OutcomeSummary>()
  for (const action of actions) {
    const summary = verifyOutcomeSummary(action) ?? orchestrateOutcomeSummary(action)
    if (summary) terminals.set(action.name, summary)
  }
  const summaries = [...terminals.values()]
  return (
    summaries.find((summary) => summary.state === 'failed') ??
    summaries.find((summary) => summary.state === 'refused') ??
    summaries[0]
  )
}
import { formatExecutionCostCoverage } from '../../../shared/orchestration-outcome'
