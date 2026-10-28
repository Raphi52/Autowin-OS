// @vitest-environment happy-dom
import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-force-graph-3d', () => ({
  default: forwardRef(function FakeForceGraph(_props: unknown, ref) {
    useImperativeHandle(ref, () => ({
      cameraPosition: vi.fn().mockReturnValue({ x: 0, y: 0, z: 100 }),
      d3Force: (name: string) => (name === 'link' ? { distance: vi.fn() } : { strength: vi.fn() }),
      d3ReheatSimulation: vi.fn(),
      controls: () => ({ mouseButtons: {}, touches: {}, update: vi.fn() }),
      pauseAnimation: vi.fn(),
      refresh: vi.fn(),
      resumeAnimation: vi.fn(),
      scene: () => ({ add: vi.fn(), remove: vi.fn() }),
      zoomToFit: vi.fn()
    }))
    return createElement('div', { 'data-testid': 'force-graph' })
  })
}))

import { GraphView } from './GraphView'
import { KnowledgeInboxPanel, type InboxCandidateView } from './KnowledgeInboxPanel'
import { BrainRetrievalBench } from './BrainRetrievalBench'
import { NodePanel } from './GraphView.panels'
import { brainSubjectOf, libelleDeSujet } from './graph-brain-categories'
import { brainScoreChannelLabel } from './graph-view-model'
import { appliquerLangue } from '../langue'

