import type { TaskStore } from './task-store'
import type { ScheduledTaskInput } from './types'

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
 * Autorite `plan` au depart, DELIBEREMENT : une regle qui se declenche seule et qui ecrit seule est
 * exactement le cas ou un reglage par defaut ne doit rien s'autoriser. L'utilisateur qui veut la
 * reparation automatique la passe en `auto` lui-meme, en connaissance de cause.
 */
export function autoKaizenSeed(): ScheduledTaskInput {
  return {
    title: 'Auto-kaizen — orchestration rouge ou workflow douteux',
    prompt: [
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
      provider: 'claude',
      authorityMode: 'plan'
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
        // Une meme orchestration rouge peut etre rediffusee : 5 min de silence evitent le doublon.
        dedupWindowMs: 300_000,
        // Une journee de travail normale produit quelques rouges ; au-dela, c'est le systeme qui va
        // mal, pas une orchestration — et lancer un agent par echec aggraverait la situation.
        maxTriggersPerHour: 4,
        // Un kaizen ne declenche pas un kaizen. C'est le reglage qui empeche la boucle : l'agent
        // corrige, sa correction relance une orchestration, qui pourrait echouer a son tour.
        maxChainDepth: 0,
        // Une panne unique fait echouer des dizaines d'orchestrations. La largeur les rattache a la
        // meme cause au lieu de lancer un agent pour chacune.
        maxPerRoot: 3
      }
    }
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
