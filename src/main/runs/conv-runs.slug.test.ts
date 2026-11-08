import { describe, expect, it } from 'vitest'
import { slugify } from './conv-runs'
import { tacheAvecLectureRetenue } from '../chat/deux-lectures'

// Le nom du dossier d'un travail doit dire de quoi il parle. La phrase d'en-tête ajoutée par la
// compréhension (« Compréhension de la demande, annoncée à l'utilisateur : ») ne dit rien du sujet :
// elle donnait le même nom à des travaux sans rapport (fix-comprehension-demande-annoncee-faire).
describe('slugify — la phrase de compréhension ne nomme pas le travail', () => {
  it('nomme le travail par ce qui a été compris, pas par la phrase d’en-tête', () => {
    const tache = tacheAvecLectureRetenue(
      'fix',
      'Faire le regroupement proposé : réunir les 4 copies de memeChemin en une seule version',
      'Corriger tous les problèmes repérés dans le tableau'
    )
    const slug = slugify(tache)
    expect(slug).not.toMatch(/comprehension|annoncee/)
    expect(slug).toContain('regroupement')
  })

  it('deux demandes différentes ne portent plus le même nom', () => {
    const a = slugify(tacheAvecLectureRetenue('fix', 'Réunir les copies de memeChemin'))
    const b = slugify(tacheAvecLectureRetenue('fix', 'Retirer le masquage des secrets en double'))
    expect(a).not.toBe(b)
  })

  it('garde le mot « compréhension » quand c’est l’utilisateur qui l’écrit', () => {
    expect(slugify('Améliore la compréhension de la demande dans le chat')).toContain('comprehension')
  })
})