/**
 * L'ÉCRAN KNOWLEDGE SUIT LA LANGUE (traduction anglaise, conv-1170, lot « Knowledge »). Entrée qui
 * doit faire échouer ce test : un libellé de la vue Memory, de la boîte de réception, du banc d'essai
 * ou du panneau de nœud laissé en dur, un écran qui ne se redessine pas quand la langue change, ou un
 * nom de sujet traduit dans l'IDENTIFIANT de l'arbre (le code le relit : branches repliées, tests).
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let hote: HTMLDivElement | null = null

const vider = (): Promise<void> =>
  act(async () => {
    for (let rang = 0; rang < 12; rang += 1) await Promise.resolve()
  })

function candidat(over: Partial<InboxCandidateView> = {}): InboxCandidateView {
  return {
    id: 'inbox/a',
    file: 'C:/brain/inbox/a.md',
    title: 'Promotion humaine',
    body: 'corps du candidat',
    bodyTruncated: false,
    nearDuplicates: [],
    warnings: [],
    ageDays: 3,
    ...over
  }
}

function installerApi(): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    listBrains: vi
      .fn()
      .mockResolvedValue([
        { id: 'brain', label: 'Brain', path: 'C:\\brain', sizeMb: 1, kind: 'vault' }
      ]),
    loadBrainGraphPreview: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    loadBrainGraph: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
    loadBrainThemes: vi.fn().mockResolvedValue([]),
    loadBrainThemeNodes: vi.fn().mockResolvedValue([]),
    refreshBrain: vi.fn().mockResolvedValue({ ok: true }),
    searchBrain: vi.fn(),
    listInbox: vi.fn().mockResolvedValue([candidat()]),
    readInboxCandidateBody: vi.fn().mockResolvedValue({ id: 'inbox/a', body: 'corps' }),
    promoteInbox: vi.fn().mockResolvedValue({ ok: true }),
    rejectInbox: vi.fn().mockResolvedValue({ ok: true })
  }
}

async function monter(element: React.ReactElement): Promise<HTMLDivElement> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => root!.render(element))
  await vider()
  return hote
}

const attribut = (zone: HTMLElement, selecteur: string, nom: string): string | null | undefined =>
  zone.querySelector(selecteur)?.getAttribute(nom)

beforeEach(() => {
  localStorage.clear()
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }) as never
  installerApi()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  appliquerLangue('fr')
  vi.restoreAllMocks()
})

describe('écran Knowledge — langue', () => {
  it('la vue Memory bascule en anglais sans être remontée, puis revient au français', async () => {
    const vue = await monter(createElement(GraphView, { active: true, onCleanMemory: vi.fn() }))
    const champ = '.theme-sidebar input'
    expect(vue.textContent).toContain('Explore les connaissances reliées de ton Brain.')
    expect(attribut(vue, champ, 'aria-label')).toBe('Rechercher un thème ou une fiche')
    expect(attribut(vue, champ, 'placeholder')).toBe('Thème ou fiche…')
    expect(attribut(vue, '.graph-settings-button', 'aria-label')).toBe('Réglages de visibilité')
    expect(vue.querySelector('.sidebar-heading')?.textContent).toBe('RechercherEffacer')
    expect(vue.querySelector('.graph-status--empty span')?.textContent).toBe(
      'Aucun nœud disponible pour ce graphe.'
    )

    await act(async () => appliquerLangue('en'))
    expect(vue.textContent).toContain('Explore the linked knowledge of your Brain.')
    expect(vue.textContent).toContain('0 nodes')
    expect(attribut(vue, champ, 'aria-label')).toBe('Search for a theme or a note')
    expect(attribut(vue, champ, 'placeholder')).toBe('Theme or note…')
    expect(attribut(vue, '.graph-settings-button', 'aria-label')).toBe('Visibility settings')
    expect(attribut(vue, '.graph-workbench-button', 'aria-label')).toBe('Knowledge workbench')
    expect(vue.querySelector('.sidebar-heading')?.textContent).toBe('SearchClear')
    expect(vue.querySelector('.theme-filter span')?.textContent).toBe('All themes')
    expect(vue.querySelector('.graph-status--empty span')?.textContent).toBe(
      'No node available for this graph.'
    )
    expect(vue.querySelector('.graph-hint')?.textContent).toMatch(/^Drag: (rotate|pan) · wheel/)

    await act(async () => appliquerLangue('fr'))
    expect(attribut(vue, champ, 'placeholder')).toBe('Thème ou fiche…')
    expect(vue.querySelector('.theme-filter span')?.textContent).toBe('Tous les thèmes')
  })

  it('la boîte de réception et le banc d’essai suivent la langue', async () => {
    const zone = await monter(
      createElement('div', null, [
        createElement(KnowledgeInboxPanel, { key: 'boite', brainPath: 'C:/brain' }),
        createElement(BrainRetrievalBench, { key: 'banc', brainPath: 'C:/brain' })
      ])
    )
    const boite = (): HTMLElement => zone.querySelector('.knowledge-inbox')!
    expect(boite().getAttribute('aria-label')).toBe('Boîte de réception du savoir')
    expect(zone.querySelector('.knowledge-inbox__head strong')?.textContent).toBe('1 candidat')
    expect(zone.querySelector('.knowledge-inbox__list small')?.textContent).toBe(
      'déposé il y a 3 jours'
    )
    expect(zone.querySelector('.brain-bench__head span')?.textContent).toBe(
      'Banc d’essai de récupération'
    )

    await act(async () => appliquerLangue('en'))
    expect(boite().getAttribute('aria-label')).toBe('Knowledge inbox')
    expect(zone.querySelector('.knowledge-inbox__head span')?.textContent).toBe('Inbox')
    expect(zone.querySelector('.knowledge-inbox__head strong')?.textContent).toBe('1 candidate')
    expect(zone.querySelector('.knowledge-inbox__list small')?.textContent).toBe(
      'submitted 3 days ago'
    )
    expect(zone.querySelector('.is-promote')?.textContent).toBe('Promote')
    expect(zone.querySelector('.is-reject')?.textContent).toBe('Reject')
    expect(zone.querySelector('.knowledge-inbox__actions small')?.textContent).toBe(
      'Promoting moves the note into knowledge/; rejecting sends it to .trash/ — reversible, nothing is deleted.'
    )
    expect(zone.querySelector('.brain-bench__head span')?.textContent).toBe('Retrieval test bench')
    expect(attribut(zone, '.brain-bench__ask input', 'placeholder')).toBe(
      'Ask the knowledge a question…'
    )

    await act(async () => appliquerLangue('fr'))
    expect(zone.querySelector('.knowledge-inbox__head strong')?.textContent).toBe('1 candidat')
    expect(zone.querySelector('.knowledge-inbox__actions small')?.textContent).toBe(
      'Promouvoir déplace la fiche dans knowledge/ ; rejeter l’envoie dans .trash/ — réversible, rien n’est supprimé.'
    )
  })

  it('le panneau de nœud et ses scores suivent la langue', async () => {
    const noeud = {
      id: 'knowledge/a',
      label: 'Fiche A',
      group: 0,
      denseScore: 0.42,
      graphScore: 0.1235
    }
    appliquerLangue('en')
    const panneau = await monter(
      createElement(NodePanel, {
        node: noeud,
        file: null,
        fileErr: '',
        linkedNodes: [],
        onNavigate: vi.fn(),
        onClose: vi.fn()
      })
    )
    expect(panneau.querySelector('.node-links__heading strong')?.textContent).toBe('Links')
    expect(panneau.textContent).toContain('No associated file')
    expect(panneau.querySelector('.node-panel__details summary')?.textContent).toBe('Node details')
    expect(brainScoreChannelLabel(noeud)).toBe('dense 0.420 · lexical — · graph 0.123 · fusion —')

    await act(async () => appliquerLangue('fr'))
    expect(panneau.querySelector('.node-links__heading strong')?.textContent).toBe('Liens')
    expect(brainScoreChannelLabel(noeud)).toBe('dense 0,420 · lexical — · graphe 0,123 · fusion —')
  })

  it('un sujet de l’arbre se traduit à l’affichage, jamais dans son identifiant', () => {
    appliquerLangue('en')
    const sujet = brainSubjectOf({ id: 'divers/x', file: 'divers/x.md', themes: [] })
    expect(sujet).toBe('Transverse')
    expect(libelleDeSujet(sujet, 'en')).toBe('Cross-cutting')
    expect(libelleDeSujet(sujet, 'fr')).toBe('Transverse')
    expect(libelleDeSujet('knowledge', 'en')).toBe('knowledge')
  })
})
