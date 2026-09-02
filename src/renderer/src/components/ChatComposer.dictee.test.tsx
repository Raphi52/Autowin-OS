// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerProps } from './ChatComposer'

/**
 * LE MICRO DU CHAMP DE SAISIE — un seul composer sert le chat plein ET la mosaïque, donc ce test
 * couvre les deux : ce qui est prouvé ici s'affiche des deux côtés (la mosaïque appelle le même
 * `ChatComposer` via `rendreComposer`).
 *
 * Ce que le test prouve : le bouton existe, un clic ouvre le micro, un second clic ferme le micro,
 * envoie l'audio à la transcription LOCALE et pousse le texte reconnu dans le brouillon du parent.
 */
beforeAll(() => {
  // React exige ce drapeau pour que act() ne prévienne pas à chaque rendu.
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

function brancherAudio(transcrire: (wav: Uint8Array) => Promise<string>): {
  pousserSon: () => void
  micros: () => number
} {
  let onaudio: ((e: { inputBuffer: { getChannelData(c: number): Float32Array } }) => void) | null =
    null
  let ouvertures = 0
  ;(window as never as Record<string, unknown>).api = { whisperTranscrire: transcrire }
  ;(navigator as never as Record<string, unknown>).mediaDevices = {
    getUserMedia: vi.fn(async () => {
      ouvertures += 1
      return { getTracks: () => [{ stop: () => {} }] }
    })
  }
  ;(window as never as Record<string, unknown>).AudioContext = class {
    sampleRate = 16_000
    destination = {}
    createMediaStreamSource(): unknown {
      return { connect: () => {}, disconnect: () => {} }
    }
    createScriptProcessor(): unknown {
      const noeud = {
        connect: () => {},
        disconnect: () => {},
        set onaudioprocess(v: never) {
          onaudio = v
        },
        get onaudioprocess() {
          return onaudio as never
        }
      }
      return noeud
    }
    async close(): Promise<void> {
      return undefined
    }
  }
  const bloc = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 3) * 0.3)
  return {
    pousserSon: () => onaudio?.({ inputBuffer: { getChannelData: () => bloc } }),
    micros: () => ouvertures
  }
}

describe('ChatComposer — dictée', () => {
  it('affiche le micro et pousse le texte reconnu dans le brouillon', async () => {
    const transcrire = vi.fn(async (_wav: Uint8Array) => 'ouvre le gestionnaire de tâches')
    const { pousserSon, micros } = brancherAudio(transcrire)
    const brouillons: string[] = []
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const root = createRoot(hote)
    await act(async () => {
      root.render(<ChatComposer {...proprietes({ onDraftInput: (v) => brouillons.push(v) })} />)
    })

    const micro = hote.querySelector<HTMLButtonElement>('[data-testid="composer-dictee"]')
    expect(micro).not.toBeNull()

    await act(async () => {
      micro!.click()
    })
    expect(micros()).toBe(1)
    expect(micro!.className).toContain('is-recording')

    act(() => {
      pousserSon()
    })

    await act(async () => {
      micro!.click()
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(transcrire).toHaveBeenCalledTimes(1)
    expect(brouillons.at(-1)).toBe('ouvre le gestionnaire de tâches')
    const champ = hote.querySelector('textarea') as HTMLTextAreaElement
    expect(champ.value).toBe('ouvre le gestionnaire de tâches')
    expect(micro!.className).not.toContain('is-recording')

    await act(async () => {
      root.unmount()
    })
    hote.remove()
  })
})

/**
 * WHISPER PAS INSTALLÉ — le défaut relevé au contrôle : le bouton n'interrogeait que la présence
 * de la fonction du pont, jamais l'état réel de l'installation. Le micro s'ouvrait donc pour rien
 * et l'utilisateur recevait « Rien n'a été reconnu », un message trompeur.
 */
describe('ChatComposer — dictée sans Whisper installé', () => {
  it('n’ouvre aucun micro, désactive le bouton et affiche la raison', async () => {
    const transcrire = vi.fn(async (_wav: Uint8Array) => 'ne devrait jamais arriver')
    const { micros } = brancherAudio(transcrire)
    ;(window as never as Record<string, unknown>).api = {
      whisperTranscrire: transcrire,
      whisperEtat: vi.fn(async () => ({ installe: false }))
    }
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const root = createRoot(hote)
    await act(async () => {
      root.render(<ChatComposer {...proprietes()} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const micro = hote.querySelector<HTMLButtonElement>('[data-testid="composer-dictee"]')
    expect(micro).not.toBeNull()
    expect(micro!.disabled).toBe(true)

    await act(async () => {
      micro!.click()
      await Promise.resolve()
    })

    expect(micros()).toBe(0)
    expect(transcrire).not.toHaveBeenCalled()
    expect(micro!.className).not.toContain('is-recording')
    const message = hote.querySelector('[data-testid="composer-dictee-message"]')
    expect(message?.textContent ?? '').toContain('non installée')

    await act(async () => {
      root.unmount()
    })
    hote.remove()
  })
})
