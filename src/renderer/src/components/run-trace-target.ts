/**
 * Cible de TRACE d'une action d'orchestration : quel run ouvrir quand l'utilisateur clique sur
 * « 1 action avec erreur » / « 1 action interrompue » dans le fil.
 *
 * Besoin (2026-07-28) : le clic ouvrait le panneau Workflows mais cadrait la LISTE des runs de la
 * conversation — a l'utilisateur de deviner lequel regarder. Il veut atterrir sur LA trace.
 *
 * Difficulte reelle : l'identite n'est pas 1:1. Une action `orchestrate` rend un `runId` d'execution,
 * tandis que les runs listes sont identifies par le `path` de leur RUN.md — et un run d'orchestration
 * peut n'avoir produit aucun RUN.md. On resout donc par degradation successive, JAMAIS en pariant :
 *   1. le run dont le chemin porte le runId (correspondance exacte, le cas sur) ;
 *   2. sinon le run le plus RECENT (une erreur qu'on vient de voir vient du dernier run) ;
 *   3. sinon rien → l'appelant garde son comportement actuel (cadrage de la liste).
 * Ainsi le clic ne regresse jamais : au pire il fait ce qu'il faisait deja.
 */

export interface RunLike {
  path: string
  mtime: number
}

/** Extrait le runId exploitable du resultat d'une action (`data` est de forme libre). */
export function runIdFromActionData(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const candidate = (data as { runId?: unknown }).runId
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined
}

/**
 * Premiere action en ECHEC ou INTERROMPUE d'un groupe : c'est celle dont l'utilisateur veut la trace
 * (il a clique sur « avec erreur » / « interrompue », pas sur les actions reussies).
 */
export function failedActionRunId(
  actions: ReadonlyArray<{ ok?: boolean; interrupted?: boolean; data?: unknown }>
): string | undefined {
  const faulty = actions.find((action) => action.ok === false || action.interrupted)
  return runIdFromActionData(faulty?.data) ?? runIdFromActionData(actions.find((a) => a.data)?.data)
}

/** Normalise pour comparer un runId a un chemin Windows ou POSIX, insensible a la casse. */
function normalize(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}

/**
 * Choisit le run a ouvrir. `undefined` => l'appelant conserve son comportement d'origine.
 */
export function pickRunForTrace<T extends RunLike>(
  runs: readonly T[],
  runId?: string
): T | undefined {
  if (runs.length === 0) return undefined
  if (runId) {
    const needle = normalize(runId)
    const exact = runs.find((run) => normalize(run.path).includes(needle))
    if (exact) return exact
  }
  // Repli : le plus recent. Le run fautif vient d'etre produit, il est donc en tete par mtime.
  return runs.reduce((latest, run) => (run.mtime > latest.mtime ? run : latest))
}
