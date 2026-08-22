// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { sanitizeChatHtml } from './chat-html-inline'

/**
 * `font` (raccourci) et `border-image` etaient absents de la liste blanche : un bloc html-render qui
 * les utilise perdait silencieusement sa typographie ou sa bordure. Elargissement borne — la garde
 * sur les valeurs (`url(`, `expression(`, `@import`, `position:`) reste seule maitresse du refus.
 */
describe('ALLOWED_STYLE_PROPS — font et border-image', () => {
  it('conserve le raccourci font', () => {
    expect(sanitizeChatHtml('<p style="font: italic bold 12px/1.4 Georgia, serif">x</p>')).toContain(
      'font: italic bold 12px/1.4 Georgia, serif'
    )
  })

  it('conserve border-image sans url', () => {
    expect(sanitizeChatHtml('<p style="border-image: linear-gradient(red, blue) 30">x</p>')).toContain(
      'border-image: linear-gradient(red, blue) 30'
    )
  })

  // ENTREE QUI DOIT FAIRE ECHOUER UN ELARGISSEMENT TROP LARGE :
  it('refuse toujours une valeur avec url() sur ces deux proprietes', () => {
    const html = sanitizeChatHtml(
      '<p style="border-image: url(http://x/e.png) 30; font: url(http://x/f.woff)">x</p>'
    )
    expect(html).not.toContain('url(')
    expect(html).not.toContain('border-image')
    expect(html).not.toContain('font:')
  })

  it('refuse toujours une propriete hors liste blanche', () => {
    expect(sanitizeChatHtml('<p style="font-stretch: expanded">x</p>')).not.toContain('font-stretch')
  })
})
