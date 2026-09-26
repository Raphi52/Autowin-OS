import { describe, expect, it } from 'vitest'
import { classerCible, construireAutoriteProd, type EntreeAutorite } from './prod-guard'

/**
 * CLASSIFIEUR DE PRODUCTION — la pièce qui décide si un geste touche la production.
 *
 * Ce qui est réellement en jeu ici : aujourd'hui, rien dans le code n'empêche un geste sur une base
 * ou un dossier de production. `autorisation-commande.ts` le dit lui-même en en-tête — il laisse
 * passer `rm -rf /`. Ces tests fixent donc le comportement dont tout le reste dépendra : ce qui
 * n'est pas explicitement déclaré hors production BLOQUE.
 */
const DECLARATIONS: EntreeAutorite[] = [
  { nature: 'base', nom: 'RIG_AMIENS', classe: 'prod', motif: 'greffe exploité' },
  { nature: 'base', nom: 'RIG_MAQUETTE', classe: 'non-prod' },
  { nature: 'serveur', nom: 'RIGBD-POLYNESIE', classe: 'prod' },
  { nature: 'chemin', nom: 'D:\\Deploiement\\Prod', classe: 'prod' },
  { nature: 'chemin', nom: 'D:/Deploiement/Prod/bac-a-sable', classe: 'non-prod' },
  { nature: 'branche', nom: 'main', classe: 'prod' },
  { nature: 'branche', nom: 'feature/essai', classe: 'non-prod' }
]

const AUTORITE = construireAutoriteProd(DECLARATIONS)

describe('classerCible', () => {
  it('classe prod une cible déclarée prod, et le dit avec son motif', () => {
    const verdict = classerCible({ nature: 'base', nom: 'RIG_AMIENS' }, AUTORITE)
    expect(verdict.classe).toBe('prod')
    expect(verdict.estBloquant).toBe(true)
    expect(verdict.raison).toContain('greffe exploité')
  })

  it('laisse passer une cible déclarée hors production', () => {
    const verdict = classerCible({ nature: 'base', nom: 'RIG_MAQUETTE' }, AUTORITE)
    expect(verdict.classe).toBe('non-prod')
    expect(verdict.estBloquant).toBe(false)
  })

  /** La propriété centrale : l'absence d'information n'est pas une permission. */
  it('bloque une cible NON déclarée — inconnu vaut prod', () => {
    const verdict = classerCible({ nature: 'base', nom: 'RIG_INCONNUE' }, AUTORITE)
    expect(verdict.classe).toBe('inconnu')
    expect(verdict.estBloquant).toBe(true)
    expect(verdict.raison).toContain('non déclarée')
  })

  it('bloque une cible vide ou blanche plutôt que de la laisser filer', () => {
    for (const nom of ['', '   ']) {
      const verdict = classerCible({ nature: 'base', nom }, AUTORITE)
      expect(verdict.estBloquant).toBe(true)
      expect(verdict.classe).toBe('inconnu')
    }
  })

  it('ignore la casse et les espaces autour du nom', () => {
    expect(classerCible({ nature: 'base', nom: '  rig_amiens  ' }, AUTORITE).classe).toBe('prod')
  })

  /**
   * Le piège nommé dans l'en-tête du module : un nom VOISIN n'hérite de rien. `RIG_AMIENS_TEST`
   * n'est pas `RIG_AMIENS` — et il tombe du côté prudent, pas du côté permissif.
   */
  it('ne fait AUCUN appariement par préfixe sur un nom voisin', () => {
    expect(classerCible({ nature: 'base', nom: 'RIG_AMIENS_TEST' }, AUTORITE).classe).toBe(
      'inconnu'
    )
  })

  it('ne confond pas deux natures qui portent le même nom', () => {
    expect(classerCible({ nature: 'serveur', nom: 'RIG_AMIENS' }, AUTORITE).classe).toBe('inconnu')
    expect(classerCible({ nature: 'serveur', nom: 'RIGBD-POLYNESIE' }, AUTORITE).classe).toBe(
      'prod'
    )
  })

  it('classe une branche déclarée, et bloque une branche inconnue', () => {
    expect(classerCible({ nature: 'branche', nom: 'main' }, AUTORITE).estBloquant).toBe(true)
    expect(classerCible({ nature: 'branche', nom: 'feature/essai' }, AUTORITE).estBloquant).toBe(
      false
    )
    expect(classerCible({ nature: 'branche', nom: 'release/2026-09' }, AUTORITE).classe).toBe(
      'inconnu'
    )
  })
})

