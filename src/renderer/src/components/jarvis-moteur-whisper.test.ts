import { describe, expect, it, vi } from 'vitest'
import { codeErreurMicro, fabriqueWhisper, type MoteurVocal } from './jarvis-moteur-whisper'
import { TAUX_WHISPER } from './whisper-audio'

const TAILLE_BLOC = 1_600 // 100 ms à 16 kHz

function parole(): Float32Array {
  const bloc = new Float32Array(TAILLE_BLOC)
  for (let i = 0; i < TAILLE_BLOC; i += 1) bloc[i] = Math.sin(i / 3) * 0.3
  return bloc
}
const silence = (): Float32Array => new Float32Array(TAILLE_BLOC)

class FauxNoeud {
  onaudioprocess:
    ((e: { inputBuffer: { getChannelData(c: number): Float32Array } }) => void) | null = null
  connecte = 0
  deconnecte = 0
  connect(): void {
    this.connecte += 1
  }
  disconnect(): void {
    this.deconnecte += 1
  }
}

class FauxContexte {
  static dernier: FauxContexte | null = null
  sampleRate = TAUX_WHISPER
  destination = {}
  ferme = 0
  noeud = new FauxNoeud()
  source = { connect: () => {}, disconnect: () => {} }
  constructor() {
    FauxContexte.dernier = this
  }
  createMediaStreamSource(): { connect(): void; disconnect(): void } {
    return this.source
  }
  createScriptProcessor(): FauxNoeud {
    return this.noeud
  }
  close(): Promise<void> {
    this.ferme += 1
    return Promise.resolve()
  }
}

function pistes(): { piste: { stop: () => void; arrets: number } } {
  const piste = { arrets: 0, stop: (): void => void (piste.arrets += 1) }
  return { piste }
}

function monter(transcrire: (wav: Uint8Array) => Promise<string>) {
  const { piste } = pistes()
  const flux = { getTracks: () => [piste] }
  const Fabrique = fabriqueWhisper({
    micro: async () => flux as never,
    contexte: () => new FauxContexte() as never,
    transcrire
  })
  const moteur: MoteurVocal = new Fabrique()
  const resultats: string[] = []
  const erreurs: string[] = []
  let fins = 0
  const finaux: boolean[] = []
  moteur.onresult = (e): void => {
    const evenement = e as {
      results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>
    }
    resultats.push(evenement.results[0][0].transcript)
    finaux.push(evenement.results[0].isFinal === true)
  }
  moteur.onerror = (e): void => void erreurs.push(String((e as { error?: unknown }).error))
  moteur.onend = (): void => void (fins += 1)
  return { moteur, resultats, finaux, erreurs, piste, fins: () => fins }
}

/** Fait parler SANS terminer la phrase : c'est la fenêtre où un partiel doit vivre. */
async function parlerSansFinir(blocs: number): Promise<void> {
  const noeud = FauxContexte.dernier!.noeud
  for (let i = 0; i < blocs; i += 1) {
    noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => parole() } })
  }
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

