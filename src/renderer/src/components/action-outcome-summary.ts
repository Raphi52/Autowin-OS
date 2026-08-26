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
  /**
   * Le POURQUOI intégral, pour le dépliage au clic — jamais tronqué, tous les motifs.
   *
   * La pastille est bornée à une ligne : elle coupe à 120 caractères et ne montre que le PREMIER
   * motif de gate. Sur conv-1334, le second motif — la DoD non tenue, qui dit ce qu'il aurait fallu
   * produire — n'était affiché NULLE PART. Le texte court reste le résumé ; ceci est la source.
   */
  why?: string[]
}

/** TOUS les motifs de gate, intégraux : matière du dépliage, pas de la pastille. */
function gateReasonLines(reasons: unknown): string[] {
  return (Array.isArray(reasons) ? reasons : [reasons])
    .filter((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0)
    .map((reason) => reason.trim())
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

const SAUT_DE_LIGNE = /\r?\n/u

/** Sortie d'une commande, bornee : de quoi comprendre l'echec sans deverser un log entier. */
function outputLines(data: Record<string, unknown>): string[] {
  const lignes: string[] = []
  for (const cle of ['stderr', 'stdout', 'output'] as const) {
    const brut = data[cle]
    if (typeof brut !== 'string' || !brut.trim()) continue
    const queue = brut.trim().split(SAUT_DE_LIGNE).slice(-12).join('\n')
    lignes.push(queue)
  }
  return lignes
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
    return { label: `vérification impossible — ${reason}`, state: 'refused', why: [reason.trim()] }
  }

  const command = typeof data.command === 'string' && data.command ? data.command : 'vérification'
  const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined
  const ok = data.ok === true

  if (exitCode === undefined) {
    // Lancement impossible : pas d'exit code du tout, mais ce n'est pas un succès pour autant.
    return {
      label: `${command} → aucun code de sortie`,
      state: ok ? 'ok' : 'failed',
      ...(ok ? {} : { why: [`${command} n'a produit aucun code de sortie`] })
    }
  }
  return {
    label: `${command} → exit ${exitCode}`,
    state: ok ? 'ok' : 'failed',
    ...(ok
      ? {}
      : {
          // Le POURQUOI d'une verification, c'est sa SORTIE — repeter le libelle ne deplierait rien.
          why: [`${command} → exit ${exitCode}`, ...outputLines(data)]
        })
  }
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
    return { label: `échec : ${short}`, state: 'failed', why: [raison] }
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
    const motifs = gateReasonLines(data.gateReasons)
    return {
      label: `arrêté au contrôle final${reason ? ` — ${reason}` : ''}${suffix}`,
      state: 'failed',
      ...(motifs.length ? { why: motifs } : {})
    }
  }
  // Une orchestration qui a JETÉ porte sa raison dans `error` (failedOrchestrationOutcome). Sans ce
  // branchement elle tombait sur le générique « livrable refusé » et la CAUSE — la seule chose qui dit
  // à l'utilisateur QUOI/POURQUOI — disparaissait (« 1 action avec erreur » opaque, conv veille 2026-08-14).
  const errorReason =
    typeof data.error === 'string' && data.error.trim() ? data.error.trim() : undefined
  if (errorReason) {
    const short = errorReason.length > 120 ? errorReason.slice(0, 117) + '…' : errorReason
    return { label: `échec : ${short}${suffix}`, state: 'failed', why: [errorReason] }
  }
  if (data.valid === false)
    return { label: `résultat refusé par le juge${suffix}`, state: 'failed' }
  if (data.reused === true) return { label: `run réutilisé${suffix}`, state: 'refused' }
  const status = typeof data.status === 'string' && data.status ? data.status : 'terminé'
  return { label: `${status}${suffix}`, state: 'ok' }
}

