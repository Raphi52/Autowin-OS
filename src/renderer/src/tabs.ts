import {
  APP_DESTINATIONS,
  normalizeDestination,
  resolveAppLocation,
  type AgentStudioSection,
  type AppDestination,
  type SettingsSection
} from '../../shared/navigation'

export { APP_DESTINATIONS, resolveAppLocation }
export type Tab = AppDestination
export type { AgentStudioSection, SettingsSection }

/** Tolère les anciens noms d'onglets émis par un agent (catalogue legacy). */
export function normalizeTab(t: string): Tab {
  return normalizeDestination(t)
}
