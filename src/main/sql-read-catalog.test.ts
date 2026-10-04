// fix-ok: valeurs propres à entreprise (serveur, base, table, colonnes du catalogue) écrites en dur — mesuré par grep; remplacées par la config sql-catalog.json, fermée par défaut (tests sql-read-catalog/guard rouge si on rouvre)
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureSqlCatalog as configurerCatalogueTest } from './sql-read-catalog'
import { TEST_SQL_CATALOG } from './sql-catalog.test-fixture'

configurerCatalogueTest(TEST_SQL_CATALOG)
import {
  buildCatalogQuery,
  buildSqlTargetCatalog,
  clearSqlTargetCache,
  configureSqlCatalog,
  devTargets,
  estBaseCatalogue,
  estServeurDev,
  parseCatalogRows,
  parseSqlCatalogConfig,
  resolveSqlTargets
} from './sql-read-catalog'

const CATALOG_QUERY = buildCatalogQuery(TEST_SQL_CATALOG)
const CATALOG_SERVER = TEST_SQL_CATALOG.server
const CATALOG_DATABASE = TEST_SQL_CATALOG.database

/**
 * PLUS AUCUNE VALEUR D'ENTREPRISE DANS LE CODE : sans `sql-catalog.json`, rien n'est lisible.
 * La protection reste FERMÉE par défaut — rendre le code générique ne doit pas l'ouvrir.
 */
describe('sans configuration — défaut fermé', () => {
  it('aucune base, aucun serveur de dev, catalogue dégradé, aucune interrogation', async () => {
    configureSqlCatalog()
    try {
      const spawnFn = vi.fn()
      const c = await resolveSqlTargets({ spawnFn: spawnFn as never })
      expect(spawnFn).not.toHaveBeenCalled()
      expect(c.degraded).toBe(true)
      expect(c.size()).toBe(0)
      expect(c.has('SRV-DEV\\DEV', 'APP_DEV')).toBe(false)
      expect(estServeurDev('SRV-DEV\\DEV')).toBe(false)
      expect(estBaseCatalogue('CATALOGUE')).toBe(false)
      expect(devTargets()).toEqual([])
    } finally {
      configureSqlCatalog(TEST_SQL_CATALOG)
    }
  })
})

describe('parseSqlCatalogConfig', () => {
  it('accepte une configuration complète', () => {
    expect(parseSqlCatalogConfig(TEST_SQL_CATALOG)).toEqual(TEST_SQL_CATALOG)
  })

  it('refuse un identifiant qui injecterait du SQL dans la requête du catalogue', () => {
    for (const champ of ['table', 'databaseColumn', 'serverColumn', 'exploitColumn']) {
      const v = { ...TEST_SQL_CATALOG, [champ]: 'x; DROP TABLE y' }
      expect(parseSqlCatalogConfig(v), `accepté à tort : ${champ}`).toBeUndefined()
    }
  })

  it('refuse une configuration incomplète ou absente', () => {
    expect(parseSqlCatalogConfig(undefined)).toBeUndefined()
    expect(parseSqlCatalogConfig({ ...TEST_SQL_CATALOG, server: '' })).toBeUndefined()
  })
})

/**
 * L'AUTORITÉ du périmètre. Elle a remplacé un motif de nom (`^APP_…`) plus une liste de serveurs codée
 * en dur, qui était à la fois trop large et trop étroite :
 *
 *  - trop large : le préfixe ouvrait des maquettes, des copies figées d'avant changement de structure
 *    et des bases de service. Aucune heuristique ne pouvait trancher — `APP_LE_PUY_MARTIN` ressemble à
 *    un greffe et n'en est pas un (vérifié : `COL_IS_EXPLOIT = 0`) ;
 *  - trop étroite : `SRV-POLYNESIE` manquait, alors qu'il héberge `APP_PAPEETE`, greffe exploité.
 *
 * Mesuré le 2026-08-07 dans `CATALOGUE.dbo.BASES` : 40 greffes exploités sur 4 serveurs, sur 274
 * lignes au total.
 */
