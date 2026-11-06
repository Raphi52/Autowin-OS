import { describe, expect, it } from 'vitest'
import { blocEtatSuivant, diffEtat } from './etat-diff'

const etat = {
  tab: 'chat',
  providers: ['claude', 'codex'],
  skillsDisponibles: ['build — …', 'scout — …'],
  conversationsCount: 2
}

describe('diff de l’état de l’app entre deux itérations', () => {
  it('ne rend RIEN quand l’état n’a pas bougé', () => {
    expect(diffEtat(etat, { ...etat })).toBeNull()
  })

  it('ne rend QUE les clés changées — le catalogue des skills ne repasse pas', () => {
    const apres = { ...etat, tab: 'accueil' }
    expect(diffEtat(etat, apres)).toEqual({ tab: 'accueil' })
  })

  it('compare par valeur : un tableau reconstruit à l’identique n’est pas un changement', () => {
    const apres = { ...etat, providers: ['claude', 'codex'] }
    expect(diffEtat(etat, apres)).toBeNull()
  })

  it('signale une clé DISPARUE, sinon le modèle la croirait encore valide', () => {
    const { conversationsCount: _, ...apres } = etat
    expect(diffEtat(etat, apres)).toEqual({ conversationsCount: null })
  })

  it('rend l’état ENTIER quand il n’y a pas de précédent', () => {
    expect(diffEtat(undefined, etat)).toEqual(etat)
  })

  it('annonce « inchangé » plutôt que de resérialiser tout l’état', () => {
    const bloc = blocEtatSuivant(etat, { ...etat })
    expect(bloc).toBe('ÉTAT DE L’APP : inchangé')
    expect(bloc).not.toContain('skillsDisponibles')
  })

  it('nomme le bloc comme un DELTA, jamais comme un état complet', () => {
    const bloc = blocEtatSuivant(etat, { ...etat, tab: 'accueil' })
    expect(bloc).toContain('CHANGÉ DEPUIS LE DERNIER ÉTAT')
    expect(bloc).toContain('"tab":"accueil"')
    expect(bloc).not.toContain('providers')
  })
})
