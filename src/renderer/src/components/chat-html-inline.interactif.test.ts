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


  it('laisse cacher le panneau inactif SEULEMENT s il est revele par une interaction', () => {
    const feuille =
      '.panneau{display:none} #t1:checked ~ .p1{display:block} #t2:checked ~ .p2{display:block}'
    const html =
      '<style>' +
      feuille +
      '</style><input type="radio" id="t1" checked><input type="radio" id="t2">' +
      '<div class="panneau p1">un</div><div class="panneau p2">deux</div>'
    const rendu = sanitizeChatHtml(html, domaine)
    expect(rendu).toContain('display:none')
    expect(rendu).toContain('#htm-abc-t1:checked')
  })

  it('refuse toujours de cacher du texte que RIEN ne revient afficher', () => {
    const rendu = sanitizeChatHtml(
      '<style>.secret{display:none}</style><p class="secret">texte invisible mais copiable</p>',
      domaine
    )
    expect(rendu).not.toContain('display:none')
    // Le texte, lui, reste : on ne supprime pas le contenu, on refuse seulement de le cacher.
    expect(rendu).toContain('texte invisible mais copiable')
  })

  it('laisse cacher une case a cocher ou un bouton radio QUI A un libelle associe', () => {
    for (const declaration of ['opacity:0', 'display:none']) {
      const rendu = sanitizeChatHtml(
        `<style>input{${declaration}}</style>` +
          '<input type="radio" id="t1" name="g"><label for="t1">Alpha</label>' +
          '<input type="checkbox" id="t2"><label for="t2">Beta</label>',
        domaine
      )
      expect(rendu).toContain(declaration)
    }
  })

  it('refuse de cacher un champ SANS libelle, ou un paragraphe glisse dans le meme selecteur', () => {
    const sansLibelle = sanitizeChatHtml(
      '<style>input{opacity:0}</style><input type="radio" id="t1">',
      domaine
    )
    expect(sansLibelle).not.toContain('opacity:0')

    for (const declaration of ['opacity:0', 'display:none']) {
      const paragraphe = sanitizeChatHtml(
        `<style>p{${declaration}}</style><p>texte invisible mais copiable</p>`,
        domaine
      )
      expect(paragraphe).not.toContain(declaration)
      expect(paragraphe).toContain('texte invisible mais copiable')

      const melange = sanitizeChatHtml(
        `<style>input, p{${declaration}}</style>` +
          '<input type="radio" id="t1"><label for="t1">A</label><p>cache</p>',
        domaine
      )
      expect(melange).not.toContain(declaration)
    }
  })

  it('prefixe aussi les selecteurs d attribut, sinon le libelle ne s allume jamais', () => {
    const css = scopeChatStyleSheet('#t1:checked ~ .barre label[for=t1]{color:#000}', domaine)
    expect(css).toContain('label[for="htm-abc-t1"]')
  })

  it('ne laisse toujours passer ni script ni gestionnaire d evenement sur un champ', () => {
    const rendu = sanitizeChatHtml(
      '<input type="checkbox" id="a" onclick="alert(1)" onchange="alert(2)" formaction="http://x">',
      domaine
    )
    expect(rendu).not.toMatch(/onclick|onchange|formaction/u)
  })
})
