// @vitest-environment happy-dom
/**
 * GLISSER-DEPOSER une piece jointe dans l'ecran de REPONSE de la tuile Interlocuteurs.
 *
 * Demande de l'utilisateur du 2026-09-09 : « Ca marche bien pour les nouveau fils de message ! [...]
 * Il faudrait aussi que ca marche pour les messages de reponse ». Le glisser-deposer livre la veille
 * ne vivait que dans `EcranNouveau` ; `EcranConversation` n'avait AUCUN gestionnaire, donc Chromium
 * y affichait son curseur « Copier » puis abandonnait le lacher — le meme symptome, au meme endroit
 * de la chaine, sur l'autre ecran.
 *
 * Ce fichier garde les deux moities de la panne, comme son jumeau du nouveau message :
 *  - le `dragover` est ACCEPTE (`defaultPrevented`), sinon le lacher n'arrive jamais ;
 *  - le fichier lache ARRIVE dans l'appel de reponse, en TROISIEME argument, avec nom et contenu.
 *
 * L'entree qui rend ce fichier ROUGE si la correction est fausse : lacher `devis.pdf` sur la zone
 * `home-inter-reponse-depot` puis envoyer. Si `EcranConversation` garde ses pieces pour lui — le
 * defaut le plus probable, parce que `onRepondre` n'acceptait que deux arguments —, `onRepondre` est
 * appele avec `(id, corps)` et l'assertion sur le troisieme argument tombe.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InterlocuteursWidget } from './InterlocuteursWidget'
import type { Interlocuteur } from './outlook-model'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 8, 9, 12, 0, 0).getTime()
const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(() => {
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

/** Un fil qui contient un message RECU : sans lui, il n'y a rien a quoi repondre. */
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
      id: 'AABBCCDDEEFF0011',
      sujet: 'Devis',
      corps: 'Pouvez-vous me renvoyer le devis ?',
      recuLe: NOW - 3_600_000,
      nonLu: false,
      deMoi: false,
      auteur: 'Zoé Martin',
      fil: 'devis'
    }
  ]
}

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

function monter(onRepondre = vi.fn().mockResolvedValue({ ok: true })) {
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
        onRepondre,
        onNouvelleConversation: vi.fn().mockResolvedValue({ ok: true }),
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
  /** Ouvre le fil existant et rend la zone de depot de l'ecran de REPONSE. */
  const ouvrirFil = async (): Promise<HTMLElement> => {
    await cliquer('home-contact-zoe@ex.fr')
    await cliquer('home-fil-devis')
    const zone = trouver('home-inter-reponse-depot')
    expect(zone, 'zone de depot absente dans l ecran de reponse').toBeTruthy()
    return zone!
  }
  const lacher = async (zone: HTMLElement, fichiers: File[]): Promise<void> => {
    await act(async () => {
      zone.dispatchEvent(evenementDepot('dragenter', fichiers))
      zone.dispatchEvent(evenementDepot('dragover', fichiers))
      zone.dispatchEvent(evenementDepot('drop', fichiers))
    })
  }
  return { container, onRepondre, trouver, cliquer, saisir, ouvrirFil, lacher }
}

describe('reponse a un fil : glisser-deposer un fichier', () => {
  it('ACCEPTE le survol : sans preventDefault, le navigateur refuse le lacher', async () => {
    const { ouvrirFil } = monter()
    const zone = await ouvrirFil()
    const survol = evenementDepot('dragover', [pdf()])
    await act(async () => {
      zone.dispatchEvent(survol)
    })
    expect(survol.defaultPrevented).toBe(true)
  })

  it('MONTRE la piece lachee avant le premier clic d envoi', async () => {
    const { ouvrirFil, lacher, container, trouver } = monter()
    const zone = await ouvrirFil()
    await lacher(zone, [pdf()])
    expect(trouver('home-inter-reponse-pieces')).toBeTruthy()
    expect(container.textContent).toContain('devis.pdf')
  })

  it('JOINT le fichier lache a la REPONSE, avec son nom et son contenu', async () => {
    const { ouvrirFil, lacher, cliquer, saisir, onRepondre } = monter()
    const zone = await ouvrirFil()
    await lacher(zone, [pdf()])
    await saisir('home-inter-saisie', 'Le devis est joint.')
    await cliquer('home-inter-envoyer')
    await cliquer('home-inter-confirmer')
    expect(onRepondre).toHaveBeenCalledWith('AABBCCDDEEFF0011', 'Le devis est joint.', [
      { nom: 'devis.pdf', taille: 5, contenuBase64: 'JVBERi0=' }
    ])
  })

  it('n envoie AUCUNE piece quand rien n a ete lache', async () => {
    // Une reponse sans piece doit partir exactement comme avant : la liste est vide, pas absente.
    const { ouvrirFil, cliquer, saisir, onRepondre } = monter()
    await ouvrirFil()
    await saisir('home-inter-saisie', 'Merci !')
    await cliquer('home-inter-envoyer')
    await cliquer('home-inter-confirmer')
    expect(onRepondre).toHaveBeenCalledWith('AABBCCDDEEFF0011', 'Merci !', [])
  })

  it('REPREND la confirmation quand une piece arrive apres elle', async () => {
    // Un envoi confirme ne doit pas gagner une piece jointe entre les deux clics : ce qui part
    // serait autre chose que ce qui a ete confirme.
    const { ouvrirFil, lacher, cliquer, saisir, trouver, onRepondre } = monter()
    const zone = await ouvrirFil()
    await saisir('home-inter-saisie', 'Premier jet')
    await cliquer('home-inter-envoyer')
    expect(trouver('home-inter-confirmer')).toBeTruthy()
    await lacher(zone, [pdf()])
    expect(trouver('home-inter-confirmer')).toBeNull()
    expect(onRepondre).not.toHaveBeenCalled()
  })

  it('AFFICHE le refus d un fichier trop gros : aucun echec muet', async () => {
    const { ouvrirFil, lacher, container } = monter()
    const zone = await ouvrirFil()
    const enorme = pdf('enorme.pdf', new Uint8Array(0))
    Object.defineProperty(enorme, 'size', { value: 11 * 1024 * 1024 })
    await lacher(zone, [enorme])
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/10 Mo/)
  })

  it('RETIRE une piece jointe posee par erreur', async () => {
    const { ouvrirFil, lacher, cliquer, container } = monter()
    const zone = await ouvrirFil()
    await lacher(zone, [pdf()])
    await cliquer('home-inter-reponse-piece-retirer-0')
    expect(container.textContent).not.toContain('devis.pdf')
  })

  it('OUBLIE les pieces apres un envoi reussi : la reponse suivante repart vide', async () => {
    // Sans cela, le PDF du message precedent repartirait dans le suivant sans que rien ne le montre.
    const { ouvrirFil, lacher, cliquer, saisir, container, onRepondre } = monter()
    const zone = await ouvrirFil()
    await lacher(zone, [pdf()])
    await saisir('home-inter-saisie', 'Le voici')
    await cliquer('home-inter-envoyer')
    await cliquer('home-inter-confirmer')
    expect(onRepondre).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('devis.pdf')
  })
})
