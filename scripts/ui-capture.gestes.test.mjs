import { describe, expect, it } from 'vitest'
import { gesteDeLEtape, scriptDuGeste } from './ui-capture.mjs'

/**
 * Pourquoi ce test existe (conv-1038, 2026-10-21) : la chaîne `--click` ne savait que
 * `element.click()`. Deux gestes du chat ne se prouvaient donc sur AUCUNE capture : la barre posée
 * sur un passage SÉLECTIONNÉ, et l'Alt+clic « C'est quoi ça ? ». Les préfixes `selection:` et `alt:`
 * les ajoutent ; une étape sans préfixe garde exactement le clic d'avant.
 *
 * L'entrée qui doit faire échouer une correction fausse : un sélecteur qui CONTIENT « : » sans être
 * un préfixe (`button:not([disabled])`) — le lire comme un geste casserait tous les clics existants.
 */
describe('ui-capture — gestes de la chaîne --click', () => {
  it('sans préfixe : un clic ordinaire, sélecteur intact', () => {
    expect(gesteDeLEtape('.conv-pick')).toEqual({ geste: 'clic', selecteur: '.conv-pick' })
  })

  it('un « : » de pseudo-classe n’est PAS un préfixe de geste', () => {
    expect(gesteDeLEtape('button:not([disabled])')).toEqual({
      geste: 'clic',
      selecteur: 'button:not([disabled])'
    })
  })

  it('alt: → Alt+clic ; selection: → sélection du texte puis relâchement', () => {
    expect(gesteDeLEtape('alt: .msg.assistant .msg-body')).toEqual({
      geste: 'alt-clic',
      selecteur: '.msg.assistant .msg-body'
    })
    expect(gesteDeLEtape('selection:.msg.assistant .msg-body p')).toEqual({
      geste: 'selection',
      selecteur: '.msg.assistant .msg-body p'
    })
  })

  it('le script de chaque geste vise le sélecteur et rend si la cible existe', () => {
    const clic = scriptDuGeste({ geste: 'clic', selecteur: '.a' })
    expect(clic).toContain('document.querySelector(".a")')
    expect(clic).toContain('cible?.click()')
    const alt = scriptDuGeste({ geste: 'alt-clic', selecteur: '.a' })
    expect(alt).toContain('altKey: true')
    expect(alt).not.toContain('cible?.click()')
    const selection = scriptDuGeste({ geste: 'selection', selecteur: '.a' })
    expect(selection).toContain('selectNodeContents')
    expect(selection).toContain("'mouseup'")
  })
})
