// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CarteDesBesoinsView } from './CarteDesBesoinsView'
import { reclamerOuvertureConversation } from './pending-conversation-open'
import type {
  BilanDesMentions,
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte
} from '../../../shared/carte-des-besoins'

/**
 * LA VUE BRANCHE LES TASKS (option E du cadrage conv-1127). ENTRÉES QUI DOIVENT FAIRE ÉCHOUER :
 * une ouverture qui ne lance pas la lecture des `#1234` ; une carte non recalculée après une passe
 * qui a lu des fiches ; une source injoignable passée sous silence ; un rattachement qui vise une
 * autre demande que celle de la fiche, ou qui ne recalcule pas la carte.
 */

const MAINTENANT = Date.now()

const demande = (extra: Partial<DemandeDeLaCarte> = {}): DemandeDeLaCarte => ({
  conversationId: 'conv-7',
  conversationTitre: 'Fil conv-7',
  rang: 0,
  messageId: 'm0',
  titre: 'corrige #1234',
  statut: 'prouve',
  constat: 'npm test → exit 0',
  debut: MAINTENANT - 3_600_000,
  ...extra
})

function carte(d: DemandeDeLaCarte): CarteDesBesoins {
  const projet = {
    cle: 'P',
    libelle: 'P',
    nature: 'dossier',
    conversations: 1,
    demandes: [d],
    runsBloques: [],
    comptes: { prouve: 1, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: 1,
    runsBloques: 0,
    conversationsLues: 1,
    demandeurs: [],
    demandesJournalisees: 0,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

const LIEE = demande({
  workItems: [{ sourceId: 'azure:s', id: '1234', titre: 'Corriger X', origine: 'mention' }]
})

describe('CarteDesBesoinsView — tasks', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
    reclamerOuvertureConversation()
  })

  async function monter(
    bilan: BilanDesMentions,
    sources: { profile: { id: string; label: string }; credentialConfigured: boolean }[] = []
  ) {
    let appels = 0
    const api = {
      ticketSources: vi.fn(async () => sources),
      // Premier calcul : la mention n'est qu'un candidat ; après la passe, elle est liée.
      carteDesBesoins: vi.fn(async () => carte((appels += 1) === 1 ? demande() : LIEE)),
      carteVerifierMentions: vi.fn(async () => bilan),
      carteLierWorkItem: vi.fn(async () => ({
        ok: true as const,
        workItem: { sourceId: 'azure:s', id: '5678', origine: 'manuel' as const }
      })),
      carteDelierWorkItem: vi.fn(async () => ({ ok: true as const }))
    }
    ;(window as unknown as { api: unknown }).api = api
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () =>
      root.render(createElement(CarteDesBesoinsView, { active: true, onOpenConversation: vi.fn() }))
    )
    return { el, api }
  }

  it('à l’ouverture : lit les #1234 à la source, puis recalcule la carte qui montre la task', async () => {
    const { el, api } = await monter({
      lues: 1,
      liees: 1,
      introuvables: 0,
      injoignable: false,
      restantes: 0
    })
    expect(api.carteVerifierMentions).toHaveBeenCalledTimes(1)
    expect(api.carteDesBesoins).toHaveBeenCalledTimes(2)
    await act(async () => el.querySelector<HTMLElement>('[data-conversation="conv-7"]')!.click())
    expect(el.querySelector('[data-testid="tache"]')?.textContent).toContain('#1234')
  })

  it('source injoignable : pas de recalcul, et la vue le dit', async () => {
    const { el, api } = await monter({
      lues: 0,
      liees: 0,
      introuvables: 0,
      injoignable: true,
      restantes: 1
    })
    expect(api.carteDesBesoins).toHaveBeenCalledTimes(1)
    expect(el.querySelector('[data-testid="besoins-avis-taches"]')?.textContent).toContain(
      'injoignable'
    )
  })

  it('rattacher depuis la fiche vise la demande de la fiche, puis recalcule la carte', async () => {
    const { el, api } = await monter({
      lues: 0,
      liees: 0,
      introuvables: 0,
      injoignable: false,
      restantes: 0
    })
    await act(async () => el.querySelector<HTMLElement>('[data-conversation="conv-7"]')!.click())
    await act(async () => el.querySelector<HTMLElement>('[data-testid="tache-lier"]')!.click())
    const champ = el.querySelector<HTMLInputElement>('[data-testid="tache-saisie"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(champ, '5678')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => el.querySelector<HTMLElement>('[data-testid="tache-valider"]')!.click())
    expect(api.carteLierWorkItem).toHaveBeenCalledWith({
      conversationId: 'conv-7',
      demande: 'm0',
      saisie: '5678'
    })
    expect(api.carteDesBesoins).toHaveBeenCalledTimes(2)
  })

  it('plusieurs sources configurées : la fiche propose de choisir, et la source choisie part', async () => {
    const { el, api } = await monter(
      { lues: 0, liees: 0, introuvables: 0, injoignable: false, restantes: 0 },
      [
        { profile: { id: 'azure:a', label: 'Azure A' }, credentialConfigured: true },
        { profile: { id: 'github:b', label: 'GitHub B' }, credentialConfigured: false }
      ]
    )
    await act(async () => el.querySelector<HTMLElement>('[data-conversation="conv-7"]')!.click())
    await act(async () => el.querySelector<HTMLElement>('[data-testid="tache-lier"]')!.click())
    const liste = el.querySelector<HTMLSelectElement>('[data-testid="tache-source"]')!
    expect([...liste.options].map((o) => o.textContent)).toEqual(['Azure A', 'GitHub B'])
    const choisir = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    await act(async () => {
      choisir?.call(liste, 'github:b')
      liste.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const champ = el.querySelector<HTMLInputElement>('[data-testid="tache-saisie"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(champ, '42')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => el.querySelector<HTMLElement>('[data-testid="tache-valider"]')!.click())
    expect(api.carteLierWorkItem).toHaveBeenCalledWith({
      conversationId: 'conv-7',
      demande: 'm0',
      saisie: '42',
      sourceId: 'github:b'
    })
  })
})
