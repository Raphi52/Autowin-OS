import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  choisirVoix,
  oublierEtatPiper,
  parler,
  taireJarvis,
  VOIX_PIPER_URI
} from './jarvis-parole'
import { ecrireReglageVoix } from './jarvis-voix-reglage'
import { basculerEcoute, ecouteInitiale, phraseDeJarvis } from './jarvis-voice'

const voix = (lang: string, defaut = false): SpeechSynthesisVoice =>
  ({ lang, default: defaut, name: lang }) as SpeechSynthesisVoice

interface Faux {
  speak: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  getVoices: () => SpeechSynthesisVoice[]
}

function poserMoteur(liste: SpeechSynthesisVoice[]): Faux {
  const faux: Faux = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => liste }
  const g = globalThis as unknown as Record<string, unknown>
  g.speechSynthesis = faux
  g.SpeechSynthesisUtterance = class {
    voice: SpeechSynthesisVoice | null = null
    lang = ''
    rate = 1
    pitch = 1
    constructor(public text: string) {}
  }
  return faux
}

afterEach(() => {
  taireJarvis()
  const g = globalThis as unknown as Record<string, unknown>
  delete g.speechSynthesis
  delete g.SpeechSynthesisUtterance
})

describe('ce que Jarvis dit', () => {
  it('reste MUET quand l’écoute est coupée', () => {
    // Le défaut que ce test ferme : un moteur rend un dernier résultat APRÈS l'arrêt. Sans cette
    // garde, Jarvis parlerait tout seul, micro éteint.
    expect(phraseDeJarvis(ecouteInitiale, { genre: 'fin', sujet: 'Jarvis' })).toBeNull()
  })

  it('reste MUET en mode enregistrement, même sur une fin de tour', () => {
    const dictee = basculerEcoute(ecouteInitiale, 1, 'enregistrement')
    expect(phraseDeJarvis(dictee, { genre: 'fin', sujet: 'Réunion' })).toBeNull()
    expect(phraseDeJarvis(dictee, { genre: 'ordre' })).toBeNull()
  })

  it('accuse l’ordre et annonce la fin, micro en mode Jarvis', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    expect(phraseDeJarvis(on, { genre: 'ordre' })).toBe('Tout de suite.')
    expect(phraseDeJarvis(on, { genre: 'fin', sujet: 'Jarvis' })).toBe('C’est fait : Jarvis.')
    expect(phraseDeJarvis(on, { genre: 'fin' })).toBe('C’est fait.')
    expect(phraseDeJarvis(on, { genre: 'erreur', sujet: 'Ordre non exécuté' })).toBe(
      'Je n’ai pas pu : Ordre non exécuté.'
    )
  })

  it('coupe un titre trop long au lieu d’en faire une tirade', () => {
    const on = basculerEcoute(ecouteInitiale, 1)
    const dit = phraseDeJarvis(on, { genre: 'fin', sujet: 'x'.repeat(120) }) ?? ''
    expect(dit.length).toBeLessThan(70)
    expect(dit.endsWith('….')).toBe(true)
  })
})

describe('la voix locale', () => {
  it('préfère une voix française, sinon la voix par défaut', () => {
    expect(choisirVoix([voix('en-US', true), voix('fr-FR')])?.lang).toBe('fr-FR')
    expect(choisirVoix([voix('en-US'), voix('de-DE', true)])?.lang).toBe('de-DE')
    expect(choisirVoix([])).toBeNull()
  })

  it('prononce avec la voix française et annule la phrase précédente', async () => {
    const moteur = poserMoteur([voix('en-US', true), voix('fr-FR')])
    expect(await parler('Tout de suite.')).toBe(true)
    expect(moteur.cancel).toHaveBeenCalledTimes(1)
    const dit = moteur.speak.mock.calls[0][0] as SpeechSynthesisUtterance
    expect(dit.text).toBe('Tout de suite.')
    expect(dit.lang).toBe('fr-FR')
  })

  it('ne casse rien quand le poste n’a aucune synthèse vocale', async () => {
    expect(await parler('Tout de suite.')).toBe(false)
  })

  it('ne prononce pas une phrase vide', async () => {
    const moteur = poserMoteur([voix('fr-FR')])
    expect(await parler('   ')).toBe(false)
    expect(moteur.speak).not.toHaveBeenCalled()
  })
})

describe('la voix CHOISIE dans les reglages', () => {
  const nommee = (name: string, lang: string): SpeechSynthesisVoice =>
    ({ name, lang, voiceURI: name, default: false }) as SpeechSynthesisVoice

  it('prend la voix demandee, meme si une voix francaise existe ailleurs', () => {
    expect(choisirVoix([nommee('Hortense', 'fr-FR'), nommee('Zira', 'en-US')], 'Zira')?.name).toBe(
      'Zira'
    )
  })

  it('retombe sur le francais quand la voix demandee n’est plus installee', () => {
    // Une voix desinstallee ne doit pas rendre l'assistant MUET : c'est le defaut a eviter.
    expect(choisirVoix([nommee('Hortense', 'fr-FR')], 'Disparue')?.name).toBe('Hortense')
  })

  it('prononce avec le debit et la hauteur enregistres', async () => {
    const g = globalThis as unknown as { localStorage?: Storage }
    const data: Record<string, string> = {}
    g.localStorage = {
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => {
        data[k] = v
      }
    } as unknown as Storage
    ecrireReglageVoix(g.localStorage, { voixURI: 'Zira', debit: 1.4, hauteur: 1.2 })
    const moteur = poserMoteur([nommee('Hortense', 'fr-FR'), nommee('Zira', 'en-US')])
    expect(await parler('Essai.')).toBe(true)
    const dit = moteur.speak.mock.calls[0][0] as SpeechSynthesisUtterance
    expect(dit.voice?.name).toBe('Zira')
    expect(dit.rate).toBe(1.4)
    expect(dit.pitch).toBe(1.2)
    delete g.localStorage
  })
})

