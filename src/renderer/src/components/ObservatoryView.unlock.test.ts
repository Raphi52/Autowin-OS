import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Observatory Native diagnostics default access', () => {
  it('loads global diagnostics automatically without a popup or unlock button', () => {
    const view = readFileSync(new URL('./ObservatoryView.tsx', import.meta.url), 'utf8')
    /**
     * Le chargement des sources vit desormais dans `useObservatorySources.ts` (extrait de la vue le
     * 2026-08-07). L'intention de cette garde est INCHANGEE — « les diagnostics se chargent seuls,
     * sans popup ni bouton de deverrouillage » — mais elle doit regarder la ou le code est reellement.
     * On concatene les deux fichiers du RENDERER plutot que de relacher l'assertion : la deplacer
     * suit le code, l'affaiblir aurait laisse la garde passer a vide.
     */
    const sources = readFileSync(new URL('./useObservatorySources.ts', import.meta.url), 'utf8')
    const renderer = `${view}\n${sources}`
    const main = readFileSync(new URL('../../../main/index.ts', import.meta.url), 'utf8')

    expect(view).not.toContain('Déverrouiller Native')
    expect(renderer).toMatch(/window\.api\s*\.authorizeDiagnostics\(\)/)
    expect(renderer).toContain('window.api.promptTracesGlobal(capability)')
    expect(main).not.toContain("title: 'Payloads Native sensibles'")
    expect(main).not.toContain('dialog.showMessageBox(parent, options)')
    expect(main).toContain('return diagnosticCapabilities.issue(event.sender.id)')
    expect(main).toContain("assertTrustedRendererSender(event, 'Diagnostics authorization')")
  })
})
