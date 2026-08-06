/**
 * DIRE POURQUOI un rôle a échoué, au lieu de « aucun modèle n'a produit de sortie ».
 *
 * Constaté le 2026-07-29 : un orchestrate échouait sur
 * « Fan-out scout : aucun modèle n'a produit de sortie (1 échec(s)) ». La cause réelle — le rôle
 * `scout` est bindé sur codex par défaut, et la session OAuth Codex était absente — était pourtant
 * DÉJÀ capturée dans le journal de phase (`error: 'codex non authentifié — …'`), puis jetée en
 * remontant. L'information existait ; elle n'arrivait pas à l'utilisateur. Même patron que le coût
 * jeté et que la carte de livraison jetée.
 *
 * Module PUR : il classe des messages d'erreur et compose un texte. Aucun accès disque ni réseau, donc
 * testable sur les chaînes EXACTES que jettent les adaptateurs.
 */

export type ProviderFailureKind =
  /** Le CLI est là mais personne n'est connecté → une reconnexion suffit. */
  | 'auth'
  /** L'exécutable est introuvable → rien ne peut tourner tant qu'il n'est pas résolu. */
  | 'cli-missing'
  /** Le CLI est mort anormalement (tué, crash, arrêt de session Windows) → relancer a du sens. */
  | 'crashed'
  /** Autre chose (timeout, watchdog, refus du modèle…) : on ne devine pas. */
  | 'other'

/**
 * Codes de sortie Windows (NTSTATUS / DBG_*) rencontrés RÉELLEMENT en production.
 *
 * Incident ak-820d7029b0c5e76d (2026-08-06) : « claude CLI exit 1073807364 » puis « exit 3221226091 ».
 * Un entier décimal de 10 chiffres ne dit rien ; sa forme hexadécimale est un statut système connu.
 * On ne décode QUE les codes observés — inventer une table complète serait du bruit non vérifiable.
 */
const ABNORMAL_EXIT_CODES: Readonly<Record<number, string>> = {
  0x40010004: 'arrêt du process demandé par l’hôte',
  0xc000013a: 'interruption Ctrl-C',
  0xc0000005: 'violation d’accès (crash du CLI)',
  0xc0000409: 'corruption de pile détectée (crash du CLI)',
  0xc000026b: 'échec d’initialisation d’une DLL (arrêt de session Windows)'
}

/**
 * Décrit un code de sortie anormal, ou `undefined` si ce n'est pas un statut système connu (un
 * `exit 1` ordinaire reste un `exit 1` : ne rien prétendre est plus honnête qu'un faux diagnostic).
 */
export function describeExitCode(code: number | null | undefined): string | undefined {
  if (typeof code !== 'number' || !Number.isInteger(code)) return undefined
  const label = ABNORMAL_EXIT_CODES[code >>> 0]
  return label ? `0x${(code >>> 0).toString(16)} ${label}` : undefined
}

export interface ProviderFailure {
  provider: string
  model?: string
  message: string
}

export interface DiagnosedFailure extends ProviderFailure {
  kind: ProviderFailureKind
  /** Geste concret à faire, ou `undefined` si on ne sait pas quoi conseiller honnêtement. */
  hint?: string
}

/**
 * Classe un message d'erreur d'adaptateur. Les motifs viennent des chaînes RÉELLEMENT jetées :
 *  - `codex non authentifié — lance npm run codex:login` (codex.ts)
 *  - `Codex CLI introuvable : …` (codex.ts)
 *  - `spawn claude ENOENT` (Node, quand le binaire n'est pas résolu)
 * Tout le reste reste `other` : inventer un diagnostic serait pire que de rendre le message brut.
 */
export function classifyProviderFailure(message: string): ProviderFailureKind {
  const text = message.toLowerCase()
  if (/non authentifi|unauthorized|401|session (oauth )?(absente|expir)|not logged in/.test(text)) {
    return 'auth'
  }
  if (/enoent|introuvable|not found|command not found/.test(text)) return 'cli-missing'
  // Sortie anormale : soit le message porte déjà le statut hexadécimal, soit le code décimal brut.
  const decimal = /exit (-?\d+)/.exec(text)
  if (decimal && describeExitCode(Number(decimal[1]))) return 'crashed'
  if (/0x(4001|c000)[0-9a-f]{4}/.test(text)) return 'crashed'
  return 'other'
}

