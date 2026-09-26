import type { TaskStore } from './task-store'
import type { ScheduledTaskInput } from './types'
import { AGENT_STUDIO_DEFAULT_PROVIDER } from '../../shared/task-provider'

/** Identifiant stable du semis : une fois pose (ou supprime par l'utilisateur), il ne revient plus. */
export const CURATE_SEED_ID = 'curate-quotidien-v1'

/**
 * La curation quotidienne : chaque matin, un tour de conversation qui invoque la skill `/curate`
 * (skills/curate/SKILL.md) — vide la file des candidats Brain deposes par `remember`. Heure decalee
 * de /gc (08:00) pour ne pas se marcher dessus.
 */
export function curateSeed(): ScheduledTaskInput {
  return {
    title: 'Curation quotidienne — /curate',
    prompt: '/curate passe quotidienne : vide la file des candidats Brain et rends le bilan du jour.',
    enabled: true,
    mode: 'active-only',
    destination: {
      kind: 'new',
      title: 'Curation Brain',
      category: 'Qualite',
      provider: AGENT_STUDIO_DEFAULT_PROVIDER
    },
    schedule: {
      startDate: '2026-09-22',
      time: '08:30',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'day', interval: 1 }
    }
  }
}

/** Pose la tache une seule fois. Rend son id si elle vient d'etre creee. */
export function seedCurateTask(store: TaskStore): string | undefined {
  if (store.hasSeed(CURATE_SEED_ID)) return undefined
  try {
    return store.create(curateSeed()).id
  } finally {
    store.markSeeded(CURATE_SEED_ID)
  }
}
