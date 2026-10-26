// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ChatComposer, type ChatComposerProps } from './ChatComposer'
import { appliquerLangue } from '../langue'

/**
 * LA ZONE DE SAISIE SUIT LA LANGUE (conv-1146, lot 1). Entrée qui doit faire échouer ce test : un
 * libellé du composer laissé en dur, ou un composer qui ne se redessine pas quand la langue change.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const proprietes = (over: Partial<ChatComposerProps> = {}): ChatComposerProps => ({
  busy: false,
  hasActiveConversation: true,
  resumeAvailable: false,
  attachmentCount: 0,
  mentionSources: { runs: [], files: [] } as never,
  skillCommands: [],
  ghostRecommendation: null,
  placeholderPendantTour: false,
  onDraftInput: () => {},
  onDraftPresence: () => {},
  onBtw: () => false,
  onSend: () => {},
  onQueue: () => {},
  onResume: () => {},
  onPaste: () => {},
  ...over
})

let root: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(props: ChatComposerProps): Promise<HTMLDivElement> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => root!.render(<ChatComposer {...props} />))
  return hote
}

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  appliquerLangue('fr')
})

describe('zone de saisie du chat — langue', () => {
  it('bascule en anglais sans être remontée, puis revient au français', async () => {
    const zone = await monter(proprietes())
    const champ = () => zone.querySelector('textarea')!
    const envoyer = () => zone.querySelector('[data-testid="composer-send"]')!
    expect(champ().getAttribute('placeholder')).toBe('Écrire à l’agent ou déposer des fichiers…')
    expect(envoyer().getAttribute('aria-label')).toBe('Envoyer le message')

    await act(async () => appliquerLangue('en'))
    expect(champ().getAttribute('placeholder')).toBe('Write to the agent or drop files…')
    expect(envoyer().getAttribute('aria-label')).toBe('Send the message')
    expect(envoyer().textContent).toContain('Send')
    expect(
      zone.querySelector('[data-testid="composer-dictee"]')?.getAttribute('aria-label')
    ).toMatch(/^(Dictate with the microphone|Install speech recognition \(local Whisper\))$/)

    await act(async () => appliquerLangue('fr'))
    expect(champ().getAttribute('placeholder')).toBe('Écrire à l’agent ou déposer des fichiers…')
  })

  it('pendant un tour : « Steer », et le champ dit qu’on oriente sans interrompre', async () => {
    appliquerLangue('en')
    const zone = await monter(proprietes({ busy: true, placeholderPendantTour: true }))
    expect(zone.querySelector('textarea')?.getAttribute('placeholder')).toBe(
      'Steer the agent without interrupting it (Enter)'
    )
    expect(zone.querySelector('[data-testid="composer-send"]')?.textContent).toContain('Steer')
  })
})
