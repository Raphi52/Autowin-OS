import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Observatory Hermes diagnostics default access', () => {
  it('loads global diagnostics automatically without a popup or unlock button', () => {
    const renderer = readFileSync(new URL('./ObservatoryView.tsx', import.meta.url), 'utf8')
    const main = readFileSync(new URL('../../../main/index.ts', import.meta.url), 'utf8')

    expect(renderer).not.toContain('Déverrouiller Hermes')
    expect(renderer).toMatch(/window\.api\s*\.authorizeHermesDiagnostics\(\)/)
    expect(renderer).toContain('window.api.hermesPromptTracesGlobal(capability)')
    expect(main).not.toContain("title: 'Payloads Hermes sensibles'")
    expect(main).not.toContain('dialog.showMessageBox(parent, options)')
    expect(main).toContain('return hermesDiagnosticCapabilities.issue(event.sender.id)')
    expect(main).toContain("assertTrustedRendererSender(event, 'Hermes diagnostics authorization')")
  })
})
