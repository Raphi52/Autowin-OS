import { describe, expect, it } from 'vitest'
import { automationAppIdentity, presentAutomationWindow, resolveAutomationInstanceMode } from './headless-instance'

describe('mode instance automatisée', () => {
  it('autorise le headless uniquement sur une instance explicitement isolée', () => {
    expect(resolveAutomationInstanceMode(['--headless-test-instance'], {}, true)).toEqual({ isolated: false, headless: false })
    expect(resolveAutomationInstanceMode(['--isolated-test-instance', '--headless-test-instance'], {}, true)).toEqual({ isolated: true, headless: true })
  })

  it('conserve le raccourci environnement en développement sans lhonorer en package', () => {
    expect(resolveAutomationInstanceMode([], { AUTOWIN_ISOLATED_TEST_INSTANCE: '1' }, false).isolated).toBe(true)
    expect(resolveAutomationInstanceMode([], { AUTOWIN_ISOLATED_TEST_INSTANCE: '1' }, true).isolated).toBe(false)
  })

  it('ne présente aucune fenêtre auxiliaire ou principale en headless', () => {
    const calls: string[] = []
    const window = {
      maximize: () => calls.push('maximize'), show: () => calls.push('show'),
      focus: () => calls.push('focus'), flashFrame: () => calls.push('flash')
    }
    expect(presentAutomationWindow(window, true, { maximize: true, focus: true, flash: true })).toBe(false)
    expect(calls).toEqual([])
    expect(presentAutomationWindow(window, false, { focus: true, flash: true })).toBe(true)
    expect(calls).toEqual(['show', 'focus', 'flash'])
  })

  it('isole aussi l’identité Windows des instances automatisées', () => {
    expect(automationAppIdentity('com.amitel.autowin-os', { isolated: false, headless: false }))
      .toBe('com.amitel.autowin-os')
    expect(automationAppIdentity('com.amitel.autowin-os', { isolated: true, headless: true }))
      .toBe('com.amitel.autowin-os.test')
  })
})
