import { describe, expect, it, vi } from 'vitest'
import { Dictee, insererDictee, type DependancesDictee } from './composer-dictee'

describe('insererDictee', () => {
  it('insère au point d’insertion avec les espaces qu’il faut', () => {
    expect(insererDictee('bonjour le monde', 'cher', 8)).toEqual({
      texte: 'bonjour cher le monde',
      caret: 12
    })
  })

  it('n’ajoute pas d’espace en tête d’un champ vide', () => {
    expect(insererDictee('', ' salut  ', 0)).toEqual({ texte: 'salut', caret: 5 })
  })

  it('ne touche à rien quand whisper rend du vide', () => {
    expect(insererDictee('déjà tapé', '   ', 4)).toEqual({ texte: 'déjà tapé', caret: 4 })
  })
})

function fauxDeps(transcrire = vi.fn(async (_wav: Uint8Array) => 'texte dicté')): {
  deps: DependancesDictee
  pousser: (bloc: Float32Array) => void
  pistesArretees: () => number
  transcrire: typeof transcrire
} {
  let onaudio: ((e: { inputBuffer: { getChannelData(c: number): Float32Array } }) => void) | null =
    null
  let arrets = 0
  const deps: DependancesDictee = {
    micro: async () => ({ getTracks: () => [{ stop: () => (arrets += 1) }] }),
    contexte: () =>
      ({
        sampleRate: 16_000,
        destination: {},
        createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
        createScriptProcessor: () => ({
          connect: () => {},
          disconnect: () => {},
          set onaudioprocess(v: never) {
            onaudio = v
          },
          get onaudioprocess() {
            return onaudio as never
          }
        }),
        close: async () => {}
      }) as never,
    transcrire
  }
  return {
    deps,
    pousser: (bloc) => onaudio?.({ inputBuffer: { getChannelData: () => bloc } }),
    pistesArretees: () => arrets,
    transcrire
  }
}

const parole = (n: number): Float32Array =>
  Float32Array.from({ length: n }, (_, i) => Math.sin(i / 3) * 0.3)

describe('Dictee', () => {
  it('enregistre puis rend le texte transcrit, micro refermé', async () => {
    const { deps, pousser, pistesArretees, transcrire } = fauxDeps()
    const dictee = new Dictee(deps)
    expect(await dictee.demarrer()).toBe(true)
    pousser(parole(1600))
    pousser(parole(1600))
    const texte = await dictee.arreter()
    expect(texte).toBe('texte dicté')
    expect(pistesArretees()).toBe(1)
    expect(dictee.enCours).toBe(false)
    const wav = transcrire.mock.calls[0]![0]
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
  })

  it('écrit chaque phrase DANS LE CHAMP pendant que le micro tourne', async () => {
    const { deps, pousser } = fauxDeps()
    const ecrits: string[] = []
    const dictee = new Dictee({ ...deps, onTexte: (t) => ecrits.push(t) })
    await dictee.demarrer()
    // Une phrase, puis 700 ms de silence : la phrase est finie, elle doit partir tout de suite.
    pousser(parole(8000))
    pousser(new Float32Array(16_000))
    await new Promise((r) => setTimeout(r, 0))
    expect(ecrits).toEqual(['texte dicté'])
    expect(dictee.aDejaEcrit).toBe(true)
    // Micro TOUJOURS ouvert : la dictée continue après l'écriture.
    expect(dictee.enCours).toBe(true)
    // La deuxième phrase s'écrit aussi, sans clic d'arrêt.
    pousser(parole(8000))
    pousser(new Float32Array(16_000))
    await new Promise((r) => setTimeout(r, 0))
    expect(ecrits).toEqual(['texte dicté', 'texte dicté'])
    await dictee.arreter()
  })

  it('annuler ne transcrit rien', async () => {
    const { deps, pousser, transcrire } = fauxDeps()
    const dictee = new Dictee(deps)
    await dictee.demarrer()
    pousser(parole(1600))
    dictee.annuler()
    expect(transcrire).not.toHaveBeenCalled()
    expect(await dictee.arreter()).toBe('')
  })

  it('une transcription qui échoue ne casse rien', async () => {
    const { deps, pousser } = fauxDeps(
      vi.fn(async (_wav: Uint8Array): Promise<string> => {
        throw new Error('cli absente')
      })
    )
    const dictee = new Dictee(deps)
    await dictee.demarrer()
    pousser(parole(1600))
    expect(await dictee.arreter()).toBe('')
  })

  /**
   * L'APERÇU est la réponse au défaut mesuré « le texte ne s'affiche pas en temps réel » : sans lui,
   * rien ne sort tant que la phrase n'est pas finie, et le champ reste vide pendant qu'on parle.
   */
  it('rend un aperçu PENDANT la phrase, sans jamais l’écrire dans le champ', async () => {
    const { deps, pousser } = fauxDeps()
    const apercus: string[] = []
    const ecrits: string[] = []
    const dictee = new Dictee({
      ...deps,
      onTexte: (t) => ecrits.push(t),
      onApercu: (t) => apercus.push(t)
    })
    await dictee.demarrer()
    // 2 s de parole continue, sans silence : aucune phrase n'est finie, donc rien dans le champ.
    pousser(parole(16_000))
    pousser(parole(16_000))
    await new Promise((r) => setTimeout(r, 0))
    expect(apercus).toContain('texte dicté')
    expect(ecrits).toEqual([])
    await dictee.arreter()
  })

  it('efface l’aperçu quand la phrase définitive est écrite', async () => {
    const { deps, pousser } = fauxDeps()
    const apercus: string[] = []
    const dictee = new Dictee({ ...deps, onTexte: () => {}, onApercu: (t) => apercus.push(t) })
    await dictee.demarrer()
    pousser(parole(16_000))
    pousser(parole(16_000))
    await new Promise((r) => setTimeout(r, 0))
    pousser(new Float32Array(32_000))
    await new Promise((r) => setTimeout(r, 0))
    expect(apercus.at(-1)).toBe('')
    await dictee.arreter()
  })

  it('n’empile pas deux aperçus en parallèle', async () => {
    let enVol = 0
    let max = 0
    const transcrire = vi.fn(async (_wav: Uint8Array) => {
      enVol += 1
      max = Math.max(max, enVol)
      await new Promise((r) => setTimeout(r, 5))
      enVol -= 1
      return 'texte dicté'
    })
    const { deps, pousser } = fauxDeps(transcrire)
    const dictee = new Dictee({ ...deps, onApercu: () => {} })
    await dictee.demarrer()
    for (let i = 0; i < 6; i += 1) pousser(parole(16_000))
    await new Promise((r) => setTimeout(r, 30))
    expect(max).toBe(1)
    await dictee.arreter()
  })

  it('annuler efface l’aperçu affiché', async () => {
    const { deps, pousser } = fauxDeps()
    const apercus: string[] = []
    const dictee = new Dictee({ ...deps, onApercu: (t) => apercus.push(t) })
    await dictee.demarrer()
    pousser(parole(16_000))
    pousser(parole(16_000))
    await new Promise((r) => setTimeout(r, 0))
    dictee.annuler()
    expect(apercus.at(-1)).toBe('')
  })

  it('un micro refusé rend false', async () => {
    const { deps } = fauxDeps()
    const dictee = new Dictee({
      ...deps,
      micro: async () => {
        throw new Error('refusé')
      }
    })
    expect(await dictee.demarrer()).toBe(false)
    expect(dictee.enCours).toBe(false)
  })
})
