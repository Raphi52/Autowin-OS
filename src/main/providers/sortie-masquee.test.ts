import { describe, expect, it } from 'vitest'
import { masquerErreur, masquerSortie } from './sortie-masquee'

const masquer = (t: string): string => t.split('sk-valeur-secrete').join('[secret:A_KEY]')

describe('masquerSortie — parcours de la sortie d’un moteur', () => {
  it('masque les chaînes imbriquées et copie seulement ce qui change', () => {
    const intact = { garde: 'rien' }
    const entree = { a: 'x sk-valeur-secrete', b: [{ c: 'sk-valeur-secrete' }, 'ok'], intact }
    const sortie = masquerSortie(entree, masquer)
    expect(sortie).toEqual({ a: 'x [secret:A_KEY]', b: [{ c: '[secret:A_KEY]' }, 'ok'], intact })
    expect(sortie.intact).toBe(intact)
    expect(entree.a).toBe('x sk-valeur-secrete')
  })

  it('ne boucle pas sur une référence circulaire et laisse les instances de classe', () => {
    const cycle: Record<string, unknown> = { t: 'sk-valeur-secrete' }
    cycle.moi = cycle
    const date = new Date(0)
    const sortie = masquerSortie({ cycle, date }, masquer)
    expect((sortie.cycle as Record<string, unknown>).t).toBe('[secret:A_KEY]')
    expect(sortie.date).toBe(date)
  })

  it('masque le message et la pile d’une erreur, en place', () => {
    const e = new Error('refus pour sk-valeur-secrete')
    masquerErreur(e, masquer)
    expect(e.message).toBe('refus pour [secret:A_KEY]')
    expect(e.stack).not.toContain('sk-valeur-secrete')
    expect(() => masquerErreur('pas une erreur', masquer)).not.toThrow()
  })
})
