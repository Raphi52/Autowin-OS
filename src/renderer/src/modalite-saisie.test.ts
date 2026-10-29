// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { ATTRIBUT_MODALITE, installerModaliteSaisie, modaliteApresTouche } from './modalite-saisie'

/**
 * Ce que ces tests défendent (conv-1222) : le contour de focus d'un bouton ne s'allume qu'en
 * naviguant au clavier. Un clic suivi d'une touche quelconque (Maj pour une capture d'écran, une
 * lettre tapée) ne doit plus faire passer l'app en mode clavier.
 */
let desinstaller: (() => void) | null = null
afterEach(() => {
  desinstaller?.()
  desinstaller = null
  document.documentElement.removeAttribute(ATTRIBUT_MODALITE)
  document.body.innerHTML = ''
})

const modalite = (): string | null => document.documentElement.getAttribute(ATTRIBUT_MODALITE)

function touche(cible: EventTarget, key: string, extra: KeyboardEventInit = {}): void {
  cible.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }))
}

describe('modaliteApresTouche', () => {
  const sans = { altKey: false, ctrlKey: false, metaKey: false, target: null }

  it('Tab et Maj+Tab naviguent', () => {
    expect(modaliteApresTouche({ ...sans, key: 'Tab' })).toBe('clavier')
  })

  it('Maj seule, une lettre, Échap ou Entrée ne disent rien du déplacement', () => {
    for (const key of ['Shift', 'a', 'Escape', 'Enter', ' ', 'Control']) {
      expect(modaliteApresTouche({ ...sans, key })).toBeNull()
    }
  })

  it('un raccourci (Alt+Tab, Ctrl+Tab, Windows+Tab) ne navigue pas dans la page', () => {
    expect(modaliteApresTouche({ ...sans, key: 'Tab', altKey: true })).toBeNull()
    expect(modaliteApresTouche({ ...sans, key: 'Tab', ctrlKey: true })).toBeNull()
    expect(modaliteApresTouche({ ...sans, key: 'Tab', metaKey: true })).toBeNull()
  })

  it('une flèche navigue sur un bouton, pas dans un champ de texte', () => {
    const bouton = document.createElement('button')
    const champ = document.createElement('textarea')
    expect(modaliteApresTouche({ ...sans, key: 'ArrowDown', target: bouton })).toBe('clavier')
    expect(modaliteApresTouche({ ...sans, key: 'ArrowDown', target: champ })).toBeNull()
  })
})

describe('installerModaliteSaisie', () => {
  it('démarre en pointeur : aucun contour tant que personne ne navigue au clavier', () => {
    desinstaller = installerModaliteSaisie(document)
    expect(modalite()).toBe('pointeur')
  })

  it('clic sur un bouton puis Maj ou une lettre : reste en pointeur (le cas de la capture)', () => {
    desinstaller = installerModaliteSaisie(document)
    const bouton = document.createElement('button')
    document.body.append(bouton)
    bouton.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    touche(bouton, 'Shift', { shiftKey: true })
    touche(bouton, 'a')
    expect(modalite()).toBe('pointeur')
  })

  it('Tab passe en clavier, le clic suivant revient en pointeur', () => {
    desinstaller = installerModaliteSaisie(document)
    touche(document.body, 'Tab')
    expect(modalite()).toBe('clavier')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(modalite()).toBe('pointeur')
  })

  it('un composant qui arrête la propagation du clic ne bloque pas le retour en pointeur', () => {
    desinstaller = installerModaliteSaisie(document)
    const bouton = document.createElement('button')
    bouton.addEventListener('pointerdown', (e) => e.stopPropagation())
    document.body.append(bouton)
    touche(document.body, 'Tab')
    bouton.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(modalite()).toBe('pointeur')
  })

  it('désinstallé, il n’écoute plus rien', () => {
    desinstaller = installerModaliteSaisie(document)
    desinstaller()
    desinstaller = null
    touche(document.body, 'Tab')
    expect(modalite()).toBe('pointeur')
  })
})
