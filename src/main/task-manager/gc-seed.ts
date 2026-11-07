import type { TaskStore } from './task-store'
import type { ScheduledTaskInput } from './types'
import { AGENT_STUDIO_DEFAULT_PROVIDER } from '../../shared/task-provider'

/** Identifiant stable du semis : une fois pose (ou supprime par l'utilisateur), il ne revient plus. */
export const GC_SEED_ID = 'gc-quotidien-v1'

/**
 * Le texte des tâches posées avant que le `/gc` couvre tout le disque. Il se lit sur la carte de la
 * tâche et bornait le ménage à un seul dossier : une tâche restée à ce texte exact est remise au
 * texte courant, une tâche retouchée par l'utilisateur garde le sien.
 */
export const GC_PROMPT_SUR_AUTOWIN_DATA =
  '/gc passe quotidienne sur .autowin-data : rends le bilan du jour.'

/**
 * Le ramasse-miettes quotidien : chaque jour, un tour de conversation qui invoque la skill `/gc`
 * (skills/gc/SKILL.md) — pèse tout le poste, déplace en corbeille datée ce qui est mort, ne purge
 * jamais sans accord. Heure decalee de la maintenance (08:30) pour ne pas se marcher dessus.
 */
export function gcSeed(): ScheduledTaskInput {
  return {
    title: 'Garbage collector quotidien — /gc',
    prompt: '/gc passe quotidienne sur tout le poste : rends le bilan du jour.',
    enabled: true,
    mode: 'active-only',
    destination: {
      kind: 'new',
      title: 'Garbage collector',
      category: 'Qualite',
      provider: AGENT_STUDIO_DEFAULT_PROVIDER
    },
    schedule: {
      startDate: '2026-09-22',
      time: '08:00',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'day', interval: 1 }
    }
  }
}

/** Pose la tache une seule fois. Rend son id si elle vient d'etre creee. */
export function seedGcTask(store: TaskStore): string | undefined {
  const { title, prompt } = gcSeed()
  for (const tache of store.listTasks())
    if (tache.title === title && tache.prompt === GC_PROMPT_SUR_AUTOWIN_DATA)
      store.update(tache.id, { prompt })
  if (store.hasSeed(GC_SEED_ID)) return undefined
  try {
    return store.create(gcSeed()).id
  } finally {
    store.markSeeded(GC_SEED_ID)
  }
}
