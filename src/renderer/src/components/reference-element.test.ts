// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { elementVise, referenceDeLElement } from './reference-element'

/**
 * L'ÉLÉMENT CIBLÉ (conv-1038, 2026-10-21, étendu conv-1338) : l'utilisateur DÉCRIT ce qu'il voit
 * (« la barre d'onglets doit être tout en haut au niveau de réduire fermer »). Un Alt+clic remplace
 * la description par une référence exacte : texte affiché, bloc, fichier source, composant, styles,
 * fil et tour — de quoi partir directement du bon endroit.
 */

afterEach(() => document.body.replaceChildren())

function poser(html: string): HTMLElement {
  const racine = document.createElement('div')
  racine.innerHTML = html
  document.body.append(racine)
  return racine
}

const TOUR = `
  <div class="msg assistant" data-origine="reponse-agent" data-turn-id="tour-1" data-message-id="m-2">
    <div class="rail-noeud" data-nature="juge" data-testid="rail-noeud">
      <section class="jpan" data-testid="juges-panel">
        <div class="jpan-bandeau"><span id="cible">3 juges · 2 refus</span></div>
      </section>
    </div>
    <div class="msg-turn-actions">
      <button class="msg-turn-icon" title="Créer une branche à partir de ce message"><svg id="icone"></svg></button>
    </div>
  </div>`

