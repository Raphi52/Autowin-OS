import { describe, expect, it } from 'vitest'
import { configureSqlCatalog as configurerCatalogueTest } from './sql-read-catalog'
import { TEST_SQL_CATALOG } from './sql-catalog.test-fixture'

configurerCatalogueTest(TEST_SQL_CATALOG)
import { contenuAutoriteProd, declarationsDepuisCatalogue } from './prod-autorite-depuis-catalogue'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { cheminAutoriteProd, chargerAutoriteProd } from './store/prod-autorite-store'
import { classerCible } from './prod-guard'

/**
 * LA GÉNÉRATION DE LA LISTE DE DÉCLARATION. Ce qui est vérifié : la classification vient du
 * CATALOGUE (exploitée / cible de développement), jamais du nom — et le fichier produit est
 * réellement relisible par le chargeur, sans une seule ligne écartée.
 */
const EXPLOITEES = [
  { server: 'SRV-PROD\\PROD', database: 'DB_ALPHA' },
  { server: 'SRV-EXT-A', database: 'DB_PAPA' }
]
const DEV = [
  { server: 'SRV-DEV\\DEV', database: 'APP_DEV' },
  { server: 'SRV-DEV\\DEV', database: 'APP_RECETTE' }
]

describe('déclarations depuis le catalogue', () => {
  it('classe les bases EXPLOITÉES en production, avec leur serveur en motif', () => {
    const lignes = declarationsDepuisCatalogue({ exploitees: EXPLOITEES, developpement: [] })
    expect(lignes).toHaveLength(2)
    expect(lignes.every((l) => l.classe === 'prod')).toBe(true)
    expect(lignes[0]?.motif).toContain('catalogue configuré')
  })

  it('classe les cibles de DÉVELOPPEMENT hors production', () => {
    const lignes = declarationsDepuisCatalogue({ exploitees: [], developpement: DEV })
    expect(lignes.map((l) => [l.nom, l.classe])).toEqual([
      ['APP_DEV', 'non-prod'],
      ['APP_RECETTE', 'non-prod']
    ])
  })

  it('ne classe PAS sur le nom : une base « maquette » exploitée reste de la production', () => {
    const lignes = declarationsDepuisCatalogue({
      exploitees: [{ server: 'SRV-PROD\\PROD', database: 'APP_MAQUETTE_2024' }],
      developpement: []
    })
    expect(lignes[0]?.classe).toBe('prod')
  })

  it('tranche vers la PRODUCTION quand un nom apparaît des deux côtés', () => {
    const lignes = declarationsDepuisCatalogue({
      exploitees: [{ server: 'SRV-PROD\\PROD', database: 'APP_RECETTE' }],
      developpement: DEV
    })
    expect(lignes.find((l) => l.nom === 'APP_RECETTE')?.classe).toBe('prod')
  })

  it('ignore les lignes sans nom de base', () => {
    const lignes = declarationsDepuisCatalogue({
      exploitees: [{ server: 'S', database: '  ' }, ...EXPLOITEES],
      developpement: []
    })
    expect(lignes).toHaveLength(2)
  })

  it('trie par nom : un fichier relu par un humain doit être stable', () => {
    const noms = declarationsDepuisCatalogue({
      exploitees: [
        { server: 'S', database: 'APP_ZZZ' },
        { server: 'S', database: 'APP_AAA' }
      ],
      developpement: []
    }).map((l) => l.nom)
    expect(noms).toEqual(['APP_AAA', 'APP_ZZZ'])
  })
})

/**
 * LA PREUVE QUI COMPTE : le fichier généré est relu SANS anomalie par le chargeur, et il produit
 * exactement le comportement attendu à la porte. Un générateur qui écrirait un fichier que le
 * chargeur écarte bloquerait tout en silence.
 */
describe('le fichier produit est réellement utilisable', () => {
  /** On écrit le fichier POUR DE VRAI, puis on le relit avec le chargeur du démarrage. */
  function racineAvecFichier(): string {
    const racine = mkdtempSync(`${tmpdir()}/prod-autorite-gen-`)
    writeFileSync(
      cheminAutoriteProd(racine),
      contenuAutoriteProd({ exploitees: EXPLOITEES, developpement: DEV }),
      'utf8'
    )
    return racine
  }

  it('est relu sans AUCUNE ligne écartée', () => {
    const charge = chargerAutoriteProd(racineAvecFichier())
    expect(charge.anomalies).toEqual([])
    expect(charge.autorite.entrees).toHaveLength(4)
  })

  it('rend les bases exploitées BLOQUANTES et les cibles de dev libres', () => {
    const autorite = chargerAutoriteProd(racineAvecFichier()).autorite
    expect(classerCible({ nature: 'base', nom: 'DB_ALPHA' }, autorite).estBloquant).toBe(true)
    expect(classerCible({ nature: 'base', nom: 'APP_RECETTE' }, autorite).estBloquant).toBe(false)
  })

  it('laisse une base ABSENTE bloquante : l’ignorance n’est pas une permission', () => {
    const autorite = chargerAutoriteProd(racineAvecFichier()).autorite
    expect(classerCible({ nature: 'base', nom: 'APP_JAMAIS_VUE' }, autorite).estBloquant).toBe(true)
  })
})
