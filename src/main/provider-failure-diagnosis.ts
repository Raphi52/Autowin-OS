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
  /**
   * Le superviseur a REFUSÉ l'appel à l'admission : le budget du run était déjà épuisé.
   * Le provider n'a rien vu, le rôle refusé n'a rien consommé — la dépense vient d'avant.
   */
  | 'budget'
  /**
   * L'appel a été INTERROMPU (signal d'abort) : arrêt utilisateur, second lancement sur la même
   * conversation, ou filet de crash global. Le provider n'est pas en panne et son binding n'est pas
   * en cause — les nommer envoyait chercher le défaut du mauvais côté (constaté le 2026-08-18 :
   * « le rôle subagent est bindé sur codex (gpt-5.6-sol) : codex exec annulé » a été lu comme une
   * panne de codex alors que rien n'avait échoué, l'appel avait été coupé).
   */
  | 'cancelled'
  /** Autre chose (timeout, watchdog, refus du modèle…) : on ne devine pas. */
  | 'other'

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
  // Testé AVANT `cli-missing` : « Budget d'appels provider atteint » contient « atteint », et un
  // futur libellé de budget pourrait contenir un mot de la famille « introuvable ».
  if (
    /^budget /.test(text) ||
    /budget (tokens|usd|duree|durée|d'appels|d’appels|de concurrence|d'agents|d’agents)/.test(text)
  ) {
    return 'budget'
  }
  if (/non authentifi|unauthorized|401|session (oauth )?(absente|expir)|not logged in/.test(text)) {
    return 'auth'
  }
  if (/enoent|introuvable|not found|command not found/.test(text)) return 'cli-missing'
  // Chaînes RÉELLEMENT jetées sur abort : `codex exec annulé` (codex.ts:462),
  // `claude CLI annulé` (claude.ts), `This operation was aborted` (Node/undici).
  // Testé APRÈS auth/cli-missing : un « annulé » n'y apparaît pas, l'ordre reste sans ambiguïté.
  // Depuis le 2026-08-18 la RAISON de l'abort remonte (`providers/abort-diagnostic.ts`) : les
  // libelles portent « interrompu : <raison> ». Les anciens (« codex exec annule », …) restent
  // reconnus, ils vivent dans les traces et les runs persistes d'avant.
  //
  // Teste APRES `budget` A DESSEIN : un arret impose par le devis porte desormais
  // « interrompu : budget duree depasse (…) » et se classe `budget`, pas `cancelled` — la cause
  // est le plafond, l'interruption n'en est que le moyen. C'est ce que l'ancien message
  // generique rendait indistinguable.
  if (/interrompu|annul[ée]|operation was aborted|\baborted\b|aborterror/.test(text))
    return 'cancelled'
  return 'other'
}

/** Geste concret associé à une cause, par provider. `undefined` = on ne conseille rien. */
export function repairHint(provider: string, kind: ProviderFailureKind): string | undefined {
  if (kind === 'auth') {
    if (provider === 'codex')
      return 'Connecte-toi : bouton « Se connecter » du diagnostic de démarrage.'
    if (provider === 'claude') return 'Reconnecte le CLI : `claude auth login`.'
    if (provider === 'kimi') return 'Reconnecte Kimi depuis la page Routeur.'
    return 'Reconnecte ce provider depuis la page Routeur.'
  }
  if (kind === 'cli-missing') {
    return `Le CLI ${provider} n’a pas été trouvé — installe-le, ou désigne-le via ${provider.toUpperCase()}_BIN.`
  }
  if (kind === 'cancelled') {
    return (
      "Rien à réparer côté provider : l'appel a été coupé. Relance la phase — et vérifie qu'un " +
      "second lancement sur la même conversation n'a pas interrompu le premier."
    )
  }
  if (kind === 'budget') {
    return (
      'Relève le devis du run (Settings › Budget) ou réduis le périmètre : ' +
      'le plafond a été atteint avant cet appel.'
    )
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
  failure: ProviderFailure,
  /**
   * Provider sur lequel ce rôle est RÉELLEMENT bindé dans la configuration COURANTE, quand
   * l'appelant le connaît. `failure.provider` est celui qui a servi à l'appel — les deux DIVERGENT
   * dès qu'un repli entre en jeu (`bindingDeRepliPourPhase` lit un INSTANTANÉ de rôles pris au
   * démarrage du run, pas la config actuelle). Sans ce paramètre, le message affirmait un binding en
   * lisant une panne : un utilisateur a cherché un binding `subagent → codex` dans Agent Studio,
   * où il n'existait pas — sa configuration était intégralement claude, et le codex venait de
   * l'instantané. Généralise la leçon déjà tirée pour le budget juste en dessous.
   */
  boundTo?: string
): string {
  const diagnosed = diagnoseProviderFailure(failure)
  const target = `${failure.provider}${failure.model ? ` (${failure.model})` : ''}`
  const divergent = boundTo !== undefined && boundTo !== failure.provider
  // Un budget épuisé n'est pas une panne du provider sur lequel le rôle est bindé : l'appel a été
  // refusé À L'ADMISSION, le provider ne l'a jamais vu (mesuré : durationMs 0.698 sur conv-1102).
  // Nommer le binding désignait un innocent et envoyait chercher la panne du mauvais côté.
  // Une ANNULATION n'est pas une panne : ni le provider ni son binding n'ont fauté, l'appel a été
  // coupé de l'extérieur. Les nommer ici produisait un message MENTEUR — « le rôle subagent est
  // bindé sur codex (gpt-5.6-sol) : codex exec annulé » se lit comme un défaut de codex ou du
  // réglage, et envoie fouiller Agent Studio pour un incident qui n'a jamais eu lieu (2026-08-18).
  // Même leçon que le budget juste en dessous : ne désigne pas un innocent.
  const head =
    diagnosed.kind === 'cancelled'
      ? `${label} — appel du rôle ${role} INTERROMPU avant sa fin : ${failure.message}. ` +
        `Ce n'est pas une panne : ni ${failure.provider} ni le binding du rôle ne sont en cause.`
      : diagnosed.kind === 'budget'
        ? `${label} — appel du rôle ${role} refusé : ${failure.message}. ` +
          `Ce rôle n'a rien consommé ; le budget avait déjà été consommé par les phases précédentes.`
        : divergent
          ? `${label} — appel du rôle ${role} parti sur ${target} : ${failure.message}. ` +
            `Ce rôle est bindé sur ${boundTo} dans la configuration courante — ` +
            `l'appel a donc suivi un repli, ne cherchez pas ${failure.provider} dans Agent Studio.`
          : `${label} — le rôle ${role} est bindé sur ${target} : ${failure.message}`
  return diagnosed.hint
    ? `${head}
→ ${diagnosed.hint}`
    : head
}