/** Rejoue une phrase : de la parole, puis le silence qui la termine. */
async function dire(blocs: number, silences: number): Promise<void> {
  const noeud = FauxContexte.dernier!.noeud
  for (let i = 0; i < blocs; i += 1) {
    noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => parole() } })
  }
  for (let i = 0; i < silences; i += 1) {
    noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => silence() } })
  }
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('moteur Whisper local', () => {
  it('transcrit une phrase et la rend comme un résultat FINAL', async () => {
    const transcrire = vi.fn(async (_wav: Uint8Array) => 'Jarvis ouvre le task manager')
    const h = monter(transcrire)
    h.moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    await dire(8, 9)
    expect(transcrire).toHaveBeenCalledTimes(1)
    // ce qui part vers whisper est bien un WAV, pas des flottants bruts
    const wav = transcrire.mock.calls[0][0]
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(h.resultats).toEqual(['Jarvis ouvre le task manager'])
  })

  it('rend un PARTIEL pendant qu’on parle, avant la fin de la phrase', async () => {
    // LE DÉFAUT : rien ne remontait avant la phrase figée, donc le bip d'éveil — le seul signal qui
    // dit « parle maintenant » — n'arrivait qu'après 700 ms de silence PLUS la transcription.
    const h = monter(async () => 'Jarvis ouvre')
    h.moteur.interimResults = true
    h.moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    await parlerSansFinir(13) // 1300 ms de parole : au-dessus du minimum, phrase NON terminée
    expect(h.resultats).toEqual(['Jarvis ouvre'])
    expect(h.finaux).toEqual([false])
  })

  it('n’émet AUCUN partiel sous le seuil de parole', async () => {
    // L'ENTRÉE QUI CASSE UN FAUX FIX : une parole trop courte. Whisper y rend du vide ou du faux,
    // et un faux partiel ferait biper Jarvis sur du bruit de clavier.
    const h = monter(async () => 'bruit')
    h.moteur.interimResults = true
    h.moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    await parlerSansFinir(8) // 800 ms
    expect(h.resultats).toEqual([])
  })

  it('n’émet aucun partiel quand l’appelant n’en veut pas', async () => {
    const h = monter(async () => 'Jarvis ouvre')
    h.moteur.interimResults = false
    h.moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    await parlerSansFinir(20)
    expect(h.resultats).toEqual([])
  })

  it('jette un partiel revenu APRÈS l’arrêt : il afficherait de la parole micro éteint', async () => {
    let libere: ((t: string) => void) | null = null
    const h = monter(() => new Promise<string>((r) => (libere = r)))
    h.moteur.interimResults = true
    h.moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    await parlerSansFinir(13)
    h.moteur.stop()
    ;(libere as ((t: string) => void) | null)?.('trop tard')
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(h.resultats).toEqual([])
  })

  it('ne remonte RIEN quand whisper ne rend que du silence', async () => {
    // L'ENTRÉE QUI CASSE UN FAUX FIX : une transcription vide. La laisser passer enverrait une
    // commande vide à Jarvis à chaque bruit de la pièce.
    const h = monter(async () => '   ')
    h.moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    await dire(8, 9)
    expect(h.resultats).toEqual([])
    expect(h.erreurs).toEqual([])
  })

  it('coupe le micro à l’arrêt : pistes stoppées, contexte fermé, `onend` émis', async () => {
    const h = monter(async () => 'peu importe')
    h.moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    h.moteur.stop()
    await new Promise((r) => setTimeout(r, 0))
    expect(h.piste.arrets).toBe(1)
    expect(FauxContexte.dernier!.ferme).toBe(1)
    expect(FauxContexte.dernier!.noeud.deconnecte).toBeGreaterThan(0)
    expect(h.fins()).toBe(1)
  })

  it('ne transcrit plus rien après l’arrêt, même si un segment était en vol', async () => {
    // Le défaut connu des moteurs vocaux : un dernier segment arrive APRÈS l'ordre d'arrêt.
    const h = monter(async () => 'ouvre le chat')
    h.moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    const noeud = FauxContexte.dernier!.noeud
    for (let i = 0; i < 8; i += 1) {
      noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => parole() } })
    }
    h.moteur.stop()
    for (let i = 0; i < 9; i += 1) {
      noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => silence() } })
    }
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(h.resultats).toEqual([])
  })

  it('signale un micro refusé au lieu de faire semblant d’écouter', async () => {
    const Fabrique = fabriqueWhisper({
      micro: async () => {
        throw new Error('Permission denied')
      },
      contexte: () => new FauxContexte() as never,
      transcrire: async () => ''
    })
    const moteur = new Fabrique()
    const erreurs: string[] = []
    moteur.onerror = (e): void => void erreurs.push(String((e as { error?: unknown }).error))
    let fins = 0
    moteur.onend = (): void => void (fins += 1)
    moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(erreurs).toEqual(['micro-indisponible'])
    expect(fins).toBe(1)
  })

  it('distingue les CINQ pannes de micro au lieu d’en faire une seule', () => {
    // DEFAUT VECU (2026-09-03) : le `catch` jetait la vraie erreur, donc « aucun micro branche »
    // s'affichait « autorisez le microphone » — un reglage deja bon, cherche pour rien.
    const nomme = (name: string): string => codeErreurMicro(Object.assign(new Error('x'), { name }))
    expect(nomme('NotAllowedError')).toBe('micro-refuse')
    expect(nomme('SecurityError')).toBe('micro-refuse')
    expect(nomme('NotFoundError')).toBe('micro-absent')
    expect(nomme('NotReadableError')).toBe('micro-occupe')
    expect(nomme('OverconstrainedError')).toBe('micro-introuvable')
    // Inconnu = on n'INVENTE pas de cause : le code generique reste.
    expect(nomme('Error')).toBe('micro-indisponible')
    expect(codeErreurMicro(null)).toBe('micro-indisponible')
  })

  it('remonte la panne REELLE du micro jusqu’au moteur', async () => {
    const Fabrique = fabriqueWhisper({
      micro: async () => {
        throw Object.assign(new Error('no device'), { name: 'NotFoundError' })
      },
      contexte: () => new FauxContexte() as never,
      transcrire: async () => ''
    })
    const moteur = new Fabrique()
    const erreurs: string[] = []
    moteur.onerror = (e): void => void erreurs.push(String((e as { error?: unknown }).error))
    moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(erreurs).toEqual(['micro-absent'])
  })

  it('réessaie UNE fois une transcription qui échoue, puis signale l’échec', async () => {
    let appels = 0
    const h = monter(async () => {
      appels += 1
      throw new Error('CLI absente')
    })
    h.moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    await dire(8, 9)
    await new Promise((r) => setTimeout(r, 0))
    expect(appels).toBe(2)
    expect(h.erreurs).toEqual(['transcription-impossible'])
  })
})

