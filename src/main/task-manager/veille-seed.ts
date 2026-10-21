import type { TaskStore } from './task-store'
import type { ScheduledTaskInput } from './types'
import { AGENT_STUDIO_DEFAULT_PROVIDER } from '../../shared/task-provider'

/** Identifiant stable du semis : une fois pose (ou supprime par l'utilisateur), il ne revient plus. */
export const VEILLE_SEED_ID = 'veille-hebdo-v1'

/**
 * La veille concurrents hebdomadaire : la SEULE voie qui lance les scouts web de `SOURCES_VEILLE`.
 *
 * Pourquoi une graine : le dispatcheur `veille` (veille/dispatch-veille.ts) est branche au
 * planificateur, mais il ne se declenche que sur une tache `action: 'veille'` — et rien ne la posait,
 * le formulaire du Task Manager ne proposant pas ce choix. Constat du 2026-10-21 (conv-1032) : le
 * stock ne contenait que des candidats internes, 0 echec de source, faute d'une seule passe web.
 *
 * Hebdomadaire et non quotidienne : une passe lance un scout par source (~4 min chacun, en
 * parallele) plus le scout interne, pour des pages de notes de version qui changent quelques fois
 * par mois. Lundi 09:00, apres /gc (08:00) et /maintenance et /curate (08:30).
 *
 * Limites ASSUMEES, relevees par la relecture independante de conv-1032 :
 *  - `active-only` : app fermee le lundi a 09:00 = occurrence manquee (alerte), sans rattrapage, donc
 *    une semaine sans veille. Meme choix que les autres graines, qui supposent l'app ouverte le matin.
 *  - Le cout des scouts web (`claude -p` sans `--model`, veille/scout-claude.ts) n'est PAS remonte
 *    dans l'historique de la tache : le dispatcheur de veille rend `completed` sans usage.
 *
 * Le `prompt` n'est pas envoye a un modele (le dispatcheur intercepte la tache avant le chat) : il
 * est requis par le magasin et sert de description lisible dans la liste des taches.
 */
export function veilleSeed(): ScheduledTaskInput {
  return {
    title: 'Veille concurrents hebdomadaire',
    prompt:
      'Passe de veille : un scout par source de notes de version (Claude Code, Codex, Cursor…) et le ' +
      'scout interne ; les candidats retenus remplissent l’onglet Tickets.',
    action: 'veille',
    enabled: true,
    mode: 'active-only',
    destination: {
      kind: 'new',
      title: 'Veille concurrents',
      category: 'Qualite',
      provider: AGENT_STUDIO_DEFAULT_PROVIDER
    },
    schedule: {
      startDate: '2026-09-21',
      time: '09:00',
      timeZone: 'Europe/Paris',
      // Jours ISO (lundi = 1) : le planificateur exige la liste explicite pour une recurrence hebdo.
      recurrence: { unit: 'week', interval: 1, weekDays: [1] }
    }
  }
}

/**
 * Pose la tache une seule fois. Rend son id si elle vient d'etre creee.
 *
 * Une veille deja creee a la main (`task_create`, IPC) suffit : la graine ne la double pas, sinon
 * deux passes completes tourneraient chaque semaine — `unePasseALaFois` ne fusionne que celles qui se
 * CHEVAUCHENT, pas deux horaires differents.
 */
export function seedVeilleTask(store: TaskStore): string | undefined {
  if (store.hasSeed(VEILLE_SEED_ID)) return undefined
  try {
    if (store.listTasks().some((tache) => tache.action === 'veille')) return undefined
    return store.create(veilleSeed()).id
  } finally {
    store.markSeeded(VEILLE_SEED_ID)
  }
}
