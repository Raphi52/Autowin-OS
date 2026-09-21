import { describe, expect, it } from 'vitest'
import { parseAskDecision, promptDeLOption } from './ask-choices'

/*
 * conv-767, 2026-09-21 : une option en chaîne nue de plus de 200 caractères était coupée à
 * l'affichage, et c'est ce texte coupé que le mode auto envoyait (« …bras B dans le proc »).
 */
const LONGUE =
  "Tester une variante du workflow A qui passe au volet suivant dès que le critère d'un volet est atteint (règles déjà à 18-20/20), pour qu'il atteigne la boutique, et la mettre comme bras B dans le prochain tournoi"

const decision = (options: unknown[]) =>
  parseAskDecision({ kind: 'action', name: 'ask', ok: true, data: { question: 'Laquelle ?', options } })

describe('option longue : l’ordre envoyé reste entier (conv-767)', () => {
  it('chaîne nue : libellé plafonné, envoi complet', () => {
    const o = decision([LONGUE, 'Autre'])!.options[0]
    expect(LONGUE.length).toBeGreaterThan(200)
    expect(o.libelle.length).toBe(200)
    expect(promptDeLOption(o)).toBe(LONGUE)
  })
  it('objet sans envoi : même règle', () => {
    const o = decision([{ libelle: LONGUE }, { libelle: 'Autre' }])!.options[0]
    expect(promptDeLOption(o)).toBe(LONGUE)
  })
  it('option courte : rien ne change', () => {
    const o = decision(['Courte', 'Autre'])!.options[0]
    expect(o).toEqual({ libelle: 'Courte' })
  })
  it('un envoi explicite garde la priorité', () => {
    const o = decision([{ libelle: LONGUE, envoi: 'fais X' }, 'Autre'])!.options[0]
    expect(promptDeLOption(o)).toBe('fais X')
  })
})