describe('la voix NEURONALE (Piper) quand elle est installée', () => {
  interface FauxSon {
    pause: ReturnType<typeof vi.fn>
    play: ReturnType<typeof vi.fn>
    src: string
  }
  const sons: FauxSon[] = []

  function poserPiper(installe: boolean, parle?: () => Promise<Uint8Array>): void {
    const g = globalThis as unknown as Record<string, unknown>
    g.api = {
      piperEtat: async () => ({ installe }),
      piperParler: parle ?? (async () => new Uint8Array([82, 73, 70, 70]))
    }
    g.Blob = class {
      constructor(public parts: unknown[]) {}
    }
    g.URL = { createObjectURL: () => 'blob:voix', revokeObjectURL: vi.fn() }
    g.Audio = class {
      pause = vi.fn()
      play = vi.fn(() => Promise.resolve())
      constructor(public src: string) {
        sons.push(this as unknown as FauxSon)
      }
    }
  }

  afterEach(() => {
    sons.length = 0
    const g = globalThis as unknown as Record<string, unknown>
    delete g.api
    delete g.Blob
    delete g.URL
    delete g.Audio
    oublierEtatPiper()
  })

  it('parle avec Piper, et NE double PAS avec la voix du système', async () => {
    const moteur = poserMoteur([voix('fr-FR')])
    poserPiper(true)
    expect(await parler('Tout de suite.')).toBe(true)
    expect(sons).toHaveLength(1)
    expect(sons[0].play).toHaveBeenCalled()
    // Le défaut évité : deux voix qui parlent en même temps.
    expect(moteur.speak).not.toHaveBeenCalled()
  })

  it('retombe sur la voix du système quand Piper n’est PAS installé', async () => {
    const moteur = poserMoteur([voix('fr-FR')])
    poserPiper(false)
    expect(await parler('Tout de suite.')).toBe(true)
    expect(sons).toHaveLength(0)
    expect(moteur.speak).toHaveBeenCalledTimes(1)
  })

  it('retombe sur la voix du système quand la synthèse ÉCHOUE : Jarvis ne se tait pas', async () => {
    const moteur = poserMoteur([voix('fr-FR')])
    poserPiper(true, async () => {
      throw new Error('piper a échoué (code 1)')
    })
    expect(await parler('Tout de suite.')).toBe(true)
    expect(moteur.speak).toHaveBeenCalledTimes(1)
  })

  it('respecte le CHOIX de l’utilisateur : une voix de Windows choisie n’est pas doublée par Piper', async () => {
    // Le defaut ferme ici (constat utilisateur du 2026-09-02) : la voix neuronale passait devant
    // TOUTES les autres des qu'elle etait installee. Le reglage affichait un choix qui ne changeait
    // rien — un menu qui ment. Desormais Piper ne parle que s'il est CHOISI, ou en mode automatique.
    const g = globalThis as unknown as { localStorage?: Storage }
    const data: Record<string, string> = {}
    g.localStorage = {
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => {
        data[k] = v
      }
    } as unknown as Storage
    ecrireReglageVoix(g.localStorage, { voixURI: 'fr-FR' })
    const moteur = poserMoteur([voix('fr-FR')])
    poserPiper(true)
    expect(await parler('Tout de suite.')).toBe(true)
    expect(sons, 'Piper ne doit PAS parler quand une autre voix est choisie').toHaveLength(0)
    expect(moteur.speak).toHaveBeenCalledTimes(1)
    delete g.localStorage
  })

  it('utilise Piper quand il est EXPLICITEMENT choisi dans la liste', async () => {
    const g = globalThis as unknown as { localStorage?: Storage }
    const data: Record<string, string> = {}
    g.localStorage = {
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => {
        data[k] = v
      }
    } as unknown as Storage
    ecrireReglageVoix(g.localStorage, { voixURI: VOIX_PIPER_URI })
    const moteur = poserMoteur([voix('fr-FR')])
    poserPiper(true)
    expect(await parler('Tout de suite.')).toBe(true)
    expect(sons).toHaveLength(1)
    expect(moteur.speak).not.toHaveBeenCalled()
    delete g.localStorage
  })

  it('SE TAIT vraiment : la voix Piper en cours est coupée, pas seulement celle du système', async () => {
    // Le défaut fermé ici : `taireJarvis` n'annulait que `speechSynthesis`. Micro déjà éteint,
    // Jarvis finissait quand même sa phrase neuronale.
    const moteur = poserMoteur([voix('fr-FR')])
    poserPiper(true)
    await parler('Tout de suite.')
    taireJarvis()
    expect(sons[0].pause).toHaveBeenCalledTimes(1)
    expect(moteur.cancel).toHaveBeenCalled()
  })

  it('ne joue PAS une phrase annulée pendant sa synthèse', async () => {
    // La synthèse neuronale prend un instant. Sans numéro de phrase, une réplique demandée puis
    // annulée revenait de l'application et se jouait APRÈS le silence.
    poserMoteur([voix('fr-FR')])
    let libere: ((son: Uint8Array) => void) | null = null
    poserPiper(true, () => new Promise<Uint8Array>((r) => (libere = r)))
    const enCours = parler('Tout de suite.')
    // On attend que la synthèse soit RÉELLEMENT partie : couper avant elle ne prouverait rien.
    while (libere === null) await new Promise((r) => setTimeout(r, 0))
    taireJarvis()
    ;(libere as (son: Uint8Array) => void)(new Uint8Array([82, 73, 70, 70]))
    await enCours
    expect(sons).toHaveLength(0)
  })
})
