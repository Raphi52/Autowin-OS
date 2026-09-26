import type { TaskStore } from './task-store'
import type { ScheduledTaskInput } from './types'
import { AGENT_STUDIO_DEFAULT_PROVIDER } from '../../shared/task-provider'

/** Identifiant stable du semis : une fois pose (ou supprime par l'utilisateur), il ne revient plus. */
export const MAINTENANCE_SEED_ID = 'maintenance-quotidienne-v1'

/**
 * L'agent de maintenance quotidien : chaque matin, un tour de conversation qui invoque la skill
 * `/maintenance` (skills/maintenance/SKILL.md) — bugs, lenteurs, retard concurrents, travail
 * inachevé. Tour de CHAT et non orchestration : la skill borne elle-meme la passe (une reparation
 * au plus, rien de publie), un pipeline quotidien coûterait sans rapport avec le gain.
 *
 * Conversation dediee reutilisee d'un jour a l'autre : la skill relit le bulletin de la veille
 * pour ne rapporter que ce qui a CHANGE.
 */
export function maintenanceSeed(): ScheduledTaskInput {
  return {
    title: 'Maintenance quotidienne — /maintenance',
    prompt: '/maintenance passe quotidienne d’Autowin OS : rends le bulletin du jour.',
    enabled: true,
    mode: 'active-only',
    destination: {
      kind: 'new',
      title: 'Maintenance',
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
export function seedMaintenanceTask(store: TaskStore): string | undefined {
  if (store.hasSeed(MAINTENANCE_SEED_ID)) return undefined
  try {
    return store.create(maintenanceSeed()).id
  } finally {
    store.markSeeded(MAINTENANCE_SEED_ID)
  }
}
