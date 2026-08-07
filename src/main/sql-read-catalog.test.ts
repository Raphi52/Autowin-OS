import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOG_DATABASE,
  CATALOG_QUERY,
  CATALOG_SERVER,
  DEV_TARGETS,
  buildSqlTargetCatalog,
  clearSqlTargetCache,
  parseCatalogRows,
  resolveSqlTargets
} from './sql-read-catalog'

/**
 * L'AUTORITÉ du périmètre. Elle a remplacé un motif de nom (`^RIG_…`) plus une liste de serveurs codée
 * en dur, qui était à la fois trop large et trop étroite :
 *
 *  - trop large : le préfixe ouvrait des maquettes, des copies figées d'avant changement de structure
 *    et des bases de service. Aucune heuristique ne pouvait trancher — `RIG_LE_PUY_MARTIN` ressemble à
 *    un greffe et n'en est pas un (vérifié : `GRF_IS_EXPLOIT = 0`) ;
 *  - trop étroite : `RIGBD-POLYNESIE` manquait, alors qu'il héberge `RIG_PAPEETE`, greffe exploité.
 *
 * Mesuré le 2026-08-07 dans `COMMUN_RIG.dbo.GREFFE` : 40 greffes exploités sur 4 serveurs, sur 274
 * lignes au total.
 */
describe('CATALOG_QUERY — la requête qui lit l’autorité', () => {
  /**
   * La table voisine des SECRETS : `GRF_PWD_BD`, `GRF_INFOGREFFE_PASSWORD`, `GRF_DOCVERIF_PASSWORD`,
   * `GRF_WS_IDNUM_CLEF_API`. On ne lit donc que deux colonnes, et jamais `SELECT *`.
   */
  it('ne lit QUE le nom de base et le serveur, jamais un secret', () => {
    expect(CATALOG_QUERY).toContain('GRF_NOMBASE_BD')
    expect(CATALOG_QUERY).toContain('GRF_SERVEUR_BD')
    expect(CATALOG_QUERY).not.toMatch(/select\s+\*/i)
    for (const secret of ['PWD', 'PASSWORD', 'CLEF_API', 'LOGIN']) {
      expect(CATALOG_QUERY, `la requête ne doit pas toucher ${secret}`).not.toContain(secret)
    }
  })

  it('filtre sur les greffes EXPLOITÉS', () => {
    expect(CATALOG_QUERY).toContain('GRF_IS_EXPLOIT = 1')
  })

  it('écarte les lignes sans base ni serveur, plutôt que de les deviner', () => {
    expect(CATALOG_QUERY).toContain('GRF_NOMBASE_BD IS NOT NULL')
    expect(CATALOG_QUERY).toContain('GRF_SERVEUR_BD IS NOT NULL')
  })
})

describe('parseCatalogRows', () => {
  it('traduit les lignes en couples serveur/base', () => {
    expect(
      parseCatalogRows([
        { d: 'RIG_AMIENS', s: 'SQL-PROD\\PROD' },
        { d: 'RIG_PAPEETE', s: 'RIGBD-POLYNESIE' }
      ])
    ).toEqual([
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' },
      { server: 'RIGBD-POLYNESIE', database: 'RIG_PAPEETE' }
    ])
  })

  it('IGNORE une ligne incomplète au lieu de la compléter', () => {
    expect(
      parseCatalogRows([
        { d: 'RIG_AMIENS', s: null },
        { d: '', s: 'SQL-PROD\\PROD' },
        { d: '  ', s: '  ' },
        { s: 'SQL-PROD\\PROD' }
      ])
    ).toEqual([])
  })
})

