import type { TaskStore } from './task-store'
import type { ScheduledTask, ScheduledTaskInput } from './types'
import { AGENT_STUDIO_DEFAULT_PROVIDER } from '../../shared/task-provider'

/**
 * Les regles livrees d'origine.
 *
 * Un semis est une VRAIE tache : elle apparait dans le Task Manager, s'edite, se desactive et se
 * supprime comme n'importe quelle autre. C'est la difference entre « le systeme sait faire ca » et
 * « je vois ce que fait mon systeme et je peux le changer ». Un comportement autonome invisible dans
 * l'interface est un comportement que personne ne peut ni regler ni arreter.
 *
 * Chaque semis est pose UNE FOIS et sa pose est memorisee (`TaskStore.hasSeed`). Supprimer la tache
 * la supprime pour de bon : sans cette memoire, elle renaitrait au demarrage suivant et ne serait
 * plus la tache de l'utilisateur mais une tache imposee.
 */

export const AUTO_KAIZEN_SEED_ID = 'auto-kaizen-v1'

/**
 * L'auto-kaizen en tant que Watchdog Agent.
 *
 * Ce que la regle remplace : `auto-kaizen-supervisor.ts` observait les memes incidents mais depuis
 * un module a part, invisible dans l'interface et non reglable. Le premier semis Watchdog lancait
 * une seconde orchestration complete apres chaque rouge. Le dogfood Tickets a mesure le probleme :
 * un build Opus a 3,15 $ a ete suivi d'un autre worktree automatique alors que le premier diff
 * n'etait ni publie ni visible depuis la copie du reparateur.
 *
 * Le reveil fait donc seulement le TRIAGE : un tour en lecture seule, visible dans le Task Manager,
 * avec le modele orchestrateur courant d'Agent Studio. Une correction devient une recommandation
 * explicite ; elle ne part jamais en chantier autonome sur la seule foi d'un evenement terminal.
 */
export function previousOrchestrationAutoKaizenSeed(): ScheduledTaskInput {
  return {
    title: 'Auto-kaizen — orchestration rouge ou workflow douteux',
    prompt: [
      '/build Auto-kaizen borne : traite cet incident sans relancer un chantier complet.',
      'Budget operationnel : une phase build, une verification, aucun fan-out volontaire.',
      '',
      'Un workflow vient de mal se terminer — soit en echec, soit en annoncant un succes que rien',
      "n'etaye. Etablis ce qui s'est reellement passe avant de conclure.",
      '',
      '1. Lis le RUN.md cite dans le contexte : son besoin, ses decisions, son journal.',
      '2. Cherche la cause RACINE, pas le symptome le plus visible. Un echec en fin de chaine vient',
      "   souvent d'une decision prise bien plus tot.",
      "3. Si le workflow s'est dit REUSSI sans preuve, la question n'est pas « qu'est-ce qui a",
      "   casse » mais « est-ce reellement fait ? ». Cherche la preuve manquante ; si elle n'existe",
      "   pas, dis-le : un faux vert coute plus cher qu'un rouge.",
      '4. Si la cause est claire ET la correction bornee, corrige-la et prouve-le par un signal',
      '   hors-modele (test rouge->vert, code de sortie, requete). Sans preuve, ne dis pas que',
      "   c'est repare.",
      "5. Si la cause n'est pas etablie, ne repare rien : rapporte ce que tu as ecarte et ce qui",
      '   reste a verifier. Une reparation sur une cause supposee cree le defaut suivant.'
    ].join('\n'),
    enabled: true,
    mode: 'active-only',
    destination: {
      kind: 'new',
      title: 'Auto-kaizen',
      category: 'Qualite',
      provider: 'claude'
    },
    watchdog: {
      source: {
        kind: 'app-event',
        // Les quatre formes de defaillance de workflow REELLEMENT detectees aujourd'hui. La plus
        // importante est `workflow-unverified` : un workflow qui se dit reussi SANS preuve de
        // validation ne leve aucune alerte, ne casse aucun test, et personne ne va le relire.
        // Un rouge se voit ; un faux vert, non.
        events: [
          'orchestration-red',
          'workflow-gate-failed',
          'workflow-unverified',
          'workflow-proof-lost'
        ]
      },
      action: 'orchestration',
      guards: {
        // Un incident reste actionnable dans son fil : 30 min de silence empêchent les variantes
        // de texte d'un même run de repayer une analyse pendant que l'utilisateur travaille.
        dedupWindowMs: 1_800_000,
        // Un seul chantier automatique par heure. Les autres rouges restent visibles, mais ne
        // peuvent plus cumuler jusqu'à 6 $/h avec le plafond global de 3 $ par orchestration.
        maxTriggersPerHour: 1,
        // Un kaizen ne declenche pas un kaizen. C'est le reglage qui empeche la boucle : l'agent
        // corrige, sa correction relance une orchestration, qui pourrait echouer a son tour.
        maxChainDepth: 0,
        // Une panne unique fait echouer des dizaines d'orchestrations. La largeur les rattache a la
        // meme cause au lieu de lancer un agent pour chacune.
        maxPerRoot: 1
      }
    }
  }
}

