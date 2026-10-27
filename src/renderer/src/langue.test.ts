// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * LA LANGUE DE L'INTERFACE (conv-1146). Entrée qui doit faire échouer ce fichier : une valeur
 * mémorisée abîmée qui ne retombe pas sur le français, un stockage en panne qui casse l'écran, ou
 * une langue redite qui repart vers le moteur (l'effet qui rejoue le thème à chaque ouverture de
 * Settings est le piège déjà connu, conv-981).
 *
 * Le module garde la langue courante en mémoire : chaque cas le recharge à neuf.
 */
type ModuleLangue = typeof import('./langue')

async function charger(): Promise<ModuleLangue> {
  vi.resetModules()
  return import('./langue')
}

const g = globalThis as { api?: unknown }

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('lang')
})
afterEach(() => {
  delete g.api
  vi.restoreAllMocks()
})

describe('langue de l’interface — lecture', () => {
  it('rien d’enregistré : français', async () => {
    const { lireLangue, langueCourante } = await charger()
    expect(lireLangue()).toBe('fr')
    expect(langueCourante()).toBe('fr')
  })

  it('valeur inconnue, vide ou d’un autre format : français, sans erreur', async () => {
    const { lireLangue, LANGUE_STORAGE_KEY } = await charger()
    for (const brut of ['de', '', 'EN', ' en', '{"langue":"en"}']) {
      localStorage.setItem(LANGUE_STORAGE_KEY, brut)
      expect(lireLangue()).toBe('fr')
    }
    localStorage.setItem(LANGUE_STORAGE_KEY, 'en')
    expect(lireLangue()).toBe('en')
  })

  it('stockage illisible : français, sans erreur', async () => {
    const { lireLangue, LANGUE_STORAGE_KEY } = await charger()
    // L'anglais EST mémorisé : seul le stockage en panne peut faire répondre « fr » ici.
    localStorage.setItem(LANGUE_STORAGE_KEY, 'en')
    const lecture = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('stockage indisponible')
    })
    expect(lireLangue()).toBe('fr')
    expect(lecture).toHaveBeenCalled()
  })
})

