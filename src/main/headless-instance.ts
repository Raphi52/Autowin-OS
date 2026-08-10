import { basename, dirname, join, normalize } from 'node:path'
import { AUTOWIN_APP_DATA_DIR } from '../shared/app-identity'

export interface AutomationInstanceMode {
  isolated: boolean
  headless: boolean
}

/** Les fixtures ne doivent jamais partager l'identité Windows de l'app bureau. */
export function automationAppIdentity(appId: string, mode: AutomationInstanceMode): string {
  return mode.isolated ? `${appId}.test` : appId
}

export interface PresentableWindow {
  maximize(): void
  show(): void
  focus(): void
  flashFrame(flag: boolean): void
}

export function presentAutomationWindow(
  window: PresentableWindow,
  headless: boolean,
  options: { maximize?: boolean; focus?: boolean; flash?: boolean } = {}
): boolean {
  if (headless) return false
  if (options.maximize) window.maximize()
  window.show()
  if (options.focus) window.focus()
  if (options.flash) window.flashFrame(true)
  return true
}

export function resolveAutomationInstanceMode(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  isPackaged: boolean
): AutomationInstanceMode {
  const isolated =
    (!isPackaged && env['AUTOWIN_ISOLATED_TEST_INSTANCE'] === '1') ||
    argv.includes('--isolated-test-instance')
  return { isolated, headless: isolated && argv.includes('--headless-test-instance') }
}

export function resolveExplicitUserDataDir(argv: readonly string[]): string | undefined {
  const flag = '--user-data-dir'
  const inline = argv.find((argument) => argument.startsWith(`${flag}=`))
  const flagIndex = argv.indexOf(flag)
  const raw = inline?.slice(flag.length + 1) ?? (flagIndex >= 0 ? argv[flagIndex + 1] : undefined)
  const value = raw?.trim()
  if (!value || /\s--[a-z0-9-]+/i.test(value) || value.includes('\0')) return undefined
  return value
}

/**
 * Tout user-data explicite qui déplace l'identité du verrou Electron doit déplacer les stores
 * Autowin avec lui. Sinon deux profils Electron distincts peuvent partager les mêmes checkpoints.
 */
export function resolveInstanceAppDataBase(
  defaultBase: string,
  explicitUserDataPath: string | undefined
): string {
  if (!explicitUserDataPath) return defaultBase
  const normalized = normalize(explicitUserDataPath)
  // Le relais Task Manager retransmet `app.getPath('userData')`, donc une racine déjà canonique.
  // La reconnaître rend parent → relais → enfant strictement idempotent.
  return basename(normalized).toLowerCase() === AUTOWIN_APP_DATA_DIR.toLowerCase()
    ? dirname(normalized)
    : join(normalized, 'app-data')
}