export function autoKaizenSeed(): ScheduledTaskInput {
  const previous = previousOrchestrationAutoKaizenSeed()
  return {
    ...previous,
    prompt: [
      'Auto-kaizen LECTURE SEULE : trie cet incident en un seul diagnostic borne.',
      'Ne lance aucune orchestration. Ne modifie aucun fichier et ne cree aucun worktree.',
      '',
      'Un workflow vient de mal se terminer — soit en echec, soit en annoncant un succes que rien',
      "n'etaye. Etablis ce qui s'est reellement passe avant de conclure.",
      '',
      '1. Lis le RUN cite dans le contexte s’il est accessible et cherche la cause RACINE.',
      '2. Cherche la preuve hors-modele deja disponible ; ne relance ni test ni workflow couteux.',
      "3. S'il se dit REUSSI, demande-toi : est-ce reellement fait ? Sans preuve, c'est un faux vert.",
      '4. Si une correction est justifiee, decris la correction bornee et son oracle, sans',
      '   l’appliquer. Sans cause etablie, ne repare rien : rapporte ce qui reste a verifier.',
      '5. Termine par le tri ISSUE demande. `repair` est interdit ici puisqu’aucune mutation',
      '   automatique n’est autorisee ; utilise `investigate` ou `report` pour une suite.'
    ].join('\n'),
    destination:
      previous.destination.kind === 'new'
        ? {
            ...previous.destination,
            provider: AGENT_STUDIO_DEFAULT_PROVIDER
          }
        : previous.destination,
    watchdog: previous.watchdog
      ? {
          ...previous.watchdog,
          action: 'chat',
          guards: {
            ...previous.watchdog.guards,
            // Deuxième horizon : le plafond horaire ne suffit pas à empêcher une consommation
            // lente mais continue sur une journée entière.
            maxTriggersPerDay: 4,
            // Coupe-circuit mesuré sur le coût REEL remonté par le provider. Si le tarif manque,
            // le budget séparé ci-dessous bloque après un appel au lieu de compter 0 $.
            maxKnownCostUsdPerDay: 0.25,
            maxUnpricedCallsPerDay: 1
          }
        }
      : undefined
  }
}