describe('buildSqlTargetCatalog', () => {
  const catalogue = buildSqlTargetCatalog([
    { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' },
    { server: 'RIGBD-POLYNESIE', database: 'RIG_PAPEETE' },
    { server: 'SQL-DEV\\DEV', database: 'RIG_DEV' }
  ])

  it('reconnaît un couple présent', () => {
    expect(catalogue.has('SQL-PROD\\PROD', 'RIG_AMIENS')).toBe(true)
    expect(catalogue.has('RIGBD-POLYNESIE', 'RIG_PAPEETE')).toBe(true)
  })

  /** Le COUPLE compte : un greffe n'est exploité que sur son serveur. */
  it('refuse une base présente mais sur un autre serveur', () => {
    expect(catalogue.has('SQL-PROD\\PROD', 'RIG_PAPEETE')).toBe(false)
    expect(catalogue.has('RIGBD-POLYNESIE', 'RIG_AMIENS')).toBe(false)
  })

  it('compare sans tenir compte de la casse ni des espaces autour', () => {
    expect(catalogue.has('sql-prod\\prod', 'rig_amiens')).toBe(true)
    expect(catalogue.has('  SQL-PROD\\PROD  ', '  RIG_AMIENS  ')).toBe(true)
  })

  it('refuse ce qui n’y est pas, y compris la base des mots de passe', () => {
    for (const base of ['RIG_LE_PUY_MARTIN', 'RIG_PUY_MAQUETTE', 'COMMUN_RIG', 'master']) {
      expect(catalogue.has('SQL-PROD\\PROD', base), `accepté à tort : ${base}`).toBe(false)
    }
  })

  it('sait énumérer ce qu’il autorise, pour un message de refus utile', () => {
    expect(catalogue.servers()).toEqual(['RIGBD-POLYNESIE', 'SQL-DEV\\DEV', 'SQL-PROD\\PROD'])
    expect(catalogue.databasesFor('SQL-PROD\\PROD')).toEqual(['RIG_AMIENS'])
    expect(catalogue.size()).toBe(3)
  })

  it('ignore une entrée incomplète sans exploser', () => {
    const c = buildSqlTargetCatalog([
      { server: '', database: 'RIG_X' },
      { server: 'S', database: '' }
    ])
    expect(c.size()).toBe(0)
  })
})

describe('DEV_TARGETS', () => {
  /**
   * Ces bases sont `GRF_IS_EXPLOIT = 0` — normal, ce ne sont pas des greffes exploités. Elles sont
   * donc énumérées explicitement, plutôt que d'affaiblir le critère `IS_EXPLOIT` pour les faire
   * entrer. Noms vérifiés dans l'autorité : `RIG_RECETTE`, et non `RIG_RECETE`.
   */
  it('couvre RIG_DEV et RIG_RECETTE sur SQL-DEV\\DEV', () => {
    expect(DEV_TARGETS).toEqual([
      { server: 'SQL-DEV\\DEV', database: 'RIG_DEV' },
      { server: 'SQL-DEV\\DEV', database: 'RIG_RECETTE' }
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

  it('interroge COMMUN_RIG sur le serveur de production', async () => {
    const { promesse, args } = lancer('[{"d":"RIG_AMIENS","s":"SQL-PROD\\\\PROD"}]')
    await promesse
    expect(args[args.indexOf('-S') + 1]).toBe(CATALOG_SERVER)
    expect(args[args.indexOf('-d') + 1]).toBe(CATALOG_DATABASE)
  })

  it('rend les greffes exploités ET les cibles de développement', async () => {
    const { promesse } = lancer(
      '[{"d":"RIG_AMIENS","s":"SQL-PROD\\\\PROD"},{"d":"RIG_PAPEETE","s":"RIGBD-POLYNESIE"}]'
    )
    const c = await promesse
    expect(c.degraded).toBe(false)
    expect(c.has('SQL-PROD\\PROD', 'RIG_AMIENS')).toBe(true)
    expect(c.has('RIGBD-POLYNESIE', 'RIG_PAPEETE')).toBe(true)
    expect(c.has('SQL-DEV\\DEV', 'RIG_DEV')).toBe(true)
    expect(c.has('SQL-DEV\\DEV', 'RIG_RECETTE')).toBe(true)
    expect(c.size()).toBe(4)
  })

  /**
   * Défaut FERMÉ et VISIBLE. Retomber sur un motif de nom quand l'autorité est muette serait
   * exactement le défaut que quatre rounds d'audit ont trouvé : un périmètre qui se dégrade en
   * silence. Ici aucune base de PRODUCTION n'est autorisée, et `degraded` le dit.
   */
  it('autorité injoignable → dégradé, aucune base de production', async () => {
    const { promesse } = lancer('Msg 4060, Level 11\nCannot open database COMMUN_RIG.', 1)
    const c = await promesse
    expect(c.degraded).toBe(true)
    expect(c.has('SQL-PROD\\PROD', 'RIG_AMIENS')).toBe(false)
    expect(c.has('SQL-DEV\\DEV', 'RIG_DEV')).toBe(true)
  })

  it('met le catalogue en cache : une seule interrogation', async () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const deps = {
      spawnFn: spawnFn as never,
      sqlcmdPath: 'sqlcmd.exe',
      outputFile: fakeFile('[{"d":"RIG_AMIENS","s":"SQL-PROD\\\\PROD"}]'),
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
