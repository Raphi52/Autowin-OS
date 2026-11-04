// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  blocDuCarrousel,
  carrouselDraft,
  carrouselEnPage,
  verifierPropositions
} from './draft-carrousel.mjs'
import { calquesDe, MAX_CALQUES, panneauCalques, SCRIPT_CALQUES } from './draft-calques.mjs'

// Calques et états d'une proposition /draft (conv-1470).
const simple = (n) => ({ nom: `P${n}`, html: `<div class="ex">maquette ${n}</div>` })
const spec = (propositions) => ({ titre: 'Essai', propositions })
const avecTout = (n) => ({
  nom: `P${n}`,
  html: `<div class="ex" data-calque="Carte"><button data-calque="Bouton">ok</button><p data-calque="Texte">t</p></div>`,
  etats: ['survol', 'chargement', 'erreur']
})

describe('calques et états du carrousel /draft', () => {
  it('sans calque ni état, le carrousel reste octet pour octet le même', () => {
    const avant = spec([simple(1), simple(2)])
    const html = carrouselDraft(avant)
    expect(html).not.toContain('dkc-cq')
    expect(carrouselEnPage(avant)).toBe(false)
    expect(carrouselDraft(spec([{ ...simple(1), etats: [] }, simple(2)]))).toBe(html)
    expect(carrouselEnPage(spec([{ ...simple(1), etats: [] }, simple(2)]))).toBe(false)
  })

  it('un calque ou un état fait passer le carrousel en page interactive', () => {
    expect(carrouselEnPage(spec([avecTout(1), simple(2)]))).toBe(true)
    expect(carrouselEnPage(spec([{ ...simple(1), etats: ['erreur'] }, simple(2)]))).toBe(true)
    expect(blocDuCarrousel(spec([avecTout(1), simple(2)]))).toMatch(/^```html-interactif/)
  })

  it('refuse des états mal formés, accepte les bons', () => {
    const erreurs = (etats) => verifierPropositions(spec([{ ...simple(1), etats }, simple(2)]))
    expect(erreurs('erreur')[0]).toMatch(/une liste de noms/)
    expect(erreurs([3])[0]).toMatch(/minuscules/)
    expect(erreurs(['survol<script>'])[0]).toMatch(/minuscules/)
    expect(erreurs(['en charge'])[0]).toMatch(/minuscules/)
    expect(erreurs([''])[0]).toMatch(/minuscules/)
    expect(erreurs(['erreur', 'erreur'])[0]).toMatch(/deux fois/)
    expect(erreurs(['survol', 'chargement-2', 'erreur'])).toEqual([])
  })

  it('lit les calques sans doublon ni nom vide, et en montre 12 au plus', () => {
    expect(
      calquesDe('<a data-calque="A"></a><b data-calque="A"></b><i data-calque=" "></i>')
    ).toEqual(['A'])
    const html = Array.from({ length: 15 }, (_, i) => `<i data-calque="C${i}"></i>`).join('')
    const panneau = panneauCalques([{ n: 1, html }])
    expect(panneau.match(/class="dkc-cl"/g)).toHaveLength(MAX_CALQUES)
    expect(panneau).toContain('+3')
  })

  it('un calque remplit la saisie avec la proposition et son nom', () => {
    const html = carrouselDraft(spec([simple(1), avecTout(2)]))
    expect(html).toContain(
      '<a href="#autowin-prompt" class="dkc-cl">Proposition 2 — calque Bouton : </a>'
    )
    expect(html).not.toContain('class="dkc-cq dkc-cq1"')
    expect(html).toContain('#dkp2:checked~.dkc-cq2{display:flex}')
  })

  it('un état ne change que sa proposition', () => {
    document.body.innerHTML = carrouselDraft(spec([avecTout(1), avecTout(2), simple(3)]))
    new Function(SCRIPT_CALQUES)()
    document.querySelector('.dkc-cq2 [data-etat="erreur"]').click()
    expect(document.querySelector('.dkc-s2').classList.contains('dk-etat-erreur')).toBe(true)
    expect(document.querySelector('.dkc-t2').classList.contains('dk-etat-erreur')).toBe(true)
    for (const autre of ['.dkc-s1', '.dkc-t1', '.dkc-s3', '.dkc-t3'])
      expect(document.querySelector(autre).className).not.toMatch(/dk-etat-/)
    expect(document.querySelector('.dkc-cq2 .dkc-cev').textContent).toBe('État de la 2 : erreur')
    document.querySelector('.dkc-cq2 [data-etat="chargement"]').click()
    expect(document.querySelector('.dkc-s2').className).not.toMatch(/dk-etat-erreur/)
    expect(document.querySelector('.dkc-s2').classList.contains('dk-etat-chargement')).toBe(true)
    document.querySelector('.dkc-cq2 [data-etat=""]').click()
    expect(document.querySelector('.dkc-s2').className).not.toMatch(/dk-etat-/)
  })
})
