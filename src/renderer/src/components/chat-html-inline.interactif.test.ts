// @vitest-environment happy-dom
/*
 * INTERACTIVITE SANS JAVASCRIPT DANS LE FIL (2026-09-13).
 *
 * Les cases a cocher, les libelles et les jauges natives donnent des onglets, des accordeons et des
 * barres de progression sans une ligne de script. Ce qui doit rester vrai : aucun autre type de
 * champ ne passe, et les identifiants du bloc ne peuvent ni repondre a l'application ni se
 * telescoper d'une reponse a l'autre.
 */
import { describe, expect, it } from 'vitest'
import { prepareChatHtml, sanitizeChatHtml, scopeChatStyleSheet } from './chat-html-inline'

const domaine = '[data-html-scope="abc"]'

describe('HTML du chat — interactivite sans JavaScript', () => {
  it('garde les cases a cocher, les libelles et les jauges', () => {
    const rendu = sanitizeChatHtml(
      '<input type="checkbox" id="t1" checked><label for="t1">Onglet</label>' +
        '<progress value="7" max="10"></progress><meter value="3" min="0" max="5" low="1" high="4" optimum="5"></meter>',
      domaine
    )
    expect(rendu).toContain('<input type="checkbox"')
    expect(rendu).toContain('checked')
    expect(rendu).toContain('<label')
    expect(rendu).toContain('<progress')
    expect(rendu).toContain('<meter')
    expect(rendu).toContain('max="10"')
  })

  it('refuse TOUT autre champ, element compris', () => {
    for (const type of ['text', 'password', 'file', 'submit', 'image', 'hidden']) {
      const rendu = sanitizeChatHtml(`<p>avant</p><input type="${type}" name="x"><p>apres</p>`, domaine)
      expect(rendu).not.toContain('<input')
      expect(rendu).toContain('avant')
      expect(rendu).toContain('apres')
    }
    // Un input sans type du tout n'est pas une case a cocher : il part aussi.
    expect(sanitizeChatHtml('<input>', domaine)).not.toContain('<input')
  })

  it('confine les identifiants du bloc et garde le lien case <-> libelle', () => {
    const rendu = sanitizeChatHtml(
      '<input type="radio" id="onglet" name="groupe"><label for="onglet">A</label>',
      domaine
    )
    expect(rendu).toContain('id="htm-abc-onglet"')
    expect(rendu).toContain('for="htm-abc-onglet"')
    expect(rendu).toContain('name="htm-abc-groupe"')
    // L'identifiant brut ne subsiste nulle part : il ne peut plus repondre a l'application.
    expect(rendu).not.toMatch(/id="onglet"/u)
  })

  it('prefixe les memes identifiants dans la feuille de style, sinon les onglets seraient inertes', () => {
    const css = scopeChatStyleSheet('#onglet:checked ~ .panneau { display: block }', domaine)
    expect(css).toContain('#htm-abc-onglet:checked')
    expect(css).toContain(domaine)
  })

  it('deux blocs differents ne partagent pas leurs identifiants', () => {
    const premier = prepareChatHtml('<input type="checkbox" id="t"><label for="t">x</label>')
    const second = prepareChatHtml('<input type="checkbox" id="t"><label for="t">y</label>')
    const idDe = (html: string) => /id="([^"]+)"/u.exec(html)?.[1]
    expect(idDe(premier.html)).toBeTruthy()
    expect(idDe(premier.html)).not.toEqual(idDe(second.html))
  })

  it('ne laisse toujours passer ni script ni gestionnaire d evenement sur un champ', () => {
    const rendu = sanitizeChatHtml(
      '<input type="checkbox" id="a" onclick="alert(1)" onchange="alert(2)" formaction="http://x">',
      domaine
    )
    expect(rendu).not.toMatch(/onclick|onchange|formaction/u)
  })
})
