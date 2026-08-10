// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildSandboxedHtmlDocument } from './SandboxedHtmlPreview'

/**
 * L'app est sombre ; le bac a sable s'affichait sur un blanc code en dur, ce qui faisait de chaque
 * reponse HTML du modele un rectangle eblouissant. Ces defauts sont un PLANCHER de lisibilite : ils
 * doivent exister, et ne jamais empecher le modele de styler sa page comme il veut.
 */
describe('Rendu HTML du chat — plancher de lisibilite', () => {
  it('accorde la page a l app sombre, controles du navigateur compris', () => {
    const doc = buildSandboxedHtmlDocument('<p>bonjour</p>')
    expect(doc).toContain('color-scheme:dark')
    expect(doc).toContain('#0f1218')
  })

  it('n impose rien : aucun !important, et le style du modele reste APRES le plancher', () => {
    const doc = buildSandboxedHtmlDocument(
      '<style>body{background:#fff;color:#111}</style><p>x</p>'
    )
    expect(doc).not.toContain('!important')
    // Le plancher est dans le <head>, le style du modele dans le <body> : il gagne par l ordre.
    expect(doc.indexOf('#0f1218')).toBeLessThan(doc.indexOf('background:#fff'))
  })

  it('garde la CSP en tete — la lisibilite n a pas relache la securite', () => {
    const doc = buildSandboxedHtmlDocument('<p>x</p>')
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('color-scheme'))
    expect(doc).toContain("script-src 'none'")
  })
})
