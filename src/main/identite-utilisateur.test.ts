import { describe, expect, it } from 'vitest'
import { nomUtilisateurCourant } from './identite-utilisateur'

describe('nomUtilisateurCourant', () => {
  it('rend le compte Windows du poste', () => {
    expect(nomUtilisateurCourant({ userInfo: () => ({ username: 'raphael.vilain' }) })).toBe(
      'raphael.vilain'
    )
  })

  it('retombe sur USERNAME quand le profil du poste est illisible', () => {
    const nom = nomUtilisateurCourant({
      userInfo: () => {
        throw new Error('no profile')
      },
      env: { USERNAME: 'greffier1' }
    })
    expect(nom).toBe('greffier1')
  })

  it("rend une chaine vide plutot qu'un nom invente quand rien n'est lisible", () => {
    expect(nomUtilisateurCourant({ userInfo: () => ({ username: '  ' }), env: {} })).toBe('')
  })
})