describe('CATALOG_QUERY — la requête qui lit l’autorité', () => {
  /**
   * La table voisine des SECRETS : `COL_PWD_BD`, `COL_INFOGREFFE_PASSWORD`, `COL_DOCVERIF_PASSWORD`,
   * `COL_WS_IDNUM_CLEF_API`. On ne lit donc que deux colonnes, et jamais `SELECT *`.
   */
  it('ne lit QUE le nom de base et le serveur, jamais un secret', () => {
    expect(CATALOG_QUERY).toContain('COL_NOMBASE_BD')
    expect(CATALOG_QUERY).toContain('COL_SERVEUR_BD')
    expect(CATALOG_QUERY).not.toMatch(/select\s+\*/i)
    for (const secret of ['PWD', 'PASSWORD', 'CLEF_API', 'LOGIN']) {
      expect(CATALOG_QUERY, `la requête ne doit pas toucher ${secret}`).not.toContain(secret)
    }
  })

  it('filtre sur les greffes EXPLOITÉS', () => {
    expect(CATALOG_QUERY).toContain('COL_IS_EXPLOIT = 1')
  })

  it('écarte les lignes sans base ni serveur, plutôt que de les deviner', () => {
    expect(CATALOG_QUERY).toContain('COL_NOMBASE_BD IS NOT NULL')
    expect(CATALOG_QUERY).toContain('COL_SERVEUR_BD IS NOT NULL')
  })
})

describe('parseCatalogRows', () => {
  it('traduit les lignes en couples serveur/base', () => {
    expect(
      parseCatalogRows([
        { d: 'APP_AMIENS', s: 'SRV-PROD\\PROD' },
        { d: 'APP_PAPEETE', s: 'SRV-POLYNESIE' }
      ])
    ).toEqual([
      { server: 'SRV-PROD\\PROD', database: 'APP_AMIENS' },
      { server: 'SRV-POLYNESIE', database: 'APP_PAPEETE' }
    ])
  })

  it('IGNORE une ligne incomplète au lieu de la compléter', () => {
    expect(
      parseCatalogRows([
        { d: 'APP_AMIENS', s: null },
        { d: '', s: 'SRV-PROD\\PROD' },
        { d: '  ', s: '  ' },
        { s: 'SRV-PROD\\PROD' }
      ])
    ).toEqual([])
  })
})

describe('buildSqlTargetCatalog', () => {
  const catalogue = buildSqlTargetCatalog([
    { server: 'SRV-PROD\\PROD', database: 'APP_AMIENS' },
    { server: 'SRV-POLYNESIE', database: 'APP_PAPEETE' },
    { server: 'SRV-DEV\\DEV', database: 'APP_DEV' }
  ])

  it('reconnaît un couple présent', () => {
    expect(catalogue.has('SRV-PROD\\PROD', 'APP_AMIENS')).toBe(true)
    expect(catalogue.has('SRV-POLYNESIE', 'APP_PAPEETE')).toBe(true)
  })

  /** Le COUPLE compte : un greffe n'est exploité que sur son serveur. */
  it('refuse une base présente mais sur un autre serveur', () => {
    expect(catalogue.has('SRV-PROD\\PROD', 'APP_PAPEETE')).toBe(false)
    expect(catalogue.has('SRV-POLYNESIE', 'APP_AMIENS')).toBe(false)
  })

  it('compare sans tenir compte de la casse ni des espaces autour', () => {
    expect(catalogue.has('srv-prod\\prod', 'app_amiens')).toBe(true)
    expect(catalogue.has('  SRV-PROD\\PROD  ', '  APP_AMIENS  ')).toBe(true)
  })

  it('refuse ce qui n’y est pas, y compris la base des mots de passe', () => {
    for (const base of ['APP_LE_PUY_MARTIN', 'APP_PUY_MAQUETTE', 'CATALOGUE', 'master']) {
      expect(catalogue.has('SRV-PROD\\PROD', base), `accepté à tort : ${base}`).toBe(false)
    }
  })

  it('sait énumérer ce qu’il autorise, pour un message de refus utile', () => {
    expect(catalogue.servers()).toEqual(['SRV-DEV\\DEV', 'SRV-POLYNESIE', 'SRV-PROD\\PROD'])
    expect(catalogue.databasesFor('SRV-PROD\\PROD')).toEqual(['APP_AMIENS'])
    expect(catalogue.size()).toBe(3)
  })

  it('ignore une entrée incomplète sans exploser', () => {
    const c = buildSqlTargetCatalog([
      { server: '', database: 'APP_X' },
      { server: 'S', database: '' }
    ])
    expect(c.size()).toBe(0)
  })
})

describe('devTargets', () => {
  /**
   * Ces bases sont `COL_IS_EXPLOIT = 0` — normal, ce ne sont pas des greffes exploités. Elles sont
   * donc énumérées explicitement, plutôt que d'affaiblir le critère `IS_EXPLOIT` pour les faire
   * entrer. Noms vérifiés dans l'autorité : `APP_RECETTE`, et non `APP_RECETE`.
   */
  it('couvre APP_DEV et APP_RECETTE sur SRV-DEV\\DEV', () => {
    expect(devTargets()).toEqual([
      { server: 'SRV-DEV\\DEV', database: 'APP_DEV' },
      { server: 'SRV-DEV\\DEV', database: 'APP_RECETTE' }
    ])
  })
})

