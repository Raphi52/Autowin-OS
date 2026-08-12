export const APP_DESTINATIONS = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'agent-studio', label: 'Agent Studio', icon: '🤖' },
  { id: 'knowledge', label: 'Knowledge', icon: '🧠' },
  { id: 'observatory', label: 'Observatory', icon: '🔭' },
  { id: 'task-manager', label: 'Task Manager', icon: '◷' },
  { id: 'worktree', label: 'Worktrees', icon: '🌳' },
  { id: 'tickets', label: 'Tickets', icon: '🎫' },
  { id: 'settings', label: 'Settings', icon: '⚙️' }
] as const

export type AppDestination = (typeof APP_DESTINATIONS)[number]['id']
export type AgentStudioSection = 'topology' | 'routing' | 'workflows'
export type SettingsSection = 'capabilities' | 'budget' | 'behaviour' | 'providers' | 'preflight'
/**
 * Deux MÉTIERS distincts dans Task Manager, donc deux sections : surveiller des agents (alertes,
 * occurrences ratées) n'est pas éditer des tâches planifiées. Elles s'empilaient sur un seul écran.
 */
export type TaskManagerSection = 'watchdog' | 'planification'

export interface AppLocation {
  destination: AppDestination
  section?: AgentStudioSection | SettingsSection | TaskManagerSection
}

const DESTINATION_IDS = new Set<string>(APP_DESTINATIONS.map(({ id }) => id))

const LEGACY_DESTINATIONS: Readonly<Record<string, AppDestination>> = {
  memory: 'knowledge',
  graph: 'knowledge',
  brain: 'knowledge',
  agents: 'agent-studio',
  roles: 'agent-studio',
  models: 'agent-studio',
  router: 'agent-studio',
  routeur: 'agent-studio',
  capabilities: 'settings',
  skills: 'settings',
  hooks: 'settings',
  tools: 'settings',
  behaviour: 'settings',
  behavior: 'settings',
  observatoire: 'observatory',
  harness: 'observatory',
  harnais: 'observatory',
  prompt: 'observatory',
  'prompt-load': 'observatory',
  tasks: 'task-manager',
  scheduler: 'task-manager',
  planning: 'task-manager',
  planification: 'task-manager',
  watchdog: 'task-manager'
}

const LEGACY_LOCATIONS: Readonly<Record<string, AppLocation>> = {
  agents: { destination: 'agent-studio', section: 'topology' },
  roles: { destination: 'agent-studio', section: 'topology' },
  models: { destination: 'agent-studio', section: 'topology' },
  router: { destination: 'agent-studio', section: 'routing' },
  routeur: { destination: 'agent-studio', section: 'routing' },
  capabilities: { destination: 'settings', section: 'capabilities' },
  skills: { destination: 'settings', section: 'capabilities' },
  hooks: { destination: 'settings', section: 'capabilities' },
  tools: { destination: 'settings', section: 'capabilities' },
  budget: { destination: 'settings', section: 'budget' },
  behaviour: { destination: 'settings', section: 'behaviour' },
  behavior: { destination: 'settings', section: 'behaviour' },
  // Un agent pilote l'app par des NOMS : sans ces entrées, la séparation Watchdog/Planification ne
  // serait atteignable qu'à la souris, et « va sur le watchdog » atterrirait sur la mauvaise section.
  watchdog: { destination: 'task-manager', section: 'watchdog' },
  planification: { destination: 'task-manager', section: 'planification' },
  planning: { destination: 'task-manager', section: 'planification' },
  scheduler: { destination: 'task-manager', section: 'planification' }
}

export function isAppDestination(value: string): value is AppDestination {
  return DESTINATION_IDS.has(value)
}

/** Converge les anciens noms émis par les agents et versions précédentes vers le shell courant. */
export function normalizeDestination(value: string): AppDestination {
  if (isAppDestination(value)) return value
  return LEGACY_DESTINATIONS[value.toLowerCase()] ?? 'chat'
}

export function resolveAppLocation(value: string): AppLocation {
  const normalized = value.toLowerCase()
  return LEGACY_LOCATIONS[normalized] ?? { destination: normalizeDestination(normalized) }
}
