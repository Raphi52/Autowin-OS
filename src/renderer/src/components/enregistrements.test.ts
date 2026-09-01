import { describe, expect, it } from 'vitest'
import {
  MAX_LIGNES_AFFICHEES,
  ajouterLigneAffichee,
  formaterDuree,
  formaterQuand,
  formaterTaille,
  titreEnregistrement
} from './enregistrements'

describe('affichage des enregistrements', () => {
  it('dit une taille en unites lisibles', () => {
    expect(formaterTaille(320)).toBe('320 o')
    expect(formaterTaille(12_400)).toBe('12.4 ko')
    expect(formaterTaille(3_400_000)).toBe('3.4 Mo')
  })

  it('dit une duree comme on la prononce', () => {
    expect(formaterDuree(9_000)).toBe('9 s')
    expect(formaterDuree(125_000)).toBe('2 min 05 s')
    expect(formaterDuree(3_845_000)).toBe('1 h 04 min')
    expect(formaterDuree(-5)).toBe('0 s')
  })

  it('situe un fichier dans le temps', () => {
    const maintenant = new Date(2026, 8, 1, 15, 0, 0).getTime()
    expect(formaterQuand(maintenant - 10_000, maintenant)).toBe('à l’instant')
    expect(formaterQuand(maintenant - 600_000, maintenant)).toBe('il y a 10 min')
    expect(formaterQuand(new Date(2026, 8, 1, 9, 5, 0).getTime(), maintenant)).toBe(
      'aujourd’hui 09:05'
    )
    expect(formaterQuand(new Date(2026, 7, 30, 9, 5, 0).getTime(), maintenant)).toBe('30/08 09:05')
  })

  it('lit la date dans le nom du fichier, et rend un nom inconnu tel quel', () => {
    expect(titreEnregistrement('enregistrement-2026-09-01_14-32-05.txt')).toBe(
      '01/09/2026 à 14:32'
    )
    expect(titreEnregistrement('notes.txt')).toBe('notes.txt')
  })

  it('empile les paroles, la derniere en tete, sans jamais garder une phrase vide', () => {
    expect(ajouterLigneAffichee(['a'], '  b  ')).toEqual(['b', 'a'])
    expect(ajouterLigneAffichee(['a'], '   ')).toEqual(['a'])
  })

  it('PLAFONNE l affichage sans que cela concerne le disque', () => {
    // L'ecran garde les dernieres lignes ; le fichier, lui, les a toutes (voir transcripts.test.ts).
    let lignes: string[] = []
    for (let i = 0; i < MAX_LIGNES_AFFICHEES + 40; i += 1) {
      lignes = ajouterLigneAffichee(lignes, `phrase ${i}`)
    }
    expect(lignes).toHaveLength(MAX_LIGNES_AFFICHEES)
    expect(lignes[0]).toBe(`phrase ${MAX_LIGNES_AFFICHEES + 39}`)
  })
})
