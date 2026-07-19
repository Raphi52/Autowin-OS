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
