import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { classerCible } from '../prod-guard'
import { chargerAutoriteProd, cheminAutoriteProd } from './prod-autorite-store'

/**
 * LE CHARGEUR DE LA LISTE D'AUTORITÉ.
 *
 * Deux propriétés, et la seconde est celle qui compte vraiment :
 *   1. une déclaration correcte est appliquée telle qu'elle est écrite ;
 *   2. un fichier absent, illisible ou abîmé donne une liste VIDE — donc tout devient bloquant. Un
 *      fichier effacé ne peut pas ouvrir la production ; au pire il la ferme, et ça se voit.
 */
const racines: string[] = []

function racineNeuve(contenu?: string): string {
  const racine = mkdtempSync(join(tmpdir(), 'autowin-prod-autorite-'))
  racines.push(racine)
  if (contenu !== undefined) writeFileSync(cheminAutoriteProd(racine), contenu, 'utf8')
  return racine
}

afterAll(() => {
  for (const racine of racines) rmSync(racine, { recursive: true, force: true })
})

const DECLARATION = JSON.stringify([
  { nature: 'base', nom: 'RIG_AMIENS', classe: 'prod', motif: 'greffe exploité' },
  { nature: 'base', nom: 'RIG_MAQUETTE', classe: 'non-prod' },
  { nature: 'chemin', nom: 'D:/Deploiement/Prod', classe: 'prod' }
])

describe('une déclaration correcte', () => {
  it('applique exactement ce qui est écrit', () => {
    const { autorite, retenues, anomalies } = chargerAutoriteProd(racineNeuve(DECLARATION))
    expect(retenues).toBe(3)
    expect(anomalies).toEqual([])
    expect(classerCible({ nature: 'base', nom: 'RIG_AMIENS' }, autorite).classe).toBe('prod')
    expect(classerCible({ nature: 'base', nom: 'RIG_MAQUETTE' }, autorite).classe).toBe('non-prod')
    expect(
      classerCible({ nature: 'chemin', nom: 'D:/Deploiement/Prod/app' }, autorite).classe
    ).toBe('prod')
  })

  it('conserve le motif, pour que le refus dise POURQUOI', () => {
    const { autorite } = chargerAutoriteProd(racineNeuve(DECLARATION))
    expect(classerCible({ nature: 'base', nom: 'RIG_AMIENS' }, autorite).raison).toContain(
      'greffe exploité'
    )
  })

  it('accepte aussi la forme { entrees: [...] }', () => {
    const racine = racineNeuve(JSON.stringify({ entrees: JSON.parse(DECLARATION) }))
    expect(chargerAutoriteProd(racine).retenues).toBe(3)
  })

  it('laisse bloquante une cible absente de la déclaration', () => {
    const { autorite } = chargerAutoriteProd(racineNeuve(DECLARATION))
    const verdict = classerCible({ nature: 'base', nom: 'RIG_JAMAIS_DECLAREE' }, autorite)
    expect(verdict.classe).toBe('inconnu')
    expect(verdict.estBloquant).toBe(true)
  })
})

describe('fichier absent ou illisible', () => {
  /** Le cas demandé : aucun fichier. Liste vide, donc TOUT est bloquant, et c'est dit. */
  it('rend une liste VIDE et une anomalie quand le fichier n’existe pas', () => {
    const racine = racineNeuve()
    const { autorite, retenues, anomalies } = chargerAutoriteProd(racine)
    expect(retenues).toBe(0)
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toContain('Aucun fichier de déclaration')
    expect(anomalies[0]).toContain(cheminAutoriteProd(racine))
    expect(classerCible({ nature: 'base', nom: 'RIG_MAQUETTE' }, autorite).estBloquant).toBe(true)
  })

  it('rend une liste VIDE sur du JSON invalide, sans lever', () => {
    const { autorite, retenues, anomalies } = chargerAutoriteProd(
      racineNeuve('{ ceci n’est pas du json')
    )
    expect(retenues).toBe(0)
    expect(anomalies[0]).toContain('illisible')
    expect(classerCible({ nature: 'base', nom: 'RIG_MAQUETTE' }, autorite).estBloquant).toBe(true)
  })

  it('rend une liste VIDE quand le contenu n’est pas une liste d’entrées', () => {
    for (const contenu of ['"une chaîne"', '42', 'null', '{ "autre": [] }']) {
      const chargement = chargerAutoriteProd(racineNeuve(contenu))
      expect(chargement.retenues).toBe(0)
      expect(chargement.anomalies[0]).toMatch(/mal formé|illisible/)
    }
  })

  it('accepte un fichier vide au sens JSON — une liste vide reste une liste vide', () => {
    const chargement = chargerAutoriteProd(racineNeuve('[]'))
    expect(chargement.retenues).toBe(0)
    expect(chargement.anomalies).toEqual([])
  })
})

describe('déclarations partiellement abîmées', () => {
  /**
   * Une ligne fautive ne doit PAS emporter les autres — mais elle doit se VOIR : sans ce rapport, la
   * cible correspondante deviendrait bloquante et personne ne saurait pourquoi.
   */
  it('garde les entrées valides, écarte les autres, et NOMME chaque rejet', () => {
    const racine = racineNeuve(
      JSON.stringify([
        { nature: 'base', nom: 'RIG_AMIENS', classe: 'prod' },
        { nature: 'base_de_donnees', nom: 'X', classe: 'prod' },
        { nature: 'base', nom: '   ', classe: 'prod' },
        { nature: 'base', nom: 'RIG_Y', classe: 'ouvert' },
        'pas un objet',
        { nature: 'base', nom: 'RIG_MAQUETTE', classe: 'non-prod' }
      ])
    )
    const { autorite, retenues, anomalies } = chargerAutoriteProd(racine)
    expect(retenues).toBe(2)
    expect(anomalies).toHaveLength(4)
    expect(anomalies.join(' ')).toContain('nature « base_de_donnees » inconnue')
    expect(anomalies.join(' ')).toContain('nom manquant ou vide')
    expect(anomalies.join(' ')).toContain('classe « ouvert » invalide')
    expect(anomalies.join(' ')).toContain("ce n'est pas un objet")
    expect(classerCible({ nature: 'base', nom: 'RIG_AMIENS' }, autorite).classe).toBe('prod')
    expect(classerCible({ nature: 'base', nom: 'RIG_Y' }, autorite).classe).toBe('inconnu')
  })

  it('signale un doublon ou un conflit, et tranche vers prod', () => {
    const racine = racineNeuve(
      JSON.stringify([
        { nature: 'base', nom: 'RIG_X', classe: 'non-prod' },
        { nature: 'base', nom: 'RIG_X', classe: 'prod' }
      ])
    )
    const { autorite, retenues, anomalies } = chargerAutoriteProd(racine)
    expect(retenues).toBe(1)
    expect(anomalies.join(' ')).toContain('double ou en conflit')
    expect(classerCible({ nature: 'base', nom: 'RIG_X' }, autorite).classe).toBe('prod')
  })
})
