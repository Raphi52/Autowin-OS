// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { referenceDeLElement } from './reference-element'

/**
 * « C'EST QUOI ÇA ? » (conv-1038, 2026-10-21) : ~6 % des messages de l'utilisateur (71 sur 1 197,
 * relevé du scout) demandent « pourquoi / c'est quoi » à propos de l'app elle-même, en DÉCRIVANT ce
 * qu'il voit. Un Alt+clic remplace la description par une référence exacte : texte affiché, bloc,
 * fichier source, fil et tour — de quoi partir directement du bon journal.
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
    expect(referenceDeLElement(racine.querySelector('#cible')!, { conversationId: 'conv-9' })).toBe(
      'C’est quoi ça ? [élément pointé : « 3 juges · 2 refus » · classe jpan-bandeau · ' +
        'bloc : bloc des juges (src/renderer/src/components/JugesPanel.tsx) · ' +
        'repère juges-panel · dans : réponse de l’agent · fil conv-9 · tour tour-1]'
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
    expect(referenceDeLElement(racine.querySelector('#cible')!, { conversationId: null })).toBe(
      'C’est quoi ça ? [élément pointé : « Bienvenue » · classe chat-welcome]'
    )
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
})