describe('niveau d’entrée et sensibilité', () => {
  it('remonte le niveau BRUT de chaque bloc — c’est ce que la jauge affiche', async () => {
    const { moteur } = monter(async () => 'x')
    const niveaux: number[] = []
    moteur.onniveau = (rms): void => void niveaux.push(rms)
    moteur.start()
    await new Promise((r) => setTimeout(r, 0))
    const noeud = FauxContexte.dernier!.noeud
    noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => silence() } })
    noeud.onaudioprocess?.({ inputBuffer: { getChannelData: () => parole() } })
    moteur.stop()
    expect(niveaux).toHaveLength(2)
    expect(niveaux[0]).toBe(0)
    // Le bloc de parole doit ressortir NETTEMENT au-dessus du silence, sinon la jauge ne prouverait
    // rien à l'utilisateur qui parle.
    expect(niveaux[1]).toBeGreaterThan(0.1)
  })

  it('un seuil relevé par l’utilisateur rend le moteur sourd à une voix faible', async () => {
    // RMS ≈ 0,014 : au-dessus du seuil par défaut (0,012), en dessous d'un seuil relevé à 0,03.
    const faible = (): Float32Array => {
      const bloc = new Float32Array(TAILLE_BLOC)
      for (let i = 0; i < TAILLE_BLOC; i += 1) bloc[i] = Math.sin(i / 3) * 0.02
      return bloc
    }
    const jouer = async (moteur: MoteurVocal, echantillon: () => Float32Array): Promise<void> => {
      moteur.start()
      await new Promise((r) => setTimeout(r, 0))
      const noeud = FauxContexte.dernier!.noeud
      for (let i = 0; i < 8; i += 1)
        noeud.onaudioprocess?.({ inputBuffer: { getChannelData: echantillon } })
      for (let i = 0; i < 12; i += 1)
        noeud.onaudioprocess?.({ inputBuffer: { getChannelData: silence } })
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
    }

    const normal = monter(async () => 'entendu')
    await jouer(normal.moteur, faible)
    expect(normal.resultats).toEqual(['entendu'])

    const sourd = monter(async () => 'entendu')
    sourd.moteur.seuilParole = 0.03
    await jouer(sourd.moteur, faible)
    expect(sourd.resultats).toEqual([])
  })
})
