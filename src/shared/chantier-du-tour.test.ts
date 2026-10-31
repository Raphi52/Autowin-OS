import { describe, expect, it } from 'vitest'
import {
  chantiersDuJournal,
  estLigneDeChantier,
  ligneDeChantier,
  lireLigneDeChantier,
  type Chantier
} from './chantier-du-tour'

const chantier = (plus: Partial<Chantier> = {}): Chantier => ({
  id: 'wi4rmejh2',
  nom: 'audit-des-routes',
  statut: 'en-cours',
  phases: [{ titre: 'Lecture', enAttente: 1, enCours: 2, finis: 3, echecs: 1 }],
  enAttente: 1,
  enCours: 2,
  finis: 3,
  echecs: 1,
  jetons: 1_234_567,
  gros: false,
  quota: false,
  ...plus
})

describe('ligne de chantier', () => {
  it('se lit telle quelle là où un statut brut s’affiche', () => {
    const ligne = ligneDeChantier(chantier())
    expect(ligne).toMatch(
      /^Chantier wi4rmejh2 · 2 en cours · 3 finis · 1 en échec · 1234567 jetons/
    )
  })

  it('se relit à l’identique', () => {
    expect(lireLigneDeChantier(ligneDeChantier(chantier()))).toEqual(chantier())
  })

  it('tient dans une ligne du journal d’actions, même avec cent phases', () => {
    const phases = Array.from({ length: 100 }, (_, i) => ({
      titre: `Phase ${i} `.repeat(30),
      enAttente: 0,
      enCours: 0,
      finis: 1,
      echecs: 0
    }))
    const ligne = ligneDeChantier(chantier({ phases, nom: 'n'.repeat(500) }))
    expect(ligne.length).toBeLessThanOrEqual(4_000)
    const relu = lireLigneDeChantier(ligne)
    expect(relu?.phases.length).toBeLessThanOrEqual(25)
    // Le total des agents reste juste : les phases coupées sont regroupées, pas perdues.
    expect(relu?.phases.reduce((n, p) => n + p.finis, 0)).toBe(100)
  })

  it('ne confond pas une ligne ordinaire ni une ligne abîmée', () => {
    expect(estLigneDeChantier('Bash · ls')).toBe(false)
    expect(estLigneDeChantier('Chantier en cours')).toBe(false)
    expect(lireLigneDeChantier('Chantier x · 1 en cours ¦ {pas du json')).toBeNull()
    expect(lireLigneDeChantier('Chantier x · 1 en cours ¦ {"id":"x"}')).toBeNull()
  })
})

describe('chantiersDuJournal', () => {
  it('rend [] sans chantier', () => {
    expect(chantiersDuJournal(undefined)).toEqual([])
    expect(chantiersDuJournal(['Bash · ls'])).toEqual([])
  })

  it('garde le dernier état de chaque chantier, à sa place de première apparition', () => {
    const a1 = ligneDeChantier(chantier({ id: 'a', finis: 1 }))
    const b = ligneDeChantier(chantier({ id: 'b' }))
    const a2 = ligneDeChantier(chantier({ id: 'a', finis: 9, statut: 'fini' }))
    const rendus = chantiersDuJournal([a1, 'Bash · ls', b, a2])
    expect(rendus.map((c) => c.id)).toEqual(['a', 'b'])
    expect(rendus[0]).toMatchObject({ finis: 9, statut: 'fini' })
  })
})
