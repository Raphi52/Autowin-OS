// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JarvisWidget, titreJarvis } from './JarvisWidget'
import { ecrireNomJarvis } from './jarvis-nom'
import { ecouteInitiale, phraseDeJarvis } from './jarvis-voice'

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

  /**
   * LE VRAI CHROMIUM, lui, est CUMULATIF : `results` garde toutes les phrases de la session,
   * REUTILISE l'objet de chacune, et `resultIndex` peut REPOINTER sur une phrase deja figee. Le
   * faux moteur ci-dessus n'envoyait jamais qu'un seul resultat neuf a l'index 0, donc il ne
   * pouvait pas montrer ce defaut. Ici les objets sont CONSERVES entre deux evenements, comme dans
   * le navigateur : c'est cette identite qui distingue une phrase republiee d'une phrase nouvelle.
   */
  cumul: (ArrayLike<{ transcript: string }> & { isFinal?: boolean })[] = []
  direCumule(phrases: readonly string[], resultIndex = 0): void {
    phrases.forEach((t, i) => {
      if (!this.cumul[i]) this.cumul[i] = Object.assign([{ transcript: t }], { isFinal: true })
    })
    this.onresult?.({ resultIndex, results: this.cumul.slice(0, phrases.length) })
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

/** La VOIX de Jarvis : elle ne s'entend pas en test, elle s'enregistre ici. */
class FauxSynthese {
  static dites: string[] = []
  static annulations = 0
  speak(u: { text: string }): void {
    FauxSynthese.dites.push(u.text)
  }
  cancel(): void {
    FauxSynthese.annulations += 1
  }
  getVoices(): SpeechSynthesisVoice[] {
    return [{ lang: 'fr-FR', default: true, name: 'fr' } as SpeechSynthesisVoice]
  }
}

const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []
const routeConversationMessage = vi.fn(async () => ({ conversationId: 'c-jarvis', routed: true }))
const pilotChat = vi.fn(async () => ({ ok: true, cancelled: false }))
const conversations = vi.fn(async () => [
  {
    id: 'c-1',
    title: 'Run en cours',
    updatedAt: Date.now(),
    messageCount: 4,
    lastAssistantStatus: 'streaming'
  }
])

function rendre() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(JarvisWidget)))
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
  pilotChat.mockClear()
  conversations.mockClear()
  ;(window as never as Record<string, unknown>).SpeechRecognition = FakeRecognition
  FauxSynthese.dites = []
  FauxSynthese.annulations = 0
  ;(globalThis as never as Record<string, unknown>).speechSynthesis = new FauxSynthese()
  ;(globalThis as never as Record<string, unknown>).SpeechSynthesisUtterance = class {
    voice: unknown = null
    lang = ''
    rate = 1
    pitch = 1
    constructor(public text: string) {}
  }
  ;(window as never as Record<string, unknown>).api = {
    conversations,
    conversationsCreate: vi.fn(async () => ({ id: 'c-jarvis' })),
    routeConversationMessage,
    pilotChat
  }
})

