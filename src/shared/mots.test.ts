import { describe, expect, it } from 'vitest'
import { motsDe, replier } from './mots'

/**
 * La tokenisation avait DEUX implementations, dans deux fichiers du meme livrable, avec la meme
 * regex et le meme seuil. L'audit l'a releve comme duplication. Ce test tient le contrat de la
 * source unique, pour que la prochaine divergence echoue ici au lieu de se decouvrir a l'usage.
 */
describe('la tokenisation partagee', () => {
  it('replie casse et accents', () => {
    expect(replier('À Jour')).toBe('a jour')
  })

  it('decoupe en mots sans doublon, en ecartant les mots trop courts', () => {
    expect(motsDe('le code couleur de la pastille')).toEqual(['code', 'couleur', 'pastille'])
  })

  it('garde les chemins et identifiants techniques entiers', () => {
    expect(motsDe('src/main/store/conversations.ts')).toContain('conversations.ts')
  })

  it('rend tous les mots quand l appelant le demande', () => {
    expect(motsDe('de la', 1)).toEqual(['de', 'la'])
  })
})
