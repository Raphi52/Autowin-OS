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

/**
 * MESURE du 2026-09-07 (conv-335) : quatre propositions d'icone dessinees en `<svg>` se sont affichees
 * VIDES dans le fil — seuls les libelles texte restaient. Aucune balise SVG n'etait dans la liste
 * blanche, donc chaque dessin etait deplie et perdu.
 */
describe('dessin vectoriel dans le fil', () => {
  const DESSIN =
    '<svg viewBox="0 0 10 10"><defs><linearGradient id="g1">' +
    '<stop offset="0" stop-color="#e3ba55"/></linearGradient></defs>' +
    '<rect width="10" height="10" rx="2" fill="url(#g1)"/>' +
    '<path d="M1 1 L9 9" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>'

  it('conserve la balise svg et sa geometrie', () => {
    const html = sanitizeChatHtml(DESSIN)
    expect(html).toContain('<svg')
    expect(html).toContain('viewBox="0 0 10 10"')
    expect(html).toContain('d="M1 1 L9 9"')
    expect(html).toContain('stroke-width="2"')
  })

  it('garde le degrade en reliant la reference a son id prefixe', () => {
    const html = sanitizeChatHtml(DESSIN, '[data-html-scope="abc"]')
    expect(html).toContain('id="svg-abc-g1"')
    expect(html).toContain('url(#svg-abc-g1)')
  })

  // ENTREES QUI DOIVENT FAIRE ECHOUER UN ELARGISSEMENT TROP LARGE :
  it('retire un gestionnaire d evenement porte par le dessin', () => {
    const html = sanitizeChatHtml('<svg onload="alert(1)"><circle cx="1" cy="1" r="1"/></svg>')
    expect(html).not.toContain('onload')
    expect(html).toContain('<circle')
  })

  it('refuse une reference SORTANTE deguisee en remplissage', () => {
    const html = sanitizeChatHtml('<svg><rect fill="url(https://pisteur.example/p.png)"/></svg>')
    expect(html).not.toContain('pisteur.example')
  })

  it('deplie une balise SVG non nommee au lieu de la rendre', () => {
    const html = sanitizeChatHtml('<svg><foreignObject><b>texte</b></foreignObject></svg>')
    expect(html).not.toContain('foreignObject')
    expect(html).toContain('texte')
  })
})
