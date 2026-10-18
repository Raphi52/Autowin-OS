import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  analyserPaires,
  delai,
  evaluerSeuils,
  lire,
  resumerImages,
  SEUILS_PAR_DEFAUT,
  statistiques
} from './banc-decor-budget.mjs'

/**
 * LA PARTIE PURE DU BANC DU DÉCOR (conv-337). Ce qui doit faire échouer ce fichier : un seuil dépassé
 * qui passerait pour tenu, une mesure absente qui ferait échouer un seuil non requis (ou passer un
 * seuil requis), une image vide (rue pas encore compilée) comptée dans le régime établi, ou un
 * fichier de seuils qui ne pointe plus vers une mesure réelle.
 */
describe('banc-decor-budget — partie pure', () => {
  it('statistiques : médiane, centile 95, moyenne ; vide → null', () => {
    expect(statistiques([])).toBeNull()
    const s = statistiques([5, 1, 3, 2, 4, Number.NaN])
    expect(s).toMatchObject({ n: 5, moyenne: 3, mediane: 3, min: 1, max: 5 })
  })

  it('resumerImages : les images sans dessin (rue pas compilée) ne comptent pas', () => {
    const r = resumerImages([
      {
        dessins: 0,
        dessinsReflet: 0,
        programmes: 0,
        programmesReflet: 0,
        triangles: 0,
        ms: 1,
        gpu: null
      },
      {
        dessins: 1000,
        dessinsReflet: 400,
        programmes: 300,
        programmesReflet: 100,
        triangles: 9,
        ms: 30,
        gpu: 10
      },
      {
        dessins: 600,
        dessinsReflet: 0,
        programmes: 200,
        programmesReflet: 0,
        triangles: 7,
        ms: 20,
        gpu: 8
      }
    ])
    expect(r.images).toBe(2)
    expect(r.dessins.moyenne).toBe(800)
    expect(r.imagesAvecReflet).toBe(1)
    expect(r.msCarteGraphique.moyenne).toBe(9)
  })

  it('delai et lire', () => {
    expect(delai({ a: 100, b: 350.04 }, 'a', 'b')).toBe(250)
    expect(delai({ a: 100 }, 'a', 'b')).toBeNull()
    expect(lire({ x: { y: { z: 3 } } }, 'x.y.z')).toBe(3)
    expect(lire({ x: null }, 'x.y')).toBeUndefined()
  })

  it('evaluerSeuils : dépassement, plancher, mesure absente requise ou non', () => {
    const mesure = {
      regime: { dessins: { moyenne: 1300 } },
      retour: { premiereImageMs: null },
      repos: { ips: 15 }
    }
    const v = evaluerSeuils(mesure, [
      { chemin: 'regime.dessins.moyenne', max: 1250 },
      { chemin: 'retour.premiereImageMs', max: 500 },
      { chemin: 'retour.premiereImageMs', max: 500, requis: true },
      { chemin: 'repos.ips', max: 20 },
      { chemin: 'repos.ips', min: 16 }
    ])
    expect(v.ok).toBe(false)
    expect(v.depasses.map((d) => `${d.chemin}:${d.raison}`)).toEqual([
      'regime.dessins.moyenne:> 1250',
      'retour.premiereImageMs:mesure absente',
      'repos.ips:< 16'
    ])
    expect(v.absents).toEqual(['retour.premiereImageMs'])
    expect(v.tenus).toEqual([{ chemin: 'repos.ips', valeur: 15 }])
  })

  it('analyserPaires : moyenne par image, triée, et géométries distinctes par programme', () => {
    const a = analyserPaires(
      [
        { 'E:1:7': [4, 40], 'E:1:8': [1, 10], 'R:2:7': [2, 20] },
        { 'E:1:7': [6, 60], 'E:1:8': [1, 10] }
      ],
      new Map([
        [1, 'MeshStandardMaterial | x'],
        [2, 'brut | y']
      ])
    )
    expect(a.paires[0]).toMatchObject({
      passe: 'ecran',
      programme: 1,
      geometrie: 7,
      dessins: 5,
      triangles: 50
    })
    expect(a.programmes[0]).toMatchObject({
      passe: 'ecran',
      programme: 1,
      dessins: 6,
      geometries: 2
    })
    expect(a.programmes.find((p) => p.passe === 'reflet')).toMatchObject({
      dessins: 1,
      geometries: 1
    })
  })

  it('le fichier de seuils versionné ne vise que des mesures que le banc produit', () => {
    const { seuils } = JSON.parse(readFileSync(SEUILS_PAR_DEFAUT, 'utf8'))
    expect(seuils.length).toBeGreaterThan(3)
    const connus =
      /^(demarrage\.(creeVers\w+Ms|tachesLonguesInterface\.(maxMs|totalMs))|regime\.(dessins|dessinsReflet|programmes|triangles|msFilDuDecor|msCarteGraphique)\.(moyenne|mediane|p95)|regime\.imagesParSeconde|retour\.(premiereImageMs|imagesPendantAbsence)|repos\.imagesParSeconde)$/
    for (const s of seuils) {
      expect(s.chemin).toMatch(connus)
      expect(typeof s.max === 'number' || typeof s.min === 'number').toBe(true)
      expect(typeof s.pourquoi).toBe('string')
    }
  })
})
