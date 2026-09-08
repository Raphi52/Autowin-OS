// @vitest-environment happy-dom
/**
 * GLISSER-DEPOSER une piece jointe dans l'ecran « nouveau message » de la tuile Interlocuteurs.
 *
 * Demande de l'utilisateur du 2026-09-08, symptome exact : « si je glisse un pdf dans la fenetre,
 * j'ai le texte Copier qui s'affiche mais il ne se passe rien quand je le lache ». La CAUSE est
 * nommee : aucun gestionnaire de glisser-deposer n'existait sur cet ecran. Sans `preventDefault()`
 * sur `dragover`, Chromium montre son curseur « Copier » par defaut puis ABANDONNE le lacher — le
 * navigateur refuse le depot, pas l'application.
 *
 * Ce fichier garde donc les deux moities de la panne :
 *  - le `dragover` est ACCEPTE (`defaultPrevented`), sinon le lacher n'arrive jamais ;
 *  - le fichier lache ARRIVE dans l'envoi, avec son nom et son contenu.
 *
 * Rendu avec `react-dom` + `act`, comme les autres tests de cette tuile : le depot n'embarque pas
 * `@testing-library/react`.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InterlocuteursWidget } from './InterlocuteursWidget'
import type { Interlocuteur } from './outlook-model'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 8, 8, 12, 0, 0).getTime()
const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(() => {
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

const zoe: Interlocuteur = {
  echange: true,
  cle: 'zoe@ex.fr',
  nom: 'Zoé Martin',
  adresse: 'zoe@ex.fr',
  dernierNomRecu: NOW,
  nonLus: 0,
  dernierEchange: NOW,
  messages: [
    {
      id: 'm1',
      sujet: 'Devis',
      corps: 'Bonjour',
      recuLe: NOW - 3_600_000,
      nonLu: false,
      deMoi: false,
      auteur: 'Zoé Martin',
      fil: 'devis'
    }
  ]
}

/**
 * Un evenement de glisser-deposer utilisable dans happy-dom.
 *
 * `DragEvent` n'y porte pas de `dataTransfer` : on pose l'objet nous-memes sur l'evenement natif,
 * qui est exactement ce que React relaie a `event.dataTransfer`. `cancelable` est indispensable —
 * sans lui, `defaultPrevented` resterait faux et le test ne prouverait rien.
 */
function evenementDepot(type: string, fichiers: File[]): Event {
  const evenement = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(evenement, 'dataTransfer', {
    value: { types: ['Files'], files: fichiers, items: [], dropEffect: 'copy' }
  })
  return evenement
}

function pdf(nom = 'devis.pdf', octets = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])): File {
  return new File([octets], nom, { type: 'application/pdf' })
}

