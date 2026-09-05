export const AUTOWIN_DISPLAY_NAME = 'Autowin OS'
export const AUTOWIN_APP_DATA_DIR = 'autowin-os'
export const AUTOWIN_APP_ID = 'com.amitel.autowin-os'
export const AUTOWIN_WORKSPACE_ENV = 'AUTOWIN_OS_WORKSPACE'
/**
 * Marqueur posé par Autowin quand c'est LUI qui a republié le dossier résolu dans
 * `AUTOWIN_OS_WORKSPACE`, et non un lanceur externe. Sans lui, les deux cas sont indiscernables au
 * démarrage suivant (l'environnement est transmis au processus relancé), et une valeur que nous
 * avons nous-mêmes écrite passerait pour une consigne extérieure — écrasant en silence le dossier
 * choisi dans les Réglages.
 */
export const AUTOWIN_WORKSPACE_ORIGIN_ENV = 'AUTOWIN_OS_WORKSPACE_ORIGIN'
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
