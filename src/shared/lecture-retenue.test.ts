/**
 * L'annonce écrite par le processus principal et le texte affiché par le fil restent accordés
 * (conv-1123) : si `annonceDeLaLectureRetenue` change son début, l'étiquette « lecture » du fil
 * afficherait « Lecture retenue : » en double.
 */
import { describe, expect, it } from 'vitest'
import { annonceDeLaLectureRetenue } from '../main/deux-lectures'
import { DEBUT_LECTURE_RETENUE, texteDeLaLectureRetenue } from './lecture-retenue'

describe('texte de la ligne « Lecture retenue »', () => {
  it('retire le début déjà dit par l’étiquette', () => {
    const annonce = annonceDeLaLectureRetenue('le zoom de la frise', 'un filtre des éléments')
    expect(annonce.startsWith(DEBUT_LECTURE_RETENUE)).toBe(true)
    expect(texteDeLaLectureRetenue(`${annonce}\n\n`)).toBe(
      '« le zoom de la frise » — si tu voulais plutôt « un filtre des éléments », dis-le.'
    )
  })

  it('laisse intact un texte qui ne commence pas par l’annonce', () => {
    expect(texteDeLaLectureRetenue('  Autre chose.  ')).toBe('Autre chose.')
  })
})
