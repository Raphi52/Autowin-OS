// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./components/ChatView', () => ({ ChatView: () => createElement('div') }))
vi.mock('./components/ObservatoryView', () => ({ ObservatoryView: () => null }))
vi.mock('./components/TicketsView', () => ({ TicketsView: () => null }))
vi.mock('./components/AgentStudioView', () => ({ AgentStudioView: () => null }))
vi.mock('./components/KnowledgeView', () => ({ KnowledgeView: () => null }))
vi.mock('./components/SettingsView', () => ({ SettingsView: () => null }))
vi.mock('./components/ModelQuestionPopup', () => ({ ModelQuestionPopup: () => null }))

import { MainApp } from './App'
import { reclamerOuvertureConversation } from './components/pending-conversation-open'

/**
 * CLIC SUR LA NOTIFICATION DE FIN DE TOUR (conv-1038, 2026-10-21) : le main émet
 * `open-conversation` ; l'interface doit ouvrir CE fil, que le chat ait déjà été monté ou non.
 */
type Ecouteur = (event: { type: string; convId?: string; texte?: string }) => void

async function monter(ongletInitial: string): Promise<{
  emettre: Ecouteur
  appCommand: ReturnType<typeof vi.fn>
  root: Root
}> {
  let ecouteur: Ecouteur = () => {}
  const appCommand = vi.fn(async () => ({ ok: true }))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      storageMigration: vi.fn().mockResolvedValue({}),
      completeStorageMigration: vi.fn().mockResolvedValue(true),
      appState: vi.fn(async () => ({ tab: ongletInitial })),
      appCommand,
      onAppEvent: vi.fn((cb: Ecouteur) => {
        ecouteur = cb
        return vi.fn()
      })
    }
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(MainApp))
    await Promise.resolve()
    await Promise.resolve()
  })
  return { emettre: (event) => ecouteur(event), appCommand, root }
}

describe('notification de fin de tour → ouverture du fil', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    reclamerOuvertureConversation()
    document.body.replaceChildren()
    localStorage.clear()
  })

  it('chat jamais monté (accueil) : la demande est DÉPOSÉE pour le montage du chat', async () => {
    const { emettre, root } = await monter('accueil')
    await act(async () => {
      emettre({ type: 'open-conversation', convId: 'conv-7' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(reclamerOuvertureConversation()).toBe('conv-7')
    await act(async () => root.unmount())
  })

  it('chat déjà monté : l’événement d’ouverture part, et RIEN ne reste déposé', async () => {
    const { emettre, root } = await monter('chat')
    const recus: unknown[] = []
    const ecoute = (event: Event): void => {
      recus.push((event as CustomEvent).detail)
    }
    window.addEventListener('autowin:open-conversation', ecoute)
    await act(async () => {
      emettre({ type: 'open-conversation', convId: 'conv-7' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    window.removeEventListener('autowin:open-conversation', ecoute)
    expect(recus).toEqual([{ conversationId: 'conv-7' }])
    expect(reclamerOuvertureConversation()).toBeNull()
    await act(async () => root.unmount())
  })
})

/*
 * BOUTON DE SUITE DE LA NOTIFICATION (conv-1038) : le chat monté l'envoie lui-même. Chat JAMAIS
 * monté, personne ne peut l'envoyer : la suite ne doit pas se perdre en silence — elle attend dans
 * le brouillon de CE fil, APRÈS ce qui y était déjà écrit, et le fil s'ouvre au montage du chat.
 */
describe('notification de fin de tour → bouton de suite', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    reclamerOuvertureConversation()
    document.body.replaceChildren()
    localStorage.clear()
  })

  it('chat jamais monté : la suite attend dans le brouillon du fil, sans écraser l’existant', async () => {
    localStorage.setItem('autowin.chat.brouillons', JSON.stringify({ 'conv-7': 'mon brouillon' }))
    const { emettre, root } = await monter('accueil')
    await act(async () => {
      emettre({ type: 'suite-depuis-notification', convId: 'conv-7', texte: 'Lance le juge' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(JSON.parse(localStorage.getItem('autowin.chat.brouillons') ?? '{}')).toEqual({
      'conv-7': 'mon brouillon\n\nLance le juge'
    })
    expect(reclamerOuvertureConversation()).toBe('conv-7')
    await act(async () => root.unmount())
  })

  it('chat déjà monté : rien n’est déposé ni écrit, le chat envoie la suite lui-même', async () => {
    const { emettre, root } = await monter('chat')
    await act(async () => {
      emettre({ type: 'suite-depuis-notification', convId: 'conv-7', texte: 'Lance le juge' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(localStorage.getItem('autowin.chat.brouillons')).toBeNull()
    expect(reclamerOuvertureConversation()).toBeNull()
    await act(async () => root.unmount())
  })
})
