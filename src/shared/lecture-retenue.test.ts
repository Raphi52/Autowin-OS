/**
 * L'annonce écrite par le processus principal et le texte affiché par le fil restent accordés
 * (conv-1123) : si `annonceDeLaLectureRetenue` change son début, l'étiquette « lecture » du fil
 * afficherait « Lecture retenue : » en double.
 */
import { describe, expect, it } from 'vitest'
import { annonceDeLaLectureRetenue } from '../main/deux-lectures'
import { DEBUT_LECTURE_RETENUE, ceQuiAEteCompris, texteDeLaLectureRetenue } from './lecture-retenue'

describe('texte de la ligne « Lecture retenue »', () => {
  it('retire le début déjà dit par l’étiquette', () => {
    const annonce = annonceDeLaLectureRetenue('le zoom de la frise')
    expect(annonce.startsWith(DEBUT_LECTURE_RETENUE)).toBe(true)
    expect(texteDeLaLectureRetenue(`${annonce}\n\n`)).toBe('« le zoom de la frise »')
  })

  it('retire aussi l’ancien début « Lecture retenue : » des fils d’avant conv-1280', () => {
    expect(annonceDeLaLectureRetenue('x').startsWith('Compréhension : ')).toBe(true)
    expect(texteDeLaLectureRetenue('Lecture retenue : « le zoom »\n\n')).toBe('« le zoom »')
  })

  it('laisse intact un texte qui ne commence pas par l’annonce', () => {
    expect(texteDeLaLectureRetenue('  Autre chose.  ')).toBe('Autre chose.')
  })
})

describe('ce que la pastille « compréhension » affiche (conv-1280)', () => {
  it('la phrase comprise seule, guillemets compris', () => {
    expect(ceQuiAEteCompris(`${annonceDeLaLectureRetenue('le zoom')}\n\n`)).toBe('« le zoom »')
  })

  it('coupe l’autre lecture que portent encore les lignes des anciens fils', () => {
    const ancienne =
      'Lecture retenue : « le zoom de la frise » — si tu voulais plutôt « un filtre des éléments », dis-le.\n\n'
    expect(ceQuiAEteCompris(ancienne)).toBe('« le zoom de la frise »')
  })

  it('un texte sans guillemets en tête est rendu entier', () => {
    expect(ceQuiAEteCompris('Autre chose.')).toBe('Autre chose.')
  })
})