describe('langue de l’interface — changement', () => {
  it('choisir l’anglais : mémorisé, posé sur le document, transmis UNE fois au moteur', async () => {
    const recus: string[] = []
    g.api = { setLangue: (l: string) => (recus.push(l), Promise.resolve(l)) }
    const { ecrireLangue, langueCourante, LANGUE_STORAGE_KEY } = await charger()

    ecrireLangue('en')
    expect(localStorage.getItem(LANGUE_STORAGE_KEY)).toBe('en')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    expect(langueCourante()).toBe('en')
    expect(recus).toEqual(['en'])

    // La même langue redite : rien n'est réécrit ni renvoyé.
    ecrireLangue('en')
    expect(recus).toEqual(['en'])

    // Une valeur hors liste est ignorée : la langue choisie reste.
    ecrireLangue('de')
    ecrireLangue(undefined)
    expect(langueCourante()).toBe('en')
    expect(recus).toEqual(['en'])

    ecrireLangue('fr')
    expect(recus).toEqual(['en', 'fr'])
    expect(document.documentElement.getAttribute('lang')).toBe('fr')
  })

  it('écriture refusée par le stockage : la langue vaut pour la session, l’écran reste utilisable', async () => {
    const { ecrireLangue, langueCourante, lireLangue } = await charger()
    const ecriture = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => ecrireLangue('en')).not.toThrow()
    expect(ecriture).toHaveBeenCalled()
    expect(langueCourante()).toBe('en')
    // Rien n'a été mémorisé : le prochain démarrage revient au français.
    expect(lireLangue()).toBe('fr')
  })

  it('sans pont (navigateur, test) ou moteur qui refuse : aucune erreur', async () => {
    const { ecrireLangue, transmettreLangueAuMoteur } = await charger()
    expect(() => ecrireLangue('en')).not.toThrow()
    g.api = { setLangue: () => Promise.reject(new Error('canal absent')) }
    expect(() => transmettreLangueAuMoteur('fr')).not.toThrow()
    g.api = {
      setLangue: () => {
        throw new Error('pont en panne')
      }
    }
    expect(() => transmettreLangueAuMoteur('fr')).not.toThrow()
  })

  /**
   * L'ÉCHEC D'ENVOI SE VOIT (conv-1146, réparation après le contrôle final) : avant, un refus du
   * moteur était avalé — l'écran passait en anglais, l'agent répondait en français, et rien ne le
   * disait. Entrée qui doit faire échouer ce cas : un refus, une panne du pont ou une langue gardée
   * différente qui ne laissent aucune trace lisible par l'écran.
   */
  it('moteur qui refuse, pont en panne ou langue non gardée : l’échec est retenu', async () => {
    const { transmettreLangueAuMoteur, echecEnvoiLangue } = await charger()
    g.api = { setLangue: () => Promise.reject(new Error('canal absent')) }
    await transmettreLangueAuMoteur('en')
    expect(echecEnvoiLangue()).toEqual({ langue: 'en', raison: 'canal absent' })

    g.api = {
      setLangue: () => {
        throw new Error('pont en panne')
      }
    }
    await transmettreLangueAuMoteur('en')
    expect(echecEnvoiLangue()).toEqual({ langue: 'en', raison: 'pont en panne' })

    // Le moteur répond, mais avec une autre langue que celle demandée : l'agent ne la suivra pas.
    g.api = { setLangue: () => Promise.resolve('fr') }
    await transmettreLangueAuMoteur('en')
    expect(echecEnvoiLangue()?.langue).toBe('en')
  })

  it('JUMEAU accepté : un envoi réussi efface l’échec, et sans pont il n’y a rien à signaler', async () => {
    const { transmettreLangueAuMoteur, echecEnvoiLangue } = await charger()
    await transmettreLangueAuMoteur('en')
    expect(echecEnvoiLangue()).toBeUndefined()

    g.api = { setLangue: () => Promise.reject(new Error('canal absent')) }
    await transmettreLangueAuMoteur('en')
    expect(echecEnvoiLangue()).toBeDefined()
    g.api = { setLangue: (l: string) => Promise.resolve(l) }
    await transmettreLangueAuMoteur('en')
    expect(echecEnvoiLangue()).toBeUndefined()
  })

  it('seul le DERNIER envoi compte : un refus arrivé en retard ne recouvre pas un succès plus récent', async () => {
    const { transmettreLangueAuMoteur, echecEnvoiLangue, abonnerLangue } = await charger()
    let refuser: (e: Error) => void = () => {}
    g.api = {
      setLangue: (l: string) =>
        l === 'en' ? new Promise((_, rejet) => (refuser = rejet)) : Promise.resolve(l)
    }
    let prevenus = 0
    abonnerLangue(() => prevenus++)
    const lent = transmettreLangueAuMoteur('en')
    await transmettreLangueAuMoteur('fr')
    refuser(new Error('trop tard'))
    await lent
    expect(echecEnvoiLangue()).toBeUndefined()
    expect(prevenus).toBe(0)
  })

  /*
   * LES DATES ET LES NOMBRES SUIVENT LA LANGUE (conv-1170). Entrée qui doit faire échouer ce cas :
   * une locale restée en dur ('fr-FR') après le passage en anglais, une date sans heure là où
   * `toLocaleString` en donnait une, ou une date invalide qui lève au lieu de s'afficher.
   * Les espaces insécables d'Intl (U+00A0, U+202F) sont ramenés à une espace simple pour comparer.
   */
  it('formaterDate et formaterNombre : fr-FR, puis en-US après le changement de langue', async () => {
    const { formaterDate, formaterNombre, appliquerLangue } = await charger()
    const espaces = (texte: string): string => texte.replace(/\s/gu, ' ')
    const instant = Date.UTC(2026, 9, 27, 14, 5, 9)
    const utc = { timeZone: 'UTC' } as const

    appliquerLangue('fr')
    expect(espaces(formaterDate(instant, utc))).toBe('27/10/2026 14:05:09')
    expect(formaterDate(new Date(instant), { ...utc, dateStyle: 'long' })).toBe('27 octobre 2026')
    expect(formaterDate(new Date(instant).toISOString(), { ...utc, timeStyle: 'short' })).toBe(
      '14:05'
    )
    expect(espaces(formaterNombre(1234.5))).toBe('1 234,5')
    // Sans options : le même français que l'appel en dur qu'elle remplace.
    expect(formaterDate(instant)).toBe(new Date(instant).toLocaleString('fr-FR'))
    expect(formaterDate('pas une date')).toBe('Invalid Date')

    appliquerLangue('en')
    expect(espaces(formaterDate(instant, utc))).toBe('10/27/2026, 2:05:09 PM')
    expect(formaterDate(instant, { ...utc, dateStyle: 'long' })).toBe('October 27, 2026')
    expect(formaterNombre(1234.5)).toBe('1,234.5')
    expect(formaterNombre(0.25, { style: 'percent' })).toBe('25%')
  })

  it('prévient les composants abonnés à chaque CHANGEMENT, pas pour la même langue', async () => {
    const { abonnerLangue, appliquerLangue } = await charger()
    const vus: number[] = []
    const desabonner = abonnerLangue(() => vus.push(vus.length))
    appliquerLangue('en')
    appliquerLangue('en')
    appliquerLangue('fr')
    desabonner()
    appliquerLangue('en')
    expect(vus).toHaveLength(2)
  })
})
