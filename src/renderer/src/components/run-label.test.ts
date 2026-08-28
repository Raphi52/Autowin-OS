import { describe, expect, it } from 'vitest'
import { libelleRun } from './run-label'

/**
 * ROUGE AVANT FIX — la pastille affichait le NOM DE DOSSIER brut, marque horodatée comprise
 * (`corrige-bug-recherche-mtd23401`). L'identifiant reste le dossier (c'est lui que `@run:`
 * résout) ; seul l'AFFICHAGE est rendu lisible.
 */
describe('libelleRun', () => {
  it('retire la marque horodatée et rend des mots', () => {
    expect(libelleRun('corrige-bug-recherche-terme-court-mtd23401')).toBe(
      'Corrige bug recherche terme court'
    )
  })

  // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA RÈGLE EST FAUSSE : un dernier segment qui
  // est un VRAI mot (`v2`, `court`) ne doit pas être pris pour un horodatage et amputé.
  it("n'ampute pas un dernier segment qui est un vrai mot", () => {
    expect(libelleRun('baseline-differentielle-v2')).toBe('Baseline differentielle v2')
    expect(libelleRun('recherche-terme-court')).toBe('Recherche terme court')
  })

  it('laisse un libellé déjà lisible intact', () => {
    expect(libelleRun('Débloque le run')).toBe('Débloque le run')
  })
})
