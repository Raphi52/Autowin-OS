/*
 * PROTOCOLE DES PAGES INTERACTIVES (page-interactive.ts, conv-1304) : ce que la page envoie est du
 * code du modele, donc une DONNEE a lire et borner. Le fil (BlocHtmlInteractif.tsx) et l'apercu
 * (scripts/html-interactif-apercu) passent par ces memes fonctions.
 */
import { describe, expect, it } from 'vitest'
import { TYPE_MESSAGE_SCENE_3D } from '../../../shared/scene-3d'
import {
  HAUTEUR_MAX_PAGE,
  MAX_STOCKAGE_PAGE,
  MAX_TEXTE_COPIE,
  ajouterAvis,
  empreintePage,
  lienOuvrable,
  lireMessagePage,
  reponseALaPage,
  retenirStockageDeLaPage,
  stockageDeLaPage,
  type AvisPage
} from './page-interactive'

const msg = (contenu: Record<string, unknown>): unknown => ({
  type: TYPE_MESSAGE_SCENE_3D,
  ...contenu
})

describe('lireMessagePage', () => {
  it('ignore tout ce qui ne porte pas le type du protocole', () => {
    expect(lireMessagePage(null)).toBeNull()
    expect(lireMessagePage('pret')).toBeNull()
    expect(lireMessagePage({ type: 'autre', etat: 'pret' })).toBeNull()
    expect(lireMessagePage(msg({ etat: 'inconnu' }))).toBeNull()
  })

  it('borne la hauteur et les messages', () => {
    expect(lireMessagePage(msg({ etat: 'hauteur', hauteur: 10.2 }))).toEqual({
      etat: 'hauteur',
      hauteur: 11
    })
    expect(lireMessagePage(msg({ etat: 'hauteur', hauteur: -1 }))).toBeNull()
    expect(lireMessagePage(msg({ etat: 'hauteur', hauteur: 1e9 }))).toEqual({
      etat: 'hauteur',
      hauteur: HAUTEUR_MAX_PAGE
    })
    const long = lireMessagePage(msg({ etat: 'erreur', message: 'x'.repeat(10_000) }))
    expect(long && 'message' in long ? long.message.length : 0).toBe(2000)
    expect(lireMessagePage(msg({ etat: 'alerte' }))).toEqual({ etat: 'alerte', message: '' })
  })

  it('ne garde du stockage que des chaines, et refuse au-dela de la borne', () => {
    expect(lireMessagePage(msg({ etat: 'stockage', donnees: { a: '1', b: 2, c: null } }))).toEqual({
      etat: 'stockage',
      donnees: { a: '1' }
    })
    expect(
      lireMessagePage(msg({ etat: 'stockage', donnees: { a: 'x'.repeat(MAX_STOCKAGE_PAGE) } }))
    ).toBeNull()
  })

  it('n accepte une copie que bornee et numerotee', () => {
    expect(lireMessagePage(msg({ etat: 'copier', texte: 'x', demande: 3 }))).toEqual({
      etat: 'copier',
      texte: 'x',
      demande: 3
    })
    expect(lireMessagePage(msg({ etat: 'copier', texte: 'x', demande: 0 }))).toBeNull()
    expect(lireMessagePage(msg({ etat: 'copier', texte: 'x', demande: 1.5 }))).toBeNull()
    expect(
      lireMessagePage(msg({ etat: 'copier', texte: 'x'.repeat(MAX_TEXTE_COPIE + 1), demande: 1 }))
    ).toBeNull()
  })

  it('n ouvre que http et https, comme les liens du fil', () => {
    expect(lireMessagePage(msg({ etat: 'lien', href: 'https://a.fr/b?c' }))).toEqual({
      etat: 'lien',
      href: 'https://a.fr/b?c'
    })
    for (const href of ['file:///C:/x', 'javascript:alert(1)', 'ms-settings:', '/relatif', 12]) {
      expect(lireMessagePage(msg({ etat: 'lien', href }))).toBeNull()
    }
    expect(lienOuvrable('http://localhost:5173/')).toBe('http://localhost:5173/')
  })

  it('borne le defilement demande', () => {
    expect(lireMessagePage(msg({ etat: 'defiler', y: 40 }))).toEqual({ etat: 'defiler', y: 40 })
    expect(lireMessagePage(msg({ etat: 'defiler', y: Number.NaN }))).toBeNull()
  })
})

describe('reponses, avis et stockage', () => {
  it('repond a une demande avec son numero', () => {
    expect(reponseALaPage(4, false, 'non')).toEqual({
      type: TYPE_MESSAGE_SCENE_3D,
      reponse: 4,
      ok: false,
      message: 'non'
    })
  })

  it('compte un avis repete au lieu de l empiler, et en garde quatre au plus', () => {
    let avis: AvisPage[] = []
    avis = ajouterAvis(avis, { ton: 'erreur', message: 'a' })
    avis = ajouterAvis(avis, { ton: 'erreur', message: 'a' })
    expect(avis).toEqual([{ ton: 'erreur', message: 'a', fois: 2 }])
    for (const m of ['b', 'c', 'd', 'e']) avis = ajouterAvis(avis, { ton: 'alerte', message: m })
    expect(avis.map((a) => a.message)).toEqual(['b', 'c', 'd', 'e'])
  })

  it('reconnait la meme page par son empreinte, et retient son stockage', () => {
    expect(empreintePage('<p>a</p>')).toBe(empreintePage('<p>a</p>'))
    expect(empreintePage('<p>a</p>')).not.toBe(empreintePage('<p>b</p>'))
    const cle = empreintePage('<p>stockage du test</p>')
    expect(stockageDeLaPage(cle)).toBeUndefined()
    retenirStockageDeLaPage(cle, { n: '3' })
    expect(stockageDeLaPage(cle)).toEqual({ n: '3' })
  })

  it('oublie les pages les plus anciennes au-dela de soixante', () => {
    const premiere = empreintePage('premiere page')
    retenirStockageDeLaPage(premiere, { a: '1' })
    for (let i = 0; i < 60; i += 1) retenirStockageDeLaPage(`page-${i}`, { i: String(i) })
    expect(stockageDeLaPage(premiere)).toBeUndefined()
    expect(stockageDeLaPage('page-59')).toEqual({ i: '59' })
  })
})
