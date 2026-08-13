import { describe, expect, it } from 'vitest'
import { libelleSortieCommande } from './evidence-label'

/**
 * « exit 1 » NE DIT RIEN À UN HUMAIN.
 *
 * Signalé par l'utilisateur le 2026-08-13 sur une puce réelle de son fil : « npm run test:unit →
 * exit 1 … c'est pas clair ». La puce parlait shell : elle affichait un code de sortie brut, sans
 * dire que les tests avaient ÉCHOUÉ, ni combien.
 *
 * On garde le code de sortie — c'est la preuve vérifiable, on ne la cache pas — mais on met devant
 * ce qu'il signifie, et le décompte quand la sortie le contient.
 */
describe('libellé d’une sortie de commande', () => {
  it('dit « réussi » pour un code 0, en gardant le code visible', () => {
    // Le code reste affiché même au vert : un test existant l'exigeait, et il a raison — la preuve
    // ne doit pas disparaître dès que tout va bien.
    expect(libelleSortieCommande({ exitCode: 0 })).toEqual({ texte: 'réussi · exit 0', ok: true })
  })

  it('dit « échec » et garde le code, qui reste la preuve', () => {
    expect(libelleSortieCommande({ exitCode: 1 })).toEqual({ texte: 'échec · exit 1', ok: false })
    expect(libelleSortieCommande({ exitCode: 127 })).toEqual({
      texte: 'échec · exit 127',
      ok: false
    })
  })

  it('donne le décompte des tests quand la sortie le porte', () => {
    const stdout = 'Test Files  3 failed | 514 passed (517)\n     Tests  11 failed | 5827 passed (5838)'
    expect(libelleSortieCommande({ exitCode: 1, stdout })).toEqual({
      texte: '11 tests en échec sur 5838 · exit 1',
      ok: false
    })
  })

  it('annonce le vert avec son volume quand tout passe', () => {
    const stdout = 'Tests  5860 passed (5860)'
    expect(libelleSortieCommande({ exitCode: 0, stdout })).toEqual({
      texte: '5860 tests verts · exit 0',
      ok: true
    })
  })

  it('n’invente aucun décompte quand la sortie n’en contient pas', () => {
    expect(libelleSortieCommande({ exitCode: 1, stdout: 'commande introuvable' })).toEqual({
      texte: 'échec · exit 1',
      ok: false
    })
  })

  it('reste muet quand il n’y a pas de code de sortie', () => {
    expect(libelleSortieCommande({})).toBeUndefined()
  })
})