describe('classerCible — chemins', () => {
  it('couvre le contenu d’un dossier déclaré, quel que soit le séparateur', () => {
    expect(
      classerCible({ nature: 'chemin', nom: 'D:\\Deploiement\\Prod\\app\\config.ini' }, AUTORITE)
        .classe
    ).toBe('prod')
    expect(
      classerCible({ nature: 'chemin', nom: 'd:/deploiement/prod/app' }, AUTORITE).classe
    ).toBe('prod')
  })

  /** Sans comparaison par segments, `.../Prod` couvrirait `.../Production`, qui est autre chose. */
  it('ne couvre pas un dossier voisin dont le nom commence pareil', () => {
    expect(
      classerCible({ nature: 'chemin', nom: 'D:/Deploiement/Production/app' }, AUTORITE).classe
    ).toBe('inconnu')
  })

  it('laisse l’exception la plus spécifique gagner sur le dossier parent', () => {
    const verdict = classerCible(
      { nature: 'chemin', nom: 'D:/Deploiement/Prod/bac-a-sable/essai.txt' },
      AUTORITE
    )
    expect(verdict.classe).toBe('non-prod')
    expect(verdict.estBloquant).toBe(false)
  })

  it('ignore un séparateur final', () => {
    expect(
      classerCible({ nature: 'chemin', nom: 'D:\\Deploiement\\Prod\\' }, AUTORITE).classe
    ).toBe('prod')
  })
})

describe('construireAutoriteProd', () => {
  it('tranche un conflit vers prod, quel que soit l’ordre de déclaration', () => {
    const ordreA = construireAutoriteProd([
      { nature: 'base', nom: 'X', classe: 'non-prod' },
      { nature: 'base', nom: 'X', classe: 'prod' }
    ])
    const ordreB = construireAutoriteProd([
      { nature: 'base', nom: 'X', classe: 'prod' },
      { nature: 'base', nom: 'X', classe: 'non-prod' }
    ])
    expect(classerCible({ nature: 'base', nom: 'X' }, ordreA).classe).toBe('prod')
    expect(classerCible({ nature: 'base', nom: 'X' }, ordreB).classe).toBe('prod')
  })

  it('écarte les déclarations abîmées sans perdre les autres, et sans devenir permissive', () => {
    const autorite = construireAutoriteProd([
      { nature: 'base', nom: '', classe: 'non-prod' },
      { nature: 'base', nom: 'VIDE_CLASSE', classe: 'ouvert' as unknown as 'prod' },
      undefined as unknown as EntreeAutorite,
      { nature: 'base', nom: 'BONNE', classe: 'non-prod' }
    ])
    expect(autorite.entrees).toHaveLength(1)
    expect(classerCible({ nature: 'base', nom: 'BONNE' }, autorite).classe).toBe('non-prod')
    expect(classerCible({ nature: 'base', nom: 'VIDE_CLASSE' }, autorite).classe).toBe('inconnu')
  })

  it('une autorité VIDE bloque tout — jamais l’inverse', () => {
    const vide = construireAutoriteProd([])
    expect(classerCible({ nature: 'base', nom: 'RIG_MAQUETTE' }, vide).estBloquant).toBe(true)
    expect(classerCible({ nature: 'chemin', nom: 'D:/Deploiement/Prod' }, vide).estBloquant).toBe(
      true
    )
  })
})

describe('pureté', () => {
  it('rend le même verdict pour les mêmes entrées, sans modifier l’autorité', () => {
    const avant = JSON.stringify(AUTORITE)
    const premier = classerCible({ nature: 'base', nom: 'RIG_AMIENS' }, AUTORITE)
    const second = classerCible({ nature: 'base', nom: 'RIG_AMIENS' }, AUTORITE)
    expect(second).toEqual(premier)
    expect(JSON.stringify(AUTORITE)).toBe(avant)
  })
})
