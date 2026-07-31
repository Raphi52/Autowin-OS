import { join } from 'node:path'

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
 * Une instance marquée isolée avec un user-data explicite doit aussi déplacer les stores Autowin.
 * Sinon Chromium est isolé mais conversations/artefacts continuent d’écrire dans le profil réel.
 */
export function resolveIsolatedAppDataBase(
  defaultBase: string,
  isolated: boolean,
  explicitUserDataPath: string | undefined
): string {
  return isolated && explicitUserDataPath ? join(explicitUserDataPath, 'app-data') : defaultBase
}
