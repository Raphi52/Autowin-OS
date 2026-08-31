// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JarvisWidget } from './JarvisWidget'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

class FakeRecognition {
  static instances: FakeRecognition[] = []
  continuous = false
  interimResults = false
  lang = ''
  demarrages = 0
  arrets = 0
  onresult: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor() {
    FakeRecognition.instances.push(this)
  }
  start(): void {
    this.demarrages += 1
  }
  stop(): void {
    this.arrets += 1
  }
  abort(): void {
    this.arrets += 1
  }
  /** Rejoue ce que rend un moteur réel : une liste de résultats, finaux ou non. */
  dire(texte: string, final: boolean): void {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: texte }], { isFinal: final })]
    })
  }
}

/** Un AudioContext factice : le bip ne se voit pas, il s'ENREGISTRE ici. */
class FakeOscillator {
  type = ''
  frequency = { value: 0, setValueAtTime: (v: number) => (FakeAudio.frequences.push(v), undefined) }
  connect(): void {
    FakeAudio.connexions += 1
  }
  start(): void {
    FakeAudio.demarrages += 1
  }
  stop(): void {
    FakeAudio.arrets += 1
  }
}
class FauxNoeudMicro {
  onaudioprocess:
    ((e: { inputBuffer: { getChannelData(c: number): Float32Array } }) => void) | null = null
  connexions = 0
  connect(): void {
    this.connexions += 1
  }
  disconnect(): void {
    this.connexions -= 1
  }
}

class FakeAudio {
  static demarrages = 0
  static frequences: number[] = []
  static fermetures = 0
  static connexions = 0
  static arrets = 0
  /** Le dernier contexte de CAPTURE (celui du moteur Whisper), pour lui injecter de l'audio. */
  static micro: FakeAudio | null = null
  state = 'running'
  currentTime = 0
  sampleRate = 16_000
  destination = {}
  noeud = new FauxNoeudMicro()
  createOscillator(): FakeOscillator {
    return new FakeOscillator()
  }
  createMediaStreamSource(): { connect(): void; disconnect(): void } {
    FakeAudio.micro = this
    return { connect: () => {}, disconnect: () => {} }
  }
  createScriptProcessor(): FauxNoeudMicro {
    return this.noeud
  }
  createGain() {
    return {
      gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => {}
    }
  }
  resume(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    FakeAudio.fermetures += 1
    return Promise.resolve()
  }
}

const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []
const routeConversationMessage = vi.fn(async () => ({ conversationId: 'c-jarvis', routed: true }))
const conversations = vi.fn(async () => [
  {
    id: 'c-1',
    title: 'Run en cours',
    updatedAt: Date.now(),
    messageCount: 4,
    lastAssistantStatus: 'streaming'
  }
])

function rendre(props: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(JarvisWidget, props as never)))
  monte.push({ root, container })
  return container
}

const clic = (container: HTMLElement, testid: string): void => {
  const bouton = container.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)
  if (!bouton) throw new Error(`bouton absent : ${testid}`)
  act(() => bouton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  FakeRecognition.instances = []
  FakeAudio.demarrages = 0
  FakeAudio.frequences = []
  FakeAudio.fermetures = 0
  FakeAudio.micro = null
  ;(window as never as Record<string, unknown>).AudioContext = FakeAudio
  routeConversationMessage.mockClear()
  conversations.mockClear()
  ;(window as never as Record<string, unknown>).SpeechRecognition = FakeRecognition
  ;(window as never as Record<string, unknown>).api = {
    conversations,
    conversationsCreate: vi.fn(async () => ({ id: 'c-jarvis' })),
    routeConversationMessage
  }
})

