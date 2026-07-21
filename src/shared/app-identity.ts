export const AUTOWIN_DISPLAY_NAME = 'Autowin OS'
export const AUTOWIN_APP_DATA_DIR = 'autowin-os'
export const AUTOWIN_APP_ID = 'com.amitel.autowin-os'
export const AUTOWIN_WORKSPACE_ENV = 'AUTOWIN_OS_WORKSPACE'
export const AUTOWIN_STORAGE_SUFFIXES = [
  'agent-workflow.v1',
  'graph.visibility-settings.v1',
  'graph.node-spacing.v1'
] as const

// Compatibilite de lecture pour une version de migration. Ne jamais utiliser
// ces valeurs comme cible d'ecriture ni les exposer dans l'interface.
const LEGACY_APP_DATA_DIR = 'agentic-os'
const LEGACY_STORAGE_PREFIX = 'agentic-os'
const LEGACY_WORKSPACE_ENV = 'AGENTIC_OS_WORKSPACE'

export function legacyAppDataDirName(): string {
  return LEGACY_APP_DATA_DIR
}

export function legacyStorageKey(suffix: string): string {
  return `${LEGACY_STORAGE_PREFIX}.${suffix}`
}

export function autowinStorageKey(suffix: string): string {
  return `${AUTOWIN_APP_DATA_DIR}.${suffix}`
}

export function legacyWorkspaceEnvName(): string {
  return LEGACY_WORKSPACE_ENV
}
