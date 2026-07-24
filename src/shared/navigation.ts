export const APP_DESTINATIONS = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'agent-studio', label: 'Agent Studio', icon: '🤖' },
  { id: 'knowledge', label: 'Knowledge', icon: '🧠' },
  { id: 'observatory', label: 'Observatory', icon: '🔭' },
  { id: 'worktree', label: 'Worktrees', icon: '🌳' },
  { id: 'tickets', label: 'Tickets', icon: '🎫' },
  { id: 'settings', label: 'Settings', icon: '⚙️' }
] as const

export type AppDestination = (typeof APP_DESTINATIONS)[number]['id']
export type AgentStudioSection = 'topology' | 'routing'
export type SettingsSection = 'capabilities' | 'behaviour' | 'preflight'

export interface AppLocation {
  destination: AppDestination
  section?: AgentStudioSection | SettingsSection
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
  omniroute: 'agent-studio',
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
  'prompt-load': 'observatory'
}

const LEGACY_LOCATIONS: Readonly<Record<string, AppLocation>> = {
  agents: { destination: 'agent-studio', section: 'topology' },
  roles: { destination: 'agent-studio', section: 'topology' },
  models: { destination: 'agent-studio', section: 'topology' },
  router: { destination: 'agent-studio', section: 'routing' },
  routeur: { destination: 'agent-studio', section: 'routing' },
  omniroute: { destination: 'agent-studio', section: 'routing' },
  capabilities: { destination: 'settings', section: 'capabilities' },
  skills: { destination: 'settings', section: 'capabilities' },
  hooks: { destination: 'settings', section: 'capabilities' },
  tools: { destination: 'settings', section: 'capabilities' },
  behaviour: { destination: 'settings', section: 'behaviour' },
  behavior: { destination: 'settings', section: 'behaviour' }
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