/**
 * Les issues d'orchestration du fil, dans l'ordre — matiere premiere de la friction sur echecs
 * repetes (`shared/friction-echecs-repetes.ts`).
 *
 * Lecture DUCK-TYPEE volontairement : ce module n'a pas a dependre des types de la vue, et les
 * messages relus du disque n'ont de toute facon aucune garantie de forme. Ce qui n'est pas une
 * action `orchestrate` porteuse d'un objet est ignore, sans jamais jeter.
 */
export function orchestrationOutcomesFromMessages(
  messages: readonly unknown[]
): Array<Record<string, unknown>> {
  const outcomes: Array<Record<string, unknown>> = []
  for (const message of messages) {
    const parts = asRecord(message)?.parts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      const record = asRecord(part)
      if (record?.kind !== 'action' || record.name !== 'orchestrate') continue
      const data = asRecord(record.data)
      if (data) outcomes.push(data)
    }
  }
  return outcomes
}

/**
 * Premier résumé de preuve d'un groupe d'actions. Une vérification en ÉCHEC est prioritaire sur une
 * réussie : c'est elle qu'il faut voir quand un tour en contient plusieurs.
 *
 * TENTÉ ET RETIRÉ le 2026-08-18 : faire primer l'état TERMINAL en dédupliquant par nom d'action,
 * pour qu'un échec repris ne reste pas le verdict du groupe. Un juge adversarial l'a réfuté par
 * exécution — deux actions de MÊME NOM ne sont pas une reprise du même geste. Sur conv-76, cité en
 * tête de ce module, `verify` a tourné TROIS fois dans un seul groupe : `[typecheck exit 1,
 * npm test exit 0]` affichait alors `exit 0` et l'échec disparaissait. Perdre un échec réel est
 * pire que réafficher un échec déjà repris, et rien dans les données (ni `actionId`, ni la
 * commande) ne distingue une reprise d'une action indépendante. La règle d'origine est donc
 * restaurée telle quelle, et le cas de conv-76 est désormais gardé par un test.
 */
/**
 * UN DEPOT BRAIN REFUSE, dit comme tel.
 *
 * Defaut vu par l'utilisateur le 2026-08-26 : l'en-tete affichait « 1 action terminee · remember »
 * AU-DESSUS de l'erreur rouge. La cause etait un trou de couverture — ce module ne connaissait que
 * `verify` et `orchestrate`, donc un `remember` refuse ne produisait AUCUN resume et l'en-tete
 * retombait sur son defaut. Or `failed` s'y calcule sur `action.ok === false` : un depot refuse est
 * une commande qui a parfaitement REUSSI a rendre un refus. Techniquement terminee, faux au seul
 * sens qui compte pour le lecteur.
 *
 * Le mot « terminee » pose au-dessus d'un refus est ce qui rend le faux vert credible : c'est
 * l'erreur commise sur conv-1086, ou l'agent a annonce un depot qui n'avait pas eu lieu. L'interface
 * la repetait au lieu de la contredire.
 */
function rememberOutcomeSummary(action: ActionLike): OutcomeSummary | undefined {
  if (action.name !== 'remember') return undefined
  const data = action.data as { allowed?: unknown; reason?: unknown } | undefined
  if (!data || data.allowed !== false) return undefined
  const motif = typeof data.reason === 'string' ? data.reason.trim() : ''
  return {
    label: motif ? `rien retenu — ${motif}` : 'rien retenu — depot refuse',
    state: 'refused',
    ...(motif ? { why: [motif] } : {})
  }
}

export function groupOutcomeSummary(actions: readonly ActionLike[]): OutcomeSummary | undefined {
  const summaries = actions
    .map(
      (action) =>
        verifyOutcomeSummary(action) ??
        orchestrateOutcomeSummary(action) ??
        rememberOutcomeSummary(action)
    )
    .filter((summary): summary is OutcomeSummary => summary !== undefined)
  return (
    summaries.find((summary) => summary.state === 'failed') ??
    summaries.find((summary) => summary.state === 'refused') ??
    summaries[0]
  )
}
import { formatExecutionCostCoverage } from '../../../shared/orchestration-outcome'
