// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { gererCopie, htmlPropreDeLaPlage } from './copie-propre'

/**
 * Ce que ces tests défendent (conv-1073) : une sélection copiée dans Autowin et collée dans Gmail
 * ne doit plus emporter le fond sombre ni les couleurs du thème — Chromium les mettait en style en
 * ligne sur chaque paragraphe, d'où des bandes noires dans le mail. La structure, elle, doit rester.
 */
function evenementCopie(cible: EventTarget | null): {
  evenement: ClipboardEvent
  donnees: Map<string, string>
  empeche: () => boolean
} {
  const donnees = new Map<string, string>()
  let defautEmpeche = false
  const evenement = {
    target: cible,
    clipboardData: { setData: (type: string, valeur: string) => donnees.set(type, valeur) },
    preventDefault: () => {
      defautEmpeche = true
    }
  } as unknown as ClipboardEvent
  return { evenement, donnees, empeche: () => defautEmpeche }
}

function selectionner(noeud: Node): Selection {
  const plage = document.createRange()
  plage.selectNodeContents(noeud)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(plage)
  return selection
}

describe('copie propre vers les autres applications', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('retire fonds, couleurs, classes et boutons, et garde paragraphes, gras, listes et liens', () => {
    document.body.innerHTML = `
      <div id="msg" class="chat-message" style="background:#0b0f17;color:#dde3ee">
        <p class="md-p" style="background-color: rgb(11, 15, 23); color: rgb(221, 227, 238)"><strong class="x">Contexte :</strong></p>
        <p data-role="corps">Une <strong>équipe de 4 personnes</strong>, voir <a href="https://exemple.fr" class="lien" target="_blank">ici</a>.</p>
        <ul class="liste"><li style="color:red">Conception</li><li>Tests</li></ul>
        <button class="copier">Copier</button><svg aria-hidden="true"><path d="M0 0"/></svg>
      </div>`
    const selection = selectionner(document.getElementById('msg')!)
    const { evenement, donnees, empeche } = evenementCopie(document.getElementById('msg'))

    expect(gererCopie(evenement, selection)).toBe(true)
    expect(empeche()).toBe(true)
    const html = donnees.get('text/html')!
    expect(html).not.toMatch(/style=|class=|data-|background|rgb\(|target=/)
    expect(html).not.toMatch(/<button|<svg|Copier/)
    expect(html).toContain('<p><strong>Contexte :</strong></p>')
    expect(html).toContain('<strong>équipe de 4 personnes</strong>')
    expect(html).toContain('<a href="https://exemple.fr">ici</a>')
    expect(html).toContain('<ul><li>Conception</li><li>Tests</li></ul>')
    expect(donnees.get('text/plain')).toContain('Contexte :')
  })

  it('remet le gras et le tableau autour d’une sélection partielle', () => {
    document.body.innerHTML = `
      <p><strong id="gras" style="color:#e3ba55">plus de 50 techniciens</strong></p>
      <table class="t" style="background:#111"><tbody id="corps"><tr><td style="color:#fff">A</td><td>B</td></tr></tbody></table>`
    const plageGras = document.createRange()
    plageGras.setStart(document.getElementById('gras')!.firstChild!, 0)
    plageGras.setEnd(document.getElementById('gras')!.firstChild!, 7)
    expect(htmlPropreDeLaPlage(plageGras)).toBe('<strong>plus de</strong>')

    const plageTableau = document.createRange()
    plageTableau.selectNodeContents(document.getElementById('corps')!)
    expect(htmlPropreDeLaPlage(plageTableau)).toBe(
      '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>'
    )
  })

  it('écarte les liens dangereux', () => {
    document.body.innerHTML = `<p id="p"><a href="javascript:alert(1)">x</a></p>`
    const plage = document.createRange()
    plage.selectNodeContents(document.getElementById('p')!)
    expect(htmlPropreDeLaPlage(plage)).toBe('<a>x</a>')
  })

  it('laisse la copie native dans un champ de saisie et sur une sélection vide', () => {
    document.body.innerHTML = `<textarea id="champ">bonjour</textarea><p id="p">texte</p>`
    const selection = selectionner(document.getElementById('p')!)
    const champ = evenementCopie(document.getElementById('champ'))
    expect(gererCopie(champ.evenement, selection)).toBe(false)
    expect(champ.empeche()).toBe(false)

    selection.removeAllRanges()
    const vide = evenementCopie(document.getElementById('p'))
    expect(gererCopie(vide.evenement, selection)).toBe(false)
    expect(vide.donnees.size).toBe(0)
  })
})