function monter(onNouvelleConversation = vi.fn().mockResolvedValue({ ok: true })) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(InterlocuteursWidget, {
        fils: [zoe],
        now: NOW,
        onOuvrir: vi.fn().mockResolvedValue(undefined),
        ouvertureEnCours: null,
        onRepondre: vi.fn().mockResolvedValue({ ok: true }),
        onNouvelleConversation,
        onMarquerLu: vi.fn().mockResolvedValue({ ok: true })
      })
    )
  })
  monte.push({ root, container })
  const trouver = (id: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  const cliquer = async (id: string): Promise<void> => {
    const cible = trouver(id)
    expect(cible, `bouton absent : ${id}`).toBeTruthy()
    await act(async () => {
      cible!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }
  const saisir = async (id: string, texte: string): Promise<void> => {
    const champ = trouver(id) as HTMLInputElement | HTMLTextAreaElement
    expect(champ, `champ absent : ${id}`).toBeTruthy()
    const prototype =
      champ instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    await act(async () => {
      setter?.call(champ, texte)
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  /** Ouvre l'ecran « nouveau message » et rend sa zone de depot. */
  const ouvrirNouveau = async (): Promise<HTMLElement> => {
    await cliquer('home-contact-zoe@ex.fr')
    await cliquer('home-inter-nouveau')
    const zone = trouver('home-inter-nouveau-depot')
    expect(zone, 'zone de depot absente').toBeTruthy()
    return zone!
  }
  const lacher = async (zone: HTMLElement, fichiers: File[]): Promise<void> => {
    await act(async () => {
      zone.dispatchEvent(evenementDepot('dragenter', fichiers))
      zone.dispatchEvent(evenementDepot('dragover', fichiers))
      zone.dispatchEvent(evenementDepot('drop', fichiers))
    })
  }
  return { container, onNouvelleConversation, trouver, cliquer, saisir, ouvrirNouveau, lacher }
}

describe('nouveau message : glisser-deposer un fichier', () => {
  it('ACCEPTE le survol : sans preventDefault, le navigateur refuse le lacher', async () => {
    // C'est la panne signalee : le curseur « Copier » s'affiche (defaut du navigateur) et rien ne
    // se passe au lacher, parce que personne n'a dit au navigateur que ce depot etait accepte.
    const { ouvrirNouveau } = monter()
    const zone = await ouvrirNouveau()
    const survol = evenementDepot('dragover', [pdf()])
    await act(async () => {
      zone.dispatchEvent(survol)
    })
    expect(survol.defaultPrevented).toBe(true)
  })

  it('MONTRE la piece lachee avant le premier clic d envoi', async () => {
    const { ouvrirNouveau, lacher, container } = monter()
    const zone = await ouvrirNouveau()
    await lacher(zone, [pdf()])
    expect(container.textContent).toContain('devis.pdf')
  })

  it('JOINT le fichier lache a l envoi, avec son nom et son contenu', async () => {
    const { ouvrirNouveau, lacher, cliquer, saisir, onNouvelleConversation } = monter()
    const zone = await ouvrirNouveau()
    await lacher(zone, [pdf()])
    await saisir('home-inter-nouveau-objet', 'Devis 2027')
    await saisir('home-inter-nouveau-message', 'Le devis est joint.')
    await cliquer('home-inter-nouveau-envoyer')
    await cliquer('home-inter-nouveau-confirmer')
    expect(onNouvelleConversation).toHaveBeenCalledWith(
      'zoe@ex.fr',
      'Devis 2027',
      'Le devis est joint.',
      [{ nom: 'devis.pdf', taille: 5, contenuBase64: 'JVBERi0=' }]
    )
  })

  it('REPREND la confirmation quand une piece arrive apres elle', async () => {
    // Un envoi confirme ne doit pas gagner une piece jointe entre les deux clics : ce qui part
    // serait autre chose que ce qui a ete confirme.
    const { ouvrirNouveau, lacher, cliquer, saisir, trouver, onNouvelleConversation } = monter()
    const zone = await ouvrirNouveau()
    await saisir('home-inter-nouveau-objet', 'Devis')
    await saisir('home-inter-nouveau-message', 'Premier jet')
    await cliquer('home-inter-nouveau-envoyer')
    expect(trouver('home-inter-nouveau-confirmer')).toBeTruthy()
    await lacher(zone, [pdf()])
    expect(trouver('home-inter-nouveau-confirmer')).toBeNull()
    expect(onNouvelleConversation).not.toHaveBeenCalled()
  })

  it('AFFICHE le refus d un fichier trop gros : aucun echec muet', async () => {
    const { ouvrirNouveau, lacher, container } = monter()
    const zone = await ouvrirNouveau()
    const enorme = pdf('enorme.pdf', new Uint8Array(0))
    Object.defineProperty(enorme, 'size', { value: 11 * 1024 * 1024 })
    await lacher(zone, [enorme])
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/10 Mo/)
  })

  it('RETIRE une piece jointe posee par erreur', async () => {
    const { ouvrirNouveau, lacher, cliquer, container } = monter()
    const zone = await ouvrirNouveau()
    await lacher(zone, [pdf()])
    await cliquer('home-inter-nouveau-piece-retirer-0')
    expect(container.textContent).not.toContain('devis.pdf')
  })
})
