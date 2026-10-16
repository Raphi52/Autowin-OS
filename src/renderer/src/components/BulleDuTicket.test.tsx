// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BulleDuTicket } from './BulleDuTicket'
import { eclatDuTicket, type TicketTreatmentStatus } from './ticket-treatment'

/**
 * L'ECLAT DE LA BULLE D'UN TICKET (conv-981, 2026-10-16) — le tableau des passages du cadrage. Seul
 * « en cours -> traite » eclate. ENTREES QUI DOIVENT FAIRE ECHOUER : un eclat pose sur `.is-succeeded`
 * en CSS (il jouerait pour chaque ticket deja traite a l'ouverture de la vue), un eclat sur un
 * echec, ou une marque jamais retiree (il rejouerait a chaque retour sur l'onglet).
 */
describe('eclatDuTicket', () => {
  it('en cours -> traite : un eclat', () => {
    expect(eclatDuTicket('running', 'succeeded')).toBe('reussi')
  })
  it('aucun autre passage n eclate', () => {
    expect(eclatDuTicket('', 'succeeded')).toBeNull()
    expect(eclatDuTicket('succeeded', 'succeeded')).toBeNull()
    expect(eclatDuTicket('running', 'failed')).toBeNull()
    expect(eclatDuTicket('running', 'interrupted')).toBeNull()
    expect(eclatDuTicket('failed', 'succeeded')).toBeNull()
    expect(eclatDuTicket('', 'running')).toBeNull()
  })
})

describe('BulleDuTicket', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
  })

  async function bulle(statut?: TicketTreatmentStatus): Promise<{
    bouton: () => HTMLButtonElement
    passer: (s?: TicketTreatmentStatus) => Promise<void>
  }> {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    const rendre = async (s?: TicketTreatmentStatus): Promise<void> => {
      await act(async () => root.render(createElement(BulleDuTicket, { statut: s }, '💬')))
    }
    await rendre(statut)
    return { bouton: () => el.querySelector('button')!, passer: rendre }
  }

  const finDEclat = (nom = 'ticket-eclat'): Event =>
    Object.assign(new Event('animationend', { bubbles: true }), { animationName: nom })

  it('sans traitement : ni classe de statut ni eclat', async () => {
    const { bouton } = await bulle(undefined)
    expect(bouton().className).toBe('ticket-open-conversation')
  })

  it('deja traite a l ouverture de la vue : la couleur, aucun eclat', async () => {
    const { bouton } = await bulle('succeeded')
    expect(bouton().classList.contains('is-succeeded')).toBe(true)
    expect(bouton().classList.contains('is-eclat')).toBe(false)
  })

  it('en cours -> traite : un seul eclat, retire a sa fin, puis plus rien', async () => {
    const { bouton, passer } = await bulle('running')
    await passer('succeeded')
    expect(bouton().classList.contains('is-succeeded')).toBe(true)
    expect(bouton().classList.contains('is-eclat')).toBe(true)
    // La fin d'une AUTRE animation ne retire pas la marque.
    await act(async () => {
      bouton().dispatchEvent(finDEclat('autre'))
    })
    expect(bouton().classList.contains('is-eclat')).toBe(true)
    await act(async () => {
      bouton().dispatchEvent(finDEclat())
    })
    expect(bouton().classList.contains('is-eclat')).toBe(false)
    // Traite reenregistre (nouveau rendu, meme statut) : aucun nouvel eclat.
    await passer('succeeded')
    expect(bouton().classList.contains('is-eclat')).toBe(false)
  })

  it('en cours -> echec ou interrompu : la couleur change, sans eclat (jumeau)', async () => {
    const { bouton, passer } = await bulle('running')
    await passer('failed')
    expect(bouton().classList.contains('is-failed')).toBe(true)
    expect(bouton().classList.contains('is-eclat')).toBe(false)
    const second = await bulle('running')
    await second.passer('interrupted')
    expect(second.bouton().classList.contains('is-eclat')).toBe(false)
  })
})
