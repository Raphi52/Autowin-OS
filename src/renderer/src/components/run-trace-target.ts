/**
 * Cible de TRACE d'une action d'orchestration : quel run ouvrir quand l'utilisateur clique sur
 * « 1 action avec erreur » / « 1 action interrompue » dans le fil.
 *
 * Besoin (2026-07-28) : le clic ouvrait le panneau Workflows mais cadrait la LISTE des runs de la
 * conversation — a l'utilisateur de deviner lequel regarder. Il veut atterrir sur LA trace.
 *
 * L'identite est en fait 1:1, verifie dans `commands.ts` : la commande `orchestrate` retourne
 * `{ runId: runPath, runPath }` — l'identifiant remis au chat EST le chemin du RUN.md. (Une premiere
 * analyse le supposait distinct d'un identifiant d'execution : c'etait faux.) Le ciblage peut donc
 * etre EXACT. On garde neanmoins une degradation, car un run peut avoir ete purge ou n'avoir jamais
 * produit de RUN.md :
 *   1. egalite du chemin normalise (le cas normal, deterministe) ;
 *   2. sinon inclusion (tolerance a un prefixe/suffixe de chemin) ;
 *   3. sinon le run le plus RECENT (une erreur qu'on vient de voir vient du dernier run) ;
 *   4. sinon rien → l'appelant garde son comportement actuel (cadrage de la liste).
 * Ainsi le clic ne regresse jamais : au pire il fait ce qu'il faisait deja.
 */

export interface RunLike {
  path: string
  mtime: number
}

/**
 * Extrait la reference de run du resultat d'une action (`data` est de forme libre).
 * `runPath` est prioritaire : c'est le champ EXPLICITE du contrat (`commands.ts`), `runId` en porte
 * aujourd'hui la meme valeur mais son nom n'en garantit pas le sens a l'avenir.
 */
export function runIdFromActionData(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const source = data as { runPath?: unknown; runId?: unknown }
  for (const candidate of [source.runPath, source.runId]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return undefined
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
    // 1. Egalite stricte : le cas normal, puisque la reference remise au chat EST le chemin du run.
    const identical = runs.find((run) => normalize(run.path) === needle)
    if (identical) return identical
    // 2. Inclusion : tolere un chemin tronque ou prefixe differemment. L'inclusion INVERSE (la
    // reference contient le chemin liste) exige un chemin DISCRIMINANT — un path court comme « a »
    // est contenu dans presque n'importe quelle chaine et ouvrirait un run au hasard (faux positif
    // attrape par le cas « runId introuvable »).
    const contained = runs.find((run) => {
      const candidate = normalize(run.path)
      if (candidate.includes(needle)) return true
      return candidate.includes('/') && needle.includes(candidate)
    })
    if (contained) return contained
  }
  // Repli : le plus recent. Le run fautif vient d'etre produit, il est donc en tete par mtime.
  return runs.reduce((latest, run) => (run.mtime > latest.mtime ? run : latest))
}