describe('referenceDeLElement', () => {
  it('un badge dans le bloc des juges : texte, bloc et sa source, repère, fil et tour', () => {
    const racine = poser(TOUR)
    expect(
      referenceDeLElement(racine.querySelector('#cible')!, { conversationId: 'conv-9' })
    ).toContain(
      'Élément ciblé [élément pointé : « 3 juges · 2 refus » · classe jpan-bandeau · ' +
        'bloc : bloc des juges (src/renderer/src/components/JugesPanel.tsx) · ' +
        'repère juges-panel · dans : réponse de l’agent · fil conv-9 · tour tour-1 · styles : '
    )
  })

  it('une icône sans texte dans un bouton : le titre du bouton la désigne', () => {
    const racine = poser(TOUR)
    const reference = referenceDeLElement(racine.querySelector('#icone')!, {
      conversationId: 'conv-9'
    })
    expect(reference).toContain('bouton « Créer une branche à partir de ce message »')
    expect(reference).toContain('classe msg-turn-icon')
    expect(reference).toContain(
      'dans : réponse de l’agent (src/renderer/src/components/ChatMessageRow.tsx)'
    )
    expect(reference).not.toContain('élément pointé : «')
  })

  it('élément sans aucune étiquette : la référence garde ce qui est sûr, sans inventer de bloc', () => {
    const racine = poser('<div class="chat-welcome"><p id="cible">Bienvenue</p></div>')
    const reference = referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
    expect(reference).toContain(
      'Élément ciblé [élément pointé : « Bienvenue » · classe chat-welcome · styles : '
    )
    expect(reference).not.toContain('bloc :')
    expect(reference).not.toContain('composant')
  })

  // Une BRANCHE copie les messages, pas leurs journaux : celui d'un tour copié reste rangé sous
  // le fil d'origine (`turnConversationId`, store/conversations.ts `fork`).
  it('tour copié dans une branche : la référence pointe le fil qui POSSÈDE le journal', () => {
    const racine = poser(
      '<div class="msg assistant" data-origine="reponse-agent" data-turn-id="t-1" data-fil-du-tour="conv-source"><p id="cible">ok</p></div>'
    )
    const reference = referenceDeLElement(racine.querySelector('#cible')!, {
      conversationId: 'conv-branche'
    })
    expect(reference).toContain('fil conv-source · tour t-1')
    expect(reference).not.toContain('conv-branche')
  })

  it('texte affiché trop long : coupé à 120 caractères avec « … »', () => {
    const racine = poser(`<p id="cible">${'mot '.repeat(80)}</p>`)
    const reference = referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
    expect(reference).toContain(`« ${'mot '.repeat(30).trim().slice(0, 119)}… »`)
  })

  it('dans un champ de saisie : rien — Alt+clic y garde son usage de texte', () => {
    const racine = poser('<div data-origine="saisie"><textarea id="cible"></textarea></div>')
    expect(referenceDeLElement(racine.querySelector('#cible')!, { conversationId: 'c' })).toBeNull()
  })

  // Jumeau accepté : la même zone de saisie, mais sur un BOUTON (joindre un fichier grisé…).
  it('sur un bouton de la zone de saisie : la référence, avec la source du composer', () => {
    const racine = poser(
      '<div data-origine="saisie"><button id="cible" disabled title="Joindre un fichier">📎</button></div>'
    )
    const reference = referenceDeLElement(racine.querySelector('#cible')!, { conversationId: 'c' })
    expect(reference).toContain('bouton « Joindre un fichier »')
    expect(reference).toContain('désactivé')
    expect(reference).toContain(
      'dans : zone de saisie (src/renderer/src/components/ChatComposer.tsx)'
    )
  })

  it('la référence ne pose plus de question : « met une croix ici » reste un ordre', () => {
    const racine = poser('<div class="barre"><span id="cible">Onglets</span></div>')
    const reference = referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
    expect(reference).not.toContain('?')
    expect(reference).not.toContain('C’est quoi')
  })

  it('les styles calculés : police, taille, couleur, fond, marge, retrait', () => {
    const racine = poser(
      `<div class="panneau" style="background-color: rgb(9, 9, 9)">
         <p id="cible" style="font-family: 'Segoe UI', sans-serif; font-size: 13px; color: rgb(1, 2, 3); margin: 4px; padding: 2px">Texte</p>
       </div>`
    )
    const reference = referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
    expect(reference).toContain('styles : police Segoe UI, taille 13px, couleur rgb(1, 2, 3)')
    // Le fond vient de l'ancêtre : l'élément lui-même est transparent.
    expect(reference).toContain('fond rgb(9, 9, 9)')
    expect(reference).toContain('marge 4px')
    expect(reference).toContain('retrait 2px')
  })

  it('une icône dans un bouton : les styles et la capture visent le bouton, pas le dessin', () => {
    const racine = poser(TOUR)
    expect(elementVise(racine.querySelector('#icone')!).tagName).toBe('BUTTON')
  })

  // Jumeau : sans bouton autour, c'est l'élément cliqué lui-même.
  it('hors de tout bouton : l’élément visé est l’élément cliqué', () => {
    const racine = poser(TOUR)
    expect(elementVise(racine.querySelector('#cible')!).id).toBe('cible')
  })

  describe('nom du composant', () => {
    const avecFibre = (element: Element, fibre: unknown): void => {
      Object.assign(element, { __reactFiber$abc123: fibre })
    }

    it('le composant React le plus proche, en remontant les balises', () => {
      const racine = poser('<div class="z"><span id="cible">ok</span></div>')
      function BarreDesOnglets(): null {
        return null
      }
      avecFibre(racine.querySelector('#cible')!, {
        type: 'span',
        return: { type: 'div', return: { type: BarreDesOnglets } }
      })
      expect(
        referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
      ).toContain('composant BarreDesOnglets')
    })

    it('un composant enveloppé par forwardRef garde son nom', () => {
      const racine = poser('<div class="z"><span id="cible">ok</span></div>')
      function ChatComposerInterne(): null {
        return null
      }
      avecFibre(racine.querySelector('#cible')!, {
        type: 'span',
        return: { type: { render: ChatComposerInterne } }
      })
      expect(
        referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
      ).toContain('composant ChatComposerInterne')
    })

    // Une balise sans étiquette React (SVG injecté) : on remonte aux parents du document.
    it('un élément injecté sans étiquette React : le composant vient de son parent', () => {
      const racine = poser('<div class="z" id="parent"><svg id="cible"></svg></div>')
      function Icone(): null {
        return null
      }
      avecFibre(racine.querySelector('#parent')!, { type: 'div', return: { type: Icone } })
      expect(
        referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
      ).toContain('composant Icone')
    })

    // Une fonction en minuscules n'est pas un composant : on remonte au-delà.
    it('un nom en minuscules n’est pas rapporté', () => {
      const racine = poser('<div class="z"><span id="cible">ok</span></div>')
      avecFibre(racine.querySelector('#cible')!, {
        type: 'span',
        return: { type: { name: 'x' } }
      })
      expect(
        referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
      ).not.toContain('composant')
    })

    // Une version construite raccourcit les noms sans les rendre plus courts qu'un vrai : aucun
    // nom n'y est fiable, même d'apparence correcte.
    it('version construite : aucun nom, même d’apparence correcte', () => {
      vi.stubEnv('DEV', false)
      const racine = poser('<div class="z"><span id="cible">ok</span></div>')
      avecFibre(racine.querySelector('#cible')!, {
        type: 'span',
        return: { type: { name: 'Xyz' } }
      })
      expect(
        referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
      ).not.toContain('composant')
      vi.unstubAllEnvs()
    })

    it('aucune étiquette React : aucune mention', () => {
      const racine = poser('<div class="z"><span id="cible">ok</span></div>')
      expect(
        referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
      ).not.toContain('composant')
    })
  })

  describe('cas vides', () => {
    it('le fond de la page (body, html) : rien, le clic reste ordinaire', () => {
      expect(referenceDeLElement(document.body, { conversationId: 'c' })).toBeNull()
      expect(referenceDeLElement(document.documentElement, { conversationId: 'c' })).toBeNull()
    })

    it('un élément sans texte, sans classe et sans repère : rien, même avec un fil ouvert', () => {
      const vide = document.createElement('span')
      document.body.append(vide)
      expect(referenceDeLElement(vide, { conversationId: 'c' })).toBeNull()
    })

    // Jumeau : un seul indice sûr (la classe) suffit.
    it('sans texte mais avec une classe : la référence garde la classe', () => {
      const racine = poser('<div class="zone-vide" id="cible"></div>')
      const reference = referenceDeLElement(racine.querySelector('#cible')!, {
        conversationId: 'c'
      })
      expect(reference).toContain('classe zone-vide')
      expect(reference).toContain('fil c')
    })
  })

  it('sans fil ouvert : aucune mention de fil', () => {
    const racine = poser('<div class="z"><p id="cible">ok</p></div>')
    expect(
      referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
    ).not.toContain('fil ')
  })

  // Un bouton grisé SANS titre : son texte est déjà rapporté, seul l'état manquait.
  it('un bouton grisé sans titre : son état est dit quand même', () => {
    const racine = poser(
      '<div class="z"><button disabled><span id="cible">Joindre</span></button></div>'
    )
    const reference = referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
    expect(reference).toContain('élément pointé : « Joindre »')
    expect(reference).toContain('bouton désactivé')
  })

  // Jumeau : le même bouton actif ne dit rien de son état.
  it('le même bouton actif : aucune mention d’état', () => {
    const racine = poser('<div class="z"><button><span id="cible">Joindre</span></button></div>')
    expect(
      referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })
    ).not.toContain('désactivé')
  })
})