afterEach(() => {
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('widget Jarvis', () => {
  it('REPOND A VOIX HAUTE quand un ordre part', async () => {
    // Ce que ce test ferme : Jarvis entendait, bipait, executait — et ne disait jamais rien. Il
    // fallait retourner lire l'ecran pour savoir qu'il avait compris.
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('Jarvis, ouvre le task manager', true))
    expect(FauxSynthese.dites).toContain('Tout de suite.')
  })

  it('reste MUET en mode enregistrement, et se tait des que le micro est coupe', async () => {
    // L'ENTREE QUI CASSE UN FAUX FIX : en reunion, le mot « Jarvis » est prononce sans lui parler.
    // Une voix qui repond la est le pire defaut possible — meme garde que le bip.
    //
    // La garde est verifiee sur `phraseDeJarvis` et NON par un clic : le bouton
    // `jarvis-enregistrer` de l'interface d'origine n'existe plus (le mode enregistrement a son
    // propre widget). L'assertion n'est pas relachee — elle vise la fonction qui DECIDE du silence,
    // c'est-a-dire l'endroit exact ou un faux fix passerait.
    expect(
      phraseDeJarvis(
        { ...ecouteInitiale, active: true, mode: 'enregistrement' },
        { genre: 'ordre' }
      )
    ).toBeNull()

    const c = rendre()
    clic(c, 'jarvis-bascule')
    const avant = FauxSynthese.annulations
    clic(c, 'jarvis-bascule')
    expect(FauxSynthese.annulations).toBeGreaterThan(avant)
  })

  it('n’écrit PAS deux fois une phrase que le moteur republie', () => {
    // DEFAUT VECU le 2026-09-01 : « j'ai dit Robert, puis j'ai redit Robert et ca a ecrit 2 lignes
    // d'un coup », reproductible a l'infini. Chromium republie une phrase DEJA figee dans un
    // evenement suivant ; sans memoire de ce qui a ete consomme, elle est reinscrite a chaque fois.
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    act(() => moteur.direCumule(['Robert']))
    act(() => moteur.direCumule(['Robert', 'Robert']))
    const lignes = c.querySelectorAll('[data-testid="jarvis-paroles"] li')
    expect(lignes).toHaveLength(2)
  })

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
    expect(pilotChat).not.toHaveBeenCalled()
    expect(c.textContent).toContain('on ira manger à midi')

    await act(async () => moteur.dire('Jarvis, ouvre le task manager', true))
    expect(pilotChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'ouvre le task manager' }],
      'c-jarvis'
    )
  })

  it('EXECUTE l’ordre entendu : le routage seul ne lance aucun tour', async () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('Jarvis, lance une tache test', true))
    expect(pilotChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'lance une tache test' }],
      'c-jarvis'
    )
  })

  it('UNE parole = UN SEUL tour, même sous StrictMode', async () => {
    // LE DÉFAUT VÉCU (conv-46, 2026-09-01) : une phrase dictée UNE fois lançait 6 tours en 1,5 s —
    // 6 bulles identiques dans le chat, 6 appels au modèle facturés. Cause : l'envoi de l'ordre
    // était déclenché DEPUIS l'updater de `setEcoute`. React réexécute librement un updater (deux
    // fois d'office sous StrictMode, davantage lors d'un rejeu de file), donc l'effet de bord
    // partait autant de fois qu'il était rejoué. L'ENTRÉE QUI CASSERAIT UN FAUX FIX est ici
    // StrictMode : sans lui, le double appel reste invisible en test.
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(createElement(StrictMode, null, createElement(JarvisWidget))))
    monte.push({ root, container })
    clic(container, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('Jarvis, lance une tache test', true))
    expect(pilotChat).toHaveBeenCalledTimes(1)
  })

  it('UN clic = UN SEUL micro ouvert, même sous StrictMode', async () => {
    // LE DÉFAUT VÉCU (2026-09-01) : « jarvis a encore lancé 2x la conversation ». L'envoi de
    // l'ordre avait déjà été sorti de l'updater, mais la CRÉATION DU MOTEUR y était restée :
    // `setEcoute(precedent => { ... new Fabrique(); moteur.start() ... })`. React réexécute
    // librement un updater (deux fois d'office sous StrictMode), donc UN clic ouvrait DEUX micros
    // sur le vrai périphérique. Les deux entendaient la même phrase, et chacun envoyait son ordre.
    // L'ENTRÉE QUI CASSERAIT UN FAUX FIX : faire parler TOUS les moteurs créés, pas seulement le
    // dernier — c'est le premier, oublié dans `moteurRef`, qui doublait les tours.
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(createElement(StrictMode, null, createElement(JarvisWidget))))
    monte.push({ root, container })
    clic(container, 'jarvis-bascule')
    expect(FakeRecognition.instances).toHaveLength(1)
    for (const moteur of FakeRecognition.instances) {
      await act(async () => moteur.dire('Jarvis, lance une tache test', true))
    }
    expect(pilotChat).toHaveBeenCalledTimes(1)
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
    expect(pilotChat).not.toHaveBeenCalled()
    await act(async () => moteur.dire('ouvre le task manager', true))
    expect(pilotChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'ouvre le task manager' }],
      'c-jarvis'
    )

    // et il se rendort : la phrase d'après ne part pas
    pilotChat.mockClear()
    await act(async () => moteur.dire('passe moi le sel', true))
    expect(pilotChat).not.toHaveBeenCalled()
  })

  it('n’affiche PLUS la liste des conversations en direct', async () => {
    // CHOIX DE L'UTILISATEUR (2026-09-01) : le widget sert a PARLER a Jarvis, pas a surveiller la
    // liste des conversations — elle est deja dans la barre laterale. L'ENTREE QUI CASSERAIT UN
    // FAUX FIX : le sondage rend bien une conversation « Run en cours » (voir `conversations`),
    // donc un widget qui la garderait afficherait son titre ici.
    const c = rendre()
    await act(async () => {
      await Promise.resolve()
    })
    expect(c.querySelector('[data-testid="jarvis-direct"]')).toBeNull()
    expect(c.textContent).not.toContain('Conversations en direct')
    expect(c.textContent).not.toContain('Run en cours')
  })

  it('N A PLUS le bouton d enregistrement : il vit dans le widget « Enregistrements »', () => {
    // CHOIX DE L'UTILISATEUR (2026-09-01) : « met ca dans un widget a part ». Le mode existe
    // toujours dans `jarvis-voice`, mais Jarvis ne le declenche plus — le widget dedie, lui,
    // ECRIT sur le disque, ce que ce bouton n a jamais fait.
    const c = rendre()
    expect(c.querySelector('[data-testid="jarvis-enregistrer"]')).toBeNull()
  })

  it('coupe vraiment le micro au second clic', () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    clic(c, 'jarvis-bascule')
    expect(moteur.arrets).toBe(1)
    expect(c.querySelector('[data-testid="jarvis-bascule"]')?.getAttribute('aria-pressed')).toBe(
      'false'
    )
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

    it('propose la VOIX neuronale tant qu’elle est absente, et l’annonce une fois installée', async () => {
      // Ce que ce test ferme : la demande d'origine (« des voix plus sympa ») ne se règle pas au
      // débit ni à la hauteur — les voix de Windows sont le plafond du poste. Le bouton doit
      // exister, dire son poids AVANT le clic, et disparaître une fois la voix installée.
      const etatVoix = (installe: boolean) => ({
        installe,
        binaire: installe ? 'C:/p/piper.exe' : null,
        voix: installe ? 'C:/p/fr.onnx' : null,
        racine: 'C:/p',
        voixNom: 'fr_FR-siwis-medium.onnx',
        megaoctets: 85
      })
      const piperInstaller = vi.fn(async () => etatVoix(true))
      brancherWhisper(true, { piperEtat: vi.fn(async () => etatVoix(false)), piperInstaller })
      const c = rendre()
      await flush()
      const bouton = c.querySelector('[data-testid="jarvis-installer-piper"]')
      expect(bouton).not.toBeNull()
      // Le poids est écrit AVANT le clic : rien ne descend sans que l'utilisateur sache combien.
      expect(bouton?.textContent).toContain('85 Mo')
      clic(c, 'jarvis-installer-piper')
      await flush()
      expect(piperInstaller).toHaveBeenCalledTimes(1)
      expect(c.querySelector('[data-testid="jarvis-installer-piper"]')).toBeNull()
      expect(c.textContent).toContain('Voix française installée')
    })

    it('n’offre RIEN sur la voix tant que l’application ne sait pas répondre', async () => {
      // Sans cette garde, un poste où le canal n'existe pas afficherait un bouton mort.
      brancherWhisper(true)
      const c = rendre()
      await flush()
      expect(c.querySelector('[data-testid="jarvis-installer-piper"]')).toBeNull()
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
      expect(pilotChat).toHaveBeenCalledWith(
        [{ role: 'user', content: 'ouvre le task manager' }],
        'c-jarvis'
      )
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

    it('affiche la jauge de niveau PENDANT l’écoute, et pas micro coupé', async () => {
      const c = rendre()
      await flush()
      // Micro coupé : rien à jauger — une barre figée se lirait « il n'entend rien ».
      expect(c.querySelector('[data-testid="jarvis-jauge"]')).toBeNull()
      clic(c, 'jarvis-bascule')
      await flush()
      expect(c.querySelector('[data-testid="jarvis-jauge"]')).not.toBeNull()
      expect(c.querySelector('[data-testid="jarvis-jauge-barre"]')).not.toBeNull()
    })

    it('affiche SOUS la jauge ce que le niveau veut dire, pas seulement sa hauteur', async () => {
      const c = rendre()
      await flush()
      clic(c, 'jarvis-bascule')
      await flush()
      const verdict = c.querySelector('[data-testid="jarvis-verdict"]')
      expect(verdict).not.toBeNull()
      // Le verdict vit DANS la jauge : un message affiché ailleurs ne répondrait pas à
      // « est-ce que ce niveau-là est bon ? ».
      expect(c.querySelector('[data-testid="jarvis-jauge"]')?.contains(verdict!)).toBe(true)
      // Micro ouvert mais rien dit encore : le cas exact qui ressemblait à une panne.
      expect(verdict?.getAttribute('data-verdict')).toBe('silence')
      expect(verdict?.textContent).toContain('Aucun son détecté')
    })

    it('expose les paramètres audio : choix du micro et seuil', async () => {
      const c = rendre()
      await flush()
      const select = c.querySelector('[data-testid="jarvis-peripherique"]')
      const seuil = c.querySelector('[data-testid="jarvis-seuil"]') as HTMLInputElement | null
      expect(select).not.toBeNull()
      expect(seuil?.type).toBe('range')
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

describe('titreJarvis', () => {
  it('reprend le debut du message de l utilisateur', () => {
    expect(titreJarvis('ouvre le rapport')).toBe('Jarvis - ouvre le rapport')
  })

  it('coupe une phrase longue sur un mot et marque la suite', () => {
    const titre = titreJarvis(
      'lance le scout du depot autowin et rends moi la liste des residus a nettoyer'
    )
    expect(titre.startsWith('Jarvis - lance le scout du depot autowin')).toBe(true)
    expect(titre.endsWith(' ...')).toBe(true)
  })

  it('retombe sur Jarvis quand le message est vide', () => {
    expect(titreJarvis('   ')).toBe('Jarvis')
  })
})

describe('le widget suit le NOM RÉGLÉ', () => {
  it('obéit au nouveau nom et titre la conversation avec lui', async () => {
    // LE DÉFAUT VÉCU : l'utilisateur renomme son assistant « Alfred », l'étiquette change, mais
    // l'assistant reste sourd à « Alfred » et ouvre encore des conversations « Jarvis - ... ».
    const creer = vi.fn(async () => ({ id: 'c-alfred' }))
    ;(window as never as Record<string, unknown>).api = {
      conversations,
      conversationsCreate: creer,
      routeConversationMessage,
      pilotChat
    }
    const c = rendre()
    act(() => {
      ecrireNomJarvis(window.localStorage, 'Alfred')
    })
    clic(c, 'jarvis-bascule')
    // L'invite parlée porte le nom réglé : c'est ce que l'utilisateur LIT avant de parler.
    expect(c.textContent).toContain('Dites « Alfred »')
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('Alfred, ouvre le task manager', true))

    expect(creer).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Alfred - ouvre le task manager' })
    )
    expect(pilotChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'ouvre le task manager' }],
      'c-alfred'
    )
    // Le nom est un réglage PERSISTANT : on le rend au suivant tel qu'il l'a trouvé.
    ecrireNomJarvis(window.localStorage, '')
  })

  it('le titre de conversation porte le nom réglé', () => {
    expect(titreJarvis('ouvre le rapport', 'Friday')).toBe('Friday - ouvre le rapport')
    expect(titreJarvis('   ', 'Friday')).toBe('Friday')
  })
})

describe('UNE demande dictée = UNE conversation, et UN seul message', () => {
  /**
   * LE DÉFAUT VÉCU (2026-09-01) : « ça a envoyé 2 messages et ça a dupliqué la transcript, et
   * quand j'ai enchaîné 2 demandes la 2ᵉ a pas créé de conversation ».
   *
   * Cause : le widget créait une conversation, PUIS demandait au routeur
   * (`routeConversationMessage`) où mettre le message. Sur une conversation vide, le routeur
   * répond « nouveau contexte » et CRÉE une seconde conversation (`conversation-router.ts:263`) :
   * une coquille vide + une conversation réelle pour un seul ordre dicté. Puis il gardait cette
   * conversation dans un `ref` : la 2ᵉ demande, cette fois routée sur « contexte courant »,
   * atterrissait dans la MÊME conversation — « la 2ᵉ n'a pas créé de conversation ».
   */
  it('ouvre une conversation NEUVE à chaque ordre, sans passer par le routeur', async () => {
    const creees: string[] = []
    const creer = vi.fn(async (_p: { title: string }) => {
      const id = `c-${creees.length + 1}`
      creees.push(id)
      return { id }
    })
    ;(window as never as Record<string, unknown>).api = {
      conversations,
      conversationsCreate: creer,
      routeConversationMessage,
      pilotChat
    }
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!

    await act(async () => moteur.dire('Jarvis, ouvre le task manager', true))
    await act(async () => moteur.dire('Jarvis, lance le scout', true))

    // L'ENTRÉE QUI CASSERAIT UN FAUX FIX : le SECOND ordre. Avec l'ancien code, il ne créait rien
    // (`conversationRef` déjà rempli) et `conversationsCreate` restait à 1 appel.
    expect(creer).toHaveBeenCalledTimes(2)
    expect(creer.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ title: 'Jarvis - lance le scout' })
    )

    // Le routeur est ce qui fabriquait la conversation en trop : il ne doit plus être appelé.
    // Son bouchon rend `routed: true, conversationId: 'c-jarvis'` — un fix qui le garderait
    // enverrait les DEUX ordres dans 'c-jarvis', donc une seule conversation pour deux demandes.
    expect(routeConversationMessage).not.toHaveBeenCalled()

    // UN message par ordre, chacun dans SA conversation.
    expect(pilotChat).toHaveBeenCalledTimes(2)
    expect(pilotChat.mock.calls[0]).toEqual([
      [{ role: 'user', content: 'ouvre le task manager' }],
      'c-1'
    ])
    expect(pilotChat.mock.calls[1]).toEqual([[{ role: 'user', content: 'lance le scout' }], 'c-2'])
  })
})
