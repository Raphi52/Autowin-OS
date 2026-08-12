import {
  APP_DESTINATIONS,
  normalizeDestination,
  resolveAppLocation,
  type AgentStudioSection,
  type AppDestination,
  type SettingsSection,
  type TaskManagerSection
} from '../../shared/navigation'

export { APP_DESTINATIONS, resolveAppLocation }
export type Tab = AppDestination
export type { AgentStudioSection, SettingsSection, TaskManagerSection }

/** Tolère les anciens noms d'onglets émis par un agent (catalogue legacy). */
export function normalizeTab(t: string): Tab {
  return normalizeDestination(t)
}