function fakeChild(): EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  kill: () => void
} {
  const c = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: () => void
  }
  c.stdout = new PassThrough()
  c.stderr = new PassThrough()
  c.kill = vi.fn()
  return c
}

function fakeFile(contenu: string): {
  size: () => number
  read: () => string
  remove: () => void
} {
  return { size: () => Buffer.byteLength(contenu, 'utf8'), read: () => contenu, remove: () => {} }
}

describe('resolveSqlTargets', () => {
  beforeEach(() => clearSqlTargetCache())

  function lancer(
    contenu: string,
    code = 0,
    now = 1_000
  ): {
    promesse: ReturnType<typeof resolveSqlTargets>
    args: string[]
  } {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const promesse = resolveSqlTargets({
      spawnFn: spawnFn as never,
      sqlcmdPath: 'sqlcmd.exe',
      outputFile: fakeFile(contenu),
      outputPath: 'T:\\cat.json',
      now: () => now
    })
    child.emit('close', code)
    const [, args] = spawnFn.mock.calls[0] as unknown as [string, string[]]
    return { promesse, args }
  }

  it('interroge CATALOGUE sur le serveur de production', async () => {
    const { promesse, args } = lancer('[{"d":"APP_AMIENS","s":"SRV-PROD\\\\PROD"}]')
    await promesse
    expect(args[args.indexOf('-S') + 1]).toBe(CATALOG_SERVER)
    expect(args[args.indexOf('-d') + 1]).toBe(CATALOG_DATABASE)
  })

  it('rend les greffes exploités ET les cibles de développement', async () => {
    const { promesse } = lancer(
      '[{"d":"APP_AMIENS","s":"SRV-PROD\\\\PROD"},{"d":"APP_PAPEETE","s":"SRV-POLYNESIE"}]'
    )
    const c = await promesse
    expect(c.degraded).toBe(false)
    expect(c.has('SRV-PROD\\PROD', 'APP_AMIENS')).toBe(true)
    expect(c.has('SRV-POLYNESIE', 'APP_PAPEETE')).toBe(true)
    expect(c.has('SRV-DEV\\DEV', 'APP_DEV')).toBe(true)
    expect(c.has('SRV-DEV\\DEV', 'APP_RECETTE')).toBe(true)
    expect(c.has('SRV-PROD\\PROD', 'CATALOGUE')).toBe(true)
    expect(c.size()).toBe(5)
  })

  /**
   * Défaut FERMÉ et VISIBLE. Retomber sur un motif de nom quand l'autorité est muette serait
   * exactement le défaut que quatre rounds d'audit ont trouvé : un périmètre qui se dégrade en
   * silence. Ici aucune base de PRODUCTION n'est autorisée, et `degraded` le dit.
   */
  it('autorité injoignable → dégradé, aucune base de production', async () => {
    const { promesse } = lancer('Msg 4060, Level 11\nCannot open database CATALOGUE.', 1)
    const c = await promesse
    expect(c.degraded).toBe(true)
    expect(c.has('SRV-PROD\\PROD', 'APP_AMIENS')).toBe(false)
    expect(c.has('SRV-DEV\\DEV', 'APP_DEV')).toBe(true)
  })

  it('met le catalogue en cache : une seule interrogation', async () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const deps = {
      spawnFn: spawnFn as never,
      sqlcmdPath: 'sqlcmd.exe',
      outputFile: fakeFile('[{"d":"APP_AMIENS","s":"SRV-PROD\\\\PROD"}]'),
      outputPath: 'T:\\cat.json',
      now: () => 1_000
    }
    const p = resolveSqlTargets(deps)
    child.emit('close', 0)
    await p
    await resolveSqlTargets(deps)
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  /**
   * Un catalogue dégradé n'est PAS gardé une demi-heure : une panne réseau passagère priverait
   * l'agent de la production tout ce temps, sans raison.
   */
  it('ne met PAS en cache un catalogue dégradé', async () => {
    const child1 = fakeChild()
    const child2 = fakeChild()
    const enfants = [child1, child2]
    const spawnFn = vi.fn(() => enfants.shift())
    const deps = {
      spawnFn: spawnFn as never,
      sqlcmdPath: 'sqlcmd.exe',
      outputFile: fakeFile('Msg 4060, Level 11\nCannot open database.'),
      outputPath: 'T:\\cat.json',
      now: () => 1_000
    }
    const p1 = resolveSqlTargets(deps)
    child1.emit('close', 1)
    await p1
    const p2 = resolveSqlTargets(deps)
    child2.emit('close', 1)
    await p2
    expect(spawnFn).toHaveBeenCalledTimes(2)
  })
})