/** Geste concret associé à une cause, par provider. `undefined` = on ne conseille rien. */
export function repairHint(provider: string, kind: ProviderFailureKind): string | undefined {
  if (kind === 'auth') {
    if (provider === 'codex') return 'Connecte-toi : bouton « Se connecter » du diagnostic de démarrage.'
    if (provider === 'claude') return 'Reconnecte le CLI : `claude auth login`.'
    if (provider === 'kimi') return 'Reconnecte Kimi depuis la page Routeur.'
    return 'Reconnecte ce provider depuis la page Routeur.'
  }
  if (kind === 'crashed') {
    return `Le CLI ${provider} s’est arrêté anormalement (process tué ou crashé) — relance la phase ; si ça se répète, vérifie la session Windows et les antivirus/quotas mémoire.`
  }
  if (kind === 'cli-missing') {
    return `Le CLI ${provider} n’a pas été trouvé — installe-le, ou désigne-le via ${provider.toUpperCase()}_BIN.`
  }
  return undefined
}

export function diagnoseProviderFailure(failure: ProviderFailure): DiagnosedFailure {
  const kind = classifyProviderFailure(failure.message)
  const hint = repairHint(failure.provider, kind)
  return { ...failure, kind, ...(hint ? { hint } : {}) }
}

/**
 * Message d'échec d'un fan-out qui NOMME le rôle, son provider et la cause.
 *
 * Ne prétend jamais connaître une cause qu'il n'a pas : sans aucune erreur collectée, on retombe sur le
 * décompte, qui reste vrai. Quand TOUTES les causes sont du même type réparable, le geste est donné une
 * seule fois plutôt que répété par membre.
 */
export function describeFanoutFailure(
  phase: string,
  role: string,
  failures: readonly ProviderFailure[]
): string {
  if (failures.length === 0) {
    return `Fan-out ${phase} : aucun modèle n'a produit de sortie`
  }
  const diagnosed = failures.map(diagnoseProviderFailure)
  const head = `Fan-out ${phase} (rôle ${role}) : aucun modèle n'a produit de sortie`
  const lines = diagnosed.map(
    (f) => `• ${f.provider}${f.model ? ` (${f.model})` : ''} : ${f.message}`
  )
  const kinds = new Set(diagnosed.map((f) => f.kind))
  // Un geste commun n'est propose que si TOUTES les causes le partagent — sinon il serait trompeur.
  const commonHint =
    kinds.size === 1 && diagnosed[0].hint !== undefined ? diagnosed[0].hint : undefined
  return [head, ...lines, ...(commonHint ? [`→ ${commonHint}`] : [])].join('\n')
}

/**
 * Message d'echec d'un appel de rôle SIMPLE (hors fan-out). L'erreur brute d'un adaptateur dit
 * souvent la cause (« codex non authentifié — … ») mais jamais QUEL rôle l'a subie, ni sur quel
 * provider ce rôle est bindé — l'information qui manquait le 2026-07-29. On préfixe, on n'écrase pas :
 * le message d'origine reste lisible tel quel.
 */
export function explainRoleFailure(
  /** Ce qui a echoue, DEJA formule par l'appelant (« Phase build », « sous-tache scout », « verdict »).
   *  Ne pas re-prefixer ici : « Phase sous-tache scout » se lisait mal a l'ecran (2026-07-29). */
  label: string,
  role: string,
  failure: ProviderFailure
): string {
  const diagnosed = diagnoseProviderFailure(failure)
  const target = `${failure.provider}${failure.model ? ` (${failure.model})` : ''}`
  const head = `${label} — le rôle ${role} est bindé sur ${target} : ${failure.message}`
  return diagnosed.hint ? `${head}
→ ${diagnosed.hint}` : head
}

/** Marqueurs acceptes comme « ce site porte un contexte de role ». */
const ROLE_CONTEXT_MARKERS = [
  'sendWithRoleContext',
  'explainRoleFailure',
  'describeFanoutFailure',
  'cause: error instanceof'
] as const

/**
 * Lignes des appels de provider qui laissent passer une erreur NUE, dans un source d'orchestrateur.
 *
 * Regle STRUCTURELLE : la gestion d'erreur d'un appel vit AVANT l'appel suivant. Une fenetre de N
 * lignes serait arbitraire — a l'ecriture de cette garde, N=46 manquait la cible de 2 lignes.
 * Expose pour etre TESTABLE sur une source volontairement fautive : une garde qui ne peut pas echouer
 * ne prouve rien.
 */
export function uncoveredSendSites(source: string, callMarker = 'registry.send('): number[] {
  const lines = source.split(/\r?\n/)
  const sites = lines
    .map((line, index) => (line.includes(callMarker) ? index : -1))
    .filter((index) => index >= 0)
  return sites
    .filter((index, rank) => {
      const from = Math.max(0, index - 14)
      const to = rank + 1 < sites.length ? sites[rank + 1] : lines.length
      const block = lines.slice(from, to).join(' ')
      return !ROLE_CONTEXT_MARKERS.some((marker) => block.includes(marker))
    })
    .map((index) => index + 1)
}
