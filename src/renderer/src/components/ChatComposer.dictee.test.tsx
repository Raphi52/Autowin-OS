// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerProps } from './ChatComposer'
import { GAIN_MAX, appliquerGain } from './composer-dictee'

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
    // L'icone est DESSINEE (demande du 2026-09-02 : l'emoji etait moche et dependait de la police).
    expect(micro!.querySelector('svg')).not.toBeNull()
    expect(micro!.textContent ?? '').not.toContain('\u{1F3A4}')

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

/**
 * LE RETOUR VISUEL PENDANT QU'ON PARLE — sans lui, l'écran reste muet jusqu'à la première phrase
 * reconnue et l'utilisateur en déduit « ça ne marche pas ». La barre montre le niveau du micro.
 */
describe('ChatComposer — jauge de niveau du micro', () => {
  it('affiche la jauge pendant l’écoute et la fait bouger avec le son', async () => {
    const transcrire = vi.fn(async (_wav: Uint8Array) => '')
    const { pousserSon } = brancherAudio(transcrire)
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const root = createRoot(hote)
    await act(async () => {
      root.render(<ChatComposer {...proprietes()} />)
    })
    const jauge = (): HTMLElement | null =>
      hote.querySelector<HTMLElement>('[data-testid="composer-dictee-niveau"]')
    expect(jauge()).toBeNull()

    const micro = hote.querySelector<HTMLButtonElement>('[data-testid="composer-dictee"]')
    await act(async () => {
      micro!.click()
    })
    expect(jauge()).not.toBeNull()
    expect(jauge()!.style.getPropertyValue('--niveau')).toBe('0')

    await act(async () => {
      pousserSon()
    })
    const remplissage = Number(jauge()!.style.getPropertyValue('--niveau'))
    expect(remplissage).toBeGreaterThan(0)

    await act(async () => {
      micro!.click()
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(jauge()).toBeNull()

    await act(async () => {
      root.unmount()
    })
    hote.remove()
  })

  it('le volume de capture amplifie le son et la jauge le montre', () => {
    const bloc = new Float32Array([0.1, -0.1, 0.9])
    const fort = appliquerGain(bloc, 3)
    expect(fort[0]).toBeCloseTo(0.3, 5)
    expect(fort[1]).toBeCloseTo(-0.3, 5)
    // Saturation propre : jamais au-delà de 1, sinon le son repartirait de l'autre côté.
    expect(fort[2]).toBe(1)
    // Hors bornes = borné, pas de gain absurde.
    expect(appliquerGain(bloc, 99)[0]).toBeCloseTo(0.1 * GAIN_MAX, 5)
    expect(appliquerGain(bloc, 1)).toBe(bloc)
  })
})

/**
 * LE RÉGLAGE DU VOLUME DE CAPTURE — il vit à côté de la jauge, sinon on voit que le micro prend
 * mal sans pouvoir y faire quoi que ce soit. Et il se retient : un micro faible se règle une fois.
 */
describe('ChatComposer — volume de capture du micro', () => {
  it('affiche le curseur pendant l’écoute et mémorise la valeur choisie', async () => {
    window.localStorage.removeItem('autowin.dictee.gain')
    const transcrire = vi.fn(async (_wav: Uint8Array) => '')
    brancherAudio(transcrire)
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const root = createRoot(hote)
    await act(async () => {
      root.render(<ChatComposer {...proprietes()} />)
    })
    const curseur = (): HTMLInputElement | null =>
      hote.querySelector<HTMLInputElement>('[data-testid="composer-dictee-gain"]')
    expect(curseur()).toBeNull()

    const micro = hote.querySelector<HTMLButtonElement>('[data-testid="composer-dictee"]')
    await act(async () => {
      micro!.click()
    })
    expect(curseur()).not.toBeNull()
    expect(curseur()!.value).toBe('1')

    await act(async () => {
      const champ = curseur()!
      // React lit la valeur via le descripteur natif : l'écrire directement ne déclencherait pas
      // son onChange, et le test passerait sur un affichage qui n'a rien changé au réglage réel.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(champ, '2.5')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(curseur()!.value).toBe('2.5')
    expect(window.localStorage.getItem('autowin.dictee.gain')).toBe('2.5')

    await act(async () => {
      root.unmount()
    })
    hote.remove()
  })
})
