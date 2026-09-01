import { afterEach, describe, expect, it, vi } from 'vitest'
import { choisirVoix, parler, taireJarvis } from './jarvis-parole'
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

  it('prononce avec la voix française et annule la phrase précédente', () => {
    const moteur = poserMoteur([voix('en-US', true), voix('fr-FR')])
    expect(parler('Tout de suite.')).toBe(true)
    expect(moteur.cancel).toHaveBeenCalledTimes(1)
    const dit = moteur.speak.mock.calls[0][0] as SpeechSynthesisUtterance
    expect(dit.text).toBe('Tout de suite.')
    expect(dit.lang).toBe('fr-FR')
  })

  it('ne casse rien quand le poste n’a aucune synthèse vocale', () => {
    expect(parler('Tout de suite.')).toBe(false)
  })

  it('ne prononce pas une phrase vide', () => {
    const moteur = poserMoteur([voix('fr-FR')])
    expect(parler('   ')).toBe(false)
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

  it('prononce avec le debit et la hauteur enregistres', () => {
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
    expect(parler('Essai.')).toBe(true)
    const dit = moteur.speak.mock.calls[0][0] as SpeechSynthesisUtterance
    expect(dit.voice?.name).toBe('Zira')
    expect(dit.rate).toBe(1.4)
    expect(dit.pitch).toBe(1.2)
    delete g.localStorage
  })
})