/** Empreinte exacte du premier triage Haiku livré avant les budgets quotidiens. */
const PRIOR_READ_ONLY_AUTO_KAIZEN_PROMPT = [
  'Auto-kaizen LECTURE SEULE : trie cet incident en un seul diagnostic borne.',
  'Ne lance aucune orchestration. Ne modifie aucun fichier et ne cree aucun worktree.',
  '',
  'Un workflow vient de mal se terminer — soit en echec, soit en annoncant un succes que rien',
  "n'etaye. Etablis ce qui s'est reellement passe avant de conclure.",
  '',
  '1. Lis le RUN cite dans le contexte s’il est accessible et distingue la cause du symptome.',
  '2. Cherche la preuve terminale deja disponible ; ne relance ni test ni workflow couteux.',
  "3. Si le workflow s'est dit REUSSI sans preuve, dis explicitement quelle preuve manque.",
  '4. Si une correction est justifiee, decris la correction bornee et son oracle, sans',
  '   l’appliquer. Sans cause etablie, rapporte seulement ce qui reste a verifier.',
  '5. Termine par le tri ISSUE demande. `repair` est interdit ici puisqu’aucune mutation',
  '   automatique n’est autorisee ; utilise `investigate` ou `report` pour une suite.'
].join('\n')

const LEGACY_AUTO_KAIZEN_TITLE = 'Auto-kaizen — une orchestration rouge'
const LEGACY_AUTO_KAIZEN_PROMPT = [
  "Une orchestration vient d'echouer. Etablis ce qui s'est reellement passe avant de conclure.",
  '',
  '1. Lis le RUN.md cite dans le contexte : son besoin, ses decisions, son journal.',
  '2. Cherche la cause RACINE, pas le symptome le plus visible. Un echec en fin de chaine vient',
  "   souvent d'une decision prise bien plus tot.",
  '3. Si la cause est claire ET la correction bornee, corrige-la et prouve-le par un signal',
  '   hors-modele (test rouge->vert, code de sortie, requete). Sans preuve, ne dis pas que',
  "   c'est repare.",
  "4. Si la cause n'est pas etablie, ne repare rien : rapporte ce que tu as ecarte et ce qui",
  '   reste a verifier. Une reparation sur une cause supposee cree le defaut suivant.'
].join('\n')

type NewTaskDestination = Extract<ScheduledTaskInput['destination'], { kind: 'new' }>

/** La conversation dediee est une donnee runtime ; tout autre ecart est une edition utilisateur. */
function hasExactSeedDestination(task: ScheduledTask, expected: NewTaskDestination): boolean {
  return (
    task.destination.kind === 'new' &&
    task.destination.title === expected.title &&
    task.destination.category === expected.category &&
    task.destination.provider === expected.provider &&
    task.destination.model === expected.model &&
    task.destination.reasoningEffort === expected.reasoningEffort
  )
}

/** Les versions historiques ne portaient aucun budget quotidien : leur présence est une édition. */
function hasNoCustomizedDailyGuard(task: ScheduledTask): boolean {
  const guards = task.watchdog?.guards
  return (
    guards !== undefined &&
    guards.maxTriggersPerDay === undefined &&
    guards.maxKnownCostUsdPerDay === undefined &&
    guards.maxUnpricedCallsPerDay === undefined
  )
}

function isUntouchedLegacyAutoKaizen(task: ScheduledTask): boolean {
  return (
    task.title === LEGACY_AUTO_KAIZEN_TITLE &&
    task.prompt === LEGACY_AUTO_KAIZEN_PROMPT &&
    hasExactSeedDestination(task, {
      kind: 'new',
      title: 'Auto-kaizen',
      category: 'Qualite',
      provider: 'claude'
    }) &&
    task.watchdog?.action === 'orchestration' &&
    task.watchdog.source.kind === 'app-event' &&
    task.watchdog.source.events.length === 1 &&
    task.watchdog.source.events[0] === 'orchestration-red' &&
    task.watchdog.guards.dedupWindowMs === 300_000 &&
    task.watchdog.guards.maxTriggersPerHour === 4 &&
    task.watchdog.guards.maxChainDepth === 0 &&
    task.watchdog.guards.maxPerRoot === 3 &&
    hasNoCustomizedDailyGuard(task)
  )
}

/**
 * Version livrée brièvement avec le mot naturel `build`. `regimePhases` le comprenait, mais le
 * workflow explicite de la conversation ne s'efface que devant une vraie commande `/build` : le
 * dogfood Tickets a donc rejoué scout. Cette empreinte exacte migre le semis, jamais une variante
 * personnalisée.
 */