afterEach(() => {
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('widget Jarvis', () => {
  it('n’écoute pas avant d’avoir été activé', () => {
    rendre()
    expect(FakeRecognition.instances).toHaveLength(0)
  })

  it('écoute en continu une fois activé', () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    expect(moteur.demarrages).toBe(1)
    expect(moteur.continuous).toBe(true)
    expect(moteur.interimResults).toBe(true)
  })

  it('relance le moteur quand il s’arrête tout seul, TANT QUE le widget est activé', () => {
    // L'ENTRÉE QUI CASSE UN FAUX FIX : un moteur de reconnaissance se coupe seul après un silence.
    // Sans relance, « écoute en permanence » ne dure qu'une poignée de secondes ; avec une relance
    // NON gardée, il repartirait après que l'utilisateur a coupé — micro ouvert à son insu.
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    act(() => moteur.onend?.())
    expect(moteur.demarrages).toBe(2)

    clic(c, 'jarvis-bascule')
    const apresArret = moteur.demarrages
    act(() => moteur.onend?.())
    expect(moteur.demarrages).toBe(apresArret)
  })

  it('n’envoie une parole à Jarvis que si le mot d’éveil est prononcé', async () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('on ira manger à midi', true))
    expect(routeConversationMessage).not.toHaveBeenCalled()
    expect(c.textContent).toContain('on ira manger à midi')

    await act(async () => moteur.dire('Jarvis, ouvre le task manager', true))
    expect(routeConversationMessage).toHaveBeenCalledWith('c-jarvis', 'ouvre le task manager', [])
  })

  it('fait un son dès qu’il entend son nom, avant même la fin de la phrase', async () => {
    // L'ENTRÉE QUI CASSERAIT UN FAUX FIX : dire('jarvis', false) — un partiel. Un bip branché
    // seulement sur les résultats FINAUX ne sonnerait pas ici, et l'utilisateur parlerait
    // dans le vide, exactement le défaut signalé (« il ne m'entend pas quand je l'appelle »).
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('jarvis', false))
    // un bip = 2 notes montantes (880 puis 1320 Hz)
    expect(FakeAudio.frequences).toEqual([880, 1320])
    expect(FakeAudio.demarrages).toBe(2)
    // et pas de mitraillage sur les partiels suivants de la MÊME phrase
    await act(async () => moteur.dire('jarvis ouv', false))
    expect(FakeAudio.demarrages).toBe(2)
  })

  it('ne bipe pas pour une phrase qui ne le nomme pas', async () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('on ira manger à midi', true))
    expect(FakeAudio.demarrages).toBe(0)
  })

  it('accepte l’ordre dit APRÈS le bip, dans une phrase séparée', async () => {
    // LE DÉFAUT SIGNALÉ : on appelle « Jarvis », on attend le signal, PUIS on parle.
    // L'ENTRÉE QUI CASSERAIT UN FAUX FIX : la 2ᵉ phrase 'ouvre le task manager' sans mot d'éveil.
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('Jarvis', true))
    expect(routeConversationMessage).not.toHaveBeenCalled()
    await act(async () => moteur.dire('ouvre le task manager', true))
    expect(routeConversationMessage).toHaveBeenCalledWith('c-jarvis', 'ouvre le task manager', [])

    // et il se rendort : la phrase d'après ne part pas
    routeConversationMessage.mockClear()
    await act(async () => moteur.dire('passe moi le sel', true))
    expect(routeConversationMessage).not.toHaveBeenCalled()
  })

  it('affiche les conversations en direct', async () => {
    const c = rendre()
    await act(async () => {
      await Promise.resolve()
    })
    expect(conversations).toHaveBeenCalled()
    expect(c.textContent).toContain('Run en cours')
  })

  describe('écoute LOCALE (whisper.cpp)', () => {
    /** Rejoue une phrase dans le micro : de la parole, puis le silence qui la termine. */
    const direAuMicro = async (): Promise<void> => {
      const contexte = FakeAudio.micro
      if (!contexte) throw new Error('aucun micro ouvert')
      const parole = new Float32Array(1_600).map((_, i) => Math.sin(i / 3) * 0.3)
      const silence = new Float32Array(1_600)
      await act(async () => {
        for (let i = 0; i < 8; i += 1) {
          contexte.noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => parole } })
        }
        for (let i = 0; i < 9; i += 1) {
          contexte.noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => silence } })
        }
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    const brancherWhisper = (installe: boolean, extra: Record<string, unknown> = {}): void => {
      const api = (window as never as Record<string, unknown>).api as Record<string, unknown>
      Object.assign(api, {
        whisperEtat: vi.fn(async () => ({
          installe,
          binaire: installe ? 'C:/w/whisper-cli.exe' : null,
          modele: installe ? 'C:/w/ggml.bin' : null,
          racine: 'C:/w',
          modeleNom: 'ggml-small-q5_1.bin',
          megaoctets: 215
        })),
        ...extra
      })
      ;(navigator as never as Record<string, unknown>).mediaDevices = {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: () => {} }] }))
      }
    }

    const flush = async (): Promise<void> => {
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    it('propose l’installation, une seule fois, tant que l’écoute locale est absente', async () => {
      const whisperInstaller = vi.fn(async () => ({
        installe: true,
        binaire: 'C:/w/whisper-cli.exe',
        modele: 'C:/w/ggml.bin',
        racine: 'C:/w',
        modeleNom: 'ggml-small-q5_1.bin',
        megaoctets: 215
      }))
      brancherWhisper(false, { whisperInstaller })
      const c = rendre()
      await flush()
      expect(c.querySelector('[data-testid="jarvis-installer-whisper"]')).not.toBeNull()
      clic(c, 'jarvis-installer-whisper')
      await flush()
      expect(whisperInstaller).toHaveBeenCalledTimes(1)
      // une fois installé, l'offre disparaît et l'état est annoncé
      expect(c.querySelector('[data-testid="jarvis-installer-whisper"]')).toBeNull()
      expect(c.textContent).toContain('Écoute locale prête')
    })

    it('ÉCOUTE par whisper local — pas par le moteur Chromium — dès qu’il est installé', async () => {
      // LE DÉFAUT D'ORIGINE : `webkitSpeechRecognition` rend `error: network` dans Electron, donc
      // le micro s'ouvrait et rien n'était jamais reconnu. L'entrée qui casserait un faux fix :
      // `window.SpeechRecognition` est TOUJOURS défini ici (voir `beforeEach`) — un widget qui le
      // préfère instancierait FakeRecognition, et l'utilisateur retrouverait son silence.
      const whisperTranscrire = vi.fn(async (_wav: Uint8Array) => 'Jarvis, ouvre le task manager')
      brancherWhisper(true, { whisperTranscrire })
      const c = rendre()
      await flush()
      clic(c, 'jarvis-bascule')
      await flush()
      expect(FakeRecognition.instances).toHaveLength(0)
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled()

      await direAuMicro()
      expect(whisperTranscrire).toHaveBeenCalledTimes(1)
      // le WAV envoyé au processus principal est bien un WAV
      const wav = whisperTranscrire.mock.calls[0][0]
      expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
      // ... et la chaîne complète tient : parole → transcription → bip → ordre envoyé à Jarvis
      expect(FakeAudio.frequences).toEqual([880, 1320])
      expect(routeConversationMessage).toHaveBeenCalledWith('c-jarvis', 'ouvre le task manager', [])
      expect(c.textContent).toContain('Jarvis, ouvre le task manager')
    })

    it('MONTRE l’échec du moteur au lieu d’afficher « écoute en cours » sur un moteur mort', async () => {
      // LE DÉFAUT MESURÉ : sur cette application, `webkitSpeechRecognition` rend `error: network`
      // (capture datée du 2026-08-31, chemin dans l'en-tête de `src/main/whisper-local.ts`) ; la
      // cause de ce code n'est pas établie et n'est pas testée ici. L'erreur était avalée, donc le
      // widget restait allumé sans rien entendre. L'entrée qui casserait un faux fix : `no-speech`,
      // qui doit LAISSER l'écoute vivre.
      brancherWhisper(false)
      const c = rendre()
      await flush()
      clic(c, 'jarvis-bascule')
      const moteur = FakeRecognition.instances.at(-1)!
      await act(async () => moteur.onerror?.({ error: 'no-speech' }))
      expect(c.querySelector('[data-testid="jarvis-bascule"]')?.textContent).toContain('couper')

      await act(async () => moteur.onerror?.({ error: 'network' }))
      expect(c.textContent).toContain('network')
      expect(c.textContent).toContain('hors ligne')
      expect(c.querySelector('[data-testid="jarvis-bascule"]')?.textContent).toContain(
        'Activer l’écoute'
      )
    })

    it('reste sur le moteur du navigateur tant que whisper n’est pas installé', async () => {
      brancherWhisper(false)
      const c = rendre()
      await flush()
      clic(c, 'jarvis-bascule')
      await flush()
      expect(FakeRecognition.instances).toHaveLength(1)
    })
  })
})
