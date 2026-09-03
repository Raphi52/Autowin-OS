// @vitest-environment happy-dom
/**
 * La NAVIGATION de la tuile Interlocuteurs : trois écrans, un retour à chaque cran, un envoi.
 *
 * Ce que ce fichier protège : la demande de l'utilisateur du 2026-09-03 tient entièrement dans un
 * enchaînement (noms → fils → conversation → réponse) et dans la présence du retour à CHAQUE étape.
 * Un test par écran isolé laisserait passer la régression la plus probable : un retour qui saute
 * directement à la liste des noms depuis la conversation.
 *
 * Rendu avec `react-dom` et `act`, comme le reste des tests de cette vue : le dépôt n'embarque pas
 * `@testing-library/react`, et l'ajouter pour un seul fichier ferait payer une dépendance à tous.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InterlocuteursWidget } from './InterlocuteursWidget'
import type { Interlocuteur, MessageInterlocuteur } from './outlook-model'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 8, 3, 12, 0, 0).getTime()
const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(() => {
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

function message(part: Partial<MessageInterlocuteur> & { id: string }): MessageInterlocuteur {
  return {
    sujet: 'Devis',
    corps: 'corps',
    recuLe: NOW - 3_600_000,
    nonLu: false,
    deMoi: false,
    auteur: 'Zoé Martin',
    fil: 'devis',
    ...part
  }
}

const zoe: Interlocuteur = {
  echange: true,
  cle: 'zoe@ex.fr',
  nom: 'Zoé Martin',
  adresse: 'zoe@ex.fr',
  dernierNomRecu: NOW,
  nonLus: 0,
  dernierEchange: NOW,
  messages: [
    message({ id: 'm2', corps: 'Ma réponse', deMoi: true, auteur: 'moi', recuLe: NOW - 60_000 }),
    message({ id: 'm1', corps: 'Bonjour, votre devis ?' }),
    message({
      id: 'a1',
      sujet: 'Facture',
      fil: 'facture',
      corps: 'La facture',
      recuLe: NOW - 7_200_000
    })
  ]
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
        onRepondre
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
  // React garde sa propre copie de la valeur du champ : ecrire `champ.value` directement ne la lui
  // apprend pas, l'evenement passe pour un non-changement et l'etat reste vide. On passe donc par le
  // setter natif de la propriete, seule facon de faire voir la frappe a React sans testing-library.
  const saisir = async (id: string, texte: string): Promise<void> => {
    const champ = trouver(id) as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set
    await act(async () => {
      setter?.call(champ, texte)
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  return { container, onRepondre, trouver, cliquer, saisir }
}

describe('InterlocuteursWidget', () => {
  it('enchaine les trois ecrans, et le retour remonte UN cran a la fois', async () => {
    const { container, trouver, cliquer } = monter()

    // Écran 1 : les noms. Pas de retour ici, il n'y a pas d'étape précédente.
    expect(trouver('home-contact-zoe@ex.fr')).toBeTruthy()
    expect(trouver('home-inter-retour')).toBeNull()

    await cliquer('home-contact-zoe@ex.fr')

    // Écran 2 : les fils de CETTE personne, en plein widget — la liste des noms a disparu.
    expect(trouver('home-contact-zoe@ex.fr')).toBeNull()
    expect(trouver('home-fil-devis')).toBeTruthy()
    expect(trouver('home-fil-facture')).toBeTruthy()
    expect(trouver('home-inter-retour')).toBeTruthy()

    await cliquer('home-fil-devis')

    // Écran 3 : le fil choisi seul, du plus ancien au plus récent, et mes messages à droite.
    const bulles = [...container.querySelectorAll('[data-testid="home-inter-conversation"] li')]
    expect(bulles.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Bonjour, votre devis ?'),
      expect.stringContaining('Ma réponse')
    ])
    expect(bulles.map((li) => li.getAttribute('data-moi'))).toEqual([null, 'true'])

    // Le retour rend l'écran 2, PAS l'écran 1.
    await cliquer('home-inter-retour')
    expect(trouver('home-fil-devis')).toBeTruthy()
    expect(trouver('home-inter-conversation')).toBeNull()

    await cliquer('home-inter-retour')
    expect(trouver('home-contact-zoe@ex.fr')).toBeTruthy()
  })

  it('repond en deux temps, et accroche la reponse au dernier message RECU', async () => {
    const { container, onRepondre, cliquer, saisir } = monter()
    await cliquer('home-contact-zoe@ex.fr')
    await cliquer('home-fil-devis')

    await saisir('home-inter-saisie', 'Le voici')
    await cliquer('home-inter-envoyer')
    // Un clic ne suffit pas : un envoi part chez quelqu'un et ne se rattrape pas.
    expect(onRepondre).not.toHaveBeenCalled()

    await cliquer('home-inter-confirmer')
    // `m1`, le dernier message RECU — pas `m2`, qui est mon propre envoi.
    expect(onRepondre).toHaveBeenCalledWith('m1', 'Le voici')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('envoyée')
  })

  it('affiche la cause reelle quand Outlook refuse l envoi', async () => {
    const { container, cliquer, saisir } = monter(
      vi.fn().mockResolvedValue({ ok: false, erreur: 'Outlook est fermé.' })
    )
    await cliquer('home-contact-zoe@ex.fr')
    await cliquer('home-fil-devis')
    await saisir('home-inter-saisie', 'Le voici')
    await cliquer('home-inter-envoyer')
    await cliquer('home-inter-confirmer')

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Outlook est fermé.')
  })
})