function isUntouchedBareBuildAutoKaizen(task: ScheduledTask): boolean {
  const current = previousOrchestrationAutoKaizenSeed()
  const destination = current.destination
  const watchdog = current.watchdog
  const taskWatchdog = task.watchdog
  const taskSource = taskWatchdog?.source
  return (
    destination.kind === 'new' &&
    watchdog?.source.kind === 'app-event' &&
    task.title === current.title &&
    task.prompt === current.prompt.replace(/^\/build /, 'build ') &&
    hasExactSeedDestination(task, destination) &&
    taskWatchdog !== undefined &&
    taskWatchdog.action === watchdog.action &&
    taskSource?.kind === 'app-event' &&
    JSON.stringify(taskSource.events) === JSON.stringify(watchdog.source.events) &&
    taskWatchdog.guards.dedupWindowMs === watchdog.guards.dedupWindowMs &&
    taskWatchdog.guards.maxTriggersPerHour === watchdog.guards.maxTriggersPerHour &&
    taskWatchdog.guards.maxChainDepth === watchdog.guards.maxChainDepth &&
    taskWatchdog.guards.maxPerRoot === watchdog.guards.maxPerRoot &&
    hasNoCustomizedDailyGuard(task)
  )
}

/** Version `/build` précédente : 5 min et deux runs/h, durcie après mesure du coût dogfood. */
function isUntouchedPriorBoundedAutoKaizen(task: ScheduledTask): boolean {
  const current = previousOrchestrationAutoKaizenSeed()
  const destination = current.destination
  const watchdog = current.watchdog
  const source = task.watchdog?.source
  return (
    destination.kind === 'new' &&
    watchdog?.source.kind === 'app-event' &&
    task.title === current.title &&
    task.prompt === current.prompt &&
    hasExactSeedDestination(task, destination) &&
    task.watchdog?.action === watchdog.action &&
    source?.kind === 'app-event' &&
    JSON.stringify(source.events) === JSON.stringify(watchdog.source.events) &&
    task.watchdog?.guards.dedupWindowMs === 300_000 &&
    task.watchdog?.guards.maxTriggersPerHour === 2 &&
    task.watchdog?.guards.maxChainDepth === 0 &&
    task.watchdog?.guards.maxPerRoot === 1 &&
    hasNoCustomizedDailyGuard(task)
  )
}

/** Version mesuree en dogfood : une orchestration Opus complete a chaque rouge. */
function isUntouchedOrchestrationAutoKaizen(task: ScheduledTask): boolean {
  const previous = previousOrchestrationAutoKaizenSeed()
  const destination = previous.destination
  const watchdog = previous.watchdog
  const source = task.watchdog?.source
  return (
    destination.kind === 'new' &&
    watchdog?.source.kind === 'app-event' &&
    task.title === previous.title &&
    task.prompt === previous.prompt &&
    hasExactSeedDestination(task, destination) &&
    task.watchdog?.action === 'orchestration' &&
    source?.kind === 'app-event' &&
    JSON.stringify(source.events) === JSON.stringify(watchdog.source.events) &&
    task.watchdog.guards.dedupWindowMs === watchdog.guards.dedupWindowMs &&
    task.watchdog.guards.maxTriggersPerHour === watchdog.guards.maxTriggersPerHour &&
    task.watchdog.guards.maxChainDepth === watchdog.guards.maxChainDepth &&
    task.watchdog.guards.maxPerRoot === watchdog.guards.maxPerRoot &&
    hasNoCustomizedDailyGuard(task)
  )
}

