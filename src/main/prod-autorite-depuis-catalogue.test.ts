import { describe, expect, it } from 'vitest'
import { configureSqlCatalog as configurerCatalogueTest } from './sql-read-catalog'
import { TEST_SQL_CATALOG } from './sql-catalog.test-fixture'

configurerCatalogueTest(TEST_SQL_CATALOG)
import {
  declarationsDepuisCatalogue,
  propositionDepuisCatalogue,
  propositionPourEcran
} from './prod-autorite-depuis-catalogue'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { cheminAutoriteProd, chargerAutoriteProd } from './store/prod-autorite-store'
import { classerCible, type EntreeAutorite } from './prod-guard'

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
      propositionDepuisCatalogue([], { exploitees: EXPLOITEES, developpement: DEV }).contenu,
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

/**
 * LA PROPOSITION POUR L'ÉCRAN DE RÉGLAGES. L'application n'écrit jamais le fichier de déclaration
 * (`store/prod-autorite-store.ts`) : elle PROPOSE un contenu que l'utilisateur recopie lui-même.
 * Ce qui est vérifié : la déclaration actuelle est reprise telle qu'écrite, seul ce qui manque est
 * ajouté, et aucune protection n'est jamais BAISSÉE.
 */
const ACTUELLES: EntreeAutorite[] = [
  { nature: 'chemin', nom: 'D:/Deploiement/Prod', classe: 'prod', motif: 'écrit à la main' },
  { nature: 'base', nom: 'db_alpha', classe: 'prod' },
  { nature: 'base', nom: 'DB_PAPA', classe: 'non-prod', motif: 'cru hors production' },
  { nature: 'base', nom: 'APP_RECETTE', classe: 'prod', motif: 'protégée exprès' }
]

describe('proposition depuis le catalogue', () => {
  const proposer = (): ReturnType<typeof propositionDepuisCatalogue> =>
    propositionDepuisCatalogue(ACTUELLES, { exploitees: EXPLOITEES, developpement: DEV })

  it('reprend chaque entrée actuelle TELLE QU’ÉCRITE, casse et motif compris', () => {
    const p = proposer()
    expect(p.entrees[0]).toEqual(ACTUELLES[0])
    expect(p.entrees[1]).toEqual(ACTUELLES[1])
    expect(p.conservees).toBe(4)
  })

  it('n’ajoute QUE les bases absentes, sans doublon dû à la casse', () => {
    const p = proposer()
    expect(p.ajoutees.map((e) => [e.nom, e.classe])).toEqual([['APP_DEV', 'non-prod']])
    expect(p.entrees.filter((e) => e.nom.toLowerCase() === 'db_alpha')).toHaveLength(1)
    expect(p.entrees).toHaveLength(5)
  })

  it('passe en PRODUCTION une base déclarée hors production que le catalogue dit exploitée', () => {
    const p = proposer()
    expect(p.passeesEnProd).toEqual(['DB_PAPA'])
    expect(p.entrees.find((e) => e.nom === 'DB_PAPA')?.classe).toBe('prod')
  })

  it('ne BAISSE jamais une protection : une base protégée à la main reste en production', () => {
    expect(proposer().entrees.find((e) => e.nom === 'APP_RECETTE')?.classe).toBe('prod')
  })

  it('part d’une déclaration vide : tout le catalogue est ajouté', () => {
    const p = propositionDepuisCatalogue([], { exploitees: EXPLOITEES, developpement: DEV })
    expect(p.ajoutees).toHaveLength(4)
    expect(p.conservees).toBe(0)
  })

  it('produit un contenu que le chargeur relit SANS ligne écartée, avec la même classification', () => {
    const racine = mkdtempSync(`${tmpdir()}/prod-autorite-prop-`)
    writeFileSync(cheminAutoriteProd(racine), proposer().contenu, 'utf8')
    const charge = chargerAutoriteProd(racine)
    expect(charge.anomalies).toEqual([])
    expect(charge.declarations).toEqual(proposer().entrees)
    expect(classerCible({ nature: 'base', nom: 'DB_PAPA' }, charge.autorite).estBloquant).toBe(true)
    expect(classerCible({ nature: 'base', nom: 'APP_DEV' }, charge.autorite).estBloquant).toBe(
      false
    )
  })
})

describe('proposition pour l’écran de réglages', () => {
  const DECLARATION = { declarations: ACTUELLES, anomalies: ['entrée 9 : nom manquant ou vide'] }

  it('DIT l’échec du catalogue au lieu d’une liste vide qui aurait l’air complète', () => {
    expect(
      propositionPourEcran(DECLARATION, { ok: false, erreur: 'Requête abandonnée.' }, DEV)
    ).toEqual({ ok: false, erreur: 'Catalogue SQL illisible : Requête abandonnée.' })
  })

  it('rend le résumé, les remarques sur le fichier actuel et le contenu prêt à coller', () => {
    const r = propositionPourEcran(DECLARATION, { ok: true, exploitees: EXPLOITEES }, DEV)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.exploitees).toBe(2)
    expect(r.ajoutees).toEqual([{ nom: 'APP_DEV', classe: 'non-prod' }])
    expect(r.passeesEnProd).toEqual(['DB_PAPA'])
    expect(r.conservees).toBe(4)
    expect(r.anomalies).toEqual(['entrée 9 : nom manquant ou vide'])
    expect(JSON.parse(r.contenu)).toHaveLength(5)
  })
})
