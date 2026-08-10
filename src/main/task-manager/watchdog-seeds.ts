import type { TaskStore } from './task-store'
import type { ScheduledTask, ScheduledTaskInput } from './types'

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
 * un module a part, invisible dans l'interface et non reglable. Ici le declencheur est le meme que
 * pour toute autre regle, et son ACTION est l'orchestration — donc l'analyse, le correctif et la
 * VERIFICATION (gate a preuve + juge) viennent du pipeline au lieu d'etre redeveloppees.
 *
 * Une regle qui se declenche seule peut agir directement ; ses effets restent observables et bornes
 * par les gates de preuve et les gardes du pipeline.
 */
export function autoKaizenSeed(): ScheduledTaskInput {
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

function isUntouchedLegacyAutoKaizen(task: ScheduledTask): boolean {
  return (
    task.title === LEGACY_AUTO_KAIZEN_TITLE &&
    task.prompt === LEGACY_AUTO_KAIZEN_PROMPT &&
    task.destination.kind === 'new' &&
    task.destination.title === 'Auto-kaizen' &&
    task.watchdog?.action === 'orchestration' &&
    task.watchdog.source.kind === 'app-event' &&
    task.watchdog.source.events.length === 1 &&
    task.watchdog.source.events[0] === 'orchestration-red' &&
    task.watchdog.guards.dedupWindowMs === 300_000 &&
    task.watchdog.guards.maxTriggersPerHour === 4 &&
    task.watchdog.guards.maxChainDepth === 0 &&
    task.watchdog.guards.maxPerRoot === 3
  )
}

/**
 * Version livrée brièvement avec le mot naturel `build`. `regimePhases` le comprenait, mais le
 * workflow explicite de la conversation ne s'efface que devant une vraie commande `/build` : le
 * dogfood Tickets a donc rejoué scout. Cette empreinte exacte migre le semis, jamais une variante
 * personnalisée.
 */
function isUntouchedBareBuildAutoKaizen(task: ScheduledTask): boolean {
  const current = autoKaizenSeed()
  const destination = current.destination
  const watchdog = current.watchdog
  const taskWatchdog = task.watchdog
  const taskSource = taskWatchdog?.source
  return (
    destination.kind === 'new' &&
    watchdog?.source.kind === 'app-event' &&
    task.title === current.title &&
    task.prompt === current.prompt.replace(/^\/build /, 'build ') &&
    task.destination.kind === 'new' &&
    task.destination.title === destination.title &&
    task.destination.category === destination.category &&
    task.destination.provider === destination.provider &&
    taskWatchdog !== undefined &&
    taskWatchdog.action === watchdog.action &&
    taskSource?.kind === 'app-event' &&
    JSON.stringify(taskSource.events) === JSON.stringify(watchdog.source.events) &&
    taskWatchdog.guards.dedupWindowMs === watchdog.guards.dedupWindowMs &&
    taskWatchdog.guards.maxTriggersPerHour === watchdog.guards.maxTriggersPerHour &&
    taskWatchdog.guards.maxChainDepth === watchdog.guards.maxChainDepth &&
    taskWatchdog.guards.maxPerRoot === watchdog.guards.maxPerRoot
  )
}

/** Version `/build` précédente : 5 min et deux runs/h, durcie après mesure du coût dogfood. */
function isUntouchedPriorBoundedAutoKaizen(task: ScheduledTask): boolean {
  const current = autoKaizenSeed()
  const destination = current.destination
  const watchdog = current.watchdog
  const source = task.watchdog?.source
  return (
    destination.kind === 'new' &&
    watchdog?.source.kind === 'app-event' &&
    task.title === current.title &&
    task.prompt === current.prompt &&
    task.destination.kind === 'new' &&
    task.destination.title === destination.title &&
    task.destination.category === destination.category &&
    task.destination.provider === destination.provider &&
    task.watchdog?.action === watchdog.action &&
    source?.kind === 'app-event' &&
    JSON.stringify(source.events) === JSON.stringify(watchdog.source.events) &&
    task.watchdog?.guards.dedupWindowMs === 300_000 &&
    task.watchdog?.guards.maxTriggersPerHour === 2 &&
    task.watchdog?.guards.maxChainDepth === 0 &&
    task.watchdog?.guards.maxPerRoot === 1
  )
}

/** Migre uniquement le semis historique INTACT ; une regle editee par l'utilisateur reste sienne. */
function upgradeLegacyAutoKaizen(store: TaskStore): void {
  for (const task of store.listTasks()) {
    if (
      (!isUntouchedLegacyAutoKaizen(task) &&
        !isUntouchedBareBuildAutoKaizen(task) &&
        !isUntouchedPriorBoundedAutoKaizen(task)) ||
      task.destination.kind !== 'new'
    )
      continue
    const next = autoKaizenSeed()
    if (next.destination.kind !== 'new') continue
    store.update(task.id, {
      ...next,
      enabled: task.enabled,
      mode: task.mode,
      destination: {
        ...next.destination,
        ...task.destination
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
