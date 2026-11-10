// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ChatComposer, type ChatComposerProps } from './ChatComposer'

/**
 * LE CHAMP DE SAISIE SIGNALE « ULTRATHINK » DÈS QU'IL EST RECONNU. Entrée qui doit faire échouer
 * ce test : un signal absent quand le mot est tapé, affiché sans lui, ou affiché quand le mot est
 * seulement cité (entre accents graves) et que le tour ne montera donc pas.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const proprietes = (): ChatComposerProps => ({
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
  onPaste: () => {}
})

let root: Root | null = null
let hote: HTMLDivElement | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
})

async function monterEtTaper(): Promise<{
  taper: (valeur: string) => Promise<void>
  signal: () => Element | null
}> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => root!.render(<ChatComposer {...proprietes()} />))
  const zone = hote
  const champ = zone.querySelector('textarea') as HTMLTextAreaElement
  return {
    taper: async (valeur) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
          champ,
          valeur
        )
        champ.dispatchEvent(new Event('input', { bubbles: true }))
      })
    },
    signal: () => zone.querySelector('[data-testid="composer-ultrathink"]')
  }
}

describe('zone de saisie du chat — ultrathink', () => {
  it('affiche le signal quand le mot-clé est tapé, et le retire quand il est effacé', async () => {
    const { taper, signal } = await monterEtTaper()
    expect(signal()).toBeNull()
    await taper('ultrathink pourquoi ce test échoue')
    expect(signal()?.textContent).toBe('ultrathink réflexion poussée pour ce message')
    await taper('pourquoi ce test échoue')
    expect(signal()).toBeNull()
  })

  it('n’affiche rien quand le mot est seulement cité', async () => {
    const { taper, signal } = await monterEtTaper()
    await taper('que fait `ultrathink` dans Claude Code')
    expect(signal()).toBeNull()
  })
})
