// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { sanitizeChatHtml } from './chat-html-inline'

const SCOPE = '[data-html-scope="z"]'
const rendu = (source: string): string => sanitizeChatHtml(source, SCOPE)

/**
 * Le filtre anti-dissimulation doit valoir pour les DEUX portes.
 *
 * Mesure du 2026-08-28 : `sanitizeStyle` refusait `display:none` mais `scopeChatStyleSheet` le
 * laissait passer. Le texte restait dans le DOM, invisible, donc copiable a l'insu de l'utilisateur.
 */
describe('dissimulation de contenu par feuille <style>', () => {
  it('retire display:none d une feuille du modele et conserve le texte visible', () => {
    const html = rendu('<style>.h{display:none}</style><p class="h">SECRET</p>')
    expect(html).not.toContain('display:none')
    expect(html).toContain('SECRET')
  })

  it('retire opacity:0 et font-size:0 d une feuille du modele', () => {
    const html = rendu('<style>.h{opacity:0;font-size:0;color:red}</style><p class="h">SECRET</p>')
    expect(html).not.toContain('opacity:0')
    expect(html).not.toContain('font-size:0')
    expect(html).toContain('color:red')
  })

  it('retire visibility:hidden d une feuille du modele', () => {
    expect(rendu('<style>.h{visibility:hidden}</style>')).not.toContain('visibility')
  })

  it('laisse passer une opacite partielle, qui est de la mise en forme legitime', () => {
    expect(rendu('<style>.h{opacity:0.6}</style>')).toContain('opacity:0.6')
  })

  it('refuse toujours display:none en style inline', () => {
    expect(rendu('<p style="display:none;color:red">x</p>')).not.toContain('display')
  })
})
