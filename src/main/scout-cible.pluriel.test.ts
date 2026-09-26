import { describe, expect, it } from 'vitest'
import { enteteCibleManquante, lireDecisionScoutTexte } from './scout-cible'

describe('CIBLES: (pluriel) dans un run orchestré — skills/scout/SKILL.md l.54', () => {
  it('reconnaît un lot de pistes nommées', () => {
    const d = lireDecisionScoutTexte('| a | b |\n\nCIBLES: corriger le lecteur, ajouter le test')
    expect(d.statut).toBe('cible')
    expect(enteteCibleManquante('CIBLES: corriger le lecteur, ajouter le test')).toBeUndefined()
  })
  it('CIBLES: l’emporte sur CIBLE:', () => {
    const d = lireDecisionScoutTexte('CIBLE: piste a\nCIBLES: piste b, piste c')
    expect(d).toMatchObject({ statut: 'cible', cible: 'piste b, piste c' })
  })
  it('une seule piste destructrice arrête tout le lot', () => {
    expect(lireDecisionScoutTexte('CIBLES: corriger le test, supprimer le dossier runs').statut).toBe(
      'cible-destructrice',
    )
  })
  it('aucune et numéros nus ne sont pas un choix', () => {
    expect(lireDecisionScoutTexte('CIBLES: aucune').statut).toBe('aucune-cible')
    expect(lireDecisionScoutTexte('CIBLES: 1, 3, 4').statut).toBe('aucune-cible')
  })
})

describe('CIBLES: numéros nus — rejetés et SIGNALÉS (SKILL.md l.59), pas un « rien à faire » muet', () => {
  it('l’avertissement nomme le refus des numéros et demande les pistes en toutes lettres', () => {
    const entete = enteteCibleManquante('| # | piste |\n\nCIBLES: 1, 3, 4')
    expect(entete).toMatch(/numéros/)
    expect(entete).toMatch(/en toutes lettres/i)
    expect(entete).not.toMatch(/n'a engagé aucune piste/)
  })
})

