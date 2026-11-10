// @vitest-environment happy-dom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerHandle, type ChatComposerProps } from './ChatComposer'

/**
 * LE CHAMP DE SAISIE NE COMPTE « ULTRATHINK » QUE TAPÉ À LA MAIN, comme Claude Code : il le signale
 * avant l'envoi et le déclare à l'app au moment d'envoyer. Entrée qui doit faire échouer ce test :
 * un signal ou une déclaration pour un mot collé, cité, ou posé par l'app (suite proposée, brouillon
 * rendu) — l'app monterait alors seule des tours plus chers — ou aucune déclaration pour un mot tapé.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const declarer = vi.fn(async (_texte: string) => ({ ok: true }))
const onSend = vi.fn()
const onQueue = vi.fn()

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
  onSend,
  onQueue,
  onResume: () => {},
  onPaste: () => {},
  ...over
})

let root: Root | null = null
let hote: HTMLDivElement | null = null

beforeEach(() => {
  declarer.mockClear()
  onSend.mockClear()
  onQueue.mockClear()
  ;(window as never as Record<string, unknown>).api = { declarerUltrathinkTape: declarer }
})

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  delete (window as never as Record<string, unknown>).api
})

async function monter(over: Partial<ChatComposerProps> = {}): Promise<{
  /** Change le texte du champ comme le fait le navigateur : `type` dit comment il est arrivé. */
  saisir: (valeur: string, type?: string) => Promise<void>
  entree: () => Promise<void>
  signal: () => Element | null
  composer: ChatComposerHandle
}> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  const ref = createRef<ChatComposerHandle>()
  await act(async () => root!.render(<ChatComposer ref={ref} {...proprietes(over)} />))
  const zone = hote
  const champ = zone.querySelector('textarea') as HTMLTextAreaElement
  return {
    saisir: async (valeur, type = 'insertText') => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
          champ,
          valeur
        )
        champ.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type }))
      })
    },
    entree: async () => {
      await act(async () => {
        champ.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        )
      })
    },
    signal: () => zone.querySelector('[data-testid="composer-ultrathink"]'),
    composer: ref.current!
  }
}

describe('zone de saisie du chat — ultrathink tapé à la main', () => {
  it('mot tapé : signal affiché, puis déclaré à l’app avant l’envoi', async () => {
    const { saisir, entree, signal } = await monter()
    expect(signal()).toBeNull()
    await saisir('ultrathink pourquoi ce test échoue')
    expect(signal()?.textContent).toBe('ultrathink réflexion poussée pour ce message')
    await entree()
    expect(declarer).toHaveBeenCalledExactlyOnceWith('ultrathink pourquoi ce test échoue')
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(declarer.mock.invocationCallOrder[0]).toBeLessThan(onSend.mock.invocationCallOrder[0])
  })

  it('mot tapé pendant un tour : déclaré avant la mise en file, pour monter le reste du tour', async () => {
    const { saisir, entree } = await monter({ busy: true })
    await saisir('ultrathink regarde aussi b.ts')
    await entree()
    expect(declarer).toHaveBeenCalledExactlyOnceWith('ultrathink regarde aussi b.ts')
    expect(onQueue).toHaveBeenCalledTimes(1)
    expect(declarer.mock.invocationCallOrder[0]).toBeLessThan(onQueue.mock.invocationCallOrder[0])
  })

  it('mot effacé : plus de signal, rien de déclaré', async () => {
    const { saisir, entree, signal } = await monter()
    await saisir('ultrathink pourquoi ce test échoue')
    await saisir('pourquoi ce test échoue')
    expect(signal()).toBeNull()
    await entree()
    expect(declarer).not.toHaveBeenCalled()
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('mot collé : ni signal ni déclaration, même si l’on tape autour ensuite', async () => {
    const { saisir, entree, signal } = await monter()
    await saisir('ultrathink pourquoi ce test échoue', 'insertFromPaste')
    expect(signal()).toBeNull()
    await saisir('ultrathink pourquoi ce test échoue ?')
    expect(signal()).toBeNull()
    await entree()
    expect(declarer).not.toHaveBeenCalled()
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('mot posé par l’app (suite proposée, brouillon rendu) : ni signal ni déclaration', async () => {
    const { entree, signal, composer } = await monter()
    await act(async () => composer.setInput('Redémarre l’app pour activer ultrathink.'))
    expect(signal()).toBeNull()
    await entree()
    expect(declarer).not.toHaveBeenCalled()
  })

  it('mot seulement cité : ni signal ni déclaration', async () => {
    const { saisir, entree, signal } = await monter()
    await saisir('que fait `ultrathink` dans Claude Code')
    expect(signal()).toBeNull()
    await entree()
    expect(declarer).not.toHaveBeenCalled()
  })

  it('mot tapé, puis du texte collé à la suite : le mot reste tapé', async () => {
    const { saisir, entree, signal } = await monter()
    await saisir('ultrathink')
    await saisir('ultrathink voici le journal collé', 'insertFromPaste')
    expect(signal()).not.toBeNull()
    await entree()
    expect(declarer).toHaveBeenCalledTimes(1)
  })
})