function isUntouchedPriorReadOnlyAutoKaizen(task: ScheduledTask): boolean {
  const current = autoKaizenSeed()
  const source = task.watchdog?.source
  return (
    task.title === current.title &&
    task.prompt === PRIOR_READ_ONLY_AUTO_KAIZEN_PROMPT &&
    hasExactSeedDestination(task, {
      kind: 'new',
      title: 'Auto-kaizen',
      category: 'Qualite',
      provider: 'claude',
      model: 'haiku',
      reasoningEffort: 'low'
    }) &&
    task.watchdog?.action === 'chat' &&
    source?.kind === 'app-event' &&
    JSON.stringify(source.events) ===
      JSON.stringify([
        'orchestration-red',
        'workflow-gate-failed',
        'workflow-unverified',
        'workflow-proof-lost'
      ]) &&
    task.watchdog.guards.dedupWindowMs === 1_800_000 &&
    task.watchdog.guards.maxTriggersPerHour === 1 &&
    task.watchdog.guards.maxTriggersPerDay === undefined &&
    task.watchdog.guards.maxKnownCostUsdPerDay === undefined &&
    task.watchdog.guards.maxUnpricedCallsPerDay === undefined &&
    task.watchdog.guards.maxChainDepth === 0 &&
    task.watchdog.guards.maxPerRoot === 1
  )
}

/** Migre uniquement le semis historique INTACT ; une regle editee par l'utilisateur reste sienne. */
function isUntouchedClaudeReadOnlyAutoKaizen(task: ScheduledTask): boolean {
  const current = autoKaizenSeed()
  if (current.destination.kind !== 'new' || current.watchdog?.source.kind !== 'app-event') return false
  const source = task.watchdog?.source
  return (
    task.title === current.title &&
    task.prompt === current.prompt &&
    hasExactSeedDestination(task, {
      kind: 'new',
      title: current.destination.title,
      category: current.destination.category,
      provider: 'claude',
      model: 'haiku',
      reasoningEffort: 'low'
    }) &&
    task.watchdog?.action === current.watchdog.action &&
    source?.kind === 'app-event' &&
    JSON.stringify(source.events) === JSON.stringify(current.watchdog.source.events) &&
    JSON.stringify(task.watchdog?.guards) === JSON.stringify(current.watchdog.guards)
  )
}

function upgradeLegacyAutoKaizen(store: TaskStore): void {
  for (const task of store.listTasks()) {
    if (
      (!isUntouchedLegacyAutoKaizen(task) &&
        !isUntouchedBareBuildAutoKaizen(task) &&
        !isUntouchedPriorBoundedAutoKaizen(task) &&
        !isUntouchedOrchestrationAutoKaizen(task) &&
        !isUntouchedPriorReadOnlyAutoKaizen(task) &&
        !isUntouchedClaudeReadOnlyAutoKaizen(task)) ||
      task.destination.kind !== 'new'
    )
      continue
    const next = autoKaizenSeed()
    if (next.destination.kind !== 'new') continue
    const conversationId = task.destination.conversationId
    store.update(task.id, {
      ...next,
      enabled: task.enabled,
      mode: task.mode,
      destination: {
        ...next.destination,
        ...(conversationId === undefined ? {} : { conversationId })
      }
    })
  }
}

const SEEDS: { id: string; build: () => ScheduledTaskInput }[] = [
  { id: AUTO_KAIZEN_SEED_ID, build: autoKaizenSeed }
]

/**
 * Pose les regles d'origine absentes. Rend les identifiants des taches creees — vide au deuxieme
 * demarrage, et vide aussi apres une suppression par l'utilisateur.
 */
export function seedWatchdogTasks(store: TaskStore): string[] {
  upgradeLegacyAutoKaizen(store)
  const created: string[] = []
  for (const seed of SEEDS) {
    if (store.hasSeed(seed.id)) continue
    try {
      created.push(store.create(seed.build()).id)
    } finally {
      // Marque meme en cas d'echec : un semis qui echoue ne doit pas etre retente a chaque
      // demarrage, sinon une erreur silencieuse se rejoue indefiniment.
      store.markSeeded(seed.id)
    }
  }
  return created
}
